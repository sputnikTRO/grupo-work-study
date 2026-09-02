/**
 * Horario de atención de las asesoras (compartido por unidades)
 *
 * Lunes a viernes, 9:00–18:00, America/Mexico_City. Usado SOLO para decidir si se
 * agrega el aviso de horario al derivar (flow-engine.js de cada unidad) — el bot
 * sigue atendiendo 24/7; esto nunca silencia ni bloquea nada, solo cambia un texto.
 *
 * Vivía en src/units/oxford-education/office-hours.js; ese archivo ahora re-exporta
 * este para no cambiar el comportamiento (ni los mocks de los tests) de Ori.
 *
 * Se calcula con Intl.DateTimeFormat contra la zona horaria fija, así que el
 * resultado es correcto sin importar la TZ del servidor.
 */

const TIMEZONE = 'America/Mexico_City';
const WEEKEND_DAYS = new Set(['Sat', 'Sun']);
const OPEN_HOUR = 9;   // inclusive
const CLOSE_HOUR = 18; // exclusivo — a las 18:00 en punto ya se considera fuera de horario

/**
 * @param {Date} [date] - Instante a evaluar (default: ahora)
 * @returns {boolean} true si cae lunes–viernes 9:00–17:59:59 hora CDMX
 */
export function isWithinOfficeHours(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  let hour = parseInt(parts.find((p) => p.type === 'hour')?.value, 10);
  if (hour === 24) hour = 0; // algunas implementaciones de ICU devuelven "24" para medianoche con hour12:false

  if (!weekday || Number.isNaN(hour)) return true; // no bloquear el aviso por un fallo de Intl; asumir "dentro" (sin aviso extra)

  return !WEEKEND_DAYS.has(weekday) && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/** Texto exacto del aviso de horario (fuera de lun–vie 9:00–18:00 CDMX). */
export const OUT_OF_HOURS_NOTICE =
  'las asesoras atienden de lunes a viernes de 9:00 a 18:00 (CDMX) y te contactarán en ese horario';
