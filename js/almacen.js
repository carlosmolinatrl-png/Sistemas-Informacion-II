import { db, auth, collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, signOut, onAuthStateChanged, getDoc } from "./firebase.js";
import { initOfflineStatus, isOnline } from "./offline.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

let idEditando = null;
const btnGuardar = document.getElementById('btnGuardar');
const PRODUCTOS_CACHE_KEY = 'modaveli_almacen_productos_cache';
const cmbCategoria = document.getElementById('cmbCategoria');
const cmbTallaSimple = document.getElementById('cmbTallaSimple');
const btnAgregarTalla = document.getElementById('btnAgregarTalla');
const listaTallasSeleccionadas = document.getElementById('listaTallasSeleccionadas');
const txtColores = document.getElementById('txtColores');
const btnGenerarVariantes = document.getElementById('btnGenerarVariantes');
const tablaVariantes = document.getElementById('tablaVariantes');
const CAMPOS_FORM = [
    'txtNombre',
    'cmbCategoria',
    'cmbTallaSimple',
    'btnAgregarTalla',
    'txtPrecio',
    'txtColores',
    'txtImagen',
    'btnGenerarVariantes'
];
let tallasSeleccionadas = [];

const TALLAS_ROPA = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Unica'];
const TALLAS_CALZADO = Array.from({ length: 12 }, (_, i) => String(35 + i));

function normalizarTexto(valor = '') {
    return String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function esCalzado(categoria = '') {
    const c = normalizarTexto(categoria);
    return c === 'zapatos' || c === 'zapatillas' || c === 'calzado';
}

function obtenerTallasPorCategoria(categoria = '') {
    if (!categoria) return [];
    return esCalzado(categoria) ? TALLAS_CALZADO : TALLAS_ROPA;
}

function normalizarTalla(talla = '') {
    const limpia = normalizarTexto(talla);
    if (limpia === 'unica') return 'Unica';
    return String(talla || '').trim();
}

function obtenerColoresDisponibles(rawColores = '') {
    const colores = String(rawColores || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

    return colores.length > 0 ? colores : ['Unico'];
}

function renderTallasPorCategoria(categoria = '', tallasSeleccionadas = []) {
    const tallas = obtenerTallasPorCategoria(categoria);
    const tallasNormalizadas = [...new Set(tallasSeleccionadas.map(normalizarTalla))];

    cmbTallaSimple.innerHTML = '';

    if (tallas.length === 0) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.textContent = 'Selecciona primero la categoria…';
        cmbTallaSimple.appendChild(placeholder);
        btnAgregarTalla.disabled = true;
        setTallasSeleccionadas([]);
        return;
    }

    const primerOption = document.createElement('option');
    primerOption.value = '';
    primerOption.disabled = true;
    primerOption.selected = true;
    primerOption.textContent = 'Selecciona una talla…';
    cmbTallaSimple.appendChild(primerOption);

    tallas.forEach((talla) => {
        const opt = document.createElement('option');
        opt.value = talla;
        opt.textContent = talla;
        cmbTallaSimple.appendChild(opt);
    });

    btnAgregarTalla.disabled = false;
    setTallasSeleccionadas(tallasNormalizadas);
}

function tallasSeleccionadasUI() {
    return [...tallasSeleccionadas];
}

function renderTallasSeleccionadas() {
    listaTallasSeleccionadas.innerHTML = '';

    tallasSeleccionadas.forEach((talla) => {
        const chip = document.createElement('span');
        chip.className = 'size-chip';
        chip.innerHTML = `${talla} <button type="button" class="btn-remove-size" data-talla="${talla}" aria-label="Quitar talla ${talla}">x</button>`;
        listaTallasSeleccionadas.appendChild(chip);
    });
}

function setTallasSeleccionadas(tallas = []) {
    const categoria = cmbCategoria.value;
    const permitidas = new Set(obtenerTallasPorCategoria(categoria).map(normalizarTalla));

    tallasSeleccionadas = [...new Set(tallas.map(normalizarTalla))]
        .filter((t) => t && (permitidas.size === 0 || permitidas.has(t)));

    renderTallasSeleccionadas();
}

function agregarTallaSeleccionada() {
    const tallaNueva = normalizarTalla(cmbTallaSimple.value || '');
    if (!tallaNueva) {
        alert('Selecciona una talla antes de anadirla.');
        return;
    }

    if (tallasSeleccionadas.includes(tallaNueva)) {
        return;
    }

    tallasSeleccionadas.push(tallaNueva);
    renderTallasSeleccionadas();

    cmbTallaSimple.selectedIndex = 0;
}

function parsearColores(valor = '') {
    return String(valor)
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
}

function obtenerVariantesDesdeTabla() {
    const filas = [...tablaVariantes.querySelectorAll('tr')];
    return filas.map((fila) => {
        const talla = normalizarTalla(fila.dataset.talla || '');
        const color = (fila.dataset.color || 'Unico').trim() || 'Unico';
        const stockInput = fila.querySelector('.input-stock-variante');
        const stock = Number(stockInput?.value || 0);
        return { talla, color, stock };
    });
}

function renderTablaVariantes(variantes = []) {
    tablaVariantes.innerHTML = '';

    variantes.forEach((v, idx) => {
        const fila = document.createElement('tr');
        fila.dataset.talla = normalizarTalla(v.talla);
        fila.dataset.color = (v.color || 'Unico').trim() || 'Unico';

        fila.innerHTML = `
            <td>${fila.dataset.talla}</td>
            <td>${fila.dataset.color}</td>
            <td><input class="input-stock-variante" type="number" min="0" step="1" value="${Number(v.stock) || 0}"></td>
            <td><button type="button" class="btn-del-variant" data-idx="${idx}">Eliminar</button></td>
        `;

        tablaVariantes.appendChild(fila);
    });

    asegurarCamposEditables();
}

function generarVariantesDesdeSeleccion() {
    const tallas = tallasSeleccionadasUI();
    const colores = parsearColores(txtColores.value);
    const listaColores = colores.length > 0 ? colores : ['Unico'];

    if (tallas.length === 0) {
        alert('Selecciona al menos una talla.');
        return;
    }

    const existentes = obtenerVariantesDesdeTabla();
    const mapa = new Map();

    existentes.forEach((v) => {
        mapa.set(`${normalizarTalla(v.talla)}|${(v.color || 'Unico').trim() || 'Unico'}`, Number(v.stock) || 0);
    });

    tallas.forEach((talla) => {
        listaColores.forEach((color) => {
            const c = (color || 'Unico').trim() || 'Unico';
            const key = `${normalizarTalla(talla)}|${c}`;
            if (!mapa.has(key)) {
                mapa.set(key, 0);
            }
        });
    });

    const variantes = [...mapa.entries()].map(([key, stock]) => {
        const [talla, color] = key.split('|');
        return { talla, color, stock };
    });

    renderTablaVariantes(variantes);
}

renderTallasPorCategoria('');
cmbCategoria.addEventListener('change', () => {
    renderTallasPorCategoria(cmbCategoria.value, tallasSeleccionadas);
});
btnAgregarTalla.addEventListener('click', agregarTallaSeleccionada);
listaTallasSeleccionadas.addEventListener('click', (event) => {
    const btn = event.target.closest('.btn-remove-size');
    if (!btn) return;
    const talla = normalizarTalla(btn.dataset.talla || '');
    tallasSeleccionadas = tallasSeleccionadas.filter((t) => t !== talla);
    renderTallasSeleccionadas();
});
btnGenerarVariantes.addEventListener('click', generarVariantesDesdeSeleccion);

tablaVariantes.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-del-variant');
    if (!btn) return;
    btn.closest('tr')?.remove();
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        ipcRenderer.send('cambiar-pagina', 'login.html');
        return;
    }

    try {
        const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
        const rol = userDoc.exists() ? (userDoc.data().rol || 'cliente') : 'cliente';

        if (rol !== 'mozo') {
            await signOut(auth);
            ipcRenderer.send('cambiar-pagina', 'login.html');
        }
    } catch {
        await signOut(auth);
        ipcRenderer.send('cambiar-pagina', 'login.html');
    }
});

function renderProductos(productos = []) {
    const tabla = document.getElementById('tablaProductos');
    if (!tabla) return;

    const filasHtml = productos.map((producto) => {
        const dato = producto;
        const id = producto.id;
        const precio = dato.precio != null ? `${Number(dato.precio).toFixed(2)} €` : '—';
        const tallas = Array.isArray(dato.tallasDisponibles) && dato.tallasDisponibles.length > 0
            ? dato.tallasDisponibles.join(', ')
            : (dato.talla || 'Unica');
        const variantes = Array.isArray(dato.variantes) ? dato.variantes : [];

        return `
            <tr>
                <td>${dato.nombre}</td>
                <td>${dato.categoria}</td>
                <td>${tallas}</td>
                <td><span class="badge bg-secondary">${dato.stock}</span></td>
                <td><strong>${precio}</strong></td>
                <td>
                    <button class="btn btn-warning btn-sm btn-editar" 
                        data-id="${id}" data-nombre="${dato.nombre}" 
                        data-categoria="${dato.categoria}" data-talla="${dato.talla || 'Unica'}" data-stock="${dato.stock}"
                        data-colores="${(Array.isArray(dato.coloresDisponibles) ? dato.coloresDisponibles.join(', ') : (dato.color || 'Unico'))}"
                        data-variantes='${JSON.stringify(variantes).replace(/'/g, "&#39;")}'
                        data-imagen="${dato.imagenUrl || ''}"
                        data-precio="${dato.precio ?? ''}" ${isOnline() ? '' : 'disabled'}>✏️</button>
                    <button class="btn btn-danger btn-sm btn-eliminar" data-id="${id}" ${isOnline() ? '' : 'disabled'}>🗑️</button>
                </td>
            </tr>
        `;
    });

    tabla.innerHTML = filasHtml.join('');
}

function guardarProductosCache(productos) {
    localStorage.setItem(PRODUCTOS_CACHE_KEY, JSON.stringify(productos));
}

function cargarProductosCache() {
    const raw = localStorage.getItem(PRODUCTOS_CACHE_KEY);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function asegurarCamposEditables() {
    CAMPOS_FORM.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = false;
            el.readOnly = false;
            el.style.pointerEvents = 'auto';
        }
    });

    const stockInputs = document.querySelectorAll('.input-stock-variante');
    stockInputs.forEach((input) => {
        input.disabled = false;
        input.readOnly = false;
        input.style.pointerEvents = 'auto';
    });
}

initOfflineStatus((online) => {
    asegurarCamposEditables();
    btnGuardar.disabled = !online;
    renderProductos(cargarProductosCache());
});

// --- 1. LEER Y MOSTRAR TABLA ---
renderProductos(cargarProductosCache());

onSnapshot(
    collection(db, "productos"),
    (snapshot) => {
        const productos = [];
        snapshot.forEach((documento) => {
            productos.push({ id: documento.id, ...documento.data() });
        });
        guardarProductosCache(productos);
        renderProductos(productos);
    },
    () => {
        renderProductos(cargarProductosCache());
    }
);

// --- 2. GUARDAR / ACTUALIZAR ---
btnGuardar.addEventListener('click', async () => {
    if (!isOnline()) {
        alert("Sin conexion: no se pueden guardar cambios.");
        return;
    }

    const nombre    = document.getElementById('txtNombre').value;
    const categoria = cmbCategoria.value;
    const colores   = document.getElementById('txtColores').value;
    const imagenUrl = document.getElementById('txtImagen').value;
    const precio    = document.getElementById('txtPrecio').value;
    const coloresDisponibles = obtenerColoresDisponibles(colores);
    const variantes = obtenerVariantesDesdeTabla();
    const variantesValidas = variantes.filter((v) => v.talla && v.color && Number.isFinite(v.stock) && v.stock >= 0);
    const tallasDisponibles = [...new Set(variantesValidas.map((v) => normalizarTalla(v.talla)))];
    const coloresDeVariantes = [...new Set(variantesValidas.map((v) => (v.color || 'Unico').trim() || 'Unico'))];
    const stockTotal = variantesValidas.reduce((acc, v) => acc + Number(v.stock || 0), 0);

    if (!nombre || !categoria) {
        alert("Rellena nombre y categoria"); return;
    }
    if (variantesValidas.length === 0) {
        alert("Genera al menos una variante con stock."); return;
    }
    const tallasValidas = obtenerTallasPorCategoria(categoria);
    if (!tallasDisponibles.every((t) => tallasValidas.includes(normalizarTalla(t)))) {
        alert("Hay tallas en variantes que no corresponden con la categoria elegida."); return;
    }
    if (precio === "" || isNaN(Number(precio)) || Number(precio) < 0) {
        alert("Introduce un precio válido (ej: 19.99)"); return;
    }

    try {
        if (idEditando === null) {
            await addDoc(collection(db, "productos"), {
                nombre,
                categoria,
                talla: tallasDisponibles[0] || 'Unica',
                tallasDisponibles,
                coloresDisponibles: coloresDeVariantes.length > 0 ? coloresDeVariantes : coloresDisponibles,
                variantes: variantesValidas,
                stock: stockTotal,
                imagenUrl: imagenUrl || "",
                precio: Number(precio),
                fecha: new Date()
            });
        } else {
            await updateDoc(doc(db, "productos", idEditando), {
                nombre,
                categoria,
                talla: tallasDisponibles[0] || 'Unica',
                tallasDisponibles,
                coloresDisponibles: coloresDeVariantes.length > 0 ? coloresDeVariantes : coloresDisponibles,
                variantes: variantesValidas,
                stock: stockTotal,
                imagenUrl: imagenUrl || "",
                precio: Number(precio)
            });
            idEditando = null;
            btnGuardar.innerText = "Guardar Producto";
            btnGuardar.classList.remove("btn-success");
        }

        document.getElementById('txtNombre').value    = "";
        document.getElementById('txtColores').value   = "";
        document.getElementById('txtImagen').value    = "";
        cmbCategoria.value = "";
        renderTallasPorCategoria('');
        renderTablaVariantes([]);
        document.getElementById('txtPrecio').value    = "";

    } catch (e) { alert("Error: " + e.message); }
});

// --- 3. BOTONES DE ACCIÓN ---
document.getElementById('tablaProductos').addEventListener('click', async (e) => {
    const btnEliminar = e.target.closest('.btn-eliminar');
    const btnEditar = e.target.closest('.btn-editar');
    if (!btnEliminar && !btnEditar) return;

    if (!isOnline()) {
        alert("Sin conexion: no se pueden editar productos.");
        return;
    }

    try {
        if (btnEliminar) {
            if (confirm("¿Borrar?")) {
                await deleteDoc(doc(db, "productos", btnEliminar.dataset.id));
            }
            return;
        }

        const d = btnEditar.dataset;
        document.getElementById('txtNombre').value    = d.nombre;
        cmbCategoria.value = d.categoria;
        document.getElementById('txtColores').value   = d.colores || '';
        document.getElementById('txtImagen').value    = d.imagen;
        document.getElementById('txtPrecio').value    = d.precio;

        let variantes = [];
        try {
            variantes = d.variantes ? JSON.parse(d.variantes) : [];
        } catch {
            variantes = [];
        }

        if (!Array.isArray(variantes) || variantes.length === 0) {
            variantes = [{
                talla: d.talla || 'Unica',
                color: (d.colores || 'Unico').split(',')[0].trim() || 'Unico',
                stock: Number(d.stock) || 0
            }];
        }

        const tallasVar = [...new Set(variantes.map((v) => normalizarTalla(v.talla)))];
        renderTallasPorCategoria(d.categoria, tallasVar);
        renderTablaVariantes(variantes);

        idEditando = d.id;
        btnGuardar.innerText = "Actualizar";
        btnGuardar.classList.add("btn-success");
    } catch (error) {
        console.error(error);
        alert("No se pudo completar la accion sobre el producto.");
    }
});

// --- 4. CERRAR SESIÓN ---
document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
    try {
        await signOut(auth);
        ipcRenderer.send('cambiar-pagina', 'login.html');
    } catch (error) {
        console.error(error);
        alert("Hubo un problema al cerrar sesión.");
    }
});