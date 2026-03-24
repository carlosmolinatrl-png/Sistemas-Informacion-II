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
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

const TALLAS_ROPA = ["XS", "S", "M", "L", "XL", "XXL", "Unica"];
const TALLAS_CALZADO = Array.from({ length: 12 }, (_, i) => String(35 + i));

const nombreProductoEl = document.getElementById("nombreProducto");
const categoriaProductoEl = document.getElementById("categoriaProducto");
const precioProductoEl = document.getElementById("precioProducto");
const stockProductoEl = document.getElementById("stockProducto");
const imgProductoEl = document.getElementById("imgProducto");
const gridTallasEl = document.getElementById("gridTallas");
const gridColoresEl = document.getElementById("gridColores");
const stockCombinacionEl = document.getElementById("stockCombinacion");
const txtCantidadDetalle = document.getElementById("txtCantidadDetalle");
const btnAgregarDesdeDetalle = document.getElementById("btnAgregarDesdeDetalle");
const mensajeProducto = document.getElementById("mensajeProducto");

let usuarioActual = null;
let productoActual = null;
let tallaSeleccionada = "";
let colorSeleccionado = "";
let tallasDisponibles = [];
let coloresDisponibles = [];
let stockPorCombinacion = new Map();

function normalizarTexto(valor = "") {
    return String(valor)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
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
    const color = String(valor || "").trim();
    return color || "Unico";
}

function claveCombinacion(talla, color) {
    return `${normalizarTalla(talla)}|${normalizarColor(color)}`;
}

function obtenerTallasDisponibles(producto) {
    if (Array.isArray(producto.tallasDisponibles) && producto.tallasDisponibles.length > 0) {
        return producto.tallasDisponibles.map(normalizarTalla);
    }

    if (producto.talla) {
        return [normalizarTalla(producto.talla)];
    }

    return esCalzado(producto.categoria) ? [...TALLAS_CALZADO] : [...TALLAS_ROPA];
}

function obtenerColoresDisponibles(producto) {
    if (Array.isArray(producto.coloresDisponibles) && producto.coloresDisponibles.length > 0) {
        return producto.coloresDisponibles
            .map((c) => String(c).trim())
            .filter((c) => c.length > 0);
    }

    if (producto.color) {
        return [normalizarColor(producto.color)];
    }

    return ["Unico"];
}

function construirStockPorCombinacion(producto) {
    const map = new Map();

    if (Array.isArray(producto.variantes) && producto.variantes.length > 0) {
        producto.variantes.forEach((v) => {
            const talla = normalizarTalla(v.talla);
            const color = normalizarColor(v.color);
            const stock = Number(v.stock) || 0;
            map.set(claveCombinacion(talla, color), stock);
        });
        return map;
    }

    if (producto.stockPorVariante && typeof producto.stockPorVariante === "object") {
        Object.entries(producto.stockPorVariante).forEach(([k, v]) => {
            const [t, c] = String(k).split("|");
            const talla = normalizarTalla(t);
            const color = normalizarColor(c);
            map.set(claveCombinacion(talla, color), Number(v) || 0);
        });
        return map;
    }

    const stockGlobal = Number(producto.stock) || 0;
    const tallas = obtenerTallasDisponibles(producto);
    const colores = obtenerColoresDisponibles(producto);

    tallas.forEach((talla) => {
        colores.forEach((color) => {
            map.set(claveCombinacion(talla, color), stockGlobal);
        });
    });

    return map;
}

function stockCombinacion(talla, color) {
    return stockPorCombinacion.get(claveCombinacion(talla, color)) || 0;
}

function existeStockParaTalla(talla) {
    return coloresDisponibles.some((color) => stockCombinacion(talla, color) > 0);
}

function existeStockParaColor(color) {
    return tallasDisponibles.some((talla) => stockCombinacion(talla, color) > 0);
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

        if (!disabled) {
            btn.addEventListener("click", () => onClick(opcion));
        }

        container.appendChild(btn);
    });
}

function mostrarMensaje(texto, tipo = "") {
    mensajeProducto.textContent = texto;
    if (tipo === "error") {
        mensajeProducto.style.color = "#e05252";
        return;
    }
    if (tipo === "ok") {
        mensajeProducto.style.color = "#4ca874";
        return;
    }
    mensajeProducto.style.color = "#6b6560";
}

function actualizarUISeleccion() {
    renderGridOpciones(
        gridTallasEl,
        tallasDisponibles,
        tallaSeleccionada,
        (talla) => !existeStockParaTalla(talla),
        (talla) => {
            tallaSeleccionada = talla;
            if (stockCombinacion(tallaSeleccionada, colorSeleccionado) <= 0) {
                const primerColorValido = coloresDisponibles.find((color) => stockCombinacion(tallaSeleccionada, color) > 0);
                colorSeleccionado = primerColorValido || "";
            }
            actualizarUISeleccion();
        }
    );

    renderGridOpciones(
        gridColoresEl,
        coloresDisponibles,
        colorSeleccionado,
        (color) => !existeStockParaColor(color),
        (color) => {
            colorSeleccionado = color;
            if (stockCombinacion(tallaSeleccionada, colorSeleccionado) <= 0) {
                const primeraTallaValida = tallasDisponibles.find((talla) => stockCombinacion(talla, colorSeleccionado) > 0);
                tallaSeleccionada = primeraTallaValida || "";
            }
            actualizarUISeleccion();
        }
    );

    const stockCombo = stockCombinacion(tallaSeleccionada, colorSeleccionado);
    txtCantidadDetalle.min = "1";
    txtCantidadDetalle.max = String(Math.max(1, stockCombo));

    if ((Number(txtCantidadDetalle.value) || 1) > stockCombo) {
        txtCantidadDetalle.value = stockCombo > 0 ? String(stockCombo) : "1";
    }

    const stockTotal = Number(productoActual?.stock) || 0;
    const sinConexion = !isOnline();
    const agotadoCombo = stockCombo <= 0;

    stockCombinacionEl.textContent = agotadoCombo
        ? "Combinacion sin stock"
        : `Stock para esta combinacion: ${stockCombo}`;

    btnAgregarDesdeDetalle.disabled = sinConexion || stockTotal <= 0 || agotadoCombo;

    if (sinConexion) {
        mostrarMensaje("Sin conexion: no se puede anadir al carrito.", "error");
    } else if (stockTotal <= 0) {
        mostrarMensaje("Producto agotado.", "error");
    } else if (agotadoCombo) {
        mostrarMensaje("Selecciona una talla y color con stock.", "error");
    } else {
        mostrarMensaje("");
    }
}

async function cargarProducto() {
    const params = new URLSearchParams(window.location.search);
    const productoId = params.get("id");

    if (!productoId) {
        mostrarMensaje("Producto no encontrado.", "error");
        btnAgregarDesdeDetalle.disabled = true;
        return;
    }

    try {
        const productoRef = doc(db, "productos", productoId);
        const productoSnap = await getDoc(productoRef);

        if (!productoSnap.exists()) {
            mostrarMensaje("Este producto ya no esta disponible.", "error");
            btnAgregarDesdeDetalle.disabled = true;
            return;
        }

        productoActual = { id: productoSnap.id, ...productoSnap.data() };

        const precio = Number(productoActual.precio) || 0;
        const stock = Number(productoActual.stock) || 0;

        categoriaProductoEl.textContent = productoActual.categoria || "Producto";
        nombreProductoEl.textContent = productoActual.nombre || "Producto";
        precioProductoEl.textContent = `${precio.toFixed(2)} EUR`;
        stockProductoEl.textContent = stock > 0
            ? `Stock disponible total: ${stock}`
            : "Producto agotado";
        imgProductoEl.src = productoActual.imagenUrl || "../assets/placeholder-product.svg";

        tallasDisponibles = obtenerTallasDisponibles(productoActual);
        coloresDisponibles = obtenerColoresDisponibles(productoActual);
        stockPorCombinacion = construirStockPorCombinacion(productoActual);

        tallaSeleccionada = tallasDisponibles.find((t) => existeStockParaTalla(t)) || tallasDisponibles[0] || "";
        colorSeleccionado = coloresDisponibles.find((c) => stockCombinacion(tallaSeleccionada, c) > 0)
            || coloresDisponibles.find((c) => existeStockParaColor(c))
            || coloresDisponibles[0]
            || "";

        actualizarUISeleccion();
    } catch (error) {
        console.error(error);
        mostrarMensaje("Error cargando el producto.", "error");
        btnAgregarDesdeDetalle.disabled = true;
    }
}

async function agregarAlCarrito() {
    if (!productoActual) return;

    if (!usuarioActual) {
        mostrarMensaje("Inicia sesion para anadir productos al carrito.", "error");
        return;
    }

    if (!isOnline()) {
        mostrarMensaje("Sin conexion: no se puede modificar el carrito.", "error");
        return;
    }

    const talla = normalizarTalla(tallaSeleccionada);
    const color = normalizarColor(colorSeleccionado);
    const stock = stockCombinacion(talla, color);
    const cantidad = Number(txtCantidadDetalle.value) || 1;

    if (cantidad < 1) {
        mostrarMensaje("La cantidad debe ser mayor que 0.", "error");
        return;
    }

    if (cantidad > stock) {
        mostrarMensaje(`Solo hay ${stock} unidad(es) disponibles para esa combinacion.`, "error");
        return;
    }

    const carritoRef = doc(db, "carritos", usuarioActual.uid);

    try {
        const carritoSnap = await getDoc(carritoRef);
        const itemNuevo = {
            productoId: productoActual.id,
            nombre: productoActual.nombre,
            categoria: productoActual.categoria || "",
            talla,
            color,
            imagenUrl: productoActual.imagenUrl || "",
            precio: Number(productoActual.precio) || 0,
            cantidad
        };

        if (carritoSnap.exists()) {
            const items = Array.isArray(carritoSnap.data().items) ? [...carritoSnap.data().items] : [];
            const idx = items.findIndex((it) =>
                it.productoId === itemNuevo.productoId
                && normalizarTalla(it.talla) === itemNuevo.talla
                && normalizarColor(it.color) === itemNuevo.color
            );

            if (idx >= 0) {
                items[idx].cantidad += cantidad;
            } else {
                items.push(itemNuevo);
            }

            await updateDoc(carritoRef, { items });
        } else {
            await setDoc(carritoRef, {
                usuarioId: usuarioActual.uid,
                items: [itemNuevo]
            });
        }

        mostrarMensaje("Producto anadido al carrito.", "ok");
        txtCantidadDetalle.value = "1";
        actualizarUISeleccion();
    } catch (error) {
        console.error(error);
        mostrarMensaje("No se pudo anadir al carrito.", "error");
    }
}

btnAgregarDesdeDetalle.addEventListener("click", agregarAlCarrito);

document.getElementById("btnVolverTienda").addEventListener("click", () => {
    window.location.href = "cliente.html";
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

onAuthStateChanged(auth, (user) => {
    usuarioActual = user || null;
});

initOfflineStatus((online) => {
    if (!online) {
        btnAgregarDesdeDetalle.disabled = true;
        mostrarMensaje("Sin conexion: no se puede anadir al carrito.", "error");
    } else if (productoActual) {
        actualizarUISeleccion();
    }
});

cargarProducto();