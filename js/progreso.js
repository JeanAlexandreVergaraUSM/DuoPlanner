  // js/progreso.js
import { db } from './firebase.js';
import { $, state } from './state.js';
import { doc, onSnapshot, collection, getDocs, query, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';



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

export async function refreshProgreso() {
  const host3 = $('prog-combinado'); // 🔹 solo necesitamos el combinado
  if (!host3) return;

  // Ocultar posibles restos
  host3.classList.remove('hidden');
  host3.innerHTML = `<h3 style="margin:0 0 8px">Progreso combinado</h3><div class="muted">Conectando…</div>`;

  // Si aún no hay carrera o datasets, salimos
  const career = state.profileData?.career || null;
  if (!career || !datasets) {
    host3.innerHTML = `<h3 style="margin:0 0 8px">Progreso combinado</h3>
    <div class="muted">Completa tu perfil antes de ver el progreso. 🌱</div>`;
    return;
  }

  const total = (datasets && datasets[career]) ? datasets[career].length : 0;
  const aprobados = getAprobadosLocal();
  const myPct = total ? pct(aprobados.length, total) : 0;

  if (unsubPartnerMalla) { unsubPartnerMalla(); unsubPartnerMalla = null; }

  const other = state.pairOtherUid || null;
  if (!other) {
    host3.innerHTML = `<h3 style="margin:0 0 8px">Progreso combinado</h3>
    <div class="muted">Aún no estás conectado a un dúo. Crea o únete a una party. 👥</div>`;
    return;
  }

  // 🔹 Mantiene el resto de la lógica original desde aquí:
  const ref = doc(db, 'users', other, 'malla', 'state');
  unsubPartnerMalla = onSnapshot(ref, async (snap) => {
    const d = snap.data() || {};
    let partnerCareer = d.career || null;

    if (partnerCareer === 'UMAYOR' || partnerCareer === 'USM') partnerCareer = null;
    if (!partnerCareer) {
      try {
        const profSnap = await getDoc(doc(db, 'users', other));
        if (profSnap.exists()) {
          const pd = profSnap.data() || {};
          if (pd.career) partnerCareer = pd.career;
        }
      } catch (_) {}
    }

    const partnerApproved = Array.isArray(d.approved) ? d.approved.length : 0;
    const partnerTotal = (partnerCareer && datasets && datasets[partnerCareer])
      ? datasets[partnerCareer].length
      : 0;

    const combined = (total + partnerTotal)
      ? pct(aprobados.length + partnerApproved, total + partnerTotal)
      : 0;

    host3.innerHTML = `
      <h3 style="margin:0 0 8px">🏁 Progreso combinado</h3>
      <div style="font-weight:600; margin-bottom:4px">Juntos llevan ${fmtPct(combined)}</div>
      <div class="progress-outer small"><div class="progress-inner" style="width:${combined}%;"></div></div>
      <div class="muted" style="margin-top:6px">Tú: ${fmtPct(myPct)} · Duo: ${fmtPct(pct(partnerApproved, partnerTotal))}</div>
    `;
  }, (_err) => {
    host3.innerHTML = `<div class="muted">Error al conectar con el progreso del dúo.</div>`;
  });
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

document.addEventListener('route:change', (e)=>{
  if (e.detail?.route === '#/party') refreshProgreso();
});
