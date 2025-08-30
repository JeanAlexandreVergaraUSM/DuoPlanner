<<<<<<< HEAD
// js/state.js
export const state = {
  currentUser: null,
  currentPairId: null,
  profileData: null,
  activeSemesterId: null,
  activeSemesterData: null,
  unsubscribeCourses: null,
  editingCourseId: null,
  // 🔹 NUEVO: UID de la pareja (no tú)
  pairOtherUid: null,
  // 🔹 NUEVO: estado para vistas compartidas (horario / notas / malla)
  shared: {
    horario: { semId: null },
    notas:   { semId: null, courseId: null },
    malla:   { enabled: false }
  },
  DEBUG: (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).has('debug'),
};

export const $ = (id)=>document.getElementById(id);

export function updateDebug() {
  if (!state.DEBUG) return;
  const el = $('state');
  if (!el) return;
  el.textContent = JSON.stringify({
    uid: state.currentUser?.uid || null,
    pairId: state.currentPairId,
    // 🔹 NUEVO: mostrar el UID de la pareja en debug
    pairOtherUid: state.pairOtherUid || null,
    profileData: state.profileData,
    activeSemesterId: state.activeSemesterId,
    editingCourseId: state.editingCourseId
  }, null, 2);
}

// UI helpers
export function setHidden(el, hidden){ hidden ? el.classList.add('hidden') : el.classList.remove('hidden'); }
export function confirmYes(msg){ return window.confirm(msg); }
=======
// js/state.js
export const state = {
  currentUser: null,
  currentPairId: null,
  profileData: null,
  activeSemesterId: null,
  activeSemesterData: null,
  unsubscribeCourses: null,
  editingCourseId: null,
  // 🔹 NUEVO: UID de la pareja (no tú)
  pairOtherUid: null,
  // 🔹 NUEVO: estado para vistas compartidas (horario / notas / malla)
  shared: {
    horario: { semId: null },
    notas:   { semId: null, courseId: null },
    malla:   { enabled: false }
  },
  DEBUG: (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).has('debug'),
};

export const $ = (id)=>document.getElementById(id);

export function updateDebug() {
  if (!state.DEBUG) return;
  const el = $('state');
  if (!el) return;
  el.textContent = JSON.stringify({
    uid: state.currentUser?.uid || null,
    pairId: state.currentPairId,
    // 🔹 NUEVO: mostrar el UID de la pareja en debug
    pairOtherUid: state.pairOtherUid || null,
    profileData: state.profileData,
    activeSemesterId: state.activeSemesterId,
    editingCourseId: state.editingCourseId
  }, null, 2);
}

// UI helpers
export function setHidden(el, hidden){ hidden ? el.classList.add('hidden') : el.classList.remove('hidden'); }
export function confirmYes(msg){ return window.confirm(msg); }
>>>>>>> ac80da7fc6057294d6be21cbc9b7893a61a95aa4
