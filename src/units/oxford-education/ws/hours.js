/**
 * W&S OTCC — horario del equipo y su equivalente en España.
 *
 * El equipo atiende en hora de Ciudad de México; los participantes escriben
 * desde España. La hora de España NO va fija en el texto: se calcula para la
 * fecha con la zona Europe/Madrid, así cambia sola con el horario de verano
 * europeo (15:00–23:00 en invierno, 16:00–00:00 en verano).
 */
import { parseSlaHours, addBusinessMinutes } from '../sla-hours.js';

const fmt = (date, timeZone) => new Intl.DateTimeFormat('es-ES', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date);

/** Fecha (Y-M-D) que es "hoy" en CDMX para `now`. */
function cdmxYmd(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Instante de "HH:MM en CDMX" del día de `now` (CDMX es UTC-6 sin horario de verano desde 2022). */
function cdmxInstant(now, hhmm) {
  return new Date(`${cdmxYmd(now)}T${hhmm}:00-06:00`);
}

/**
 * Ventana del equipo (en CDMX) expresada en hora peninsular de España para la fecha dada.
 * @param {Date} now
 * @param {{start:string,end:string}} [win] - por default 08:00–16:00
 * @returns {{ start: string, end: string }} p. ej. { start: '15:00', end: '23:00' }
 */
export function spainWindow(now = new Date(), win = { start: '08:00', end: '16:00' }) {
  return {
    start: fmt(cdmxInstant(now, win.start), 'Europe/Madrid'),
    end: fmt(cdmxInstant(now, win.end), 'Europe/Madrid'),
  };
}

/** Primera ventana del horario W&S ("1-5 08:00-16:00" → 08:00–16:00), para el texto. */
export function teamWindowFromSpec(spec) {
  const m = /(\d{2}:\d{2})-(\d{2}:\d{2})/.exec(String(spec || ''));
  return m ? { start: m[1], end: m[2] } : { start: '08:00', end: '16:00' };
}

const hhmm = (s) => s.replace(/^0(\d):/, '$1:');

/** Mensaje al canalizar (texto del documento, con la hora de España calculada). */
export function canalizadoMessage(now = new Date(), spec = '1-5 08:00-16:00') {
  const win = teamWindowFromSpec(spec);
  const es = spainWindow(now, win);
  return 'Gracias, ya tengo tu información. Canalicé tu caso con el equipo responsable, que se pondrá en contacto contigo para darle seguimiento. '
    + `Nuestro equipo atiende de lunes a viernes de ${hhmm(win.start)} a ${hhmm(win.end)}, hora de Ciudad de México `
    + `(hoy, de ${es.start} a ${es.end} hora peninsular española; en Canarias, una hora menos). `
    + 'Si escribiste fuera de ese horario, te contactarán al iniciar el siguiente horario de atención.';
}

/** ¿`now` cae dentro del horario del equipo? */
export function isWithinTeamHours(now, spec) {
  const { schedule } = parseSlaHours(spec);
  if (!schedule) return true;
  return addBusinessMinutes(now, 0, schedule).getTime() === now.getTime();
}

/** Siguiente apertura (o `now` si ya está abierto). */
export function nextOpening(now, spec) {
  const { schedule } = parseSlaHours(spec);
  return schedule ? addBusinessMinutes(now, 0, schedule) : now;
}

/** Vencimiento: `minutes` minutos hábiles desde `from`. */
export function businessDue(from, minutes, spec) {
  const { schedule } = parseSlaHours(spec);
  return addBusinessMinutes(from, minutes, schedule);
}
