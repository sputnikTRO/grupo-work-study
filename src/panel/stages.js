/**
 * Panel — etapa de cada prospecto (módulo PURO).
 *
 * Ox y Ed guardan el estado distinto: Ox tiene ATIENDO y SLA (en_atencion,
 * sin_confirmar); Ed solo tiene LISTO. Por eso Ed nunca está "atendido" ni
 * "sin confirmar". Ver el diseño del panel (sección Etapas).
 */
export const STAGES = {
  solo_saludo: 'Solo saludó',
  dio_datos: 'Dio datos',
  derivado: 'Derivado',
  atendido: 'Atendido',
  cerrado: 'Cerrado',
  sin_confirmar: 'Sin confirmar',
};

const OX_CERRADO = new Set([
  'atendido_asesor', 'demo_agendada', 'demo_completada', 'propuesta_enviada', 'en_negociacion',
  'cerrado_ganado', 'cerrado_perdido', 'no_interesado', 'archivado',
]);
const ED_CERRADO = new Set(['atendido_asesor', 'cerrado_por_asesor', 'en_proceso_pago', 'inscrito', 'no_interesado']);

export function stageOx(lead) {
  const s = lead.status;
  if (s === 'derivado_asesor') return 'derivado';
  if (s === 'en_atencion') return 'atendido';
  if (s === 'sin_confirmar') return 'sin_confirmar';
  if (OX_CERRADO.has(s)) return 'cerrado';
  if (lead.fullName || lead.institutionName || lead.state || lead.municipality || ['en_calificacion', 'interesado'].includes(s)) return 'dio_datos';
  return 'solo_saludo';
}

export function stageEd(lead) {
  const s = lead.status;
  if (s === 'derivado_asesor') return 'derivado';
  if (ED_CERRADO.has(s)) return 'cerrado';
  if (lead.parentName || lead.schoolCode || lead.travelerName || ['interesado', 'materiales_enviados'].includes(s)) return 'dio_datos';
  return 'solo_saludo';
}

export const stageFor = (bot, lead) => (bot === 'ox' ? stageOx(lead) : stageEd(lead));

/** Estado del ticket en palabras (el valor crudo de la base no se muestra). */
export const STATUS_LABELS = {
  nuevo: 'Nuevo', primer_contacto: 'Primer contacto', contactado: 'Contactado', en_calificacion: 'En calificación',
  interesado: 'Interesado', materiales_enviados: 'Materiales enviados', derivado_asesor: 'Derivado a asesora',
  en_atencion: 'En atención (ATIENDO)', atendido_asesor: 'Atendido (LISTO)', sin_confirmar: 'Sin confirmar',
  demo_agendada: 'Demo agendada', demo_completada: 'Demo completada', propuesta_enviada: 'Propuesta enviada',
  en_negociacion: 'En negociación', cerrado_ganado: 'Cerrado ganado', cerrado_perdido: 'Cerrado perdido',
  no_interesado: 'No interesado', archivado: 'Archivado', en_proceso_pago: 'En proceso de pago', inscrito: 'Inscrito',
  cerrado_por_asesor: 'Cerrado por asesora',
};
