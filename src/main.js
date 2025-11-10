// js/main.js
import './styles.css';
import './firebase.js';
import { initAuth } from './auth.js';
import { initRouter } from './router.js';
import { initPair } from './pair.js';
import { initSemesters } from './semesters.js';

window.addEventListener('DOMContentLoaded', () => {
  // 🔹 Inicialización básica inmediata
  initAuth();
  initRouter();
  initPair();
  initSemesters();

  // 🔹 Carga perezosa (solo cuando se entra a la ruta correspondiente)
  document.addEventListener('route:change', async (e) => {
    const route = e.detail.route;

    if (route.startsWith('#/notas')) {
      const m = await import('./grades.js');
      m.initGrades?.();
    } 
    else if (route.startsWith('#/malla')) {
      const m = await import('./malla.js');
      m.initMallaOnRoute?.();
    } 
    else if (route.startsWith('#/asistencia')) {
      const m = await import('./attendance.js');
      m.initAttendance?.();
    } 
    else if (route.startsWith('#/horario')) {
      const m = await import('./schedule.js');
      m.initSchedule?.();
    } 
    else if (route.startsWith('#/calendario')) {
      const m = await import('./calendar.js');
      m.initCalendar?.();
    } 
    else if (route.startsWith('#/progreso')) {
      const m = await import('./progreso.js');
      m.initProgreso?.();
    }
  });
});


// ✅ Mantén estas dos funciones al final
import { onActiveSemesterChanged as gradesOnSem, onCoursesChanged as gradesOnCourses } from './grades.js';
import { onActiveSemesterChanged as calOnSem, onCoursesChanged as calOnCourses } from './calendar.js';
import { onActiveSemesterChanged as schedOnSem } from './schedule.js';
import { refreshProgreso } from './progreso.js';

export function notifyActiveSemesterChangedAll() {
  schedOnSem?.();
  gradesOnSem?.();
  calOnSem?.();
  refreshProgreso?.();
}

export function notifyCoursesChangedAll() {
  gradesOnCourses?.();
  calOnCourses?.();
  refreshProgreso?.();
}
