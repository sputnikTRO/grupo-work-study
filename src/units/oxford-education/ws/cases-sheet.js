/**
 * W&S OTCC — pestaña "Casos W&S" (una fila por caso, upsert por número).
 * Best-effort: un error del Sheet nunca rompe el caso ni el aviso.
 * Solo agrega columnas al final; nunca borra ni reordena.
 */
import * as sheets from '../../../core/sheets/client.js';
import { env } from '../../../config/env.js';
import logger from '../../../utils/logger.js';

export const CASES_SHEET_NAME = 'Casos W&S';
export const CASES_HEADERS = [
  'Caso', 'Fecha', 'Nombre', 'Correo', 'Etapa', 'Descripción', 'Capturas',
  'Responsable', 'Estado', 'Asignado', 'Confirmado', 'Reasignaciones', 'Actualizado',
];
const STATUS_LABEL = {
  pendiente_aviso: 'Pendiente (fuera de horario)', asignado: 'Asignado', atendiendo: 'Atendiendo',
  sin_confirmar: 'Sin confirmar', resuelto: 'Resuelto',
};

const cdmx = (d) => (d ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : '');

export function formatCaseRow(c, attachmentsCount = 0) {
  const attempts = Array.isArray(c.attempts) ? c.attempts : [];
  return [
    `'${c.caseNumber}`,
    cdmx(c.createdAt),
    c.fullName || '',
    c.email || '',
    c.stage || '',
    c.description || '',
    String(attachmentsCount),
    c.confirmedBy || c.assignedName || '',
    STATUS_LABEL[c.status] || c.status || '',
    cdmx(c.notifiedAt),
    cdmx(c.confirmedAt),
    String(Math.max(0, attempts.length - 1)),
    cdmx(c.updatedAt || new Date()),
  ];
}

let ready = false;
async function ensureSheet(id) {
  if (ready) return;
  if (!(await sheets.sheetExists(id, CASES_SHEET_NAME))) {
    await sheets.createSheet(id, CASES_SHEET_NAME);
    await sheets.appendRow(id, CASES_SHEET_NAME, CASES_HEADERS);
  }
  ready = true;
}

export async function syncCaseToSheet(c, attachmentsCount = 0) {
  try {
    const id = env.OXED_SHEETS_ID;
    await ensureSheet(id);
    const row = formatCaseRow(c, attachmentsCount);
    const existing = await sheets.findRowByColumn(id, CASES_SHEET_NAME, 0, String(c.caseNumber));
    if (existing) await sheets.updateRow(id, CASES_SHEET_NAME, existing, row);
    else await sheets.appendRow(id, CASES_SHEET_NAME, row);
  } catch (err) {
    logger.warn({ err, unit: 'oxford_education', caseNumber: c?.caseNumber }, 'No se pudo sincronizar el caso W&S al Sheet (el caso sigue)');
  }
}
