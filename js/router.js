<<<<<<< HEAD
// js/router.js
import { $, state } from './state.js';

const pages = {
  perfil: $('page-perfil'),
  semestres: $('page-semestres'),
  horario: $('page-horario'),
  notas: $('page-notas'),
  malla: $('page-malla'),
};
const tabs = Array.from(document.querySelectorAll('.tab'));

export function navigate(route){ location.hash = route; setActiveTab(route); }

export function setActiveTab(route){
  tabs.forEach(t=> t.classList.toggle('active', t.dataset.route === route));
  Object.values(pages).forEach(p=> p.classList.add('hidden'));
  const r = route || '#/perfil';
  if (r==='#/perfil') pages.perfil.classList.remove('hidden');
  if (r==='#/semestres') pages.semestres.classList.remove('hidden');
  if (r==='#/horario') pages.horario.classList.remove('hidden');
  if (r==='#/notas') pages.notas.classList.remove('hidden');
  if (r==='#/malla') pages.malla.classList.remove('hidden');
}

export function initRouter(){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach(t=> t.addEventListener('click', ()=> navigate(t.dataset.route)));
  window.addEventListener('hashchange', ()=> setActiveTab(location.hash || '#/perfil'));
  setActiveTab(location.hash || '#/perfil');
}
=======
// js/router.js
import { $, state } from './state.js';

const pages = {
  perfil: $('page-perfil'),
  semestres: $('page-semestres'),
  horario: $('page-horario'),
  notas: $('page-notas'),
  malla: $('page-malla'),
};
const tabs = Array.from(document.querySelectorAll('.tab'));

export function navigate(route){ location.hash = route; setActiveTab(route); }

export function setActiveTab(route){
  tabs.forEach(t=> t.classList.toggle('active', t.dataset.route === route));
  Object.values(pages).forEach(p=> p.classList.add('hidden'));
  const r = route || '#/perfil';
  if (r==='#/perfil') pages.perfil.classList.remove('hidden');
  if (r==='#/semestres') pages.semestres.classList.remove('hidden');
  if (r==='#/horario') pages.horario.classList.remove('hidden');
  if (r==='#/notas') pages.notas.classList.remove('hidden');
  if (r==='#/malla') pages.malla.classList.remove('hidden');
}

export function initRouter(){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach(t=> t.addEventListener('click', ()=> navigate(t.dataset.route)));
  window.addEventListener('hashchange', ()=> setActiveTab(location.hash || '#/perfil'));
  setActiveTab(location.hash || '#/perfil');
}
>>>>>>> ac80da7fc6057294d6be21cbc9b7893a61a95aa4
