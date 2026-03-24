import { auth, db, createUserWithEmailAndPassword, signOut, doc, setDoc } from "./firebase.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

// --- CREAR CUENTA ---
document.getElementById('btnRegistrar').addEventListener('click', async () => {
    const email = document.getElementById('txtEmailReg').value;
    const pass = document.getElementById('txtPasswordReg').value;
    const rol = 'cliente';
    const mensaje = document.getElementById('mensajeReg');

    if (!email || pass.length < 6) {
        mensaje.className = "text-danger text-center mt-3 small";
        mensaje.innerText = "Rellena el email y usa una clave de 6+ caracteres.";
        return;
    }

    try {
        const credenciales = await createUserWithEmailAndPassword(auth, email, pass);
        const usuarioID = credenciales.user.uid;

        await setDoc(doc(db, "usuarios", usuarioID), {
            email: email,
            rol: rol
        });

        // 1. Cerramos la sesión automática de Firebase para que entre limpio
        await signOut(auth);

        // 2. Quitamos el 'alert()' y mostramos un mensaje bonito en la pantalla
        mensaje.className = "text-success text-center mt-3 small";
        mensaje.innerText = `¡Cuenta de ${rol.toUpperCase()} creada! Volviendo al login...`;
        
        // 3. Esperamos 1.5 segundos y cambiamos de página (así no se congela Electron)
        setTimeout(() => {
            ipcRenderer.send('cambiar-pagina', 'login.html');
        }, 1500);
        
    } catch (error) {
        console.error(error);
        mensaje.className = "text-danger text-center mt-3 small";
        if (error.code === 'auth/email-already-in-use') {
            mensaje.innerText = "Este correo ya está registrado.";
        } else {
            mensaje.innerText = "Error: " + error.message;
        }
    }
});

// --- VOLVER AL LOGIN ---
document.getElementById('btnVolver').addEventListener('click', () => {
    ipcRenderer.send('cambiar-pagina', 'login.html');
});