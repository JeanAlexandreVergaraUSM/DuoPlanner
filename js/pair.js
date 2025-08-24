// js/pair.js
import { db } from './firebase.js';
import {
  collection, doc, setDoc, getDoc, getDocs, updateDoc, arrayUnion, arrayRemove, query, deleteDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, state, updateDebug } from './state.js';

let unsubPairDoc = null; // ⬅️ nueva: para cortar la suscripción al documento del pair


export function initPair(){
  const createPairBtn = $('createPairBtn'), copyInviteBtn = $('copyInviteBtn');
  const joinByCodeBtn = $('joinByCodeBtn'), joinCode = $('joinCode');
  const deletePairBtn = $('deletePairBtn');

  createPairBtn.addEventListener('click', createPair);

  // Copiar solo el ID (no el link)
  copyInviteBtn.addEventListener('click', copyInvite);

  // Unirse aceptando ID o link; también con Enter
  const doJoin = async ()=>{
    const raw = (joinCode.value || '').trim();
    const pid = parsePairId(raw);
    if (pid) await joinPair(pid);
    else alert('Pega un ID válido (o un link con ?pair=ID).');
    joinCode.value = '';
  };
  joinByCodeBtn.addEventListener('click', doJoin);
  joinCode.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') doJoin(); });

  if (deletePairBtn){
    deletePairBtn.addEventListener('click', deletePair);
  }
}

// Carga el pair actual del usuario. Si está en varios (herencia antigua),
// elige el más reciente por createdAt y limpia el UI.
export async function loadMyPair(){
  if (!state.currentUser) return;

  const qy = query(collection(db,'pairs'));
  const snap = await getDocs(qy);

  let mine = [];
  snap.forEach(d=>{
    const data = d.data() || {};
    if (Array.isArray(data.members) && data.members.includes(state.currentUser.uid)){
      mine.push({ id: d.id, ...data });
    }
  });

  // Escoge el más nuevo (mayor createdAt); si falta createdAt, ordena al final
  mine.sort((a,b)=>{
    const ca = Number(a.createdAt)||0, cb = Number(b.createdAt)||0;
    return cb - ca;
  });

  const current = mine[0] || null;
  state.currentPairId = current?.id || null;
  state.pairOtherUid  = current ? (current.members||[]).find(u=>u!==state.currentUser.uid) || null : null;

  $('pairId').textContent = state.currentPairId || '—';
  $('copyInviteBtn').disabled = !state.currentPairId;
  lockSharedIfNeeded();
  updateDebug();
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));

  // ⬅️ Suscríbete al doc del pair para reflejar en vivo cuando el otro se une/sale
  watchCurrentPairDoc(state.currentPairId);
}

// agrega este helper si quieres usarlo en otros módulos
export function getOtherUid(){ return state.pairOtherUid || null; }

async function createPair(){
  if (!state.currentUser) return;

  // crea el nuevo pair
  const ref = doc(collection(db,'pairs'));
  await setDoc(ref,{
    members:[state.currentUser.uid],
    createdAt: Date.now(),
    visibility:{ showCourseNames:true, showOnlyBusyFree:false }
  });

  // abandona cualquier otro pair previo para evitar “engancharse” al antiguo
  await leaveOtherPairs(ref.id);

  state.currentPairId = ref.id;
  state.pairOtherUid  = null;

  $('pairId').textContent = ref.id;
  $('copyInviteBtn').disabled = false;
  lockSharedIfNeeded();
  updateDebug();
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));

  // ⬅️ empieza a escuchar el pair recién creado
  watchCurrentPairDoc(ref.id);
}

// Copiar SOLO el ID actual (no el link)
function copyInvite(){
  if (!state.currentPairId) return;
  navigator.clipboard.writeText(state.currentPairId);
  const btn = $('copyInviteBtn');
  btn.textContent='¡ID copiado!';
  setTimeout(()=>btn.textContent='Copiar ID',1800);
}

// Acepta un ID “pelado” o un link con ?pair=ID y devuelve el ID
function parsePairId(input){
  if (!input) return '';
  const s = String(input).trim();

  // 1) Si parece URL, intenta leer ?pair=...
  try {
    const u = new URL(s);
    const q = u.searchParams.get('pair');
    if (q) return q.trim();
  } catch(_){ /* no era URL, seguimos */ }

  // 2) Buscar ?pair= en un texto pegado
  const m = s.match(/[?&]pair=([A-Za-z0-9_-]+)/);
  if (m) return m[1];

  // 3) Fallback: limpiar y aceptar A–Z, a–z, 0–9, _ y -
  const cleaned = s.replace(/[^A-Za-z0-9_-]/g,'');
  return cleaned || '';
}

export async function joinPair(pairId){
  if (!state.currentUser) return;

  const ref = doc(db,'pairs',pairId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert('El ID de party no existe'); return; }

  const data = snap.data() || {};
  if (!Array.isArray(data.members)) data.members = [];

  // Únete si aún no estás en este pair
  if (!data.members.includes(state.currentUser.uid)){
    await updateDoc(ref,{ members: arrayUnion(state.currentUser.uid) });
  }

  // Abandona cualquier otro pair donde estuvieras antes
  await leaveOtherPairs(pairId);

  // Relee y establece estado
  const final = (await getDoc(ref)).data() || {};
  state.currentPairId = pairId;
  state.pairOtherUid  = (final.members || []).find(u => u !== state.currentUser.uid) || null;

  $('pairId').textContent = pairId;
  $('copyInviteBtn').disabled = false;
  lockSharedIfNeeded();
  updateDebug();
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));

  // ⬅️ escucha el pair al que te uniste
  watchCurrentPairDoc(pairId);
}

// 🔹 NUEVO: escuchar en vivo el documento del pair actual
function watchCurrentPairDoc(pid){
  // corta anterior
  if (unsubPairDoc){ unsubPairDoc(); unsubPairDoc = null; }
  if (!pid) return;

  const ref = doc(db,'pairs', pid);
  unsubPairDoc = onSnapshot(ref, (snap)=>{
    if (!snap.exists()){
      // el pair fue eliminado por completo
      clearPairState();
      return;
    }
    const d = snap.data() || {};
    const members = Array.isArray(d.members) ? d.members : [];
    const other = members.find(u => u !== state.currentUser?.uid) || null;

    state.currentPairId = pid;
    state.pairOtherUid  = other;

    $('pairId').textContent = pid;
    $('copyInviteBtn').disabled = false;
    lockSharedIfNeeded();
    updateDebug();
    // Notifica a las vistas compartidas (perfil, horario, notas, malla)
    document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));
  }, (_err)=>{
    // en caso de error de suscripción, no rompemos la UI
  });
}

// 🔹 Eliminar pair (dejar de estar vinculado)
// 🔹 Eliminar pair para TODOS (disolver party)
export async function deletePair(){
  if (!state.currentUser || !state.currentPairId) return;

  const pid = state.currentPairId;
  const ref = doc(db,'pairs', pid);

  // Confirmación (puedes personalizar el texto)
  if (!confirm('¿Quieres eliminar la party para ambos? Tu pareja también saldrá.')) return;

  try {
    // ✅ Disuelve la party borrando el documento completo
    await deleteDoc(ref);
  } catch (e) {
    // Si por reglas de seguridad no pudieras borrar directamente,
    // intenta primero vaciar "members" y luego borrar.
    try {
      await updateDoc(ref, { members: [] });
      await deleteDoc(ref);
    } catch(_){}
  }

  // Limpia estado local (tu cliente)
  clearPairState();
  alert('Party eliminada para ambos.');
}


// Quita vínculos de pairs viejos manteniendo el par actual (exceptId)
async function leaveOtherPairs(exceptId){
  const qy = query(collection(db,'pairs'));
  const snap = await getDocs(qy);
  const uid = state.currentUser.uid;

  const tasks = [];
  snap.forEach(d=>{
    const data = d.data() || {};
    if (d.id !== exceptId && Array.isArray(data.members) && data.members.includes(uid)){
      tasks.push(updateDoc(doc(db,'pairs',d.id), { members: arrayRemove(uid) })
        .then(async ()=>{
          // Si luego queda vacío, bórralo
          const s2 = await getDoc(doc(db,'pairs',d.id));
          const ms = s2.exists()? (s2.data().members||[]) : [];
          if (ms.length === 0){
            try{ await deleteDoc(doc(db,'pairs',d.id)); }catch(_){}
          }
        })
      );
    }
  });
  await Promise.all(tasks);
}

function clearPairState(){
  // corta escucha del doc
  if (unsubPairDoc){ unsubPairDoc(); unsubPairDoc = null; }

  state.currentPairId = null;
  state.pairOtherUid  = null;
  $('pairId').textContent = '—';
  $('copyInviteBtn').disabled = true;
  lockSharedIfNeeded();
  updateDebug();
  document.dispatchEvent(new CustomEvent('pair:ready', { detail: { otherUid: state.pairOtherUid }}));
}

export function lockSharedIfNeeded(){
  const hasPair = !!(state.currentPairId && state.pairOtherUid);
  const subtabCompartido = $('subtabCompartido'), horarioCompartido = $('horarioCompartido');
  subtabCompartido?.setAttribute('aria-disabled', hasPair ? 'false' : 'true');
  if (!hasPair){
    horarioCompartido?.classList.add('disabled');
    horarioCompartido.innerHTML = `<div class="muted">Horario de tu pareja (debes emparejarte primero).</div>`;
  } else {
    horarioCompartido?.classList.remove('disabled');
  }
}
