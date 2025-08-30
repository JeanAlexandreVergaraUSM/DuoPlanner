
import { db } from './firebase.js';
import { $, state } from './state.js';
import {
  collection, doc, getDoc, setDoc, updateDoc, onSnapshot,
  addDoc, deleteDoc, query, orderBy, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';


let currentCourseId = null;
let unsubComp = null;
let components = []; // [{id,key,name,score}]
let header = { scale: 'USM', finalExpr: '', rulesText: '' };

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

  $('gr-addComp')?.addEventListener('click', addComponentPrompt);

  // Crear la sección Reglas dentro de #page-notas (aunque esté oculta)
  ensureRulesUI();

  // 🔹 Panel "Notas de tu pareja" como pestaña
  bindPartnerPanelUi();
  document.addEventListener('pair:ready', grpPopulateSemesters); // llena select cuando hay pair
}


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
  const resultCardInNotas = pageNotas.querySelector('.card:has(.gr-result)');

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
}

async function onCourseChange(e){
  currentCourseId = e.target.value || null;
  await loadGradingDoc();
  await watchComponents();
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
  const courseRef  = doc(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses',currentCourseId);

  // escala detectada por ramo o universidad
  const courseSnap = await getDoc(courseRef);
  const courseScale = courseSnap.exists() ? (courseSnap.data().scale || null) : null;
  const uni = state.activeSemesterData?.universityAtThatTime || '';
  const uniScale = (uni==='UMAYOR' || uni==='Universidad Mayor') ? 'MAYOR'
                 : (uni==='USM'    || uni==='UTFSM')            ? 'USM'
                 : 'USM';

  const snap = await getDoc(gRef);
  if (snap.exists()){
    header = { finalExpr: '', rulesText: '', ...snap.data() };
  } else {
    header = {
      scale: courseScale || uniScale,
      finalExpr: '',
      rulesText: ''
    };
    await setDoc(gRef, header);
  }

  // si el ramo tiene scale, forzar coherencia
  if (courseScale && header.scale !== courseScale){
    header.scale = courseScale;
    await updateDoc(gRef, { scale: header.scale });
  }

  // UI
  $('gr-activeSemLabel') && ($('gr-activeSemLabel').textContent = state.activeSemesterData?.label || '—');
  $('gr-scaleSel').value = header.scale || 'USM';
  $('gr-finalExpr').value = header.finalExpr || '';
  const rt = $('gr-rulesText');
  if (rt) rt.value = header.rulesText || '';

  computeAndRender();
}

async function saveExpr(){
  if (!readyPath()) return;
  const raw = ($('gr-finalExpr').value || '').trim();
  const expr = normalizeExpr(raw);        // ← conserva 20%
  header.finalExpr = expr;
  await updateDoc(gradingDocRef(), { finalExpr: expr });
  $('gr-finalExpr').value = expr;         // no lo cambiamos a (20/100)
  computeAndRender();
}

async function saveRules(){
  if (!readyPath()) return;
  const txt = ($('gr-rulesText').value || '').trim();
  header.rulesText = txt;
  await updateDoc(gradingDocRef(), { rulesText: txt });
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
    }
  );
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
  const host = $('gr-components');
  if (!host) return;
  host.innerHTML = '';
  if (!currentCourseId){
    host.innerHTML = `<div class="muted">Selecciona un ramo.</div>`;
    return;
  }
  if (!components.length){
    host.innerHTML = `<div class="muted">Agrega componentes con el botón “+ Componente”.</div>`;
    return;
  }

  const isMayor = (header.scale === 'MAYOR');
  const min  = isMayor ? 1 : 0;
  const max  = isMayor ? 7 : 100;
  const step = isMayor ? 0.01 : 1;   // ⬅️ AQUÍ: USM sube de a 0.1 con flechitas

  components.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'gr-row';
    row.innerHTML = `
      <div class="head">
        <div><label>Clave (usa en fórmula)</label><div class="gr-id">${c.key}</div></div>
        <div><label>Nombre</label><br/><input data-f="name" value="${esc(c.name)}"/></div>
        <div><label>Nota</label><br/>
          <input data-f="score" type="number" step="${step}" min="${min}" max="${max}"
                 value="${c.score??''}" style="width:100px"/>
        </div>
        <div class="gr-actions">
          <button data-act="save" class="primary">Guardar</button>
          <button data-act="del"  class="danger">Eliminar</button>
        </div>
      </div>
    `;
    host.appendChild(row);

    const saveBtn = row.querySelector('[data-act="save"]');
    const resetBtnText = ()=>{ saveBtn.textContent = 'Guardar'; };

    row.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('input', resetBtnText);
      if (inp.dataset.f === 'score'){
        inp.addEventListener('change', ()=>{
          const v = parseFloat(inp.value);
          if (!isNaN(v)){
            inp.value = clamp(v, min, max);  // mantenemos límites
          }
        });
      }
    });

    row.addEventListener('click', async (e)=>{
      const btn = e.target;
      if (!(btn instanceof HTMLElement)) return;

      if (btn.dataset.act === 'save'){
        const get = (sel)=> row.querySelector(`[data-f="${sel}"]`);
        const name = (get('name').value || '').trim() || c.key;
        const scoreRaw = parseMaybe(get('score').value);
        const score = (scoreRaw==null) ? null : clamp(scoreRaw, min, max);
        await updateDoc(doc(componentsColRef(), c.id), { name, score });
        btn.textContent = 'Guardado ✓';
        computeAndRender();
      }

      if (btn.dataset.act === 'del'){
        if (!confirm(`Eliminar ${c.name || c.key}?`)) return;
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
  if (header.finalExpr && header.finalExpr.trim()!==''){
    try{
      final = safeEvalExpr(header.finalExpr, values);
      if (typeof final === 'number' && isFinite(final)){
        final = truncate(final, header.scale);
      } else {
        final = null;
      }
    }catch{
      final = null;
    }
  }

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
      const msgs = rulesEval.unmet.map(u => {
        if (u.kind === 'cmp' && isFinite(u.left) && isFinite(u.right) && (u.op === '>=' || u.op === '>')) {
          const need = Math.max(0, (u.op === '>=' ? (u.right - u.left) : (u.right - u.left + 0.01)));
          const faltan = (header.scale==='MAYOR') ? need.toFixed(2) : need.toFixed(1);
          return `Cumplir: ${u.text} (faltan ≈ ${faltan}).`;
        }
        return `Cumplir: ${u.text}.`;
      });
      parts.push(...msgs);
    }
    needed = parts.join(' ');
  }

  // Render
  renderRulesStatus(rulesEval);
  renderResult({ final, thr, status, needed });
}

/* ======= Reglas: parsing + evaluación ======= */

function parseRules(text){
  const lines = (text || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return lines;
}

function evaluateRules(lines, vars){
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
      lv = safeEvalExpr(left, vars, { avg, min: Math.min, max: Math.max });
      rv = safeEvalExpr(right, vars, { avg, min: Math.min, max: Math.max });
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
  const f = $('gr-currentFinal');
  const s = $('gr-status');
  const n = $('gr-needed');
  
  if (!f || !s || !n) return;
  if (!res){
    f.textContent = '—'; s.textContent = '—'; n.textContent = '—';
    // al limpiar, borra dataset base (para que se recalcule el panel de pareja)
    delete f.dataset.base; delete s.dataset.base;
    return;
  }
  const isMayor = (header.scale === 'MAYOR');
  const shown = (res.final==null) ? '—' : truncate(res.final, header.scale).toString();
  f.textContent = shown;
  s.textContent = res.status ?? '—';
  n.textContent = res.needed ?? '—';
}

/* =================== Helpers =================== */

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
  // separador decimal con coma -> punto
  s = s.replace(/,/g, '.');
  // espacios extra
  s = s.replace(/\s+/g, ' ');
  return s;
}

// Convierte % solo para evaluar (20% -> (20/100))
function prepareForEval(expr){
  if (!expr) return '';
  return expr.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, n) => `(${n}/100)`);
}

// Evaluación segura con variables (claves de componentes) y funciones whitelisted
function safeEvalExpr(expr, vars, fns = {}){
  const normalized = normalizeExpr(expr);        // mantiene %
  // Validamos que el input solo tenga caracteres permitidos (incluye % para la vista)
  if (!/^[\w\s\.\+\-\*\/\(\),%]+$/.test(normalized)) {
    throw new Error('La fórmula contiene caracteres no permitidos.');
  }
  // Para evaluar, convertimos % → /100
  const e = prepareForEval(normalized);

  const keys = Object.keys(vars);
  const vals = keys.map(k => vars[k] ?? 0); // faltantes como 0

  const fnNames = Object.keys(fns);
  const fnVals  = Object.values(fns);

  // eslint-disable-next-line no-new-func
  return Function(...fnNames, ...keys, `"use strict"; return (${e});`)(...fnVals, ...vals);
}

/* ========== PESTAÑA: "Notas de tu pareja" (solo lectura) ========== */

let grpUnsubCourses = null;
let grpUnsubMeta = null;
let grpUnsubComps = null;
let grpPartnerCourses = []; // cache de cursos del semestre elegido

function bindPartnerPanelUi(){
  const openBtn = $('gr-openPartnerBtn');
  const closeBtn = $('gr-closePartnerBtn');
  const panel = $('grPartnerPanel');
  const semSel = $('grp-semSel');
  const courseSel = $('grp-courseSel');

  openBtn?.addEventListener('click', async ()=>{
    if (!state.pairOtherUid){
      alert('Debes emparejarte primero.');
      return;
    }
    panel?.classList.remove('hidden');
    toggleOwnNotes(true);       // ⬅️ oculta todo lo propio
    await grpPopulateSemesters();
  });

  closeBtn?.addEventListener('click', ()=>{
    panel?.classList.add('hidden');
    grpStopAll();
    toggleOwnNotes(false);      // ⬅️ vuelve a mostrar lo propio
    // limpia sufijos “(pareja: …)” del resultado principal
    const f = $('gr-currentFinal'), s = $('gr-status');
    if (f && s){ delete f.dataset.base; delete s.dataset.base; }
  });

  semSel?.addEventListener('change', async (e)=>{
    const semId = e.target.value || null;
    await grpPopulateCourses(semId);
  });

  courseSel?.addEventListener('change', async (e)=>{
    const semId = semSel?.value || null;
    const cid = e.target.value || null;
    await grpSubscribeCourse(semId, cid);
  });
}

/* Oculta/Muestra TODO el contenido propio de #page-notas,
   excepto el header (el contenedor que tiene el botón) y el panel de pareja */
function toggleOwnNotes(hide){
  const page = $('page-notas'); if (!page) return;
  const headerRow = $('#gr-openPartnerBtn')?.closest('div'); // fila con el título y botón
  Array.from(page.children).forEach(el=>{
    if (el === headerRow) return;           // deja el header
    if (el.id === 'grPartnerPanel') return; // deja el panel (lo mostramos/ocultamos aparte)
    el.classList.toggle('hidden', !!hide);
  });
}

function grpStopAll(){
  grpUnsubCourses?.(); grpUnsubCourses = null;
  grpUnsubMeta?.();    grpUnsubMeta = null;
  grpUnsubComps?.();   grpUnsubComps = null;
  grpPartnerCourses = [];
  const courseSel = $('grp-courseSel');
  if (courseSel) courseSel.innerHTML = '';
  // limpia panel
  $('grp-meta') && ($('grp-meta').textContent = 'Selecciona semestre y ramo para ver su cálculo.');
  $('grp-components') && ($('grp-components').innerHTML = 'Sin componentes…');
  $('grp-finalExpr') && ($('grp-finalExpr').textContent = '—');
  $('grp-rules') && ($('grp-rules').innerHTML = 'Sin reglas definidas…');
}

/* ---- Pobladores ---- */

// Semestres de la pareja (más reciente primero)
async function grpPopulateSemesters(){
  const sel = $('grp-semSel'); if (!sel) return;
  sel.innerHTML = '<option value="">—</option>';
  const other = state.pairOtherUid; if (!other) return;

  const ref = collection(db,'users', other, 'semesters');
  const snap = await getDocs(query(ref, orderBy('createdAt','desc')));
  snap.forEach(d=>{
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data()?.label || '—';
    sel.appendChild(opt);
  });

  if (snap.size > 0){
    sel.value = snap.docs[0].id;
    await grpPopulateCourses(sel.value);
  }
}

// Ramos de la pareja para el semestre elegido
async function grpPopulateCourses(semId){
  const other = state.pairOtherUid;
  const courseSel = $('grp-courseSel');
  const metaBox = $('grp-meta');
  if (!other || !courseSel){ return; }

  grpUnsubCourses?.(); grpUnsubCourses = null;
  courseSel.innerHTML = '';

  if (!semId){
    metaBox.textContent = 'Selecciona semestre y ramo para ver su cálculo.';
    return;
  }

  const ref = collection(db,'users', other, 'semesters', semId, 'courses');
  grpUnsubCourses = onSnapshot(query(ref, orderBy('name')), (snap)=>{
    grpPartnerCourses = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    courseSel.innerHTML = '';
    grpPartnerCourses.forEach(c=>{
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name || 'Ramo';
      courseSel.appendChild(opt);
    });

    if (grpPartnerCourses.length){
      courseSel.value = grpPartnerCourses[0].id;
      grpSubscribeCourse(semId, courseSel.value);
    }else{
      metaBox.textContent = 'Este semestre no tiene ramos.';
      renderGrpComponents([]); renderGrpMeta(null, null, null); renderGrpRules(null);
    }
  });
}

/* ---- Suscripciones por ramo ---- */

async function grpSubscribeCourse(semId, courseId){
  const other = state.pairOtherUid;
  const metaBox = $('grp-meta');
  if (!other || !semId || !courseId){
    metaBox.textContent = 'Selecciona semestre y ramo para ver su cálculo.';
    renderGrpComponents([]); renderGrpMeta(null, null, null); renderGrpRules(null);
    // limpia sufijos del resultado propio
    const f = $('gr-currentFinal'), s = $('gr-status');
    if (f && s){ delete f.dataset.base; delete s.dataset.base; renderSharedSuffix(null, null); }
    return;
  }

  // corta anteriores
  grpUnsubMeta?.();  grpUnsubMeta = null;
  grpUnsubComps?.(); grpUnsubComps = null;

  // meta (escala, umbral implícito por escala, fórmula, reglas…)
  const metaRef = doc(db,'users', other, 'semesters', semId, 'courses', courseId, 'grading', 'meta');
  grpUnsubMeta = onSnapshot(metaRef, (snap)=>{
    const d = snap.data() || {};
    renderGrpMeta(d.scale || 'USM', null, d.finalExpr || '');
    renderGrpRules(d.rulesText || '');
    // recalcula sufijos en resultado principal
    renderSharedSuffix(d, null);
  });

  // componentes
  const compRef = collection(db,'users', other, 'semesters', semId, 'courses', courseId, 'grading', 'meta', 'components');
  grpUnsubComps = onSnapshot(query(compRef, orderBy('name')), (snap)=>{
    const arr = snap.docs.map(x=>({ id:x.id, ...x.data() }));
    renderGrpComponents(arr);
    // recalcula sufijos con componentes
    renderSharedSuffix(null, arr);
  });
}

/* ---- Render del panel ---- */

function renderGrpMeta(scale, _thr, expr){
  const box = $('grp-meta');
  const scaleLabel = (scale==='MAYOR') ? 'UMayor (1–7)' : 'USM (0–100)';
  const thr = (scale==='MAYOR') ? 3.95 : 54.5; // informativo
  box.innerHTML = `<b>Escala:</b> ${scaleLabel} · <b>Umbral de aprobación:</b> ${thr}`;
  const ex = $('grp-finalExpr');
  if (ex) ex.textContent = expr || '—';
}

function renderGrpRules(text){
  const box = $('grp-rules');
  const t = (text || '').trim();
  if (!t){
    box.innerHTML = 'Sin reglas definidas…';
    return;
  }
  const lines = t.split(/\r?\n/).filter(s=>s.trim().length);
  box.innerHTML = `<ul style="margin:6px 0 0 16px">${lines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`;
}

function renderGrpComponents(arr){
  const box = $('grp-components');
  if (!arr || !arr.length){
    box.innerHTML = 'Sin componentes…';
    return;
  }
  box.innerHTML = `
    <div class="table-like">
      <div class="row" style="font-weight:600">
        <div style="flex:2">Nombre</div>
        <div style="flex:1">Clave</div>
        <div style="flex:1">Nota</div>
      </div>
      ${arr.map(c=>`
        <div class="row">
          <div style="flex:2">${esc(c.name || '')}</div>
          <div style="flex:1"><code>${esc(c.key || '')}</code></div>
          <div style="flex:1">${(c.score??'') === '' ? '—' : esc(String(c.score))}</div>
        </div>
      `).join('')}
    </div>
  `;
}

/* ---- Sufijos “(pareja: …)” en el resultado propio ---- */

function renderSharedSuffix(metaOrNull, compsOrNull){
  // cache en cierres
  renderSharedSuffix._meta = metaOrNull ?? renderSharedSuffix._meta;
  renderSharedSuffix._comps = compsOrNull ?? renderSharedSuffix._comps;

  const meta = renderSharedSuffix._meta || { scale:'USM', finalExpr:'', rulesText:'' };
  const comps = renderSharedSuffix._comps || [];

  // calcula final pareja
  const values = {};
  const min = meta.scale==='MAYOR' ? 1 : 0;
  const max = meta.scale==='MAYOR' ? 7 : 100;
  comps.forEach(c=>{ if (typeof c.score==='number') values[c.key]=clamp(c.score, min, max); });

  let final = null;
  if (meta.finalExpr?.trim()){
  try{
    final = safeEvalExpr(meta.finalExpr, values);
    if (typeof final==='number' && isFinite(final)){
      final = truncate(final, meta.scale);  // ⬅️ truncar aquí también
    } else final=null;
  }catch{ final=null; }
}
  const thr = (meta.scale==='MAYOR') ? 3.95 : 54.5;
  const rules = parseRules(meta.rulesText||'');
  const rulesEval = evaluateRules(rules, values);
  const status = (final!=null && final>=thr && rulesEval.allOk) ? 'Aprueba' : (final==null? '—' : 'Reprueba');

  const f = $('gr-currentFinal'), s = $('gr-status');
  if (!f || !s) return;

  // guarda base si no existe
  if (!f.dataset.base) f.dataset.base = f.textContent;
  if (!s.dataset.base) s.dataset.base = s.textContent;
  // restaura base limpia y agrega sufijos
  f.textContent = f.dataset.base;
  s.textContent = s.dataset.base;

  const fTxt = (final==null) ? '—' : truncate(final, meta.scale).toString();
  f.textContent += `  (pareja: ${fTxt})`;
  s.textContent += `  (pareja: ${status})`;
}

function truncate(val, scale){
  if (val == null || isNaN(val)) return null;
  if (scale === 'MAYOR'){
    return Math.trunc(val * 100) / 100;   // 2 decimales truncados
  } else {
    return Math.trunc(val * 10) / 10;     // 1 decimal truncado
  }
}
