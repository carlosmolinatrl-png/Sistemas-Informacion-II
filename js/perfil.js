import {
    auth,
    db,
    onAuthStateChanged,
    signOut,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    onSnapshot,
    query,
    where,
    updateCurrentUserEmail,
    updateCurrentUserPassword
} from "./firebase.js";
import { initOfflineStatus, isOnline } from "./offline.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : { send: (_ch, page) => { window.location.href = `./${page}`; } };

// ── DOM ──────────────────────────────────────────────────────────────────────
const lblNombre    = document.getElementById("lblNombre");
const lblDireccion = document.getElementById("lblDireccion");
const lblCorreo    = document.getElementById("lblCorreo");
const txtNombre    = document.getElementById("txtNombre");
const txtDireccion = document.getElementById("txtDireccion");
const msgPerfil    = document.getElementById("msgPerfil");
const msgCorreo    = document.getElementById("msgCorreo");
const msgClave     = document.getElementById("msgClave");
const listaPedidos = document.getElementById("listaPedidos");
const toastEl      = document.getElementById("toast");

// Modal recibo
const modalRecibo      = document.getElementById("modalRecibo");
const btnCerrarRecibo  = document.getElementById("btnCerrarRecibo");
const btnCerrarRecibo2 = document.getElementById("btnCerrarRecibo2");
const btnImprimir      = document.getElementById("btnImprimirRecibo");

// ── Estado ───────────────────────────────────────────────────────────────────
let usuarioActual = null;
let perfilActual  = {};
const CACHE_KEY   = "modaveli_pedidos_cache_";

// ────────────────────────────────────────────────────────────────────────────
// TOAST
// ────────────────────────────────────────────────────────────────────────────
let toastTimer = null;

function mostrarToast(msg, tipo = "ok") {
    toastEl.textContent = msg;
    toastEl.className   = `toast ${tipo === "ok" ? "ok-toast" : "err-toast"} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3800);
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────
function cacheKey(uid)     { return CACHE_KEY + uid; }
function formatMoney(n)    { return `${Number(n || 0).toFixed(2)} €`; }

function formatDate(ms) {
    if (!ms) return "Fecha desconocida";
    return new Date(ms).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatTime(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function setFeedback(el, text, ok = false) {
    if (!el) return;
    el.className   = `feedback ${ok ? "ok" : "error"}`;
    el.textContent = text;
}

// ────────────────────────────────────────────────────────────────────────────
// PERFIL
// ────────────────────────────────────────────────────────────────────────────
async function loadPerfil(uid, emailAuth) {
    const snap = await getDoc(doc(db, "usuarios", uid));
    const data = snap.exists() ? snap.data() : {};
    perfilActual = {
        nombre:    data.nombre    || "",
        direccion: data.direccion || "",
        email:     emailAuth || data.email || ""
    };
    lblNombre.textContent    = perfilActual.nombre    || "Sin nombre";
    lblDireccion.textContent = perfilActual.direccion || "Sin direccion";
    lblCorreo.textContent    = perfilActual.email     || "Sin correo";
    txtNombre.value    = perfilActual.nombre;
    txtDireccion.value = perfilActual.direccion;
}

// ────────────────────────────────────────────────────────────────────────────
// CACHE DE PEDIDOS
// ────────────────────────────────────────────────────────────────────────────
function saveCache(uid, pedidos) { localStorage.setItem(cacheKey(uid), JSON.stringify(pedidos)); }
function loadCache(uid) {
    try { const p = JSON.parse(localStorage.getItem(cacheKey(uid))); return Array.isArray(p) ? p : []; }
    catch { return []; }
}
function mapPedido(snap) {
    const d = snap.data();
    return { id: snap.id, ...d, fechaMs: d.fecha ? d.fecha.toDate().getTime() : null };
}

// ────────────────────────────────────────────────────────────────────────────
// DEVOLUCIÓN — lógica principal
// ────────────────────────────────────────────────────────────────────────────

/**
 * Procesa la devolución de un pedido:
 * 1. Repone el stock de cada artículo en su variante (talla + color)
 * 2. Actualiza el stock global del producto
 * 3. Marca el pedido como "devuelto" en Firestore
 */
async function procesarDevolucion(pedido, btnDev, card) {
    if (!isOnline()) {
        mostrarToast("Sin conexión: no se puede procesar la devolución.", "err");
        return;
    }

    const confirmar = window.confirm(
        `¿Confirmas la devolución del pedido ${pedido.pedidoId || pedido.id}?\n\nTodos los artículos serán repuestos en el stock de la tienda.`
    );
    if (!confirmar) return;

    btnDev.disabled     = true;
    btnDev.textContent  = "Procesando…";

    const items = Array.isArray(pedido.items) ? pedido.items : [];

    try {
        // ── Reponer stock de cada artículo ──
        for (const item of items) {
            if (!item.productoId) continue;

            const prodRef  = doc(db, "productos", item.productoId);
            const prodSnap = await getDoc(prodRef);
            if (!prodSnap.exists()) continue;

            const prodData = prodSnap.data();
            const cantDev  = Number(item.cantidad) || 0;

            // Normalizar talla y color para comparar
            const tallaDev = normStr(item.talla);
            const colorDev = normStr(item.color || "Unico");

            // -- Actualizar array de variantes si existe --
            let nuevoStockTotal = Number(prodData.stock) || 0;

            if (Array.isArray(prodData.variantes) && prodData.variantes.length > 0) {
                const variantesActualizadas = prodData.variantes.map((v) => {
                    const misma =
                        normStr(v.talla) === tallaDev &&
                        normStr(v.color || "Unico") === colorDev;
                    return misma
                        ? { ...v, stock: Number(v.stock || 0) + cantDev }
                        : v;
                });

                // Recalcular stock total sumando todas las variantes
                nuevoStockTotal = variantesActualizadas.reduce(
                    (acc, v) => acc + (Number(v.stock) || 0), 0
                );

                await updateDoc(prodRef, {
                    variantes: variantesActualizadas,
                    stock:     nuevoStockTotal
                });
            } else {
                // Sin variantes: simplemente suma al stock global
                await updateDoc(prodRef, { stock: nuevoStockTotal + cantDev });
            }
        }

        // ── Marcar pedido como devuelto ──
        await updateDoc(doc(db, "pedidos", pedido.id), { estado: "devuelto" });

        // ── Actualizar UI ──
        card.classList.add("devuelto");
        btnDev.textContent = "Devuelto";
        btnDev.disabled    = true;

        // Actualizar el badge de estado en la cabecera de la tarjeta
        const badgeEl = card.querySelector(".badge-devuelto");
        if (!badgeEl) {
            const idEl = card.querySelector(".order-id");
            if (idEl) {
                const badge = document.createElement("span");
                badge.className   = "badge-devuelto";
                badge.textContent = "devuelto";
                idEl.appendChild(badge);
            }
        }

        mostrarToast("✓ Se han devuelto los artículos correctamente", "ok");

    } catch (err) {
        console.error("Error en devolución:", err);
        btnDev.disabled    = false;
        btnDev.textContent = "Devolución";
        mostrarToast("Error al procesar la devolución. Inténtalo de nuevo.", "err");
    }
}

/** Normaliza string para comparar tallas/colores sin importar mayúsculas ni tildes */
function normStr(s) {
    return String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

// ────────────────────────────────────────────────────────────────────────────
// RENDERIZADO DE PEDIDOS
// ────────────────────────────────────────────────────────────────────────────
function renderPedidos(pedidos = []) {
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
        listaPedidos.innerHTML = '<div class="empty">Aun no tienes pedidos registrados.</div>';
        return;
    }

    const ordenados = [...pedidos].sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
    listaPedidos.innerHTML = "";

    ordenados.forEach((pedido) => {
        const items     = Array.isArray(pedido.items) ? pedido.items : [];
        const total     = Number(pedido.total) || items.reduce((s, i) => s + (Number(i.totalLinea) || 0), 0);
        const devuelto  = pedido.estado === "devuelto";

        const card = document.createElement("article");
        card.className = `order-card${devuelto ? " devuelto" : ""}`;

        // Líneas de artículos
        const itemsHtml = items.length
            ? items.map((it) => {
                const qty   = Number(it.cantidad) || 0;
                const linea = Number(it.totalLinea) || (Number(it.precioUnitario) || 0) * qty;
                const talla = it.talla ? `[${it.talla}]` : "";
                const color = it.color ? ` ${it.color}` : "";
                return `<div class="order-item">
                    <span>${it.nombreProducto || "Producto"} ${talla}${color}</span>
                    <span>×${qty}</span>
                    <span>${formatMoney(linea)}</span>
                </div>`;
            }).join("")
            : '<div class="order-item"><span>Sin detalle de lineas</span><span></span><span></span></div>';

        // Badge devuelto en cabecera
        const badgeHtml = devuelto
            ? '<span class="badge-devuelto">devuelto</span>'
            : "";

        card.innerHTML = `
            <div class="order-head">
                <div>
                    <div class="order-id">${pedido.pedidoId || pedido.id || "—"} ${badgeHtml}</div>
                    <div class="order-date">${formatDate(pedido.fechaMs)}  ·  ${formatTime(pedido.fechaMs)}</div>
                </div>
                <div class="order-total">${formatMoney(total)}</div>
            </div>
            ${itemsHtml}
            <div class="order-footer">
                <button class="btn-devolucion" ${devuelto ? "disabled" : ""}>
                    ${devuelto ? "Devuelto" : "↩ Devolución"}
                </button>
                <button class="btn-recibo">🧾 Ver Recibo</button>
            </div>
        `;

        // Evento Ver Recibo
        card.querySelector(".btn-recibo").addEventListener("click", () => {
            abrirRecibo({ ...pedido, total });
        });

        // Evento Devolución
        const btnDev = card.querySelector(".btn-devolucion");
        if (!devuelto) {
            btnDev.addEventListener("click", () => procesarDevolucion(pedido, btnDev, card));
        }

        listaPedidos.appendChild(card);
    });
}

// ────────────────────────────────────────────────────────────────────────────
// MODAL RECIBO
// ────────────────────────────────────────────────────────────────────────────
function abrirRecibo(pedido) {
    const items = Array.isArray(pedido.items) ? pedido.items : [];

    document.getElementById("rPedidoId").textContent = pedido.pedidoId || pedido.id || "—";
    document.getElementById("rFecha").textContent    = formatDate(pedido.fechaMs);
    document.getElementById("rHora").textContent     = formatTime(pedido.fechaMs);
    document.getElementById("rOrigen").textContent   = pedido.origen  || "App";
    document.getElementById("rEstado").textContent   = (pedido.estado || "confirmado").toUpperCase();
    document.getElementById("rNombre").textContent   = pedido.nombreCliente    || perfilActual.nombre    || "—";
    document.getElementById("rCorreo").textContent   = pedido.emailUsuario     || perfilActual.email     || "—";
    document.getElementById("rDireccion").textContent = pedido.direccionCliente || perfilActual.direccion || "—";

    const tbody = document.getElementById("rTablaItems");
    tbody.innerHTML = items.length
        ? items.map((it) => {
            const qty   = Number(it.cantidad)       || 0;
            const precio= Number(it.precioUnitario) || 0;
            const linea = Number(it.totalLinea)     || precio * qty;
            return `<tr>
                <td>${it.nombreProducto || "Producto"}</td>
                <td>${it.talla  || "—"}</td>
                <td>${it.color  || "Único"}</td>
                <td>${qty}</td>
                <td>${formatMoney(precio)}</td>
                <td>${formatMoney(linea)}</td>
            </tr>`;
        }).join("")
        : `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:1rem;">
               Sin detalle disponible.
           </td></tr>`;

    document.getElementById("rTotal").textContent = formatMoney(pedido.total);

    modalRecibo.classList.add("open");
    document.body.style.overflow = "hidden";
}

function cerrarRecibo() {
    modalRecibo.classList.remove("open");
    document.body.style.overflow = "";
}

btnCerrarRecibo.addEventListener("click",  cerrarRecibo);
btnCerrarRecibo2.addEventListener("click", cerrarRecibo);
modalRecibo.addEventListener("click", (e) => { if (e.target === modalRecibo) cerrarRecibo(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarRecibo(); });
btnImprimir.addEventListener("click", () => window.print());

// ────────────────────────────────────────────────────────────────────────────
// LISTENER DE PEDIDOS EN TIEMPO REAL
// ────────────────────────────────────────────────────────────────────────────
function listenPedidos(uid) {
    const q = query(collection(db, "pedidos"), where("usuarioId", "==", uid));
    onSnapshot(
        q,
        (snapshot) => {
            const pedidos = [];
            snapshot.forEach((s) => pedidos.push(mapPedido(s)));
            saveCache(uid, pedidos);
            renderPedidos(pedidos);
        },
        () => renderPedidos(loadCache(uid))
    );
}

// ────────────────────────────────────────────────────────────────────────────
// OFFLINE
// ────────────────────────────────────────────────────────────────────────────
initOfflineStatus((online) => {
    if (!online && usuarioActual) renderPedidos(loadCache(usuarioActual.uid));
});

// ────────────────────────────────────────────────────────────────────────────
// AUTH
// ────────────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { ipcRenderer.send("cambiar-pagina", "login.html"); return; }
    usuarioActual = user;
    try { await loadPerfil(user.uid, user.email || ""); }
    catch (e) { console.error(e); setFeedback(msgPerfil, "No se pudo cargar el perfil."); }
    if (!isOnline()) renderPedidos(loadCache(user.uid));
    listenPedidos(user.uid);
});

// ────────────────────────────────────────────────────────────────────────────
// GUARDAR DATOS DEL PERFIL
// ────────────────────────────────────────────────────────────────────────────
document.getElementById("btnGuardarPerfil").addEventListener("click", async () => {
    if (!usuarioActual) return;
    if (!isOnline()) { setFeedback(msgPerfil, "Sin conexion."); return; }
    const nombre    = txtNombre.value.trim();
    const direccion = txtDireccion.value.trim();
    if (!nombre || !direccion) { setFeedback(msgPerfil, "Nombre y direccion son obligatorios."); return; }
    try {
        await setDoc(doc(db, "usuarios", usuarioActual.uid),
            { nombre, direccion, email: usuarioActual.email || "", rol: "cliente" }, { merge: true });
        perfilActual.nombre    = nombre;
        perfilActual.direccion = direccion;
        lblNombre.textContent    = nombre;
        lblDireccion.textContent = direccion;
        setFeedback(msgPerfil, "Datos guardados correctamente.", true);
    } catch (e) { setFeedback(msgPerfil, "No se pudieron guardar los datos."); }
});

// ────────────────────────────────────────────────────────────────────────────
// CAMBIAR CORREO
// ────────────────────────────────────────────────────────────────────────────
document.getElementById("btnCambiarCorreo").addEventListener("click", async () => {
    if (!usuarioActual) return;
    if (!isOnline()) { setFeedback(msgCorreo, "Sin conexion."); return; }
    const nuevoCorreo = document.getElementById("txtNuevoCorreo").value.trim();
    const claveActual = document.getElementById("txtClaveCorreo").value;
    if (!nuevoCorreo || !claveActual) { setFeedback(msgCorreo, "Completa ambos campos."); return; }
    try {
        await updateCurrentUserEmail(nuevoCorreo, claveActual);
        await setDoc(doc(db, "usuarios", usuarioActual.uid), { email: nuevoCorreo }, { merge: true });
        perfilActual.email = nuevoCorreo;
        lblCorreo.textContent = nuevoCorreo;
        document.getElementById("txtNuevoCorreo").value = "";
        document.getElementById("txtClaveCorreo").value = "";
        setFeedback(msgCorreo, "Correo actualizado correctamente.", true);
    } catch { setFeedback(msgCorreo, "No se pudo cambiar el correo. Verifica la contrasena."); }
});

// ────────────────────────────────────────────────────────────────────────────
// CAMBIAR CONTRASEÑA
// ────────────────────────────────────────────────────────────────────────────
document.getElementById("btnCambiarClave").addEventListener("click", async () => {
    if (!usuarioActual) return;
    if (!isOnline()) { setFeedback(msgClave, "Sin conexion."); return; }
    const claveActual = document.getElementById("txtClaveActual").value;
    const claveNueva  = document.getElementById("txtClaveNueva").value;
    if (!claveActual || !claveNueva) { setFeedback(msgClave, "Completa ambos campos."); return; }
    if (claveNueva.length < 6) { setFeedback(msgClave, "La nueva contrasena debe tener minimo 6 caracteres."); return; }
    try {
        await updateCurrentUserPassword(claveActual, claveNueva);
        document.getElementById("txtClaveActual").value = "";
        document.getElementById("txtClaveNueva").value  = "";
        setFeedback(msgClave, "Contrasena actualizada correctamente.", true);
    } catch { setFeedback(msgClave, "No se pudo cambiar la contrasena. Verifica la actual."); }
});

// ────────────────────────────────────────────────────────────────────────────
// NAVEGACIÓN
// ────────────────────────────────────────────────────────────────────────────
document.getElementById("btnVolver").addEventListener("click", () => {
    ipcRenderer.send("cambiar-pagina", "cliente.html");
});
document.getElementById("btnCerrarSesion").addEventListener("click", async () => {
    try { await signOut(auth); ipcRenderer.send("cambiar-pagina", "login.html"); }
    catch (e) { console.error(e); }
});