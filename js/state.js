// js/state.js
export const state = {
  currentUser: null,
  currentPairId: null,
  profileData: null,

  activeSemesterId: null,
  activeSemesterData: null,

  unsubscribeCourses: null,
  editingCourseId: null,

  // UID de la pareja (no tú)
  pairOtherUid: null,

  // Estado para vistas compartidas (horario / notas / malla / calendario)
  shared: {
    horario:  { semId: null },
    notas:    { semId: null},
    malla:    { enabled: false },
    calendar: { semId: null }
  },

  // Debug: localhost con ?debug o bandera global window.duoplannerDebug
  DEBUG:
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
    (new URLSearchParams(location.search).has('debug') || (window?.duoplannerDebug ?? false)),
};

// DOM helpers
export const $   = (id) => (typeof id === 'string' ? document.getElementById(id) : null);
export const qs  = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const setText = (id, text = '') => { const el = $(id); if (el) el.textContent = text; return el; };

// Debug renderer
export function updateDebug() {
  if (!state.DEBUG) return;
  const el = $('state');
  if (!el) return;
  el.textContent = JSON.stringify({
    uid: state.currentUser?.uid || null,
    pairId: state.currentPairId,
    pairOtherUid: state.pairOtherUid || null,
    profileData: state.profileData,
    activeSemesterId: state.activeSemesterId,
    editingCourseId: state.editingCourseId
  }, null, 2);
}

// UI helpers
export function setHidden(el, hidden) {
  if (!el) return;
  hidden ? el.classList.add('hidden') : el.classList.remove('hidden');
}
export function confirmYes(msg) { return window.confirm(msg); }

