// js/main.js
// Inicializa Firebase por side-effect (no necesitas llamar nada)
// ✅ main.js (al principio)
import './firebase.js';
import { initGrades, onActiveSemesterChanged as gradesOnSem, onCoursesChanged as gradesOnCourses } from './grades.js';
import { initCalendar, onActiveSemesterChanged as calOnSem, onCoursesChanged as calOnCourses } from './calendar.js';
import { initRouter } from './router.js';
import { initAuth } from './auth.js';
import { initPair } from './pair.js';
import { initSemesters } from './semesters.js';
import { initCourses } from './courses.js';
import { initSchedule, onActiveSemesterChanged as schedOnSem } from './schedule.js';
import { state, $, updateDebug } from './state.js';


window.addEventListener('DOMContentLoaded', () => {
  // Muestra la tarjeta de debug si estás en localhost y usas ?debug
  if (state.DEBUG) {
    const d = $('debugCard');
    if (d) d.classList.remove('hidden');
  }

  

  initRouter();
  initAuth();        // ← registra el click del botón "Iniciar sesión"
  initPair();
  initSemesters();
  initCourses();
  initSchedule();
  initGrades();
  initCalendar();

  updateDebug();
});

export function notifyActiveSemesterChangedAll(){
  schedOnSem?.();
  gradesOnSem?.();
  calOnSem?.();                // ⬅️ calendario
}

export function notifyCoursesChangedAll(){
  gradesOnCourses?.();
  calOnCourses?.();
  // (gradesOnCourses ya lo hace main → grades)
}
