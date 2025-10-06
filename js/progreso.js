// js/progreso.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import { doc, onSnapshot, collection, getDocs, query, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ================= Data loaders (re-uso de malla) ================= */
const ALL_ROMANS = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];

async function loadCareerDatasets(){
  // Carga mínima para contar ramos por carrera
  const medvet = await fetch('data/medvet_malla.csv').then(r=>r.text()).catch(()=>'');
  const ictel  = await fetch('data/ictel_malla.csv').then(r=>r.text()).catch(()=>'');
  return {
    MEDVET: medvet ? parseMedvetCSV(medvet) : [],
    ICTEL:  ictel  ? parseIctelCSV(ictel)   : [],
  };
}

function parseCSV(text){
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0];
  const sep = (head.split(';').length >= head.split(',').length) ? ';' : ',';
  const headers = head.split(sep).map(h=>h.trim().replace(/^['\"]|['\"]$/g,''));
  return lines.slice(1).map(line=>{
    const cols = line.split(sep).map(c=>c.trim().replace(/^['\"]|['\"]$/g,''));
    const o={}; headers.forEach((h,i)=> o[h]=cols[i] ?? ''); return o;
  });
}

function parseMedvetCSV(text){
  const rows = parseCSV(text);
  return rows.map(r=>{
    let codigo = r['Código Asignatura'] || r['Codigo Asignatura'] || '';
    if (codigo.includes('.')) codigo = codigo.split('.')[0];
    return { codigo, nivel: (r['Nivel']||'').trim() };
  });
}

function parseIctelCSV(text){
  const rows = parseCSV(text);
  return rows.map(r=>{
    const norm = {};
    for (const [k,v] of Object.entries(r)){
      const nk = k.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9]+/g,' ').trim();
      norm[nk] = (v||'').trim();
    }
    const pick = (...aliases)=>{
      for (const a of aliases){
        const na = a.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .replace(/[^a-z0-9]+/g,' ').trim();
        if (na in norm && norm[na]) return norm[na];
      }
      return '';
    };
    let sigla = pick('Sigla','Código','Codigo','Código Asignatura','Codigo Asignatura');
    if (!sigla) sigla = pick('Código Asignatura','Codigo Asignatura','Código','Codigo');
    return { codigo: sigla || '', nivel: (pick('Nivel','Semestre')||'').toUpperCase() };
  });
}

/* ================= Helpers ================= */
function getAprobadosLocal(){
  const uni = state.profileData?.university || 'GEN';
  const car = state.profileData?.career || 'GEN';
  try{
    return JSON.parse(localStorage.getItem(`mallaAprobados:${uni}:${car}`) || '[]');
  }catch{ return []; }
}

function pct(num, den){ return den ? ((num/den)*100) : 0; }
function fmtPct(x){ return `${(Math.round(x*10)/10).toFixed(1)}%`; }

function fraseEsperanza(p, aprobSem){
  if (p >= 100) return '¡Meta cumplida! Orgullo total. 🎉';
  if (aprobSem > 0) return '¡Suma y sigue! Cada logro empuja. ✅';
  if (p >= 75) return 'Recta final. Lo estás logrando. 🌟';
  if (p >= 50) return 'Más de la mitad, ¡gran trabajo! 🔥';
  if (p >= 25) return '¡Vas a mitad de camino! Mantén el foco. 🚀';
  return 'El comienzo define el ritmo. Ya empezaste. 💪';
}

/* ================= Render ================= */
let datasets = null;
let unsubPartnerMalla = null;

export async function initProgreso(){
  datasets = await loadCareerDatasets();

  // refresco reactivo
  document.addEventListener('profile:changed', refreshProgreso);
  document.addEventListener('malla:updated', refreshProgreso);
  document.addEventListener('courses:changed', refreshProgreso);
  document.addEventListener('pair:ready', refreshProgreso); // ← NUEVO
  document.addEventListener('route:change', (e)=>{
    if (e.detail?.route === '#/progreso') refreshProgreso();
  });
}

export async function refreshProgreso(){
  const host1 = $('prog-global');
  const host2 = $('prog-semestre');
  const host3 = $('prog-combinado');
  if (!host1 || !host2 || !host3) return;

  // Si aún no hay carrera, mostrar placeholders amables y salir
  const career = state.profileData?.career || null;
  if (!career) {
    host1.innerHTML = `
      <h3 style="margin:0 0 8px">Tu avance de carrera</h3>
      <div class="muted">Completa <b>Universidad</b> y <b>Carrera</b> en Perfil para ver tu progreso. 🌱</div>
    `;
    host2.innerHTML = `
      <h3 style="margin:0 0 8px">🎯 Este semestre aprobaste</h3>
      <div class="muted">Aún no hay victorias para mostrar.</div>
    `;
    host3.classList.add('hidden'); 
    host3.innerHTML = '';
    return;
  }

  // 1) Avance global propio
  const total = (datasets && datasets[career]) ? datasets[career].length : 0;
  const aprobados = getAprobadosLocal();
  const myPct = total ? pct(aprobados.length, total) : 0;

  host1.innerHTML = `
    <h3 style="margin:0 0 8px">Tu avance de carrera</h3>
    <div style="font-size:42px; font-weight:800; line-height:1">${fmtPct(myPct)}</div>
    <div class="progress-outer"><div class="progress-inner" style="width:${myPct}%;"></div></div>
    <div class="muted" id="prog-phrase" style="margin-top:6px"></div>
  `;

  // 2) Victorias del semestre (solo aprobados)
  host2.innerHTML = `<h3 style="margin:0 0 8px">🎯 Victorias del semestre</h3><div class="muted">Cargando…</div>`;
  const approvedList = await getApprovedCoursesInActiveSemester();
  if (approvedList.length){
    host2.innerHTML = `<h3 style="margin:0 0 8px">🎯 Este semestre aprobaste</h3>` +
      `<ul style="margin:6px 0 0 18px">` +
      approvedList.map(n => `<li>${n}</li>`).join('') + `</ul>`;
  } else {
    host2.innerHTML = `<h3 style="margin:0 0 8px">🎯 Este semestre aprobaste</h3>` +
      `<div class="muted">Aún no se publican victorias… pronto llegan. 🌱</div>`;
  }

  // Frase motivacional
  const phrase = fraseEsperanza(myPct, approvedList.length);
  const phraseEl = $('prog-phrase'); 
  if (phraseEl) phraseEl.textContent = phrase;

  // 3) Progreso combinado (si hay pareja)
  if (unsubPartnerMalla){ unsubPartnerMalla(); unsubPartnerMalla = null; }

  const other = state.pairOtherUid || null;
  if (!other){
    host3.classList.add('hidden'); 
    host3.innerHTML = ''; 
    return;
  }

  host3.classList.remove('hidden');
  host3.innerHTML = `<h3 style="margin:0 0 8px">Progreso combinado</h3><div class="muted">Conectando…</div>`;

  const ref = doc(db, 'users', other, 'malla', 'state');
  unsubPartnerMalla = onSnapshot(ref, async (snap) => {
    const d = snap.data() || {};
    let partnerCareer = d.career || null;

    // Si vino la universidad en lugar de la carrera, invalida
    if (partnerCareer === 'UMAYOR' || partnerCareer === 'USM') partnerCareer = null;

    // Fallback: leer career desde el perfil de la otra persona si está vacío
    if (!partnerCareer) {
      try {
        const profSnap = await getDoc(doc(db, 'users', other));
        if (profSnap.exists()) {
          const pd = profSnap.data() || {};
          if (pd.career) partnerCareer = pd.career;
        }
      } catch (_) { /* silencio */ }
    }

    const partnerApproved = Array.isArray(d.approved) ? d.approved.length : 0;
    const partnerTotal = (partnerCareer && datasets && datasets[partnerCareer]) 
      ? datasets[partnerCareer].length 
      : 0;

    const combined = (total + partnerTotal) 
      ? pct(aprobados.length + partnerApproved, total + partnerTotal) 
      : 0;

    host3.innerHTML = `
      <h3 style="margin:0 0 8px">Progreso combinado</h3>
      <div style="font-weight:600; margin-bottom:4px">Juntos llevan ${fmtPct(combined)}</div>
      <div class="progress-outer small"><div class="progress-inner" style="width:${combined}%;"></div></div>
      <div class="muted" style="margin-top:6px">Tú: ${fmtPct(myPct)} · Otra persona: ${fmtPct(pct(partnerApproved, partnerTotal))}</div>
    `;
  }, (_err) => {
    host3.classList.add('hidden');
  });
}


/* ====== Firestore helpers: cursos aprobados del semestre activo ====== */
async function getApprovedCoursesInActiveSemester(){
  if (!state.currentUser || !state.activeSemesterId) return [];
  const ref = collection(db,'users',state.currentUser.uid,'semesters',state.activeSemesterId,'courses');
  const snap = await getDocs(query(ref));
  const names = [];
  snap.forEach(d => {
    const c = d.data() || {};
    // Estrategias posibles para marcar aprobado:
    // 1) c.status === 'Aprobado'
    // 2) c.final >= threshold (si existiera)
    // 3) c.passed === true
    const st = (c.status || '').toLowerCase();
    const passed = st.includes('aprob') || c.passed === true;
    if (passed && (c.name || c.code)) names.push(c.name || c.code);
  });
  return names.sort((a,b)=> a.localeCompare(b));
}

/* ============ Mini estilos inyectados para barra ============ */
(function injectStyles(){
  const id = 'prog-inline-styles';
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = `
    .progress-outer{background:rgba(255,255,255,.08); border:1px solid rgba(0,0,0,.25);
      border-radius:10px; height:14px; margin-top:8px; overflow:hidden}
    .progress-outer.small{height:10px}
    .progress-inner{height:100%; background:linear-gradient(90deg, var(--primary), var(--accent));}
  `;
  document.head.appendChild(st);
})();



// Faltantes por área: filtra códigos que incluyan el área
export function faltantesPorArea(area){
  const career = state.profileData?.career || null;
  if (!career || !datasets || !datasets[career]) return [];
  const all = datasets[career];
  const aprobados = new Set(getAprobadosLocal());
  const norm = (s)=> String(s||'').toLowerCase();
  return all
    .filter(r => !aprobados.has(r.codigo))
    .filter(r => norm(r.codigo).includes(norm(area)) || norm(r.nivel).includes(norm(area)))
    .map(r => r.codigo);
}

// progreso.js

export function calcProgreso() {
  const career = state.profileData?.career || null;
  if (!career || !datasets || !datasets[career]) {
    return { aprobados: 0, total: 0, pct: 0 };
  }
  const total = datasets[career].length;
  const aprobados = getAprobadosLocal(); // ya existe en tu archivo
  return {
    aprobados: aprobados.length,
    total,
    pct: total ? +(aprobados.length / total * 100).toFixed(1) : 0
  };
}

// Simulación: sumar ramos adicionales a los aprobados
export function simular(listaRamos) {
  const base = calcProgreso();
  const extra = Array.isArray(listaRamos) ? listaRamos.length : 0;
  const aprobados = base.aprobados + extra;
  return {
    aprobados,
    total: base.total,
    pct: base.total ? +(aprobados / base.total * 100).toFixed(1) : 0
  };
}

// js/progreso.js
export function whenTaken(course) {
  const career = state.profileData?.career;
  if (!career || !datasets?.[career]) return null;

  const row = datasets[career].find(r =>
    (r.codigo||'').toLowerCase() === String(course).toLowerCase()
  );
  return row?.nivel || null; // Ej: "III", "2024-2", etc.
}

export function isApproved(course) {
  const aprobados = getAprobadosLocal();
  return aprobados.includes(course);
}

// js/progreso.js
export async function pairLevel() {
  const myCareer = state.profileData?.career;
  const other = state.pairOtherUid;
  if (!myCareer || !other) return null;

  // mis aprobados
  const myAprob = getAprobadosLocal();

  // aprobados del dúo
  const ref = doc(db, 'users', other, 'malla', 'state');
  const snap = await getDoc(ref);
  const d = snap.data() || {};
  const otherAprob = Array.isArray(d.approved) ? d.approved : [];

  // nivel típico de cada aprobado
  const nivelDe = (codigo, career) => {
    const row = datasets?.[career]?.find(r => r.codigo === codigo);
    return row?.nivel || null;
  };

  const myMax = Math.max(...myAprob.map(c => parseInt(nivelDe(c,myCareer))||0));
  const otherMax = Math.max(...otherAprob.map(c => parseInt(nivelDe(c,d.career))||0));

  return Math.min(myMax, otherMax) || null;
}
