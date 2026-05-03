import {
    db,
    auth,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    collection,
    addDoc,
    signOut,
    onAuthStateChanged
} from "./firebase.js";
import { initOfflineStatus, isOnline } from "./offline.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

let usuarioActual = null;
let itemsCarrito  = [];
const CARRITO_CACHE_PREFIX = 'modaveli_carrito_cache_';

function cacheKey(uid) {
    return `${CARRITO_CACHE_PREFIX}${uid}`;
}

function guardarCarritoCache(uid, items) {
    if (!uid) return;
    localStorage.setItem(cacheKey(uid), JSON.stringify(items));
}

function cargarCarritoCache(uid) {
    if (!uid) return [];
    const raw = localStorage.getItem(cacheKey(uid));
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

initOfflineStatus((online) => {
    const btnPagar = document.getElementById('btnPagar');
    if (!btnPagar) return;

    if (!online) {
        btnPagar.disabled = true;
        mostrarMensaje('Sin conexion: acciones de compra desactivadas', 'text-danger');
    } else if (itemsCarrito.length > 0) {
        btnPagar.disabled = false;
        mostrarMensaje('', '');
    }
});

// --- ESPERAR AL USUARIO ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        usuarioActual = user;
        escucharCarrito(user.uid);
        if (!isOnline()) {
            const cache = cargarCarritoCache(user.uid);
            itemsCarrito = cache;
            if (cache.length > 0) {
                renderCarrito(cache);
                mostrarMensaje('Mostrando carrito guardado localmente', 'text-danger');
            } else {
                renderVacio();
            }
        }
    } else {
        ipcRenderer.send('cambiar-pagina', 'login.html');
    }
});

// --- ESCUCHAR CARRITO EN TIEMPO REAL ---
function escucharCarrito(uid) {
    const carritoRef = doc(db, "carritos", uid);
    onSnapshot(
        carritoRef,
        (snap) => {
            if (snap.exists() && snap.data().items?.length > 0) {
                itemsCarrito = snap.data().items;
                guardarCarritoCache(uid, itemsCarrito);
                renderCarrito(itemsCarrito);
            } else {
                itemsCarrito = [];
                guardarCarritoCache(uid, []);
                renderVacio();
            }
        },
        () => {
            const cache = cargarCarritoCache(uid);
            itemsCarrito = cache;
            if (cache.length > 0) {
                renderCarrito(cache);
                mostrarMensaje('Sin conexion: usando carrito guardado', 'text-danger');
            } else {
                renderVacio();
            }
        }
    );
}

// --- RENDERIZAR CARRITO ---
function renderCarrito(items) {
    const lista            = document.getElementById('listaCarrito');
    const subtitulo        = document.getElementById('subtituloCarrito');
    const btnPagar         = document.getElementById('btnPagar');
    const resumenArticulos = document.getElementById('resumenArticulos');
    const resumenTotal     = document.getElementById('resumenTotal');

    const totalUnidades = items.reduce((acc, i) => acc + i.cantidad, 0);
    const totalEuros    = items.reduce((acc, i) => acc + (Number(i.precio) || 0) * i.cantidad, 0);

    subtitulo.textContent = `${items.length} producto${items.length !== 1 ? 's' : ''} · ${totalUnidades} unidad${totalUnidades !== 1 ? 'es' : ''}`;
    resumenArticulos.textContent = items.length;
    resumenTotal.textContent     = `${totalEuros.toFixed(2)} €`;
    btnPagar.disabled = !isOnline();

    lista.innerHTML = '';
    items.forEach((item, idx) => {
        const precio    = Number(item.precio) || 0;
        const subtotal  = (precio * item.cantidad).toFixed(2);
        const precioHtml = precio > 0
            ? `<span class="item-precio">${precio.toFixed(2)} € / ud.</span> <span class="item-subtotal">= ${subtotal} €</span>`
            : '';

        const imgHtml = item.imagenUrl
            ? `<img src="${item.imagenUrl}" class="cart-item-img" alt="${item.nombre}">`
            : `<div class="cart-item-img-placeholder">👗</div>`;

        const div = document.createElement('div');
        div.className = 'cart-item';
        div.innerHTML = `
            ${imgHtml}
            <div class="cart-item-info">
                <div class="cart-item-name">${item.nombre}</div>
                <div class="cart-item-cat">${item.categoria} · Talla ${item.talla || 'Única'}</div>
                <div class="cart-item-precios">${precioHtml}</div>
                <div class="cart-item-qty">
                    <button class="qty-btn btn-menos" data-idx="${idx}">−</button>
                    <span class="qty-num">${item.cantidad}</span>
                    <button class="qty-btn btn-mas" data-idx="${idx}">+</button>
                    <button class="btn-remove" data-idx="${idx}">Eliminar</button>
                </div>
            </div>
        `;
        lista.appendChild(div);
    });
}

// --- RENDERIZAR VACÍO ---
function renderVacio() {
    const lista            = document.getElementById('listaCarrito');
    const subtitulo        = document.getElementById('subtituloCarrito');
    const btnPagar         = document.getElementById('btnPagar');
    const resumenArticulos = document.getElementById('resumenArticulos');
    const resumenTotal     = document.getElementById('resumenTotal');

    subtitulo.textContent        = 'Tu carrito está vacío';
    resumenArticulos.textContent = '0';
    resumenTotal.textContent     = '0.00 €';
    btnPagar.disabled = true;

    lista.innerHTML = `
        <div class="empty-cart">
            <div class="icon">🛒</div>
            <p>No tienes productos en el carrito.</p>
            <button class="btn-seguir" id="btnSeguirComprando">Explorar colección →</button>
        </div>
    `;
    document.getElementById('btnSeguirComprando')?.addEventListener('click', () => {
        ipcRenderer.send('cambiar-pagina', 'cliente.html');
    });
}

// --- ACCIONES EN LA LISTA ---
document.getElementById('listaCarrito').addEventListener('click', async (e) => {
    const btnMas      = e.target.closest('.btn-mas');
    const btnMenos    = e.target.closest('.btn-menos');
    const btnEliminar = e.target.closest('.btn-remove');
    if (!usuarioActual) return;
    if (!isOnline()) {
        mostrarMensaje('Sin conexion: no se puede editar el carrito', 'text-danger');
        return;
    }

    try {
        if (btnMas) {
            const idx = Number.parseInt(btnMas.dataset.idx, 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= itemsCarrito.length) return;
            itemsCarrito[idx].cantidad += 1;
            await guardarCarrito();
            return;
        }

        if (btnMenos) {
            const idx = Number.parseInt(btnMenos.dataset.idx, 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= itemsCarrito.length) return;

            if (itemsCarrito[idx].cantidad > 1) {
                itemsCarrito[idx].cantidad -= 1;
            } else {
                itemsCarrito.splice(idx, 1);
            }
            await guardarCarrito();
            return;
        }

        if (btnEliminar) {
            const idx = Number.parseInt(btnEliminar.dataset.idx, 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= itemsCarrito.length) return;
            itemsCarrito.splice(idx, 1);
            await guardarCarrito();
        }
    } catch (error) {
        console.error('Error actualizando carrito:', error);
        mostrarMensaje('No se pudo actualizar el carrito. Intentalo de nuevo.', 'text-danger');
    }
});

// --- GUARDAR CARRITO ---
async function guardarCarrito() {
    const carritoRef = doc(db, "carritos", usuarioActual.uid);
    if (itemsCarrito.length === 0) {
        await deleteDoc(carritoRef);
    } else {
        await updateDoc(carritoRef, { items: itemsCarrito });
    }
}

// --- CONFIRMAR PEDIDO ---
document.getElementById('btnPagar').addEventListener('click', async () => {
    if (!usuarioActual || itemsCarrito.length === 0) return;
    if (!isOnline()) {
        mostrarMensaje('Sin conexion: no se puede confirmar el pedido', 'text-danger');
        return;
    }

    const btnPagar = document.getElementById('btnPagar');
    const mensaje  = document.getElementById('mensajePago');
    btnPagar.disabled    = true;
    btnPagar.textContent = 'Procesando…';

    try {
        const pedidoId = `APP-${Date.now()}-${usuarioActual.uid.slice(0, 6)}`;
        const userRef = doc(db, "usuarios", usuarioActual.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const nombreCliente = userData.nombre || "Cliente";
        const direccionCliente = userData.direccion || "";
        const correoCliente = usuarioActual.email || userData.email || "";
        const itemsVendidos = [];

        for (const item of itemsCarrito) {
            const prodRef  = doc(db, "productos", item.productoId);
            const prodSnap = await getDoc(prodRef);
            if (!prodSnap.exists()) continue;

            const stockActual   = prodSnap.data().stock;
            const cantVendida   = Math.min(item.cantidad, stockActual);
            const precio        = Number(item.precio) || 0;

            if (cantVendida > 0) {
                await updateDoc(prodRef, { stock: stockActual - cantVendida });
                await addDoc(collection(db, "historial_ventas"), {
                    pedidoId,
                    productoId:     item.productoId,
                    nombreProducto: item.nombre,
                    talla:          item.talla || 'Única',
                    cantidad:       cantVendida,
                    precioUnitario: precio,
                    totalVenta:     precio * cantVendida,
                    usuarioId:      usuarioActual.uid,
                    emailUsuario:   correoCliente,
                    origen:         "App",
                    fecha:          new Date()
                });

                itemsVendidos.push({
                    productoId: item.productoId,
                    nombreProducto: item.nombre,
                    categoria: item.categoria,
                    talla: item.talla || 'Única',
                    cantidad: cantVendida,
                    precioUnitario: precio,
                    totalLinea: precio * cantVendida,
                    imagenUrl: item.imagenUrl || ""
                });
            }
        }

        const totalPedido = itemsVendidos.reduce((acc, item) => acc + item.totalLinea, 0);
        if (itemsVendidos.length > 0) {
            await addDoc(collection(db, "pedidos"), {
                pedidoId,
                usuarioId: usuarioActual.uid,
                emailUsuario: correoCliente,
                nombreCliente,
                direccionCliente,
                items: itemsVendidos,
                total: totalPedido,
                estado: "confirmado",
                origen: "App",
                fecha: new Date()
            });
        }

        // Vaciar carrito
        const carritoRef = doc(db, "carritos", usuarioActual.uid);
        await deleteDoc(carritoRef);

        document.getElementById('successOverlay').classList.add('show');

    } catch (err) {
        console.error("Error al procesar el pedido:", err);
        mensaje.className   = 'text-danger';
        mensaje.textContent = 'Error al procesar el pedido. Intentalo de nuevo.';
        btnPagar.disabled    = false;
        btnPagar.textContent = 'Confirmar pedido →';
    }
});

function mostrarMensaje(texto, clase) {
    const mensaje = document.getElementById('mensajePago');
    if (!mensaje) return;

    mensaje.className = clase;
    mensaje.textContent = texto;
}

// --- OVERLAY ÉXITO ---
document.getElementById('btnSuccessBack').addEventListener('click', () => {
    ipcRenderer.send('cambiar-pagina', 'cliente.html');
});

// --- VOLVER A LA TIENDA ---
document.getElementById('btnVolver').addEventListener('click', () => {
    ipcRenderer.send('cambiar-pagina', 'cliente.html');
});

// --- CERRAR SESIÓN ---
document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
    try {
        await signOut(auth);
        ipcRenderer.send('cambiar-pagina', 'login.html');
    } catch (error) {
        console.error(error);
    }
});