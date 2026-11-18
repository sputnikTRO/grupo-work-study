/**
 * Formato de fechas para las hojas que lee el equipo (Leads, Leads Oxford,
 * Tiempos asesores).
 *
 * Antes se escribía `toISOString()` — hora UTC con "T" y "Z" — y un lead de las
 * 22:11 del día 10 aparecía como "2026-11-11T04:11:…Z". Ahora va en hora de la
 * Ciudad de México, "AAAA-MM-DD HH:mm": legible y, al ser texto con ese orden,
 * se ordena bien tal cual.
 */
export const SHEET_TIMEZONE = 'America/Mexico_City';

const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: SHEET_TIMEZONE, dateStyle: 'short', timeStyle: 'short' });

/** Fecha → "2026-11-10 22:11" (CDMX). Vacío si no hay fecha o es inválida. */
export function formatCdmx(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatter.format(date);
}

/**
 * Igual que formatCdmx pero con apóstrofo inicial, para escrituras con
 * valueInputOption USER_ENTERED: obliga a Sheets a guardar TEXTO en vez de
 * convertirlo a una fecha con el formato regional de la hoja.
 */
export function cdmxCell(value) {
  const text = formatCdmx(value);
  return text ? `'${text}` : '';
}

/** ¿Es una fecha ISO en UTC como las que se escribían antes? */
export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
