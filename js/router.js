// js/router.js
import { $ } from './state.js';

let pages = {};
let navTabs = [];

function normalizeRoute(hash) {
  const r = (hash || '#/perfil').trim();
  const allowed = new Set(['#/perfil', '#/semestres', '#/horario', '#/notas', '#/malla', '#/calendario']);
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

  // Tabs activos/inactivos
  navTabs.forEach(t => t.classList.toggle('active', t.dataset.route === r));

  // Ocultar todas las páginas (si existen)
  Object.values(pages).forEach(p => p && p.classList.add('hidden'));

  // Mostrar la correcta (si existe)
  if (r === '#/perfil'     && pages.perfil)     pages.perfil.classList.remove('hidden');
  if (r === '#/semestres'  && pages.semestres)  pages.semestres.classList.remove('hidden');
  if (r === '#/horario'    && pages.horario)    pages.horario.classList.remove('hidden');
  if (r === '#/notas'      && pages.notas)      pages.notas.classList.remove('hidden');
  if (r === '#/malla'      && pages.malla)      pages.malla.classList.remove('hidden');
  if (r === '#/calendario' && pages.calendario) {
    pages.calendario.classList.remove('hidden');
    document.dispatchEvent(new Event('route:calendario'));
  }

  // Aviso general por si otros módulos necesitan saber
  document.dispatchEvent(new CustomEvent('route:change', { detail: { route: r } }));
}

export function initRouter() {
  // Resolver nodos AQUÍ (cuando ya está el DOM)
  pages = {
    perfil: $('page-perfil'),
    semestres: $('page-semestres'),
    horario: $('page-horario'),
    notas: $('page-notas'),
    malla: $('page-malla'),
    calendario: $('page-calendario'),
  };

  navTabs = Array.from(document.querySelectorAll('.tab[data-route]')) || [];

  // Click en tabs
  navTabs.forEach(t => t.addEventListener('click', () => navigate(t.dataset.route)));

  // Cambios de hash
  window.addEventListener('hashchange', () => setActiveTab(location.hash));

  // Primera activación
  setActiveTab(location.hash || '#/perfil');
}
