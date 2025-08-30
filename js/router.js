// js/router.js
import { $, state } from './state.js';

const pages = {
  perfil: $('page-perfil'),
  semestres: $('page-semestres'),
  horario: $('page-horario'),
  notas: $('page-notas'),
  malla: $('page-malla'),
  calendario: $('page-calendario'),
};

// ⬇️ Solo tabs con data-route (barra superior)
const navTabs = Array.from(document.querySelectorAll('.tab[data-route]'));

export function navigate(route){ location.hash = route; setActiveTab(route); }

export function setActiveTab(route){
  navTabs.forEach(t=> t.classList.toggle('active', t.dataset.route === route));
  Object.values(pages).forEach(p=> p.classList.add('hidden'));
  const r = route || '#/perfil';
  if (r==='#/perfil') pages.perfil.classList.remove('hidden');
  if (r==='#/semestres') pages.semestres.classList.remove('hidden');
  if (r==='#/horario') pages.horario.classList.remove('hidden');
  if (r==='#/notas') pages.notas.classList.remove('hidden');
  if (r==='#/malla') pages.malla.classList.remove('hidden');
  if (r==='#/calendario') {
    pages.calendario.classList.remove('hidden');
    document.dispatchEvent(new Event('route:calendario'));
  }
}

export function initRouter(){
  navTabs.forEach(t=> t.addEventListener('click', ()=> navigate(t.dataset.route)));
  window.addEventListener('hashchange', ()=> setActiveTab(location.hash || '#/perfil'));
  setActiveTab(location.hash || '#/perfil');
}
