// js/schedule.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import {
  collection, addDoc, onSnapshot, doc, deleteDoc, query,
  getDocs, orderBy, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let myColor = '#22c55e';
let partnerColor = '#ff69b4';
let unsubPartnerProfile = null;

const DAYS = ['Lun','Mar','Mié','Jue','Vie'];

/* ==================== SLOTS ==================== */
// USM (como tenías)
export const USM_SLOTS = [
  { label:'1/2',   start:'08:15', end:'09:25',
    lines:[{n:'1',start:'08:15',end:'08:50'},{n:'2',start:'08:50',end:'09:25'}] },
  { label:'3/4',   start:'09:40', end:'10:50',
    lines:[{n:'3',start:'09:40',end:'10:15'},{n:'4',start:'10:15',end:'10:50'}] },
  { label:'5/6',   start:'11:05', end:'12:15',
    lines:[{n:'5',start:'11:05',end:'11:40'},{n:'6',start:'11:40',end:'12:15'}] },
  { label:'7/8',   start:'12:30', end:'13:40',
    lines:[{n:'7',start:'12:30',end:'13:05'},{n:'8',start:'13:05',end:'13:40'}] },

  { label:'ALMUERZO', start:'13:40', end:'14:40', lunch:true },

  { label:'9/10',  start:'14:40', end:'15:50',
    lines:[{n:'9',start:'14:40',end:'15:15'},{n:'10',start:'15:15',end:'15:50'}] },
  { label:'11/12', start:'16:05', end:'17:15',
    lines:[{n:'11',start:'16:05',end:'16:40'},{n:'12',start:'16:40',end:'17:15'}] },
  { label:'13/14', start:'17:30', end:'18:40',
    lines:[{n:'13',start:'17:30',end:'18:05'},{n:'14',start:'18:05',end:'18:40'}] },
  { label:'15/16', start:'18:55', end:'20:05',
    lines:[{n:'15',start:'18:55',end:'19:30'},{n:'16',start:'19:30',end:'20:05'}] },
  { label:'17/18', start:'20:20', end:'21:30',
    lines:[{n:'17',start:'20:20',end:'20:55'},{n:'18',start:'20:55',end:'21:30'}] },
  { label:'19/20', start:'21:45', end:'22:55',
    lines:[{n:'19',start:'21:45',end:'22:20'},{n:'20',start:'22:20',end:'22:55'}] },
];

// U. Mayor (dos sublíneas de 35', almuerzo 12:40–14:00)
export const MAYOR_SLOTS = [
  block('1/2',   '08:30','09:40', ['08:30-09:05','09:05-09:40']),
  block('3/4',   '10:00','11:10', ['10:00-10:35','10:35-11:10']),
  block('5/6',   '11:30','12:40', ['11:30-12:05','12:05-12:40']),
  { label:'ALMUERZO', start:'12:40', end:'14:00', lunch:true },
  block('7/8',   '14:00','15:10', ['14:00-14:35','14:35-15:10']),
  block('9/10',  '15:30','16:40', ['15:30-16:05','16:05-16:40']),
  block('11/12', '17:00','18:10', ['17:00-17:35','17:35-18:10']),
  block('13/14', '18:30','19:40', ['18:30-19:05','19:05-19:40']),
  block('15/16', '20:00','21:10', ['20:00-20:35','20:35-21:10']),
  block('17/18', '21:30','22:40', ['21:30-22:05','22:05-22:40']),
];

function block(label, start, end, linesArr){
  return { label, start, end, lines: linesArr.map(s => {
    const [a,b] = s.split('-'); return { start:a, end:b };
  })};
}

/* === universidad desde texto legible del semestre === */
function uniCodeFromReadable(readable){
  if (!readable) return '';
  const r = String(readable).toLowerCase();

  if (r === 'umayor' || r.includes('mayor')) return 'UMAYOR';
  if (r === 'usm' || r === 'utfsm' || r.includes('utfsm') || r.includes('santa maría') || r.includes('santa maria')) {
    return 'USM';
  }
  return 'OTRA';
}


function getActiveUniCode(){
  const u = state.activeSemesterData?.universityAtThatTime
         || state.profileData?.university
         || '';
  return uniCodeFromReadable(u);
}


function getMySlots(){
  return (getActiveUniCode()==='UMAYOR') ? MAYOR_SLOTS : USM_SLOTS;
}

/* ==================== ESTADO ==================== */
let unsubscribeSchedule = null;
let items = []; // { id, courseId, day, slot, start, end, pos }

/* ==================== INIT ==================== */
export function initSchedule(){
  renderShell();
  bindDnD();

  // Compartido
  renderSharedShell();
  document.addEventListener('pair:ready', () => {
  populateSharedSemesters();
  // Si ya hay semestre seleccionado de la pareja, engancha el listener
  if (state.shared.horario.semId) {
    subscribeShared(state.shared.horario.semId);
  }
});
  $('sh-semSel')?.addEventListener('change', (e)=>{
    state.shared.horario.semId = e.target.value || null;
    subscribeShared(state.shared.horario.semId);
  });

  /* ===== SUBTABS: Propio / Pareja (NUEVO) ===== */
  const tabProp = $('subtabPropio');
  const tabComp = $('subtabCompartido');
  const pageProp = $('horarioPropio');
  const pageComp = $('horarioCompartido');

  function showPropio(){
    tabProp?.classList.add('active'); tabComp?.classList.remove('active');
    pageProp?.classList.remove('hidden'); pageComp?.classList.add('hidden');
  }
  function showCompartido(){
    if (tabComp?.getAttribute('aria-disabled') === 'true'){
      alert('Debes emparejarte primero para ver el horario de tu pareja.');
      return;
    }
    tabComp?.classList.add('active'); tabProp?.classList.remove('active');
    pageComp?.classList.remove('hidden'); pageProp?.classList.add('hidden');

    // Si todavía no has elegido semestre de la pareja, toma el primero disponible
    const sel = $('sh-semSel');
    if (sel && !sel.value){
      const first = Array.from(sel.options).find(o => o.value);
      if (first){ sel.value = first.value; }
      if (sel?.value){ state.shared.horario.semId = sel.value; }
    }
    if (state.shared.horario.semId){
      subscribeShared(state.shared.horario.semId);
    } else {
      // Si aún no hay opciones (se poblarán con pair:ready), intenta poblar ahora
      populateSharedSemesters();
    }
  }

  tabProp?.addEventListener('click', showPropio);
  tabComp?.addEventListener('click', showCompartido);

  // Arranque por defecto en "Propio"
  showPropio();
}

export function onActiveSemesterChanged(){
  if (unsubscribeSchedule){ unsubscribeSchedule(); unsubscribeSchedule=null; }
  items = []; renderGrid();

  if (!state.currentUser || !state.activeSemesterId) return;
  const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule');
  unsubscribeSchedule = onSnapshot(query(ref), (snap)=>{
    items = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    renderGrid();
  });
}

/* ==================== UI PROPIO ==================== */
function renderShell(){
  const host = $('horarioPropio');
  host.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <h3 style="margin:0 0 10px">Paleta de ramos</h3>
      <div id="coursePalette" class="palette"></div>
      <div class="muted" style="margin-top:6px">
        Arrastra un ramo a un módulo. La pre‑vista indica <b>arriba</b>, <b>completo</b> o <b>abajo</b>.
        (Para eliminar un bloque, haz <b>doble‑click</b> sobre él).
      </div>
    </div>
    <div id="schedUSM" class="sched-usm card"></div>
  `;
  renderPalette();
  renderGrid();
}

export function refreshCourseOptions(){ renderPalette(); renderGrid(); }

function renderPalette(){
  const pal = $('coursePalette');
  if (!pal) return;
  pal.innerHTML = '';
  if (!state.courses || state.courses.length===0){
    pal.innerHTML = `<div class="muted">No hay ramos en el semestre activo.</div>`;
    return;
  }
  state.courses.forEach(c=>{
    const chip = document.createElement('div');
    chip.className = 'palette-chip';
    chip.setAttribute('draggable','true');
    chip.dataset.courseId = c.id;
    chip.textContent = c.name;
    pal.appendChild(chip);
  });
}

function renderGrid(){
  const host = $('schedUSM');
  if (!host) return;
  const SLOTS = getMySlots();
  const isUSM = getActiveUniCode()==='USM';
  const headerTitle = isUSM ? 'Bloque' : 'Módulo';

  host.innerHTML = `
    <div class="usm-grid2">
      <div class="cell header">${headerTitle}</div>
      ${DAYS.map(d=>`<div class="cell header">${d}</div>`).join('')}
      ${SLOTS.map((s,slotIndex)=>`
        <div class="cell mod ${s.lunch?'lunch':''}" data-slot="${slotIndex}">
          ${renderModuleCell(s, slotIndex, isUSM ? 'USM' : 'UMAYOR')}
        </div>
        ${DAYS.map((_,dayIndex)=>`
          <div class="cell slot ${s.lunch?'is-lunch':''}"
               data-day="${dayIndex}" data-slot="${slotIndex}"
               ${s.lunch?'aria-disabled="true"':''}>
            ${renderCellContent(dayIndex, slotIndex)}
          </div>
        `).join('')}
      `).join('')}
    </div>
  `;
  bindCellDropZones();
}

/* === celda izquierda (numeración y sublíneas) === */
function renderModuleCell(s, slotIndex, uni){
  if (s.lunch){
    return `
      <div class="mod-label">ALMUERZO</div>
      <div class="mod-time">${s.start}–${s.end}</div>
    `;
  }

  if (uni === 'USM'){
    // numeración continua 1..20 (dos por bloque)
    const n1 = slotIndex*2 + 1;
    const n2 = slotIndex*2 + 2;
    return `
      <div class="mod-lines">
        <div class="line-num">${n1}</div>
        <div class="line-time">${s.lines[0].start}–${s.lines[0].end}</div>
        <div class="line-num">${n2}</div>
        <div class="line-time">${s.lines[1].start}–${s.lines[1].end}</div>
      </div>
    `;
  } else {
    // U. Mayor: un solo número por bloque (1,2,3,…) y SOLO el horario completo
    const bn = slotIndex + 1;
    return `
      <div class="mod-lines">
        <div class="line-num">${bn}</div>
        <div class="line-time">${s.start}–${s.end}</div>
      </div>
    `;
  }
}


function renderCellContent(day, slot){
  const here = items.filter(it => it.day===day && it.slot===slot);
  if (!here.length) return '';
  const full = here.find(h=> (h.pos||'full') === 'full');
  if (full) return blockHtml(full, 'full');
  const top = here.find(h=> (h.pos||'full') === 'top');
  const bottom = here.find(h=> (h.pos||'full') === 'bottom');
  return `
    ${top ? blockHtml(top,'top') : ''}
    ${bottom ? blockHtml(bottom,'bottom') : ''}
  `;
}

function blockHtml(it, pos){
  const name = (state.courses?.find(c=>c.id===it.courseId)?.name) || 'Ramo';
  return `
    <div class="placed pos-${pos}" data-id="${it.id}" title="Doble-click para eliminar">
      <div class="placed-title">${name}</div>
    </div>
  `;
}

/* ---------- DnD + eliminar ---------- */
function bindDnD(){
  document.addEventListener('dragstart', (e)=>{
    const t = e.target;
    if (t && t.classList.contains('palette-chip')){
      e.dataTransfer.setData('text/plain', t.dataset.courseId);
      e.dataTransfer.effectAllowed = 'copy';
    }
  });

  document.addEventListener('dblclick', async (e)=>{
    const t = e.target.closest('.placed'); if (!t) return;
    const id = t.dataset.id; if (!id) return;
    await deleteDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule',id));
  });

  bindCellDropZones();
}

function bindCellDropZones(){
  document.querySelectorAll('.cell.slot').forEach(cell=>{
    if (cell.classList.contains('is-lunch')) return;

    cell.addEventListener('dragover', (ev)=>{
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      const rect = cell.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const ratio = y / rect.height;
      let pos = 'full';
      if (ratio < 0.33) pos = 'top';
      else if (ratio > 0.66) pos = 'bottom';
      cell.dataset.droppos = pos;
      cell.classList.add('over');
      cell.classList.toggle('hint-top', pos==='top');
      cell.classList.toggle('hint-full', pos==='full');
      cell.classList.toggle('hint-bottom', pos==='bottom');
    });

    cell.addEventListener('dragleave', ()=> clearHints(cell));

    cell.addEventListener('drop', async (ev)=>{
      ev.preventDefault();
      const courseId = ev.dataTransfer.getData('text/plain');
      if (!courseId) return;
      if (!state.currentUser || !state.activeSemesterId) { alert('Selecciona un semestre.'); clearHints(cell); return; }

      const day = parseInt(cell.dataset.day,10);
      const slot = parseInt(cell.dataset.slot,10);
      const pos = cell.dataset.droppos || 'full';

      const here = items.filter(it => it.day===day && it.slot===slot);
      const hasFull = here.some(h => (h.pos||'full') === 'full');
      const hasTop = here.some(h => (h.pos||'full') === 'top');
      const hasBottom = here.some(h => (h.pos||'full') === 'bottom');

      if (pos === 'full' && here.length>0){ alert('Ese módulo ya tiene ramos. Elige arriba o abajo.'); clearHints(cell); return; }
      if (pos === 'top' && (hasTop || hasFull)){ alert('La mitad superior está ocupada.'); clearHints(cell); return; }
      if (pos === 'bottom' && (hasBottom || hasFull)){ alert('La mitad inferior está ocupada.'); clearHints(cell); return; }

      const SLOTS = getMySlots();
      const def = SLOTS[slot];
      const payload = { courseId, day, slot, start: def.start, end: def.end, pos, createdAt: Date.now() };
      const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule');
      await addDoc(ref, payload);

      clearHints(cell);
    });
  });
}

function clearHints(cell){
  cell.classList.remove('over','hint-top','hint-full','hint-bottom');
  delete cell.dataset.droppos;
}

/* ==================== VISTA COMPARTIDA ==================== */
let unsubShared = null;
let sharedItems = [];
let unsubSharedCourses = null;
let sharedCourses = [];
let sharedSlots = USM_SLOTS;
let sharedUni = 'USM';

function renderSharedShell(){
  const sharedHost = $('horarioCompartido');
  if (!sharedHost) return;
  sharedHost.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="align-items:flex-end;gap:12px">
        <div>
          <label>Semestre de tu pareja</label><br/>
          <select id="sh-semSel"></select>
        </div>
        <div class="muted">Elige un semestre (ej. 2025-2) para ver el horario de tu pareja en vivo.</div>
      </div>
    </div>
    <div id="schedSharedUSM" class="sched-usm card"></div>
  `;
  buildSharedGrid();
}

function buildSharedGrid(){
  const host = $('schedSharedUSM'); if (!host) return;
  const SLOTS = sharedSlots || USM_SLOTS;
  const headerTitle = (sharedUni==='USM') ? 'Bloque' : 'Módulo';

  host.innerHTML = `
    <div class="usm-grid2">
      <div class="cell header">${headerTitle}</div>
      ${DAYS.map(d=>`<div class="cell header">${d}</div>`).join('')}
      ${SLOTS.map((s,slotIndex)=>`
        <div class="cell mod ${s.lunch?'lunch':''}" data-slot="${slotIndex}">
          ${renderModuleCell(s, slotIndex, sharedUni)}
        </div>
        ${DAYS.map((_,dayIndex)=>`
          <div class="cell slot ${s.lunch?'is-lunch':''}"
               data-day="${dayIndex}" data-slot="${slotIndex}">
            ${renderSharedCell(dayIndex, slotIndex)}
          </div>
        `).join('')}
      `).join('')}
    </div>
  `;
}

function renderSharedCell(day, slot){
  // ⬇️ SOLO mostrar bloques de la pareja
  const theirsHere = sharedItems.filter(it => it.day===day && it.slot===slot);

  const byPos = list => ({
    full:   list.find(h=> (h.pos||'full')==='full'),
    top:    list.find(h=> (h.pos||'full')==='top'),
    bottom: list.find(h=> (h.pos||'full')==='bottom'),
  });

  const t = byPos(theirsHere);

  let html = '';
  if (t.top)    html += blockHtmlColored(t.top,    'top',    partnerColor, false);
  if (t.full)   html += blockHtmlColored(t.full,   'full',   partnerColor, false);
  if (t.bottom) html += blockHtmlColored(t.bottom, 'bottom', partnerColor, false);
  return html;
}

function blockHtmlColored(it, pos, color, isMine){
  const courseArr = isMine ? (state.courses || []) : (sharedCourses || []);
  const name = (courseArr.find(c=>c.id===it.courseId)?.name) || 'Ramo';
  return `
    <div class="placed pos-${pos}" title="${isMine ? 'Tuyo' : 'Pareja'}"
         style="background:${color}; color:#0e0e0e; font-weight:600; border:1px solid rgba(0,0,0,0.25); margin:2px 0;">
      <div class="placed-title">${name}</div>
    </div>
  `;
}

async function subscribeShared(semId){
  if (unsubShared){ unsubShared(); unsubShared=null; }
  if (unsubSharedCourses){ unsubSharedCourses(); unsubSharedCourses=null; }
  if (unsubPartnerProfile){ unsubPartnerProfile(); unsubPartnerProfile=null; }
  sharedItems = []; sharedCourses = [];
  sharedSlots = USM_SLOTS; sharedUni = 'USM';
  buildSharedGrid();

  myColor = state.profileData?.favoriteColor || myColor;

  const otherUid = state.pairOtherUid;
  if (!otherUid || !semId) return;

  // detectar universidad de ese semestre
  const semRef = doc(db,'users',otherUid,'semesters',semId);
  const semSnap = await getDoc(semRef);
  const uniReadable = semSnap.exists() ? (semSnap.data().universityAtThatTime || '') : '';
  sharedUni = uniCodeFromReadable(uniReadable);
  sharedSlots = (sharedUni==='UMAYOR') ? MAYOR_SLOTS : USM_SLOTS;

  // color favorito pareja
  unsubPartnerProfile = onSnapshot(doc(db,'users', otherUid), (snap)=>{
    const d = snap.data() || {};
    partnerColor = d.favoriteColor || partnerColor;
    buildSharedGrid();
  });

  // cursos
  const coursesRef = collection(db,'users',otherUid,'semesters',semId,'courses');
  unsubSharedCourses = onSnapshot(query(coursesRef, orderBy('name')), (snap)=>{
    sharedCourses = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    buildSharedGrid();
  });

  // horario
  const schedRef = collection(db,'users',otherUid,'semesters',semId,'schedule');
  unsubShared = onSnapshot(query(schedRef), (snap)=>{
    sharedItems = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    buildSharedGrid();
  });
}

async function populateSharedSemesters(){
  const sel = $('sh-semSel'); if (!sel) return;
  sel.innerHTML = '<option value="">—</option>';
  const otherUid = state.pairOtherUid; if (!otherUid) return;
  const ref = collection(db,'users',otherUid,'semesters');
  const snap = await getDocs(query(ref, orderBy('createdAt','desc')));
  snap.forEach(d=>{
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().label || '—';
    sel.appendChild(opt);
  });
  if (state.shared.horario.semId){
    sel.value = state.shared.horario.semId;
    subscribeShared(state.shared.horario.semId);
  }
}
