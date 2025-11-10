// ai/router.js
// Detección simple de intención + extracción de slots (parámetros).
// Está pensada para español y para tus pestañas actuales.

const DAYS_RX = /(lunes|martes|mi[eé]rcoles|jueves|viernes)/i;

export function detectIntent(text, route = '#/') {
  const q = norm(text);

  // Cuenta
  if (q.match(/(conectad|cuenta|sesion|sesión|login|iniciar)/)) return 'auth_status';
  if (q.match(/(cerrar sesi[óo]n|salir)/)) return 'auth_logout';
  if (q.match(/(cambiar cuenta)/)) return 'auth_switch';
  if (q.match(/(ingresar|iniciar sesi[óo]n)/)) return 'auth_login';

  // Semestre
  if (q.includes('listar mis semestres')) return 'sem_list';
  if (q.match(/(crear semestre|nuevo semestre)/)) return 'sem_create';
  if (q.match(/(borrar semestre|eliminar semestre)/)) return 'sem_delete';
  if (q.match(/(activar semestre)/)) return 'sem_activate';
  if (q.match(/(cambiar nombre|renombrar semestre|cambiar etiqueta)/)) return 'sem_rename';
  if (q.match(/(informaci[óo]n del semestre|info del semestre)/)) return 'sem_summary';
  if (q.match(/(cu[aá]ntos ramos tengo este semestre)/)) return 'sem_count_courses';

  // Party / Duo
  if (q.match(/(qu[ié]n es mi duo|quien es mi duo)/)) return 'pair_whois';
  if (q.match(/(crear nuevo c[oó]digo de party)/)) return 'pair_create';
  if (q.match(/(unirse a una party|c[oó]digo de party|clase para unirse)/)) return 'pair_join';
  if (q.match(/(cerrar party|salir de la party|cerrar duo)/)) return 'pair_close';

  // Cursos / Notas
    if (q.match(/(que notas tengo|listar notas|mis notas).*(prueba|examen|laboratorio|tarea)/)) 
    return 'grades_list';
  if (q.match(/(listar ramos del semestre activo)/)) return 'course_list';
  if (q.match(/(agregar ramo|añadir ramo)/)) return 'course_add';
  if (q.match(/(eliminar ramo|borrar ramo)/)) return 'course_remove';
  if (q.match(/(informaci[óo]n del ramo|info del ramo)/)) return 'course_info';
  if (q.match(/(listar todas las reglas)/)) return 'rules_list';
  if (q.match(/(añadir regla|agregar regla)/)) return 'rules_add';
  if (q.match(/(eliminar regla|borrar regla)/)) return 'rules_remove';
  if (q.match(/(con qu[eé] nota apruebo)/)) return 'grade_needed';
  if (q.match(/(estoy aprobando)/)) return 'grade_pass_status';
  if (q.match(/(cu[aá]nta nota me falta)/)) return 'grade_gap';
  if (q.match(/(promedio.*semestre)/)) return 'grade_sem_avg';
  if (q.match(/(mejor.*peor ramo|peor.*mejor ramo)/)) return 'grade_best_worst';
  if (q.match(/(exportar mis notas)/)) return 'export_grades';
  if (q.match(/(agregar nota|añadir nota)/)) return 'grade_add';
if (q.match(/(listar notas|ver notas)/)) return 'grades_list';


  // Horario
  if (q.match(/(ver mi horario completo)/)) return 'sched_view';
  if (q.match(/(tengo clases el)/) || (DAYS_RX.test(q) && q.includes('clases'))) return 'sched_has_classes';
  if (q.match(/(primer\s*ramo|[uú]ltimo\s*ramo).*d[ií]a/)) return 'sched_first_last';
  if (q.match(/(a qu[eé] hora salgo.*d[ií]a)/)) return 'sched_end_time';
  if (q.match(/(cu[aá]ntas clases tengo.*d[ií]a)/)) return 'sched_count_day';
  if (q.match(/(horas efectivas.*semana)/)) return 'sched_total_hours_week';
  if (q.match(/(se cruza.*con)/)) return 'sched_check_conflict';
  if (q.match(/(sugerir bloque libre|bloques libres en com[uú]n)/)) return 'sched_suggest_free';
  if (q.match(/(ventanas.*d[ií]a)/)) return 'sched_gaps_day';
  if (q.match(/(cambiar sala)/)) return 'sched_set_room';
  if (q.match(/(en qu[eé] sala me toca)/)) return 'sched_get_room';
  if (q.match(/(en qu[eé] ramos coincidimos.*horario)/)) return 'sched_overlap_pair';
  if (q.match(/(descargar mi horario)/)) return 'export_schedule';

  // Malla / Progreso
  if (q.match(/(qu[eé] me falta para tomar)/)) return 'curr_prereqs';
  if (q.match(/(en qu[eé] a[nñ]o.*se toma)/)) return 'curr_when_taken';
  if (q.match(/(ya aprobe|ya aprobé)/)) return 'curr_is_approved';
  if (q.match(/(cu[aá]ntos ramos llevo aprobados|avance de malla)/)) return 'curr_progress';
  if (q.match(/(qu[eé] ramos me faltan de)/)) return 'curr_missing_by_area';
  if (q.match(/(simular avance.*con)/)) return 'curr_simulate_adv';
  if (q.match(/(en qu[eé] nivel.*vamos juntos)/)) return 'curr_pair_level';
  if (q.match(/(descargar mi malla)/)) return 'export_malla';

  // Calendario
  if (q.match(/(crear recordatorio|rec[uú]erdame|recu[eé]rdame)/)) return 'cal_create';
  if (q.match(/(eliminar recordatorio|borrar recordatorio)/)) return 'cal_delete';
  if (q.match(/(cambiar.*recordatorio|actualizar.*recordatorio)/)) return 'cal_update';
  if (q.match(/(qu[eé] recordatorios tengo.*hoy|semana|mes)/)) return 'cal_list';
  if (q.match(/(silenciar|pausar recordatorio)/)) return 'cal_suspend';
  if (q.match(/(recordatorios compartidos|con mi duo)/)) return 'cal_list_pair';
  if (q.match(/(reactivar recordatorio|reanudar recordatorio|activar recordatorio)/)) 
  return 'cal_resume';

if (q.match(/(recordatorios suspendidos|recordatorios pausados|recordatorios detenidos)/)) 
  return 'cal_list_suspended';

if (/universidad/i.test(text) && /(estoy|inscrito|mi)/i.test(text)) {
  return { intent: 'perfil_uni' };
}


  return 'unknown';
}

export function extractSlots(text, intent) {
  const raw = text || '';
  const q = norm(raw);
  const day = (q.match(DAYS_RX) || [])[0];

  // Heurísticas simples
  switch (intent) {
    case 'sched_has_classes':
    case 'sched_gaps_day':
    case 'sched_end_time':
    case 'sched_count_day':

        case 'sched_set_room': {
      // Extraer curso
      const courseMatch = raw.match(/sala de ([^ ]+(?: [^ ]+)?)/i);
      const course = courseMatch ? courseMatch[1].trim() : null;

      // Día
      const day = (q.match(DAYS_RX) || [])[0];

      // Slot (ej. "bloque 3")
      const slotMatch = raw.match(/bloque\s*(\d+)/i);
      const slot = slotMatch ? parseInt(slotMatch[1], 10) : null;

      // Sala (ej. "sala A23" o "aula 105")
      const roomMatch = raw.match(/sala\s*([A-Za-z0-9]+)/i) || raw.match(/aula\s*([A-Za-z0-9]+)/i);
      const room = roomMatch ? roomMatch[1] : null;

      return { course, day, slot, room };
    }

    case 'sched_overlap_pair': {
      // No requiere slots, solo ejecuta
      return {};
    }

        case 'grades_list':
      return { course: guessCourse(raw), rule: raw.match(/(prueba|examen|laboratorio|tarea)/i)?.[0] || null };


    case 'sched_first_last':
      return { day };

    case 'sched_check_conflict': {
      // “…se cruza X con Y…”
      const m = q.replace('se cruza', '').split('con').map(s => s.trim()).filter(Boolean);
      return { courseA: m[0]?.toUpperCase(), courseB: m[1]?.toUpperCase() };
    }

    case 'grade_add': {
  // ejemplo: "Agregar nota 6.5 al examen de Matemáticas II con comentario Recuperativa"
  const valMatch = q.match(/nota\s+([\d.,]+)/);
  const valor = valMatch ? parseFloat(valMatch[1].replace(',', '.')) : null;
  const rule = (q.match(/al\s+([a-záéíóú]+)/) || [])[1];
  const comment = (q.match(/comentario\s+(.+)/) || [])[1] || '';
  return {
    course: guessCourse(raw),
    rule,
    valor,
    comentario: comment
  };
}


    case 'grade_needed':
    case 'grade_pass_status':
    case 'grade_gap':
    case 'course_info':
    case 'rules_list':
    case 'rules_add':
    case 'rules_remove':
    case 'curr_prereqs':
    case 'curr_when_taken':
    case 'curr_is_approved':
      return { course: guessCourse(raw) };

    case 'export_grades': {
      const format = q.includes('pdf') ? 'pdf' : q.includes('png') ? 'png' : 'pdf';
      if (q.includes('semestre actual')) return { scope:'actual', format };
      if (q.includes('desde el comienzo') || q.includes('todo')) return { scope:'todo', format };
      return { scope:'ramo', course: guessCourse(raw), format };
    }

    case 'export_schedule':
      return { format: q.includes('pdf') ? 'pdf' : 'png' };

    case 'export_malla':
      return { format: q.includes('pdf') ? 'pdf' : 'png' };

        case 'cal_create': {
      // Detectar día (lunes, martes…)
      const day = (q.match(DAYS_RX) || [])[0];

      // Detectar hora tipo "15:00" o "9:30" o "18.45"
      const hm = q.match(/(\d{1,2}[:.]\d{2}|\d{1,2}[.]\d{2})/);

      let datetime = null;
      if (day && hm) {
        // Normalizar hora
        const [hh, mm] = hm[0].replace('.',':').split(':').map(Number);

        // Crear fecha base desde hoy
        const now = new Date();
        const target = new Date(now);
        target.setHours(hh, mm, 0, 0);

        // Buscar el próximo día que coincida
        const daysMap = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
        const dayIdx = daysMap.findIndex(d => d.startsWith(day.toLowerCase()));
        if (dayIdx >= 0) {
          while (target.getDay() !== dayIdx) {
            target.setDate(target.getDate() + 1);
          }
          datetime = target.toISOString();
        }
      }

      // Título = texto sin "recuérdame" + sin día + sin hora
      const title = raw
        .replace(/recu[eé]rdame/i, '')
        .replace(DAYS_RX, '')
        .replace(hm?.[0] || '', '')
        .trim();

      return { title, datetime };
    }

        case 'cal_update': {
      // Detectar día (lunes, martes…)
      const day = (q.match(DAYS_RX) || [])[0];

      // Detectar hora tipo "15:00" o "9:30" o "18.45"
      const hm = q.match(/(\d{1,2}[:.]\d{2}|\d{1,2}[.]\d{2})/);

      let datetime = null;
      if (day && hm) {
        const [hh, mm] = hm[0].replace('.',':').split(':').map(Number);
        const now = new Date();
        const target = new Date(now);
        target.setHours(hh, mm, 0, 0);

        const daysMap = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
        const dayIdx = daysMap.findIndex(d => d.startsWith(day.toLowerCase()));
        if (dayIdx >= 0) {
          while (target.getDay() !== dayIdx) {
            target.setDate(target.getDate() + 1);
          }
          datetime = target.toISOString();
        }
      }

      // Extraer título = lo que sigue a "recordatorio de ..."
      const titleMatch = raw.match(/recordatorio de ([^ ]+)/i);
      const title = titleMatch ? titleMatch[1] : null;

      if (datetime) {
        return { title, datetime, field: 'datetime', value: datetime };
      }
      return { title };
    }

        case 'cal_delete': {
      // Extraer título del recordatorio
      const titleMatch = raw.match(/recordatorio de (.+)/i);
      const title = titleMatch ? titleMatch[1].trim() : null;

      return { title };
    }


    case 'cal_list':
      return { range: q.includes('semana') ? 'week' : q.includes('mes') ? 'month' : 'today' };

    default:
      return {};
  }
}

export function chipsForRoute(route = '#/') {
  if (route.startsWith('#/perfil')) return [
    '¿Con qué cuenta estoy conectado?', 'Cambiar cuenta de Google', 'Cerrar sesión de Google'
  ];
  if (route.startsWith('#/semestres')) return [
    'Listar mis semestres', 'Crear semestre 2025-2', 'Activar semestre 2025-2'
  ];
  if (route.startsWith('#/horario')) return [
    '¿Tengo clases el martes?', '¿Se cruza Redes I con Matemáticas II?', '¿A qué hora salgo el jueves?'
  ];
  if (route.startsWith('#/notas')) return [
    '¿Con qué nota apruebo Señales?', '¿Cuál es mi promedio en este semestre?', 'Exportar mis notas del semestre actual'
  ];
  if (route.startsWith('#/malla') || route.startsWith('#/progreso')) return [
    '¿Qué me falta para tomar Redes II?', '¿Cuántos ramos llevo aprobados?'
  ];
  if (route.startsWith('#/calendario')) return [
    'Recuérdame estudio martes 15:00', '¿Qué recordatorios tengo esta semana?'
  ];
  return ['¿Con qué cuenta estoy conectado?'];
}

// Helpers
function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function guessCourse(raw){
  // Heurística mínima: mayúsculas/palabras con números romanos o II/III.
  const m = raw.match(/[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑñ0-9\s\-]*(I|II|III|IV|V)?/g);
  if (m && m[0]) return m[0].trim();
  return null;
}
