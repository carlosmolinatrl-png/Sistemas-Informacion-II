import { auth, db, createUserWithEmailAndPassword, signOut, doc, setDoc } from "./firebase.js";

const ipcRenderer = (typeof window !== 'undefined' && typeof window.require === 'function')
    ? window.require('electron').ipcRenderer
    : {
        send: (_channel, page) => {
            window.location.href = `./${page}`;
        }
    };

const btnRegistrar = document.getElementById("btnRegistrarTrab");
const btnVolver = document.getElementById("btnVolverLogin");
const mensaje = document.getElementById("mensajeRegTrab");

btnRegistrar.addEventListener("click", async () => {
    const email = document.getElementById("txtEmailRegTrab").value.trim();
    const pass = document.getElementById("txtPasswordRegTrab").value;
    const rol = document.getElementById("cmbRolRegTrab").value;

    if (!email || pass.length < 6) {
        mensaje.className = "text-danger";
        mensaje.textContent = "Completa correo y contraseña (mínimo 6 caracteres).";
        return;
    }

    try {
        const credenciales = await createUserWithEmailAndPassword(auth, email, pass);
        const usuarioID = credenciales.user.uid;

        await setDoc(doc(db, "usuarios", usuarioID), {
            email,
            rol
        });

        await signOut(auth);

        mensaje.className = "text-success";
        mensaje.textContent = "Trabajador creado. Vuelve a iniciar sesión con tu cuenta.";

        setTimeout(() => {
            ipcRenderer.send("cambiar-pagina", "login.html");
        }, 1400);
    } catch (error) {
        mensaje.className = "text-danger";
        if (error.code === "auth/email-already-in-use") {
            mensaje.textContent = "Ese correo ya existe.";
            return;
        }
        mensaje.textContent = `Error: ${error.message}`;
    }
});

btnVolver.addEventListener("click", () => {
    ipcRenderer.send("cambiar-pagina", "login.html");
});
