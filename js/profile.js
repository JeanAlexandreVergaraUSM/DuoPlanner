<<<<<<< HEAD
// js/profile.js
import { db } from './firebase.js';
import { doc, onSnapshot, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, state, updateDebug } from './state.js';

/* ================= Opciones de Carrera por Universidad ================= */
// Amplía esta tabla cuando agregues más carreras/universidades.
let unsubPartner = null;

const CAREERS_BY_UNI = {
  UMAYOR: [
    { value: 'MEDVET', label: 'Medicina Veterinaria' },
  ],
  USM: [
    { value: 'ICTEL', label: 'Ing. Civil Telemática' }, // placeholder (malla por implementar)
  ],
};

/* ================= Listeners ================= */

// js/profile.js
export function listenProfile(){
  const ref = doc(db,'users', state.currentUser.uid);
  onSnapshot(ref, (snap)=>{
    state.profileData = snap.data() || null;
    fillProfileForm(state.profileData);
    reflectProfileInSemestersUI();
    updateDebug();

    // 🔹 avisa a las demás vistas que el perfil ya está listo
    document.dispatchEvent(new Event('profile:changed'));
  });
}



/* ================= UI ================= */

export function fillProfileForm(d){
  const pfName = $('pfName');
  const pfBirthday = $('pfBirthday');
  const pfUniversity = $('pfUniversity');
  const pfCustomUniWrap = $('pfCustomUniWrap');
  const pfCustomUniversity = $('pfCustomUniversity');
  const pfAgeHint = $('pfAgeHint');
  const pfCareer = $('pfCareer');
  const pfFavoriteColor = $('pfFavoriteColor'); // ⬅️ color picker
  const colorPrev = $('pfColorPreview');       // ⬅️ nuevo: preview chip
  const colorCode = $('pfColorCode');          // ⬅️ nuevo: código visible

  // helpers
  const populateCareers = (uni, selected) => {
    if (!pfCareer) return;
    pfCareer.innerHTML = '<option value="">Selecciona tu carrera…</option>';
    const list = CAREERS_BY_UNI[uni] || [];
    for (const { value, label } of list){
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      pfCareer.appendChild(opt);
    }
    pfCareer.disabled = list.length === 0;
    if (selected && list.some(x => x.value === selected)) {
      pfCareer.value = selected;
    } else {
      pfCareer.value = '';
    }
  };

  // Valores
  pfName.value = d?.name || '';
  pfBirthday.value = d?.birthday || '';
  pfAgeHint.textContent = `Edad: ${calcAge(d?.birthday) ?? '—'}`;

  pfUniversity.value = d?.university || '';

  // ⚙️ SIEMPRE iniciar oculto y mostrar SOLO si la universidad es "OTRA"
  pfCustomUniWrap.classList.add('hidden');
  pfCustomUniversity.value = '';
  const showCustom = (pfUniversity.value === 'OTRA');
  pfCustomUniWrap.classList.toggle('hidden', !showCustom);
  if (showCustom) {
    pfCustomUniversity.value = d?.customUniversity || '';
  }

  // Color favorito (con fallback + preview)
  const startColor = isValidHex(d?.favoriteColor) ? d.favoriteColor : '#22c55e';
  if (pfFavoriteColor) pfFavoriteColor.value = startColor;
  if (colorPrev) colorPrev.style.background = startColor;
  if (colorCode) colorCode.textContent = startColor.toUpperCase();

  // Poblar carrera en base a universidad actual del perfil
  populateCareers(pfUniversity.value, d?.career || '');

  // Eventos
  pfUniversity.onchange = ()=>{
    // 👇 Solo mostrar el campo cuando sea "OTRA"
    const show = (pfUniversity.value === 'OTRA');
    pfCustomUniWrap.classList.toggle('hidden', !show);
    if (!show) pfCustomUniversity.value = '';

    // al cambiar de universidad, repoblar carreras y resetear selección
    populateCareers(pfUniversity.value, null);
  };

  // 🔹 previsualización en vivo del color
  pfFavoriteColor?.addEventListener('input', (e)=>{
    const val = e.target.value;
    if (isValidHex(val)){
      if (colorPrev) colorPrev.style.background = val;
      if (colorCode) colorCode.textContent = val.toUpperCase();
    }
  });

  $('pfSaveBtn').onclick = ()=> saveProfile();
}

function calcAge(iso){
  if (!iso) return null;
  const b = new Date(iso); if (isNaN(b)) return null;
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

/* ================= Persistencia ================= */

export async function saveProfile(){
  if (!state.currentUser) return;

  const uni = $('pfUniversity').value || null;
  const careerSel = $('pfCareer');
  const favCol = $('pfFavoriteColor')?.value || null;

  const careerVal = (careerSel && CAREERS_BY_UNI[uni]?.some(x => x.value === careerSel.value))
    ? careerSel.value
    : null;

  const payload = {
    name: $('pfName').value.trim() || null,
    birthday: $('pfBirthday').value || null,
    university: uni,
    customUniversity: uni === 'OTRA' ? ($('pfCustomUniversity').value.trim() || null) : null,
    career: careerVal,
    favoriteColor: isValidHex(favCol) ? favCol : null, // ⬅️ persistimos color
    updatedAt: Date.now()
  };

  await updateDoc(doc(db,'users',state.currentUser.uid), payload);
  alert('Perfil guardado');
}

/* ================= Reflejar en Semestres ================= */

export function reflectProfileInSemestersUI(){
  const hasUni = !!(state.profileData && state.profileData.university &&
    (state.profileData.university !== 'OTRA' ||
     (state.profileData.university === 'OTRA' && state.profileData.customUniversity?.trim())));

  $('semNoticeNoUni').classList.toggle('hidden', hasUni);
  $('createSemesterBtn').disabled = !hasUni || !state.currentUser;
  $('semesterLabel').disabled = !hasUni;
  $('semesterUniFromProfile').value = hasUni ? readableUni(state.profileData) : '';
  $('createPairBtn').disabled = !state.currentUser;
}


/* ================= Helpers ================= */

function readableUni(d){
  if (!d || !d.university) return '';
  if (d.university === 'OTRA') return d.customUniversity || 'Otra';
  if (d.university === 'UMAYOR') return 'Universidad Mayor';
  if (d.university === 'USM') return 'UTFSM';
  return d.university;
}

function isValidHex(s){
  return typeof s === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s);
}

function formatDateDMY(iso){
  if (!iso) return '—';
  // Acepta "aaaa-mm-dd" (lo que sale del <input type="date">)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;           // fallback si viene en otro formato
  return `${m[3]}/${m[2]}/${m[1]}`;
}



// js/profile.js (al final del archivo añade:)
export function mountPartnerProfileCard(){
  const hostPage = $('page-perfil');
  if (!hostPage) return;

  let card = $('partnerProfileCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'partnerProfileCard';
    card.innerHTML = `
      <h3 style="margin-top:0">Perfil de tu pareja</h3>
      <div id="pp-name"><b>Nombre:</b> —</div>
      <div id="pp-uni"><b>Universidad:</b> —</div>
      <div id="pp-career"><b>Carrera:</b> —</div>
      <div id="pp-bday" class="muted"><b>Cumpleaños:</b> —</div>
      <div id="pp-color"><b>Color favorito:</b> <span id="pp-color-swatch" style="display:inline-block;width:16px;height:16px;border-radius:4px;vertical-align:middle;margin:0 6px;background:#ff69b4;border:1px solid rgba(255,255,255,.25)"></span><span id="pp-color-code">—</span></div>
    `;
    hostPage.appendChild(card);
  }

  // función para limpiar UI
  const clearUI = () => {
  $('pp-name').innerHTML   = `<b>Nombre:</b> —`;
  $('pp-uni').innerHTML    = `<b>Universidad:</b> —`;
  $('pp-career').innerHTML = `<b>Carrera:</b> —`;
  $('pp-bday').innerHTML   = `<b>Cumpleaños:</b> —`;
  $('pp-color-code').textContent = '—';
  const sw = $('pp-color-swatch');
  if (sw) {
    sw.style.background = 'transparent'; // ⬅️ deja el fondo transparente
    sw.style.border = '1px solid rgba(255,255,255,.25)'; // conserva el borde
  }
};

  // corta suscripción previa si existe
  if (unsubPartner) { unsubPartner(); unsubPartner = null; }

  // si no hay pareja, limpia y sal
  if (!state.pairOtherUid) {
    clearUI();
    return;
  }

  // suscríbete al perfil de la pareja actual
  const ref = doc(db,'users', state.pairOtherUid);
  unsubPartner = onSnapshot(ref, (snap)=>{
    const d = snap.data() || {};
    $('pp-name').innerHTML   = `<b>Nombre:</b> ${d.name || '—'}`;
    $('pp-uni').innerHTML    = `<b>Universidad:</b> ${readUni(d)}`;
    $('pp-career').innerHTML = `<b>Carrera:</b> ${d.career ? (d.career==='ICTEL'?'Ing. Civil Telemática':'Medicina Veterinaria') : '—'}`;
    $('pp-bday').innerHTML   = `<b>Cumpleaños:</b> ${formatDateDMY(d.birthday)}`;

    const col = (typeof d.favoriteColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(d.favoriteColor))
      ? d.favoriteColor : '#ff69b4';
    const sw = $('pp-color-swatch'); if (sw) sw.style.background = col;
    const cc = $('pp-color-code'); if (cc) cc.textContent = col.toUpperCase();
  });

  function readUni(d){
    if (!d?.university) return '—';
    if (d.university==='UMAYOR') return 'Universidad Mayor';
    if (d.university==='USM')    return 'UTFSM';
    if (d.university==='OTRA')   return d.customUniversity || 'Otra';
    return d.university;
  }
}

document.addEventListener('pair:ready', () => {
  // vuelve a montar / limpiar según state.pairOtherUid
  mountPartnerProfileCard();
});
=======
// js/profile.js
import { db } from './firebase.js';
import { doc, onSnapshot, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, state, updateDebug } from './state.js';

/* ================= Opciones de Carrera por Universidad ================= */
// Amplía esta tabla cuando agregues más carreras/universidades.
let unsubPartner = null;

const CAREERS_BY_UNI = {
  UMAYOR: [
    { value: 'MEDVET', label: 'Medicina Veterinaria' },
  ],
  USM: [
    { value: 'ICTEL', label: 'Ing. Civil Telemática' }, // placeholder (malla por implementar)
  ],
};

/* ================= Listeners ================= */

// js/profile.js
export function listenProfile(){
  const ref = doc(db,'users', state.currentUser.uid);
  onSnapshot(ref, (snap)=>{
    state.profileData = snap.data() || null;
    fillProfileForm(state.profileData);
    reflectProfileInSemestersUI();
    updateDebug();

    // 🔹 avisa a las demás vistas que el perfil ya está listo
    document.dispatchEvent(new Event('profile:changed'));
  });
}



/* ================= UI ================= */

export function fillProfileForm(d){
  const pfName = $('pfName');
  const pfBirthday = $('pfBirthday');
  const pfUniversity = $('pfUniversity');
  const pfCustomUniWrap = $('pfCustomUniWrap');
  const pfCustomUniversity = $('pfCustomUniversity');
  const pfAgeHint = $('pfAgeHint');
  const pfCareer = $('pfCareer');
  const pfFavoriteColor = $('pfFavoriteColor'); // ⬅️ color picker
  const colorPrev = $('pfColorPreview');       // ⬅️ nuevo: preview chip
  const colorCode = $('pfColorCode');          // ⬅️ nuevo: código visible

  // helpers
  const populateCareers = (uni, selected) => {
    if (!pfCareer) return;
    pfCareer.innerHTML = '<option value="">Selecciona tu carrera…</option>';
    const list = CAREERS_BY_UNI[uni] || [];
    for (const { value, label } of list){
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      pfCareer.appendChild(opt);
    }
    pfCareer.disabled = list.length === 0;
    if (selected && list.some(x => x.value === selected)) {
      pfCareer.value = selected;
    } else {
      pfCareer.value = '';
    }
  };

  // Valores
  pfName.value = d?.name || '';
  pfBirthday.value = d?.birthday || '';
  pfAgeHint.textContent = `Edad: ${calcAge(d?.birthday) ?? '—'}`;

  pfUniversity.value = d?.university || '';

  // ⚙️ SIEMPRE iniciar oculto y mostrar SOLO si la universidad es "OTRA"
  pfCustomUniWrap.classList.add('hidden');
  pfCustomUniversity.value = '';
  const showCustom = (pfUniversity.value === 'OTRA');
  pfCustomUniWrap.classList.toggle('hidden', !showCustom);
  if (showCustom) {
    pfCustomUniversity.value = d?.customUniversity || '';
  }

  // Color favorito (con fallback + preview)
  const startColor = isValidHex(d?.favoriteColor) ? d.favoriteColor : '#22c55e';
  if (pfFavoriteColor) pfFavoriteColor.value = startColor;
  if (colorPrev) colorPrev.style.background = startColor;
  if (colorCode) colorCode.textContent = startColor.toUpperCase();

  // Poblar carrera en base a universidad actual del perfil
  populateCareers(pfUniversity.value, d?.career || '');

  // Eventos
  pfUniversity.onchange = ()=>{
    // 👇 Solo mostrar el campo cuando sea "OTRA"
    const show = (pfUniversity.value === 'OTRA');
    pfCustomUniWrap.classList.toggle('hidden', !show);
    if (!show) pfCustomUniversity.value = '';

    // al cambiar de universidad, repoblar carreras y resetear selección
    populateCareers(pfUniversity.value, null);
  };

  // 🔹 previsualización en vivo del color
  pfFavoriteColor?.addEventListener('input', (e)=>{
    const val = e.target.value;
    if (isValidHex(val)){
      if (colorPrev) colorPrev.style.background = val;
      if (colorCode) colorCode.textContent = val.toUpperCase();
    }
  });

  $('pfSaveBtn').onclick = ()=> saveProfile();
}

function calcAge(iso){
  if (!iso) return null;
  const b = new Date(iso); if (isNaN(b)) return null;
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

/* ================= Persistencia ================= */

export async function saveProfile(){
  if (!state.currentUser) return;

  const uni = $('pfUniversity').value || null;
  const careerSel = $('pfCareer');
  const favCol = $('pfFavoriteColor')?.value || null;

  const careerVal = (careerSel && CAREERS_BY_UNI[uni]?.some(x => x.value === careerSel.value))
    ? careerSel.value
    : null;

  const payload = {
    name: $('pfName').value.trim() || null,
    birthday: $('pfBirthday').value || null,
    university: uni,
    customUniversity: uni === 'OTRA' ? ($('pfCustomUniversity').value.trim() || null) : null,
    career: careerVal,
    favoriteColor: isValidHex(favCol) ? favCol : null, // ⬅️ persistimos color
    updatedAt: Date.now()
  };

  await updateDoc(doc(db,'users',state.currentUser.uid), payload);
  alert('Perfil guardado');
}

/* ================= Reflejar en Semestres ================= */

export function reflectProfileInSemestersUI(){
  const hasUni = !!(state.profileData && state.profileData.university &&
    (state.profileData.university !== 'OTRA' ||
     (state.profileData.university === 'OTRA' && state.profileData.customUniversity?.trim())));

  $('semNoticeNoUni').classList.toggle('hidden', hasUni);
  $('createSemesterBtn').disabled = !hasUni || !state.currentUser;
  $('semesterLabel').disabled = !hasUni;
  $('semesterUniFromProfile').value = hasUni ? readableUni(state.profileData) : '';
  $('createPairBtn').disabled = !state.currentUser;
}


/* ================= Helpers ================= */

function readableUni(d){
  if (!d || !d.university) return '';
  if (d.university === 'OTRA') return d.customUniversity || 'Otra';
  if (d.university === 'UMAYOR') return 'Universidad Mayor';
  if (d.university === 'USM') return 'UTFSM';
  return d.university;
}

function isValidHex(s){
  return typeof s === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s);
}

function formatDateDMY(iso){
  if (!iso) return '—';
  // Acepta "aaaa-mm-dd" (lo que sale del <input type="date">)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;           // fallback si viene en otro formato
  return `${m[3]}/${m[2]}/${m[1]}`;
}



// js/profile.js (al final del archivo añade:)
export function mountPartnerProfileCard(){
  const hostPage = $('page-perfil');
  if (!hostPage) return;

  let card = $('partnerProfileCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'partnerProfileCard';
    card.innerHTML = `
      <h3 style="margin-top:0">Perfil de tu pareja</h3>
      <div id="pp-name"><b>Nombre:</b> —</div>
      <div id="pp-uni"><b>Universidad:</b> —</div>
      <div id="pp-career"><b>Carrera:</b> —</div>
      <div id="pp-bday" class="muted"><b>Cumpleaños:</b> —</div>
      <div id="pp-color"><b>Color favorito:</b> <span id="pp-color-swatch" style="display:inline-block;width:16px;height:16px;border-radius:4px;vertical-align:middle;margin:0 6px;background:#ff69b4;border:1px solid rgba(255,255,255,.25)"></span><span id="pp-color-code">—</span></div>
    `;
    hostPage.appendChild(card);
  }

  // función para limpiar UI
  const clearUI = () => {
  $('pp-name').innerHTML   = `<b>Nombre:</b> —`;
  $('pp-uni').innerHTML    = `<b>Universidad:</b> —`;
  $('pp-career').innerHTML = `<b>Carrera:</b> —`;
  $('pp-bday').innerHTML   = `<b>Cumpleaños:</b> —`;
  $('pp-color-code').textContent = '—';
  const sw = $('pp-color-swatch');
  if (sw) {
    sw.style.background = 'transparent'; // ⬅️ deja el fondo transparente
    sw.style.border = '1px solid rgba(255,255,255,.25)'; // conserva el borde
  }
};

  // corta suscripción previa si existe
  if (unsubPartner) { unsubPartner(); unsubPartner = null; }

  // si no hay pareja, limpia y sal
  if (!state.pairOtherUid) {
    clearUI();
    return;
  }

  // suscríbete al perfil de la pareja actual
  const ref = doc(db,'users', state.pairOtherUid);
  unsubPartner = onSnapshot(ref, (snap)=>{
    const d = snap.data() || {};
    $('pp-name').innerHTML   = `<b>Nombre:</b> ${d.name || '—'}`;
    $('pp-uni').innerHTML    = `<b>Universidad:</b> ${readUni(d)}`;
    $('pp-career').innerHTML = `<b>Carrera:</b> ${d.career ? (d.career==='ICTEL'?'Ing. Civil Telemática':'Medicina Veterinaria') : '—'}`;
    $('pp-bday').innerHTML   = `<b>Cumpleaños:</b> ${formatDateDMY(d.birthday)}`;

    const col = (typeof d.favoriteColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(d.favoriteColor))
      ? d.favoriteColor : '#ff69b4';
    const sw = $('pp-color-swatch'); if (sw) sw.style.background = col;
    const cc = $('pp-color-code'); if (cc) cc.textContent = col.toUpperCase();
  });

  function readUni(d){
    if (!d?.university) return '—';
    if (d.university==='UMAYOR') return 'Universidad Mayor';
    if (d.university==='USM')    return 'UTFSM';
    if (d.university==='OTRA')   return d.customUniversity || 'Otra';
    return d.university;
  }
}

document.addEventListener('pair:ready', () => {
  // vuelve a montar / limpiar según state.pairOtherUid
  mountPartnerProfileCard();
});
>>>>>>> ac80da7fc6057294d6be21cbc9b7893a61a95aa4
