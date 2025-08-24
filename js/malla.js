// js/malla.js
import { $, state } from './state.js';
import { db } from './firebase.js';
import { doc, setDoc, onSnapshot, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ================= Config ================= */
const CAREER_NAMES = {
  MEDVET: 'Medicina Veterinaria',
  ICTEL:  'Ing. Civil Telemática',
};
const UNI_CAREERS = {
  UMAYOR: ['MEDVET'],
  USM:    ['ICTEL'],
};

let carrerasData = {};       // { MEDVET: [...], ICTEL: [...] }
let lastRenderedKey = '';    // evita renders redundantes

// Romanos soportados (hasta 12 semestres)
const ALL_ROMANS = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const romanIndex = (r)=> ALL_ROMANS.indexOf(r); // 0‑based

/* ================= Boot ================= */
initMallaOnRoute();
window.addEventListener('hashchange', initMallaOnRoute);

// 🔹 Al llegar/actualizar el Perfil, (re)inicializa la pestaña y asegura el toggle
document.addEventListener('profile:changed', () => {
  if (location.hash !== '#/malla') return;

  const host = $('malla-host');
  if (!host) return;

  const ensureInit = async () => {
    if (!host.dataset.ready) {
      buildShell(host);
      await ensureDatasetsLoaded();
      host.dataset.ready = '1';
    }
    setupPartnerToggle?.();

    if (state.shared?.malla?.enabled && state.pairOtherUid) {
      watchPartnerMalla();
    } else {
      // invalida cache para forzar re-render de tu malla
      lastRenderedKey = '';
      renderFromProfile();
    }
  };

  ensureInit();
});

// 🔹 Reaccionar inmediatamente cuando se crea / une / elimina la party
document.addEventListener('pair:ready', () => {
  ensureMallaLiveAfterPair();
});

async function initMallaOnRoute(){
  if (location.hash !== '#/malla') return;
  const host = $('malla-host');
  if (!host) return;

  if (!host.dataset.ready) {
    buildShell(host);
    await ensureDatasetsLoaded();
    host.dataset.ready = '1';
  }

  setupPartnerToggle?.();

  // 🔁 sincroniza el flag con el switch visible (si existe)
  const cb = $('malla-view-partner');
  if (cb) state.shared.malla.enabled = !!cb.checked;

  if (!state.profileData){
    if (state.shared?.malla?.enabled && state.pairOtherUid){
      watchPartnerMalla();
    }
    return;
  }

  if (state.shared?.malla?.enabled && state.pairOtherUid) {
    watchPartnerMalla();
  } else {
    lastRenderedKey = '';
    renderFromProfile();
  }
}


async function ensureMallaLiveAfterPair(){
  if (location.hash !== '#/malla') return;
  const host = $('malla-host');
  if (!host) return;

  // Asegura UI y datasets listos
  if (!host.dataset.ready){
    buildShell(host);
    await ensureDatasetsLoaded();
    host.dataset.ready = '1';
  }

  // Asegura que exista el toggle "Ver malla de mi pareja"
  setupPartnerToggle?.();

  // Si la vista de pareja está activada y ya hay pareja → suscríbete
  if (state.shared?.malla?.enabled && state.pairOtherUid){
    watchPartnerMalla();
  } else {
    // Si no, vuelve a tu malla normal inmediatamente
    setPartnerReadonly(false);
    lastRenderedKey = '';
    if (state.profileData) renderFromProfile();
  }
}


/* ================= Helpers: modo pareja/solo‑lectura ================= */
function isPartnerView(){
  return !!(state.shared?.malla?.enabled && state.pairOtherUid);
}

function setPartnerReadonly(on){
  const wrapper = $('malla-wrapper');
  if (!wrapper) return;
  // flag para lógica de clicks y feedback visual sutil
  wrapper.dataset.readonly = on ? '1' : '0';
  wrapper.style.cursor = on ? 'not-allowed' : '';
}

/* ================= UI shell (sin selects) ================= */
function buildShell(host){
  host.innerHTML = `
    <div id="malla-wrapper" class="malla-wrapper">
      <div class="grid-header" style="display:none"></div>
      <div class="malla-grid"></div>
    </div>

    <div id="malla-info" style="display:none">
      <div id="malla-caption" class="muted" style="text-align:center;margin:6px 0 2px"></div>
      <div id="malla-percentage" class="percentage-display"></div>
      <div class="legend"></div>
    </div>
  `;

  // Toggle individual de ramo
  host.addEventListener('click', (e)=>{
    const it = e.target.closest('.grid-item');
    if (!it) return;

    // ⛔ Si es vista de pareja (solo-lectura), no permitir tildar/destildar
    if (isPartnerView() || $('malla-wrapper')?.dataset.readonly === '1') return;

    it.classList.toggle('aprobado');
    actualizarDependencias(host);
    saveState(host);
    updatePercentage(host);
  });
}

/* ================= Datos ================= */
async function ensureDatasetsLoaded(){
  if (carrerasData.MEDVET && carrerasData.ICTEL) return;

  // UMayor - Medicina Veterinaria
  const medvet = await fetch('data/medvet_malla.csv').then(r=>r.text());
  carrerasData.MEDVET = parseMedvetCSV(medvet);

  // USM - Telemática
  try{
    const ictel = await fetch('data/ictel_malla.csv').then(r=>r.text());
    carrerasData.ICTEL = parseIctelCSV(ictel);
  }catch{ carrerasData.ICTEL = []; }
}

function parseMedvetCSV(text){
  const rows = parseCSV(text);

  const integrativa     = [1,16,36,43,45,51,54,55,56,58,60];
  const formBas         = [2,3,4,5,6,9,10,11,17,18,24,30,49];
  const electiva        = [12,19,25,31,37];
  const salAnimal       = [7,13,15,20,21,22,28,32,33,34,39,40,41,42,44,46,47,48,52,53];
  const prodAnimal      = [8,14,26,38];
  const medioAmb        = [23,29];
  const salPublica      = [27,35,50,57];
  const transversal     = rows
    .map(r => parseInt(r['Código Asignatura'], 10))
    .filter(n => ![...integrativa, ...formBas, ...electiva,
                   ...salAnimal, ...prodAnimal, ...medioAmb, ...salPublica].includes(n));

  return rows.map(r=>{
    let codigo = r['Código Asignatura'];
    if (codigo.includes('.')) codigo = codigo.split('.')[0];

    const prereqs = ['Prerrequisito 01 (Código)',
                     'Prerrequisito 02 (Código)',
                     'Prerrequisito 03 (Código)']
      .map(c => r[c])
      .filter(v => v && v.toLowerCase() !== 'ingreso')
      .map(v => v.includes('.') ? v.split('.')[0] : v);

    const num = parseInt(codigo, 10);
    let area = '';
    if (integrativa.includes(num))      area = 'integrativa';
    else if (formBas.includes(num))     area = 'formacion-basica';
    else if (electiva.includes(num))    area = 'electiva';
    else if (salAnimal.includes(num))   area = 'salud-animal';
    else if (prodAnimal.includes(num))  area = 'produccion-animal';
    else if (medioAmb.includes(num))    area = 'medio-ambiente';
    else if (salPublica.includes(num))  area = 'salud-publica';
    else if (transversal.includes(num)) area = 'transversal';

    return {
      codigo,             // ej. "1", "2" (números del dataset de MedVet)
      sigla:  '',         // MedVet no usa sigla visible
      numero: null,       // idem
      creditos: null,     // idem
      nombre: r['Asignatura'],
      nivel:  r['Nivel'].trim(),  // 'I'..'X'
      prerrequisitos: prereqs,    // códigos (num/str)
      area
    };
  });
}

function parseIctelCSV(text){
  const rows = parseCSV(text);

  const toRoman = (val)=>{
    const n = parseInt((val||'').trim(),10);
    return Number.isFinite(n) && n>=1 && n<=ALL_ROMANS.length
      ? ALL_ROMANS[n-1]
      : String(val||'').toUpperCase();
  };

  const guessArea = (sigla, nombre)=>{
    const p  = (sigla||'').split('-')[0].toUpperCase();
    const nm = (nombre||'').toLowerCase();
    if (p==='MAT' || p==='QUI') return 'Ciencias Básicas';
    if (p==='FIS') return 'Física';
    if (p==='ELO') return 'Electrónica';
    if (p==='HCW') return 'Inglés';
    if (p==='DEW') return 'Deportes';
    if (p==='INF') return 'Software';
    if (p==='TEL'){
      if (nm.includes('red')) return 'Redes';
      if (nm.includes('telecom')) return 'Telecomunicaciones';
      return 'Telecomunicaciones';
    }
    if (p==='IWN') return 'Formación General';
    if (p==='IWG') return 'Industrias';
    return '';
  };

  return rows.map(r=>{
    // normaliza llaves para buscar por alias
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

    const numeroStr = pick('Número','Numero','Nº','N°','num','n');
    const numero    = parseInt(numeroStr,10) || null;

    let sigla  = pick('Sigla','Código','Codigo','Código Asignatura','Codigo Asignatura');
    let codigo = pick('Código Asignatura','Codigo Asignatura','Código','Codigo','Sigla');
    if (!sigla)  sigla  = codigo;
    if (!codigo) codigo = sigla;

    const nombre = pick('Asignatura','Nombre','Nombre Asignatura','Ramo');
    const nivel  = toRoman(pick('Nivel','Semestre','Periodo','Período','Romano'));

    let areaRaw  = pick('Área','Area','Línea','Linea','Linea/Área','Linea Area');
    if (!areaRaw) areaRaw = guessArea(sigla, nombre);

    const creditos = parseInt(pick('Créditos','Creditos','SCT','Créditos SCT','Sct','Cred'),10) || 0;

    // Prerrequisitos: permite "19/10", "19, 10", "19 y 10", "TEL-101"… y limpia ruido
    const prereqs = Object.keys(norm)
      .filter(k=> k.startsWith('prerrequisito'))
      .flatMap(k=>{
        return String(norm[k]||'')
          .replace(/\b(ingreso|sin|na|n\/a|none)\b/ig,'')
          .split(/[^\w-]+/g)  // conserva TEL-101
          .map(s=>s.trim())
          .filter(Boolean)
          .filter(s=> s!=='0' && s!=='-');
      });

    return {
      codigo, sigla, numero, creditos, nombre, nivel,
      prerrequisitos: prereqs,
      area: areaRaw
    };
  });
}

function parseCSV(text){
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  // Detecta separador: usa el que más columnas produzca en la cabecera
  const trySplit = (line, sep)=> line.split(sep).length;
  const head = lines[0];
  const sep = (trySplit(head,';') >= trySplit(head,',')) ? ';' : ',';

  const headers = head.split(sep).map(h => h.trim().replace(/^["']|["']$/g,''));
  return lines.slice(1).map(line=>{
    const cols = line.split(sep).map(c => c.trim().replace(/^["']|["']$/g,''));
    const o = {};
    headers.forEach((h,i)=> { o[h] = cols[i] ?? ''; });
    return o;
  });
}

/* ================= Render desde Perfil ================= */
function renderFromProfile(){
  const uni = state.profileData?.university || '';
  const car = state.profileData?.career || '';

  const gridHeader = document.querySelector('#page-malla .grid-header');
  const grid = document.querySelector('#page-malla .malla-grid');
  const info = $('malla-info');
  const caption = $('malla-caption');

  // 🔓 siempre que vas a tu malla, quita solo-lectura
  setPartnerReadonly(false);

  if (!uni || !car || !(UNI_CAREERS[uni] || []).includes(car)){
    lastRenderedKey = '';
    gridHeader.style.display = 'none';
    grid.innerHTML = `<div class="muted">Completa tu <b>Universidad</b> y <b>Carrera</b> en <b>Perfil</b> para ver la malla.</div>`;
    info.style.display = 'none';
    return;
  }

  const key = `${uni}:${car}`;
  if (key === lastRenderedKey) { updatePercentage(document.getElementById('malla-wrapper')); return; }
  lastRenderedKey = key;

  caption.textContent = `${readableUni(uni)} · ${CAREER_NAMES[car] || car}`;
  renderMalla(car);
}

function readableUni(code){
  if (code==='UMAYOR') return 'Universidad Mayor';
  if (code==='USM') return 'UTFSM';
  return code || '—';
}

/* ================= Render malla ================= */
function renderMalla(careerCode){
  const section = $('page-malla');
  section.dataset.career = careerCode; // scope CSS por carrera
  const gridHeader = section.querySelector('.grid-header');
  const grid = section.querySelector('.malla-grid');
  const info = $('malla-info');

  grid.innerHTML = '';
  if (!careerCode){
    gridHeader.style.display = 'none';
    info.style.display = 'none';
    return;
  }

  const asigs = carrerasData[careerCode] || [];
  if (!asigs.length){
    grid.innerHTML = `<div class="muted">Malla en preparación.</div>`;
    gridHeader.style.display = 'none';
    info.style.display = 'none';
    return;
  }

  // ---------- Cabecera dinámica (años + semestres presentes) ----------
  const levels = Array.from(new Set(asigs.map(a => a.nivel))).sort((a,b)=>romanIndex(a)-romanIndex(b));
  const years  = Math.ceil(levels.length/2);

  // Ajusta número de columnas tanto en header como en grilla
  gridHeader.style.gridTemplateColumns = `repeat(${levels.length}, 1fr)`;
  grid.style.gridTemplateColumns       = `repeat(${levels.length}, 1fr)`;

  gridHeader.innerHTML = '';
  // fila AÑOS
  for (let y=1; y<=years; y++){
    const yearDiv = document.createElement('div');
    yearDiv.className = 'year';
    yearDiv.dataset.year = String(y);
    yearDiv.title = `Marcar Año ${y}`;
    yearDiv.style.cursor = 'pointer';
    yearDiv.textContent = `Año ${y}`;
    // coloca el año sobre dos columnas (2 semestres)
    yearDiv.style.gridColumn = `${(y-1)*2+1} / span 2`;
    gridHeader.appendChild(yearDiv);
  }
  // fila SEMESTRES
  levels.forEach((sem)=>{
    const semDiv = document.createElement('div');
    semDiv.className = 'sem';
    semDiv.dataset.sem = sem;
    semDiv.title = `Marcar semestre ${sem}`;
    semDiv.style.cursor = 'pointer';
    semDiv.textContent = sem;
    gridHeader.appendChild(semDiv);
  });
  gridHeader.style.display = 'grid';

  // listeners de la cabecera
  gridHeader.querySelectorAll('.year').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (isPartnerView() || $('malla-wrapper')?.dataset.readonly === '1') return; // ⛔ bloquea en pareja
      toggleYear(parseInt(btn.dataset.year,10));
    });
  });
  gridHeader.querySelectorAll('.sem').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (isPartnerView() || $('malla-wrapper')?.dataset.readonly === '1') return; // ⛔ bloquea en pareja
      toggleSemester(btn.dataset.sem);
    });
  });

  // ---------- Leyenda por carrera ----------
  const legend = section.querySelector('.legend');
  if (careerCode === 'ICTEL'){
    legend.innerHTML = `
      <span><span class="legend-color cb"></span>Ciencias Básicas</span>
      <span><span class="legend-color software"></span>Software</span>
      <span><span class="legend-color fisica"></span>Física</span>
      <span><span class="legend-color transversal"></span>Transversal e Integración</span>
      <span><span class="legend-color fg"></span>Formación General</span>
      <span><span class="legend-color deportes"></span>Deportes</span>
      <span><span class="legend-color redes"></span>Redes</span>
      <span><span class="legend-color ingles"></span>Inglés</span>
      <span><span class="legend-color electronica"></span>Electrónica</span>
      <span><span class="legend-color telecom"></span>Telecomunicaciones</span>
      <span><span class="legend-color industrias"></span>Industrias</span>
      <span><span class="legend-color complementarios"></span>Complementarios</span>
    `;
  }else{
    legend.innerHTML = `
      <span><span class="legend-color integrativa"></span>Formación Integrativa</span>
      <span><span class="legend-color salud-animal"></span>Formación Salud Animal</span>
      <span><span class="legend-color produccion-animal"></span>Formación Producción Animal</span>
      <span><span class="legend-color salud-publica"></span>Formación Salud Pública</span>
      <span><span class="legend-color medio-ambiente"></span>Formación Medio Ambiente</span>
      <span><span class="legend-color formacion-basica"></span>Formación Básica</span>
      <span><span class="legend-color electiva"></span>Formación Electiva</span>
    `;
  }
  info.style.display = 'block';

  // ---------- Render de celdas ----------
  // Índices para colorear prereqs por NÚMERO, CÓDIGO y SIGLA
  const areaByKey = new Map();
  asigs.forEach(a=>{
    if (a.numero!=null) areaByKey.set(String(a.numero), a.area);
    if (a.codigo)       areaByKey.set(String(a.codigo), a.area);
    if (a.sigla)        areaByKey.set(String(a.sigla),  a.area);
  });

  grid.innerHTML = ''; // limpio
  asigs.forEach(a=>{
    let idx = romanIndex(a.nivel);
    if (idx < 0) idx = 0; // fallback
    const col = idx + 1;  // grid columns son 1‑based

    const div = document.createElement('div');
    div.className = 'grid-item' + (a.area ? ' area-' + areaClass(a.area) : '');
    div.style.gridColumn = String(col);
    div.dataset.codigo = a.codigo;
    div.dataset.key    = String(a.numero ?? a.codigo); // clave para prereqs
    div.dataset.prereqs = JSON.stringify(a.prerrequisitos);
    div.dataset.sem    = a.nivel;
    div.dataset.year   = String(Math.ceil(col/2));

    // bandas
    const top = document.createElement('div');
    top.className = 'top-bar'; div.appendChild(top);

    // SIGLA arriba izquierda (si existe)
    if (a.sigla){
      const sl = document.createElement('span');
      sl.className = 'sigla-label';
      sl.textContent = a.sigla;
      top.appendChild(sl);
    }

    // NÚMERO/CÓDIGO arriba derecha
    const code = document.createElement('span');
    code.className = 'code-label';
    code.textContent = a.numero ?? a.codigo;
    top.appendChild(code);

    // NOMBRE al centro
    const nm = document.createElement('div');
    nm.className = 'course-name';
    nm.textContent = a.nombre;
    div.appendChild(nm);

    // BANDA INFERIOR
    const bot = document.createElement('div');
    bot.className = 'bottom-bar';
    div.appendChild(bot);

    // prereqs a la izquierda (bolitas)
    (a.prerrequisitos||[]).forEach((pr, i)=>{
      const key = String(pr);
      const p = document.createElement('span');
      p.className = 'prereq-label';
      p.textContent = key;
      p.style.left = `${4+i*22}px`;
      const ar = areaByKey.get(key);
      if (ar) p.classList.add('area-'+areaClass(ar));
      bot.appendChild(p);
    });

    // créditos a la derecha (si existen)
    if (a.creditos){
      const cr = document.createElement('span');
      cr.className = 'credits-badge';
      cr.textContent = a.creditos;
      bot.appendChild(cr);
    }

    grid.appendChild(div);
  });

  // al final de renderMalla
loadState(section, careerCode);
actualizarDependencias(section, careerCode);
updatePercentage(section);

// ❗No guardes estado cuando estás viendo la malla de la pareja
if (!isPartnerView()) {
  try { saveState(section); } catch {}
}

}

function areaClass(area){
  const s = (area || '').toLowerCase();
  const t = s
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // quita acentos
    .replace(/[-_]+/g,' ')                           // guiones/underscores -> espacio
    .replace(/\s+/g,' ').trim();

  // UMayor (MedVet)
  if (t.includes('integrativ')) return 'integrativa';
  if (t.includes('formacion basica')) return 'formacion-basica';
  if (t.includes('electiva')) return 'electiva';
  if (t.includes('salud animal')) return 'salud-animal';
  if (t.includes('produccion animal')) return 'produccion-animal';
  if (t.includes('medio ambiente')) return 'medio-ambiente';
  if (t.includes('salud publica')) return 'salud-publica';

  // USM (ICTEL)
  if (t.includes('ciencias basicas')) return 'cb';
  if (t.includes('software')) return 'software';
  if (t.includes('fisica')) return 'fisica';
  if (t.includes('transversal')) return 'transversal';    // Transversal e Integración
  if (t.includes('formacion general')) return 'fg';
  if (t.includes('deporte')) return 'deportes';
  if (t.includes('redes')) return 'redes';
  if (t.includes('ingles')) return 'ingles';
  if (t.includes('electronica')) return 'electronica';
  if (t.includes('telecom')) return 'telecom';
  if (t.includes('industri')) return 'industrias';
  if (t.includes('complement')) return 'complementarios';

  return 'transversal';
}

/* ================= Selección masiva ================= */
function toggleYear(year){
  const host = $('malla-wrapper');
  if (!host) return;
  // ⛔ bloquea en pareja
  if (isPartnerView() || host.dataset.readonly === '1') return;

  const items = host.querySelectorAll(`.grid-item[data-year="${year}"]`);
  const allOn = Array.from(items).every(el => el.classList.contains('aprobado'));
  items.forEach(el => el.classList.toggle('aprobado', !allOn));
  actualizarDependencias(host);
  saveState(host);
  updatePercentage(host);
}

function toggleSemester(roman){
  const host = $('malla-wrapper');
  if (!host) return;
  // ⛔ bloquea en pareja
  if (isPartnerView() || host.dataset.readonly === '1') return;

  const items = host.querySelectorAll(`.grid-item[data-sem="${roman}"]`);
  const allOn = Array.from(items).every(el => el.classList.contains('aprobado'));
  items.forEach(el => el.classList.toggle('aprobado', !allOn));
  actualizarDependencias(host);
  saveState(host);
  updatePercentage(host);
}

/* ================= Dependencias + estado ================= */
function actualizarDependencias(host){
  const all = host.querySelectorAll('.grid-item');
  all.forEach(el=>{
    const prereqs = JSON.parse(el.dataset.prereqs||'[]');
    const ok = prereqs.every(k=>{
      // busca por key (numero o codigo) y por codigo por compatibilidad + sigla
      const key = CSS.escape(String(k));
      const selKey = `.grid-item[data-key="${key}"]`;
      const selCod = `.grid-item[data-codigo="${key}"]`;
      const pre = host.querySelector(selKey) || host.querySelector(selCod) ||
                  Array.from(host.querySelectorAll('.grid-item')).find(d=> d.querySelector('.sigla-label')?.textContent===String(k));
      return pre && pre.classList.contains('aprobado');
    });
    // después: NO borres "aprobado" al recalcular
    if (!ok){ el.classList.add('bloqueado'); }
    else    { el.classList.remove('bloqueado'); }
  });
}

/* ================= Estado persistente ================= */
async function saveState(host){
  const uni = state.profileData?.university || 'GEN';
  const career = state.profileData?.career || 'GEN';
  const aprob = Array.from(host.querySelectorAll('.grid-item.aprobado')).map(el=>el.dataset.codigo);
  localStorage.setItem(`mallaAprobados:${uni}:${career}`, JSON.stringify(aprob));

  // 🔹 Espejar en Firestore para vista en tiempo real de la pareja
  if (state.currentUser){
    const ref = doc(db,'users',state.currentUser.uid,'malla','state');
    await setDoc(ref, { career, approved: aprob, updatedAt: Date.now() }, { merge:true });
  }
}

function loadState(host, career){
  const uni = state.profileData?.university || 'GEN';
  const arr = JSON.parse(localStorage.getItem(`mallaAprobados:${uni}:${career}`) || '[]');
  arr.forEach(c=>{
    const el = host.querySelector(`.grid-item[data-codigo="${CSS.escape(String(c))}"]`);
    if (el) el.classList.add('aprobado');
  });
}

function updatePercentage(host){
  const total = host.querySelectorAll('.grid-item').length;
  const aprob = host.querySelectorAll('.grid-item.aprobado').length;
  const pct   = total ? ((aprob/total)*100).toFixed(1) : '0.0';
  $('malla-percentage').textContent = `Total de ramos: ${pct}%`;
}


/* ================= Toggle + suscripción a malla de la pareja ================= */

function setupPartnerToggle(){
  const host = $('malla-host');
  if (!host || $('malla-partner-toggle')) return;

  const bar = document.createElement('div');
  bar.id = 'malla-partner-toggle';
  bar.className = 'row';
  bar.style.margin = '10px 0';
  bar.innerHTML = `
    <label class="pill">
      <input type="checkbox" id="malla-view-partner" style="margin-right:8px"/>
      Ver malla de mi pareja (solo lectura)
    </label>
  `;
  host.prepend(bar);

  const cb = $('malla-view-partner');
  cb.checked = !!state.shared?.malla?.enabled;
  cb.addEventListener('change', ()=>{
    state.shared.malla.enabled = cb.checked;
    // Re-render base y luego aplicar (o quitar) la vista de pareja
    renderFromProfile();
    watchPartnerMalla();
  });
}

let unsubMallaPartner = null;
function watchPartnerMalla(){
  // corta suscripción previa
  if (unsubMallaPartner){ unsubMallaPartner(); unsubMallaPartner = null; }

  const host = document.getElementById('malla-wrapper');
  if (!host) return;

  // si NO está activado o NO hay pareja → volver a tu malla (Perfil)
  if (!state.shared?.malla?.enabled || !state.pairOtherUid){
    setPartnerReadonly(false);          // 🔓 tu malla editable
    // invalida cache para forzar re-render de tu malla
    lastRenderedKey = '';
    // renderiza tu malla según tu Perfil
    if (state.profileData) renderFromProfile();
    return;
  }

  setPartnerReadonly(true);             // 🔒 vista pareja solo-lectura

  // Suscripción al documento de malla de la pareja
  const ref = doc(db,'users', state.pairOtherUid, 'malla', 'state');
  unsubMallaPartner = onSnapshot(ref, async (snap)=>{
    const data = snap.data() || {};
    let partnerCareer = data.career || null;
    const approved = Array.isArray(data.approved) ? data.approved : [];

    // ⚠️ A veces llega "UMAYOR"/"USM" (universidad), no la carrera.
    // En ese caso, fuerza fallback al perfil para obtener MEDVET/ICTEL.
    if (partnerCareer === 'UMAYOR' || partnerCareer === 'USM') {
      partnerCareer = null;
    }

    // 🔹 Fallback: si no hay career en malla/state, toma el career del perfil de la pareja
    if (!partnerCareer && state.pairOtherUid){
      try{
        const profSnap = await getDoc(doc(db,'users', state.pairOtherUid));
        if (profSnap.exists()){
          const prof = profSnap.data() || {};
          if (prof?.career) partnerCareer = prof.career;
        }
      }catch(_){ /* ignora errores de red/permiso */ }
    }

    // 1) Si hay carrera de la pareja (desde malla o perfil), forzar render de esa carrera
    if (partnerCareer){
      await forceRenderCareer(partnerCareer); // ← helper que re-renderiza y ajusta caption
    }

    // 2) Aplicar aprobados de la pareja sobre la malla actualmente mostrada
    const wrapper = $('malla-wrapper');
    if (!wrapper) return;

    wrapper.querySelectorAll('.grid-item.aprobado').forEach(el => el.classList.remove('aprobado'));
    approved.forEach(c=>{
      const el = wrapper.querySelector(`.grid-item[data-codigo="${CSS.escape(String(c))}"]`);
      if (el) el.classList.add('aprobado');
    });

    // 3) Recalcular dependencias y porcentaje
    actualizarDependencias(wrapper);
    updatePercentage(wrapper);

    // 4) Caption “vista de tu pareja”
    const caption = $('malla-caption');
    if (caption && partnerCareer && !caption.textContent.includes('vista de tu pareja')){
      caption.textContent = `${CAREER_NAMES[partnerCareer] || partnerCareer} · (vista de tu pareja)`;
    }
  }, (_err)=>{
    // ante error, volver a tu malla
    setPartnerReadonly(false);          // 🔓
    lastRenderedKey = '';
    if (state.profileData) renderFromProfile();
  });
}


// Fuerza render a una carrera específica (ignora Perfil). Útil para "ver malla pareja".
async function forceRenderCareer(careerCode){
  const section = $('page-malla');
  if (!section) return;

  await ensureDatasetsLoaded();

  // 🔹 marca explícita de carrera actual mostrada (para CSS/queries)
  section.dataset.career = careerCode;

  // 🔹 MUY IMPORTANTE: invalida/actualiza el cache para que luego
  // renderFromProfile() NO se salte el re-render
  lastRenderedKey = `FORCED:${careerCode}`;

  // Ajusta caption para modo pareja
  const caption = $('malla-caption');
  caption.textContent = `${CAREER_NAMES[careerCode] || careerCode} · (vista de tu pareja)`;

  setPartnerReadonly(true);            // 🔒 asegurar solo-lectura aquí también

  // Render con la carrera pedida
  renderMalla(careerCode);
}
