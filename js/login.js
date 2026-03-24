import { auth, db, signInWithEmailAndPassword, doc, getDoc, signOut } from "./firebase.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };
const esAppEscritorio = typeof window !== 'undefined' && typeof window.require === 'function';
const btnLogin = document.getElementById('btnLogin');
const mensaje = document.getElementById('mensaje');
const linkRegistro = document.getElementById('btnIrRegistro');

if (esAppEscritorio && linkRegistro) {
    linkRegistro.innerHTML = '¿Sin cuenta interna? <span>Crear trabajador</span>';
}

// --- BOTÓN INICIAR SESIÓN ---
btnLogin.addEventListener('click', async () => {
    const email = document.getElementById('txtEmail').value;
    const pass = document.getElementById('txtPassword').value;

    if (!email || !pass) {
        mensaje.textContent = "Por favor, rellena todos los campos.";
        return;
    }

    mensaje.textContent = "";

    // Desactivamos el botón para que no le den 2 veces
    btnLogin.disabled = true;
    btnLogin.innerText = "Comprobando...";

    try {
        const respuesta = await signInWithEmailAndPassword(auth, email, pass);
        const usuarioID = respuesta.user.uid;

        // Miramos en la base de datos qué ROL tiene
        const docRef = doc(db, "usuarios", usuarioID);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const rol = docSnap.data().rol;
            btnLogin.innerText = "¡Redirigiendo...!";

            setTimeout(async () => {
                if (esAppEscritorio) {
                    if (rol === 'mozo') {
                        ipcRenderer.send('cambiar-pagina', 'almacen.html');
                    } else if (rol === 'vendedor') {
                        ipcRenderer.send('cambiar-pagina', 'ventas.html');
                    } else if (rol === 'encargado_web') {
                        ipcRenderer.send('cambiar-pagina', 'panel-trabajadores.html');
                    } else {
                        await signOut(auth);
                        mensaje.textContent = "Los clientes deben acceder desde la web, no desde la app de trabajadores.";
                        btnLogin.disabled = false;
                        btnLogin.innerText = "Entrar";
                    }
                } else {
                    if (rol === 'cliente') {
                        ipcRenderer.send('cambiar-pagina', 'cliente.html');
                    } else {
                        await signOut(auth);
                        mensaje.textContent = "Los trabajadores deben usar la app de escritorio.";
                        btnLogin.disabled = false;
                        btnLogin.innerText = "Entrar";
                    }
                }
            }, 500);

        } else {
            mensaje.textContent = "Error: Este usuario no tiene un rol asignado.";
            btnLogin.disabled = false;
            btnLogin.innerText = "Entrar";
        }
    } catch (error) {
        console.error("Error de login:", error);
        mensaje.textContent = "Usuario o contraseña incorrectos.";
        btnLogin.disabled = false;
        btnLogin.innerText = "Entrar";
    }
});

// --- IR AL REGISTRO ---
document.getElementById('btnIrRegistro').addEventListener('click', (e) => {
    e.preventDefault();
    if (esAppEscritorio) {
        ipcRenderer.send('cambiar-pagina', 'registro-trabajador.html');
    } else {
        ipcRenderer.send('cambiar-pagina', 'registro.html');
    }
});