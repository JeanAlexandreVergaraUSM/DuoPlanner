// js/router.js
import { $ } from './state.js';

let pages = {};
let navTabs = [];

function normalizeRoute(hash) {
  const r = (hash || '#/perfil').trim();
  const allowed = new Set([
    '#/perfil',
    '#/semestres',
    '#/horario',
    '#/notas',
    '#/malla',
    '#/calendario',
    '#/progreso',
    '#/asistencia',
    '#/party',
    '#/ayuda'
  ]);
  return allowed.has(r) ? r : '#/perfil';
}



export function navigate(route) {
  const r = normalizeRoute(route);
  if (location.hash !== r) location.hash = r;
  setActiveTab(r);
}

export function setActiveTab(route) {
  const r = normalizeRoute(route);

  const pfBar = document.getElementById('pfActions');
if (pfBar) pfBar.classList.toggle('hidden', r !== '#/perfil');

  navTabs.forEach(t => t.classList.toggle('active', t.dataset.route === r));

  Object.values(pages).forEach(p => p && p.classList.add('hidden'));

  if (r === '#/perfil'     && pages.perfil)     pages.perfil.classList.remove('hidden');
  if (r === '#/semestres'  && pages.semestres)  pages.semestres.classList.remove('hidden');
  if (r === '#/horario'    && pages.horario)    pages.horario.classList.remove('hidden');
  if (r === '#/notas' && pages.notas) {
  pages.notas.classList.remove('hidden');
  document.dispatchEvent(new Event('route:notas')); 
}

  if (r === '#/malla'      && pages.malla)      pages.malla.classList.remove('hidden');
  if (r === '#/progreso'   && pages.progreso)   pages.progreso.classList.remove('hidden');
  if (r === '#/calendario' && pages.calendario) {
    pages.calendario.classList.remove('hidden');
    document.dispatchEvent(new Event('route:calendario'));
  }
  if (r === '#/asistencia' && pages.asistencia) 
  pages.asistencia.classList.remove('hidden');
if (r === '#/party' && pages.party) pages.party.classList.remove('hidden');
if (r === '#/ayuda' && pages.ayuda) pages.ayuda.classList.remove('hidden'); // ✅ agregado




  document.dispatchEvent(new CustomEvent('route:change', { detail: { route: r } }));
}

export function initRouter() {
  pages = {
  perfil: $('page-perfil'),
  semestres: $('page-semestres'),
  horario: $('page-horario'),
  notas: $('page-notas'),
  malla: $('page-malla'),
  calendario: $('page-calendario'),
  progreso: $('page-progreso'),
  asistencia: $('page-asistencia'),
  party: $('page-party'),
  ayuda: $('page-ayuda')  
};


  navTabs = Array.from(document.querySelectorAll('.tab[data-route]')) || [];

  navTabs.forEach(t => t.addEventListener('click', () => navigate(t.dataset.route)));

  window.addEventListener('hashchange', () => setActiveTab(location.hash));

  setActiveTab(location.hash || '#/perfil');
}
