<<<<<<< HEAD
import { refreshCourseOptions } from './schedule.js';
import { db } from './firebase.js';
import { $, state, updateDebug } from './state.js';
import { onCoursesChanged as gradesOnCourses } from './grades.js';
import {
  collection, onSnapshot, orderBy, query, addDoc, doc, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export function initCourses(){
  $('saveCourseBtn')?.addEventListener('click', saveCourse);
  $('cancelEditBtn')?.addEventListener('click', resetCourseForm);
}

export function updateFormForUniversity(uni){
  const sectParLabel = $('sectParLabel');
  const courseScale  = $('courseScale');
  const scaleHint    = $('scaleHint');
  if (!sectParLabel || !courseScale || !scaleHint) return;

  const isUMayor = (uni==='UMAYOR' || uni==='Universidad Mayor');
  const isUSM    = (uni==='USM'    || uni==='UTFSM');

  sectParLabel.textContent = isUMayor ? 'Sección' : isUSM ? 'Paralelo' : 'Sección/Paralelo';

  if (isUMayor){
    courseScale.value='MAYOR'; courseScale.disabled=true; scaleHint.textContent='Escala fija: 1–7';
  } else if (isUSM){
    courseScale.value='USM'; courseScale.disabled=true; scaleHint.textContent='Escala fija: 0–100';
  } else {
    courseScale.disabled=false; scaleHint.textContent='Selecciona la escala para esta universidad.';
  }
}

export function setCoursesSubscription(){
  // limpia subs anterior
  if (state.unsubscribeCourses){ state.unsubscribeCourses(); state.unsubscribeCourses=null; }
  if (!state.currentUser || !state.activeSemesterId) return;

  const list = $('coursesList');
  const coursesRef = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses');

  state.unsubscribeCourses = onSnapshot(query(coursesRef, orderBy('name')), (snap)=>{
    if (list) list.innerHTML='';
    // spread correcto + orden por nombre
    state.courses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshCourseOptions();
    gradesOnCourses?.(); // notificar a Notas

    snap.forEach(docSnap=>{
      const c = docSnap.data();
      const item = document.createElement('div'); item.className='course-item';

      const left = document.createElement('div');
      const sectParText = $('sectParLabel')?.textContent || 'Sección/Paralelo';
      left.innerHTML =
        `<div><b>${escapeHtml(c.name)}</b> <span class="course-meta">(${escapeHtml(c.code || 's/código')})</span></div>
         <div class="course-meta">${escapeHtml(c.professor || 'sin profesor')} · ${sectParText}: ${escapeHtml(c.sectPar || '-')} · Escala: ${escapeHtml(c.scale)}</div>`;

      const right = document.createElement('div');
      const editBtn = document.createElement('button'); editBtn.className='ghost'; editBtn.textContent='Editar';
      const delBtn  = document.createElement('button'); delBtn.className='danger'; delBtn.textContent='Eliminar';

      editBtn.addEventListener('click', ()=> startEditCourse(docSnap.id,c));
      delBtn.addEventListener('click', ()=> deleteCourse(docSnap.id));

      right.appendChild(editBtn); right.appendChild(delBtn);
      item.appendChild(left); item.appendChild(right);
      list?.appendChild(item);
    });
  });
}

function startEditCourse(id, data){
  state.editingCourseId = id;
  $('courseName')?.setAttribute('value',''); // evita autofill extraño en algunos navegadores
  $('courseName').value = data.name || '';
  $('courseCode').value = data.code || '';
  $('courseProfessor').value = data.professor || '';
  $('courseSectPar').value = data.sectPar || '';
  if ($('courseScale')) $('courseScale').value = data.scale || $('courseScale').value;

  const saveBtn = $('saveCourseBtn'), cancelBtn = $('cancelEditBtn');
  if (saveBtn) saveBtn.textContent = 'Guardar cambios';
  cancelBtn?.classList.remove('hidden');

  const sec = $('coursesSection');
  if (sec) window.scrollTo({ top: sec.offsetTop-40, behavior:'smooth' });

  updateDebug();
}

export function resetCourseForm(){
  state.editingCourseId = null;
  if ($('courseName'))      $('courseName').value='';
  if ($('courseCode'))      $('courseCode').value='';
  if ($('courseProfessor')) $('courseProfessor').value='';
  if ($('courseSectPar'))   $('courseSectPar').value='';
  const saveBtn = $('saveCourseBtn'), cancelBtn = $('cancelEditBtn');
  if (saveBtn)  saveBtn.textContent='Agregar ramo';
  cancelBtn?.classList.add('hidden');
  updateDebug();
}

async function saveCourse(){
  if (!state.currentUser || !state.activeSemesterId){ alert('Selecciona un semestre.'); return; }
  const name = $('courseName')?.value.trim();
  if (!name){ alert('El nombre del ramo es obligatorio.'); return; }

  const code      = $('courseCode')?.value.trim()      || '';
  const professor = $('courseProfessor')?.value.trim() || '';
  const sectPar   = $('courseSectPar')?.value.trim()   || '';
  const uni       = state.activeSemesterData?.universityAtThatTime || '';

  // escala final (por universidad)
  let finalScale  = $('courseScale')?.value || 'USM';
  if (uni==='UMAYOR' || uni==='Universidad Mayor') finalScale='MAYOR';
  else if (uni==='USM' || uni==='UTFSM') finalScale='USM';

  const payload = {
    name,
    code: code || null,
    professor: professor || null,
    sectPar: sectPar || null,
    scale: finalScale,
    createdAt: Date.now(),
  };

  const saveBtn = $('saveCourseBtn');
  const cancelBtn = $('cancelEditBtn');
  if (saveBtn) saveBtn.disabled = true;

  try{
    const coursesRef = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses');

    if (!state.editingCourseId){
      await addDoc(coursesRef, payload);
    } else {
      await updateDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses',state.editingCourseId), payload);
    }
    resetCourseForm();
    gradesOnCourses?.(); // notificar a Notas tras guardar
  } catch(e){
    console.error(e);
    alert(`No se pudo guardar el ramo: ${e?.message || e}`);
  } finally{
    if (saveBtn) saveBtn.disabled = false;
    cancelBtn?.classList.remove('hidden');
  }
}

async function deleteCourse(id){
  if (!state.currentUser || !state.activeSemesterId) return;
  if (!confirm('¿Eliminar este ramo?')) return;

  try{
    await deleteDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses',id));
    if (state.editingCourseId===id) resetCourseForm();
    gradesOnCourses?.(); // notificar a Notas tras eliminar
  } catch(e){
    console.error(e);
    alert(`No se pudo eliminar: ${e?.message || e}`);
  }
}

/* util pequeño para evitar XSS en nombres/códigos */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s]));
}
=======
import { refreshCourseOptions } from './schedule.js';
import { db } from './firebase.js';
import { $, state, updateDebug } from './state.js';
import { onCoursesChanged as gradesOnCourses } from './grades.js';
import {
  collection, onSnapshot, orderBy, query, addDoc, doc, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export function initCourses(){
  $('saveCourseBtn')?.addEventListener('click', saveCourse);
  $('cancelEditBtn')?.addEventListener('click', resetCourseForm);
}

export function updateFormForUniversity(uni){
  const sectParLabel = $('sectParLabel');
  const courseScale  = $('courseScale');
  const scaleHint    = $('scaleHint');
  if (!sectParLabel || !courseScale || !scaleHint) return;

  const isUMayor = (uni==='UMAYOR' || uni==='Universidad Mayor');
  const isUSM    = (uni==='USM'    || uni==='UTFSM');

  sectParLabel.textContent = isUMayor ? 'Sección' : isUSM ? 'Paralelo' : 'Sección/Paralelo';

  if (isUMayor){
    courseScale.value='MAYOR'; courseScale.disabled=true; scaleHint.textContent='Escala fija: 1–7';
  } else if (isUSM){
    courseScale.value='USM'; courseScale.disabled=true; scaleHint.textContent='Escala fija: 0–100';
  } else {
    courseScale.disabled=false; scaleHint.textContent='Selecciona la escala para esta universidad.';
  }
}

export function setCoursesSubscription(){
  // limpia subs anterior
  if (state.unsubscribeCourses){ state.unsubscribeCourses(); state.unsubscribeCourses=null; }
  if (!state.currentUser || !state.activeSemesterId) return;

  const list = $('coursesList');
  const coursesRef = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses');

  state.unsubscribeCourses = onSnapshot(query(coursesRef, orderBy('name')), (snap)=>{
    if (list) list.innerHTML='';
    // spread correcto + orden por nombre
    state.courses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshCourseOptions();
    gradesOnCourses?.(); // notificar a Notas

    snap.forEach(docSnap=>{
      const c = docSnap.data();
      const item = document.createElement('div'); item.className='course-item';

      const left = document.createElement('div');
      const sectParText = $('sectParLabel')?.textContent || 'Sección/Paralelo';
      left.innerHTML =
        `<div><b>${escapeHtml(c.name)}</b> <span class="course-meta">(${escapeHtml(c.code || 's/código')})</span></div>
         <div class="course-meta">${escapeHtml(c.professor || 'sin profesor')} · ${sectParText}: ${escapeHtml(c.sectPar || '-')} · Escala: ${escapeHtml(c.scale)}</div>`;

      const right = document.createElement('div');
      const editBtn = document.createElement('button'); editBtn.className='ghost'; editBtn.textContent='Editar';
      const delBtn  = document.createElement('button'); delBtn.className='danger'; delBtn.textContent='Eliminar';

      editBtn.addEventListener('click', ()=> startEditCourse(docSnap.id,c));
      delBtn.addEventListener('click', ()=> deleteCourse(docSnap.id));

      right.appendChild(editBtn); right.appendChild(delBtn);
      item.appendChild(left); item.appendChild(right);
      list?.appendChild(item);
    });
  });
}

function startEditCourse(id, data){
  state.editingCourseId = id;
  $('courseName')?.setAttribute('value',''); // evita autofill extraño en algunos navegadores
  $('courseName').value = data.name || '';
  $('courseCode').value = data.code || '';
  $('courseProfessor').value = data.professor || '';
  $('courseSectPar').value = data.sectPar || '';
  if ($('courseScale')) $('courseScale').value = data.scale || $('courseScale').value;

  const saveBtn = $('saveCourseBtn'), cancelBtn = $('cancelEditBtn');
  if (saveBtn) saveBtn.textContent = 'Guardar cambios';
  cancelBtn?.classList.remove('hidden');

  const sec = $('coursesSection');
  if (sec) window.scrollTo({ top: sec.offsetTop-40, behavior:'smooth' });

  updateDebug();
}

export function resetCourseForm(){
  state.editingCourseId = null;
  if ($('courseName'))      $('courseName').value='';
  if ($('courseCode'))      $('courseCode').value='';
  if ($('courseProfessor')) $('courseProfessor').value='';
  if ($('courseSectPar'))   $('courseSectPar').value='';
  const saveBtn = $('saveCourseBtn'), cancelBtn = $('cancelEditBtn');
  if (saveBtn)  saveBtn.textContent='Agregar ramo';
  cancelBtn?.classList.add('hidden');
  updateDebug();
}

async function saveCourse(){
  if (!state.currentUser || !state.activeSemesterId){ alert('Selecciona un semestre.'); return; }
  const name = $('courseName')?.value.trim();
  if (!name){ alert('El nombre del ramo es obligatorio.'); return; }

  const code      = $('courseCode')?.value.trim()      || '';
  const professor = $('courseProfessor')?.value.trim() || '';
  const sectPar   = $('courseSectPar')?.value.trim()   || '';
  const uni       = state.activeSemesterData?.universityAtThatTime || '';

  // escala final (por universidad)
  let finalScale  = $('courseScale')?.value || 'USM';
  if (uni==='UMAYOR' || uni==='Universidad Mayor') finalScale='MAYOR';
  else if (uni==='USM' || uni==='UTFSM') finalScale='USM';

  const payload = {
    name,
    code: code || null,
    professor: professor || null,
    sectPar: sectPar || null,
    scale: finalScale,
    createdAt: Date.now(),
  };

  const saveBtn = $('saveCourseBtn');
  const cancelBtn = $('cancelEditBtn');
  if (saveBtn) saveBtn.disabled = true;

  try{
    const coursesRef = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses');

    if (!state.editingCourseId){
      await addDoc(coursesRef, payload);
    } else {
      await updateDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses',state.editingCourseId), payload);
    }
    resetCourseForm();
    gradesOnCourses?.(); // notificar a Notas tras guardar
  } catch(e){
    console.error(e);
    alert(`No se pudo guardar el ramo: ${e?.message || e}`);
  } finally{
    if (saveBtn) saveBtn.disabled = false;
    cancelBtn?.classList.remove('hidden');
  }
}

async function deleteCourse(id){
  if (!state.currentUser || !state.activeSemesterId) return;
  if (!confirm('¿Eliminar este ramo?')) return;

  try{
    await deleteDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses',id));
    if (state.editingCourseId===id) resetCourseForm();
    gradesOnCourses?.(); // notificar a Notas tras eliminar
  } catch(e){
    console.error(e);
    alert(`No se pudo eliminar: ${e?.message || e}`);
  }
}

/* util pequeño para evitar XSS en nombres/códigos */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s]));
}
>>>>>>> ac80da7fc6057294d6be21cbc9b7893a61a95aa4
