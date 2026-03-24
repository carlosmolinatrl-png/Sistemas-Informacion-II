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
const ULTIMAS_CACHE_KEY = 'modaveli_ventas_ultimas_cache';

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

function renderStock(productos = []) {
    const tabla = document.getElementById('tablaVentas');
    const combo = document.getElementById('cmbProductoVenta');

    tabla.innerHTML = "";
    const seleccionPrevia = combo.value;
    combo.innerHTML = "<option disabled selected>Elige producto...</option>";

    productos.forEach((dato) => {
        const precio = dato.precio != null ? `${Number(dato.precio).toFixed(2)} €` : '—';
        const talla = dato.talla || 'Única';

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
}

function renderUltimasVentas(ventas = []) {
    const tablaHistorial = document.getElementById('tablaHistorial');
    tablaHistorial.innerHTML = "";

    const packsMap = new Map();
    ventas.forEach((venta, idx) => {
        const key = venta.pedidoId || `LEGACY-${venta.id || idx}`;
        const pack = packsMap.get(key) || {
            pedidoId: key,
            fechaMs: venta.fechaMs || 0,
            origen: venta.origen || "Caja",
            items: []
        };

        pack.fechaMs = Math.max(pack.fechaMs || 0, venta.fechaMs || 0);
        pack.items.push({
            nombreProducto: venta.nombreProducto || "Producto",
            cantidad: Number(venta.cantidad) || 0
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
        const detalle = pack.items
            .map((item) => `${item.nombreProducto} x${item.cantidad}`)
            .join(" · ");

        tablaHistorial.innerHTML += `
            <tr>
                <td class="td-hora">${hora}</td>
                <td>P-${pack.pedidoId}</td>
                <td><strong class="td-qty">${prendasTotales}</strong><br><small style="color: var(--muted);">${detalle}</small></td>
            </tr>
        `;
    });
}

initOfflineStatus((online) => {
    const btnVender = document.getElementById('btnVender');
    if (btnVender) {
        btnVender.disabled = !online;
    }
    if (!online) {
        renderStock(cargarCache(PRODUCTOS_CACHE_KEY));
        renderUltimasVentas(cargarCache(ULTIMAS_CACHE_KEY));
    }
});

// --- 1. CARGAR STOCK ---
renderStock(cargarCache(PRODUCTOS_CACHE_KEY));

onSnapshot(
    collection(db, "productos"),
    (snapshot) => {
        const productos = [];
        snapshot.forEach((docSnap) => {
            productos.push({ id: docSnap.id, ...docSnap.data() });
        });
        guardarCache(PRODUCTOS_CACHE_KEY, productos);
        renderStock(productos);
    },
    () => {
        renderStock(cargarCache(PRODUCTOS_CACHE_KEY));
    }
);

// --- 2. CARGAR ÚLTIMAS 5 VENTAS ---
const consultaHistorial = query(collection(db, "historial_ventas"), orderBy("fecha", "desc"), limit(60));

renderUltimasVentas(cargarCache(ULTIMAS_CACHE_KEY));

onSnapshot(
    consultaHistorial,
    (snapshot) => {
        const ventas = [];
        snapshot.forEach((documento) => {
            const venta = documento.data();
            ventas.push({
                id: documento.id,
                ...venta,
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

// --- 3. PROCESAR VENTA ---
document.getElementById('btnVender').addEventListener('click', async () => {
    if (!isOnline()) {
        const msj = document.getElementById('mensajeVenta');
        msj.className = "msg-error";
        msj.innerText = "✗ Sin conexion.";
        return;
    }

    const combo   = document.getElementById('cmbProductoVenta');
    const idProd  = combo.value;
    const cant    = Number(document.getElementById('txtCantidadVenta').value);
    const msj     = document.getElementById('mensajeVenta');

    if (!idProd || idProd.startsWith("Elige")) { msj.className = "msg-error"; msj.innerText = "✗ Selecciona producto."; return; }
    if (cant <= 0) { msj.className = "msg-error"; msj.innerText = "✗ Cantidad inválida."; return; }

    try {
        const prodRef   = doc(db, "productos", idProd);
        const snap      = await getDoc(prodRef);
        const stockActual  = snap.data().stock;
        const nombreProd   = combo.options[combo.selectedIndex].getAttribute('data-nombre');
        const precioProd   = Number(combo.options[combo.selectedIndex].getAttribute('data-precio')) || 0;
        const tallaProd    = combo.options[combo.selectedIndex].getAttribute('data-talla') || 'Única';

        if (stockActual >= cant) {
            const pedidoId = `CAJA-${Date.now()}-${idProd.slice(0, 4)}`;
            await updateDoc(prodRef, { stock: stockActual - cant });
            await addDoc(collection(db, "historial_ventas"), {
                pedidoId,
                productoId:     idProd,
                nombreProducto: nombreProd,
                talla:          tallaProd,
                cantidad:       cant,
                precioUnitario: precioProd,
                totalVenta:     precioProd * cant,
                origen:         "Caja",
                fecha:          new Date()
            });

            msj.className = "msg-success";
            msj.innerText = `✓ Venta de ${nombreProd} — ${(precioProd * cant).toFixed(2)} €`;
            document.getElementById('txtCantidadVenta').value = 1;
            setTimeout(() => { msj.innerText = ""; }, 3000);
        } else {
            msj.className = "msg-error";
            msj.innerText = `✗ Stock insuficiente (${stockActual}).`;
        }
    } catch (e) {
        msj.className = "msg-error";
        msj.innerText = "✗ Error de conexión.";
    }
});

// --- 4. VER HISTORIAL (BOTÓN) ---
document.getElementById('btnVerHistorial').addEventListener('click', () => {
    ipcRenderer.send('cambiar-pagina', 'historial.html');
});

// --- 5. CERRAR SESIÓN ---
document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
    await signOut(auth);
    ipcRenderer.send('cambiar-pagina', 'login.html');
});