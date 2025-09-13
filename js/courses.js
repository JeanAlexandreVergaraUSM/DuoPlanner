// js/courses.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import {
  collection, addDoc, onSnapshot, doc, deleteDoc, query, orderBy, setDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onCoursesChanged as gradesOnCourses } from './grades.js';

// Escala por defecto según la universidad del semestre activo
let defaultCourseScale = 'USM';


/* ===== API pública ===== */
export function initCourses(){ bindUI(); }
export function setCoursesSubscription(){ subscribeCourses(); }
export function resetCourseForm(){ _resetCourseForm(); }


export function updateFormForUniversity(uniCode){
  // Determina escala por universidad
  defaultCourseScale = (uniCode === 'UMAYOR') ? 'MAYOR' : 'USM';

  // Ajusta etiqueta de Sección/Paralelo
  const lbl = $('sectParLabel');
  if (lbl) lbl.textContent = (uniCode === 'USM') ? 'Paralelo' : 'Sección/Paralelo';

  // Si por alguna razón aún existe el select de escala en el DOM, lo ocultamos/inhabilitamos
  const scaleSel = $('courseScale');
  const field = scaleSel?.closest?.('.form-field');
  if (field) field.classList.add('hidden');
  if (scaleSel){ scaleSel.value = defaultCourseScale; scaleSel.disabled = true; }

  // Hint opcional (si existe en tu HTML)
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

  // color -> muestra hex
  const colorInp = $('courseColor');
  const colorCode = $('courseColorCode');
  colorInp?.addEventListener('input', () => {
    if (colorCode) colorCode.textContent = colorInp.value.toUpperCase();
  });

  // guardar (crear/editar)
  saveBtn?.addEventListener('click', async () => {
    await saveCourse();
  });

  // cancelar edición
  cancelBtn?.addEventListener('click', () => _resetCourseForm());

  // delegación: editar / eliminar
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // editar
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
    }

    // eliminar
    if (t.matches('.course-del')) {
      const id = t.dataset.id;
      if (id) await deleteCourse(id);
    }
  });
}

/* ===== Suscripción ===== */
function subscribeCourses(){
  // corta anterior
  if (unsubscribeCourses){ unsubscribeCourses(); unsubscribeCourses = null; }
    if (!state.currentUser || !state.activeSemesterId) {
    // deja paleta vacía cuando no hay semestre
    state.courses = [];
    document.dispatchEvent(new Event('courses:changed'));
    return;
  }


  const ref = collection(db, 'users', state.currentUser.uid, 'semesters', state.activeSemesterId, 'courses');
  unsubscribeCourses = onSnapshot(query(ref, orderBy('createdAt', 'desc')), (snap) => {
    // ✅ publicar en estado para que Horario pueda leerlos
    state.courses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log('[courses] snapshot ->', state.courses.length, state.courses);

    renderCourses(snap);
    gradesOnCourses?.();

    // 🔔 avisar al Horario (paleta + grilla)
    document.dispatchEvent(new Event('courses:changed'));
  });
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
// escala viene de la universidad del semestre activo
const scale     = defaultCourseScale;


  if (!name){ alert('Ingresa el nombre del ramo.'); return; }

  const saveBtn   = $('saveCourseBtn');
  const cancelBtn = $('cancelEditBtn');
  if (saveBtn) saveBtn.disabled = true;

  try{
    const base = { name, code, professor, section, scale, color, createdAt: Date.now() };

    if (state.editingCourseId){
      // update
      const ref = doc(db, 'users', state.currentUser.uid, 'semesters', state.activeSemesterId, 'courses', state.editingCourseId);
      await setDoc(ref, base, { merge: true });
    } else {
      // create
      const ref = collection(db, 'users', state.currentUser.uid, 'semesters', state.activeSemesterId, 'courses');
      await addDoc(ref, base);
    }

    _resetCourseForm();
    gradesOnCourses?.(); // notificar a Notas tras guardar
  } catch(e){
    console.error(e);
    alert(`No se pudo guardar el ramo: ${e?.message || e}`);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    // al terminar una edición, el botón "Cancelar" se oculta
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
