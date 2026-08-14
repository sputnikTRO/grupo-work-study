import { readSheet, appendRow, updateRow, findRowByColumn, sheetExists, createSheet, updateRange, readRange } from '../../core/sheets/client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';
import { ADVISORS } from './advisor-zones.js';

/**
 * Oxford Education — Visibilidad de tiempos de asesora (feature/ori-advisor-sla)
 *
 * Dos pestañas dedicadas en el mismo spreadsheet que "Leads Oxford"
 * (env.OXED_SHEETS_ID), reusando el MISMO patrón de escritura ya establecido en
 * sheets-sync.js (self-healing header aditivo + upsert por clave, nunca
 * clear+rewrite de datos ni reordenar/borrar columnas):
 *
 *   - "Tiempos asesores" (detalle): una fila por LEAD derivado, upsert por
 *     Ticket. Se escribe/actualiza en dos momentos — al CONFIRMAR (ATIENDO) y
 *     al llegar al TERMINAL (sin_confirmar) — nunca en cada reasignación
 *     intermedia.
 *   - "Resumen asesoras": una fila por asesora (las 8 de advisor-zones.ADVISORS,
 *     incluidas las que aún no tienen leads). Se RECALCULA completa desde la
 *     pestaña de detalle en cada escritura y se aplica con el MISMO upsert por
 *     clave (Asesora) — nunca un clear+rewrite masivo. Recalcular desde el
 *     detalle (en vez de acumular contadores) es deliberado: es idempotente por
 *     construcción (correr dos veces da el mismo resultado) y se autocorrige
 *     solo si el detalle cambia por fuera.
 *
 * NO reimplementa la lógica del SLA/reasignación (advisor-sla.js) — solo
 * REGISTRA los eventos que esa lógica ya produce. Fallback seguro: cualquier
 * error de Sheets se loguea y NUNCA rompe el flujo del bot (mismo contrato que
 * syncOxfordLeadToSheet).
 */

const SPREADSHEET_ID = env.OXED_SHEETS_ID;
const DETAIL_SHEET_NAME = 'Tiempos asesores';
const SUMMARY_SHEET_NAME = 'Resumen asesoras';

// ── "Tiempos asesores" (detalle, upsert por Ticket) ─────────────────────────
const DETAIL_COLUMNS = { TICKET: 0 };
const DETAIL_HEADERS = [
  'Ticket',                       // A - upsert key
  'Fecha/hora del lead',          // B - lead.createdAt
  'Prospecto',                    // C - nombre del prospecto
  'Producto',                     // D - producto de interés
  'Zona (dupla)',                 // E - estado/municipio + dupla
  'Asesora que atendió',          // F - la que confirmó; '—' si nadie confirmó
  'Minutos hasta confirmar',      // G - desde SU asignación, no desde el inicio de la cadena
  '# Reasignaciones',             // H
  'Asesoras intentadas',          // I - cadena completa con resultado
  'Estado final',                 // J - Atendido | Sin confirmar
];

// ── "Resumen asesoras" (recalculado desde el detalle, upsert por Asesora) ───
const SUMMARY_COLUMNS = { ASESORA: 0 };
const SUMMARY_HEADERS = [
  'Asesora',                             // A - upsert key
  'Leads atendidos',                     // B - confirmados por ella
  'Tiempo promedio confirmación (min)',  // C
  'Tiempo mínimo (min)',                 // D
  'Tiempo máximo (min)',                 // E
  '# Reasignado por no confirmar',       // F - veces que se le reasignó un lead lejos por no confirmar a tiempo
];

/** Etiquetas legibles del producto (copia local — mismo patrón que sheets-sync.js/advisor-notify.js). */
const PRODUCT_LABELS = {
  oxford_tcc: 'Oxford TCC',
  oxford_tcc_kids: 'Oxford TCC Kids',
  english_teaching_certificate: 'English Teaching Certificate',
  alphable: 'Alphable',
  oxford_life: 'Oxford LIFE',
  rising_stars: 'Rising Stars',
  work_study_spain: 'Work & Study Spain',
};

/** Índice de columna 0-based → letra A1. Copia local (misma lógica que sheets-sync.js) para no tocar ese archivo. */
function colLetter(index) {
  let n = index;
  let letter = '';
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

/** Cadena de intentos legible, ej. "Enrique Ruiz (no confirmó) → Oriana Pullas (confirmó)". */
function formatAttemptsChain(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return '';
  const RESULT_LABELS = { esperando: 'esperando', confirmo: 'confirmó', no_confirmo: 'no confirmó' };
  return attempts
    .map((a) => `${a.advisor}${a.result ? ` (${RESULT_LABELS[a.result] || a.result})` : ''}`)
    .join(' → ');
}

let detailReady = false;
let summaryReady = false;

/** Self-healing genérico: crea la pestaña si no existe; si existe, agrega SOLO las columnas de encabezado que falten, al final. Nunca borra/reordena. */
async function ensureSheetWithHeaders(sheetName, headers) {
  const exists = await sheetExists(SPREADSHEET_ID, sheetName);
  if (!exists) {
    await createSheet(SPREADSHEET_ID, sheetName);
    await appendRow(SPREADSHEET_ID, sheetName, headers);
    logger.info({ unit: 'oxford_education', sheet: sheetName }, 'Created sheet with headers');
    return;
  }

  const headerRows = await readRange(SPREADSHEET_ID, `'${sheetName}'!1:1`);
  const current = headerRows[0] || [];
  if (current.length < headers.length) {
    const missing = headers.slice(current.length);
    const startCol = colLetter(current.length);
    const endCol = colLetter(headers.length - 1);
    await updateRange(SPREADSHEET_ID, `'${sheetName}'!${startCol}1:${endCol}1`, [missing]);
    logger.info(
      { unit: 'oxford_education', sheet: sheetName, added: missing, range: `${startCol}1:${endCol}1` },
      'Reconciled sheet header (additive)',
    );
  }
}

async function ensureDetailSheet() {
  if (detailReady) return;
  await ensureSheetWithHeaders(DETAIL_SHEET_NAME, DETAIL_HEADERS);
  detailReady = true;
}

async function ensureSummarySheet() {
  if (summaryReady) return;
  await ensureSheetWithHeaders(SUMMARY_SHEET_NAME, SUMMARY_HEADERS);
  summaryReady = true;
}

/**
 * Arma la fila de detalle para UN lead. `lead` debe traer ya mergeados los
 * campos del evento (confirmación o terminal) — ver los dos call sites en
 * advisor-commands.js (ATIENDO) y advisor-sla.js (terminal sin_confirmar).
 */
function formatDetailRow(lead, contact) {
  const attempts = Array.isArray(lead.advisorAttempts) ? lead.advisorAttempts : [];
  const zona = [lead.municipality, lead.state].filter(Boolean).join(', ');
  const zonaDupla = zona ? (lead.zoneKey ? `${zona} (dupla ${lead.zoneKey})` : zona) : (lead.zoneKey ? `(dupla ${lead.zoneKey})` : '');
  const producto = lead.primaryProduct ? (PRODUCT_LABELS[lead.primaryProduct] || lead.primaryProduct) : '';
  const esSinConfirmar = lead.status === 'sin_confirmar';
  const asesoraQueAtendio = esSinConfirmar ? '—' : (lead.assignedAdvisor || '—');
  const minutos = !esSinConfirmar && lead.responseSeconds != null ? (lead.responseSeconds / 60).toFixed(1) : '';

  return [
    // Prefijo con apóstrofo (mismo truco que el teléfono en sheets-sync.js) para
    // que Sheets guarde el ticket como TEXTO — así findRowByColumn compara
    // consistentemente contra el mismo tipo en cada corrida (evita que un
    // ticket numérico se lea de vuelta como number y rompa el match del upsert).
    `'${lead.ticketNumber}`,
    lead.createdAt ? new Date(lead.createdAt).toISOString() : '',
    lead.fullName || contact?.name || contact?.phone || '',
    producto,
    zonaDupla,
    asesoraQueAtendio,
    minutos,
    (lead.reassignCount ?? 0).toString(),
    formatAttemptsChain(attempts),
    esSinConfirmar ? 'Sin confirmar' : 'Atendido',
  ];
}

async function upsertDetailRow(lead, contact) {
  await ensureDetailSheet();
  const rowData = formatDetailRow(lead, contact);
  const existingRow = await findRowByColumn(SPREADSHEET_ID, DETAIL_SHEET_NAME, DETAIL_COLUMNS.TICKET, String(lead.ticketNumber));
  if (existingRow) {
    await updateRow(SPREADSHEET_ID, DETAIL_SHEET_NAME, existingRow, rowData);
  } else {
    await appendRow(SPREADSHEET_ID, DETAIL_SHEET_NAME, rowData);
  }
}

/**
 * Recalcula "Resumen asesoras" ÍNTEGRO a partir de la pestaña de detalle y
 * aplica el resultado con upsert por asesora (nunca clear+rewrite). Incluye a
 * las 8 asesoras del roster aunque aún no tengan leads (visibilidad de carga).
 */
async function recomputeSummary() {
  await ensureSummarySheet();

  const detailRows = await readSheet(SPREADSHEET_ID, DETAIL_SHEET_NAME);

  const stats = new Map();
  for (const advisor of Object.values(ADVISORS)) {
    stats.set(advisor.nombre, { count: 0, totalMin: 0, minMin: null, maxMin: null, reassignedAway: 0 });
  }

  for (const row of detailRows) {
    const asesora = row['Asesora que atendió'];
    const minutos = parseFloat(row['Minutos hasta confirmar']);
    if (asesora && asesora !== '—' && stats.has(asesora) && Number.isFinite(minutos)) {
      const s = stats.get(asesora);
      s.count += 1;
      s.totalMin += minutos;
      s.minMin = s.minMin === null ? minutos : Math.min(s.minMin, minutos);
      s.maxMin = s.maxMin === null ? minutos : Math.max(s.maxMin, minutos);
    }

    // "# de veces que se le reasignó un lead por no confirmar a tiempo" se
    // deriva de la cadena de intentos: cuenta apariciones "Nombre (no confirmó)".
    const cadena = row['Asesoras intentadas'] || '';
    for (const [nombre, s] of stats) {
      if (cadena.includes(`${nombre} (no confirmó)`)) s.reassignedAway += 1;
    }
  }

  for (const [nombre, s] of stats) {
    const rowData = [
      nombre,
      String(s.count),
      s.count > 0 ? (s.totalMin / s.count).toFixed(1) : '',
      s.minMin != null ? s.minMin.toFixed(1) : '',
      s.maxMin != null ? s.maxMin.toFixed(1) : '',
      String(s.reassignedAway),
    ];
    const existingRow = await findRowByColumn(SPREADSHEET_ID, SUMMARY_SHEET_NAME, SUMMARY_COLUMNS.ASESORA, nombre);
    if (existingRow) {
      await updateRow(SPREADSHEET_ID, SUMMARY_SHEET_NAME, existingRow, rowData);
    } else {
      await appendRow(SPREADSHEET_ID, SUMMARY_SHEET_NAME, rowData);
    }
  }
}

/**
 * Registra el resultado del SLA de un lead en ambas pestañas: la fila de
 * detalle (upsert por ticket) y el resumen por asesora (recalculado). Llamar
 * SOLO en los dos eventos terminales del SLA por lead — confirmación (ATIENDO)
 * o terminal (sin_confirmar) — nunca en cada reasignación intermedia.
 *
 * Best-effort: nunca lanza. Un fallo de Sheets se loguea y el flujo del bot
 * continúa exactamente igual que si esta función no existiera.
 *
 * @param {Object} lead - OxfordLead con los campos del evento ya mergeados
 *   (assignedAdvisor, status, responseSeconds, advisorAttempts, reassignCount, ...)
 * @param {Object} contact - Contact del prospecto (nombre/teléfono de respaldo)
 */
export async function recordAdvisorSlaOutcome(lead, contact) {
  const log = logger.child({ unit: 'oxford_education', leadId: lead.id, ticket: lead.ticketNumber, fn: 'advisor-sla-sheet.record' });

  try {
    await upsertDetailRow(lead, contact);
    await recomputeSummary();
    log.info({ status: lead.status }, 'Oxford advisor SLA sheets updated (detalle + resumen)');
  } catch (error) {
    log.error({ err: error }, 'Error writing Oxford advisor SLA sheets — continuing anyway');
  }
}
