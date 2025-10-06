// js/pair.js
import { db } from './firebase.js';
import {
  collection, doc, setDoc, getDoc, getDocs,
  updateDoc, arrayUnion, arrayRemove, query,
  deleteDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, state, updateDebug } from './state.js';

let unsubPairDoc = null; // para cortar la suscripción al documento del pair

// --- DEBUG helper (activar con ?debug en la URL o window.duoplannerDebug = true) ---
const DP_DEBUG = new URLSearchParams(location.search).has('debug') || (window?.duoplannerDebug ?? false);
const TS  = () => new Date().toISOString().split('T')[1].replace('Z','');
const GRP = (title, obj) => {
  if (!DP_DEBUG) return;
  console.groupCollapsed(`[PAIR ${TS()}] ${title}`);
  console.groupEnd();
};

export function initPair() {
  const createPairBtn   = $('createPairBtn');
  const copyInviteBtn   = $('copyInviteBtn');
  const joinByCodeBtn   = $('joinByCodeBtn');
  const joinCode        = $('joinCode');
  const deletePairBtn   = $('deletePairBtn');

  // listeners defensivos
  createPairBtn?.addEventListener('click', createPair);

  // Copiar solo el ID (no el link)
  copyInviteBtn?.addEventListener('click', copyInvite);

  const doJoin = async () => {
    const raw = (joinCode?.value || '').trim();
    const pid = parsePairId(raw);
    if (pid) {
      await joinPair(pid);
    } else {
      alert('Pega un ID válido (o un link con ?pair=ID).');
    }
    if (joinCode) joinCode.value = '';
  };
  joinByCodeBtn?.addEventListener('click', doJoin);
  joinCode?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  deletePairBtn?.addEventListener('click', deletePair);
}

// Carga el pair actual del usuario (si está en varios, elige el más reciente)
export async function loadMyPair() {
  if (!state.currentUser) return;

  const qy = query(collection(db, 'pairs'));
  const snap = await getDocs(qy);

  const mine = [];
  snap.forEach(d => {
    const data = d.data() || {};
    if (Array.isArray(data.members) && data.members.includes(state.currentUser.uid)) {
      mine.push({ id: d.id, ...data });
    }
  });

  // más nuevo por createdAt (usa Date.now() en este archivo)
  mine.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

  const current = mine[0] || null;
  state.currentPairId = current?.id || null;
  state.pairOtherUid  = current ? (current.members || []).find(u => u !== state.currentUser.uid) || null : null;

  const pairIdEl = $('pairId');
  const copyBtn  = $('copyInviteBtn');
  if (pairIdEl) pairIdEl.textContent = state.currentPairId || '—';
  if (copyBtn)  copyBtn.disabled     = !state.currentPairId;

  lockSharedIfNeeded();
  updateDebug();
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));

  // escucha cambios del pair actual
  watchCurrentPairDoc(state.currentPairId);
}

// helper para otros módulos
export function getOtherUid() { return state.pairOtherUid || null; }

async function createPair() {
  if (!state.currentUser) return;

  // crea el nuevo pair
  const ref = doc(collection(db, 'pairs'));
  await setDoc(ref, {
    members: [state.currentUser.uid],
    createdAt: Date.now(),
    visibility: { showCourseNames: true, showOnlyBusyFree: false }
  });

  // abandona otros pairs para evitar confusiones
  await leaveOtherPairs(ref.id);

  state.currentPairId = ref.id;
  state.pairOtherUid  = null;

  const pairIdEl = $('pairId');
  const copyBtn  = $('copyInviteBtn');
  if (pairIdEl) pairIdEl.textContent = ref.id;
  if (copyBtn)  copyBtn.disabled     = false;

  lockSharedIfNeeded();
  updateDebug();
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));

  // empieza a escuchar el pair recién creado
  watchCurrentPairDoc(ref.id);
}

// Copiar SOLO el ID actual (no el link) con fallback si clipboard falla
async function copyInvite() {
  if (!state.currentPairId) return;
  const id = state.currentPairId;

  const btn = $('copyInviteBtn');
  const ok  = await tryClipboardCopy(id);
  if (!ok) fallbackCopy(id);

  if (btn) {
    const old = btn.textContent;
    btn.textContent = '¡ID copiado!';
    setTimeout(() => { btn.textContent = old || 'Copiar ID'; }, 1800);
  }
}

async function tryClipboardCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(_) {}
  document.body.removeChild(ta);
}

// Acepta un ID “pelado” o un link con ?pair=ID y devuelve el ID
function parsePairId(input) {
  if (!input) return '';
  const s = String(input).trim();

  // 1) si parece URL, intenta leer ?pair=...
  try {
    const u = new URL(s);
    const q = u.searchParams.get('pair');
    if (q) return q.trim();
  } catch(_) { /* no era URL */ }

  // 2) buscar ?pair= en un texto pegado
  const m = s.match(/[?&]pair=([A-Za-z0-9_-]+)/);
  if (m) return m[1];

  // 3) fallback: limpiar y aceptar A–Z, a–z, 0–9, _ y -
  const cleaned = s.replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned || '';
}

export async function joinPair(pairId) {
  if (!state.currentUser) return;

  const ref = doc(db, 'pairs', pairId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert('El ID de party no existe'); return; }

  const data = snap.data() || {};
  const members = Array.isArray(data.members) ? data.members : [];

  // límite 2 miembros
  if (!members.includes(state.currentUser.uid) && members.length >= 2) {
    alert('Esta party ya tiene 2 miembros.');
    return;
  }

  // únete si aún no estás en este pair
  if (!members.includes(state.currentUser.uid)) {
    await updateDoc(ref, {
      members: arrayUnion(state.currentUser.uid),
      updatedAt: Date.now()
    });
  }

  // abandona otros pairs
  await leaveOtherPairs(pairId);

  // re-lee y establece estado
  const finalSnap = await getDoc(ref);
  const final     = finalSnap.data() || {};
  state.currentPairId = pairId;
  state.pairOtherUid  = (final.members || []).find(u => u !== state.currentUser.uid) || null;

  // 🔹 Guardar relación también dentro del perfil de cada usuario
  const userRef = doc(db, 'users', state.currentUser.uid);
  const updates = { pairUid: state.pairOtherUid || null, currentPairId: pairId };
  try {
    await updateDoc(userRef, updates);
  } catch {
    // Si no existe el doc raíz (usuario nuevo), créalo
    await setDoc(userRef, updates, { merge: true });
  }

  const pairIdEl = $('pairId');
  const copyBtn  = $('copyInviteBtn');
  if (pairIdEl) pairIdEl.textContent = pairId;
  if (copyBtn)  copyBtn.disabled     = false;

  lockSharedIfNeeded();
  updateDebug();

  // 🔹 Notificar para que el resto del sistema sepa del cambio
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));

  // escucha el pair al que te uniste
  watchCurrentPairDoc(pairId);
}


// Suscribirse al doc del pair para reflejar en vivo cambios
function watchCurrentPairDoc(pid) {
  // corta la escucha anterior si existía
  if (unsubPairDoc) { unsubPairDoc(); unsubPairDoc = null; }
  if (!pid) return;

  const ref   = doc(db, 'pairs', pid);
  const myUid = state.currentUser?.uid || null; // fija tu uid ahora

  unsubPairDoc = onSnapshot(ref, async (snap) => {
    if (!snap.exists()) {
      clearPairState();
      return;
    }
    const d = snap.data() || {};
    const members = Array.isArray(d.members) ? d.members : [];
    const other   = members.find(u => u !== myUid) || null;

    // actualiza SIEMPRE, aunque no haya otro todavía
    state.currentPairId = pid;
    state.pairOtherUid  = other;

    try {
      const userRef = doc(db, 'users', myUid);
      await setDoc(userRef, { pairUid: other || null, currentPairId: pid }, { merge: true });
    } catch (_) {}

    const pairIdEl = $('pairId');
    const copyBtn  = $('copyInviteBtn');
    if (pairIdEl) pairIdEl.textContent = pid;
    if (copyBtn)  copyBtn.disabled     = false;

    lockSharedIfNeeded();
    updateDebug();

    // notifica SIEMPRE a las demás vistas
    document.dispatchEvent(new CustomEvent('pair:ready', {
      detail: { otherUid: state.pairOtherUid }
    }));
  });
}

// Eliminar pair para TODOS (disolver party)
export async function deletePair() {
  if (!state.currentUser || !state.currentPairId) return;

  const pid = state.currentPairId;
  const ref = doc(db, 'pairs', pid);

  if (!confirm('¿Quieres eliminar la party para ambos? La otra persona también se saldrá.')) return;

  try {
    await deleteDoc(ref);
  } catch (e) {
    // si no se puede borrar directo, intenta vaciar y luego borrar
    try {
      await updateDoc(ref, { members: [] });
      await deleteDoc(ref);
    } catch(_){}
  }

  clearPairState();
  alert('Party eliminada para ambos.');
}

// Quita vínculos de pairs viejos manteniendo el par actual (exceptId)
async function leaveOtherPairs(exceptId) {
  const qy   = query(collection(db, 'pairs'));
  const snap = await getDocs(qy);
  const uid  = state.currentUser.uid;

  const tasks = [];
  snap.forEach(d => {
    const data = d.data() || {};
    if (d.id !== exceptId && Array.isArray(data.members) && data.members.includes(uid)) {
      tasks.push(
        updateDoc(doc(db, 'pairs', d.id), { members: arrayRemove(uid) })
          .then(async () => {
            // si queda vacío, bórralo
            const s2 = await getDoc(doc(db, 'pairs', d.id));
            const ms = s2.exists() ? (s2.data().members || []) : [];
            if (ms.length === 0) {
              try { await deleteDoc(doc(db, 'pairs', d.id)); } catch(_){}
            }
          })
      );
    }
  });
  await Promise.all(tasks);
}

function clearPairState() {
  // corta escucha del doc
  if (unsubPairDoc) { unsubPairDoc(); unsubPairDoc = null; }

  state.currentPairId = null;
  state.pairOtherUid  = null;

  const pairIdEl = $('pairId');
  const copyBtn  = $('copyInviteBtn');
  if (pairIdEl) pairIdEl.textContent = '—';
  if (copyBtn)  copyBtn.disabled     = true;

  lockSharedIfNeeded();
  updateDebug();
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));
}

export function lockSharedIfNeeded() {
  const hasPair = !!(state.currentPairId && state.pairOtherUid);
  const subtabCompartido  = $('subtabCompartido');
  const horarioCompartido = $('horarioCompartido');

  subtabCompartido?.setAttribute('aria-disabled', hasPair ? 'false' : 'true');
  if (subtabCompartido) subtabCompartido.disabled = !hasPair;   // ⬅️ NUEVO

  if (!horarioCompartido) return;
  if (!hasPair) {
    horarioCompartido.classList.add('disabled');
    horarioCompartido.innerHTML = `<div class="muted">Horario de la otra persona (debes emparejarte primero).</div>`;
  } else {
    horarioCompartido.classList.remove('disabled');
  }
}
