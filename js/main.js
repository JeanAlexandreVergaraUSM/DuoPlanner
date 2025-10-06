// js/main.js
import './firebase.js';
import './malla.js';
import { bindExportButtons } from './export.js';
import { initProgreso, refreshProgreso } from './progreso.js';
import { initGrades, onActiveSemesterChanged as gradesOnSem, onCoursesChanged as gradesOnCourses } from './grades.js';
import { initCalendar, onActiveSemesterChanged as calOnSem, onCoursesChanged as calOnCourses } from './calendar.js';
import { initRouter } from './router.js';
import { initAuth } from './auth.js';
import { initPair } from './pair.js';
import { initSemesters } from './semesters.js';
import { initCourses } from './courses.js';
import { initSchedule, onActiveSemesterChanged as schedOnSem } from './schedule.js';
import { ensureCareerBindingOnLoad } from './profile.js';
import { initAttendance } from './attendance.js';

window.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initRouter();
  initPair();
  initSemesters();
  initCourses();
  initSchedule();
  initGrades();
  initCalendar();
  initProgreso();
  bindExportButtons();

  ensureCareerBindingOnLoad();

  // 👇 Enganchar attendance al entrar en la pestaña
  document.addEventListener('route:change', (e) => {
    if (e.detail.route === '#/asistencia') {
      initAttendance();
    }
  });
});


// Notificadores
export function notifyActiveSemesterChangedAll(){
  schedOnSem?.(); gradesOnSem?.(); calOnSem?.(); refreshProgreso?.(); 
}
export function notifyCoursesChangedAll(){
  gradesOnCourses?.(); calOnCourses?.();refreshProgreso?.();
}
