// js/profile.js
import { db } from './firebase.js';
import { doc, onSnapshot, updateDoc,setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, state, updateDebug } from './state.js';

let unsubProfile = null; // 👈 NUEVO

export function stopProfileListener(){
  if (unsubProfile) { unsubProfile(); unsubProfile = null; }
  state.unsubscribeProfile = null;
}



// 🔁 NUEVOS helpers de fecha
function parseStoredBirthdayToPickerValue(stored){
  if (!stored) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  const m = /^(\d{2})-(\d{2})$/.exec(stored);
  if (m) { const dd = m[1], mm = m[2]; return `2000-${mm}-${dd}`; }
  return '';
}

// ── Avatar helpers ─────────────────────────────
async function readFileAsImage(file){
  const dataUrl = await new Promise((res, rej)=>{
    const fr = new FileReader();
    fr.onload = ()=> res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const img = await new Promise((res, rej)=>{
    const im = new Image();
    im.onload = ()=> res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  return img;
}
function drawCompressed(img, target=256, quality=0.82){
  const canvas = document.createElement('canvas');
  const size = Math.min(img.width, img.height);
  const sx = (img.width - size)/2;
  const sy = (img.height - size)/2;
  canvas.width = target; canvas.height = target;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, size, size, 0, 0, target, target);
  return canvas.toDataURL('image/jpeg', quality);
}
function renderAvatarInCircle(dataUrl){
  const circle = document.getElementById('pfAvatarCircle');
  if (!circle) return;

  if (dataUrl && !dataUrl.startsWith("emoji:")) {
    circle.textContent = '';
    circle.style.backgroundImage = `url("${dataUrl}")`;
  } else {
    circle.style.backgroundImage = 'none';
    // si es emoji o vacío → muestra el 👨‍🎓
    circle.textContent = '👨‍🎓';
  }
}


function normalizePickerToIso(valueFromPicker, prevStored){
  if (valueFromPicker && /^\d{4}-\d{2}-\d{2}$/.test(valueFromPicker)) {
    return valueFromPicker;
  }
  const m = /^(\d{2})-(\d{2})$/.exec(prevStored || '');
  if (m) { const dd = m[1], mm = m[2]; return `2000-${mm}-${dd}`; }
  return null;
}

/* ================= Opciones de Carrera por Universidad ================= */
let unsubPartner = null;

const CAREERS_BY_UNI = {
  UMAYOR: [{ value: 'MEDVET', label: 'Medicina Veterinaria' }],
  USM:    [{ value: 'ICTEL',  label: 'Ing. Civil Telemática' }],
};

/* ================= Listeners ================= */
export function listenProfile(){
  if (unsubProfile) { unsubProfile(); unsubProfile = null; }

  const uid = state.currentUser?.uid;
  if (!uid) return;

  const refRoot = doc(db,'users', uid);
  const refProf = doc(db,'users', uid, 'profile', 'profile');

  // escucha root y subdoc a la vez
  const mergeAndFill = (rootSnap, profSnap) => {
    const root = rootSnap?.data() || {};
    const prof = profSnap?.data() || {};
    // el subdoc (prof) tiene prioridad sobre el root
state.profileData = {
  ...root,
  ...prof,
  name: prof?.name || root?.name || root?.fullName || prof?.fullName || ''
};
delete state.profileData.fullName; // 🔹 fuerza a ignorar el campo viejo


// si ambos tienen nombre, elige el más nuevo o el no vacío
if (root?.name && !state.profileData.name) state.profileData.name = root.name;
if (root?.fullName && !state.profileData.name) state.profileData.name = root.fullName;
if (prof?.name) state.profileData.name = prof.name;
if (prof?.fullName) state.profileData.name = prof.fullName;


    fillProfileForm(state.profileData);
    reflectProfileInSemestersUI();
    updateDebug();
    document.dispatchEvent(new Event('profile:changed'));
  };

  let latestRoot = null, latestProf = null;

  const unsubRoot = onSnapshot(refRoot, (snap)=>{
    latestRoot = snap;
    mergeAndFill(latestRoot, latestProf);
  });
  const unsubProf = onSnapshot(refProf, (snap)=>{
    latestProf = snap;
    mergeAndFill(latestRoot, latestProf);
  });

  unsubProfile = ()=>{ unsubRoot(); unsubProf(); };
  state.unsubscribeProfile = unsubProfile;
}



export function clearProfileUI(){
  const set = (id, val='') => { const el = $(id); if (el) el.value = val; };

  set('pfName');
  set('pfGoogleEmail');    // 👈 borra el correo visible
  set('pfBirthday');
  set('pfFavoriteColor', '#22c55e');
  const prev = $('pfColorPreview'); if (prev) prev.style.background = '#22c55e';
  const code = $('pfColorCode');    if (code) code.textContent = '#22C55E';

  const uni = $('pfUniversity') || $('uniSel'); if (uni) uni.value = '';
  const car = $('pfCareer') || $('careerSel');  if (car) { car.value = ''; car.disabled = true; }

  set('pfEmailUni');
  set('pfPhone');

  // resetea avatar
  renderAvatarInCircle(null);

  // quita “dirty” del date para que vuelva a obedecer al servidor
  const bInp = $('pfBirthday'); if (bInp) delete bInp.dataset?.dirty;
}


/* ================= UI ================= */
export function fillProfileForm(d){
  const pfName = $('pfName');
  const pfBirthday = $('pfBirthday');
  const pfUniversity = $('pfUniversity') || $('uniSel');   // soporta tu HTML
  const pfCustomUniWrap = $('pfCustomUniWrap');            // puede no existir (OK)
  const pfCustomUniversity = $('pfCustomUniversity');      // puede no existir (OK)
  const pfCareer = $('pfCareer') || $('careerSel');        // soporta tu HTML
  const pfFavoriteColor = $('pfFavoriteColor');
  const colorPrev = $('pfColorPreview');
  const colorCode = $('pfColorCode');
  const pfEmailUni = $('pfEmailUni') || $('pfEmail');
  const pfPhone    = $('pfPhone')    || $('pfTelefono');
  const pfGoogleEmail = $('pfGoogleEmail');
  const cancelBtn = $('pfCancelBtn');
  const populateCareers = (uni, selected) => {
    if (!pfCareer) return;
    pfCareer.innerHTML = '<option value="">Selecciona tu carrera…</option>';
    const list = CAREERS_BY_UNI[uni] || [];
    for (const { value, label } of list){
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      pfCareer.appendChild(opt);
    }
    pfCareer.disabled = (list.length === 0);
    if (selected && list.some(x => x.value === selected)) {
      pfCareer.value = selected;
    } else {
      pfCareer.value = '';
    }
  };

  if (cancelBtn && !cancelBtn.dataset.bound) {
  cancelBtn.onclick = () => fillProfileForm(state.profileData || null); // restaura valores del snapshot
  cancelBtn.dataset.bound = '1';
}

  if (pfGoogleEmail && state.currentUser?.email) {
    pfGoogleEmail.value = state.currentUser.email;
  }

  if (pfEmailUni) pfEmailUni.value = d?.uniEmail || '';
  if (pfPhone)    pfPhone.value    = d?.phone || '';

  if (pfName) {
  pfName.value = d?.fullName || d?.name || '';
}


if (pfBirthday) {
  const serverVal = parseStoredBirthdayToPickerValue(d?.birthday || '');

  const isEditing = (document.activeElement === pfBirthday);
  const isDirty   = pfBirthday.dataset.dirty === '1';

  if (!isEditing && !isDirty) {
    pfBirthday.value = serverVal || '';
    if (serverVal) pfBirthday.setAttribute('value', serverVal);
    else pfBirthday.removeAttribute('value');
  }

  if (!pfBirthday.dataset.bound) {
    pfBirthday.addEventListener('change', (e) => {
      const v = e.target.value || '';
      pfBirthday.dataset.dirty = '1';
      pfBirthday.value = v;                    // propiedad
      if (v) pfBirthday.setAttribute('value', v); else pfBirthday.removeAttribute('value'); // atributo
      // espejo local para que un repintado inmediato no lo borre
      state.profileData = { ...(state.profileData || {}), birthday: v };

    });

    // opcionales
    pfBirthday.addEventListener('paste',  (e) => e.preventDefault());
    pfBirthday.addEventListener('drop',   (e) => e.preventDefault());

    pfBirthday.dataset.bound = '1';
  }
}


  // CAMBIO: null-safe
  if (pfUniversity) {
  const uni = d?.university || '';
  // Normaliza: si llega "Universidad Mayor", mapear a "UMAYOR"
  if (uni === 'Universidad Mayor') pfUniversity.value = 'UMAYOR';
  else if (uni === 'UTFSM' || uni === 'USM') pfUniversity.value = 'USM';
  else pfUniversity.value = uni;
}


  // ⚙️ Inicia oculto y solo muestra si la uni es "OTRA"
  if (pfCustomUniWrap) pfCustomUniWrap.classList.add('hidden');
  if (pfCustomUniversity) pfCustomUniversity.value = '';

  const showCustom = (pfUniversity?.value === 'OTRA');
  if (pfCustomUniWrap) pfCustomUniWrap.classList.toggle('hidden', !showCustom);
  if (showCustom && pfCustomUniversity) {
    pfCustomUniversity.value = d?.customUniversity || '';
  }

  // Color favorito (con fallback + preview)
  const startColor = isValidHex(d?.favoriteColor) ? d.favoriteColor : '#22c55e';
  if (pfFavoriteColor) pfFavoriteColor.value = startColor;
  if (colorPrev) colorPrev.style.background = startColor;
  if (colorCode) colorCode.textContent = startColor.toUpperCase();

  // Poblar carrera en base a universidad actual
  populateCareers(pfUniversity?.value, d?.career || '');

  // CAMBIO: usar .onchange (no addEventListener) y null-safe
  if (pfUniversity) {
    pfUniversity.onchange = ()=>{
      const show = (pfUniversity.value === 'OTRA');
      if (pfCustomUniWrap) pfCustomUniWrap.classList.toggle('hidden', !show);
      if (!show && pfCustomUniversity) pfCustomUniversity.value = '';
      populateCareers(pfUniversity.value, null);
    };
  }

  // CAMBIO: evitar duplicar el listener del color
  if (pfFavoriteColor && !pfFavoriteColor.dataset.bound) {
    pfFavoriteColor.addEventListener('input', (e)=>{
      const val = e.target.value;
      if (isValidHex(val)){
        if (colorPrev) colorPrev.style.background = val;
        if (colorCode) colorCode.textContent = val.toUpperCase();
      }
    });
    pfFavoriteColor.dataset.bound = '1';
  }

const btnAvatar  = $('pfAvatarBtn');
const fileAvatar = $('pfAvatarFile');

// Renderizar avatar inicial (foto o emoji 👨‍🎓)
renderAvatarInCircle(d?.avatarData || "emoji:👨‍🎓");

// Crear o buscar botón de eliminar
let btnDelete = document.getElementById("pfDeleteAvatarBtn");
if (!btnDelete) {
  btnDelete = document.createElement("button");
  btnDelete.id = "pfDeleteAvatarBtn";
  btnDelete.className = "btn btn-secondary";
  btnDelete.textContent = "Eliminar foto de perfil";
  btnAvatar.insertAdjacentElement("afterend", btnDelete);
}

// Acciones
if (fileAvatar && !fileAvatar.dataset.bound) {
  fileAvatar.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      alert("Elige una imagen válida.");
      return;
    }

    try {
      const img = await readFileAsImage(f);
      const dataUrl = drawCompressed(img, 256, 0.82);
      renderAvatarInCircle(dataUrl);

      if (!state.currentUser) return;
      await updateDoc(doc(db, "users", state.currentUser.uid), {
        avatarData: dataUrl,
        avatarUpdatedAt: Date.now()
      });

      btnAvatar.textContent = "Avatar actualizado ✓";
      setTimeout(() => (btnAvatar.textContent = "Cambiar avatar"), 1500);
    } catch (err) {
      console.error(err);
      alert("No se pudo procesar la imagen.");
    } finally {
      e.target.value = "";
    }
  });
  fileAvatar.dataset.bound = "1";
}

// Acción para eliminar avatar y volver al emoji 👨‍🎓
if (!btnDelete.dataset.bound) {
  btnDelete.addEventListener("click", async () => {
    if (!state.currentUser) return;
    if (!confirm("¿Seguro que deseas eliminar tu foto de perfil?")) return;

    try {
      await updateDoc(doc(db, "users", state.currentUser.uid), {
        avatarData: null,
        avatarUrl: null,
        avatarUpdatedAt: Date.now()
      });

      renderAvatarInCircle("emoji:👨‍🎓");
      alert("Avatar eliminado. Se restauró el emoji predeterminado 👨‍🎓.");
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar el avatar.");
    }
  });
  btnDelete.dataset.bound = "1";
}





  if (fileAvatar && !fileAvatar.dataset.bound){
    fileAvatar.addEventListener('change', async (e)=>{
      const f = e.target.files?.[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { alert('Elige una imagen.'); return; }

      try {
        const img = await readFileAsImage(f);
        const dataUrl = drawCompressed(img, 256, 0.82);
        renderAvatarInCircle(dataUrl);

        if (!state.currentUser) return;
        await updateDoc(doc(db,'users',state.currentUser.uid), {
          avatarData: dataUrl,
          avatarUpdatedAt: Date.now()
        });

        if (btnAvatar){
          btnAvatar.textContent = 'Avatar actualizado ✓';
          setTimeout(()=> btnAvatar.textContent = 'Cambiar avatar', 1500);
        }
      } catch (err){
        console.error(err);
        alert('No se pudo procesar la imagen.');
      } finally {
        e.target.value = '';
      }
    });
    fileAvatar.dataset.bound = '1';
  }

  // CAMBIO: evita re-asignar onClick del botón Guardar en cada snapshot
  const saveBtn = $('pfSaveBtn');
  if (saveBtn && !saveBtn.dataset.bound){
    saveBtn.onclick = ()=> saveProfile();
    saveBtn.dataset.bound = '1';
  }
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

  const uniEl = $('pfUniversity') || $('uniSel');
  const careerSel = $('pfCareer') || $('careerSel');
  const favCol = $('pfFavoriteColor')?.value || null;
  const rawEmailUni = ( ($('pfEmailUni') || $('pfEmail'))?.value || '' ).trim();
  const rawPhone    = ( ($('pfPhone')    || $('pfTelefono'))?.value || '' ).trim();
  const uid = state.currentUser.uid;
  const uni = uniEl?.value || null;

  const emailOk = !rawEmailUni || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmailUni);
  if (!emailOk) { alert('Email universitario no es válido.'); return; }

  const phoneOk = !rawPhone || /^[+()\s0-9-]{6,}$/.test(rawPhone);
  if (!phoneOk) { alert('Teléfono no es válido.'); return; }

  const careerVal = (careerSel && CAREERS_BY_UNI[uni]?.some(x => x.value === careerSel.value))
    ? careerSel.value
    : null;

  const rawBdayIso = $('pfBirthday')?.value || null;
  const prevStored = state.profileData?.birthday || null;
  const safeBdayIso = normalizePickerToIso(rawBdayIso, prevStored);
  const typedName = $('pfName')?.value.trim() || null;

  const payload = {
    name: typedName,
    birthday: safeBdayIso ?? null,
    university: uni,
    customUniversity: (uni === 'OTRA' && $('pfCustomUniversity'))
      ? ($('pfCustomUniversity').value.trim() || null)
      : null,
    career: careerVal,
    favoriteColor: isValidHex(favCol) ? favCol : null,
    uniEmail: rawEmailUni || null,   // 👈 ahora usa uniEmail
    phone: rawPhone || null,
    updatedAt: Date.now()
  };

  // Guarda en Firestore
   await updateDoc(doc(db, "users", state.currentUser.uid), {
  avatarData: null,
  avatarUrl: null,
  avatarUpdatedAt: null
});


  // Guarda también en subdoc profile/profile
  const profRef = doc(db,'users',uid,'profile','profile');
  await setDoc(profRef, payload, { merge:true });

  // 🔹 Reflejo inmediato en el frontend
  state.profileData = { ...(state.profileData || {}), ...payload };

  const btn = document.getElementById('pfSaveBtn');
  if (btn) {
    const old = btn.textContent;
    btn.textContent = 'Guardado ✓';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = old;
      btn.disabled = false;
    }, 1800);
  }

  // Limpia "dirty" del date
  const bInp = document.getElementById('pfBirthday');
  if (bInp) delete bInp.dataset.dirty;
}


export function reflectProfileInSemestersUI(){
  const hasUni = !!(state.profileData && state.profileData.university &&
    (state.profileData.university !== 'OTRA' ||
     (state.profileData.university === 'OTRA' && state.profileData.customUniversity?.trim())));

  $('semNoticeNoUni')?.classList.toggle('hidden', hasUni);
  if ($('createSemesterBtn')) $('createSemesterBtn').disabled = !hasUni || !state.currentUser;
  if ($('semesterLabel')) $('semesterLabel').disabled = !hasUni;
  if ($('semesterUniFromProfile')) $('semesterUniFromProfile').value = hasUni ? readableUni(state.profileData) : '';
  if ($('createPairBtn')) $('createPairBtn').disabled = !state.currentUser;
}


/* ================= Helpers ================= */
function readableUni(d){
  if (!d || !d.university) return '';
  if (d.university === 'OTRA') return d.customUniversity || 'Otra';
  if (d.university === 'UMAYOR') return 'Universidad Mayor';
  if (d.university === 'USM') return 'UTFSM';
  return d.university;
}
function isValidHex(s){ return typeof s === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s); }
function formatDateDMY(iso){
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ================= Partner card =================
export function mountPartnerProfileCard() {
  const hostPage = $('page-perfil');
  if (!hostPage) return;

  let card = $('partnerProfileCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'partnerProfileCard';
    card.innerHTML = `
      <h3 style="margin-top:0">Perfil de la otra persona</h3>
      <div id="pp-avatar" style="width:64px;height:64px;border-radius:50%;
        background:#444;background-size:cover;background-position:center;margin-bottom:8px;"></div>
      <div id="pp-name"><b>Nombre:</b> —</div>
      <div id="pp-uni"><b>Universidad:</b> —</div>
      <div id="pp-career"><b>Carrera:</b> —</div>
      <div id="pp-bday" class="muted"><b>Nacimiento:</b> —</div>
      <div id="pp-color"><b>Color favorito:</b>
        <span id="pp-color-swatch"
          style="display:inline-block;width:16px;height:16px;border-radius:4px;vertical-align:middle;margin:0 6px;background:#ff69b4;border:1px solid rgba(255,255,255,.25)">
        </span>
        <span id="pp-color-code">—</span>
      </div>
      <div id="pp-email"><b>Email universitario:</b> —</div>
      <div id="pp-phone"><b>Teléfono:</b> —</div>
    `;
    card.classList.add('hidden');
    hostPage.appendChild(card);
  }

  const clearUI = () => {
    $('pp-name').innerHTML = `<b>Nombre:</b> —`;
    $('pp-uni').innerHTML = `<b>Universidad:</b> —`;
    $('pp-career').innerHTML = `<b>Carrera:</b> —`;
    $('pp-bday').innerHTML = `<b>Fecha de nacimiento:</b> —`;
    $('pp-email').innerHTML = `<b>Email universitario:</b> —`;
    $('pp-phone').innerHTML = `<b>Teléfono:</b> —`;
    $('pp-color-code').textContent = '—';
    const sw = $('pp-color-swatch');
    if (sw) {
      sw.style.background = 'transparent';
      sw.style.border = '1px solid rgba(255,255,255,.25)';
    }
  };

  if (unsubPartner) { unsubPartner(); unsubPartner = null; }

  if (!state.pairOtherUid) {
    clearUI();
    if (card) card.classList.add('hidden');
    return;
  }

  const refRoot = doc(db, 'users', state.pairOtherUid);
  const refProf = doc(db, 'users', state.pairOtherUid, 'profile', 'profile');
  card.classList.remove('hidden');

  let latestRoot = null, latestProf = null;

  const mergeAndRender = () => {
    const d = { ...(latestRoot?.data() || {}), ...(latestProf?.data() || {}) };
    const pav = $('pp-avatar');
    if (pav) {
      if (d.avatarData) {
        pav.style.backgroundImage = `url("${d.avatarData}")`;
        pav.textContent = '';
      } else {
        pav.style.backgroundImage = 'none';
        pav.textContent = '👨‍🎓';
        pav.style.display = 'flex';
        pav.style.alignItems = 'center';
        pav.style.justifyContent = 'center';
        pav.style.fontSize = '2rem';
      }
    }

    $('pp-name').innerHTML = `<b>Nombre:</b> ${d.name || '—'}`;
    $('pp-uni').innerHTML = `<b>Universidad:</b> ${readUni(d)}`;
    $('pp-career').innerHTML = `<b>Carrera:</b> ${
      d.career ? (d.career === 'ICTEL' ? 'Ing. Civil Telemática' : 'Medicina Veterinaria') : '—'
    }`;
    $('pp-bday').innerHTML = `<b>Fecha de nacimiento:</b> ${prettyDMY(d.birthday)}`;
    $('pp-email').innerHTML = `<b>Email universitario:</b> ${d.uniEmail || '—'}`;
    $('pp-phone').innerHTML = `<b>Teléfono:</b> ${d.phone || '—'}`;

    const col =
      typeof d.favoriteColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(d.favoriteColor)
        ? d.favoriteColor
        : '#ff69b4';
    const sw = $('pp-color-swatch');
    if (sw) sw.style.background = col;
    const cc = $('pp-color-code');
    if (cc) cc.textContent = col.toUpperCase();
  };

  const prettyDMY = (iso) => {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  const readUni = (d) => {
    if (!d?.university) return '—';
    if (d.university === 'UMAYOR') return 'Universidad Mayor';
    if (d.university === 'USM') return 'UTFSM';
    if (d.university === 'OTRA') return d.customUniversity || 'Otra';
    return d.university;
  };

  const unsubRoot = onSnapshot(refRoot, (snap) => {
    latestRoot = snap;
    mergeAndRender();
  });
  const unsubProf = onSnapshot(refProf, (snap) => {
    latestProf = snap;
    mergeAndRender();
  });

  unsubPartner = () => { unsubRoot(); unsubProf(); };
}


document.addEventListener('pair:ready', () => {
  mountPartnerProfileCard();
});

// Inicialización ligera para que Universidad → Carrera funcione sin login
export function ensureCareerBindingOnLoad(){
  const uni = document.getElementById('pfUniversity') || document.getElementById('uniSel');
  const car = document.getElementById('pfCareer') || document.getElementById('careerSel');
  if (!uni || !car) return;

  const apply = () => {
    const map = CAREERS_BY_UNI[uni.value] || [];
    car.innerHTML = '<option value="">Selecciona tu carrera…</option>';
    for (const {value,label} of map){
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      car.appendChild(o);
    }
    car.disabled = (map.length === 0);
  };

  uni.addEventListener('change', apply);
  apply();
}

