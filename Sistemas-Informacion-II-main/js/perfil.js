import {
    auth,
    db,
    onAuthStateChanged,
    signOut,
    doc,
    getDoc,
    setDoc,
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
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

const lblNombre = document.getElementById("lblNombre");
const lblDireccion = document.getElementById("lblDireccion");
const lblCorreo = document.getElementById("lblCorreo");
const txtNombre = document.getElementById("txtNombre");
const txtDireccion = document.getElementById("txtDireccion");
const msgPerfil = document.getElementById("msgPerfil");
const msgCorreo = document.getElementById("msgCorreo");
const msgClave = document.getElementById("msgClave");
const listaPedidos = document.getElementById("listaPedidos");

let usuarioActual = null;
const PEDIDOS_CACHE_PREFIX = "modaveli_pedidos_cache_";

function cachePedidosKey(uid) {
    return `${PEDIDOS_CACHE_PREFIX}${uid}`;
}

function setFeedback(el, text, ok = false) {
    if (!el) return;
    el.className = `feedback ${ok ? "ok" : "error"}`;
    el.textContent = text;
}

function formatDate(fechaMs) {
    if (!fechaMs) return "Fecha desconocida";
    const fecha = new Date(fechaMs);
    return `${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function renderPedidos(pedidos = []) {
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
        listaPedidos.innerHTML = '<div class="empty">Aun no tienes pedidos registrados.</div>';
        return;
    }

    const pedidosOrdenados = [...pedidos].sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
    listaPedidos.innerHTML = "";

    pedidosOrdenados.forEach((pedido) => {
        const card = document.createElement("article");
        card.className = "order-card";

        const items = Array.isArray(pedido.items) ? pedido.items : [];
        const total = Number(pedido.total) || items.reduce((acc, i) => acc + (Number(i.totalLinea) || 0), 0);
        const itemsHtml = items.length
            ? items
                .map((item) => {
                    const qty = Number(item.cantidad) || 0;
                    const linea = Number(item.totalLinea) || (Number(item.precioUnitario) || 0) * qty;
                    return `
                        <div class="order-item">
                            <span>${item.nombreProducto || "Producto"}</span>
                            <span>x${qty}</span>
                            <span>${linea.toFixed(2)} EUR</span>
                        </div>
                    `;
                })
                .join("")
            : '<div class="order-item"><span>Sin detalle de lineas</span><span></span><span></span></div>';

        card.innerHTML = `
            <div class="order-head">
                <div>
                    <div class="order-id">Pedido: ${pedido.id || "-"}</div>
                    <div class="order-date">${formatDate(pedido.fechaMs)}</div>
                </div>
                <div class="order-total">${total.toFixed(2)} EUR</div>
            </div>
            ${itemsHtml}
        `;

        listaPedidos.appendChild(card);
    });
}

function savePedidosCache(uid, pedidos) {
    localStorage.setItem(cachePedidosKey(uid), JSON.stringify(pedidos));
}

function loadPedidosCache(uid) {
    const raw = localStorage.getItem(cachePedidosKey(uid));
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function mapPedido(docSnap) {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        ...data,
        fechaMs: data.fecha ? data.fecha.toDate().getTime() : null
    };
}

async function loadPerfil(uid, emailAuth) {
    const ref = doc(db, "usuarios", uid);
    const snap = await getDoc(ref);

    const data = snap.exists() ? snap.data() : {};
    const nombre = data.nombre || "Sin nombre";
    const direccion = data.direccion || "Sin direccion";
    const correo = emailAuth || data.email || "Sin correo";

    lblNombre.textContent = nombre;
    lblDireccion.textContent = direccion;
    lblCorreo.textContent = correo;

    txtNombre.value = data.nombre || "";
    txtDireccion.value = data.direccion || "";
}

function listenPedidos(uid) {
    const pedidosQuery = query(collection(db, "pedidos"), where("usuarioId", "==", uid));
    onSnapshot(
        pedidosQuery,
        (snapshot) => {
            const pedidos = [];
            snapshot.forEach((docSnap) => {
                pedidos.push(mapPedido(docSnap));
            });
            savePedidosCache(uid, pedidos);
            renderPedidos(pedidos);
        },
        () => {
            renderPedidos(loadPedidosCache(uid));
        }
    );
}

initOfflineStatus((online) => {
    if (!online && usuarioActual) {
        renderPedidos(loadPedidosCache(usuarioActual.uid));
    }
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        ipcRenderer.send("cambiar-pagina", "login.html");
        return;
    }

    usuarioActual = user;

    try {
        await loadPerfil(user.uid, user.email || "");
    } catch (error) {
        console.error("Error al cargar perfil:", error);
        setFeedback(msgPerfil, "No se pudo cargar el perfil.");
    }

    if (!isOnline()) {
        renderPedidos(loadPedidosCache(user.uid));
    }

    listenPedidos(user.uid);
});

document.getElementById("btnGuardarPerfil").addEventListener("click", async () => {
    if (!usuarioActual) return;
    if (!isOnline()) {
        setFeedback(msgPerfil, "Sin conexion: no se pueden guardar cambios.");
        return;
    }

    const nombre = txtNombre.value.trim();
    const direccion = txtDireccion.value.trim();

    if (!nombre || !direccion) {
        setFeedback(msgPerfil, "Nombre y direccion son obligatorios.");
        return;
    }

    try {
        await setDoc(
            doc(db, "usuarios", usuarioActual.uid),
            {
                nombre,
                direccion,
                email: usuarioActual.email || "",
                rol: "cliente"
            },
            { merge: true }
        );

        lblNombre.textContent = nombre;
        lblDireccion.textContent = direccion;
        setFeedback(msgPerfil, "Datos guardados correctamente.", true);
    } catch (error) {
        console.error("Error guardando perfil:", error);
        setFeedback(msgPerfil, "No se pudieron guardar los datos.");
    }
});

document.getElementById("btnCambiarCorreo").addEventListener("click", async () => {
    if (!usuarioActual) return;
    if (!isOnline()) {
        setFeedback(msgCorreo, "Sin conexion: no se puede cambiar el correo.");
        return;
    }

    const nuevoCorreo = document.getElementById("txtNuevoCorreo").value.trim();
    const claveActual = document.getElementById("txtClaveCorreo").value;

    if (!nuevoCorreo || !claveActual) {
        setFeedback(msgCorreo, "Nuevo correo y contrasena actual son obligatorios.");
        return;
    }

    try {
        await updateCurrentUserEmail(nuevoCorreo, claveActual);
        await setDoc(doc(db, "usuarios", usuarioActual.uid), { email: nuevoCorreo }, { merge: true });
        lblCorreo.textContent = nuevoCorreo;
        document.getElementById("txtNuevoCorreo").value = "";
        document.getElementById("txtClaveCorreo").value = "";
        setFeedback(msgCorreo, "Correo actualizado correctamente.", true);
    } catch (error) {
        console.error("Error al cambiar correo:", error);
        setFeedback(msgCorreo, "No se pudo cambiar el correo. Verifica la contrasena.");
    }
});

document.getElementById("btnCambiarClave").addEventListener("click", async () => {
    if (!usuarioActual) return;
    if (!isOnline()) {
        setFeedback(msgClave, "Sin conexion: no se puede cambiar la contrasena.");
        return;
    }

    const claveActual = document.getElementById("txtClaveActual").value;
    const claveNueva = document.getElementById("txtClaveNueva").value;

    if (!claveActual || !claveNueva) {
        setFeedback(msgClave, "Completa ambos campos de contrasena.");
        return;
    }

    if (claveNueva.length < 6) {
        setFeedback(msgClave, "La nueva contrasena debe tener minimo 6 caracteres.");
        return;
    }

    try {
        await updateCurrentUserPassword(claveActual, claveNueva);
        document.getElementById("txtClaveActual").value = "";
        document.getElementById("txtClaveNueva").value = "";
        setFeedback(msgClave, "Contrasena actualizada correctamente.", true);
    } catch (error) {
        console.error("Error al cambiar contrasena:", error);
        setFeedback(msgClave, "No se pudo cambiar la contrasena. Verifica la actual.");
    }
});

document.getElementById("btnVolver").addEventListener("click", () => {
    ipcRenderer.send("cambiar-pagina", "cliente.html");
});

document.getElementById("btnCerrarSesion").addEventListener("click", async () => {
    try {
        await signOut(auth);
        ipcRenderer.send("cambiar-pagina", "login.html");
    } catch (error) {
        console.error("Error al cerrar sesion:", error);
    }
});
