// js/semesters.js
import { db } from './firebase.js';
import { $, state, updateDebug } from './state.js';
import {
  collection, addDoc, onSnapshot, doc, deleteDoc,
  query, orderBy, getDoc, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onActiveSemesterChanged } from './schedule.js';
import { onActiveSemesterChanged as calOnSem } from './calendar.js';
import { setCoursesSubscription, resetCourseForm, updateFormForUniversity } from './courses.js';

let unsubscribeSemesters = null;

export function initSemesters() {
  bindUI();
}

function bindUI() {
  // Crear semestre
  const btn = $('createSemesterBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!state.currentUser) { alert('Debes iniciar sesión.'); return; }
      const uniReadable = universityFromProfileReadable();
      if (!uniReadable) { alert('Completa tu universidad en Perfil.'); return; }

      const label = ($('semesterLabel')?.value || '').trim();
      if (!isValidLabel(label)) {
  alert('Formato de semestre inválido. Usa AAAA-1 o AAAA-2 (ej. 2025-2).');
  return;
}


      const ref = collection(db, 'users', state.currentUser.uid, 'semesters');

// 🔹 Evita crear otro semestre con el mismo label
const existing = await getDocs(query(ref, where('label', '==', label)));
if (!existing.empty) {
  alert('Ya existe un semestre con ese nombre.');
  return;
}

      await addDoc(ref, {
        label,
        universityAtThatTime: uniReadable,
        createdAt: Date.now()
      });
      if ($('semesterLabel')) $('semesterLabel').value = '';
      // Nota: si no hay activo, el snapshot activará el más reciente (desc).
    });
  }

  // Delegación: activar / eliminar
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // Activar
    if (t.matches('.sem-activate')) {
      if (!state.currentUser) { alert('Debes iniciar sesión.'); return; }
      const id = t.dataset.id;
      await setActiveSemester(id);
    }

    // Eliminar
    if (t.matches('.sem-delete')) {
      if (!state.currentUser) { alert('Debes iniciar sesión.'); return; }
      const id = t.dataset.id;
      if (!confirm('¿Eliminar este semestre?')) return;
      await deleteDoc(doc(db, 'users', state.currentUser.uid, 'semesters', id));
      if (state.activeSemesterId === id) clearActiveSemester();
    }
  });
}

export function refreshSemestersSub() {
  // Corta suscripción anterior
  if (unsubscribeSemesters) { unsubscribeSemesters(); unsubscribeSemesters = null; }
  if (!state.currentUser) return;

  const ref = collection(db, 'users', state.currentUser.uid, 'semesters');
  unsubscribeSemesters = onSnapshot(query(ref, orderBy('createdAt', 'desc')), (snap) => {
    const list = $('semestersList');
    if (!list) return;
    list.innerHTML = '';

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const item = document.createElement('div');
      item.className = 'course-item';
      item.innerHTML = `
  <div>
    <div><b>${d.label}</b> <span class="course-meta">· ${d.universityAtThatTime}</span></div>
  </div>
  <div class="inline">
    ${state.activeSemesterId === docSnap.id
      ? '<span class="course-meta">Activo</span>'
      : `<button class="ghost sem-activate" data-id="${docSnap.id}">Activar</button>`}
    <button class="danger sem-delete" data-id="${docSnap.id}">Eliminar</button>
  </div>
`;

      list.appendChild(item);
    });

    // Si no hay activo y hay semestres, activa el primero por UX
    if (!state.activeSemesterId && !snap.empty) {
      setActiveSemester(snap.docs[0].id);
    }
  });
}

export async function setActiveSemester(semId) {
  if (!state.currentUser || !semId) return;
  state.activeSemesterId = semId;

  // Carga datos del semestre activo
  const snap = await getDoc(doc(db, 'users', state.currentUser.uid, 'semesters', semId));
  state.activeSemesterData = snap.exists() ? snap.data() : null;

  // Refleja en UI (tarjeta de Semestres)
  const lblEl = $('activeSemesterLabel');
if (lblEl) lblEl.textContent = state.activeSemesterData?.label || '—';

const uniEl = $('activeSemesterUni');
if (uniEl) uniEl.textContent = state.activeSemesterData?.universityAtThatTime || '—';

  // 🔹 Refleja en UI (pestaña Notas)
  const grLabel = $('gr-activeSemLabel');
  if (grLabel) grLabel.textContent = state.activeSemesterData?.label || '—';

  // 🔹 Ajusta escala/umbral automáticamente según la U del semestre
  const uniCode = toInternalUniCode(state.activeSemesterData?.universityAtThatTime);
  const scaleSel = $('gr-scaleSel');
  const thr = $('gr-passThreshold');
  if (scaleSel) {
    scaleSel.value = (uniCode === 'UMAYOR') ? 'MAYOR' : 'USM'; // UMayor: 1–7, USM: 0–100
    scaleSel.disabled = true; // bloqueada porque viene de la U del semestre
  }
  if (thr) {
    thr.value = (uniCode === 'UMAYOR') ? 4.0 : 55;
  }

  // Habilita sección de ramos y ajusta formulario de cursos
  const coursesSection = $('coursesSection');
  if (coursesSection) coursesSection.classList.remove('hidden');
  updateFormForUniversity(uniCode);

  // Vuelve a escuchar ramos del semestre activo
  resetCourseForm();
  setCoursesSubscription();

  // Avisar al horario y calendario
  onActiveSemesterChanged();
  calOnSem?.();
  updateDebug();

  // Refresca la lista para que se vea "Activo"
  refreshSemestersSub();
}

export function clearActiveSemester() {
  state.activeSemesterId = null;
  state.activeSemesterData = null;

  // Tarjeta Semestres
  const lblEl = $('activeSemesterLabel');
if (lblEl) lblEl.textContent = '—';
  const uniEl = $('activeSemesterUni');
if (uniEl) uniEl.textContent = '—';
  const coursesSection = $('coursesSection');
  if (coursesSection) coursesSection.classList.add('hidden');

  // 🔹 Pestaña Notas
  const grLabel = $('gr-activeSemLabel');
if (grLabel) grLabel.textContent = '—';
  const scaleSel = $('gr-scaleSel');
  if (scaleSel) { scaleSel.value = 'USM'; scaleSel.disabled = true; }
  const thr = $('gr-passThreshold');
  if (thr) thr.value = '';

  onActiveSemesterChanged();
  updateDebug();
}

/* ---------- helpers ---------- */

// Reemplaza la función actual
function isValidLabel(str) {
  // Solo formato AAAA-1 o AAAA-2, sin restricciones de año
  return /^\d{4}-(1|2)$/.test(str || '');
}


function universityFromProfileReadable() {
  const d = state.profileData;
  if (!d || !d.university) return null;
  if (d.university === 'OTRA') return (d.customUniversity || '').trim() || null;
  if (d.university === 'UMAYOR') return 'Universidad Mayor';
  if (d.university === 'USM') return 'UTFSM';
  return d.university;
}

function toInternalUniCode(readable) {
  // Convierte "Universidad Mayor" -> UMAYOR, "UTFSM" -> USM
  if (!readable) return '';
  const r = readable.toLowerCase();
  if (r.includes('mayor')) return 'UMAYOR';
  if (r.includes('utfsm') || r.includes('santa maría') || r.includes('santa maria')) return 'USM';
  return 'OTRA';
}
