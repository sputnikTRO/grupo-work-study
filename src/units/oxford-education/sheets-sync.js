import { appendRow, updateRow, findRowByColumn, sheetExists, createSheet, updateRange, readRange } from '../../core/sheets/client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Oxford Education — Google Sheets lead logging
 *
 * Mirrors the Travel leads-sync pattern (upsert one row per lead, keyed by lead
 * ID in column A) but writes to a DEDICATED tab so Oxford data never mixes with
 * Travel's "Leads" tab. Same service-account credentials as the rest of the app.
 *
 * Spreadsheet: env.OXED_SHEETS_ID (defaults to GOOGLE_SHEETS_ID)
 * Tab:         env.OXED_LEADS_SHEET_NAME (defaults to "Leads Oxford")
 */

const SPREADSHEET_ID = env.OXED_SHEETS_ID;
const SHEET_NAME = env.OXED_LEADS_SHEET_NAME;

// Column order (A..R). Column A (ID) is the upsert key.
// IMPORTANTE: las 11 primeras columnas (A..K) son las HISTÓRICAS de la hoja ya
// desplegada (Resumen queda en K). Las nuevas van SIEMPRE AL FINAL para no
// desalinear los datos previos — L/M (Zona, Asesor) de feature/ori-flow-redesign,
// N..R (tiempos de SLA) de feature/ori-advisor-sla. El orden aquí DEBE coincidir
// con formatLeadRow y con la reconciliación de encabezado (ensureSheet).
const COLUMNS = { ID: 0 };

const HEADERS = [
  'ID',                       // A - lead ID (upsert key)
  'Timestamp',                // B - last update
  'Teléfono',                 // C - phone (E.164)
  'Nombre',                   // D - name if captured
  'Colegio/Organización',     // E - institution (B2B)
  'Rol/Tipo de contacto',     // F - role + lead type
  'Producto de interés',      // G - primary product
  'No. de alumnos',           // H - estimated students (B2B)
  'Temperatura',              // I - hot/warm/cold
  'Derivación',               // J - handoff Sí/No
  'Resumen conversación',     // K - short summary (HISTÓRICA, se queda en K)
  'Zona (Estado/Municipio)',  // L - geo for advisor routing
  'Asesor asignado',          // M - advisor from the zone dupla (= "asesor final": se sobreescribe en cada reasignación)
  // ── feature/ori-advisor-sla — visibilidad de tiempos por asesora ───────────
  'Hora asignación inicial',  // N - NUEVA: assignedAt del PRIMER intento (advisorAttempts[0])
  'Hora confirmación',        // O - NUEVA: confirmedAt (ATIENDO)
  'Minutos de respuesta',     // P - NUEVA: responseSeconds del intento que confirmó, en minutos
  '# Reasignaciones',         // Q - NUEVA: reassignCount
  'Asesoras intentadas',      // R - NUEVA: cadena completa del rastro (advisorAttempts)
];

// Map enum-ish product codes to human labels for the sheet.
const PRODUCT_LABELS = {
  oxford_tcc: 'Oxford TCC',
  oxford_tcc_kids: 'Oxford TCC Kids',
  english_teaching_certificate: 'English Teaching Certificate',
  alphable: 'Alphable',
  oxford_life: 'Oxford LIFE',
  rising_stars: 'Rising Stars',
  work_study_spain: 'Work & Study Spain',
};

const LEAD_TYPE_LABELS = {
  b2b_institutional: 'Institución (B2B)',
  b2c_individual: 'Individual (B2C)',
};

/**
 * Derives a hot/warm/cold temperature from the lead state.
 *
 * @param {Object} lead - OxfordLead
 * @param {boolean} handoffOccurred - Whether a handoff happened this turn
 * @returns {'hot'|'warm'|'cold'}
 */
export function deriveTemperature(lead, handoffOccurred = false) {
  const hotStatuses = [
    'interesado', 'demo_agendada', 'demo_completada',
    'propuesta_enviada', 'en_negociacion', 'cerrado_ganado',
  ];

  if (handoffOccurred || hotStatuses.includes(lead.status)) return 'hot';

  const hasQualification = Boolean(
    lead.primaryProduct || lead.institutionName || lead.estimatedStudents || lead.fullName,
  );
  if (hasQualification) return 'warm';

  return 'cold';
}

/**
 * Formatea el rastro de intentos (advisorAttempts) como una cadena legible para
 * la columna "Asesoras intentadas", p. ej.:
 *   "Enrique Ruiz (no confirmó) → Oriana Pullas (confirmó)"
 * @param {Array|null|undefined} attempts
 * @returns {string}
 */
function formatAttemptsChain(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return '';
  const RESULT_LABELS = { esperando: 'esperando', confirmo: 'confirmó', no_confirmo: 'no confirmó' };
  return attempts
    .map((a) => `${a.advisor}${a.result ? ` (${RESULT_LABELS[a.result] || a.result})` : ''}`)
    .join(' → ');
}

/**
 * Builds the row array in column order.
 */
function formatLeadRow(lead, contact, conversation, { handoffOccurred, summary }) {
  const roleParts = [lead.role, lead.leadType ? LEAD_TYPE_LABELS[lead.leadType] : null].filter(Boolean);

  // feature/ori-advisor-sla: "hora de asignación inicial" es el PRIMER intento
  // del rastro (assignedAt se sobreescribe en cada reasignación; advisorAttempts[0]
  // no se toca nunca), a diferencia de "Asesor asignado" (M) que sí es el actual/final.
  const attempts = Array.isArray(lead.advisorAttempts) ? lead.advisorAttempts : [];
  const firstAssignedAt = attempts[0]?.assignedAt || '';
  const responseMinutes = lead.responseSeconds != null ? (lead.responseSeconds / 60).toFixed(1) : '';

  return [
    lead.id?.toString() || '',                                            // A ID
    (lead.updatedAt ? new Date(lead.updatedAt) : new Date()).toISOString(), // B Timestamp
    // Leading apostrophe forces Sheets to keep the phone as text (preserves "+").
    contact.phone ? `'${contact.phone}` : '',                             // C Teléfono
    lead.fullName || contact.name || '',                                  // D Nombre
    lead.institutionName || '',                                           // E Colegio/Organización
    roleParts.join(' · '),                                                // F Rol/Tipo
    lead.primaryProduct ? (PRODUCT_LABELS[lead.primaryProduct] || lead.primaryProduct) : '', // G Producto
    lead.estimatedStudents?.toString() || '',                            // H No. alumnos
    deriveTemperature(lead, handoffOccurred),                             // I Temperatura
    handoffOccurred ? 'Sí' : 'No',                                        // J Derivación
    (summary || '').slice(0, 480),                                        // K Resumen (histórica)
    [lead.municipality, lead.state].filter(Boolean).join(', '),          // L Zona (Estado/Municipio)
    lead.assignedAdvisor || '',                                           // M Asesor asignado (= final/actual)
    firstAssignedAt,                                                      // N Hora asignación inicial
    lead.confirmedAt ? new Date(lead.confirmedAt).toISOString() : '',    // O Hora confirmación
    responseMinutes,                                                      // P Minutos de respuesta
    (lead.reassignCount ?? 0).toString(),                                 // Q # Reasignaciones
    formatAttemptsChain(attempts),                                        // R Asesoras intentadas
  ];
}

let sheetReady = false;

/** Índice de columna 0-based → letra A1 (0→A, 11→L, 12→M, 26→AA). */
function colLetter(index) {
  let n = index;
  let letter = '';
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

/**
 * Ensures the dedicated tab exists AND that its header row has every column.
 *
 * Self-healing y ADITIVO: si la pestaña ya existe pero al encabezado le faltan las
 * columnas nuevas (Zona, Asesor), las AGREGA AL FINAL (posiciones 12+), escribiendo
 * solo esas celdas de encabezado. Nunca reordena, sobrescribe ni borra columnas o
 * datos existentes. Idempotente: si ya están completas, no hace nada.
 * Corre una vez por proceso.
 */
async function ensureSheet() {
  if (sheetReady) return;

  const exists = await sheetExists(SPREADSHEET_ID, SHEET_NAME);
  if (!exists) {
    await createSheet(SPREADSHEET_ID, SHEET_NAME);
    await appendRow(SPREADSHEET_ID, SHEET_NAME, HEADERS);
    logger.info({ unit: 'oxford_education', sheet: SHEET_NAME }, 'Created Oxford leads sheet with headers');
    sheetReady = true;
    return;
  }

  // Pestaña existente: reconciliar encabezado de forma aditiva.
  const headerRows = await readRange(SPREADSHEET_ID, `'${SHEET_NAME}'!1:1`);
  const current = headerRows[0] || [];

  if (current.length < HEADERS.length) {
    const missing = HEADERS.slice(current.length); // solo las columnas que faltan, al final
    const startCol = colLetter(current.length);    // primera columna libre (p.ej. L si había 11)
    const endCol = colLetter(HEADERS.length - 1);  // última (M)
    await updateRange(SPREADSHEET_ID, `'${SHEET_NAME}'!${startCol}1:${endCol}1`, [missing]);
    logger.info(
      { unit: 'oxford_education', sheet: SHEET_NAME, added: missing, range: `${startCol}1:${endCol}1` },
      'Reconciled Oxford leads header (additive)',
    );
  }

  sheetReady = true;
}

/**
 * Upserts a lead row into the Oxford leads tab. Best-effort: never throws.
 *
 * @param {Object} lead - OxfordLead
 * @param {Object} contact - Contact
 * @param {Object} conversation - Conversation
 * @param {{handoffOccurred?: boolean, summary?: string}} opts
 */
export async function syncOxfordLeadToSheet(lead, contact, conversation, opts = {}) {
  const log = logger.child({ unit: 'oxford_education', leadId: lead.id, fn: 'sheets.syncOxfordLead' });

  try {
    await ensureSheet();

    const rowData = formatLeadRow(lead, contact, conversation, opts);
    const existingRow = await findRowByColumn(SPREADSHEET_ID, SHEET_NAME, COLUMNS.ID, lead.id?.toString());

    if (existingRow) {
      await updateRow(SPREADSHEET_ID, SHEET_NAME, existingRow, rowData);
      log.info({ rowNumber: existingRow }, 'Oxford lead updated in Google Sheets');
    } else {
      await appendRow(SPREADSHEET_ID, SHEET_NAME, rowData);
      log.info('New Oxford lead appended to Google Sheets');
    }
  } catch (error) {
    // Never break the conversation flow on a logging failure.
    log.error({ err: error }, 'Error syncing Oxford lead to Google Sheets - continuing anyway');
  }
}
