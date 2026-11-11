/**
 * Oxford Education — Horario laboral del SLA de confirmación (ATIENDO)
 *
 * El reloj del SLA (advisor-sla.js) solo corre en horario laboral. Sin esto, un
 * lead que entra a las 21:00 recorría la cadena completa de asesoras durante la
 * noche y amanecía en `sin_confirmar` sin que nadie hubiera tenido oportunidad
 * real de atenderlo (auditoría nov-2026: la mayoría de los leads entra entre las
 * 20:00 y la medianoche).
 *
 * Reglas:
 *   - Lead asignado FUERA de horario → el plazo empieza a contar desde la
 *     siguiente apertura (vence a apertura + OXED_ADVISOR_SLA_MINUTES).
 *   - Lead asignado DENTRO de horario cuyo plazo cruza el cierre → el reloj se
 *     pausa al cierre y el resto se consume desde la siguiente apertura.
 *   - La NOTIFICACIÓN a la asesora no se retrasa: sale en el momento, como
 *     siempre. Lo único que cambia es cuándo vence `slaDueAt`.
 *
 * Módulo PURO (sin env, sin base, sin reloj propio): recibe el horario como
 * texto y la fecha como argumento. Lo usa buildAssignmentFields.
 *
 * Formato del horario (OXED_ADVISOR_SLA_HOURS):
 *   "<días> <HH:MM>-<HH:MM>; <días> <HH:MM>-<HH:MM>; …"
 *   días = número ISO (1 = lunes … 7 = domingo), rango "1-5" o lista "1,3,5".
 *   Ejemplo (default): "1-5 09:00-19:00; 6 09:00-14:00"
 *   Vacío / "off" / "24x7" → sin pausa: el reloj corre siempre (como antes).
 */

export const DEFAULT_SLA_HOURS = '1-5 09:00-19:00; 6 09:00-14:00';
export const SLA_TIMEZONE = 'America/Mexico_City';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function parseDays(token) {
  const days = new Set();
  for (const part of token.split(',')) {
    const m = part.trim().match(/^([1-7])(?:-([1-7]))?$/);
    if (!m) return null;
    const from = Number(m[1]);
    const to = Number(m[2] || m[1]);
    if (to < from) return null;
    for (let d = from; d <= to; d++) days.add(d);
  }
  return days.size ? [...days] : null;
}

/**
 * Convierte el texto del horario en ventanas por día.
 *
 * @param {string} spec
 * @returns {{ schedule: Object<number, Array<{start:number,end:number}>>|null, error: string|null }}
 *   schedule = null → sin pausa (24/7). Las ventanas van en ms desde medianoche.
 *   error ≠ null → el texto no se pudo leer (el llamador decide qué hacer).
 */
export function parseSlaHours(spec) {
  const text = String(spec ?? '').trim();
  if (!text || /^(off|24x7|24\/7|none|no)$/i.test(text)) return { schedule: null, error: null };

  const schedule = {};
  for (const segment of text.split(';').map((s) => s.trim()).filter(Boolean)) {
    const m = segment.match(/^([\d,\s-]+?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    const days = m ? parseDays(m[1].replace(/\s+/g, '')) : null;
    if (!m || !days) return { schedule: null, error: `segmento ilegible: "${segment}"` };
    const start = (Number(m[2]) * 60 + Number(m[3])) * 60000;
    const end = (Number(m[4]) * 60 + Number(m[5])) * 60000;
    if (Number(m[3]) > 59 || Number(m[5]) > 59 || end > DAY_MS || start >= end) {
      return { schedule: null, error: `horas inválidas en "${segment}"` };
    }
    for (const d of days) (schedule[d] = schedule[d] || []).push({ start, end });
  }
  if (Object.keys(schedule).length === 0) return { schedule: null, error: 'horario vacío' };
  for (const d of Object.keys(schedule)) schedule[d].sort((a, b) => a.start - b.start);
  return { schedule, error: null };
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SLA_TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Día ISO y ms transcurridos desde la medianoche local (America/Mexico_City). */
function localClock(date) {
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    weekday: WEEKDAY_ISO[p.weekday],
    msOfDay: ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + date.getMilliseconds(),
  };
}

/**
 * Suma `minutes` de tiempo LABORAL a `from`.
 *
 * México no tiene horario de verano desde 2022, así que avanzar en milisegundos
 * es exacto; si la zona cambiara de offset a media espera, el error sería de a lo
 * más una hora en ese único cruce.
 *
 * @param {Date} from
 * @param {number} minutes
 * @param {Object|null} schedule - salida de parseSlaHours().schedule; null = 24/7
 * @returns {Date}
 */
export function addBusinessMinutes(from, minutes, schedule) {
  let remaining = Math.max(0, Number(minutes) || 0) * 60000;
  if (!schedule) return new Date(from.getTime() + remaining);

  let cursor = from.getTime();
  // Tope de seguridad: 15 días recorridos sin consumir el plazo → se devuelve el
  // vencimiento "de siempre" antes que colgar el handoff en un bucle.
  for (let guard = 0; guard < 15 * 8; guard++) {
    const { weekday, msOfDay } = localClock(new Date(cursor));
    const window = (schedule[weekday] || []).find((w) => msOfDay < w.end);

    if (!window) { // ya no queda ventana hoy → medianoche del día siguiente
      cursor += DAY_MS - msOfDay;
      continue;
    }
    if (msOfDay < window.start) cursor += window.start - msOfDay; // aún no abre → a la apertura
    const startInWindow = Math.max(msOfDay, window.start);
    const available = window.end - startInWindow;
    if (remaining <= available) return new Date(cursor + remaining);
    remaining -= available;
    cursor += available; // justo al cierre; la siguiente vuelta busca la próxima ventana
  }
  return new Date(from.getTime() + Math.max(0, Number(minutes) || 0) * 60000);
}

/**
 * Vencimiento del SLA para una asignación hecha en `now`.
 *
 * Un horario ilegible NO desactiva la pausa en silencio: se usa el default y se
 * devuelve el motivo en `warning` para que el llamador lo loguee.
 *
 * @param {Date} now
 * @param {number} minutes - OXED_ADVISOR_SLA_MINUTES
 * @param {string} spec - OXED_ADVISOR_SLA_HOURS
 * @returns {{ dueAt: Date, paused: boolean, warning: string|null }}
 *   paused = true cuando el vencimiento se recorrió por el horario.
 */
export function slaDueAt(now, minutes, spec) {
  let { schedule, error } = parseSlaHours(spec);
  let warning = null;
  if (error) {
    warning = `OXED_ADVISOR_SLA_HOURS inválido (${error}) — se usa el default "${DEFAULT_SLA_HOURS}"`;
    schedule = parseSlaHours(DEFAULT_SLA_HOURS).schedule;
  }
  const dueAt = addBusinessMinutes(now, minutes, schedule);
  const plain = now.getTime() + Math.max(0, Number(minutes) || 0) * 60000;
  return { dueAt, paused: dueAt.getTime() !== plain, warning };
}
