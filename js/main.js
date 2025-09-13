// js/main.js
import './firebase.js';
import './malla.js';

import { initGrades, onActiveSemesterChanged as gradesOnSem, onCoursesChanged as gradesOnCourses } from './grades.js';
import { initCalendar, onActiveSemesterChanged as calOnSem, onCoursesChanged as calOnCourses } from './calendar.js';
import { initRouter } from './router.js';
import { initAuth } from './auth.js';
import { initPair } from './pair.js';
import { initSemesters } from './semesters.js';
import { initCourses } from './courses.js';
import { initSchedule, onActiveSemesterChanged as schedOnSem } from './schedule.js';
import { ensureCareerBindingOnLoad } from './profile.js';

window.addEventListener('DOMContentLoaded', () => {
  initRouter();
  initAuth();

  initPair();
  initSemesters();
  initCourses();
  initSchedule();
  initGrades();
  initCalendar();

  ensureCareerBindingOnLoad();
});

// Notificadores
export function notifyActiveSemesterChangedAll(){
  schedOnSem?.(); gradesOnSem?.(); calOnSem?.();
}
export function notifyCoursesChangedAll(){
  gradesOnCourses?.(); calOnCourses?.();
}
