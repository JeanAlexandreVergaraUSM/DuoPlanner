// js/schedule.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import {
  collection, addDoc, onSnapshot, doc, deleteDoc, query,
  getDocs, orderBy, getDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let myColor = '#22c55e';
let partnerColor = '#ff69b4';
let unsubPartnerProfile = null;
let schedBooted = false;

// 🟦 Auto-scroll durante drag
let isDraggingChip = false;
let autoScrollRAF = null;
const AUTO_EDGE = 80;
const AUTO_SPEED = 28;

// 🟦 Guardamos los slots vigentes para numeración sin contar lunch
let CURRENT_SLOTS = [];         // propio
let SHARED_CURRENT_SLOTS = [];  // pareja

const DAYS = ['Lun','Mar','Mié','Jue','Vie'];

function handleGlobalDragOver(e){
  if (!isDraggingChip) return;
  const y = e.clientY;
  const h = window.innerHeight;

  let dy = 0;
  if (y < AUTO_EDGE) {
    const t = (AUTO_EDGE - y) / AUTO_EDGE;
    dy = -Math.ceil(AUTO_SPEED * t);
  } else if (y > h - AUTO_EDGE) {
    const t = (y - (h - AUTO_EDGE)) / AUTO_EDGE;
    dy = Math.ceil(AUTO_SPEED * t);
  }

  if (dy !== 0 && autoScrollRAF === null) {
    autoScrollRAF = requestAnimationFrame(() => {
      window.scrollBy(0, dy);
      autoScrollRAF = null;
    });
  }
}
function stopGlobalAutoScroll(){
  isDraggingChip = false;
  if (autoScrollRAF) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
}

/* ==================== SLOTS ==================== */
// USM
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

/* === helpers universidad === */
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

/* === helpers color === */
function isValidHex(s){ return typeof s==='string' && /^#[0-9A-Fa-f]{6}$/.test(s); }
function getCourseColorById(arr, id, fallback){
  const c = (arr || []).find(x => x.id === id);
  return isValidHex(c?.color) ? c.color : (fallback || '#3B82F6');
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

/* ==================== ESTADO ==================== */
let unsubscribeSchedule = null;
let items = []; // { id, courseId, day, slot, start, end, pos, hpos, displayName? }

/* ==================== INIT ==================== */
export function initSchedule(){

  if (schedBooted) return;   // ⬅️ evita doble init
  schedBooted = true;

  renderShell();
bindDnD();
bindInlineRename();
bindRightClickRoom();


  // Compartido
  renderSharedShell();
  document.addEventListener('pair:ready', (ev) => {
  const otherUid = ev.detail?.otherUid;
  if (otherUid) {
    populateSharedSemesters();  // vuelve a llenar el select
  } else {
    const sel = $('sh-semSel');
    if (sel) sel.innerHTML = '<option disabled selected>Sin compañero</option>';
  }
});
  $('sh-semSel')?.addEventListener('change', (e)=>{
    state.shared.horario.semId = e.target.value || null;
    subscribeShared(state.shared.horario.semId);
  });

  // Subtabs
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
      alert('Debes emparejarte primero para ver el horario de la otra persona.');
      return;
    }
    tabComp?.classList.add('active'); tabProp?.classList.remove('active');
    pageComp?.classList.remove('hidden'); pageProp?.classList.add('hidden');

    const sel = $('sh-semSel');
    if (sel && !sel.value){
      const first = Array.from(sel.options).find(o => o.value);
      if (first){ sel.value = first.value; }
      if (sel?.value){ state.shared.horario.semId = sel.value; }
    }
    if (state.shared.horario.semId){
      subscribeShared(state.shared.horario.semId);
    } else {
      populateSharedSemesters();
    }
  }

  tabProp?.addEventListener('click', showPropio);
  tabComp?.addEventListener('click', showCompartido);
  showPropio();

document.addEventListener('courses:changed', () => {
    renderPalette();
    renderGrid();
  });

 document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.block-del-btn');
  if (!btn) return;

  const id = btn.dataset.id;
  if (!id || !state.currentUser || !state.activeSemesterId) return;

  if (!confirm('¿Eliminar este bloque del horario?')) return;

  try {
    await deleteDoc(doc(
      db,
      'users', state.currentUser.uid,
      'semesters', state.activeSemesterId,
      'schedule', id
    ));
  } catch(err) {
    console.error(err);
    alert('No se pudo eliminar el bloque.');
  }


});



}

export function onActiveSemesterChanged(){
  if (unsubscribeSchedule){ unsubscribeSchedule(); unsubscribeSchedule=null; }
  items = []; renderGrid();

  if (!state.currentUser || !state.activeSemesterId) return;
  const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule');
  unsubscribeSchedule = onSnapshot(query(ref), (snap)=>{
    items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
      <ul style="margin:4px 0 0 20px; padding:0; list-style:disc;">
        <li>Arrastra un ramo a un módulo.</li>
        <li>La pre-vista indica <b>arriba</b>, <b>completo</b>, <b>abajo</b>, <b>izquierda</b> o <b>derecha</b>.</li>
        <li>Para eliminar un bloque, haz <b>click</b> en la X.</li>
        <li>Para editar un bloque, haz <b>click</b> sobre él.</li>
        <li>Para editar una sala, haz <b>click derecho</b> sobre él.</li>
        <li>Para ver su sala, pase el mouse por encima.</li>
      </ul>
    </div>
  </div>
  <div id="schedUSM" class="sched-usm card"></div>
`;

  renderPalette();
  renderGrid();
}

export function refreshCourseOptions(){ renderPalette(); renderGrid(); }

// --- en renderPalette(), añade defensivo ---
function renderPalette(){
  const pal = $('coursePalette');
  if (!pal) return;
  pal.innerHTML = '';
  const list = Array.isArray(state.courses) ? state.courses : []; // ⬅️
  if (list.length===0){
    pal.innerHTML = `<div class="muted">No hay ramos en el semestre activo.</div>`;
    return;
  }
  list.forEach(c=>{
    const chip = document.createElement('div');
    chip.className = 'palette-chip';
    chip.setAttribute('draggable','true');
    chip.dataset.courseId = c.id;
    chip.textContent = c.name;

    const col = isValidHex(c.color) ? c.color : '#3B82F6';
    chip.style.borderColor = col;
    chip.style.boxShadow = 'inset 0 0 0 2px rgba(0,0,0,.15)';
    pal.appendChild(chip);
  });
}



function renderGrid(){
  const host = $('schedUSM');
  if (!host) return;

  const SLOTS = getMySlots();
  CURRENT_SLOTS = SLOTS;

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

// ⬇️ Aquí agregas los botoncitos de eliminar
  host.querySelectorAll('.placed').forEach(el => {
    if (!el.querySelector('.block-del-btn')) {
      const btn = document.createElement('button');
      btn.className = 'block-del-btn';
      btn.textContent = '×';
      btn.dataset.id = el.dataset.id;
      el.appendChild(btn);
    }
  });

}

/* === celda izquierda (numeración y sublíneas) === */
function renderModuleCell(s, slotIndex, uni){
  if (s.lunch){
    return `
      <div class="mod-label">ALMUERZO</div>
      <div class="mod-time">${s.start}–${s.end}</div>
    `;
  }

  const slots = (SHARED_CURRENT_SLOTS.length ? SHARED_CURRENT_SLOTS : CURRENT_SLOTS);
  const beforeNonLunch = slots.slice(0, slotIndex).filter(x => !x.lunch).length;

  if (uni === 'USM'){
    const n1 = beforeNonLunch*2 + 1;
    const n2 = n1 + 1;
    return `
      <div class="mod-lines">
        <div class="line-num">${n1}</div>
        <div class="line-time">${s.lines[0].start}–${s.lines[0].end}</div>
        <div class="line-num">${n2}</div>
        <div class="line-time">${s.lines[1].start}–${s.lines[1].end}</div>
      </div>
    `;
  } else {
    const bn = beforeNonLunch + 1;
    return `
      <div class="mod-lines">
        <div class="line-num">${bn}</div>
        <div class="line-time">${s.start}–${s.end}</div>
      </div>
    `;
  }
}

/* === render contenido de una celda (permite 2 por pos: left/right o 1 single) === */
function renderCellContent(day, slot){
  const here = items.filter(it => it.day===day && it.slot===slot);
  if (!here.length) return '';

  const renderGroup = (pos) => {
    const group = here.filter(h => (h.pos||'full') === pos);
    if (!group.length) return '';
    // orden: left, single, right (para consistencia visual)
    const sorted = group.sort((a,b)=>{
      const order = { left:0, single:1, right:2 };
      return (order[(a.hpos||'single')] ?? 1) - (order[(b.hpos||'single')] ?? 1);
    });
    return sorted.map(g => blockHtml(g, pos)).join('');
  };

  return `
    ${renderGroup('top')}
    ${renderGroup('full')}
    ${renderGroup('bottom')}
  `;
}

function blockHtml(it, pos){
  const course = (state.courses || []).find(c=>c.id===it.courseId);
  const courseName = course?.name || 'Ramo';
  const shown = (typeof it.displayName === 'string' && it.displayName.trim()) ? it.displayName.trim() : courseName;

  const color = getCourseColorById(state.courses, it.courseId, myColor);
  const text  = bestText(color);
  const room  = (typeof it.room === 'string' && it.room.trim()) ? it.room.trim() : null;

  const h = it.hpos || 'single';
  const title = `${shown}${room ? ` · Sala: ${room}` : ''}`;

 return `
  <div class="placed pos-${pos} h-${h}" data-id="${it.id}"
       title="${shown}${room ? ` · Sala: ${room}` : ''}"
       style="background:${color}; border:1px solid rgba(0,0,0,0.25);">
    <div class="placed-title" style="color:${text}; font-weight:600;">${shown}</div>
  </div>
`;
}



/* ---------- DnD + eliminar ---------- */
function bindDnD(){
  // Auto-scroll global
  window.addEventListener('dragover', handleGlobalDragOver, { passive: true });
  document.addEventListener('drop',  stopGlobalAutoScroll);
  document.addEventListener('dragend', stopGlobalAutoScroll);

  document.addEventListener('dragstart', (e)=>{
    const t = e.target;
    if (t && t.classList.contains('palette-chip')){
      e.dataTransfer.setData('text/plain', t.dataset.courseId);
      e.dataTransfer.effectAllowed = 'copy';
      isDraggingChip = true;
    }
  });

  

  bindCellDropZones();
}

function bindInlineRename(){
  // Click sobre el título de un bloque (sólo en tu horario, no en el compartido)
  document.addEventListener('click', (e)=>{
    const titleEl = e.target.closest('.placed-title');
    if (!titleEl) return;

    // Evita edición desde la vista compartida
    const insideMySched = titleEl.closest('#schedUSM');
    if (!insideMySched) return;

    // Evita abrir dos editores
    if (document.querySelector('input.inline-rename')) return;

    const placed = titleEl.closest('.placed');
    if (!placed) return;

    const schedId = placed.dataset.id;
    const rec = items.find(x => x.id === schedId);
    if (!rec) return;

    const course = (state.courses || []).find(c => c.id === rec.courseId);
    const courseName = course?.name || titleEl.textContent.trim();
    const currentShown = (typeof rec.displayName === 'string' && rec.displayName.trim())
      ? rec.displayName.trim()
      : courseName;

    // Crea input
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inline-rename';
    inp.value = currentShown;
    const w = Math.max(titleEl.offsetWidth, 140);
    inp.style.width = w + 'px';

    // Reemplaza visualmente
    titleEl.replaceWith(inp);
    inp.focus();
    inp.select();

    const finish = async (save)=>{
      // reconstruye el título
      const newTitle = document.createElement('div');
      newTitle.className = 'placed-title';
      const newVal = (inp.value || '').trim();
      newTitle.textContent = save ? (newVal || courseName) : currentShown;
      inp.replaceWith(newTitle);

      if (!save) return;

      // Si no cambió, no hacemos nada
      if (newVal === currentShown) return;

      // Guardar SOLO en el bloque del horario
      if (!state.currentUser || !state.activeSemesterId) return;
      try{
        const sRef = doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule', rec.id);
        // Si el input queda vacío, borra displayName para volver al nombre real del ramo
        const payload = newVal ? { displayName: newVal } : { displayName: null };
        await updateDoc(sRef, payload);
        // Actualiza cache local para ver el cambio altiro
        const idx = items.findIndex(x => x.id === rec.id);
        if (idx >= 0) items[idx].displayName = newVal || null;
      }catch(err){
        console.error('rename error', err);
        alert('No se pudo renombrar el bloque. Intenta nuevamente.');
        newTitle.textContent = currentShown; // rollback visual
      }
    };

    inp.addEventListener('keydown', (ev)=>{
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', ()=> finish(true));
  });
}

function bindRightClickRoom(){
  // Click derecho sobre un bloque del HORARIO PROPIO para editar la sala
  document.addEventListener('contextmenu', async (e)=>{
    const placed = e.target.closest('.placed');
    if (!placed) return;

    // solo permitir si el bloque está en tu horario (no en el compartido)
    const insideMySched = placed.closest('#schedUSM');
    if (!insideMySched) return;

    e.preventDefault();

    const id  = placed.dataset.id;
    const rec = items.find(x => x.id === id);
    if (!rec) return;
    if (!state.currentUser || !state.activeSemesterId) return;

    const current = (rec.room || '').trim();
    const next = prompt('Sala del ramo (deja vacío para borrar):', current);
    if (next === null) return; // cancelado

    const newRoom = (next || '').trim();

    try{
      const sRef = doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule', rec.id);
      await updateDoc(sRef, { room: newRoom || null });

      // Actualiza cache local y re-renderiza
      const idx = items.findIndex(x => x.id === rec.id);
      if (idx >= 0) items[idx].room = newRoom || null;
      renderGrid();
    }catch(err){
      console.error('room update error', err);
      alert('No se pudo actualizar la sala. Intenta nuevamente.');
    }
  });
}


function bindCellDropZones(){
  document.querySelectorAll('.cell.slot').forEach(cell=>{
    if (cell.classList.contains('is-lunch')) return;

    // Preview vertical + decide hpos por cursor (izq/centro/der)
    cell.addEventListener('dragover', (ev)=>{
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';

      const rect = cell.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const ratioY = y / rect.height;
      const ratioX = x / rect.width;

const mid = rect.height / 2;

let vpos;
if (y < mid - 10) {        // margen para no ser tan sensible
  vpos = 'top';
} else if (y > mid + 10) {
  vpos = 'bottom';
} else {
  vpos = 'full';
}




      let hpos = 'single';
      if (ratioX < 0.4) hpos = 'left';
      else if (ratioX > 0.6) hpos = 'right';

      cell.dataset.droppos = vpos; // vertical
      cell.dataset.droph   = hpos; // horizontal
      cell.classList.add('over');


      // Limpiar primero cualquier hint viejo
cell.classList.remove(
  'hint-top','hint-full','hint-bottom',
  'hint-left','hint-center','hint-right'
);

// Añadir vertical
if (vpos === 'top')    cell.classList.add('hint-top');
if (vpos === 'full')   cell.classList.add('hint-full');
if (vpos === 'bottom') cell.classList.add('hint-bottom');

// Añadir horizontal
if (hpos === 'left')   cell.classList.add('hint-left');
if (hpos === 'single') cell.classList.add('hint-center');
if (hpos === 'right')  cell.classList.add('hint-right');

    });

    cell.addEventListener('dragleave', ()=> clearHints(cell));

    cell.addEventListener('drop', async (ev)=>{
      ev.preventDefault();
      const courseId = ev.dataTransfer.getData('text/plain');
      if (!courseId) return;
      if (!state.currentUser || !state.activeSemesterId) {
        alert('Selecciona un semestre.'); clearHints(cell); return;
      }

      const day  = parseInt(cell.dataset.day,10);
      const slot = parseInt(cell.dataset.slot,10);
      const pos  = cell.dataset.droppos || 'full';
      let   hpos = cell.dataset.droph  || 'single';

      const hereAll   = items.filter(it => it.day===day && it.slot===slot);
      const hereAtPos = hereAll.filter(it => (it.pos||'full') === pos);

      // Ya hay dos en este pos → no cabe otro
      if (hereAtPos.length >= 2){
        alert('Esta zona ya tiene dos ramos (izq/der).'); clearHints(cell); return;
      }

      if (hereAtPos.length === 1){
  const existing = hereAtPos[0];
  const eH = existing.hpos || 'single';

  // ⚡ solo bloquea si es FULL y ya hay alguien
  if (pos === 'full' && hpos === 'single'){
    alert('Ya hay un ramo aquí. Elige izquierda o derecha.');
    clearHints(cell); 
    return;
  }

        if (eH === 'single'){
          // Convertimos el existente al lado opuesto del que pediste
          const oldSide = (hpos === 'left') ? 'right' : 'left';
          try {
            await updateDoc(doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule', existing.id), { hpos: oldSide });
          } catch(_){}
          // y el nuevo queda en el lado que eligiste (hpos)
        } else {
          if (eH === hpos){
            alert('Ese lado ya está ocupado. Prueba el otro lado.');
            clearHints(cell); return;
          }
          // si es el lado opuesto, seguimos normal
        }
      }

      const SLOTS = getMySlots();
      const def = SLOTS[slot];
      const payload = { courseId, day, slot, start: def.start, end: def.end, pos, hpos, createdAt: Date.now() };
      const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'schedule');
      await addDoc(ref, payload);

      clearHints(cell);
    });
  });
}

function clearHints(cell){
  cell.classList.remove('over','hint-top','hint-full','hint-bottom',
                        'hint-left','hint-center','hint-right');
  delete cell.dataset.droppos;
  delete cell.dataset.droph;
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
          <label>Semestre de la otra persona</label><br/>
          <select id="sh-semSel"></select>
        </div>
        <div class="muted">Elige un semestre (ej. 2025-2) para ver el horario de la otra persona en vivo.</div>
      </div>
    </div>
    <div id="schedSharedUSM" class="sched-usm card"></div>
  `;
  buildSharedGrid();
}

function buildSharedGrid(){
  const host = $('schedSharedUSM'); if (!host) return;

  const SLOTS = sharedSlots || USM_SLOTS;
  SHARED_CURRENT_SLOTS = SLOTS;

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
  const theirsHere = sharedItems.filter(it => it.day===day && it.slot===slot);

  const renderGroup = (pos) => {
    const group = theirsHere.filter(h => (h.pos||'full') === pos);
    if (!group.length) return '';
    const sorted = group.sort((a,b)=>{
      const order = { left:0, single:1, right:2 };
      return (order[(a.hpos||'single')] ?? 1) - (order[(b.hpos||'single')] ?? 1);
    });
    return sorted.map(g => blockHtmlColored(g, pos, partnerColor, false)).join('');
  };

  return `
    ${renderGroup('top')}
    ${renderGroup('full')}
    ${renderGroup('bottom')}
  `;
}

function blockHtmlColored(it, pos, _colorFallback, isMine){
  const courseArr  = isMine ? (state.courses || []) : (sharedCourses || []);
  const course     = courseArr.find(c=>c.id===it.courseId);
  const courseName = course?.name || 'Ramo';
  const shown      = (typeof it.displayName === 'string' && it.displayName.trim()) ? it.displayName.trim() : courseName;

  const color = getCourseColorById(courseArr, it.courseId, partnerColor);
  const text  = bestText(color);
  const room  = (typeof it.room === 'string' && it.room.trim()) ? it.room.trim() : null;

  const h = it.hpos || 'single';
  const title = `${shown}${room ? ` · Sala: ${room}` : ''}`;

 return `
  <div class="placed pos-${pos} h-${h}"
       title="${shown}${room ? ` · Sala: ${room}` : ''}"
       style="background:${color}; border:1px solid rgba(0,0,0,0.25); margin:2px 0;">
    <div class="placed-title" style="color:${text}; font-weight:600;">${shown}</div>
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

  const semRef = doc(db,'users',otherUid,'semesters',semId);
  const semSnap = await getDoc(semRef);
  const uniReadable = semSnap.exists() ? (semSnap.data().universityAtThatTime || '') : '';
  sharedUni = uniCodeFromReadable(uniReadable);
  sharedSlots = (sharedUni==='UMAYOR') ? MAYOR_SLOTS : USM_SLOTS;

  unsubPartnerProfile = onSnapshot(doc(db,'users', otherUid), (snap)=>{
    const d = snap.data() || {};
    partnerColor = d.favoriteColor || partnerColor;
    buildSharedGrid();
  });

  const coursesRef = collection(db,'users',otherUid,'semesters',semId,'courses');
  unsubSharedCourses = onSnapshot(query(coursesRef, orderBy('name')), (snap)=>{
    sharedCourses = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    buildSharedGrid();
  });

  const schedRef = collection(db,'users',otherUid,'semesters',semId,'schedule');
  unsubShared = onSnapshot(query(schedRef), (snap)=>{
    sharedItems = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    buildSharedGrid();
  });
}

let _lastPopulateToken = 0;

async function populateSharedSemesters(){
  const sel = $('sh-semSel');
  if (!sel) return;

  const myToken = ++_lastPopulateToken;

  // normalizador y canonizador
  const norm = s => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,' ')
    .trim();

  const canon = s => {
    const t = norm(s);
    // acepta variantes con guiones/espacios raros, toma AAAA y term al final
    const m = t.replace(/[^\d\-\/ ]+/g,'').match(/(\d{4})\D*([12])$/);
    return m ? `${m[1]}-${m[2]}` : t.toLowerCase();
  };

  const parseYT = label => {
    const m = /^(\d{4})-(1|2)$/.exec(canon(label));
    return m ? { y: parseInt(m[1],10), t: parseInt(m[2],10) } : { y: -Infinity, t: -Infinity };
  };

  // limpiar select
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— seleccionar —';
  sel.appendChild(opt0);

  if (!state.pairOtherUid) return;

  // traer semestres (no importa el orden aquí; ordenaremos por label)
  const ref = collection(db, 'users', state.pairOtherUid, 'semesters');
  const snap = await getDocs(query(ref));
  if (myToken !== _lastPopulateToken) return;

  // dedup por label canonizado y armar lista
  const byKey = new Map(); // key canon → {id,labelToShow,y,t}
  snap.forEach(d => {
    const data = d.data() || {};
    const shown = norm(data.label || d.id);
    const key   = canon(shown);
    if (!byKey.has(key)) {
      const { y, t } = parseYT(shown);
      byKey.set(key, { id: d.id, labelToShow: shown, y, t });
    }
  });

  // ordenar por año desc, término desc
  const options = Array.from(byKey.values()).sort((a,b)=>{
    if (a.y !== b.y) return b.y - a.y;
    return b.t - a.t;
  });

  // pintar
  const frag = document.createDocumentFragment();
  for (const { id, labelToShow } of options) {
    const opt = document.createElement('option');
    opt.value = id;            // siempre el id para suscripciones
    opt.textContent = labelToShow;
    frag.appendChild(opt);
  }
  sel.appendChild(frag);

  // preservar selección previa; si no existe, tomar la primera válida (la más reciente)
  const prev = state.shared?.horario?.semId || '';
  if (prev && Array.from(sel.options).some(o => o.value === prev)) {
    sel.value = prev;
  } else {
    const firstValid = Array.from(sel.options).find(o => o.value);
    sel.value = firstValid ? firstValid.value : '';
    state.shared.horario.semId = sel.value || null;
  }
}

/* ===== Guardar / actualizar bloque ===== */

export async function setRoom({ course, day, slot, room }) {
  if (!state.currentUser || !state.activeSemesterId) throw new Error('No logueado');

  const semId = state.activeSemesterId;
  const uid = state.currentUser.uid;

  // buscamos el curso
  const match = (state.courses || []).find(c =>
    (c.name || '').toLowerCase().includes(String(course).toLowerCase())
  );
  if (!match) throw new Error('Curso no encontrado');

  // buscar el bloque correspondiente
  const schedRef = collection(db, 'users', uid, 'semesters', semId, 'schedule');
  const snap = await getDocs(schedRef);
  const blk = snap.docs.find(d => {
    const data = d.data();
    return data.courseId === match.id && data.day === day && data.slot === slot;
  });

  if (!blk) throw new Error('No encontré el bloque en el horario');

  // ✅ actualizar solo sala
  await updateDoc(blk.ref, { room: room || null, updatedAt: Date.now() });

  return { ok: true, room };
}



/* ===== Listar horario actual ===== */
export async function getMySchedule(semId = null) {
  if (!state.currentUser) throw new Error('No logueado');
  const sid = semId || state.activeSemesterId;
  if (!sid) throw new Error('No hay semestre activo');

  const ref = collection(db, 'users', state.currentUser.uid, 'semesters', sid, 'schedule');
  const snap = await getDocs(ref);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ===== Coincidencias con el dúo ===== */
export async function overlapWithPair(semId = null) {
  if (!state.currentUser) throw new Error('No logueado');
  const sid = semId || state.activeSemesterId;
  if (!sid) throw new Error('No hay semestre activo');
  if (!state.pairOtherUid) return { items: [] };

  // tu horario
  const myRef = collection(db, 'users', state.currentUser.uid, 'semesters', sid, 'schedule');
  const mySnap = await getDocs(myRef);
  const mine = mySnap.docs.map(d => ({ ...d.data() }));

  // horario del dúo
  const pairRef = collection(db, 'users', state.pairOtherUid, 'semesters', sid, 'schedule');
  const pairSnap = await getDocs(pairRef);
  const theirs = pairSnap.docs.map(d => ({ ...d.data() }));

  // comparar coincidencias (día + slot)
  const items = [];
  for (const m of mine) {
    for (const t of theirs) {
      if (m.day === t.day && m.slot === t.slot) {
        items.push(`${['Lun','Mar','Mié','Jue','Vie'][m.day]} bloque ${m.slot} (${m.courseName} / ${t.courseName})`);
      }
    }
  }
  return { items };
}

/* ===== Eliminar bloque ===== */
export async function removeBlock(blockId, semId = null) {
  if (!state.currentUser) throw new Error('No logueado');
  const sid = semId || state.activeSemesterId;
  await deleteDoc(doc(db, 'users', state.currentUser.uid, 'semesters', sid, 'schedule', blockId));
  return { ok: true };
}