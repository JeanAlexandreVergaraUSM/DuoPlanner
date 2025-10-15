import { auth, db } from './firebase.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  // getRedirectResult,  // ya no lo necesitamos aquí
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { $, state, updateDebug } from './state.js';
import { listenProfile, reflectProfileInSemestersUI } from './profile.js';
import { loadMyPair } from './pair.js';
import { clearActiveSemester, refreshSemestersSub } from './semesters.js'; // ⬅️ importante
import { clearProfileUI } from './profile.js';
import { stopSemestersSub} from './semesters.js';

function setNonProfileTabsDisabled(disabled) {
  document.querySelectorAll('.nav-tab[data-route]').forEach(btn => {
    if (btn.dataset.route !== '#/perfil') {
      btn.toggleAttribute('disabled', disabled);     // true → pone disabled, false → lo quita
      btn.setAttribute('aria-disabled', String(disabled));
    }
  });
}

export function initAuth() {


  if (window.__duoplannerAuthInit) return;
  window.__duoplannerAuthInit = true;

  const signInBtn  = $('signInBtn');
  const signOutBtn = $('signOutBtn');
  const switchBtn  = $('switchAccountBtn'); 
  const userBadge  = $('userBadge');
  const userNameEl = $('userName');

  // Helpers UI
const setAuthLoading = (loading) => {
  if (signInBtn)  signInBtn.disabled  = loading;
  if (signOutBtn) signOutBtn.disabled = loading;
  if (switchBtn)  switchBtn.disabled  = loading;
};

  const showSignedIn = (nameOrEmail) => {
  if (userBadge)  { userBadge.classList.remove('hidden'); userBadge.style.display = 'inline-flex'; }
  if (signInBtn)  { signInBtn.classList.add('hidden');  signInBtn.style.display = 'none'; }
  if (userNameEl) userNameEl.textContent  = nameOrEmail || '—';
  const createPairBtn = $('createPairBtn');
  const copyInviteBtn = $('copyInviteBtn');
  if (createPairBtn) createPairBtn.disabled = false;
  if (copyInviteBtn) copyInviteBtn.disabled = false;

  setNonProfileTabsDisabled(false); 
};
  const showSignedOut = () => {
  if (userBadge)  { userBadge.classList.add('hidden'); userBadge.style.display = 'none'; }
  if (signInBtn)  { signInBtn.classList.remove('hidden'); signInBtn.style.display = 'inline-block'; }

  const pairId = $('pairId');
  const copyInviteBtn = $('copyInviteBtn');
  const createPairBtn = $('createPairBtn');
  if (pairId) pairId.textContent = '—';
  if (copyInviteBtn) copyInviteBtn.disabled = true;
  if (createPairBtn) createPairBtn.disabled = true;

  state.profileData = null;
  reflectProfileInSemestersUI();
  clearActiveSemester();
  const semList = $('semestersList');
  if (semList) semList.innerHTML = '';

  setNonProfileTabsDisabled(true);    // ✅ deshabilita todo menos Perfil
  location.hash = '#/perfil';   
};

  // Listeners de botones (defensivo si no existen aún)
if (signInBtn) {
  // Iniciar sesión
signInBtn.addEventListener('click', async () => {
  setAuthLoading(true);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'auth/popup-blocked') {
      // 👉 solo si el navegador bloqueó el pop-up, ofrece redirect
      // (opcional) pide confirmación para evitar sorpresas
      // if (confirm('Tu navegador bloqueó el pop-up. ¿Usar redirección?')) {
      //   await signInWithRedirect(auth, provider);
      // }
      // Si NO quieres redirección jamás, deja vacío este bloque.
    } else if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/user-cancelled' // por si aparece en algún navegador
    ) {
      // Usuario cerró/canceló: NO reintentes, NO redirect
      // opcional: muestra un mensaje suave en consola y listo.
      console.log('Login cancelado por el usuario.');
    } else {
      alert(`No se pudo iniciar sesión: ${code || e.message || e}`);
    }
  } finally {
    setAuthLoading(false);
  }
});

}

if (switchBtn) {
  switchBtn.addEventListener('click', async () => {
  setAuthLoading(true);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signOut(auth);
    // limpia UI al tiro (tu código de limpieza aquí)…

    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'auth/popup-blocked') {
      // (opcional) permitir redirect SOLO si fue bloqueo real
      // if (confirm('El pop-up fue bloqueado. ¿Usar redirección?')) {
      //   await signInWithRedirect(auth, provider);
      // }
    } else if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/user-cancelled'
    ) {
      console.log('Cambio de cuenta cancelado por el usuario.');
    } else {
      alert(`No se pudo cambiar de cuenta: ${code || e.message || e}`);
    }
  } finally {
    setAuthLoading(false);
  }
});

}




if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    setAuthLoading(true);
    try {
      await signOut(auth);

      // 🔻 corta TODO y limpia UI al instante
      state.currentUser = null;
      state.profileData = null;
      state.unsubscribeProfile?.(); state.unsubscribeProfile = null; // perfil
      stopSemestersSub?.();                                         // semestres
      clearActiveSemester();
      clearProfileUI();
      showSignedOut();
      updateDebug();

    } catch (e) {
      console.error(e);
      alert(`No se pudo cerrar sesión: ${e.code || e.message || e}`);
    } finally {
      setAuthLoading(false);
    }
  });
}


  // Suscripción al estado de autenticación
  onAuthStateChanged(auth, async (user) => {
    state.currentUser = user || null;
    setAuthLoading(false);

    if (user) {
      showSignedIn(user.displayName || user.email || user.uid);

      // Asegura doc de usuario
      try {
        await ensureUserDoc(user);
      } catch (e) {
        console.error('ensureUserDoc failed:', e);
      }

      // Perfil + Pair
      try {
        listenProfile();                 // escucha cambios del perfil
        await loadMyPair();              // intenta cargar pair existente (si lo hay)
        reflectProfileInSemestersUI();   // habilita crear semestre si hay universidad
        // tarjeta con el perfil de la duo (si existe)
        import('./profile.js').then(m => m.mountPartnerProfileCard?.()).catch(()=>{});
      } catch (e) {
        console.error('profile/pair init failed:', e);
      }

      // Semestres
      try {
        refreshSemestersSub();           // lista/suscribe semestres del usuario
      } catch (e) {
        console.error('refreshSemestersSub failed:', e);
      }

      updateDebug();
    } else {
      showSignedOut();
      updateDebug();
    }
  });
}

async function ensureUserDoc(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // Primera vez
    await setDoc(ref, {
      createdAt: Date.now(),
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      providerId: user.providerData?.[0]?.providerId || 'google',
      preferences: { showNamesInShared: true, theme: 'dark' },
      lastLoginAt: Date.now(),
    }, { merge: true });
  } else {
    // Actualizaciones posteriores (no tocamos createdAt)
    await setDoc(ref, {
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      providerId: user.providerData?.[0]?.providerId || 'google',
      lastLoginAt: Date.now(),
    }, { merge: true });
  }
}

export async function aiLogout() {
  try { await signOut(auth); } catch (e) { console.error(e); }
}

export async function aiSwitchAccount() {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signOut(auth);
    await signInWithPopup(auth, provider);
  } catch (e) { console.error(e); }
}
