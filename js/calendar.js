// js/calendar.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import {
  collection, addDoc, onSnapshot, doc, deleteDoc, query, orderBy, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ================= Estado ================= */
let currentMonth = new Date();        // foco del calendario
let unsubscribeCal = null;
let events = []; // propios [{id,title,courseId,date,start,end,allDay,color,createdAt}]
let booted = false;
let unsubCalendar = null;

/* Compartido */
let unsubSharedEvents = null;
let unsubSharedCourses = null;
let unsubPartnerProfile = null;
let sharedEvents = [];
let sharedCourses = [];
let partnerColor = '#ff69b4';

export function registerCalendarUnsub(unsub){
  unsubCalendar = unsub;
}

export function stopCalendarSub(){
  try { unsubCalendar?.(); } finally { unsubCalendar = null; }
}

// Limpia/oculta la UI del calendario
export function clearCalendarUI(){
  // si tu calendario se renderiza en un contenedor, límpialo
  const page = $('page-calendario');
  if (page) {
    // ocúltalo al salir (puedes revertirlo al loguear)
    page.classList.add('hidden');
    // y si tienes un host específico, límpialo:
    const grid = page.querySelector('[data-cal-grid]') || page.querySelector('.cal-grid');
    if (grid) grid.innerHTML = '';
  }
}

// (opcional) al volver a iniciar sesión, muestra de nuevo la página
export function showCalendarUI(){
  $('page-calendario')?.classList.remove('hidden');
}

/* ================= Helpers color/ramo ================= */
function isValidHex(s){ return typeof s==='string' && /^#[0-9A-Fa-f]{6}$/.test(s); }
function getCourseColorById(courseId, fallback='#3B82F6'){
  const c = (state.courses || []).find(x => x.id === courseId);
  return isValidHex(c?.color) ? c.color : fallback;
}
function getSharedCourseColorById(courseId, fallback=partnerColor){
  const c = (sharedCourses || []).find(x => x.id === courseId);
  return isValidHex(c?.color) ? c.color : fallback;
}
function bestText(color){
  try{
    const r = parseInt(color.slice(1,3),16),
          g = parseInt(color.slice(3,5),16),
          b = parseInt(color.slice(5,7),16);
    const yiq = (r*299 + g*587 + b*114)/1000;
    return (yiq >= 160) ? '#111' : '#fff';
  }catch{ return '#0e0e0e'; }
}

/* ================= Init / hooks ================= */
export function initCalendar(){
  if (booted) return; booted = true;
  renderShell();
  bindHeader();
  mountModal();           // Modal crear evento (propio)
  buildMonthGrid();       // propio
  buildSharedMonthGrid(); // compartido (grid base inmediato)
  reflectActiveSemester();
  subscribeIfPossible();  // propios

  // preparar compartido
  document.addEventListener('pair:ready', handlePairReady);
  handlePairReady(); // por si ya hay pareja al entrar

  // Subtabs
  wireSubtabs();
}

// Fallback defensivo
function ensureBoot(){ if (!booted) initCalendar(); }
export function onActiveSemesterChanged(){
  ensureBoot();
  if (unsubscribeCal){ unsubscribeCal(); unsubscribeCal=null; }
  reflectActiveSemester();
  subscribeIfPossible();
  buildMonthGrid();
  buildSharedMonthGrid();
}
export function onCoursesChanged(){ ensureBoot(); paintEvents(); paintSharedEvents(); }

// Auto-init y reacción a ruta
if (document.readyState === 'loading'){ window.addEventListener('DOMContentLoaded', ensureBoot); } else { ensureBoot(); }
document.addEventListener('route:calendario', ensureBoot);

/* ================= Shell / Header ================= */
function renderShell(){
  const host = $('page-calendario');
  if (!host) return;
  host.innerHTML = `
    <div class="card">
      <div class="cal-head">
        <div class="cal-left">
          <button id="calPrev" class="ghost" title="Mes anterior">◀</button>
          <button id="calToday" class="ghost" title="Ir a hoy">Hoy</button>
          <button id="calNext" class="ghost" title="Mes siguiente">▶</button>
          <h3 id="calTitle" style="margin:0 0 0 10px">Calendario</h3>
        </div>
        <div class="cal-right muted">
          Semestre activo: <b id="calActiveSem">—</b>
        </div>
      </div>

      <div class="subtabs" style="margin-bottom:10px; display:flex; gap:8px;">
        <button id="cal-subtab-propio" class="tab small active">Propio</button>
        <button id="cal-subtab-compartido" class="tab small">Pareja</button>
      </div>

      <div id="cal-propio">
        <div class="cal-grid" id="calGrid" aria-live="polite"></div>
        <div class="muted" style="margin-top:8px">
          Haz clic en un día para agregar un evento.
        </div>
      </div>

      <div id="cal-compartido" class="hidden">
        <div class="card" style="margin-bottom:12px">
          <div class="row" style="align-items:flex-end; gap:12px;">
            <div>
              <label>Semestre de tu pareja</label><br/>
              <select id="shc-semSel"></select>
            </div>
            <div class="muted">Elige un semestre (ej. 2025-2) para ver el calendario de tu pareja.</div>
          </div>
        </div>
        <div class="cal-grid" id="calSharedGrid"></div>
        <div class="muted" id="calSharedHint" style="margin-top:8px"></div>
      </div>
    </div>
  `;
}
function bindHeader(){
  $('calPrev')?.addEventListener('click', ()=>{ currentMonth = addMonths(currentMonth,-1); updateHeader(); buildMonthGrid(); buildSharedMonthGrid(); });
  $('calNext')?.addEventListener('click', ()=>{ currentMonth = addMonths(currentMonth, 1); updateHeader(); buildMonthGrid(); buildSharedMonthGrid(); });
  $('calToday')?.addEventListener('click', ()=>{ currentMonth = new Date(); updateHeader(); buildMonthGrid(); buildSharedMonthGrid(); });
  updateHeader();
}
function updateHeader(){
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const t = $('calTitle'); if (t) t.textContent = `Calendario · ${monthNames[m][0].toUpperCase()}${monthNames[m].slice(1)} ${y}`;
}
function reflectActiveSemester(){
  const el = $('calActiveSem'); if (!el) return;
  el.textContent = state.activeSemesterData?.label || '—';
}

/* ================= Subtabs Propio / Pareja ================= */
function wireSubtabs(){
  const tabP = $('cal-subtab-propio');
  const tabC = $('cal-subtab-compartido');
  const panP = $('cal-propio');
  const panC = $('cal-compartido');

  function showPropio(){
    tabP.classList.add('active'); tabC.classList.remove('active');
    panP.classList.remove('hidden'); panC.classList.add('hidden');
  }
  async function showCompartido(){
    tabC.classList.add('active'); tabP.classList.remove('active');
    panC.classList.remove('hidden'); panP.classList.add('hidden');

    // 🔹 Dibuja el grid compartido de inmediato (aunque no haya datos aún)
    buildSharedMonthGrid();

    // Mensaje si no hay pareja
    if (!state.pairOtherUid){
      $('calSharedHint').textContent = 'Empareja tu cuenta para ver el calendario de tu pareja.';
      const sel = $('shc-semSel'); if (sel) sel.innerHTML = '<option value="">—</option>';
      return;
    }

    $('calSharedHint').textContent = '';
    // Pobla el selector; suscribe si ya había uno seleccionado
    await populateSharedSemesters();

    if (state.shared?.calendar?.semId){
      subscribeShared(state.shared.calendar.semId);
    } else {
      // Si aún no hay selección, deja el hint visible
      const hasOptions = $('shc-semSel')?.options?.length > 1;
      $('calSharedHint').textContent = hasOptions ? 'Selecciona un semestre para continuar.' : '';
    }
  }

  tabP?.addEventListener('click', showPropio);
  tabC?.addEventListener('click', showCompartido);
  showPropio();
}

/* ================= Datos (suscripción Firestore) – PROPIO ================= */
function subscribeIfPossible(){
  if (unsubscribeCal){ unsubscribeCal(); unsubscribeCal = null; }
  events = []; paintEvents();

  if (!state.currentUser || !state.activeSemesterId) return;
  const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'calendar');
  unsubscribeCal = onSnapshot(query(ref, orderBy('date','asc')), (snap)=>{
    events = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    paintEvents();
  });
}

/* ================= Pair handling – COMPARTIDO ================= */
async function handlePairReady(){
  cleanupShared();
  sharedEvents = []; sharedCourses = [];
  partnerColor = '#ff69b4';

  // Redibuja base (evita pantalla vacía)
  buildSharedMonthGrid();

  if (!state.pairOtherUid){
    const sel = $('shc-semSel'); if (sel) sel.innerHTML = '<option value="">—</option>';
    $('calSharedHint').textContent = 'Empareja tu cuenta para ver el calendario de tu pareja.';
    return;
  }

  $('calSharedHint').textContent = '';
  await populateSharedSemesters();

  // escucha color favorito de la pareja
  if (unsubPartnerProfile) { unsubPartnerProfile(); unsubPartnerProfile = null; }
  unsubPartnerProfile = onSnapshot(doc(db, 'users', state.pairOtherUid), (snap)=>{
    const d = snap.data() || {};
    partnerColor = isValidHex(d.favoriteColor) ? d.favoriteColor : '#ff69b4';
    paintSharedEvents();
  });
}

function cleanupShared(){
  if (unsubSharedEvents){ unsubSharedEvents(); unsubSharedEvents = null; }
  if (unsubSharedCourses){ unsubSharedCourses(); unsubSharedCourses = null; }
  if (unsubPartnerProfile){ unsubPartnerProfile(); unsubPartnerProfile = null; }
}

/* === poblar semestres de la pareja === */
async function populateSharedSemesters(){
  const sel = $('shc-semSel'); if (!sel) return;
  sel.innerHTML = '<option value="">—</option>';

  const otherUid = state.pairOtherUid; if (!otherUid) return;

  try{
    const ref = collection(db,'users',otherUid,'semesters');
    const snap = await getDocs(query(ref, orderBy('createdAt','desc')));
    snap.forEach(d=>{
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.data().label || '—';
      sel.appendChild(opt);
    });

    // mantener selección previa si existe
    if (state.shared?.calendar?.semId){
      sel.value = state.shared.calendar.semId;
    }

    sel.onchange = (e)=>{
      state.shared.calendar = state.shared.calendar || {};
      state.shared.calendar.semId = e.target.value || null;
      subscribeShared(state.shared.calendar.semId);
    };

    // auto seleccionar primero disponible
    if (!sel.value){
      const first = Array.from(sel.options).find(o => o.value);
      if (first){ sel.value = first.value; state.shared.calendar = state.shared.calendar || {}; state.shared.calendar.semId = first.value; }
    }
    if (state.shared.calendar?.semId) subscribeShared(state.shared.calendar.semId);
  }catch(err){
    console.error('populateSharedSemesters error', err);
    $('calSharedHint').textContent = 'No se pudieron cargar los semestres de tu pareja.';
  }
}

/* === suscripción a calendario de pareja === */
async function subscribeShared(semId){
  cleanupShared();
  sharedEvents = []; sharedCourses = [];
  // Dibuja base para evitar vacío
  buildSharedMonthGrid();

  const otherUid = state.pairOtherUid;
  if (!otherUid || !semId) return;

  const coursesRef = collection(db,'users',otherUid,'semesters',semId,'courses');
  unsubSharedCourses = onSnapshot(query(coursesRef, orderBy('name')), (snap)=>{
    sharedCourses = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    paintSharedEvents();
  });

  const calRef = collection(db,'users',otherUid,'semesters',semId,'calendar');
  unsubSharedEvents = onSnapshot(query(calRef, orderBy('date','asc')), (snap)=>{
    sharedEvents = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    paintSharedEvents();
  });
}

/* ================= Modal (Propio) ================= */
function mountModal(){
  if ($('calModal')) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'calModal';
wrapper.className = 'modal'; // ← sin 'hidden'
wrapper.innerHTML = `
  <div class="modal-backdrop" id="calModalBackdrop"></div>
  <div class="modal-content">  <!-- ← coincide con tu CSS -->
    <h3 style="margin-top:0">Nuevo evento</h3>
      <div class="row" style="gap:10px">
        <div style="flex:1">
          <label>Título</label>
          <input type="text" id="calEvtTitle" placeholder="Ej. Prueba 1 ELO212"/>
        </div>
      </div>

      <div class="row" style="gap:10px; margin-top:8px">
        <div style="flex:1">
          <label>Fecha</label>
          <input type="date" id="calEvtDate"/>
        </div>
        <div style="flex:1">
          <label>Ramo</label>
          <select id="calEvtCourse">
            <option value="">(Sin asignar)</option>
          </select>
        </div>
      </div>

      <div class="row" style="gap:10px; margin-top:8px">
        <div style="flex:1">
          <label>Inicio</label>
          <input type="time" id="calEvtStart" />
        </div>
        <div style="flex:1">
          <label>Término</label>
          <input type="time" id="calEvtEnd" />
        </div>
      </div>

      <div class="row" style="justify-content:flex-end; gap:10px; margin-top:16px">
        <button class="ghost" id="calEvtCancel">Cancelar</button>
        <button class="primary" id="calEvtSave">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  const close = () => wrapper.classList.remove('active');
$('calModalBackdrop').addEventListener('click', close);
$('calEvtCancel').addEventListener('click', close);


  $('calEvtSave').addEventListener('click', async ()=>{
    if (!state.currentUser || !state.activeSemesterId){
      alert('Primero activa un semestre en la pestaña "Semestres".'); return;
    }
    const title = ($('calEvtTitle').value || '').trim();
    const date  = $('calEvtDate').value || '';
    const start = $('calEvtStart').value || null;
    const end   = $('calEvtEnd').value || null;
    const courseId = $('calEvtCourse').value || null;

    if (!title){ alert('Ingresa un título.'); return; }
    if (!date){  alert('Selecciona una fecha.'); return; }

    const color = courseId ? getCourseColorById(courseId) : null;

    try{
      const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'calendar');
      await addDoc(ref, { title, date, start, end, courseId, color, createdAt: Date.now() });
      close();
    }catch(err){
      console.error(err);
      alert('No se pudo guardar el evento.');
    }
  });
}
function openModalFor(dateStr){
  if (!state.currentUser || !state.activeSemesterId){
    alert('Primero activa un semestre en la pestaña "Semestres".'); return;
  }
  mountModal();
  const dt = $('calEvtDate'); if (dt) dt.value = dateStr;
  const t = $('calEvtTitle'); if (t) t.value = '';
  const s = $('calEvtStart'); if (s) s.value = '';
  const e = $('calEvtEnd');   if (e) e.value = '';
  const sel = $('calEvtCourse');
  if (sel){
    sel.innerHTML = `<option value="">(Sin asignar)</option>`;
    (state.courses || []).forEach(c=>{
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      sel.appendChild(opt);
    });
  }
  $('calModal').classList.add('active'); // ← ahora sí se muestra y acepta clics

}

/* ================= Construcción del mes – PROPIO ================= */
function buildMonthGrid(){
  const host = $('calGrid'); if (!host) return;
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0=Lun, 6=Dom
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 0).getDate();

  const heads = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  host.innerHTML = `
    ${heads.map(h => `<div class="cal-cell head">${h}</div>`).join('')}
    ${Array.from({length:firstWeekday}).map(()=>`<div class="cal-cell empty"></div>`).join('')}
    ${Array.from({length:daysInMonth}).map((_,i)=>{
      const d = i+1;
      const dateStr = isoDate(currentMonth.getFullYear(), currentMonth.getMonth()+1, d);
      return `
        <div class="cal-cell day" data-date="${dateStr}">
          <div class="cal-daynum">${d}</div>
          <div class="cal-events" id="ce-${dateStr}"></div>
        </div>
      `;
    }).join('')}
  `;

  // click → abrir modal propio
  host.querySelectorAll('.cal-cell.day').forEach(cell => {
    cell.addEventListener('click', ()=> openModalFor(cell.dataset.date));
  });

  paintEvents();
}

/* ================= Construcción del mes – COMPARTIDO ================= */
function buildSharedMonthGrid(){
  const host = $('calSharedGrid'); if (!host) return;
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0=Lun, 6=Dom
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 0).getDate();

  const heads = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  host.innerHTML = `
    ${heads.map(h => `<div class="cal-cell head">${h}</div>`).join('')}
    ${Array.from({length:firstWeekday}).map(()=>`<div class="cal-cell empty"></div>`).join('')}
    ${Array.from({length:daysInMonth}).map((_,i)=>{
      const d = i+1;
      const dateStr = isoDate(currentMonth.getFullYear(), currentMonth.getMonth()+1, d);
      return `
        <div class="cal-cell day" data-date="${dateStr}">
          <div class="cal-daynum">${d}</div>
          <div class="cal-events" id="sce-${dateStr}"></div>
        </div>
      `;
    }).join('')}
  `;

  // (en compartido NO hay click para crear/editar)
  paintSharedEvents();
}

/* ================= Pintado – PROPIO ================= */
function paintEvents(){
  document.querySelectorAll('.cal-events').forEach(c => {
    if (!c.id?.startsWith('sce-')) c.innerHTML = '';
  });

  const ym = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth()+1).padStart(2,'0')}`;
  const monthEvents = events.filter(ev => String(ev.date||'').startsWith(ym));

  monthEvents.forEach(ev => {
    const cont = $('ce-' + ev.date);
    if (!cont) return;
    const color = ev.color || (ev.courseId ? getCourseColorById(ev.courseId) : '#1f2937');
    const text  = bestText(color);
    const time = (ev.start && ev.end) ? `${ev.start}–${ev.end} · ` :
                 (ev.start ? `${ev.start} · ` : '');

    const chip = document.createElement('div');
    chip.className = 'cal-evt';
    chip.textContent = `${time}${ev.title || '(sin título)'}`;
    chip.title = 'Eliminar';
    chip.style.background = color;
    chip.style.color = text;
    chip.style.border = '1px solid rgba(0,0,0,0.25)';

    chip.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if (!state.currentUser || !state.activeSemesterId || !ev.id) return;
      if (!confirm('¿Eliminar este evento?')) return;
      try{
        await deleteDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'calendar', ev.id));
      }catch(err){ console.error(err); }
    });
    cont.appendChild(chip);
  });
}

/* ================= Pintado – COMPARTIDO ================= */
function paintSharedEvents(){
  document.querySelectorAll('.cal-events').forEach(c => {
    if (c.id?.startsWith('sce-')) c.innerHTML = '';
  });

  const ym = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth()+1).padStart(2,'0')}`;
  const monthEvents = sharedEvents.filter(ev => String(ev.date||'').startsWith(ym));

  monthEvents.forEach(ev => {
    const cont = $('sce-' + ev.date);
    if (!cont) return;
    const color = ev.color || (ev.courseId ? getSharedCourseColorById(ev.courseId) : partnerColor);
    const text  = bestText(color);
    const time = (ev.start && ev.end) ? `${ev.start}–${ev.end} · ` :
                 (ev.start ? `${ev.start} · ` : '');

    const chip = document.createElement('div');
    chip.className = 'cal-evt';
    chip.textContent = `${time}${ev.title || '(sin título)'}`;
    chip.style.background = color;
    chip.style.color = text;
    chip.style.border = '1px solid rgba(0,0,0,0.25)';
    cont.appendChild(chip);
  });
}

/* ================= Utils ================= */
function addMonths(d, n){ const nd = new Date(d.getTime()); nd.setMonth(nd.getMonth()+n); return nd; }
function isoDate(y, m, d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
