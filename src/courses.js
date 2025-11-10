// js/courses.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import {
  collection, addDoc, onSnapshot, doc, deleteDoc, query, orderBy,
  setDoc, getDoc, getDocs, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { onCoursesChanged as gradesOnCourses } from './grades.js';

// Escala por defecto según la universidad del semestre activo
let defaultCourseScale = 'USM';

/* ===== Helpers ===== */
function makeCourseBase({ name = 'Sin nombre', code = '', professor = '', section = '', scale = defaultCourseScale, color = '#3B82F6', asistencia = false } = {}) {
  return {
    name: String(name).trim(),
    code: String(code).trim(),
    professor: String(professor).trim(),
    section: String(section).trim(),
    scale,
    color: String(color).trim(),
    asistencia: !!asistencia,   // ✅ nuevo campo
    createdAt: Date.now()
  };
}


async function findCourseDoc(courseName, semId = null) {
  if (!state.currentUser) throw new Error('No hay usuario activo');
  const semesterId = semId || state.activeSemesterId;
  if (!semesterId) throw new Error('No hay semestre activo');

  const ref = collection(db, 'users', state.currentUser.uid, 'semesters', semesterId, 'courses');
  const snap = await getDocs(ref);
  const match = snap.docs.find(d => (d.data().name || '').toLowerCase().includes(courseName.toLowerCase()));

  if (!match) throw new Error(`Curso "${courseName}" no encontrado`);
  return match; // docSnap
}

/* ===== API pública ===== */
export function initCourses(){ bindUI(); }
export function setCoursesSubscription(){ subscribeCourses(); }
export function resetCourseForm(){ _resetCourseForm(); }

export function updateFormForUniversity(uniCode){
  defaultCourseScale = (uniCode === 'UMAYOR') ? 'MAYOR' : 'USM';
  const lbl = $('sectParLabel');
  if (lbl) lbl.textContent = (uniCode === 'USM') ? 'Paralelo' : 'Sección/Paralelo';

  const scaleSel = $('courseScale');
  const field = scaleSel?.closest?.('.form-field');
  if (field) field.classList.add('hidden');
  if (scaleSel){ scaleSel.value = defaultCourseScale; scaleSel.disabled = true; }

  const hint = $('scaleHint');
  if (hint){
    hint.textContent = (defaultCourseScale === 'MAYOR')
      ? 'Escala: UMayor (1–7) · tomada desde tu Perfil'
      : 'Escala: USM (0–100) · tomada desde tu Perfil';
  }
}

/* ===== Estado local ===== */
let unsubscribeCourses = null;

/* ===== UI ===== */
function bindUI(){
  const saveBtn   = $('saveCourseBtn');
  const cancelBtn = $('cancelEditBtn');
  const colorInp = $('courseColor');
  const colorCode = $('courseColorCode');
  colorInp?.addEventListener('input', () => {
    if (colorCode) colorCode.textContent = colorInp.value.toUpperCase();
  });

  saveBtn?.addEventListener('click', async () => { await saveCourse(); });
  cancelBtn?.addEventListener('click', () => _resetCourseForm());

  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.matches('.course-edit')) {
      const id = t.dataset.id;
      if (!id || !state.currentUser || !state.activeSemesterId) return;
      const ref = doc(db, 'users', state.currentUser.uid, 'semesters', state.activeSemesterId, 'courses', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      $('courseName').value       = d.name || '';
      $('courseCode').value       = d.code || '';
      $('courseProfessor').value  = d.professor || '';
      $('courseSectPar').value    = d.section || '';
      $('courseColor').value      = d.color || '#3B82F6';
      $('courseColorCode').textContent = (d.color || '#3B82F6').toUpperCase();
      state.editingCourseId = id;
      $('saveCourseBtn').textContent = 'Guardar cambios';
      $('cancelEditBtn')?.classList.remove('hidden');
      $('courseAsistencia').checked = !!d.asistencia;

    }

    if (t.matches('.course-del')) {
      const id = t.dataset.id;
      if (id) await deleteCourse(id);
    }
  });
}

/* ===== Suscripción ===== */
function subscribeCourses(){
  if (unsubscribeCourses){ unsubscribeCourses(); unsubscribeCourses = null; }

  if (!state.currentUser || !state.activeSemesterId) {
    state.courses = [];
    document.dispatchEvent(new Event('courses:changed'));
    return;
  }

  const ref = collection(db, 'users', state.currentUser.uid, 'semesters', state.activeSemesterId, 'courses');

  // 🔸 Opción A (segura): sin orderBy en Firestore + orden local
  // --- Agrega este helper antes de subscribeCourses (arriba en el archivo si no lo tienes) ---
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// --- Y luego reemplaza dentro de subscribeCourses() ---
unsubscribeCourses = onSnapshot(ref, debounce((snap) => {
  const list = snap.docs.map(d => {
    const data = d.data() || {};
    return {
      id: d.id,
      ...data,
      createdAtMs:
        data.createdAt instanceof Timestamp ? data.createdAt.toMillis() :
        typeof data.createdAt === 'number' ? data.createdAt :
        0
    };
  });

  list.sort((a, b) => b.createdAtMs - a.createdAtMs);
  state.courses = list;

  renderCourses(snap);
  gradesOnCourses?.();
  document.dispatchEvent(new Event('courses:changed'));
}, 300)); // 🔹 Espera 300ms entre renders consecutivos


  // 🔹 Más adelante, si todo bien, puedes volver a:
  // unsubscribeCourses = onSnapshot(query(ref, orderBy('createdAt','desc')), handler)
}


function renderCourses(snap){
  const host = $('coursesList');
  if (!host) return;
  host.innerHTML = '';
  snap.forEach(docSnap => {
    const d = docSnap.data();
    const item = document.createElement('div');
    item.className = 'course-item';
    item.innerHTML = `
      <div>
        <div><b>${escapeHtml(d.name || 'Sin nombre')}</b> <span class="course-meta">· ${escapeHtml(d.code || '')}</span></div>
        <div class="course-meta">${escapeHtml(d.professor || '')}</div>
      </div>
      <div class="inline">
        <button class="ghost course-edit" data-id="${docSnap.id}">Editar</button>
        <button class="danger course-del"  data-id="${docSnap.id}">Eliminar</button>
      </div>
    `;
    host.appendChild(item);
  });
}




/* ===== CRUD ===== */
async function saveCourse(){
  if (!state.currentUser || !state.activeSemesterId) {
    alert('Primero inicia sesión y selecciona/crea un semestre.');
    return;
  }

  const name      = ($('courseName')?.value || '').trim();
  const code      = ($('courseCode')?.value || '').trim();
  const professor = ($('courseProfessor')?.value || '').trim();
  const section   = ($('courseSectPar')?.value || '').trim();
  const color     = ($('courseColor')?.value || '#3B82F6').trim();
  const scale     = defaultCourseScale;
  const asistencia = $('courseAsistencia')?.checked || false;



  if (!name){ alert('Ingresa el nombre del ramo.'); return; }

  const saveBtn   = $('saveCourseBtn');
  const cancelBtn = $('cancelEditBtn');
  if (saveBtn) saveBtn.disabled = true;

  try{
    const base = { name, code, professor, section, scale, color, asistencia };


    if (state.editingCourseId){
  // update
  const ref = doc(db, 'users', state.currentUser.uid, 'semesters', state.activeSemesterId, 'courses', state.editingCourseId);
  await setDoc(ref, base, { merge: true });
} else {
  // create
  const ref = collection(db, 'users', state.currentUser.uid, 'semesters', state.activeSemesterId, 'courses');
  await addDoc(ref, { ...base, createdAt: serverTimestamp() });  // ✅
}


    _resetCourseForm();
    gradesOnCourses?.();
  } catch(e){
    console.error(e);
    alert(`No se pudo guardar el ramo: ${e?.message || e}`);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    cancelBtn?.classList.add('hidden');
  }
}


async function deleteCourse(id){
  if (!state.currentUser || !state.activeSemesterId) return;
  if (!confirm('¿Eliminar este ramo?')) return;
  try{
    await deleteDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses',id));
    if (state.editingCourseId===id) _resetCourseForm();
    gradesOnCourses?.();
  } catch(e){
    console.error(e);
    alert(`No se pudo eliminar: ${e?.message || e}`);
  }
}

/* ===== Utils ===== */
function _resetCourseForm(){
  state.editingCourseId = null;
  const name = $('courseName');       if (name) name.value = '';
  const code = $('courseCode');       if (code) code.value = '';
  const prof = $('courseProfessor');  if (prof) prof.value = '';
  const sect = $('courseSectPar');    if (sect) sect.value = '';
  const color= $('courseColor');      if (color) color.value = '#3B82F6';
  const colorCode = $('courseColorCode'); if (colorCode) colorCode.textContent = '#3B82F6';
  const saveBtn = $('saveCourseBtn'); if (saveBtn) saveBtn.textContent = 'Agregar ramo';
  $('cancelEditBtn')?.classList.add('hidden');
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s]));
}

/* ---------- API para el asistente IA ---------- */
export async function addCourseToSemester(name, semLabelOrId = null, color = '#3B82F6') {
  const semId = semLabelOrId || state.activeSemesterId;
  if (!semId) throw new Error('No hay semestre activo');
  const ref = collection(db, 'users', state.currentUser.uid, 'semesters', semId, 'courses');
  const base = makeCourseBase({ name, color, scale: 'USM' });
  await addDoc(ref, base);
}

export async function removeCourseFromSemester(name, semId = null) {
  const match = await findCourseDoc(name, semId);
  await deleteDoc(match.ref);
}

export async function getCourseInfo(nameOrCode, semId = null) {
  const match = await findCourseDoc(nameOrCode, semId);
  const semesterId = semId || state.activeSemesterId;

  const rulesRef = collection(db, 'users', state.currentUser.uid, 'semesters', semesterId, 'courses', match.id, 'rules');
  const rulesSnap = await getDocs(rulesRef);

  const rules = [];
  for (const r of rulesSnap.docs) {
    const rd = r.data();
    const gradesRef = collection(r.ref, 'grades');
    const gradesSnap = await getDocs(gradesRef);
    const grades = gradesSnap.docs.map(g => ({ id:g.id, ...g.data() }));
    rules.push({ id:r.id, ...rd, grades });
  }

  return {
    name: match.data().name || '',
    code: match.data().code || '',
    professor: match.data().professor || '',
    section: match.data().section || '',
    color: match.data().color || '',
    scale: match.data().scale || '',
    rules
  };
}

export async function listRules(courseName, semId = null) {
  const match = await findCourseDoc(courseName, semId);
  const rulesRef = collection(match.ref, 'rules');
  const rulesSnap = await getDocs(rulesRef);
  return rulesSnap.docs.map(r => r.data());
}

export async function addRule(courseName, rule) {
  const match = await findCourseDoc(courseName);
  const rulesRef = collection(match.ref, 'rules');
  await addDoc(rulesRef, rule);
  return { ok:true };
}

export async function removeRule(courseName, tipo) {
  const match = await findCourseDoc(courseName);
  const rulesRef = collection(match.ref, 'rules');
  const rulesSnap = await getDocs(rulesRef);
  const target = rulesSnap.docs.find(r => (r.data().tipo||'').toLowerCase() === tipo.toLowerCase());
  if (!target) throw new Error('No encontré esa regla');
  await deleteDoc(doc(db, rulesRef.path, target.id));
  return { ok:true };
}

export async function addGrade(courseName, ruleTipo, valor, comentario='') {
  const match = await findCourseDoc(courseName);
  const rulesRef = collection(match.ref, 'rules');
  const rulesSnap = await getDocs(rulesRef);
  const ruleDoc = rulesSnap.docs.find(r => (r.data().tipo || '').toLowerCase().includes(ruleTipo.toLowerCase()));
  if (!ruleDoc) throw new Error('Regla no encontrada');
  const gradesRef = collection(ruleDoc.ref, 'grades');
  await addDoc(gradesRef, { valor, comentario, fecha: Date.now() });
  return { ok:true };
}

export async function listGrades(courseName, ruleTipo, semId = null) {
  const match = await findCourseDoc(courseName, semId);
  const rulesRef = collection(match.ref, 'rules');
  const rulesSnap = await getDocs(rulesRef);
  const ruleDoc = rulesSnap.docs.find(r => (r.data().tipo || '').toLowerCase().includes(ruleTipo.toLowerCase()));
  if (!ruleDoc) throw new Error('Regla no encontrada');
  const gradesRef = collection(ruleDoc.ref, 'grades');
  const gradesSnap = await getDocs(gradesRef);
  return gradesSnap.docs.map(g => ({ id: g.id, ...g.data() }));
}
