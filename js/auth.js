import { auth, db } from './firebase.js';
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { $, state, updateDebug } from './state.js';
import { listenProfile, reflectProfileInSemestersUI } from './profile.js';
import { loadMyPair } from './pair.js';
import { clearActiveSemester, refreshSemestersSub } from './semesters.js'; // ⬅️ importante

export function initAuth() {
  const signInBtn  = $('signInBtn');
  const signOutBtn = $('signOutBtn');
  const userBadge  = $('userBadge');
  const userNameEl = $('userName');

  // Helpers UI
  const setAuthLoading = (loading) => {
    if (signInBtn)  signInBtn.disabled  = loading;
    if (signOutBtn) signOutBtn.disabled = loading;
  };
  const showSignedIn = (nameOrEmail) => {
    if (userBadge)  userBadge.style.display = 'inline-flex';
    if (signInBtn)  signInBtn.style.display = 'none';
    if (userNameEl) userNameEl.textContent  = nameOrEmail || '—';
    // Habilitar acciones de pair en la UI básica (pair.js puede re‑ajustar luego)
    const createPairBtn = $('createPairBtn');
    const copyInviteBtn = $('copyInviteBtn');
    if (createPairBtn) createPairBtn.disabled = false;
    if (copyInviteBtn) copyInviteBtn.disabled = false;
  };
  const showSignedOut = () => {
    if (userBadge)  userBadge.style.display = 'none';
    if (signInBtn)  signInBtn.style.display = 'inline-block';

    // Reset controles de Pair visibles
    const pairId = $('pairId');
    const copyInviteBtn = $('copyInviteBtn');
    const createPairBtn = $('createPairBtn');
    if (pairId) pairId.textContent = '—';
    if (copyInviteBtn) copyInviteBtn.disabled = true;
    if (createPairBtn) createPairBtn.disabled = true;

    // Limpia perfil local y refleja en UI
    state.profileData = null;
    reflectProfileInSemestersUI();

    // Limpia semestre activo y lista
    clearActiveSemester();
    const semList = $('semestersList');
    if (semList) semList.innerHTML = '';
  };

  // Listeners de botones (defensivo si no existen aún)
  if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
      setAuthLoading(true);
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (e) {
        console.error(e);
        alert(`Fallo al iniciar sesión: ${e.code || e.message || e}`);
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
        await ensureUserDoc(user.uid);
      } catch (e) {
        console.error('ensureUserDoc failed:', e);
      }

      // Perfil + Pair
      try {
        listenProfile();                 // escucha cambios del perfil
        await loadMyPair();              // intenta cargar pair existente (si lo hay)
        reflectProfileInSemestersUI();   // habilita crear semestre si hay universidad
        // tarjeta con el perfil de la pareja (si existe)
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

async function ensureUserDoc(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      createdAt: Date.now(),
      preferences: { showNamesInShared: true, theme: 'dark' },
    });
  }
}
