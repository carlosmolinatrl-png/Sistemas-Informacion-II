import {
    auth,
    db,
    onAuthStateChanged,
    doc,
    getDoc,
    setDoc,
    updateDoc
} from "./firebase.js";
import { initOfflineStatus, isOnline } from "./offline.js";

const ipcRenderer = (typeof window !== "undefined" && typeof window.require === "function")
    ? window.require("electron").ipcRenderer
    : { send: (_channel, page) => { window.location.href = `./${page}`; } };

const TALLAS_ROPA    = ["XS", "S", "M", "L", "XL", "XXL", "Unica"];
const TALLAS_CALZADO = Array.from({ length: 12 }, (_, i) => String(35 + i));

const nombreProductoEl    = document.getElementById("nombreProducto");
const categoriaProductoEl = document.getElementById("categoriaProducto");
const precioProductoEl    = document.getElementById("precioProducto");
const stockProductoEl     = document.getElementById("stockProducto");
const imgProductoEl       = document.getElementById("imgProducto");
const gridTallasEl        = document.getElementById("gridTallas");
const gridColoresEl       = document.getElementById("gridColores");
const stockCombinacionEl  = document.getElementById("stockCombinacion");
const txtCantidadDetalle  = document.getElementById("txtCantidadDetalle");
const btnAgregarDesdeDetalle = document.getElementById("btnAgregarDesdeDetalle");
const mensajeProducto     = document.getElementById("mensajeProducto");

let usuarioActual     = null;
let productoActual    = null;
let tallaSeleccionada = "";
let colorSeleccionado = "";
let tallasDisponibles = [];
let coloresDisponibles = [];
let stockPorCombinacion = new Map();

// ── Toast de éxito ─────────────────────────────────────────────────────────
const toastEl = document.createElement("div");
toastEl.id = "toast-carrito";
toastEl.style.cssText = `
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: #0d0d0d;
    border: 1px solid #4ca874;
    color: #4ca874;
    font-family: 'DM Mono', monospace;
    font-size: 0.82rem;
    padding: 0.85rem 1.8rem;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease, transform 0.3s ease;
    z-index: 9999;
    white-space: nowrap;
    letter-spacing: 0.05em;
`;
document.body.appendChild(toastEl);

function mostrarToastExito(msg) {
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateX(-50%) translateY(0)";
}
function ocultarToast() {
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateX(-50%) translateY(20px)";
}

// ── Helpers ────────────────────────────────────────────────────────────────
function normalizarTexto(valor = "") {
    return String(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function esCalzado(categoria = "") {
    const c = normalizarTexto(categoria);
    return c === "zapatos" || c === "zapatillas" || c === "calzado";
}
function normalizarTalla(valor = "") {
    const limpia = normalizarTexto(valor);
    if (!limpia || limpia === "unica") return "Unica";
    return String(valor).trim();
}
function normalizarColor(valor = "") {
    return String(valor || "").trim() || "Unico";
}
function claveCombinacion(talla, color) {
    return `${normalizarTalla(talla)}|${normalizarColor(color)}`;
}

function obtenerTallasDisponibles(producto) {
    if (Array.isArray(producto.tallasDisponibles) && producto.tallasDisponibles.length > 0)
        return producto.tallasDisponibles.map(normalizarTalla);
    if (producto.talla) return [normalizarTalla(producto.talla)];
    return esCalzado(producto.categoria) ? [...TALLAS_CALZADO] : [...TALLAS_ROPA];
}

function obtenerColoresDisponibles(producto) {
    if (Array.isArray(producto.coloresDisponibles) && producto.coloresDisponibles.length > 0)
        return producto.coloresDisponibles.map((c) => String(c).trim()).filter(Boolean);
    if (producto.color) return [normalizarColor(producto.color)];
    return ["Unico"];
}

function construirStockPorCombinacion(producto) {
    const map = new Map();
    if (Array.isArray(producto.variantes) && producto.variantes.length > 0) {
        producto.variantes.forEach((v) => {
            map.set(claveCombinacion(normalizarTalla(v.talla), normalizarColor(v.color)), Number(v.stock) || 0);
        });
        return map;
    }
    const stockGlobal = Number(producto.stock) || 0;
    obtenerTallasDisponibles(producto).forEach((t) => {
        obtenerColoresDisponibles(producto).forEach((c) => {
            map.set(claveCombinacion(t, c), stockGlobal);
        });
    });
    return map;
}

function stockCombinacion(talla, color) {
    return stockPorCombinacion.get(claveCombinacion(talla, color)) || 0;
}
function existeStockParaTalla(talla) {
    return coloresDisponibles.some((c) => stockCombinacion(talla, c) > 0);
}
function existeStockParaColor(color) {
    return tallasDisponibles.some((t) => stockCombinacion(t, color) > 0);
}

function mostrarMensaje(texto, tipo = "") {
    mensajeProducto.textContent = texto;
    mensajeProducto.style.color =
        tipo === "error" ? "#e05252" :
        tipo === "ok"    ? "#4ca874" : "#6b6560";
}

function renderGridOpciones(container, opciones, valorActivo, isDisabled, onClick) {
    container.innerHTML = "";
    opciones.forEach((opcion) => {
        const disabled = isDisabled(opcion);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `option-btn${opcion === valorActivo ? " active" : ""}${disabled ? " disabled" : ""}`;
        btn.textContent = opcion;
        btn.disabled = disabled;
        if (!disabled) btn.addEventListener("click", () => onClick(opcion));
        container.appendChild(btn);
    });
}

function actualizarUISeleccion() {
    renderGridOpciones(
        gridTallasEl, tallasDisponibles, tallaSeleccionada,
        (t) => !existeStockParaTalla(t),
        (t) => {
            tallaSeleccionada = t;
            if (stockCombinacion(tallaSeleccionada, colorSeleccionado) <= 0) {
                colorSeleccionado = coloresDisponibles.find((c) => stockCombinacion(tallaSeleccionada, c) > 0) || "";
            }
            actualizarUISeleccion();
        }
    );

    renderGridOpciones(
        gridColoresEl, coloresDisponibles, colorSeleccionado,
        (c) => !existeStockParaColor(c),
        (c) => {
            colorSeleccionado = c;
            if (stockCombinacion(tallaSeleccionada, colorSeleccionado) <= 0) {
                tallaSeleccionada = tallasDisponibles.find((t) => stockCombinacion(t, colorSeleccionado) > 0) || "";
            }
            actualizarUISeleccion();
        }
    );

    const stockCombo = stockCombinacion(tallaSeleccionada, colorSeleccionado);
    txtCantidadDetalle.min = "1";
    txtCantidadDetalle.max = String(Math.max(1, stockCombo));
    if ((Number(txtCantidadDetalle.value) || 1) > stockCombo)
        txtCantidadDetalle.value = stockCombo > 0 ? String(stockCombo) : "1";

    const stockTotal  = Number(productoActual?.stock) || 0;
    const sinConexion = !isOnline();
    const agotadoCombo = stockCombo <= 0;

    stockCombinacionEl.textContent = agotadoCombo
        ? "Combinacion sin stock"
        : `Stock para esta combinacion: ${stockCombo}`;

    btnAgregarDesdeDetalle.disabled = sinConexion || stockTotal <= 0 || agotadoCombo;

    if (sinConexion)        mostrarMensaje("Sin conexion: no se puede anadir al carrito.", "error");
    else if (stockTotal <= 0) mostrarMensaje("Producto agotado.", "error");
    else if (agotadoCombo)    mostrarMensaje("Selecciona una talla y color con stock.", "error");
    else                      mostrarMensaje("");
}

// ── Cargar producto ────────────────────────────────────────────────────────
async function cargarProducto() {
    const params     = new URLSearchParams(window.location.search);
    const productoId = params.get("id");

    if (!productoId) {
        mostrarMensaje("Producto no encontrado.", "error");
        btnAgregarDesdeDetalle.disabled = true;
        return;
    }

    try {
        const productoSnap = await getDoc(doc(db, "productos", productoId));
        if (!productoSnap.exists()) {
            mostrarMensaje("Este producto ya no esta disponible.", "error");
            btnAgregarDesdeDetalle.disabled = true;
            return;
        }

        productoActual = { id: productoSnap.id, ...productoSnap.data() };

        const precio = Number(productoActual.precio) || 0;
        const stock  = Number(productoActual.stock)  || 0;

        categoriaProductoEl.textContent = productoActual.categoria || "Producto";
        nombreProductoEl.textContent    = productoActual.nombre    || "Producto";
        precioProductoEl.textContent    = `${precio.toFixed(2)} EUR`;
        stockProductoEl.textContent     = stock > 0
            ? `Stock disponible total: ${stock}`
            : "Producto agotado";
        imgProductoEl.src = productoActual.imagenUrl || "../assets/placeholder-product.svg";

        tallasDisponibles   = obtenerTallasDisponibles(productoActual);
        coloresDisponibles  = obtenerColoresDisponibles(productoActual);
        stockPorCombinacion = construirStockPorCombinacion(productoActual);

        tallaSeleccionada = tallasDisponibles.find((t) => existeStockParaTalla(t)) || tallasDisponibles[0] || "";
        colorSeleccionado = coloresDisponibles.find((c) => stockCombinacion(tallaSeleccionada, c) > 0)
            || coloresDisponibles.find((c) => existeStockParaColor(c))
            || coloresDisponibles[0] || "";

        actualizarUISeleccion();
    } catch (error) {
        console.error(error);
        mostrarMensaje("Error cargando el producto.", "error");
        btnAgregarDesdeDetalle.disabled = true;
    }
}

// ── Añadir al carrito ──────────────────────────────────────────────────────
async function agregarAlCarrito() {
    if (!productoActual) return;
    if (!usuarioActual) { mostrarMensaje("Inicia sesion para anadir productos al carrito.", "error"); return; }
    if (!isOnline())    { mostrarMensaje("Sin conexion: no se puede modificar el carrito.", "error"); return; }

    const talla    = normalizarTalla(tallaSeleccionada);
    const color    = normalizarColor(colorSeleccionado);
    const stock    = stockCombinacion(talla, color);
    const cantidad = Number(txtCantidadDetalle.value) || 1;

    if (cantidad < 1)       { mostrarMensaje("La cantidad debe ser mayor que 0.", "error"); return; }
    if (cantidad > stock)   { mostrarMensaje(`Solo hay ${stock} unidad(es) disponibles para esa combinacion.`, "error"); return; }

    const carritoRef = doc(db, "carritos", usuarioActual.uid);

    try {
        const carritoSnap = await getDoc(carritoRef);
        const itemNuevo = {
            productoId: productoActual.id,
            nombre:     productoActual.nombre,
            categoria:  productoActual.categoria || "",
            talla, color,
            imagenUrl:  productoActual.imagenUrl || "",
            precio:     Number(productoActual.precio) || 0,
            cantidad
        };

        if (carritoSnap.exists()) {
            const items = Array.isArray(carritoSnap.data().items) ? [...carritoSnap.data().items] : [];
            const idx = items.findIndex((it) =>
                it.productoId === itemNuevo.productoId &&
                normalizarTalla(it.talla) === itemNuevo.talla &&
                normalizarColor(it.color) === itemNuevo.color
            );
            if (idx >= 0) items[idx].cantidad += cantidad;
            else items.push(itemNuevo);
            await updateDoc(carritoRef, { items });
        } else {
            await setDoc(carritoRef, { usuarioId: usuarioActual.uid, items: [itemNuevo] });
        }

        // ── Toast de éxito + volver al catálogo ──
        mostrarToastExito(`✓ ${productoActual.nombre} añadido al carrito`);
        btnAgregarDesdeDetalle.disabled = true;

        setTimeout(() => {
            ocultarToast();
            // Volver a la página anterior (catálogo con los filtros que tenía)
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = "cliente.html";
            }
        }, 1600);

    } catch (error) {
        console.error(error);
        mostrarMensaje("No se pudo anadir al carrito.", "error");
    }
}

btnAgregarDesdeDetalle.addEventListener("click", agregarAlCarrito);

document.getElementById("btnVolverTienda").addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "cliente.html";
});

document.getElementById("btnIrCarrito").addEventListener("click", () => {
    ipcRenderer.send("cambiar-pagina", "Carrito.html");
});

txtCantidadDetalle.addEventListener("input", () => {
    const stockCombo = stockCombinacion(tallaSeleccionada, colorSeleccionado);
    let valor = Number(txtCantidadDetalle.value) || 1;
    if (valor < 1) valor = 1;
    if (stockCombo > 0 && valor > stockCombo) valor = stockCombo;
    txtCantidadDetalle.value = String(valor);
});

onAuthStateChanged(auth, (user) => { usuarioActual = user || null; });

initOfflineStatus((online) => {
    if (!online) {
        btnAgregarDesdeDetalle.disabled = true;
        mostrarMensaje("Sin conexion: no se puede anadir al carrito.", "error");
    } else if (productoActual) {
        actualizarUISeleccion();
    }
});

cargarProducto();