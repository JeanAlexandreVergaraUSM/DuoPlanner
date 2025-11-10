// js/attendance.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import { collection, doc, onSnapshot, getDocs, updateDoc, addDoc, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let unsubAttendance = null;
let unsubPreload = null;

export function initAttendance(){
  if (!state.currentUser || !state.activeSemesterId) return;

  const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses');
  unsubAttendance = onSnapshot(ref, snap => {
    const asistCourses = snap.docs.filter(d => d.data().asistencia);

    const sel = $('attCourseSel');
    if (sel){
      sel.innerHTML = '<option value="" disabled selected>Elige un ramo…</option>';
      asistCourses.forEach(d=>{
        sel.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
      });
    }

    sel?.addEventListener('change', ()=>{
      const courseId = sel.value;
      const match = asistCourses.find(d=>d.id === courseId);
      renderAttendance(match ? [match] : []);
    });
  });
}


function renderAttendance(list){
  const host = $('asistenciaList');
  if (!host) return;
  host.innerHTML = '';

  list.forEach(docSnap=>{
    const c = docSnap.data();
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <h4>${c.name}</h4>
      <div class="att-days" data-id="${docSnap.id}"></div>
      <div class="muted">Asistencia actual: <span class="att-percent" data-id="${docSnap.id}">0%</span></div>
      <button class="btn btn-secondary add-att-btn" data-id="${docSnap.id}" style="margin-top:8px;">+ Agregar asistencia</button>
    `;
    host.appendChild(div);
    loadAttendance(docSnap.id);
  });

  host.querySelectorAll('.add-att-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> openAttendanceModal(btn.dataset.id));
  });
}


async function loadAttendance(courseId){
  const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses',courseId,'attendance');
  onSnapshot(ref, snap=>{
    const days = snap.docs.map(d=>({id:d.id, ...d.data()}));
    drawAttendance(courseId, days);
  });
}

async function drawAttendance(courseId, days){
  const container = document.querySelector(`.att-days[data-id="${courseId}"]`);
  if (!container) return;

  container.innerHTML = days.map(d=>`
    <div class="att-record">
      <span>${
  new Date(d.date + 'T00:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })
} :

        ${d.present ? '✔ Presente' :
  d.absent ? '✘ Ausente' :
  d.justified ? '🟡 Justificado' :
  '— Sin clase'}

      </span>
      <button class="btn btn-secondary btn-del-att" data-cid="${courseId}" data-id="${d.id}">❌</button>
    </div>
  `).join('');


  container.querySelectorAll('.btn-del-att').forEach(btn=>{
    btn.addEventListener('click', ()=> deleteAttendance(btn.dataset.cid, btn.dataset.id));
  });

const validDays = days.filter(d=>!d.noClass);
const ok = validDays.filter(d=>d.present || d.justified).length;
const percent = validDays.length ? Math.round((ok/validDays.length)*100) : 0;

  const el = document.querySelector(`.att-percent[data-id="${courseId}"]`);
  if (el) el.textContent = percent + '%';

if (!window.courseAttendance) window.courseAttendance = {};
window.courseAttendance[courseId] = percent;

}



let currentCourseForAttendance = null;

function openAttendanceModal(courseId){
  currentCourseForAttendance = courseId;

  // 🔹 Ajustar fecha local sin desfase UTC
  const now = new Date();
  const localISODate = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .split('T')[0];

  $('attDate').value = localISODate;
  $('attModal').classList.add('active');
}


function closeAttendanceModal(){
  $('attModal').classList.remove('active');
  currentCourseForAttendance = null;
}

document.addEventListener('DOMContentLoaded', ()=>{
  $('attCancel')?.addEventListener('click', closeAttendanceModal);

  $('attPresente')?.addEventListener('click', ()=> saveAttendance('present'));
  $('attAusente')?.addEventListener('click', ()=> saveAttendance('absent'));
  $('attJustificado')?.addEventListener('click', ()=> saveAttendance('justified'));
  $('attNoClass')?.addEventListener('click', ()=> saveAttendance('noClass'));
});

async function saveAttendance(status) {
  if (!currentCourseForAttendance) return;

  const dateInput = $('attDate').value;
  if (!dateInput) { alert('Selecciona una fecha'); return; }

  // ✅ Interpretar la fecha en hora local (no UTC)
  const [year, month, day] = dateInput.split('-').map(Number);
  const localDate = new Date(year, month - 1, day); // crea la fecha local correctamente

  // ✅ Guardamos el ISO local corregido, pero solo la parte de la fecha
  const date = localDate.toISOString().split('T')[0];

  const ref = doc(
    db,
    'users', state.currentUser.uid,
    'semesters', state.activeSemesterId,
    'courses', currentCourseForAttendance,
    'attendance', date
  );

  await setDoc(ref, {
    date,
    present: status === 'present',
    absent: status === 'absent',
    justified: status === 'justified',
    noClass: status === 'noClass'
  });

  closeAttendanceModal();
}




async function deleteAttendance(courseId, date){
  const ref = doc(
    db,
    'users', state.currentUser.uid,
    'semesters', state.activeSemesterId,
    'courses', courseId,
    'attendance', date
  );
  await deleteDoc(ref);
}


export async function preloadAttendanceData() {
  if (!state.currentUser || !state.activeSemesterId) return;

  // Evita duplicar listeners
  if (unsubPreload) {
    try { unsubPreload(); } catch {}
    unsubPreload = null;
  }

  if (!window.courseAttendance) window.courseAttendance = {};

  const coursesRef = collection(
    db,
    'users', state.currentUser.uid,
    'semesters', state.activeSemesterId,
    'courses'
  );

  /* ---------- 1️⃣ Precarga inmediata sin esperar onSnapshot ---------- */
  try {
    const snap = await getDocs(coursesRef);
    for (const c of snap.docs) {
      const data = c.data() || {};
      if (!data.asistencia) continue;

      const attRef = collection(
        db,
        'users', state.currentUser.uid,
        'semesters', state.activeSemesterId,
        'courses', c.id,
        'attendance'
      );
      const attSnap = await getDocs(attRef);
      const days = attSnap.docs.map(d => d.data());
      const valid = days.filter(d => !d.noClass);
      const ok = valid.filter(d => d.present || d.justified).length;
      const percent = valid.length ? Math.round((ok / valid.length) * 100) : 0;
      window.courseAttendance[c.id] = percent;
    }
    console.log('⚡ Precarga inicial de asistencia:', window.courseAttendance);

    // 🔹 Emitir evento para que Notas recalcule inmediatamente
    document.dispatchEvent(new CustomEvent('attendance:ready', { detail: { preload: true } }));
  } catch (err) {
    console.error('Error en precarga rápida de asistencia:', err);
  }

  /* ---------- 2️⃣ Luego activa los listeners reactivos ---------- */
  unsubPreload = onSnapshot(coursesRef, (snap) => {
    const asistCourses = snap.docs.filter(d => d.data()?.asistencia);
    asistCourses.forEach(c => {
      const attRef = collection(
        db,
        'users', state.currentUser.uid,
        'semesters', state.activeSemesterId,
        'courses', c.id,
        'attendance'
      );
      onSnapshot(attRef, (attSnap) => {
        const days = attSnap.docs.map(d => d.data());
        const valid = days.filter(d => !d.noClass);
        const ok = valid.filter(d => d.present || d.justified).length;
        const percent = valid.length ? Math.round((ok / valid.length) * 100) : 0;
        window.courseAttendance[c.id] = percent;

        // Notifica recalculo solo si cambió un curso
        document.dispatchEvent(new CustomEvent('attendance:ready', {
          detail: { courseId: c.id, percent }
        }));
      });
    });
  });
  return true;
}
