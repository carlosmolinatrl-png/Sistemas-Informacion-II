import { auth, db, onAuthStateChanged, signOut, doc, getDoc, collection, onSnapshot, setDoc, updateDoc } from "./firebase.js";
import { initOfflineStatus, isOnline } from "./offline.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };
const esAppEscritorio = typeof window !== 'undefined' && typeof window.require === 'function';

// Variables globales
const authContainer = document.getElementById('authContainer');
const btnCarrito = document.getElementById('btnCarrito');
const btnPerfil = document.getElementById('btnPerfil');
const catalogo = document.getElementById('catalogoProductos');
const btnOpenFilters = document.getElementById('btnOpenFilters');
const filterSidebar = document.getElementById('filterSidebar');
const modoRolTag = document.getElementById('modoRolTag');
const supervisorPanel = document.getElementById('supervisorPanel');
const supervisorFilters = document.getElementById('supervisorFilters');
const chkCatAll = document.getElementById('chkCatAll');
const chkCategorias = [...document.querySelectorAll('.chk-cat')];
const sizeChipGrid = document.getElementById('sizeChipGrid');
const chkSoloDisponible = document.getElementById('chkSoloDisponible');
const resultCount = document.getElementById('resultCount');
const btnClearFilters = document.getElementById('btnClearFilters');
const kpiPedidosHoy = document.getElementById('kpiPedidosHoy');
const kpiIngresosHoy = document.getElementById('kpiIngresosHoy');
const kpiTicketMedio = document.getElementById('kpiTicketMedio');
const kpiCarritosActivos = document.getElementById('kpiCarritosActivos');
const supAlertList = document.getElementById('supAlertList');
const supTopVentasList = document.getElementById('supTopVentasList');
const supRiesgoList = document.getElementById('supRiesgoList');
const supReservasList = document.getElementById('supReservasList');
const supLastUpdate = document.getElementById('supLastUpdate');
const CATALOGO_CACHE_KEY = 'modaveli_catalogo_cache';
let usuarioActual = null; 
let modoEncargadoWeb = false;
let productosActuales = [];
let filtroSupervisor = 'todos';
let filtroCategorias = new Set();
let filtroTallas = new Set();
let filtroSoloDisponible = false;
let carritosActivos = 0;
let pedidosHoy = 0;
let ingresosHoy = 0;
let ticketMedioHoy = 0;
let reservadoPorProducto = new Map();
let ventas24hPorProducto = new Map();
let listeningSupervisorData = false;

function normalizarTalla(valor = '') {
    const limpia = String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    return limpia || 'Unica';
}

function normalizarTexto(valor = '') {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function esCategoriaCalzado(categoria = '') {
    const c = normalizarTexto(categoria);
    return c === 'zapatos' || c === 'zapatillas' || c === 'calzado';
}

function categoriasActivas() {
    if (filtroCategorias.size === 0) {
        return ['Camisetas', 'Pantalones', 'Sudaderas', 'Zapatos'];
    }
    return [...filtroCategorias];
}

function actualizarChipsTalla() {
    if (!sizeChipGrid) return;

    const categorias = categoriasActivas();
    const incluyeCalzado = categorias.some((c) => esCategoriaCalzado(c));
    const incluyeTextil = categorias.some((c) => !esCategoriaCalzado(c));

    let tallas = [];
    if (incluyeTextil) {
        tallas.push('XS', 'S', 'M', 'L', 'XL', 'XXL');
    }
    if (incluyeCalzado) {
        tallas = tallas.concat(['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46']);
    }

    tallas = [...new Set(tallas)];
    filtroTallas = new Set([...filtroTallas].filter((t) => tallas.includes(t)));

    sizeChipGrid.innerHTML = tallas.map((t) => `
        <button type="button" class="size-chip ${filtroTallas.has(t) ? 'active' : ''}" data-size="${t}">${t}</button>
    `).join('');
}

initOfflineStatus((online) => {
    if (!online) {
        mostrarToast("Sin conexion: usando datos guardados");
        renderCatalogoDesdeCache();
    } else {
        mostrarToast("Conexion restablecida");
    }
});

function renderCatalogo(productos = []) {
    if (!catalogo) return;
    catalogo.innerHTML = "";

    const productosFiltrados = filtrarPorDisponibilidad(filtrarPorTalla(filtrarPorCategoria(filtrarProductosSupervisor(productos))));

    const tarjetasHtml = productosFiltrados.map((producto) => {
        const dato = producto;
        const id = producto.id;
        const stockNum = Number(dato.stock) || 0;
        const talla = normalizarTalla(dato.talla);
        const reservado = reservadoPorProducto.get(id) || 0;
        const ventas24h = ventas24hPorProducto.get(id) || 0;
        const cobertura = ventas24h > 0 ? (stockNum / ventas24h).toFixed(1) : 'sin demanda';

        let badgeStock = '';
        if (modoEncargadoWeb) {
            if (stockNum > 5) {
                badgeStock = `<span class="badge bg-success">Stock exacto: ${stockNum}</span>`;
            } else if (stockNum > 0) {
                badgeStock = `<span class="badge bg-warning text-dark">Stock exacto: ${stockNum}</span>`;
            } else {
                badgeStock = `<span class="badge bg-danger">Stock exacto: 0</span>`;
            }
        } else {
            badgeStock = stockNum > 0
                ? `<span class="badge bg-success">Stock: Disponible</span>`
                : `<span class="badge bg-danger">Stock: No disponible</span>`;
        }

        const metaEncargado = modoEncargadoWeb
            ? `<div class="meta-encargado">
                    <div>Reservado en carritos: <strong>${reservado}</strong></div>
                    <div>Ventas ultimas 24h: <strong>${ventas24h}</strong></div>
                    <div>Cobertura estimada: <strong>${cobertura} dia(s)</strong></div>
               </div>`
            : '';

        const urlImagen = dato.imagenUrl || '../assets/placeholder-product.svg';
        const precioText = dato.precio != null ? `${Number(dato.precio).toFixed(2)} EUR` : '0.00 EUR';

        return `
            <div class="col-md-4 col-sm-6">
                <div class="card h-100 shadow border-0 overflow-hidden">
                    <img src="${urlImagen}" class="card-img-top" alt="${dato.nombre}">
                    <div class="card-body">
                        <h5 class="card-title fw-bold">${dato.nombre}</h5>
                        <h6 class="card-subtitle mb-2 text-muted">Categoria: ${dato.categoria}</h6>
                        <h6 class="card-subtitle mb-2 text-muted">Talla: ${talla}</h6>
                        <div class="producto-precio">${precioText}</div>
                        <div class="mb-2 mt-2">${badgeStock}</div>
                        ${metaEncargado}
                    </div>
                    <div class="card-footer bg-white border-0 text-center pb-4 px-4">
                        <button 
                            class="btn btn-primary w-100 rounded-pill fw-bold btn-ver-producto" 
                            data-id="${id}"
                            data-nombre="${dato.nombre}"
                            data-categoria="${dato.categoria}"
                            data-talla="${talla}"
                            data-imagen="${urlImagen}"
                            data-precio="${dato.precio || 0}"
                            >
                            ${stockNum === 0 ? 'Ver producto (agotado)' : 'Ver producto'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    catalogo.innerHTML = tarjetasHtml.join('');

    if (productosFiltrados.length === 0) {
        catalogo.innerHTML = `<div class="col-12"><div class="alert alert-dark border" style="background:#111; border-color:#242424 !important; color:#6b6560;">No hay productos para este filtro operativo.</div></div>`;
    }

    if (resultCount) {
        const total = productosFiltrados.length;
        resultCount.textContent = `${total} resultado${total === 1 ? '' : 's'}`;
    }

    actualizarPanelSupervisorDetallado();
}

function filtrarProductosSupervisor(productos = []) {
    if (!modoEncargadoWeb) return productos;

    if (filtroSupervisor === 'criticos') {
        return productos.filter((p) => (Number(p.stock) || 0) > 0 && (Number(p.stock) || 0) <= 5);
    }

    if (filtroSupervisor === 'sin-stock') {
        return productos.filter((p) => (Number(p.stock) || 0) === 0);
    }

    if (filtroSupervisor === 'top-ventas') {
        const top = [...productos].sort((a, b) => (ventas24hPorProducto.get(b.id) || 0) - (ventas24hPorProducto.get(a.id) || 0));
        return top.filter((p) => (ventas24hPorProducto.get(p.id) || 0) > 0).slice(0, 12);
    }

    return productos;
}

function filtrarPorCategoria(productos = []) {
    if (filtroCategorias.size === 0) return productos;
    return productos.filter((p) => filtroCategorias.has(String(p.categoria || '')));
}

function filtrarPorTalla(productos = []) {
    if (filtroTallas.size === 0) return productos;

    return productos.filter((p) => {
        if (Array.isArray(p.tallasDisponibles) && p.tallasDisponibles.length > 0) {
            return p.tallasDisponibles.some((t) => filtroTallas.has(normalizarTalla(t)));
        }
        return filtroTallas.has(normalizarTalla(p.talla));
    });
}

function filtrarPorDisponibilidad(productos = []) {
    if (!filtroSoloDisponible) return productos;
    return productos.filter((p) => (Number(p.stock) || 0) > 0);
}

function actualizarKpisSupervisor() {
    if (!kpiPedidosHoy) return;
    kpiPedidosHoy.textContent = String(pedidosHoy);
    kpiIngresosHoy.textContent = `${ingresosHoy.toFixed(2)} EUR`;
    kpiTicketMedio.textContent = `${ticketMedioHoy.toFixed(2)} EUR`;
    kpiCarritosActivos.textContent = String(carritosActivos);
}

function formatearHora(fecha = new Date()) {
    return fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function renderListaSupervisor(destino, items, vacio) {
    if (!destino) return;
    if (!Array.isArray(items) || items.length === 0) {
        destino.innerHTML = `<li class="insight-empty">${vacio}</li>`;
        return;
    }
    destino.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
}

function nombreProductoPorId(id) {
    const producto = productosActuales.find((p) => p.id === id);
    return producto?.nombre || 'Producto';
}

function actualizarPanelSupervisorDetallado() {
    if (!modoEncargadoWeb) return;

    const totalReservado = [...reservadoPorProducto.values()].reduce((acc, n) => acc + (Number(n) || 0), 0);
    const sinStock = productosActuales.filter((p) => (Number(p.stock) || 0) === 0);
    const criticos = productosActuales.filter((p) => (Number(p.stock) || 0) > 0 && (Number(p.stock) || 0) <= 5);
    const stockTotal = productosActuales.reduce((acc, p) => acc + (Number(p.stock) || 0), 0);

    const alertas = [];
    if (sinStock.length > 0) alertas.push(`<strong>${sinStock.length}</strong> referencias sin stock`);
    if (criticos.length > 0) alertas.push(`<strong>${criticos.length}</strong> referencias en stock critico (1-5)`);
    if (totalReservado > stockTotal && stockTotal > 0) alertas.push('Reservas en carritos por encima del stock publicado');
    if (pedidosHoy === 0) alertas.push('Aun no hay pedidos web confirmados hoy');
    if (alertas.length === 0) alertas.push('Operacion estable: no hay alertas urgentes');

    const topVentas = [...ventas24hPorProducto.entries()]
        .filter(([, qty]) => (Number(qty) || 0) > 0)
        .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
        .slice(0, 5)
        .map(([id, qty]) => `${nombreProductoPorId(id)}: <strong>${qty}</strong> uds.`);

    const topReservas = [...reservadoPorProducto.entries()]
        .filter(([, qty]) => (Number(qty) || 0) > 0)
        .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
        .slice(0, 5)
        .map(([id, qty]) => `${nombreProductoPorId(id)}: <strong>${qty}</strong> reservadas`);

    const riesgo = productosActuales
        .map((p) => {
            const stock = Number(p.stock) || 0;
            const ventas = Number(ventas24hPorProducto.get(p.id)) || 0;
            const cobertura = ventas > 0 ? stock / ventas : null;
            return { nombre: p.nombre || 'Producto', stock, ventas, cobertura };
        })
        .filter((p) => p.stock > 0 && p.ventas > 0)
        .sort((a, b) => (a.cobertura ?? Infinity) - (b.cobertura ?? Infinity))
        .slice(0, 5)
        .map((p) => `${p.nombre}: <strong>${p.cobertura != null ? p.cobertura.toFixed(1) : 'N/A'}</strong> dia(s) de cobertura`);

    renderListaSupervisor(supAlertList, alertas, 'Sin alertas por ahora');
    renderListaSupervisor(supTopVentasList, topVentas, 'Sin ventas registradas en las ultimas 24h');
    renderListaSupervisor(supReservasList, topReservas, 'Sin carritos con reservas activas');
    renderListaSupervisor(supRiesgoList, riesgo, 'No hay riesgo de quiebre con demanda activa');

    if (supLastUpdate) {
        supLastUpdate.textContent = `Actualizado ${formatearHora()}`;
    }
}

function esDentro24h(fechaMs) {
    if (!fechaMs) return false;
    const ahora = Date.now();
    return ahora - fechaMs <= 24 * 60 * 60 * 1000;
}

function esHoy(fechaMs) {
    if (!fechaMs) return false;
    const hoy = new Date();
    const f = new Date(fechaMs);
    return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth() && f.getDate() === hoy.getDate();
}

function iniciarMetricasSupervisor() {
    if (listeningSupervisorData) return;
    listeningSupervisorData = true;

    onSnapshot(collection(db, 'carritos'), (snapshot) => {
        const mapaReservado = new Map();
        let activos = 0;

        snapshot.forEach((docSnap) => {
            const items = docSnap.data().items || [];
            if (items.length > 0) activos += 1;

            items.forEach((item) => {
                const qty = Number(item.cantidad) || 0;
                const previo = mapaReservado.get(item.productoId) || 0;
                mapaReservado.set(item.productoId, previo + qty);
            });
        });

        reservadoPorProducto = mapaReservado;
        carritosActivos = activos;
        actualizarKpisSupervisor();
        renderCatalogo(productosActuales);
    });

    onSnapshot(collection(db, 'pedidos'), (snapshot) => {
        const ventas24 = new Map();
        let hoyPedidos = 0;
        let hoyIngresos = 0;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.origen !== 'App') return;

            const fechaMs = data.fecha ? data.fecha.toDate().getTime() : null;
            const items = Array.isArray(data.items) ? data.items : [];

            if (esHoy(fechaMs)) {
                hoyPedidos += 1;
                hoyIngresos += Number(data.total) || 0;
            }

            if (esDentro24h(fechaMs)) {
                items.forEach((item) => {
                    const qty = Number(item.cantidad) || 0;
                    const previo = ventas24.get(item.productoId) || 0;
                    ventas24.set(item.productoId, previo + qty);
                });
            }
        });

        ventas24hPorProducto = ventas24;
        pedidosHoy = hoyPedidos;
        ingresosHoy = hoyIngresos;
        ticketMedioHoy = hoyPedidos > 0 ? hoyIngresos / hoyPedidos : 0;

        actualizarKpisSupervisor();
        renderCatalogo(productosActuales);
    });
}

function guardarCatalogoCache(productos) {
    localStorage.setItem(CATALOGO_CACHE_KEY, JSON.stringify(productos));
}

function renderCatalogoDesdeCache() {
    const cacheRaw = localStorage.getItem(CATALOGO_CACHE_KEY);
    if (!cacheRaw) return;

    try {
        const cache = JSON.parse(cacheRaw);
        if (Array.isArray(cache) && cache.length > 0) {
            productosActuales = cache;
            actualizarChipsTalla();
            renderCatalogo(cache);
        }
    } catch (error) {
        console.error("Error leyendo cache de catalogo:", error);
    }
}

// --- 1. CARGAR CATÁLOGO DE PRODUCTOS (¡Siempre primero!) ---
renderCatalogoDesdeCache();

try {
    onSnapshot(
        collection(db, "productos"),
        (snapshot) => {
            const productos = [];

            snapshot.forEach((documento) => {
                productos.push({ id: documento.id, ...documento.data() });
            });

            guardarCatalogoCache(productos);
            productosActuales = productos;
            actualizarChipsTalla();
            renderCatalogo(productos);
        },
        (error) => {
            console.error("Error al cargar productos:", error);
            renderCatalogoDesdeCache();
        }
    );
} catch (error) {
    console.error("Error al cargar productos:", error);
    renderCatalogoDesdeCache();
}

// --- 2. CONTROL DE SESIÓN ---
onAuthStateChanged(auth, async (user) => {
    try {
        if (user) {
            usuarioActual = user; 
            
            // Buscamos su rol
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            let rol = "cliente"; // Por defecto asumimos que es cliente
            
            if (userDoc.exists() && userDoc.data().rol) {
                rol = userDoc.data().rol;
            }
            
            // En la web publica puede entrar cliente o encargado_web
            if (!esAppEscritorio && rol !== 'cliente' && rol !== 'encargado_web') {
                await signOut(auth);
                ipcRenderer.send('cambiar-pagina', 'login.html');
                return;
            }

            modoEncargadoWeb = rol === 'encargado_web';
            if (modoRolTag) {
                modoRolTag.style.display = modoEncargadoWeb ? 'block' : 'none';
            }
            if (supervisorPanel) {
                supervisorPanel.classList.toggle('visible', modoEncargadoWeb);
            }

            if (modoEncargadoWeb) {
                iniciarMetricasSupervisor();
                actualizarKpisSupervisor();
            }

            if (rol === 'vendedor' && esAppEscritorio) {
                ipcRenderer.send('cambiar-pagina', 'ventas.html');
            } else if (rol === 'mozo' && esAppEscritorio) {
                ipcRenderer.send('cambiar-pagina', 'almacen.html');
            } else {
                // ES CLIENTE: Activamos la interfaz de cliente
                btnCarrito.style.display = 'flex';
                if (btnPerfil) {
                    btnPerfil.style.display = 'inline-flex';
                }
                escucharCarrito(user.uid);

                authContainer.innerHTML = `
                    <button id="btnCerrarSesion" class="btn-nav danger">Cerrar Sesión</button>
                `;

                document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
                    await signOut(auth);
                    ipcRenderer.send('cambiar-pagina', 'login.html');
                });
            }
        } else {
            // NO HAY SESIÓN INICIADA
            usuarioActual = null;
            btnCarrito.style.display = 'none';
            if (btnPerfil) {
                btnPerfil.style.display = 'none';
            }
            
            authContainer.innerHTML = `
                <button id="btnIrLogin" class="btn-nav">Iniciar Sesión</button>
            `;
            document.getElementById('btnIrLogin').addEventListener('click', () => {
                ipcRenderer.send('cambiar-pagina', 'login.html');
            });
        }
    } catch (error) {
        console.error("Error al comprobar la sesión:", error);
    }
});

if (supervisorFilters) {
    supervisorFilters.addEventListener('click', (event) => {
        const btn = event.target.closest('.btn-filter');
        if (!btn) return;

        filtroSupervisor = btn.dataset.filter || 'todos';

        document.querySelectorAll('.btn-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        renderCatalogo(productosActuales);
    });
}

if (btnOpenFilters && filterSidebar) {
    btnOpenFilters.addEventListener('click', () => {
        filterSidebar.classList.toggle('open');
    });
}

if (chkCatAll) {
    chkCatAll.addEventListener('change', () => {
        if (chkCatAll.checked) {
            filtroCategorias.clear();
            chkCategorias.forEach((chk) => {
                chk.checked = false;
            });
        }
        actualizarChipsTalla();
        renderCatalogo(productosActuales);
    });
}

chkCategorias.forEach((chk) => {
    chk.addEventListener('change', () => {
        if (chk.checked) {
            filtroCategorias.add(chk.value);
            if (chkCatAll) chkCatAll.checked = false;
        } else {
            filtroCategorias.delete(chk.value);
        }

        if (filtroCategorias.size === 0 && chkCatAll) {
            chkCatAll.checked = true;
        }

        actualizarChipsTalla();
        renderCatalogo(productosActuales);
    });
});

if (sizeChipGrid) {
    sizeChipGrid.addEventListener('click', (event) => {
        const btn = event.target.closest('.size-chip');
        if (!btn) return;

        const talla = btn.dataset.size;
        if (!talla) return;

        if (filtroTallas.has(talla)) {
            filtroTallas.delete(talla);
        } else {
            filtroTallas.add(talla);
        }

        actualizarChipsTalla();
        renderCatalogo(productosActuales);
    });
}

if (chkSoloDisponible) {
    chkSoloDisponible.addEventListener('change', () => {
        filtroSoloDisponible = chkSoloDisponible.checked;
        renderCatalogo(productosActuales);
    });
}

if (btnClearFilters) {
    btnClearFilters.addEventListener('click', () => {
        filtroCategorias.clear();
        filtroTallas.clear();
        filtroSoloDisponible = false;

        if (chkCatAll) chkCatAll.checked = true;
        chkCategorias.forEach((chk) => {
            chk.checked = false;
        });
        if (chkSoloDisponible) chkSoloDisponible.checked = false;

        actualizarChipsTalla();
        renderCatalogo(productosActuales);
    });
}

actualizarChipsTalla();

// --- 3. ESCUCHAR CARRITO (Badge numérico) ---
function escucharCarrito(uid) {
    try {
        const carritoRef = doc(db, "carritos", uid);
        onSnapshot(carritoRef, (snap) => {
            const badge = document.getElementById('cartBadge');
            if (snap.exists()) {
                const items = snap.data().items || [];
                const totalItems = items.reduce((acc, item) => acc + item.cantidad, 0);
                badge.textContent = totalItems;
                badge.classList.toggle('visible', totalItems > 0);
            } else {
                badge.classList.remove('visible');
            }
        });
    } catch (error) {
        console.error("Error al escuchar carrito:", error);
    }
}

// --- 4. IR AL DETALLE DE PRODUCTO ---
catalogo.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-ver-producto');
    if (!btn) return;

    const productoId = btn.dataset.id;
    const destino = `producto.html?id=${encodeURIComponent(productoId)}`;
    window.location.href = destino;
});

// --- 5. NAVEGACIÓN Y TOAST ---
if (btnCarrito) {
    btnCarrito.addEventListener('click', () => {
        ipcRenderer.send('cambiar-pagina', 'Carrito.html');
    });
}

if (btnPerfil) {
    btnPerfil.addEventListener('click', () => {
        ipcRenderer.send('cambiar-pagina', 'perfil.html');
    });
}

function mostrarToast(mensaje) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = mensaje;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    }
}