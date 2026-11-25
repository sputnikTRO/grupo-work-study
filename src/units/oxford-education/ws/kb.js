/**
 * W&S OTCC — base de conocimiento.
 *
 * Fuente principal: pestaña "FAQ OTCC W&S" (editable por el cliente; la siembra
 * scripts/seed-ws-otcc.mjs). Respaldo: la sección 5 de docs/kb-ws-otcc.md, para
 * que el modo funcione aunque la pestaña aún no exista o el Sheet no cargue.
 *
 * La tabla de contactos (sección 4 del documento) NUNCA entra aquí.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cache from '../../../core/sheets/cache.js';
import logger from '../../../utils/logger.js';
import { parseKbDoc } from './kb-parse.js';

export { parseKbDoc };

export const KB_DOC_PATH = fileURLToPath(new URL('../../../../docs/kb-ws-otcc.md', import.meta.url));

function fromSheetRow(r, i) {
  const pick = (...keys) => keys.map((k) => r[k]).find((v) => v != null && String(v).trim() !== '');
  const activo = String(pick('Activo', 'Estado') ?? 'Sí').trim().toLowerCase();
  if (['no', 'inactivo', 'false', '0'].includes(activo)) return null;
  const pregunta = String(pick('Pregunta') || '').trim();
  const respuesta = String(pick('Respuesta') || '').trim();
  if (!pregunta || !respuesta) return null;
  return { seccion: String(pick('Sección', 'Seccion') || '').trim(), pregunta, respuesta, orden: parseInt(pick('Orden'), 10) || 1000 + i };
}

/** @returns {Promise<{ rows: Array, source: 'sheet'|'doc'|'vacia' }>} */
export async function loadWsKb(log = logger) {
  try {
    const sheetRows = (await (cache.getWsOtccFAQ ? cache.getWsOtccFAQ() : [])).map(fromSheetRow).filter(Boolean).sort((a, b) => a.orden - b.orden);
    if (sheetRows.length) return { rows: sheetRows, source: 'sheet' };
  } catch (err) {
    log.warn({ err }, 'No se pudo leer la pestaña FAQ OTCC W&S — se usa el documento');
  }
  try {
    const rows = parseKbDoc(fs.readFileSync(KB_DOC_PATH, 'utf8'));
    if (rows.length) return { rows, source: 'doc' };
  } catch (err) {
    log.error({ err }, 'No se pudo leer docs/kb-ws-otcc.md');
  }
  return { rows: [], source: 'vacia' };
}
