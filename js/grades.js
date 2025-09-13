import { db } from './firebase.js';
import { $, state, setHidden } from './state.js';
import {
  collection, query, orderBy, getDocs, onSnapshot, doc, getDoc,
  addDoc, updateDoc, deleteDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';



let currentCourseId = null;
let unsubComp = null;
let components = []; // [{id,key,name,score}]
let header = { scale: 'USM', finalExpr: '', rulesText: '' };
// --- Referencias cruzadas de notas finales (otros ramos del MISMO semestre) ---
let crossFinals = { byName:{}, byCode:{}, byId:{} };  // caches


export function initGrades(){
  bindUi();
}

export function onCoursesChanged(){
  loadCoursesIntoSelect();
}

export function onActiveSemesterChanged(){
  const lbl = $('gr-activeSemLabel');
  if (lbl) lbl.textContent = state.activeSemesterData?.label || '—';
  loadCoursesIntoSelect();
}

/* =================== UI bindings =================== */

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

  // 🔹 Panel "Notas de tu pareja" como pestaña
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
  // Evitar duplicados
  if ($('gr-rulesCard')) return;

  const pageNotas = $('page-notas');
  if (!pageNotas) return; // por si el HTML cambia

  // Intentamos ubicarlo justo antes del card de "Resultado" dentro de Notas
  let resultCardInNotas = null;
 try { resultCardInNotas = pageNotas.querySelector('.card:has(.gr-result)'); } catch(_) {}

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'gr-rulesCard';
  card.style.marginTop = '12px';
  card.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <h3 style="margin:0">Reglas</h3>
      <div class="muted" id="gr-rulesHint">Una por línea. Ej.: <code>C1>=50</code>, <code>avg(Q1,Q2,Q3)>=60</code></div>
    </div>
    <div class="row" style="align-items:flex-start;margin-top:8px">
      <textarea id="gr-rulesText" rows="4" style="flex:1 1 520px;min-height:86px;background:#0e1120;border:1px solid var(--line);color:var(--ink);padding:8px 10px;border-radius:10px"></textarea>
      <div id="gr-formulaError" class="muted" style="margin-top:6px;color:#fca5a5"></div>
      <button id="gr-saveRules" class="primary">Guardar reglas</button>
    </div>
    <div id="gr-rulesStatus" class="muted" style="margin-top:6px"></div>
  `;

  if (resultCardInNotas && resultCardInNotas.parentNode === pageNotas) {
    // Lo insertamos justo ANTES del Card de "Resultado"
    pageNotas.insertBefore(card, resultCardInNotas);
  } else {
    // Fallback: lo agregamos al final dentro de #page-notas
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
  if (currentCourseId && state.courses.some(c=>c.id===currentCourseId)){
    sel.value = currentCourseId;
  } else {
    sel.value = state.courses[0].id;
    currentCourseId = sel.value;
  }
  await loadGradingDoc();
  await watchComponents();
  await rebuildCrossFinals();
computeAndRender(); // para que tome las referencias recién cargadas

}

async function onCourseChange(e){
  currentCourseId = e.target.value || null;
  await loadGradingDoc();
  await watchComponents();
  await rebuildCrossFinals();
computeAndRender();

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

async function watchComponents(){
  if (unsubComp) { unsubComp(); unsubComp = null; }
  if (!readyPath()){
    renderComponents();
    return;
  }

  unsubComp = onSnapshot(
    query(componentsColRef(), orderBy('createdAt')),
    (snap)=>{
      components = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
      renderComponents();
      computeAndRender();
      rebuildCrossFinals().then(()=> computeAndRender());

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
    createdAt: Date.now()
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
    createdAt: Date.now()
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

/* Render UI de componentes */

function renderComponents(){
  const host = $('gr-evalsList');   // <- ahora usa el contenedor de tu HTML
  if (!host) return;
  host.innerHTML = '';

  if (!currentCourseId){
    host.innerHTML = `<div class="muted">Selecciona un ramo.</div>`;
    return;
  }
  if (!components.length){
    host.innerHTML = `<div class="muted">Aún no hay evaluaciones. Usa “Agregar evaluación”.</div>`;
    return;
  }

  const isMayor = (header.scale === 'MAYOR');
  const min  = isMayor ? 1 : 0;
  const max  = isMayor ? 7 : 100;
  const step = isMayor ? 0.1 : 1;

  components.forEach(c=>{
    const card = document.createElement('div');
    card.className = 'grade-item';
    card.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:700">${esc(c.name || c.key)}</div>
        <div class="muted">Código: <code>${esc(c.key)}</code></div>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <input data-f="score" type="number" step="${step}" min="${min}" max="${max}" value="${c.score??''}" style="width:110px"/>
        <button data-act="save" class="btn btn-secondary">Guardar</button>
        <button data-act="del"  class="btn btn-secondary">Eliminar</button>
      </div>
    `;
    host.appendChild(card);

    card.addEventListener('click', async (e)=>{
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.dataset.act === 'save'){
        const inp = card.querySelector('[data-f="score"]');
        let v = parseFloat(inp.value);
        const score = isNaN(v) ? null : clamp(v, min, max);
        await updateDoc(doc(componentsColRef(), c.id), { score });
        t.textContent = 'Guardado ✓';
        computeAndRender();
        setTimeout(()=> t.textContent = 'Guardar', 1200);
      }

      if (t.dataset.act === 'del'){
        if (!confirm(`Eliminar “${c.name || c.key}”?`)) return;
        await deleteDoc(doc(componentsColRef(), c.id));
      }
    });
  });
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


// ⚠️ Muestra el error (y deja el flag en dataset para inspección avanzada)
const errBox = $('gr-formulaError');
if (errBox){
  errBox.textContent = lastErr ? `Error en fórmula: ${lastErr}` : '';
}
$('gr-rulesStatus') && ( $('gr-rulesStatus').dataset.formulaError = lastErr );




  // Umbral efectivo fijo por escala
  const thr = (header.scale==='MAYOR') ? 3.95 : 54.5;

  // Reglas
  const rules = parseRules(header.rulesText || '');
  const rulesEval = evaluateRules(rules, values);

  // Estado: requiere pasar umbral y cumplir todas las reglas
  let status = null;
  if (final==null){
    status = null;
  } else {
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
      lv = safeEvalExpr(left,  vars, useFns);
      rv = safeEvalExpr(right, vars, useFns);

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

function compare(a, op, b){
  if (!(isFinite(a) && isFinite(b))) return false;
  switch(op){
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>':  return a >  b;
    case '<':  return a <  b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

// avg(x,y,...) helper
function avg(...xs){
  const arr = Array.isArray(xs[0]) ? xs[0] : xs;
  if (!arr.length) return NaN;
  let n=0, s=0;
  for (const v of arr){ if (typeof v === 'number' && isFinite(v)) { s+=v; n++; } }
  return n? (s/n) : NaN;
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

// Mantiene el texto como lo escribió el usuario (NO toca %)
function normalizeExpr(expr){
  if (!expr) return '';
  let s = String(expr).trim();
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); // tipográficas → rectas
  s = s.replace(/,/g, '.');      // coma decimal → punto
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

// ✅ versión buena y probada
function safeEvalExpr(expr, vars, fns = {}){
  const normalized = normalizeExpr(expr);
  const withQuoted = autoQuoteFunctionArgs(normalized);
  const masked = withQuoted.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '0');
  if (!/^[\w\s\.\+\-\*\/\(\),%]+$/.test(masked)) {
    throw new Error('La fórmula contiene caracteres no permitidos.');
  }
  const e = prepareForEval(withQuoted);

  const keys = Object.keys(vars);
  const vals = keys.map(k => vars[k] ?? 0);

  const fnNames = Object.keys(fns);
  const fnVals  = Object.values(fns);

  // eslint-disable-next-line no-new-func
  return Function(...fnNames, ...keys, `"use strict"; return (${e});`)(...fnVals, ...vals);
}








/* ---- Render del panel ---- */


/* ---- Sufijos “(pareja: …)” en el resultado propio ---- */

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

// ====== MODO "NOTAS DE MI PAREJA" (simple) ======

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
    btn.textContent = on ? 'Volver a mis notas' : 'Notas de mi pareja';
    ownBlocks.forEach(el => setHidden(el, on));
    setHidden(partnerCard, !on);
    if (on) grpPopulateSemesters(); // carga combo al encender
  }

  btn.addEventListener('click', ()=>{
    const now = btn.getAttribute('aria-pressed') === 'true';
    setMode(!now);
  });

  // si la pareja queda lista, rellenamos
  document.addEventListener('pair:ready', grpPopulateSemesters);
})();

// 3.2 Poblar semestres de la pareja (orden AAAA-T desc, sin duplicados)
let _grpPopulateToken = 0;
async function grpPopulateSemesters(){
  const sel = $('gr-sh-semSel'); if (!sel) return;

  // limpiar
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = ''; opt0.textContent = '— seleccionar —';
  sel.appendChild(opt0);

  if (!state.pairOtherUid) return;

  const myToken = ++_grpPopulateToken;

  const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                   .replace(/\s+/g,' ').trim();
  const canon = s => {
    const t = norm(s);
    const m = t.replace(/[^\d\-\/ ]+/g,'').match(/(\d{4})\D*([12])$/);
    return m ? `${m[1]}-${m[2]}` : t.toLowerCase();
  };
  const parseYT = label => {
    const m = /^(\d{4})-(1|2)$/.exec(canon(label));
    return m ? { y:+m[1], t:+m[2] } : { y:-Infinity, t:-Infinity };
  };

  const ref = collection(db,'users',state.pairOtherUid,'semesters');
  const snap = await getDocs(query(ref)); // ordenaremos nosotros
  if (myToken !== _grpPopulateToken) return;

  const byKey = new Map();
  snap.forEach(d=>{
    const shown = norm(d.data()?.label || d.id);
    const key = canon(shown);
    if (!byKey.has(key)){
      const { y, t } = parseYT(shown);
      byKey.set(key, { id:d.id, labelToShow:shown, y, t });
    }
  });

  const options = Array.from(byKey.values()).sort((a,b)=> (b.y-a.y) || (b.t-a.t));

  const frag = document.createDocumentFragment();
  for (const { id, labelToShow } of options){
    const o = document.createElement('option');
    o.value = id; o.textContent = labelToShow;
    frag.appendChild(o);
  }
  sel.appendChild(frag);

  const prev = state.shared?.notas?.semId || '';
  if (prev && Array.from(sel.options).some(o=>o.value===prev)){
    sel.value = prev;
  } else {
    const first = Array.from(sel.options).find(o=>o.value);
    sel.value = first ? first.value : '';
  }
  state.shared.notas.semId = sel.value || null;

  sel.onchange = ()=>{
    state.shared.notas.semId = sel.value || null;
    subscribePartnerGrades(state.shared.notas.semId);
  };
  subscribePartnerGrades(state.shared.notas.semId);
}

// 3.3 Suscribir y renderizar notas por semestre (solo final + estado)
let _grpUnsubCourses = null;
function cleanupPartnerSubs(){ if (_grpUnsubCourses){ _grpUnsubCourses(); _grpUnsubCourses=null; } }

async function subscribePartnerGrades(semId){
  cleanupPartnerSubs();
  const list = $('gr-sh-list'); if (list) list.innerHTML = '';
  if (!state.pairOtherUid || !semId) return;

  // universidad para escala/umbral por defecto
  const semSnap = await getDoc(doc(db,'users',state.pairOtherUid,'semesters',semId));
  const uniReadable = semSnap.exists() ? (semSnap.data().universityAtThatTime || '') : '';
  const SCALE = /mayor/i.test(uniReadable) ? 'MAYOR' : 'USM';
  const THR   = SCALE==='MAYOR' ? 3.95 : 54.5;

  // cursos del semestre (pareja)
  const coursesRef = collection(db,'users',state.pairOtherUid,'semesters',semId,'courses');
  _grpUnsubCourses = onSnapshot(query(coursesRef, orderBy('name')), async (snap)=>{
    const rows = [];

    for (const c of snap.docs){
      const cData = c.data() || {};
      const courseId = c.id;

      // meta
      const metaRef = doc(db,'users',state.pairOtherUid,'semesters',semId,'courses',courseId,'grading','meta');
      const metaSnap = await getDoc(metaRef);
      const meta = metaSnap.exists() ? metaSnap.data() : { scale:SCALE, finalExpr:'', rulesText:'' };

      // componentes
      const compsCol = collection(
  db, 'users', state.pairOtherUid, 'semesters', semId,
  'courses', courseId, 'grading', 'meta', 'components'
);
const compsSnap = await getDocs(compsCol);
const comps = compsSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));

      // calcular final
      const vals = {};
      const isMayor = (meta.scale === 'MAYOR');
      const min = isMayor ? 1 : 0;
      const max = isMayor ? 7 : 100;
      comps.forEach(k=>{
        const v = typeof k.score==='number' ? Math.max(min, Math.min(max, k.score)) : null;
        if (v!=null && k.key) vals[k.key] = v;
      });

      let final = null;
      try{
        if ((meta.finalExpr||'').trim()){
          final = safeEvalExpr(meta.finalExpr, vals, { avg, min:Math.min, max:Math.max });
          if (typeof final==='number' && isFinite(final)) final = truncate(final, meta.scale);
          else final = null;
        }
      }catch{ final = null; }

      const thr = (meta.scale==='MAYOR') ? 3.95 : 54.5;
      const rules = parseRules(meta.rulesText || '');
      const rulesEval = evaluateRules(rules, vals);
      const status = (final!=null && final>=thr && rulesEval.allOk) ? 'Aprobado' : (final==null ? '—' : 'Reprobado');

      rows.push({ name: cData.name || 'Ramo', final, scale: meta.scale || SCALE, status });
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
    const val = (r.final==null)
      ? '—'
      : (r.scale==='MAYOR'
          ? (Math.trunc(r.final*100)/100).toFixed(2)
          : (Math.trunc(r.final*10)/10).toFixed(1));
    const color = r.status==='Aprobado' ? '#22c55e' : (r.status==='Reprobado' ? '#ef4444' : 'var(--muted)');
    const row = document.createElement('div');
    row.className = 'course-item';
    row.innerHTML = `
      <div>
        <div><b>${esc(r.name)}</b></div>
        <div class="course-meta">Final: ${val}</div>
      </div>
      <div class="inline">
        <span style="font-weight:700;color:${color}">${r.status}</span>
      </div>
    `;
    host.appendChild(row);
  });
}
