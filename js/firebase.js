const firebaseConfig = {
  apiKey: "AIzaSyCQuTwh0_X6Epy3WaEPIMSj8mkCIqBs-XQ",
  authDomain: "modaveli.firebaseapp.com",
  projectId: "modaveli",
  storageBucket: "modaveli.firebasestorage.app",
  messagingSenderId: "106350303564",
  appId: "1:106350303564:web:df06bc0bc151246172d7e9"
};

let firebaseGlobal = window.firebase;

if (!firebaseGlobal && typeof require === "function") {
  // Fallback para entornos Electron con NodeIntegration donde los scripts
  // compat pueden resolverse como CommonJS en vez de adjuntarse a window.
  const appCompat = require("../node_modules/firebase/firebase-app-compat.js");
  require("../node_modules/firebase/firebase-firestore-compat.js");
  require("../node_modules/firebase/firebase-auth-compat.js");

  firebaseGlobal = window.firebase || appCompat.default || appCompat;
}

if (!firebaseGlobal) {
  throw new Error("Firebase no esta cargado. Verifica los scripts compat en la pagina HTML.");
}

const app = firebaseGlobal.apps.length
  ? firebaseGlobal.app()
  : firebaseGlobal.initializeApp(firebaseConfig);

// Exportamos la Base de Datos Y la Autenticación
export const db = app.firestore();
export const auth = app.auth();

function wrapDocSnapshot(snapshot) {
  return {
    id: snapshot.id,
    ref: snapshot.ref,
    data: () => snapshot.data(),
    exists: () => snapshot.exists
  };
}

export function onAuthStateChanged(authInstance, callback) {
  return authInstance.onAuthStateChanged(callback);
}

export function signOut(authInstance) {
  return authInstance.signOut();
}

export function signInWithEmailAndPassword(authInstance, email, password) {
  return authInstance.signInWithEmailAndPassword(email, password);
}

export function createUserWithEmailAndPassword(authInstance, email, password) {
  return authInstance.createUserWithEmailAndPassword(email, password);
}

export function getCurrentUser() {
  return auth.currentUser;
}

export async function updateCurrentUserEmail(newEmail, currentPassword) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No hay usuario autenticado.");
  }

  const credential = firebaseGlobal.auth.EmailAuthProvider.credential(user.email, currentPassword);
  await user.reauthenticateWithCredential(credential);
  await user.updateEmail(newEmail);
}

export async function updateCurrentUserPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No hay usuario autenticado.");
  }

  const credential = firebaseGlobal.auth.EmailAuthProvider.credential(user.email, currentPassword);
  await user.reauthenticateWithCredential(credential);
  await user.updatePassword(newPassword);
}

export function collection(dbInstance, path) {
  return dbInstance.collection(path);
}

export function doc(dbInstance, ...segments) {
  return dbInstance.doc(segments.join("/"));
}

export async function getDoc(docRef) {
  const snapshot = await docRef.get();
  return wrapDocSnapshot(snapshot);
}

export function getDocs(queryRef) {
  return queryRef.get();
}

export function onSnapshot(refOrQuery, next, error) {
  return refOrQuery.onSnapshot((snapshot) => {
    const isDocSnapshot = typeof snapshot.exists === "boolean" && !snapshot.docs;
    next(isDocSnapshot ? wrapDocSnapshot(snapshot) : snapshot);
  }, error);
}

export function setDoc(docRef, data, options) {
  return docRef.set(data, options);
}

export function updateDoc(docRef, data) {
  return docRef.update(data);
}

export function addDoc(collectionRef, data) {
  return collectionRef.add(data);
}

export function deleteDoc(docRef) {
  return docRef.delete();
}

export function query(baseRef, ...constraints) {
  return constraints.reduce((acc, applyConstraint) => applyConstraint(acc), baseRef);
}

export function orderBy(field, direction = "asc") {
  return (ref) => ref.orderBy(field, direction);
}

export function where(field, op, value) {
  return (ref) => ref.where(field, op, value);
}

export function limit(count) {
  return (ref) => ref.limit(count);
}