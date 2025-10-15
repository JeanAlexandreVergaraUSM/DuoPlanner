import { db } from './firebase.js';
import { $, state, setHidden } from './state.js';
import { preloadAttendanceData } from './attendance.js';
import {
  collection, query, orderBy, getDocs, onSnapshot, doc, getDoc,
  addDoc, updateDoc, deleteDoc, setDoc , serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';



let currentCourseId = null;
let unsubComp = null;
let components = []; // [{id,key,name,score}]
let header = { scale: 'USM', finalExpr: '', rulesText: '' };
// --- Referencias cruzadas de notas finales (otros ramos del MISMO semestre) ---
let crossFinals = { byName:{}, byCode:{}, byId:{} };  // caches
let unsubGrades = null;

/* ====== Nombres de grupos (ruta corregida) ====== */
let _groupNamesCache = null; // { certamenes:'...', controles:'...', ... }

function groupsDocRef(){
  return doc(
    db,
    'users', state.currentUser.uid,
    'semesters', state.activeSemesterId,
    'courses', currentCourseId,
    'groups', 'meta'     // 👈 subcolección correcta
  );
}

async function loadGroupNames(){
  _groupNamesCache = null;
  if (!readyPath()) return;
  try {
    const snap = await getDoc(groupsDocRef());
    _groupNamesCache = snap.exists() ? (snap.data() || {}) : {};
  } catch (err) {
    console.error('Error cargando nombres de grupos:', err);
    _groupNamesCache = {};
  }
}

async function saveGroupName(key, value){
  if (!readyPath()) return;
  try{
    await setDoc(groupsDocRef(), { [key]: value }, { merge:true });
    _groupNamesCache = { ...(_groupNamesCache || {}), [key]: value };
  }catch(err){
    console.error('Error guardando nombre de grupo:', err);
    throw err;
  }
}



export function registerGradesUnsub(unsub){
  unsubGrades = unsub;
  state.unsubscribeGrades = () => { try{ unsubGrades?.(); }finally{ unsubGrades=null; state.unsubscribeGrades=null; } };
}

// Corta todo lo que esté escuchando Notas
export function stopGradesSub(){
  try { unsubGrades?.(); } finally { unsubGrades = null; }
  state.unsubscribeGrades = null;
}

// Limpia la UI de Notas
export function clearGradesUI(){
  const sel = $('gr-courseSel');
  if (sel) sel.innerHTML = '<option value="" disabled selected>Selecciona un ramo…</option>';

  const list = $('gr-evalsList');      if (list) list.innerHTML = '';
  const expr = $('gr-finalExpr');      if (expr) expr.value = '';
  const err  = $('gr-rulesError');     if (err)  err.textContent = '';

  const avg  = $('gr-currentAvg');     if (avg)  avg.textContent = '—';
  const need = $('gr-neededToPass');   if (need) need.textContent = '—';
  const st   = $('gr-status');         if (st)   st.textContent   = '—';

  // vista de duo (si la tienes)
  const pv   = $('gr-partnerView');    if (pv)   pv.classList.add('hidden');
  const pSel = $('gr-sh-semSel');      if (pSel) pSel.innerHTML = '';
  const pLst = $('gr-sh-list');        if (pLst) pLst.innerHTML = '';
}


export function initGrades(){
  bindUi();
}

// 🔹 Recalcula las notas cuando se actualiza la asistencia
document.addEventListener('attendance:ready', (e) => {
  console.log('🔁 Asistencia actualizada para:', e.detail);
  computeAndRender();
});


// 🔹 Espera un poco tras volver a la pestaña de Notas, para limpiar bien la UI
document.addEventListener('route:notas', () => {
  setTimeout(() => {
    const sel = $('gr-courseSel');
    const evalsCard = $('gr-evalsCard');
    const calcCard = $('gr-calcCard');
    const summaryCard = $('gr-summaryCard');
    const rulesCard = $('gr-rulesCard');

    // Si no hay curso elegido, limpia y oculta todo
    if (!sel || !sel.value) {
      if (evalsCard) evalsCard.classList.add('hidden');
      if (calcCard) calcCard.classList.add('hidden');
      if (summaryCard) summaryCard.classList.add('hidden');
      if (rulesCard) rulesCard.classList.add('hidden');
    }
  }, 50); // ⏱️ 50ms bastan
});



export function onCoursesChanged(){
  loadCoursesIntoSelect();
}

export function onActiveSemesterChanged(){
  const lbl = $('gr-activeSemLabel');
  if (lbl) lbl.textContent = state.activeSemesterData?.label || '—';
  loadCoursesIntoSelect();

  // 🔒 Sincroniza el combo "Semestres" con el semestre activo actual
const shSel = document.getElementById('gr-sh-semSel');
if (shSel && state.activeSemesterData?.label) {
  // muestra el semestre activo actual
  shSel.innerHTML = `<option selected>${state.activeSemesterData.label}</option>`;
  
  // bloquea interacción
  shSel.disabled = true;
  shSel.style.pointerEvents = 'none';
  shSel.style.opacity = '0.7';
}

// ✅ Esperar la precarga de asistencia antes de renderizar las notas
(async () => {
  try {
    await preloadAttendanceData(); // espera la parte getDocs()
    console.log('✅ Asistencia precargada, ahora sí recalculamos notas');
    computeAndRender();
  } catch (err) {
    console.warn('⚠️ Error precargando asistencia:', err);
    computeAndRender(); // fallback
  }
})();

}

/* =================== UI bindings =================== */

// Obtiene {code, name, grade} desde "components" (ya lo mantienes con onSnapshot)
function gr_collectEvaluationsForSim(){
  return (components || []).map(c => ({
    code:  c.key,
    name:  c.name || c.key,
    grade: (typeof c.score === 'number' ? c.score : null)
  }));
}


function bindUi(){
  hideThresholdUi();

  $('gr-saveExpr')?.addEventListener('click', saveExpr);
  $('gr-finalExpr')?.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') { e.preventDefault(); saveExpr(); }
  });
  $('gr-courseSel')?.addEventListener('change', onCourseChange);

$('gr-addEvalBtn')?.addEventListener('click', addEvalFromForm);


  // Crear la sección Reglas dentro de #page-notas (aunque esté oculta)
  ensureRulesUI();

function ensureSimButton(){
  const pageNotas = $('page-notas');
  if (!pageNotas) return;

  // Card cuyo título es "Cálculo de notas"
  const calcCard = Array.from(pageNotas.querySelectorAll('.card h3'))
    .find(h => /c[aá]lculo de notas/i.test(h.textContent))?.closest('.card');
  if (!calcCard) return;

  // id para estilos de separación
  if (!calcCard.id) calcCard.id = 'gr-calcCard';

  // No duplicar botón
  if (calcCard.querySelector('#gr-openSim')) return;

  // Ubicar el <h3> y construir un encabezado flexible (h3 a la izquierda, botón a la derecha)
  const titleEl = calcCard.querySelector('h3');
  const simBtn  = document.createElement('button');
  simBtn.id = 'gr-openSim';
  simBtn.className = 'ghost';
  simBtn.textContent = 'Simulador de notas';

  // Si ya existe una fila .row como header, úsala; si no, creamos una
  let headerRow = titleEl?.closest('.row');
  if (!headerRow) {
    headerRow = document.createElement('div');
    headerRow.className = 'row gr-calcHeader';
    // movemos el h3 dentro del header y lo colocamos al inicio del card
    if (titleEl) headerRow.appendChild(titleEl);
    calcCard.insertBefore(headerRow, calcCard.firstChild);
  } else {
    headerRow.classList.add('gr-calcHeader'); // asegurar clase para estilos
  }

  // Botón a la derecha
  simBtn.style.marginLeft = 'auto';
  headerRow.appendChild(simBtn);

  // Click → abrir simulador (protecciones)
  simBtn.addEventListener('click', () => {
    const formula = gr_getFormulaStr();
    if (!formula) { alert('Primero define la Fórmula final.'); return; }
    const evals = gr_collectEvaluationsForSim();
    if (!evals.length) { alert('Agrega al menos una evaluación.'); return; }
    gr_openSimDrawer({ formula, evals });
  });
}



  ensureSimButton();

  // 🔹 Panel "Notas de tu duo" como pestaña
  document.addEventListener('pair:ready', grpPopulateSemesters); // llena select cuando hay pair

  // ⬇️ Recalcula al tipear en la fórmula
// ⬇️ recalcula y AUTOGUARDA con debounce
const f = $('gr-finalExpr');
if (f){
  const debouncedSave = debounce(async ()=>{ await saveExpr(); }, 600);
  f.addEventListener('input', ()=>{
    header.finalExpr = normalizeExpr(f.value || '');
    computeAndRender();
    debouncedSave();               // ← guarda a los 600 ms desde el último tecleo
  });
  f.addEventListener('blur', ()=> saveExpr()); // ← por si el usuario deja de tipear y hace click afuera
  f.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter'){ e.preventDefault(); saveExpr(); }
  });
}



    // ===== Autocomplete para final(...) y finalCode(...) en la fórmula =====
  setupFinalAutocomplete();

}

function setupFinalAutocomplete(){ /* TODO: implementar */ }



/* ======= Helpers UI ======= */
function hideThresholdUi(){
  // input de umbral
  const thr = $('gr-passThreshold');
  if (thr) thr.closest('div')?.classList.add('hidden');
  // botón guardar cabecera
  const btn = $('gr-saveHeader');
  if (btn) btn.classList.add('hidden');
}

function ensureRulesUI(){
  if ($('gr-rulesCard')) return;

  const pageNotas = $('page-notas');
  if (!pageNotas) return;

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'gr-rulesCard';
  card.style.marginTop = '12px';
  card.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <h3 style="margin:0">Reglas</h3>
      <div class="muted" id="gr-rulesHint">Una por línea. Ej.: <code>C1>=50</code>, <code>avg(Q1,Q2,Q3)>=60</code>,</code> finalCode("Codigo del ramo") >= 50</code>,</code>Asistencia >= 55%</code></div>
    </div>
    <div class="row" style="align-items:flex-start;margin-top:8px">
      <textarea id="gr-rulesText" rows="4" style="flex:1 1 520px;min-height:86px;background:#0e1120;border:1px solid var(--line);color:var(--ink);padding:8px 10px;border-radius:10px"></textarea>
      <div id="gr-formulaError" class="muted" style="margin-top:6px;color:#fca5a5"></div>
      <button id="gr-saveRules" class="primary">Guardar reglas</button>
    </div>
    <div id="gr-rulesStatus" class="muted" style="margin-top:6px"></div>
  `;

  // 👉 localizar el card "🧮 Cálculo de notas"
  const calcCard = Array.from(pageNotas.querySelectorAll('.card h3'))
    .find(h => /c[aá]lculo de notas/i.test(h.textContent))?.closest('.card');

  if (calcCard) {
    // Inserta Reglas justo ANTES de "Cálculo de notas" (queda debajo de Evaluaciones)
    pageNotas.insertBefore(card, calcCard);
  } else {
    // Fallback: al final
    pageNotas.appendChild(card);
  }

  $('gr-saveRules')?.addEventListener('click', saveRules);
}



/* =================== Select de ramos =================== */

async function loadCoursesIntoSelect(){
  const sel = $('gr-courseSel');
  if (!sel) return;
  sel.innerHTML = '';
  if (!state.courses || state.courses.length===0){
    sel.innerHTML = `<option value="">—</option>`;
    currentCourseId = null;
    renderComponents(); renderResult(null);
    return;
  }
  state.courses.forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  currentCourseId = null;
sel.value = "";
sel.selectedIndex = 0;
state.editingCourseId = null;

// Oculta secciones hasta que elijas
$('gr-evalsCard')?.classList.add('hidden');
$('gr-calcCard')?.classList.add('hidden');
$('gr-summaryCard')?.classList.add('hidden');


}

async function onCourseChange(e){
  currentCourseId = e.target.value || null;
  state.editingCourseId = currentCourseId; 

  if (!currentCourseId){
  $('gr-evalsCard')?.classList.add('hidden');
  $('gr-calcCard')?.classList.add('hidden');
  $('gr-summaryCard')?.classList.add('hidden');
  $('gr-rulesCard')?.classList.add('hidden');
  return;
}

  $('gr-evalsCard')?.classList.remove('hidden');
  $('gr-calcCard')?.classList.remove('hidden');
  $('gr-summaryCard')?.classList.remove('hidden');
  $('gr-rulesCard')?.classList.remove('hidden');


  await loadGradingDoc();
  await loadGroupNames();  
  await watchComponents();
  await rebuildCrossFinals();
  computeAndRender();
await forceAttendanceSync(currentCourseId);
}

async function forceAttendanceSync(courseId) {
  try {
    const attRef = collection(
      db,
      'users', state.currentUser.uid,
      'semesters', state.activeSemesterId,
      'courses', courseId,
      'attendance'
    );
    const attSnap = await getDocs(attRef);
    const days = attSnap.docs.map(d => d.data());
    const validDays = days.filter(d => !d.noClass);
    const ok = validDays.filter(d => d.present || d.justified).length;
    const percent = validDays.length ? Math.round((ok / validDays.length) * 100) : 0;

    if (!window.courseAttendance) window.courseAttendance = {};
    window.courseAttendance[courseId] = percent;

    console.log(`✅ Sincronizada asistencia directa de ${courseId}: ${percent}%`);
    computeAndRender();
  } catch (err) {
    console.warn('⚠️ No se pudo sincronizar asistencia directa:', err);
  }
}

/* =================== Refs Firestore =================== */

function gradingDocRef(){
  return doc(
    db,
    'users', state.currentUser.uid,
    'semesters', state.activeSemesterId,
    'courses', currentCourseId,
    'grading', 'meta'
  );
}

function componentsColRef(){
  return collection(
    db,
    'users', state.currentUser.uid,
    'semesters', state.activeSemesterId,
    'courses', currentCourseId,
    'grading', 'meta',
    'components'
  );
}

/* =================== Header (escala/expr/reglas) =================== */

async function loadGradingDoc(){
  if (!readyPath()) return;

  const gRef = gradingDocRef();
  const courseRef = doc(
    db, 'users', state.currentUser.uid,
    'semesters', state.activeSemesterId,
    'courses', currentCourseId
  );

  // 1) Escala declarada en el ramo (si existe)
  const courseSnap  = await getDoc(courseRef);
  const courseScale = courseSnap.exists() ? (courseSnap.data().scale || null) : null;

  // 2) Escala por universidad del semestre (fallback si el ramo no define)
  const uniReadable = state.activeSemesterData?.universityAtThatTime || '';
  const uniScale = /mayor/i.test(uniReadable) ? 'MAYOR'
                : /usm|utfsm|santa\s*mar/i.test(uniReadable) ? 'USM'
                : 'USM';

  // 3) Trae meta; si no existe, crea con escala detectada
  const snap = await getDoc(gRef);
  if (snap.exists()){
    header = { finalExpr: '', rulesText: '', ...snap.data() };
  } else {
    header = { scale: courseScale || uniScale, finalExpr: '', rulesText: '' };
    await setDoc(gRef, header);
  }

  // 4) Forzar coherencia:
  //    - Si el ramo declara escala -> usar esa
  //    - Si NO declara y meta trae otra -> corregir a la de la uni
  let expected = courseScale || uniScale;
  if (header.scale !== expected){
    header.scale = expected;
    await updateDoc(gRef, { scale: header.scale });
  }

  // 5) Refrescar UI básica
  $('gr-activeSemLabel') && ($('gr-activeSemLabel').textContent = state.activeSemesterData?.label || '—');
  const scaleSel = $('gr-scaleSel');
  if (scaleSel) scaleSel.value = header.scale || 'USM';
  const exprEl = $('gr-finalExpr');
  if (exprEl) exprEl.value = header.finalExpr || '';
  const rt = $('gr-rulesText');
  if (rt) rt.value = header.rulesText || '';

  // 6) Ajustar límites del input según escala (1–7 o 0–100)
  //    y redibujar componentes para aplicar step/min/max correctos
  const isMayor = (header.scale === 'MAYOR');
  const min  = isMayor ? 1 : 0;
  const max  = isMayor ? 7 : 100;
  const step = isMayor ? 0.01 : 0.1; // ajusta si quieres otro salto
  // re-render para que los <input type="number"> tomen estos valores
  renderComponents();
  // (renderComponents ya usa header.scale para min/max/step)

  computeAndRender();
}


async function saveExpr(){
  if (!readyPath()) return;
  const el   = $('gr-finalExpr');
  const snap = el ? el.value : '';
  const raw  = (snap || '').trim();
  const expr = normalizeExpr(raw) || null;

  header.finalExpr = expr;
  await updateDoc(gradingDocRef(), { finalExpr: expr });
  await rebuildCrossFinals();

  // ⚠️ NO reescribas el input; evita pisar lo que el usuario escribió durante el await
  // if (el && el.value === snap) el.value = expr ?? '';  // <- si quieres, deja esta guardia
  computeAndRender();
}


async function saveRules(){
  if (!readyPath()) return;
  const txt = ($('gr-rulesText').value || '').trim() || null;
 header.rulesText = txt;
  await updateDoc(gradingDocRef(), { rulesText: txt });
  await rebuildCrossFinals();

  computeAndRender();
}

/* =================== Componentes =================== */

async function watchComponents() {
  if (unsubComp) { unsubComp(); unsubComp = null; }
  if (!readyPath()) { renderComponents([]); return; }

  const ref = componentsColRef();

  unsubComp = onSnapshot(
    query(ref, orderBy('createdAt', 'asc')),
    async (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      components = list;                 
      await renderComponents(list);
      computeAndRender();
      rebuildCrossFinals().then(() => computeAndRender());
    },
    (err) => {
      console.error('watchComponents error:', err);
      renderComponents([]);
    }
  );
}



async function addEvalFromForm(){
  if (!readyPath()) {
    alert('Selecciona un semestre y un ramo.');
    return;
  }

  const nameEl = $('gr-evalName');
  const codeEl = $('gr-evalCode');
  const scoreEl = $('gr-evalScore');

  const name = (nameEl?.value || '').trim();
  let   key  = (codeEl?.value || '').trim();
  const scoreRaw = scoreEl?.value ?? '';

  if (!name) { alert('Escribe un nombre.'); return; }
  if (!key)  { alert('Escribe un código (ej: C1, T1...).'); return; }

  // normaliza código (A–Z, 0–9, _), máx 16
  key = key.replace(/\s+/g,'').replace(/[^A-Za-z0-9_]/g,'').slice(0,16);
  if (!key) { alert('Código inválido.'); return; }

  // evitar choque con existentes
  key = ensureUniqueKey(key, components);

  // escala para límites
  const isMayor = (header.scale === 'MAYOR');
  const min = isMayor ? 1   : 0;
  const max = isMayor ? 7   : 100;
  const v   = parseFloat(String(scoreRaw).replace(',','.'));
  const score = isNaN(v) ? null : clamp(v, min, max);

  await addDoc(componentsColRef(), {
    key,
    name,
    score,
    createdAt: serverTimestamp()
  });

  // limpiar formulario
  if (nameEl)  nameEl.value  = '';
  if (codeEl)  codeEl.value  = '';
  if (scoreEl) scoreEl.value = '';

  // onSnapshot refresca lista y cálculo
}


async function addComponentPrompt(){
  if (!readyPath()) return;

  const name = prompt('Nombre del componente (ej: "Presentación Individual 1"):\nSe generará una abreviación para la fórmula.');
  if (!name) return;

  let key = makeAbbrev(name);
  key = ensureUniqueKey(key, components);

  const custom = prompt(`Abreviación sugerida: ${key}\nSi quieres otra, escríbela (A–Z, 0–9 y _). Deja vacío para aceptar.`, '');
  const finalKey = sanitizeKey(custom?.trim() || key);
  if (!finalKey) return;

  await addDoc(componentsColRef(), {
    key: finalKey,
    name: name.trim(),
    score: null,
    createdAt: serverTimestamp()

  });
  // onSnapshot actualiza la UI
}

/* Abreviación: “Presentación Individual 1” → “PI1”; “Tarea 2” → “T2” */
function makeAbbrev(name){
  const words = name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/).filter(Boolean);

  let letters = words.map(w => w[0]).join('').toUpperCase();
  if (!letters) letters = (name.slice(0,2) || 'X').toUpperCase();

  const nums = (name.match(/\d+/g) || []).join('');
  return letters + nums;
}
function sanitizeKey(k){
  return (k || '')
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 16);
}
function ensureUniqueKey(base, comps){
  const taken = new Set((comps||[]).map(c => (c.key||'').toLowerCase()));
  let k = sanitizeKey(base) || 'X';
  if (!taken.has(k.toLowerCase())) return k;
  let i = 2;
  while (taken.has((k+i).toLowerCase())) i++;
  return k + i;
}

async function _normalizeCreatedAtOnce(refColSnap){
  const ops = [];
  for (const d of refColSnap.docs){
    const data = d.data() || {};
    const ca = data.createdAt;
    const isTS = ca && typeof ca.toDate === 'function'; // Firestore Timestamp
    if (!isTS){
      ops.push(updateDoc(doc(componentsColRef(), d.id), { createdAt: serverTimestamp() }));
    }
  }
  if (ops.length) {
    try { await Promise.all(ops); } catch(_) {}
  }
}


async function renderComponents(list = []) {
  const host = $('gr-evalsList');
  if (!host) return;

   // 🔹 Guardar valores locales escritos pero aún no guardados
  const localValues = {};
  host.querySelectorAll('.grade-item').forEach(item => {
    const code = item.querySelector('code')?.textContent?.trim();
    const inp = item.querySelector('[data-f="score"]');
    if (code && inp && inp.value) {
      localValues[code] = inp.value;
    }
  });

  // 🔹 Guardar qué grupos estaban abiertos antes del re-render
  const prevOpen = new Set(
    Array.from(host.querySelectorAll('details.grade-group[open]')).map(d => d.dataset.key)
  );

  host.innerHTML = '';

  if (!currentCourseId) {
    host.innerHTML = `<div class="muted">Selecciona un ramo.</div>`;
    return;
  }
  if (!list.length) {
    host.innerHTML = `<div class="muted">Aún no hay evaluaciones. Usa “Agregar evaluación”.</div>`;
    return;
  }

  const isMayor = (header.scale === 'MAYOR');
  const min  = isMayor ? 1 : 0;
  const max  = isMayor ? 7 : 100;
  const step = isMayor ? 0.1 : 1;

  // Agrupación extendida
  const grupos = {
    certamenes:  list.filter(c => /^C\d*/i.test(c.key) || /certamen/i.test(c.name)),
    controles:   list.filter(c => /^CTRL/i.test(c.key) || /control/i.test(c.name)),
    tareas:      list.filter(c => /^T\d*/i.test(c.key) || /tarea/i.test(c.name)),
    proyecto:    list.filter(c => /proy/i.test(c.key) || /proyecto/i.test(c.name)),
    evaluaciones: list.filter(c => /evaluaci[oó]n/i.test(c.name)),
    experiencias: list.filter(c => /experien/i.test(c.name)),
    preinformes:  list.filter(c => /pre[\s-]?informe/i.test(c.name)),
    informes:     list.filter(c => /\binforme/i.test(c.name) && !/pre[\s-]?informe/i.test(c.name)),
    laboratorios: list.filter(c => /\blab/i.test(c.key) || /laboratorio/i.test(c.name)),
    otros:        list.filter(c =>
      !(/^(C\d*|CTRL|T\d*|LAB)/i.test(c.key) ||
        /certamen|control|tarea|proy|evaluaci[oó]n|experien|informe|laboratorio/i.test(c.name))
    )
  };

  const defaultNames = {
    certamenes:   'Certámenes',
    controles:    'Controles',
    tareas:       'Tareas',
    proyecto:     'Proyecto',
    evaluaciones: 'Evaluaciones',
    experiencias: 'Experiencias',
    preinformes:  'Pre-informes',
    informes:     'Informes',
    laboratorios: 'Laboratorios',
    otros:        'Otros'
  };

  const names = { ...defaultNames, ...(_groupNamesCache || {}) };

  // 🔹 Render de cada grupo como <details>
  for (const [key, items] of Object.entries(grupos)) {
    if (!items.length) continue;

    const details = document.createElement('details');
    details.className = 'grade-group';
    details.dataset.key = key;

    // ✅ restaurar estado abierto si estaba abierto antes
    if (prevOpen.has(key)) details.open = true;

    const summary = document.createElement('summary');
    summary.style.display = 'flex';
    summary.style.alignItems = 'center';
    summary.style.justifyContent = 'space-between';
    summary.style.width = '100%';
    summary.style.cursor = 'pointer';

    const title = names[key] || defaultNames[key] || key;

    const titleSpan = document.createElement('span');
    titleSpan.style.fontWeight = '700';
    titleSpan.textContent = `${title} (${items.length})`;

    const editBtn = document.createElement('button');
    editBtn.dataset.rename = key;
    editBtn.className = 'ghost';
    editBtn.textContent = '✎';
    Object.assign(editBtn.style, {
      fontSize: '0.9em',
      opacity: '0.8',
      marginLeft: '8px',
      flexShrink: '0'
    });

    summary.appendChild(titleSpan);
    summary.appendChild(editBtn);
    details.appendChild(summary);

    const groupContainer = document.createElement('div');

    items.forEach(c => {
      const card = document.createElement('div');
      card.className = 'grade-item';
      card.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:700">${esc(c.name || c.key)}</div>
          <div class="muted">Código: <code>${esc(c.key)}</code></div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <input data-f="score" type="number" step="${step}" min="${min}" max="${max}" 
                 value="${localValues[c.key] ?? c.score ?? ''}"
 style="width:110px"/>
          <button data-act="save" class="btn btn-secondary">Guardar</button>
          <button data-act="del"  class="btn btn-secondary">Eliminar</button>
        </div>
      `;

      card.addEventListener('click', async (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;

        if (t.dataset.act === 'save') {
          const inp = card.querySelector('[data-f="score"]');
          let v = parseFloat(inp.value);
          const score = isNaN(v) ? null : clamp(v, min, max);
          await updateDoc(doc(componentsColRef(), c.id), { score });
          t.textContent = 'Guardado ✓';
          computeAndRender();
          setTimeout(() => t.textContent = 'Guardar', 1200);
        }

        if (t.dataset.act === 'del') {
          if (!confirm(`Eliminar “${c.name || c.key}”?`)) return;
          await deleteDoc(doc(componentsColRef(), c.id));
        }
      });

      groupContainer.appendChild(card);
    });

    details.appendChild(groupContainer);
    host.appendChild(details);

    // 🔹 Renombrar grupo
    editBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const curName = names[key] || defaultNames[key] || key;
      const newName = prompt(`Nuevo nombre para “${curName}”:`, curName);
      if (!newName || newName.trim() === curName) return;

      try {
        await saveGroupName(key, newName.trim());
        renderComponents(components);
      } catch {
        alert('No se pudo guardar el nuevo nombre.');
      }
    });
  }
}









/* =================== Cálculo =================== */

function computeAndRender(){
  // Mapa key -> valor (ya en escala del ramo)
  const values = {};
  const min = header.scale==='MAYOR' ? 1 : 0;
  const max = header.scale==='MAYOR' ? 7 : 100;

  components.forEach(c=>{
    if (typeof c.score === 'number'){
      values[c.key] = clamp(c.score, min, max);
    }
  });

  // 🔹 Añadir variable Asistencia al contexto de cálculo
if (window.courseAttendance && currentCourseId in window.courseAttendance) {
  values.Asistencia = window.courseAttendance[currentCourseId];
} else {
  values.Asistencia = 0;
}


  // Nota final
let final = null;
let lastErr = '';
if (header.finalExpr && header.finalExpr.trim()!==''){
  try{
    final = safeEvalExpr(header.finalExpr, values, {
  avg, min: Math.min, max: Math.max,
  final:      (name)=> lookupFinalByName(name),
  finalCode:  (code)=> lookupFinalByCode(code),
  finalId:    (id)=>   lookupFinalById(id)
});

    if (typeof final === 'number' && isFinite(final)){
      final = truncate(final, header.scale);
    } else {
      final = null;
    }
  }catch(e){
    lastErr = e?.message || String(e || '');
    final = null;
  }
}



$('gr-rulesStatus') && ( $('gr-rulesStatus').dataset.formulaError = lastErr );




  // Umbral efectivo fijo por escala
  const thr = (header.scale==='MAYOR') ? 3.95 : 54.5;

  // Reglas
  const rules = parseRules(header.rulesText || '');
  const rulesEval = evaluateRules(rules, values);

 // ✅ Estado: se refleja aunque no existan notas si las reglas fallan
let status = null;

if (final == null) {
  // No hay nota final, pero revisamos las reglas
  if (rulesEval.allOk) {
    status = '—'; // sin nota y reglas ok
  } else {
    status = 'Reprueba'; // incumple reglas (ej. asistencia baja)
  }
} else {
  // Hay nota final → debe cumplir nota + reglas
  status = (final >= thr && rulesEval.allOk) ? 'Aprueba' : 'Reprueba';
}


  // Necesitas
  let needed = '—';
  if (final == null){
    needed = 'Ingresa notas o completa la fórmula.';
  } else if (status === 'Aprueba'){
    needed = 'Nada más. Ya alcanzas la nota y cumples las reglas.';
  } else {
    const parts = [];
    if (final < thr){
      const diff = thr - final;
      parts.push(
        (header.scale==='MAYOR')
          ? `Subir la nota final en ${diff.toFixed(2)} pts.`
          : `Subir la nota final en ${diff.toFixed(1)} pts.`
      );
    }
    if (!rulesEval.allOk){
  // Solo listar qué reglas faltan, sin cuantificar “faltan ≈ …”
  const msgs = rulesEval.unmet.map(u => `Cumplir: ${u.text}.`);
  parts.push(...msgs);
}

    needed = parts.join(' ');
  }

  // Render
  renderRulesStatus(rulesEval);
  renderResult({ final, thr, status, needed });
}

async function rebuildCrossFinals(){
  crossFinals = { byName:{}, byCode:{}, byId:{} };
  if (!state.currentUser || !state.activeSemesterId) return;
  // Necesitamos la lista de ramos del semestre (ya la tiene state.courses gracias a courses.js)
  const courses = Array.isArray(state.courses) ? state.courses : [];
  // Para cada ramo, leemos su meta y componentes, y calculamos su final
  for (const c of courses){
    try{
      const metaRef = doc(
        db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,
        'courses',c.id,'grading','meta'
      );
      const metaSnap = await getDoc(metaRef);
      const meta = metaSnap.exists() ? metaSnap.data() : { scale:'USM', finalExpr:'' };

      // Lee componentes
      const compRef = collection(
        db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,
        'courses',c.id,'grading','meta','components'
      );
      const compSnap = await getDocs(compRef);
      const comps = compSnap.docs.map(d => ({ id:d.id, ...d.data() }));

      // Prepara valores (key -> score) en la escala del ramo
      const values = {};
      const min = meta.scale==='MAYOR' ? 1 : 0;
      const max = meta.scale==='MAYOR' ? 7 : 100;
      for (const k of comps){
        if (typeof k.score === 'number' && isFinite(k.score)){
          const v = Math.max(min, Math.min(max, k.score));
          values[k.key] = v;
        }
      }

      // Calcula final (si hay fórmula)
      let final = null;
      if ((meta.finalExpr||'').trim()){
        try{
          final = safeEvalExpr(meta.finalExpr, values, {
            avg, min: Math.min, max: Math.max,
            final:  (name)=> NaN,            // evitar recursión entre ramos al precalcular
            finalCode: (_)=> NaN,
            finalId: (_)=> NaN
          });
          if (typeof final === 'number' && isFinite(final)){
            final = truncate(final, meta.scale);
          } else {
            final = null;
          }
        }catch{ final = null; }
      }

      // DESPUÉS (normaliza nombre y código para búsquedas tolerantes)
const nameKey = normStr(c.name);
const codeKey = normStr(c.code);
if (nameKey) crossFinals.byName[nameKey] = { final, scale: meta.scale, id:c.id };
if (codeKey) crossFinals.byCode[codeKey] = { final, scale: meta.scale, id:c.id };
crossFinals.byId[c.id] = { final, scale: meta.scale, id:c.id };


    }catch{ /* ignorar errores puntuales para no romper la UI */ }
  }
}


/* ======= Reglas: parsing + evaluación ======= */

function parseRules(text){
  const lines = (text || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return lines;
}

function evaluateRules(lines, vars, fns){
  const res = { allOk: true, items: [], unmet: [] };
  for (const line of lines){
    const parsed = parseComparison(line);
    if (!parsed){
      res.items.push({ text: line, ok: false, reason: 'inválida' });
      res.unmet.push({ text: line, kind: 'invalid' });
      res.allOk = false;
      continue;
    }
    const { left, op, right } = parsed;
    let lv = null, rv = null, ok = false;
    try{
      
      const baseFns = { avg, min: Math.min, max: Math.max,
        final: lookupFinalByName, finalCode: lookupFinalByCode, finalId: lookupFinalById };
      const useFns = { ...baseFns, ...(fns || {}) };

// 🔹 Asegurar que Asistencia esté disponible también dentro de las reglas
if (window.courseAttendance && currentCourseId in window.courseAttendance) {
  vars.Asistencia = window.courseAttendance[currentCourseId];
} else if (!('Asistencia' in vars)) {
  vars.Asistencia = 0;
}

// Permitir expresiones con "%", ej. "Asistencia >= 55%"
const cleanLeft  = left.replace(/%/g, '');
const cleanRight = right.replace(/%/g, '');


     lv = safeEvalExpr(cleanLeft,  vars, useFns);
rv = safeEvalExpr(cleanRight, vars, useFns);


      ok = compare(lv, op, rv);
    }catch{
      ok = false;
    }
    res.items.push({ text: line, ok, left: lv, op, right: rv });
    if (!ok){
      res.unmet.push({ text: line, kind: 'cmp', left: lv, op, right: rv });
      res.allOk = false;
    }
  }
  return res;
}

// Soporta operadores: >=, <=, >, <, ==, !=
function parseComparison(s){
  const m = s.match(/^(.*?)(>=|<=|==|!=|>|<)(.*)$/);
  if (!m) return null;
  return { left: normalizeExpr(m[1].trim()), op: m[2], right: normalizeExpr(m[3].trim()) };
}

function compare(a, op, b) {
  if (!(isFinite(a) && isFinite(b))) return false;

  // 🔹 Redondear a 1 decimal para seguridad y luego al entero más cercano
  const A = Math.round((Math.round(a * 10) / 10));
  const B = Math.round((Math.round(b * 10) / 10));

  switch (op) {
    case '>=': return A >= B;
    case '<=': return A <= B;
    case '>':  return A >  B;
    case '<':  return A <  B;
    case '==': return A === B;
    case '!=': return A !== B;
    default: return false;
  }
}



// Reemplaza la versión antigua
// ✅ Corrige el cálculo promedio con múltiples argumentos
function avg(...args) {
  const nums = args
    .map(x => (typeof x === 'number' && isFinite(x)) ? x : Number(x))
    .filter(x => !isNaN(x));

  if (!nums.length) return NaN;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}



/* ======= Resultado ======= */

function renderRulesStatus(r){
  const el = $('gr-rulesStatus');
  if (!el) return;
  if (!r || !r.items.length){
    el.textContent = 'No hay reglas definidas.';
    return;
  }
  const okCount = r.items.filter(x=>x.ok).length;
  const parts = r.items.map(x => x.ok ? `✅ ${x.text}` : `❌ ${x.text}`);
  el.innerHTML = `<div><b>Reglas:</b> ${okCount}/${r.items.length} cumplidas</div><div style="margin-top:4px">${parts.join('<br/>')}</div>`;
}

/* Mostrar Resultado */
function renderResult(res){
  const f = $('gr-currentFinal') || $('gr-currentAvg');
  const s = $('gr-status');
  const n = $('gr-needed') || $('gr-neededToPass');

  if (!f || !s || !n) return;

  // ⬇️ Sin placeholders con “—”
  if (!res){
    f.textContent = '';
    s.textContent = '';
    n.textContent = '';
    delete f.dataset.base; delete s.dataset.base;
    return;
  }

  const scale = header?.scale || 'USM';
  const shown = (res.final==null) ? '' : truncate(res.final, scale).toString(); // ← vacío si no hay dato
  f.textContent = shown;
  s.textContent = res.status ?? '';
  n.textContent = res.needed ?? '';
}



/* =================== Helpers =================== */

// ====== SIMULADOR: helpers ======
// Reemplaza la versión anterior
function gr_getFormulaStr() {
  return (document.getElementById('gr-finalExpr')?.value || '').trim();
}

function gr_readRulesText() {
  return (document.getElementById('gr-rulesText')?.value || '').trim();
}
function gr_parseRulesArr() {
  const t = gr_readRulesText();
  if (!t) return [];
  return t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// Intenta leer evaluaciones + notas actuales desde la UI de Notas.
// Ajusta los selectores si tus inputs usan otros ids/clases.
function gr_collectEvaluationsFromUI() {
  // Esperamos filas con inputs de Código y Nota (ej. "C1" y "62" o "5.5")
  // Fallback genérico:
  const rows = Array.from(document.querySelectorAll('[data-gr-eval-row], .gr-eval-row'));
  const list = [];
  if (rows.length) {
    rows.forEach(r => {
      const code = r.querySelector('[data-code], .gr-code, input[placeholder*="C1"], input[placeholder*="T1"]')?.value?.trim() || '';
      const name = r.querySelector('[data-name], .gr-name, input[placeholder*="Certamen"], input[placeholder*="Proyecto"]')?.value?.trim() || '';
      const gradeRaw = r.querySelector('[data-grade], .gr-grade, input[placeholder*="62"], input[placeholder*="5.5"]')?.value?.trim() || '';
      const g = gradeRaw ? Number(gradeRaw.replace(',', '.')) : null;
      if (code) list.push({ code, name: name || code, grade: (Number.isFinite(g) ? g : null) });
    });
  }
  // Si tu módulo ya tiene un modelo JS de evaluaciones, reemplaza este lector por ese arreglo.
  return list;
}



function debounce(fn, ms){
  let t = null;
  return (...args)=>{
    if (t) clearTimeout(t);
    t = setTimeout(()=> fn(...args), ms);
  };
}


function readyPath(){
  return !!(state.currentUser && state.activeSemesterId && currentCourseId);
}
function parseMaybe(x){
  const v = parseFloat(x); return isNaN(v)? null : v;
}
function esc(s){ return (s??'').toString().replace(/[<>&"]/g, m=>({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[m])); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

/* ---------- Fórmulas ---------- */

function normalizeExpr(expr){
  if (!expr) return '';
  let s = String(expr).trim();
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); // tipográficas → rectas
  // ❌ NO convertir comas a puntos aquí (rompe avg(E1,E2))
  // s = s.replace(/,/g, '.');
  s = s.replace(/\s+/g, ' ');    // compacta espacios
  return s;
}


// Envuelve en comillas los argumentos de final()/finalCode()/finalId() si no vienen con comillas.
// Ej.: final(Laboratorio de Física) -> final("Laboratorio de Física")
function autoQuoteFunctionArgs(s){
  return s.replace(/\b(final|finalCode|finalId)\(\s*([^)]+?)\s*\)/g, (m, fn, rawArg) => {
    const a = String(rawArg).trim();
    // Si ya viene con comillas al inicio, respeta: final("X") / final('X')
    if (/^["'].*["']$/.test(a)) return `${fn}(${a})`;
    // Si el usuario metió una expresión (rara) con paréntesis/comas, no la tocamos
    if (/[(),]/.test(a)) return `${fn}(${a})`;
    // En cualquier otro caso, lo envolvemos en comillas dobles
    const quoted = a.replace(/"/g, '\\"');
    return `${fn}("${quoted}")`;
  });
}



// Convierte % solo para evaluar (20% -> (20/100))
function prepareForEval(expr){
  if (!expr) return '';
  return expr.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, n) => `(${n}/100)`);
}

// ✅ Evalúa expr tratando cualquier código no definido como 0
function safeEvalExpr(expr, vars, fns = {}){
  const normalized = normalizeExpr(expr);
  const withQuoted = autoQuoteFunctionArgs(normalized);

  // enmascara strings para no confundir identificadores dentro de comillas
  const masked = withQuoted.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '0');

  // solo permitimos letras, dígitos, _, ., +,-,*,/,%, comas y paréntesis
  if (!/^[\w\s\.\+\-\*\/\(\),%<>!=]+$/.test(masked)) {
    throw new Error('La fórmula contiene caracteres no permitidos.');
  }

  // convierte % a /100 para evaluar
  const e = prepareForEval(withQuoted);

  // 1) recolecta identificadores presentes en la expresión
  const ids = (masked.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []);

  // funciones permitidas que NO deben convertirse en variables
  const builtinFns = new Set(['avg','min','max','final','finalCode','finalId']);


  // palabras JS que tampoco
  const jsWords = new Set(['NaN','Infinity','Math','true','false']);

  // 2) arma claves/valores con vars existentes
  const keys = Object.keys(vars);
  const vals = keys.map(k => vars[k] ?? 0);

  // 3) agrega como variables = 0 todos los ids desconocidos
  const have = new Set([...keys, ...Object.keys(fns)]);
  for (const id of ids) {
    if (builtinFns.has(id) || jsWords.has(id)) continue;
    if (!have.has(id)) { keys.push(id); vals.push(0); have.add(id); }
  }

  // 4) evalúa con funciones y variables
  const fnNames = Object.keys(fns);
  const fnVals  = Object.values(fns);

  // eslint-disable-next-line no-new-func
  return Function(...fnNames, ...keys, `"use strict"; return (${e});`)(...fnVals, ...vals);
}


// Extrae identificadores tipo "C1", "T2", "P1" desde la fórmula (excluye funciones)
function parseCodesFromFormula(formula){
  const normalized = normalizeExpr(formula || '');
  const withQuoted = autoQuoteFunctionArgs(normalized);
  // enmascara strings para no confundir identificadores dentro de comillas
  const masked = withQuoted.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '0');
  // tokens tipo identificador
  const toks = masked.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
  const reserved = new Set(['avg','min','max','final','finalCode','finalId','NaN','Infinity','Math','true','false']);
  // filtra los que claramente son funciones (token seguido de "(" en el texto original)
  const fnCall = new Set((withQuoted.match(/\b[A-Za-z_][A-Za-z0-9_]*\s*\(/g) || [])
                   .map(s => s.replace('(','').trim()));
  const ids = toks.filter(t => !reserved.has(t) && !fnCall.has(t));
  return [...new Set(ids)];
}






/* ---- Render del panel ---- */


/* ---- Sufijos “(duo: …)” en el resultado propio ---- */

function truncate(val, scale){
  if (val == null || isNaN(val)) return null;
  if (scale === 'MAYOR'){
    return Math.trunc(val * 100) / 100;   // 2 decimales truncados
  } else {
    return Math.trunc(val * 10) / 10;     // 1 decimal truncado
  }
}

function normStr(s){
  return (s||'')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // sin tildes
    .replace(/\s+/g,' ').trim().toLowerCase();
}





function lookupFinalByName(name){
  const k = normStr(name);
  if (!k) return NaN;

  const cur = (state.courses||[]).find(x=>x.id===currentCourseId);
  if (k === normStr(cur?.name)) return NaN; // evita autoreferencia

  const exact = crossFinals.byName[k];
  if (exact && typeof exact.final === 'number') return exact.final;

  const all = Array.isArray(state.courses) ? state.courses : [];
  const starts = all.filter(c => normStr(c.name).startsWith(k) && c.id !== currentCourseId);
  if (starts.length === 1){
    const hit = crossFinals.byId[starts[0].id];
    if (hit && typeof hit.final === 'number') return hit.final;
  }
  const contains = all.filter(c => normStr(c.name).includes(k) && c.id !== currentCourseId);
  if (contains.length === 1){
    const hit = crossFinals.byId[contains[0].id];
    if (hit && typeof hit.final === 'number') return hit.final;
  }
  return NaN;
}




function lookupFinalByCode(code){
  const k = normStr(code);
  const cur = (state.courses||[]).find(x=>x.id===currentCourseId);
  if (k && k === normStr(cur?.code)) return NaN;
  const hit = crossFinals.byCode[k];
  return (hit && typeof hit.final === 'number') ? hit.final : NaN;
}
function lookupFinalById(id){
  if (!id || id===currentCourseId) return NaN;
  const hit = crossFinals.byId[id];
  return (hit && typeof hit.final === 'number') ? hit.final : NaN;
}

// ====== MODO "NOTAS DE MI DUO" (simple) ======

// 3.1 Toggle (usa el botón #gr-togglePartner y los contenedores del HTML nuevo)
(function setupPartnerToggle(){
  const btn = $('gr-togglePartner');
  if (!btn) return;

  // tarjetas propias (las del UI de "Mis Notas")
  const ownBlocks = [
    $('gr-courseSel')?.closest('.card'),
    $('gr-evalsList')?.closest('.card'),
    $('gr-finalExpr')?.closest('.card'),
    $('gr-currentFinal')?.closest('.card') || $('gr-currentAvg')?.closest('.card'),
    $('gr-rulesCard'),
  ].filter(Boolean);

  const partnerCard = $('gr-partnerView');

  function setMode(on){
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Volver a mis notas' : 'Notas de mi duo';
    ownBlocks.forEach(el => setHidden(el, on));
    setHidden(partnerCard, !on);
    if (on) grpPopulateSemesters(); // carga combo al encender
  }

  btn.addEventListener('click', ()=>{
    const now = btn.getAttribute('aria-pressed') === 'true';
    setMode(!now);
  });

  // si tu duo queda lista, rellenamos
  document.addEventListener('pair:ready', grpPopulateSemesters);
})();

// 3.2 Poblar semestres de tu duo (bloqueado al semestre activo actual)
let _grpPopulateToken = 0;
async function grpPopulateSemesters() {
  const sel = $('gr-sh-semSel');
  if (!sel) return;

  // Limpia
  sel.innerHTML = '';
  const optLoading = document.createElement('option');
  optLoading.textContent = 'Cargando...';
  optLoading.disabled = true;
  optLoading.selected = true;
  sel.appendChild(optLoading);

  // Si no hay dúo, mostrar mensaje
  if (!state.pairOtherUid) {
    sel.innerHTML = '<option selected>No disponible</option>';
    sel.disabled = true;
    sel.style.pointerEvents = 'none';
    sel.style.opacity = '0.7';
    return;
  }

  const myToken = ++_grpPopulateToken;
  const ref = collection(db, 'users', state.pairOtherUid, 'semesters');
  const snap = await getDocs(ref);
  if (myToken !== _grpPopulateToken) return;

  const activeLabel = state.activeSemesterData?.label || null;

  if (!activeLabel) {
    sel.innerHTML = '<option selected>No disponible</option>';
    sel.disabled = true;
    sel.style.pointerEvents = 'none';
    sel.style.opacity = '0.7';
    return;
  }

  // Busca si el dúo tiene ese mismo semestre (por label)
  let match = null;
  snap.forEach(d => {
    const lbl = (d.data()?.label || '').trim();
    if (lbl === activeLabel) match = { id: d.id, label: lbl };
  });

  if (match) {
    // Si lo tiene → lo muestra y suscribe normalmente
    sel.innerHTML = `<option selected>${match.label}</option>`;
    sel.disabled = true;
    sel.style.pointerEvents = 'none';
    sel.style.opacity = '0.7';
    state.shared.notas.semId = match.id;
    subscribePartnerGrades(match.id);
  } else {
    // Si no lo tiene → muestra "No disponible"
    sel.innerHTML = '<option selected>No disponible</option>';
    sel.disabled = true;
    sel.style.pointerEvents = 'none';
    sel.style.opacity = '0.7';
    state.shared.notas.semId = null;
    const list = $('gr-sh-list');
    if (list) list.innerHTML = '<div class="muted">Tu dúo no tiene este semestre creado.</div>';
  }
}



// 3.3 Suscribir y renderizar notas por semestre (solo final + estado)
let _grpUnsubCourses = null;
function cleanupPartnerSubs(){ if (_grpUnsubCourses){ _grpUnsubCourses(); _grpUnsubCourses=null; } }

async function subscribePartnerGrades(semId){
  cleanupPartnerSubs();
  const list = $('gr-sh-list'); 
  if (list) list.innerHTML = '';
  if (!state.pairOtherUid || !semId) return;

  // universidad para escala/umbral por defecto
  const semSnap = await getDoc(doc(db,'users',state.pairOtherUid,'semesters',semId));
  const uniReadable = semSnap.exists() ? (semSnap.data().universityAtThatTime || '') : '';
  const SCALE = /mayor/i.test(uniReadable) ? 'MAYOR' : 'USM';

  // cursos del semestre (duo)
  const coursesRef = collection(db,'users',state.pairOtherUid,'semesters',semId,'courses');
  _grpUnsubCourses = onSnapshot(query(coursesRef, orderBy('name')), async (snap)=>{
    if (!snap.size){ renderPartnerRows([]); return; }

    // -------- PRIMERA PASADA: preparar data y finals preliminares --------
    const finalsByCode = {};
    const tempRows = [];

    for (const c of snap.docs){
      const cData = c.data() || {};
      const courseId = c.id;

      // meta
      const metaRef = doc(db,'users',state.pairOtherUid,'semesters',semId,'courses',courseId,'grading','meta');
      const metaSnap = await getDoc(metaRef);
      const meta = metaSnap.exists() ? metaSnap.data() : { scale:SCALE, finalExpr:'', rulesText:'' };

      // comps
      const compsCol = collection(db,'users',state.pairOtherUid,'semesters',semId,'courses',courseId,'grading','meta','components');
      const compsSnap = await getDocs(compsCol);
      const comps = compsSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }));

      // valores
      const vals = {};
      const isMayor = (meta.scale==='MAYOR');
      const min = isMayor ? 1 : 0;
      const max = isMayor ? 7 : 100;
      comps.forEach(k=>{
        const v = typeof k.score==='number' ? Math.max(min, Math.min(max, k.score)) : null;
        if (v!=null && k.key) vals[k.key] = v;
      });

      // final preliminar sin cross-refs
      let prelim = null;
      try{
        if ((meta.finalExpr||'').trim()){
          prelim = safeEvalExpr(meta.finalExpr, vals, {
            avg, min: Math.min, max: Math.max,
            final: ()=>NaN, finalCode: ()=>NaN, finalId: ()=>NaN
          });
          if (typeof prelim==='number' && isFinite(prelim)){
            prelim = truncate(prelim, meta.scale);
          } else prelim = null;
        }
      }catch{ prelim = null; }

      finalsByCode[(cData.code||'').toLowerCase()] = prelim;
      tempRows.push({ cData, comps, vals, meta, prelim });
    }

    // -------- SEGUNDA PASADA: calcular finals con soporte finalCode --------
    const rows = [];
    for (const r of tempRows){
      let final = r.prelim;
      try{
        if ((r.meta.finalExpr||'').trim()){
          final = safeEvalExpr(r.meta.finalExpr, r.vals, {
            avg,
            min: Math.min,
            max: Math.max,
            final: ()=>NaN,
            finalCode: (code)=>{
              const k = (code||'').toString().toLowerCase();
              return finalsByCode[k] ?? NaN;
            },
            finalId: ()=>NaN
          });
          if (typeof final==='number' && isFinite(final)){
            final = truncate(final, r.meta.scale);
          } else final = null;
        }
      }catch{ final = null; }

      const thr = (r.meta.scale==='MAYOR') ? 3.95 : 54.5;
      const rules = parseRules(r.meta.rulesText || '');
      const rulesEval = evaluateRules(rules, r.vals);
      const status = (final!=null && final>=thr && rulesEval.allOk) ? 'Aprobado' : (final==null ? '—' : 'Reprobado');

      rows.push({
        name: r.cData.name || 'Ramo',
        code: r.cData.code || '',
        final,
        scale: r.meta.scale || SCALE,
        status
      });
    }

    renderPartnerRows(rows);
  });
}


// 3.4 Render minimalista (sin depender de clases CSS especiales)
function renderPartnerRows(rows){
  const host = $('gr-sh-list'); if (!host) return;
  host.innerHTML = '';

  if (!rows.length){
    host.innerHTML = `<div class="muted">No hay ramos en ese semestre.</div>`;
    return;
  }

  rows.forEach(r=>{
    const val = (r.final==null) ? '—'
      : (r.scale==='MAYOR'
          ? (Math.trunc(r.final*100)/100).toFixed(2)
          : (Math.trunc(r.final*10)/10).toFixed(1));

    const color = r.status==='Aprobado'
      ? '#22c55e'
      : (r.status==='Reprobado' ? '#ef4444' : '#aaa');

    const row = document.createElement('div');
    row.className = 'grade-item'; // usa mismo estilo que notas propias
    row.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:700">${esc(r.name)}</div>
        <div class="muted">Nota final: <b>${val}</b></div>
      </div>
      <div style="font-weight:700;color:${color}">
        ${r.status}
      </div>
    `;
    host.appendChild(row);
  });
}

function valsFromComps(comps, meta){
  const vals = {};
  const isMayor = (meta.scale==='MAYOR');
  const min = isMayor ? 1 : 0;
  const max = isMayor ? 7 : 100;
  comps.forEach(k=>{
    const v = typeof k.score==='number' ? Math.max(min, Math.min(max, k.score)) : null;
    if (v!=null && k.key) vals[k.key] = v;
  });
  return vals;
}


// ====== SIMULADOR: Drawer, evaluación, persistencia ======


function gr_openSimDrawer({ formula, evals }) {
  // Cierra si ya existe
  document.getElementById('gr-simDrawer')?.remove();
  document.getElementById('gr-simBackdrop')?.remove();

  // ===== Backdrop que bloquea toda la app =====
  const backdrop = document.createElement('div');
  backdrop.id = 'gr-simBackdrop';
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: 9998,
    background: 'rgba(0,0,0,0.35)',
    backdropFilter: 'blur(1px)'
  });

  // Bloquea scroll del body mientras esté abierto
  document.body.classList.add('sim-lock');

  // ===== Drawer (ventana de simulación) =====
  const drawer = document.createElement('div');
  drawer.id = 'gr-simDrawer';
  Object.assign(drawer.style, {
    position: 'fixed', top: '0', right: '0', height: '100vh',
    width: '420px', background: 'rgba(18,18,30,.98)', backdropFilter: 'blur(6px)',
    borderLeft: '1px solid rgba(255,255,255,.08)', boxShadow: '0 0 24px rgba(0,0,0,.45)',
    zIndex: 9999, padding: '16px 16px 90px 16px', overflowY: 'auto'
  });

  // Evita que los clics pasen al backdrop
  drawer.addEventListener('click', (e) => e.stopPropagation());

  drawer.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <h3 style="margin:0">Simulador de notas</h3>
      <span class="muted" style="font-size:12px;opacity:.8">(${esc(formula)})</span>
    </div>

    <div class="card" style="margin-top:4px">
      <h4 style="margin:0 0 6px">Evaluaciones</h4>
      <div id="gr-simForm"></div>
    </div>

    <div class="card" style="margin-top:12px">
      <h4 style="margin:0 0 6px">Resumen de la simulación</h4>
      <div id="gr-simSummary" class="muted">—</div>
    </div>

    <div class="card" style="margin-top:12px">
      <h4 style="margin:0 0 6px">Reglas del ramo (simulación)</h4>
      <div id="gr-simRules" class="muted">—</div>
    </div>

    <div style="position:fixed; right:16px; bottom:16px; display:flex; gap:8px;">
      <button id="gr-simSave" class="primary">Guardar simulación</button>
      <button id="gr-simClose" class="ghost">Salir</button>
    </div>
  `;

  // Inserta backdrop y drawer (orden importa)
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  // Cerrar (compartido por botón, ESC y click en backdrop)
  const doClose = async () => {
    const wants = confirm('¿Guardar esta simulación antes de salir?');
    if (wants) {
      const snap = recompute();
      try { await gr_saveSimulation(snap.gradesMap, formula); } catch(_) {}
    }
    backdrop.remove();
    drawer.remove();
    document.body.classList.remove('sim-lock');
  };

  backdrop.addEventListener('click', doClose);
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') doClose();
  });
  drawer.querySelector('#gr-simClose')?.addEventListener('click', doClose);

  // Trap de foco dentro del drawer
  trapFocus(drawer);

  const formHost = drawer.querySelector('#gr-simForm');

  // ----- Evaluaciones: reales + faltantes según la fórmula -----
  const existing = new Map((evals || []).map(e => [e.code, e.grade]));
  const codesInFormula = parseCodesFromFormula(formula);
  const existingCodes  = new Set((evals || []).map(e => e.code));
  const allCodes       = [...new Set([...existingCodes, ...codesInFormula])];

 // --- NUEVO BLOQUE ---
const rows = [];

for (const code of allCodes) {
  const ev = (evals || []).find(e => e.code === code) || { name: code };
  const val = existing.get(code);
  const isMayor = (header.scale === 'MAYOR');
  const min  = isMayor ? 1 : 0;
  const max  = isMayor ? 7 : 100;
  const step = isMayor ? 0.1 : 1;
  const autoBadge = existingCodes.has(code) ? '' :
    `<span class="muted" style="font-size:12px;margin-left:6px;opacity:.7">(auto)</span>`;

  rows.push(`
    <div class="row" style="align-items:center;gap:8px;margin:6px 0" data-sim-code="${esc(code)}">
      <div style="min-width:76px"><b>${esc(code)}</b>${autoBadge}</div>
      <div style="flex:1">${esc(ev.name || code)}</div>
      <input type="number" step="${step}" min="${min}" max="${max}" style="width:110px" placeholder="—" value="${val ?? ''}">
    </div>
  `);
}

// 🔹 Detección de referencias a otros ramos (finalCode / final)
const matches = [...formula.matchAll(/finalCode\(["'](.+?)["']\)/g)];
for (const m of matches) {
  const refCode = m[1];
  const finalVal = lookupFinalByCode(refCode);
  if (isFinite(finalVal)) {
    rows.push(`
      <div class="row" style="align-items:center;gap:8px;margin:6px 0;opacity:.85" data-sim-ref="${esc(refCode)}">
        <div style="min-width:76px"><b>NF</b></div>
        <div style="flex:1">Nota final de ${esc(refCode)}</div>
        <input type="number" readonly value="${finalVal}" style="width:110px;opacity:.7;background:#222;border:none;color:#ccc">
      </div>
    `);
  } else {
    rows.push(`
      <div class="row" style="align-items:center;gap:8px;margin:6px 0;opacity:.75" data-sim-ref="${esc(refCode)}">
        <div style="min-width:76px"><b>NF</b></div>
        <div style="flex:1;color:#aaa">Nota final de ${esc(refCode)}</div>
        <div style="width:110px;text-align:center;color:#f87171">—</div>
      </div>
    `);
  }
}

formHost.innerHTML = rows.join('');

const nameRefs = [...formula.matchAll(/final\(["'](.+?)["']\)/g)];
for (const m of nameRefs) {
  const refName = m[1];
  const finalVal = lookupFinalByName(refName);
  if (isFinite(finalVal)) {
    formHost.insertAdjacentHTML('beforeend', `
      <div class="row" style="align-items:center;gap:8px;margin:6px 0;opacity:.85" data-sim-ref="${esc(refName)}">
        <div style="min-width:76px"><b>NF</b></div>
        <div style="flex:1">Nota final de ${esc(refName)}</div>
        <input type="number" readonly value="${finalVal}" style="width:110px;opacity:.7;background:#222;border:none;color:#ccc">
      </div>
    `);
  }
}


  // ----- Recalcular -----
  const recompute = () => {
    const map = {};
    formHost.querySelectorAll('[data-sim-code]').forEach(row => {
      const c = row.getAttribute('data-sim-code');
      const v = row.querySelector('input')?.value?.trim();
      const n = v ? Number(String(v).replace(',','.')) : null;
      map[c] = (Number.isFinite(n) ? n : 0);
    });

    let result = null, err = null;
    try {
      result = safeEvalExpr(formula, { ...map }, {
  avg,
  min: Math.min,
  max: Math.max,
  final: (name) => lookupFinalByName(name),
  finalCode: (code) => lookupFinalByCode(code),
  finalId: (id) => lookupFinalById(id)
});

      if (typeof result === 'number' && isFinite(result)) result = truncate(result, header.scale);
      else result = null;
    } catch(e) {
      err = e?.message || String(e || '');
      result = null;
    }

    const rules = parseRules(header.rulesText || '');
const rulesEval = evaluateRules(rules, map);

// Umbral según escala
const thr = (header.scale === 'MAYOR') ? 3.95 : 54.5;

// Mensaje de “necesitas”
let needMsg = '';
if (err) {
  needMsg = '';
} else if (result == null) {
  needMsg = 'Ingresa valores para simular.';
} else {
  const parts = [];
  if (result < thr) {
    const diff = thr - result;
    parts.push(
      header.scale === 'MAYOR'
        ? `Subir la nota final en ${diff.toFixed(2)} pts.`
        : `Subir la nota final en ${diff.toFixed(1)} pts.`
    );
  }
  if (!rulesEval.allOk) {
    const faltan = rulesEval.unmet.map(u => u.text);
    if (faltan.length) {
      parts.push(`Cumplir reglas pendientes: ${faltan.map(esc).join('; ')}.`);
    }
  }
  needMsg = parts.length ? parts.join(' ') : 'Nada más. Ya apruebas.';
}

// Render del resumen
const sumEl = drawer.querySelector('#gr-simSummary');
sumEl.innerHTML = err
  ? `<div style="color:#f87171">Error en fórmula: ${esc(err)}</div>`
  : `
    <div>Promedio simulado: <b>${result==null ? '—' : result}</b></div>
    <div class="muted" style="margin-top:6px">(Usa tu fórmula final actual)</div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:10px 0">
    <div><b>Necesitas para aprobar</b></div>
    <div style="margin-top:4px">${needMsg}</div>
  `;


    const rulesEl = drawer.querySelector('#gr-simRules');
    if (!rules.length) {
      rulesEl.textContent = 'No hay reglas definidas.';
    } else {
      const ok = rulesEval.items.filter(x => x.ok).length;
      rulesEl.innerHTML = `
        <div style="margin-bottom:6px">Cumplidas: <b>${ok}/${rules.length}</b></div>
        <ul style="margin:0 0 0 18px;padding:0;list-style:disc;">
          ${rulesEval.items.map(x => `<li style="color:${x.ok ? '#22c55e' : '#ef4444'}">${esc(x.text)}</li>`).join('')}
        </ul>
      `;
    }
    return { gradesMap: map, result };
  };

  formHost.addEventListener('input', recompute);
  recompute();

  // ----- Guardar -----
  drawer.querySelector('#gr-simSave')?.addEventListener('click', async () => {
    const snap = recompute();
    try {
      const r = await gr_saveSimulation(snap.gradesMap, formula);
      alert(r?.where === 'cloud' ? 'Simulación guardada en la nube.' : 'Simulación guardada');
    } catch(e) {
      console.error(e);
      alert('No se pudo guardar la simulación.');
    }
  });

  // ----- Autocargar última simulación (fallback cloud → local) -----
  gr_loadLastSimulation().then(last => {
    if (!last) return;
    formHost.querySelectorAll('[data-sim-code]').forEach(row => {
      const c = row.getAttribute('data-sim-code') || '';
      const inp = row.querySelector('input');
      if (!inp) return;
      // tolerante a mayúsculas/minúsculas y claves normalizadas
      const v = last[c] ?? last[c.toUpperCase()] ?? last[c.toLowerCase()];
      if (v != null) inp.value = String(v);
    });
    recompute();
  }).catch(()=>{});


}

// Atrapa el foco dentro del drawer (Tab / Shift+Tab)
function trapFocus(container){
  const focusable = () => Array.from(container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);

  const first = () => focusable()[0];
  const last  = () => focusable().slice(-1)[0];

  setTimeout(() => first()?.focus(), 0);

  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusable();
    if (!f.length) return;
    const current = document.activeElement;
    if (e.shiftKey) {
      if (current === f[0]) { e.preventDefault(); last()?.focus(); }
    } else {
      if (current === f[f.length - 1]) { e.preventDefault(); first()?.focus(); }
    }
  });
}



// Guarda una simulación (varias por ramo) y también "__last__" para autocompletar
async function gr_saveSimulation(gradesMap, formulaStr) {
  // Normaliza claves a MAYÚSCULAS para evitar descalces C2/c2
  const normGrades = {};
  Object.keys(gradesMap || {}).forEach(k => { normGrades[String(k).toUpperCase()] = gradesMap[k]; });

  const payload = {
    formula: formulaStr,
    grades: normGrades,
    rules: parseRules(header.rulesText || ''),
    semId: state.activeSemesterId || null,
    courseId: state.editingCourseId || null,
    createdAt: serverTimestamp()

  };

  if (state.currentUser && state.activeSemesterId && state.editingCourseId) {
    try {
      const base = [
        'users', state.currentUser.uid,
        'semesters', state.activeSemesterId,
        'courses', state.editingCourseId,
        'simulations'
      ];
      await addDoc(collection(db, ...base), payload);              // histórico
      await setDoc(doc(db, ...base, '__last__'), payload);         // última
      return { ok: true, where: 'cloud' };
    } catch (e) {
      console.warn('Fallo Firestore, usando localStorage:', e);
      // sigue a local
    }
  }

  const key = `sim:last:${state.activeSemesterId || 'SEM'}:${state.editingCourseId || 'COURSE'}`;
  localStorage.setItem(key, JSON.stringify(payload));
  return { ok: true, where: 'local' };
}




async function gr_loadLastSimulation() {
  const key = `sim:last:${state.activeSemesterId || 'SEM'}:${state.editingCourseId || 'COURSE'}`;

  // 1) Intentar en Firestore si hay sesión y ruta válida
  if (state.currentUser && state.activeSemesterId && state.editingCourseId) {
    try {
      const lastRef = doc(
        db, 'users', state.currentUser.uid,
        'semesters', state.activeSemesterId,
        'courses', state.editingCourseId,
        'simulations', '__last__'
      );
      const snap = await getDoc(lastRef);
      if (snap.exists()) {
        const g = snap.data()?.grades || null;
        return g && typeof g === 'object' ? g : null;
      }
      // si no existe en la nube → pasar a local
    } catch {
      // continuar a local
    }
  }

  // 2) Fallback: localStorage
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const g = data?.grades || null;
    return g && typeof g === 'object' ? g : null;
  } catch {
    return null;
  }
}

// Devuelve el objeto de un curso por nombre aproximado
export function findCourse(name){
  if (!name || !state.courses) return null;
  const norm = (s)=> String(s||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,'');
  const n = norm(name);
  return state.courses.find(c =>
    norm(c.name).includes(n) || norm(c.code||'').includes(n)
  ) || null;
}








// ===================== Helpers =====================
async function calcCourseAverage(courseDoc) {
  // Para cada curso, recorrer sus rules → grades → promedio ponderado
  const rulesRef = collection(courseDoc.ref, 'rules');
  const rulesSnap = await getDocs(rulesRef);

  let totalWeighted = 0;
  let totalWeight = 0;

  for (const rule of rulesSnap.docs) {
    const r = rule.data();
    const peso = Number(r.peso) || 0;

    const gradesRef = collection(rule.ref, 'grades');
    const gradesSnap = await getDocs(gradesRef);
    const notas = gradesSnap.docs.map(g => Number(g.data().valor)).filter(x => !isNaN(x));

    if (notas.length > 0) {
      const avg = notas.reduce((a,b)=>a+b,0) / notas.length;
      totalWeighted += avg * (peso/100);
      totalWeight += peso;
    }
  }

  return totalWeight > 0 ? +(totalWeighted).toFixed(2) : null;
}

// ===================== Funciones públicas =====================

// Calcular promedio ponderado del semestre
export async function calcPromedioSemestre(semId) {
  if (!state.currentUser) return null;
  const semRef = collection(db, 'users', state.currentUser.uid, 'semesters', semId, 'courses');
  const coursesSnap = await getDocs(semRef);

  let sum = 0, count = 0;
  for (const courseDoc of coursesSnap.docs) {
    const avg = await calcCourseAverage(courseDoc);
    if (avg != null) { sum += avg; count++; }
  }

  return count > 0 ? +(sum/count).toFixed(2) : null;
}

// Nota mínima necesaria en examen final
export function calcNotaMinima(ramo) {
  // Supongamos que `ramo` ya trae { rules:[{tipo,peso,notas:[...]}, ...], scale }
  const scale = ramo.scale || 'USM';
  const notaAprob = (scale === 'MAYOR') ? 4.0 : 55;

  let acumulado = 0;
  let pesoAcumulado = 0;
  let pesoExamen = 0;

  for (const r of (ramo.rules || [])) {
    const peso = Number(r.peso) || 0;
    if (r.tipo.toLowerCase().includes('examen')) {
      pesoExamen = peso;
      continue;
    }
    if (r.notas?.length) {
      const avg = r.notas.reduce((a,b)=>a+b,0)/r.notas.length;
      acumulado += avg * (peso/100);
      pesoAcumulado += peso;
    }
  }

  if (pesoExamen === 0) return null; // no hay examen en las reglas
  const needed = (notaAprob - acumulado) / (pesoExamen/100);
  return +(needed.toFixed(2));
}

// ¿Está aprobando?
export function isPassing(ramo) {
  const scale = ramo.scale || 'USM';
  const notaAprob = (scale === 'MAYOR') ? 4.0 : 55;
  return ramo.promedio >= notaAprob;
}

// Diferencia con nota mínima
export function calcBrecha(ramo) {
  const scale = ramo.scale || 'USM';
  const notaAprob = (scale === 'MAYOR') ? 4.0 : 55;
  return +(Math.max(0, notaAprob - (ramo.promedio || 0)).toFixed(2));
}

// Mejor / peor ramo
export async function bestWorst(semId) {
  if (!state.currentUser) return { best:null, worst:null };

  const semRef = collection(db, 'users', state.currentUser.uid, 'semesters', semId, 'courses');
  const coursesSnap = await getDocs(semRef);

  const results = [];
  for (const courseDoc of coursesSnap.docs) {
    const avg = await calcCourseAverage(courseDoc);
    results.push({ id: courseDoc.id, name: courseDoc.data().name, promedio: avg });
  }

  if (!results.length) return { best:null, worst:null };
  results.sort((a,b)=> (b.promedio||0) - (a.promedio||0));
  return { best: results[0], worst: results[results.length-1] };
}

// 🧹 Reinicio TOTAL del módulo Notas al salir o volver (manteniendo los ramos)
document.addEventListener('route:change', (e) => {
  const route = e.detail?.route || '';
  const sel = document.getElementById('gr-courseSel');

  function resetNotasUI() {
    // 🔸 Reestablecer selección al placeholder, sin borrar la lista
    if (sel) {
      sel.value = '';
      if (sel.querySelector('option[value=""]')) {
        sel.selectedIndex = 0;
      } else {
        // Si no tiene placeholder, lo insertamos al inicio
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Selecciona un ramo…';
        opt.disabled = true;
        opt.selected = true;
        sel.insertBefore(opt, sel.firstChild);
        sel.selectedIndex = 0;
      }
    }

    // 🔸 Reset de variables globales
    window.currentCourseId = null;
    if (window.state) window.state.editingCourseId = null;

    // 🔸 Limpieza de elementos de texto
    const setText = (id, txt = '—') => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    setText('gr-currentAvg');
    setText('gr-neededToPass');
    setText('gr-status');

    // 🔸 Limpieza de listas
    const list = document.getElementById('gr-evalsList');
    if (list) list.innerHTML = '<div class="muted">Selecciona un ramo.</div>';

    // 🔸 Ocultar tarjetas de notas
    ['gr-evalsCard', 'gr-calcCard', 'gr-summaryCard', 'gr-rulesCard']
      .forEach(id => document.getElementById(id)?.classList.add('hidden'));
  }

  // ⚙️ Al salir o volver a la pestaña "Notas"
  if (route !== '#/notas') resetNotasUI();
  if (route === '#/notas') setTimeout(resetNotasUI, 120);
});
