// ai/tools.js
// “Herramientas” deterministas conectadas a Firestore y tu state.

import { db } from '../js/firebase.js';
import { state, $ } from '../js/state.js';
import { USM_SLOTS, MAYOR_SLOTS } from '../js/schedule.js';
import * as grades from '../js/grades.js';
import * as progreso from '../js/progreso.js';
import * as semesters from '../js/semesters.js';
import * as courses from '../js/courses.js';
import * as calendar from '../js/calendar.js';
import * as schedule from '../js/schedule.js';
import * as exporter from '../js/export.js';
import { getPrereqs } from '../js/malla.js';

import {
  collection, getDocs, addDoc, deleteDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ---------- helpers ----------
function uniCodeFromReadable(r) {
  if (!r) return 'OTRA';
  const s = String(r).toLowerCase();
  if (s.includes('mayor')) return 'UMAYOR';
  if (s.includes('utfsm') || s.includes('santa mar')) return 'USM';
  return 'OTRA';
}
function getSlots() {
  const u = state.activeSemesterData?.universityAtThatTime || state.profileData?.university || '';
  return (uniCodeFromReadable(u) === 'UMAYOR') ? MAYOR_SLOTS : USM_SLOTS;
}
function normalizeDay(d) {
  if (!d) return null;
  const map = {
    'lunes':0,'lun':0,
    'martes':1,'mar':1,
    'miercoles':2,'miércoles':2,'mie':2,'mié':2,
    'jueves':3,'jue':3,
    'viernes':4,'vie':4
  };
  const k = String(d).toLowerCase();
  return (k in map) ? map[k] : null;
}
function slotLabel(s){ return s?.label || ''; }
function toMin(hhmm){ const [h,m]=String(hhmm).split(':').map(Number); return h*60+m; }

// ---------- backlog/feedback MVP ----------
export function __backlog(item){ try { console.info('[AI backlog]', item); } catch{} }
export function __feedback(item){ try { console.info('[AI feedback]', item); } catch{} }

// ---------- Todas las herramientas ----------
export const tools = {
  // ---------- Cuenta ----------
  auth_status(){
    return { logged: !!state.currentUser, email: state.currentUser?.email || null };
  },
  auth_login(){ return { directive:'auth_login' }; },
  auth_switch(){ return { directive:'auth_switch' }; },
  auth_logout(){ 
    const btn = Array.from(document.querySelectorAll('button, a')).find(el => /salir/i.test(el.textContent||''));
    if (btn) btn.click();
    return { ok:true };
  },

  // ---------- Semestre ----------
  sem_list(){
    const items = Array.from(document.querySelectorAll('#semestersList .course-item b')).map(b => b.textContent.trim());
    return { items };
  },
  sem_create({ label }) {
    if (!label) return { error:'missing_slot', which:'label (AAAA-1|2)' };
    try {
      semesters.createSemester(label);
      return { ok:true, label };
    } catch (e) {
      console.error(e);
      return { ok:false, error:'fail_create' };
    }
  },
  sem_delete({ label }) {
    if (!label) return { error:'missing_slot', which:'label' };
    try {
      semesters.deleteSemester(label);
      return { ok:true, label };
    } catch (e) {
      console.error(e);
      return { ok:false, error:'fail_delete' };
    }
  },
  sem_activate({ label }) {
    if (!label) return { error:'missing_slot', which:'label' };
    try {
      semesters.activateSemester(label);
      return { ok:true, label };
    } catch (e) {
      console.error(e);
      return { ok:false, error:'fail_activate' };
    }
  },
  sem_rename: async ({ oldLabel, newLabel }) => {
    try { return await semesters.renameSemester(oldLabel, newLabel); }
    catch(e){ console.error(e); return { ok:false, error:e.message }; }
  },
  sem_summary: async ({ label }) => {
    try { return await semesters.getSemesterSummary(label); }
    catch(e){ console.error(e); return { summary:null, error:e.message }; }
  },
  sem_count_courses(){ 
    const list = Array.from(document.querySelectorAll('#coursesList .course-item .course-name')).map(e=>e.textContent.trim());
    return { count: list.length };
  },

  // ---------- Duo / Party ----------
  pair_whois(){ return { duo: state?.profileData?.pairName || null }; },
  pair_create(){ return { code: Math.random().toString(36).slice(2,8).toUpperCase() }; },
  pair_join({ pairCode }){ return { joined: !!pairCode, code: pairCode||null }; },
  pair_close(){ return { ok:true }; },

  // ---------- Cursos / Notas ----------

    grade_add: async ({ course, rule, valor, comentario }) => {
  try {
    const ok = await courses.addGrade(course, rule, valor, comentario);
    return { ok: true, valor, rule, comentario };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message };
  }
},


    grades_list: async ({ course, rule }) => {
    try {
      const items = await courses.listGrades(course, rule);
      return { items };
    } catch (e) {
      console.error(e);
      return { items: [], error: e.message };
    }
  },

  rules_add_grade: async ({ course, tipo, valor, comentario }) => {
  try { return await courses.addGrade(course, tipo, valor, comentario); }
  catch(e){ return { ok:false, error:e.message }; }
},
rules_list_grades: async ({ course, tipo }) => {
  try { return await courses.listGrades(course, tipo); }
  catch(e){ return { grades:[], error:e.message }; }
},


  async course_info({ course, label }) {
    try { return await courses.getCourseInfo(course, label); }
    catch(e){ console.error(e); return { error:e.message }; }
  },

  async rules_list({ course }) {
    try { return await courses.listRules(course); }
    catch(e){ console.error(e); return { error:e.message }; }
  },
  async rules_add({ course, tipo, peso, escala, politica }) {
    try { return await courses.addRule(course,{ tipo,peso,escala,politica }); }
    catch(e){ console.error(e); return { ok:false, error:e.message }; }
  },
  async rules_remove({ course, tipo }) {
    try { return await courses.removeRule(course,tipo); }
    catch(e){ console.error(e); return { ok:false, error:e.message }; }
  },

  grade_needed({ course }) {
    if (!course) return { error:'missing_slot', which:'curso' };
    const ramo = grades.findCourse(course);
    if (!ramo) return { error:'not_found', course };
    return { needed: grades.calcNotaMinima(ramo) };
  },
  grade_pass_status({ course }) {
    if (!course) return { error:'missing_slot', which:'curso' };
    const ramo = grades.findCourse(course);
    if (!ramo) return { error:'not_found', course };
    return { pass: grades.isPassing(ramo) };
  },
  grade_gap({ course }) {
    if (!course) return { error:'missing_slot', which:'curso' };
    const ramo = grades.findCourse(course);
    if (!ramo) return { error:'not_found', course };
    return { gap: grades.calcBrecha(ramo) };
  },
  grade_sem_avg() {
    return { avg: grades.calcPromedioSemestre(state.activeSemesterId) };
  },
  grade_best_worst() {
    return grades.bestWorst(state.activeSemesterId); // { best, worst }
  },
  export_grades({ scope='actual', course=null, fromSem=null, toSem=null, format='pdf' }){
    return { directive:'export_grades', scope, course, fromSem, toSem, format };
  },

  // ---------- Horario ----------
  sched_view(){
    const el = document.getElementById('schedUSM');
    return { note: el ? 'Horario visible en pantalla.' : 'Aún no veo tu horario.' };
  },
  sched_has_classes({ day }){
    const di = normalizeDay(day);
    if (di==null) return { error:'missing_slot', which:'día' };
    const any = !!document.querySelector(`.cell.slot[data-day="${di}"] .placed`);
    return { has:any };
  },
  sched_first_last({ day }){
    const di = normalizeDay(day);
    if (di==null) return { error:'missing_slot', which:'día' };
    const cells = Array.from(document.querySelectorAll(`.cell.slot[data-day="${di}"] .placed`));
    if (!cells.length) return { first:null, last:null };
    const slots = getSlots();
    const slotsIdx = cells.map(x => parseInt(x.closest('.cell.slot').dataset.slot,10));
    const min = Math.min(...slotsIdx), max = Math.max(...slotsIdx);
    return { first: slotLabel(slots[min]), last: slotLabel(slots[max]) };
  },
  sched_end_time({ day }){
    const di = normalizeDay(day);
    if (di==null) return { error:'missing_slot', which:'día' };
    const cells = Array.from(document.querySelectorAll(`.cell.slot[data-day="${di}"] .placed`));
    if (!cells.length) return { end:null };
    const lastIdx = Math.max(...cells.map(x => parseInt(x.closest('.cell.slot').dataset.slot,10)));
    return { end: (getSlots()[lastIdx]||{}).end || null };
  },
  sched_count_day({ day }){
    const di = normalizeDay(day);
    if (di==null) return { error:'missing_slot', which:'día' };
    const c = document.querySelectorAll(`.cell.slot[data-day="${di}"] .placed`).length;
    return { count:c };
  },
  sched_total_hours_week(){
    const slots = getSlots();
    const dur = (s)=> s?.lunch ? 0 : (toMin(s.end)-toMin(s.start));
    const days = [0,1,2,3,4].map(di=>{
      const filled = new Set(Array.from(document.querySelectorAll(`.cell.slot[data-day="${di}"] .placed`))
        .map(el=>parseInt(el.closest('.cell.slot').dataset.slot,10)));
      let sum=0; filled.forEach(i=> sum += dur(slots[i]));
      return sum;
    });
    return { hours: +(days.reduce((a,b)=>a+b,0)/60).toFixed(1) };
  },
  sched_check_conflict({ courseA, courseB }){
    if (!courseA || !courseB) return { error:'missing_slot', which:'curso A y curso B' };
    const cells = Array.from(document.querySelectorAll('.cell.slot'));
    for (const c of cells){
      const names = Array.from(c.querySelectorAll('.placed .placed-title')).map(e=> (e.textContent||'').toUpperCase());
      if (names.some(n => n.includes(String(courseA).toUpperCase())) &&
          names.some(n => n.includes(String(courseB).toUpperCase())))
        return { conflict:true };
    }
    return { conflict:false };
  },
  sched_suggest_free({ duration=90 }){
    const slots = getSlots();
    for (let day=0; day<5; day++){
      for (let i=0; i<slots.length; i++){
        const s = slots[i]; if (s.lunch) continue;
        const busy = !!document.querySelector(`.cell.slot[data-day="${day}"][data-slot="${i}"] .placed`);
        const mins = toMin(s.end)-toMin(s.start);
        if (!busy && mins>=duration) return { suggestion: `${['Lun','Mar','Mié','Jue','Vie'][day]} ${s.start}-${s.end}` };
      }
    }
    return { suggestion:null };
  },
  sched_gaps_day({ day }){
    const di = normalizeDay(day);
    if (di==null) return { error:'missing_slot', which:'día' };
    const slots = getSlots();
    const filled = new Set(Array.from(document.querySelectorAll(`.cell.slot[data-day="${di}"] .placed`))
      .map(el=>parseInt(el.closest('.cell.slot').dataset.slot,10)));
    const gaps = [];
    for (let i=0;i<slots.length;i++){
      if (slots[i].lunch) continue;
      if (!filled.has(i)) gaps.push(slots[i].start+'-'+slots[i].end);
    }
    return { gaps };
  },
  sched_set_room: async ({ course, day, slot, room }) => {
    try { return await schedule.setRoom({ course, day, slot, room }); }
    catch(e){ console.error(e); return { ok:false, error:e.message }; }
  },
  
sched_get_room: async ({ course, day=null, slot=null }) => {
  try {
    const sched = await schedule.getMySchedule();
    const courseMatch = (state.courses || []).find(c =>
      (c.name || '').toLowerCase().includes(String(course).toLowerCase())
    );
    if (!courseMatch) return { room:null, error:'Curso no encontrado' };

    const match = sched.find(b =>
      b.courseId === courseMatch.id &&
      (day==null || b.day===day) &&
      (slot==null || b.slot===slot)
    );

    return { room: match?.room || null };
  } catch (e) {
    console.error(e);
    return { room:null, error:e.message };
  }
},




sched_get_room_pair: async ({ course, semId = null }) => {
  try {
    if (!course) return { error: 'missing_slot', which: 'curso' };
    if (!state.pairOtherUid) return { error: 'no_pair' };

    const sid = semId || state.activeSemesterId;
    if (!sid) return { error: 'no_semester' };

    const schedRef = collection(db, 'users', state.pairOtherUid, 'semesters', sid, 'schedule');
    const snap = await getDocs(schedRef);

    const found = snap.docs.find(d => {
      const data = d.data() || {};
      return (data.courseName || '').toLowerCase().includes(course.toLowerCase());
    });

    if (found) {
      const data = found.data();
      const dayLabel = ['Lunes','Martes','Miércoles','Jueves','Viernes'][data.day] || '';
      const slots = getSlots();
      const blockLabel = slots[data.slot]?.label || `bloque ${data.slot}`;
      const salaTxt = data.room ? `Sala ${data.room}` : 'Sala no asignada';
      return {
        course: data.courseName || course,
        room: data.room || null,
        day: dayLabel,
        block: blockLabel,
        text: `${data.courseName || course} (tu duo) · ${dayLabel} ${blockLabel} · ${salaTxt}`
      };
    }

    return { course, room: null, error: 'not_found' };
  } catch (e) {
    console.error(e);
    return { course, room: null, error: e.message };
  }
},



  sched_overlap_pair: async () => {
    try { return await schedule.overlapWithPair(); }
    catch(e){ console.error(e); return { items:[], error:e.message }; }
  },
  export_schedule({ format='png' }){ return { directive:'export_schedule', format }; },

  // ---------- Malla / Progreso ----------
curr_prereqs({ course }) {
  try {
    return { prerequisites: getPrereqs(course) };
  } catch (e) {
    console.error(e);
    return { prerequisites: [], error: e.message };
  }
},

curr_when_taken({ course }) {
  return { when: progreso.whenTaken(course) };
},

 curr_is_approved({ course }) {
  return { approved: progreso.isApproved(course) };
},

  curr_progress(){
    const prog = progreso.calcProgreso();
    return { approved: prog.aprobados, total: prog.total, pct: prog.pct };
  },
  curr_simulate_adv({ courses=[] }){
    const sim = progreso.simular(courses);
    return { simPct: sim.pct, approved: sim.aprobados, total: sim.total };
  },
  curr_missing_by_area({ area }) {
  if (!area) return { error:'missing_slot', which:'área' };
  return { items: progreso.faltantesPorArea(area) };
},
curr_pair_level: async () => {
  try { return { level: await progreso.pairLevel() }; }
  catch(e){ return { level:null, error:e.message }; }
},


  export_malla({ format='png' }){ return { directive:'export_malla', format }; },

  // ---------- Calendario ----------
cal_create: async ({ title, datetime, recurrence }) => {
  try { return await calendar.createReminder({ title, datetime, recurrence }); }
  catch(e){ console.error(e); return { ok:false, error:e.message }; }
},
cal_delete: async ({ reminderId, title }) => {
  try { return await calendar.deleteReminder({ reminderId, title }); }
  catch(e){ console.error(e); return { ok:false, error:e.message }; }
},
cal_update: async ({ reminderId, field, value }) => {
  try { return await calendar.updateReminder({ reminderId, field, value }); }
  catch(e){ console.error(e); return { ok:false, error:e.message }; }
},
cal_list: async ({ range='today' }) => {
  try { const items = await calendar.listReminders({ range }); return { items }; }
  catch(e){ console.error(e); return { items:[], error:e.message }; }
},

cal_suspend: async ({ reminderId }) => {
  try { return await calendar.suspendReminder({ reminderId }); }
  catch(e){ console.error(e); return { ok:false, error:e.message }; }
},
cal_list_pair: async ({ range='today' }) => {
  try { const items = await calendar.listPairReminders({ range }); return { items }; }
  catch(e){ console.error(e); return { items:[], error:e.message }; }
},


cal_resume: async ({ reminderId }) => {
  try { return await calendar.resumeReminder(reminderId); }
  catch(e){ console.error(e); return { ok:false, error:e.message }; }
},

cal_list_suspended: async () => {
  try {
    const items = await calendar.listSuspendedReminders();
    return { items };
  } catch (e) {
    console.error(e);
    return { items: [], error: e.message };
  }
},

//-----------Export----------------

export_grades: async ({ format='pdf' }) => {
    try { return await exporter.exportGrades({ format }); }
    catch(e){ console.error(e); return { ok:false, error:e.message }; }
  },
  export_schedule: async ({ format='pdf' }) => {
    try { return await exporter.exportSchedule({ format }); }
    catch(e){ console.error(e); return { ok:false, error:e.message }; }
  },
  export_malla: async ({ format='pdf' }) => {
    try { return await exporter.exportMalla({ format }); }
    catch(e){ console.error(e); return { ok:false, error:e.message }; }
  },

};

export async function perfil_uni() {
  const uniReadable = state.profileData?.university || 'No configurada';
  return `Estás inscrito en: ${uniReadable}`;
}
