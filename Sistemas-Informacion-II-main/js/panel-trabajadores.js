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
    where,
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

const estadoConexion = document.getElementById("estadoConexion");
const tablaPedidosWeb = document.getElementById("tablaPedidosWeb");

const kpiPedidosHoy = document.getElementById("kpiPedidosHoy");
const kpiPedidosHoySub = document.getElementById("kpiPedidosHoySub");
const kpiIngresosHoy = document.getElementById("kpiIngresosHoy");
const kpiTicketMedio = document.getElementById("kpiTicketMedio");
const kpiClientes = document.getElementById("kpiClientes");
const kpiCarritos = document.getElementById("kpiCarritos");
const kpiStockCritico = document.getElementById("kpiStockCritico");

function fmtMoney(value) {
    return `${Number(value || 0).toFixed(2)} EUR`;
}

function esDeHoy(fechaMs) {
    if (!fechaMs) return false;
    const hoy = new Date();
    const f = new Date(fechaMs);
    return (
        f.getFullYear() === hoy.getFullYear() &&
        f.getMonth() === hoy.getMonth() &&
        f.getDate() === hoy.getDate()
    );
}

function renderTablaPedidos(pedidos = []) {
    tablaPedidosWeb.innerHTML = "";

    if (!pedidos.length) {
        tablaPedidosWeb.innerHTML = '<tr><td colspan="5" style="color: var(--muted); text-align:center;">Sin pedidos web registrados.</td></tr>';
        return;
    }

    pedidos.forEach((pedido) => {
        const fecha = pedido.fechaMs
            ? new Date(pedido.fechaMs).toLocaleString()
            : "Fecha desconocida";

        tablaPedidosWeb.innerHTML += `
            <tr>
                <td>${fecha}</td>
                <td>${pedido.pedidoId || pedido.id || "-"}</td>
                <td>${pedido.nombreCliente || pedido.emailUsuario || "Cliente"}</td>
                <td><span class="status">${pedido.estado || "confirmado"}</span></td>
                <td class="total">${fmtMoney(pedido.total)}</td>
            </tr>
        `;
    });
}

function setupMetrics() {
    onSnapshot(collection(db, "usuarios"), (snapshot) => {
        let clientes = 0;
        snapshot.forEach((u) => {
            const data = u.data();
            if ((data.rol || "cliente") === "cliente") clientes += 1;
        });
        kpiClientes.textContent = String(clientes);
    });

    onSnapshot(collection(db, "carritos"), (snapshot) => {
        let activos = 0;
        snapshot.forEach((c) => {
            const items = c.data().items || [];
            if (items.length > 0) activos += 1;
        });
        kpiCarritos.textContent = `Carritos activos: ${activos}`;
    });

    onSnapshot(collection(db, "productos"), (snapshot) => {
        let criticos = 0;
        snapshot.forEach((p) => {
            const stock = Number(p.data().stock) || 0;
            if (stock <= 5) criticos += 1;
        });
        kpiStockCritico.textContent = String(criticos);
    });

    const qPedidosWeb = query(
        collection(db, "pedidos"),
        where("origen", "==", "App"),
        orderBy("fecha", "desc"),
        limit(40)
    );

    onSnapshot(qPedidosWeb, (snapshot) => {
        const pedidos = [];
        snapshot.forEach((p) => {
            const data = p.data();
            pedidos.push({
                id: p.id,
                ...data,
                fechaMs: data.fecha ? data.fecha.toDate().getTime() : null
            });
        });

        renderTablaPedidos(pedidos.slice(0, 12));

        const pedidosHoy = pedidos.filter((p) => esDeHoy(p.fechaMs));
        const totalHoy = pedidosHoy.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
        const ticketMedio = pedidosHoy.length ? totalHoy / pedidosHoy.length : 0;

        kpiPedidosHoy.textContent = String(pedidosHoy.length);
        kpiPedidosHoySub.textContent = pedidos.length
            ? `Total pedidos web registrados: ${pedidos.length}`
            : "Sin pedidos web en el historial reciente";
        kpiIngresosHoy.textContent = fmtMoney(totalHoy);
        kpiTicketMedio.textContent = `Ticket medio: ${fmtMoney(ticketMedio)}`;
    });
}

initOfflineStatus((online) => {
    estadoConexion.textContent = online
        ? "Estado: conectado en tiempo real"
        : "Estado: sin conexion (visualizacion limitada)";
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        ipcRenderer.send("cambiar-pagina", "login.html");
        return;
    }

    const userDoc = await getDoc(doc(db, "usuarios", user.uid));
    const rol = userDoc.exists() ? (userDoc.data().rol || "cliente") : "cliente";

    if (rol !== "encargado_web") {
        await signOut(auth);
        ipcRenderer.send("cambiar-pagina", "login.html");
        return;
    }

    setupMetrics();
});

document.getElementById("btnCerrarSesion").addEventListener("click", async () => {
    await signOut(auth);
    ipcRenderer.send("cambiar-pagina", "login.html");
});

if (!isOnline()) {
    estadoConexion.textContent = "Estado: sin conexion (visualizacion limitada)";
}