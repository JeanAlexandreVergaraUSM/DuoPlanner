// ai/humanize.js
// Convierte resultados de tools.js en respuestas en lenguaje natural

export function humanize(intent, res, slots) {
  if (res?.error === 'missing_slot') return `Me falta el dato **${res.which}** para ayudarte.`;

  switch (intent) {
    // Cuenta
    case 'auth_status': return res.logged ? `Estás conectado con **${res.email || 'tu cuenta de Google'}**.` : 'No estás conectado.';
    case 'auth_login': return 'Abre el diálogo de Google para iniciar sesión.';
    case 'auth_switch': return 'Cierra sesión y vuelve a iniciar con la cuenta que prefieras.';
    case 'auth_logout': return 'Cerrando sesión…';

    // Rules
    case 'rules_list':
      return res?.length ? `Reglas de ${slots.course}: ${res.map(r => `${r.tipo} (${r.peso}%)`).join(', ')}.` : 'No encontré reglas para ese curso.';
    case 'rules_add':
      return res?.ok ? 'Regla añadida ✅' : `No pude añadir la regla: ${res?.error}`;
    case 'rules_remove':
      return res?.ok ? 'Regla eliminada ✅' : `No pude eliminar la regla: ${res?.error}`;

    // Semestre
    case 'sem_list': return res?.items?.length ? `Tienes estos semestres: ${res.items.join(', ')}.` : 'No veo semestres creados.';
    case 'sem_count_courses': return `Este semestre tiene ${res?.count ?? 0} ramos.`;
    case 'sem_summary':
      return res?.courses?.length
        ? `El semestre ${res.label} tiene ${res.total} ramos: ${res.courses.join(', ')}.`
        : `No encontré cursos en el semestre ${slots.label || 'activo'}.`;

    // Duo
    case 'pair_whois': return res?.duo ? `Tu duo es **${res.duo}**.` : 'No tienes duo configurado.';
    case 'pair_create': return res?.code ? `Código de party creado: **${res.code}**.` : 'Creé un nuevo código de party.';
    case 'pair_join': return res?.joined ? '¡Listo! Te uniste a la party.' : 'Intenté unirme con el código. Revisa si es correcto.';
    case 'pair_close': return 'Party cerrada.';

    // Cursos/Notas
    case 'course_list': return res?.courses?.length ? `Ramos del semestre: ${res.courses.join(', ')}.` : 'No hay ramos cargados.';
    case 'course_info':
      return res?.name
        ? `Ramo: **${res.name}** (${res.code}) · Prof: ${res.professor || '—'} · Sección: ${res.section || '—'}`
        : 'No encontré ese curso.';
    case 'grades_list':
      return res?.items?.length
        ? `Notas en ${slots.rule || 'la regla'} de **${slots.course}**:\n` +
          res.items.map(n => `• ${n.valor}${n.comentario ? ' ('+n.comentario+')' : ''}${n.fecha ? ' · '+n.fecha : ''}`).join('\n')
        : `No encontré notas en ${slots.rule || 'esa regla'} de **${slots.course}**.`;
    case 'grade_add':
      return res?.ok
        ? `Añadí la nota **${res.valor}** en ${slots.rule || 'la regla'} de **${slots.course}**${slots.comentario ? ' ('+slots.comentario+')' : ''}.`
        : 'No pude agregar la nota.';
    case 'grade_sem_avg': return (res?.avg ?? null) != null ? `Tu promedio del semestre es **${res.avg}**.` : 'Aún no puedo calcular el promedio.';
    case 'grade_best_worst':
      return res ? `Mejor ramo: **${res.best || '—'}** · Peor ramo: **${res.worst || '—'}**.` : 'No pude comparar los ramos.';
    case 'grade_needed': return (res?.needed ?? null) != null ? `Necesitas **${res.needed}** para aprobar **${slots.course}**.` : 'No pude estimar la nota mínima.';
    case 'grade_pass_status': return (res?.pass === true) ? `Vas aprobando **${slots.course}**.` : (res?.pass === false) ? `De momento **no** vas aprobando **${slots.course}**.` : 'No pude verificar.';
    case 'grade_gap': return (res?.gap ?? null) != null ? `Te falta ~**${res.gap}** puntos/centésimas en **${slots.course}**.` : 'No pude estimar la brecha.';
    case 'export_grades': return `Ok. Exporta **${res.scope || 'actual'}** en **${res.format || 'pdf'}** desde la sección Exportar.`;

    // Horario
    case 'sched_view': return res?.note || 'Te muestro el horario en pantalla.';
    case 'sched_has_classes': return res?.has ? `Sí, tienes clases el **${slots.day}**.` : `No, no tienes clases el **${slots.day}**.`;
    case 'sched_first_last': return (res?.first || res?.last) ? `Primer ramo: ${res.first || '—'} · Último: ${res.last || '—'}.` : 'No encontré clases ese día.';
    case 'sched_end_time': return res?.end ? `Ese día terminas a las **${res.end}**.` : 'No tienes clases ese día.';
    case 'sched_count_day': return `Tienes **${res?.count || 0}** clases ese día.`;
    case 'sched_total_hours_week': return `Esta semana llevas ~**${res?.hours ?? 0} h** de clases.`;
    case 'sched_check_conflict': return (res?.conflict === true) ? 'Sí, se cruzan.' : (res?.conflict === false) ? 'No, no se cruzan.' : 'No pude verificar.';
    case 'sched_suggest_free': return res?.suggestion ? `Libre sugerido: **${res.suggestion}**.` : 'No encontré un bloque libre con esos filtros.';
    case 'sched_gaps_day': return res?.gaps?.length ? `Ventanas el ${slots.day}: ${res.gaps.join(', ')}.` : `No veo ventanas el ${slots.day}.`;
    case 'sched_set_room':
      if (res?.ok) return `La sala de **${slots.course || 'ese ramo'}** el ${slots.day || ''} bloque ${slots.slot || ''} fue actualizada a **${slots.room}** ✅`;
      return res?.error ? `No pude actualizar la sala: ${res.error}` : 'No pude actualizar la sala.';
    case 'sched_get_room': return res?.room ? `Te toca en **${res.room}**.` : 'No veo sala asignada.';
    case 'sched_overlap_pair': return res?.items?.length ? `Coinciden en horario en: ${res.items.join(', ')}.` : (res?.error ? `No pude verificar coincidencias: ${res.error}` : 'No veo coincidencias en su horario.');
    case 'export_schedule': return `Ok. Exporta en **${res.format || 'png'}** desde Exportar.`;

    // Malla / Progreso
    case 'curr_prereqs': return res?.prerequisites ? `Para **${slots.course}** necesitas: ${res.prerequisites.join(', ')}.` : `No encontré prerequisitos para **${slots.course}**.`;
    case 'curr_when_taken': return res?.when ? `**${slots.course}** se toma usualmente en **${res.when}**.` : 'No tengo el semestre típico.';
    case 'curr_is_approved': return (res?.approved === true) ? `Sí, **${slots.course}** está aprobado.` : (res?.approved === false) ? `No, **${slots.course}** aún no está aprobado.` : 'No pude verificar.';
    case 'curr_progress': return (res?.pct != null) ? `Llevas **${res.pct}%** de la malla (${res.approved}/${res.total} ramos).` : 'No pude calcular el avance.';
    case 'curr_missing_by_area': return res?.items?.length ? `Te faltan en ${slots.area}: ${res.items.join(', ')}.` : `No encontré pendientes de ${slots.area}.`;
    case 'curr_simulate_adv': return (res?.simPct != null) ? `Si apruebas ${slots.courses?.join(', ')}, quedarías en **${res.simPct}%**.` : 'No pude simular.';
    case 'curr_pair_level': return res?.level ? `Van juntos en **${res.level}**.` : 'No tengo ese dato.';
    case 'export_malla': return `Ok. Exporta tu malla en **${res.format || 'png'}** desde Exportar.`;

    // Calendario
    case 'cal_create': return res?.ok ? 'Recordatorio creado ✅' : 'Listo, anoté el recordatorio.';
    case 'cal_delete': return res?.ok ? 'Recordatorio eliminado.' : 'Intenté eliminarlo.';
    case 'cal_update': return res?.ok ? 'Recordatorio actualizado.' : 'No pude actualizarlo.';
    case 'cal_list': return res?.items?.length ? `Recordatorios: ${res.items.join('; ')}` : 'No tienes recordatorios en ese rango.';
    case 'cal_suspend': return res?.ok ? 'Recordatorio pausado.' : 'Intenté pausarlo.';
    case 'cal_list_pair': return res?.items?.length ? `Recordatorios en común: ${res.items.join(', ')}` : 'No veo recordatorios compartidos.';

    // Default
    default:
      return 'Listo. ¿Quieres que haga algo más?';
  }
}
