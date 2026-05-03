import { db, auth, collection, onSnapshot, query, orderBy, getDocs, onAuthStateChanged, doc, getDoc, signOut } from "./firebase.js";
import { initOfflineStatus } from "./offline.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

let todasLasVentas = [];
let diccionarioCategorias = {};
const HISTORIAL_VENTAS_CACHE_KEY = 'modaveli_historial_ventas_cache';
const HISTORIAL_CATEGORIAS_CACHE_KEY = 'modaveli_historial_categorias_cache';

const tabla = document.getElementById('tablaHistorialCompleto');
const filtroCat = document.getElementById('cmbFiltroCategoria');
const filtroOri = document.getElementById('cmbFiltroOrigen');

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        ipcRenderer.send('cambiar-pagina', 'login.html');
        return;
    }

    try {
        const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
        const rol = userDoc.exists() ? (userDoc.data().rol || 'cliente') : 'cliente';

        if (rol !== 'vendedor') {
            await signOut(auth);
            ipcRenderer.send('cambiar-pagina', 'login.html');
        }
    } catch {
        await signOut(auth);
        ipcRenderer.send('cambiar-pagina', 'login.html');
    }
});

function guardarCache(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function cargarCache(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

initOfflineStatus((online) => {
    if (!online) {
        diccionarioCategorias = cargarCache(HISTORIAL_CATEGORIAS_CACHE_KEY, {});
        todasLasVentas = cargarCache(HISTORIAL_VENTAS_CACHE_KEY, []);
        renderizarTabla();
    }
});

async function cargarDatos() {
    // Primero, traemos las categorías de los productos
    try {
        const prodSnap = await getDocs(collection(db, "productos"));
        prodSnap.forEach(doc => { diccionarioCategorias[doc.id] = doc.data().categoria || "Otra"; });
        guardarCache(HISTORIAL_CATEGORIAS_CACHE_KEY, diccionarioCategorias);
    } catch {
        diccionarioCategorias = cargarCache(HISTORIAL_CATEGORIAS_CACHE_KEY, {});
    }

    // Segundo, traemos las ventas
    const consulta = query(collection(db, "historial_ventas"), orderBy("fecha", "desc"));
    onSnapshot(
        consulta,
        (snapshot) => {
            todasLasVentas = [];
            snapshot.forEach((doc) => {
                const venta = doc.data();
                todasLasVentas.push({
                    ...venta,
                    fechaMs: venta.fecha ? venta.fecha.toDate().getTime() : null
                });
            });
            guardarCache(HISTORIAL_VENTAS_CACHE_KEY, todasLasVentas);
            renderizarTabla();
        },
        () => {
            todasLasVentas = cargarCache(HISTORIAL_VENTAS_CACHE_KEY, []);
            renderizarTabla();
        }
    );
}

function renderizarTabla() {
    tabla.innerHTML = "";
    const catSel = filtroCat.value;
    const oriSel = filtroOri.value;

    const packsMap = new Map();
    todasLasVentas.forEach((venta, idx) => {
        const key = venta.pedidoId || `LEGACY-${venta.id || idx}`;
        const categoria = diccionarioCategorias[venta.productoId] || "Desconocida";

        const pack = packsMap.get(key) || {
            pedidoId: key,
            origen: venta.origen || "Caja",
            fechaMs: venta.fechaMs || 0,
            items: []
        };

        pack.fechaMs = Math.max(pack.fechaMs || 0, venta.fechaMs || 0);
        pack.items.push({
            nombreProducto: venta.nombreProducto || "Producto",
            categoria,
            cantidad: Number(venta.cantidad) || 0
        });

        packsMap.set(key, pack);
    });

    const packs = [...packsMap.values()].sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));

    packs.forEach((pack) => {
        const origen = pack.origen || "Caja";
        const pasaOri = (oriSel === "todos") || (origen === oriSel);
        const pasaCat =
            (catSel === "todas") ||
            pack.items.some((item) => item.categoria === catSel);

        if (pasaCat && pasaOri) {
            let fechaStr = "Desconocida";
            if (pack.fechaMs) {
                const f = new Date(pack.fechaMs);
                fechaStr = `${f.toLocaleDateString()} - ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            }

            const categoriasUnicas = [...new Set(pack.items.map((item) => item.categoria))].join(", ");
            const detalleItems = pack.items
                .map((item) => `${item.nombreProducto} x${item.cantidad}`)
                .join(" · ");
            const totalPrendas = pack.items.reduce((acc, item) => acc + item.cantidad, 0);
            const badgeClase = origen === 'App' ? 'badge-app' : 'badge-caja';

            tabla.innerHTML += `
                <tr>
                    <td style="color: var(--muted);">${fechaStr}</td>
                    <td style="font-family: 'DM Sans'; color: var(--text);">P-${pack.pedidoId}</td>
                    <td>${categoriasUnicas}</td>
                    <td><span class="badge ${badgeClase}">${origen}</span></td>
                    <td style="color: var(--gold); font-weight: bold;">${totalPrendas}</td>
                    <td style="color: var(--muted); font-size: 0.8rem;">${detalleItems}</td>
                </tr>
            `;
        }
    });

    if (tabla.innerHTML === "") {
        tabla.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--muted);">No hay ventas con estos filtros.</td></tr>`;
    }
}

// Filtros interactivos
filtroCat.addEventListener('change', renderizarTabla);
filtroOri.addEventListener('change', renderizarTabla);

// Botón de regresar
document.getElementById('btnVolver').addEventListener('click', () => {
    ipcRenderer.send('cambiar-pagina', 'ventas.html');
});

// Arrancar
cargarDatos();