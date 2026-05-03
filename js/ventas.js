import { db, auth, collection, onSnapshot, doc, updateDoc, getDoc, addDoc, query, orderBy, limit, signOut, onAuthStateChanged } from "./firebase.js";
import { initOfflineStatus, isOnline } from "./offline.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

const PRODUCTOS_CACHE_KEY = 'modaveli_ventas_productos_cache';
const ULTIMAS_CACHE_KEY   = 'modaveli_ventas_ultimas_cache';

let todosLosProductos = [];   // ← almacena todos los productos para filtrar

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

function cargarCache(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// ── RENDER STOCK (tabla + combo) ─────────────────────────────────
function renderStock(productos = []) {
    const tabla = document.getElementById('tablaVentas');
    const combo = document.getElementById('cmbProductoVenta');

    tabla.innerHTML = "";
    const seleccionPrevia = combo.value;
    combo.innerHTML = "<option disabled selected>Elige producto...</option>";

    productos.forEach((dato) => {
        const precio = dato.precio != null ? `${Number(dato.precio).toFixed(2)} €` : '—';
        const talla  = dato.talla || 'Única';

        if (dato.stock > 0) {
            const opt = document.createElement('option');
            opt.value = dato.id;
            opt.setAttribute('data-nombre', dato.nombre);
            opt.setAttribute('data-precio', dato.precio ?? 0);
            opt.setAttribute('data-talla', talla);
            opt.text = `${dato.nombre} · Talla ${talla} (${dato.stock} uds.) — ${precio}`;
            combo.appendChild(opt);
        }

        tabla.innerHTML += `
            <tr>
                <td>
                    <span class="td-name">${dato.nombre}</span>
                    <span class="td-cat">${dato.categoria}</span>
                </td>
                <td>${talla}</td>
                <td><strong class="${dato.stock < 5 ? 'status-low' : 'status-ok'}">${dato.stock}</strong></td>
                <td><span class="td-precio">${precio}</span></td>
            </tr>
        `;
    });

    if (seleccionPrevia) combo.value = seleccionPrevia;

    // Actualizar contador
    const contador = document.getElementById('contadorInventario');
    if (contador) contador.textContent = `${productos.length} artículo${productos.length !== 1 ? 's' : ''}`;
}

// ── FILTROS ──────────────────────────────────────────────────────
function aplicarFiltrosVentas() {
    const cat    = document.getElementById('filtroCatV')?.value    || '';
    const talla  = document.getElementById('filtroTallaV')?.value  || '';
    const stock  = document.getElementById('filtroStockV')?.value  || '';
    const buscar = (document.getElementById('filtroBuscarV')?.value || '').toLowerCase().trim();

    const resultado = todosLosProductos.filter((p) => {
        if (cat && p.categoria !== cat) return false;

        if (talla) {
            const tallasP = Array.isArray(p.tallasDisponibles) && p.tallasDisponibles.length > 0
                ? p.tallasDisponibles
                : [p.talla || ''];
            if (!tallasP.includes(talla)) return false;
        }

        if (buscar && !(p.nombre || '').toLowerCase().includes(buscar)) return false;

        const s = Number(p.stock) || 0;
        if (stock === 'con'     && s <= 0)            return false;
        if (stock === 'sin'     && s > 0)              return false;
        if (stock === 'critico' && (s > 5 || s <= 0)) return false;

        return true;
    });

    renderStock(resultado);
}

['filtroCatV', 'filtroTallaV', 'filtroStockV'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', aplicarFiltrosVentas);
});
document.getElementById('filtroBuscarV')?.addEventListener('input', aplicarFiltrosVentas);
document.getElementById('btnLimpiarFiltrosV')?.addEventListener('click', () => {
    ['filtroCatV', 'filtroTallaV', 'filtroStockV'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const b = document.getElementById('filtroBuscarV');
    if (b) b.value = '';
    aplicarFiltrosVentas();
});

// ── RENDER ÚLTIMAS VENTAS ─────────────────────────────────────────
function renderUltimasVentas(ventas = []) {
    const tablaHistorial = document.getElementById('tablaHistorial');
    tablaHistorial.innerHTML = "";

    const packsMap = new Map();
    ventas.forEach((venta, idx) => {
        const key  = venta.pedidoId || `LEGACY-${venta.id || idx}`;
        const pack = packsMap.get(key) || {
            pedidoId: key,
            fechaMs:  venta.fechaMs || 0,
            origen:   venta.origen  || "Caja",
            items:    []
        };
        pack.fechaMs = Math.max(pack.fechaMs || 0, venta.fechaMs || 0);
        pack.items.push({
            nombreProducto: venta.nombreProducto || "Producto",
            cantidad:       Number(venta.cantidad) || 0
        });
        packsMap.set(key, pack);
    });

    const ultimosPacks = [...packsMap.values()]
        .sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0))
        .slice(0, 5);

    ultimosPacks.forEach((pack) => {
        const hora = pack.fechaMs
            ? new Date(pack.fechaMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : "??:??";
        const prendasTotales = pack.items.reduce((acc, item) => acc + item.cantidad, 0);
        const detalle = pack.items.map((item) => `${item.nombreProducto} x${item.cantidad}`).join(" · ");

        tablaHistorial.innerHTML += `
            <tr>
                <td class="td-hora">${hora}</td>
                <td>P-${pack.pedidoId}</td>
                <td><strong class="td-qty">${prendasTotales}</strong><br><small style="color: var(--muted);">${detalle}</small></td>
            </tr>
        `;
    });
}

// ── OFFLINE ──────────────────────────────────────────────────────
initOfflineStatus((online) => {
    const btnVender = document.getElementById('btnVender');
    if (btnVender) btnVender.disabled = !online;
    if (!online) {
        todosLosProductos = cargarCache(PRODUCTOS_CACHE_KEY);
        aplicarFiltrosVentas();
        renderUltimasVentas(cargarCache(ULTIMAS_CACHE_KEY));
    }
});

// ── 1. LEER PRODUCTOS ────────────────────────────────────────────
todosLosProductos = cargarCache(PRODUCTOS_CACHE_KEY);
aplicarFiltrosVentas();

onSnapshot(
    collection(db, "productos"),
    (snapshot) => {
        todosLosProductos = [];
        snapshot.forEach((documento) => {
            todosLosProductos.push({ id: documento.id, ...documento.data() });
        });
        guardarCache(PRODUCTOS_CACHE_KEY, todosLosProductos);
        aplicarFiltrosVentas();
    },
    () => {
        todosLosProductos = cargarCache(PRODUCTOS_CACHE_KEY);
        aplicarFiltrosVentas();
    }
);

// ── 2. LEER ÚLTIMAS VENTAS ───────────────────────────────────────
onSnapshot(
    query(collection(db, "historial_ventas"), orderBy("fecha", "desc"), limit(30)),
    (snapshot) => {
        const ventas = [];
        snapshot.forEach((documento) => {
            const venta = documento.data();
            ventas.push({
                ...venta,
                id:      documento.id,
                fechaMs: venta.fecha ? venta.fecha.toDate().getTime() : null
            });
        });
        guardarCache(ULTIMAS_CACHE_KEY, ventas);
        renderUltimasVentas(ventas);
    },
    () => {
        renderUltimasVentas(cargarCache(ULTIMAS_CACHE_KEY));
    }
);

// ── 3. CONFIRMAR VENTA ───────────────────────────────────────────
document.getElementById('btnVender')?.addEventListener('click', async () => {
    if (!isOnline()) {
        mostrarMensaje("Sin conexion: no se puede procesar la venta.", "error");
        return;
    }

    const combo    = document.getElementById('cmbProductoVenta');
    const cantidad = parseInt(document.getElementById('txtCantidadVenta').value, 10);
    const productoId = combo.value;

    if (!productoId || productoId === '') {
        mostrarMensaje("Selecciona un producto.", "error");
        return;
    }
    if (!cantidad || cantidad < 1) {
        mostrarMensaje("Cantidad invalida.", "error");
        return;
    }

    const opt = combo.selectedOptions[0];
    const nombreProducto = opt?.getAttribute('data-nombre') || 'Producto';
    const precio         = parseFloat(opt?.getAttribute('data-precio') || '0');
    const talla          = opt?.getAttribute('data-talla') || 'Única';

    try {
        const prodRef  = doc(db, "productos", productoId);
        const prodSnap = await getDoc(prodRef);
        if (!prodSnap.exists()) { mostrarMensaje("Producto no encontrado.", "error"); return; }

        const stockActual = Number(prodSnap.data().stock) || 0;
        if (cantidad > stockActual) {
            mostrarMensaje(`Stock insuficiente. Solo quedan ${stockActual} unidades.`, "error");
            return;
        }

        const pedidoId = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

        await updateDoc(prodRef, { stock: stockActual - cantidad });
        await addDoc(collection(db, "historial_ventas"), {
            productoId,
            nombreProducto,
            talla,
            cantidad,
            precio,
            total:   precio * cantidad,
            pedidoId,
            origen:  "Caja",
            fecha:   new Date()
        });

        mostrarMensaje(`✓ Venta registrada: ${nombreProducto} x${cantidad}`, "success");
        document.getElementById('txtCantidadVenta').value = 1;

    } catch (e) {
        mostrarMensaje("Error al registrar la venta: " + e.message, "error");
    }
});

function mostrarMensaje(texto, tipo) {
    const el = document.getElementById('mensajeVenta');
    if (!el) return;
    el.textContent = texto;
    el.className = tipo === 'success' ? 'msg-success' : 'msg-error';
    setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
}

// ── VER HISTORIAL ────────────────────────────────────────────────
document.getElementById('btnVerHistorial')?.addEventListener('click', () => {
    ipcRenderer.send('cambiar-pagina', 'historial.html');
});

// ── CERRAR SESIÓN ────────────────────────────────────────────────
document.getElementById('btnCerrarSesion')?.addEventListener('click', async () => {
    await signOut(auth);
    ipcRenderer.send('cambiar-pagina', 'login.html');
});