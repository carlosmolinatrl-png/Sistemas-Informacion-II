import {
    auth,
    db,
    onAuthStateChanged,
    signOut,
    doc,
    getDoc,
    collection,
    onSnapshot,
    query,
    orderBy,
    limit
} from "./firebase.js";
import { initOfflineStatus, isOnline } from "./offline.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

// ── Elementos del DOM ────────────────────────────────────────────
const estadoConexion  = document.getElementById("estadoConexion");
const tablaPedidosWeb = document.getElementById("tablaPedidosWeb");
const kpiPedidosHoy   = document.getElementById("kpiPedidosHoy");
const kpiPedidosHoySub= document.getElementById("kpiPedidosHoySub");
const kpiIngresosHoy  = document.getElementById("kpiIngresosHoy");
const kpiTicketMedio  = document.getElementById("kpiTicketMedio");
const kpiClientes     = document.getElementById("kpiClientes");
const kpiCarritos     = document.getElementById("kpiCarritos");
const kpiStockCritico = document.getElementById("kpiStockCritico");

// ── Estado compartido entre listeners ───────────────────────────
// Guardamos los datos de cada colección para poder recalcular KPIs
// cada vez que cualquiera de ellas cambie.
let _pedidos       = [];   // pedidos de la App (web)
let _ventasCaja    = [];   // ventas de la caja (historial_ventas)
let _clientes      = 0;
let _carritosActivos = 0;
let _stockCritico  = 0;

// ── Helpers ──────────────────────────────────────────────────────
function fmtMoney(value) {
    return `${Number(value || 0).toFixed(2)} EUR`;
}

function esDeHoy(fechaMs) {
    if (!fechaMs) return false;
    const hoy = new Date();
    const f   = new Date(fechaMs);
    return (
        f.getFullYear() === hoy.getFullYear() &&
        f.getMonth()    === hoy.getMonth()    &&
        f.getDate()     === hoy.getDate()
    );
}

function horaLegible(fechaMs) {
    if (!fechaMs) return "—";
    return new Date(fechaMs).toLocaleString("es-ES", {
        day:    "2-digit",
        month:  "2-digit",
        year:   "numeric",
        hour:   "2-digit",
        minute: "2-digit"
    });
}

// ── Render tabla pedidos web ─────────────────────────────────────
function renderTablaPedidos(pedidos = []) {
    tablaPedidosWeb.innerHTML = "";

    if (!pedidos.length) {
        tablaPedidosWeb.innerHTML =
            '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:1.5rem;">Sin pedidos web registrados.</td></tr>';
        return;
    }

    pedidos.forEach((pedido) => {
        tablaPedidosWeb.innerHTML += `
            <tr>
                <td>${horaLegible(pedido.fechaMs)}</td>
                <td>${pedido.pedidoId || pedido.id || "—"}</td>
                <td>${pedido.nombreCliente || pedido.emailUsuario || "Cliente"}</td>
                <td><span class="status">${pedido.estado || "confirmado"}</span></td>
                <td class="total">${fmtMoney(pedido.total)}</td>
            </tr>
        `;
    });
}

// ── Recalcular KPIs de pedidos ───────────────────────────────────
function recalcularKpisPedidos() {
    // Pedidos web de hoy
    const pedidosHoy = _pedidos.filter((p) => esDeHoy(p.fechaMs));
    const totalHoy   = pedidosHoy.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
    const ticketMedio = pedidosHoy.length ? totalHoy / pedidosHoy.length : 0;

    kpiPedidosHoy.textContent    = String(pedidosHoy.length);
    kpiPedidosHoySub.textContent = _pedidos.length
        ? `Total registrados: ${_pedidos.length}`
        : "Sin pedidos web recientes";
    kpiIngresosHoy.textContent   = fmtMoney(totalHoy);
    kpiTicketMedio.textContent   = `Ticket medio: ${fmtMoney(ticketMedio)}`;

    // Tabla: los 12 más recientes
    renderTablaPedidos(_pedidos.slice(0, 12));
}

// ── setupMetrics: arranca todos los listeners en tiempo real ─────
function setupMetrics() {

    // 1. Clientes registrados
    onSnapshot(collection(db, "usuarios"), (snapshot) => {
        _clientes = 0;
        snapshot.forEach((u) => {
            if ((u.data().rol || "cliente") === "cliente") _clientes += 1;
        });
        kpiClientes.textContent = String(_clientes);
    }, (err) => console.warn("Error usuarios:", err));

    // 2. Carritos activos
    onSnapshot(collection(db, "carritos"), (snapshot) => {
        _carritosActivos = 0;
        snapshot.forEach((c) => {
            if ((c.data().items || []).length > 0) _carritosActivos += 1;
        });
        kpiCarritos.textContent = `Carritos activos: ${_carritosActivos}`;
    }, (err) => console.warn("Error carritos:", err));

    // 3. Stock crítico
    onSnapshot(collection(db, "productos"), (snapshot) => {
        _stockCritico = 0;
        snapshot.forEach((p) => {
            if ((Number(p.data().stock) || 0) <= 5) _stockCritico += 1;
        });
        kpiStockCritico.textContent = String(_stockCritico);
    }, (err) => console.warn("Error productos:", err));

    // 4. Pedidos web (App) — SIN where+orderBy combinados para evitar
    //    el requisito de índice compuesto en Firestore.
    //    Traemos los últimos 60 y filtramos origen === "App" en cliente.
    const qPedidos = query(
        collection(db, "pedidos"),
        orderBy("fecha", "desc"),
        limit(60)
    );

    onSnapshot(qPedidos, (snapshot) => {
        _pedidos = [];
        snapshot.forEach((p) => {
            const data = p.data();
            // Filtrar solo los de la App web
            if ((data.origen || "") !== "App") return;
            _pedidos.push({
                id:      p.id,
                ...data,
                fechaMs: data.fecha ? data.fecha.toDate().getTime() : null
            });
        });
        // Ya vienen ordenados por fecha desc
        recalcularKpisPedidos();
    }, (err) => {
        console.warn("Error pedidos:", err);
        // Si falla (sin índice), intentamos sin orderBy
        onSnapshot(collection(db, "pedidos"), (snapshot) => {
            _pedidos = [];
            snapshot.forEach((p) => {
                const data = p.data();
                if ((data.origen || "") !== "App") return;
                _pedidos.push({
                    id:      p.id,
                    ...data,
                    fechaMs: data.fecha ? data.fecha.toDate().getTime() : null
                });
            });
            // Ordenar en cliente
            _pedidos.sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
            recalcularKpisPedidos();
        });
    });

    // 5. Ventas de caja (historial_ventas) — tiempo real
    const qVentasCaja = query(
        collection(db, "historial_ventas"),
        orderBy("fecha", "desc"),
        limit(50)
    );

    onSnapshot(qVentasCaja, (snapshot) => {
        _ventasCaja = [];
        snapshot.forEach((v) => {
            const data = v.data();
            _ventasCaja.push({
                id:      v.id,
                ...data,
                fechaMs: data.fecha ? data.fecha.toDate().getTime() : null
            });
        });
        // Las ventas de caja se pueden usar para estadísticas adicionales
        // si en el futuro quieres mostrarlas en el panel
    }, (err) => console.warn("Error historial_ventas:", err));
}

// ── Offline ──────────────────────────────────────────────────────
initOfflineStatus((online) => {
    if (estadoConexion) {
        estadoConexion.textContent = online
            ? "● Conectado — actualizando en tiempo real"
            : "○ Sin conexión — visualización limitada";
        estadoConexion.style.color = online ? "var(--success)" : "var(--muted)";
    }
});

// ── Auth ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        ipcRenderer.send("cambiar-pagina", "login.html");
        return;
    }

    try {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        const rol = userDoc.exists() ? (userDoc.data().rol || "cliente") : "cliente";

        if (rol !== "encargado_web") {
            await signOut(auth);
            ipcRenderer.send("cambiar-pagina", "login.html");
            return;
        }
    } catch (e) {
        console.error("Error comprobando rol:", e);
        await signOut(auth);
        ipcRenderer.send("cambiar-pagina", "login.html");
        return;
    }

    if (estadoConexion) {
        estadoConexion.textContent = isOnline()
            ? "● Conectado — actualizando en tiempo real"
            : "○ Sin conexión — visualización limitada";
        estadoConexion.style.color = isOnline() ? "var(--success)" : "var(--muted)";
    }

    setupMetrics();
});

// ── Cerrar sesión ────────────────────────────────────────────────
document.getElementById("btnCerrarSesion")?.addEventListener("click", async () => {
    await signOut(auth);
    ipcRenderer.send("cambiar-pagina", "login.html");
});