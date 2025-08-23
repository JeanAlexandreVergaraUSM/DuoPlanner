// js/firebase.js
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyB45g_2KRGlXH0iAPyBGuCnrFkhxCHadKs",
  authDomain: "nacholo.firebaseapp.com",
  projectId: "nacholo",
  storageBucket: "nacholo.appspot.com",
  messagingSenderId: "924503328068",
  appId: "1:924503328068:web:1f753ced7f47ec36750311"
};

// Reusar instancia si ya existe (evita errores en hot-reloads o múltiples imports)
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Auth con persistencia local (por defecto ya lo es, pero lo dejamos explícito)
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => { /* ignora navegadores raros */ });

// Firestore + cache offline (si está disponible)
export const db = getFirestore(app);
enableIndexedDbPersistence(db).catch(() => { /* p.ej. Safari privado o múltiples tabs en conflicto */ });
