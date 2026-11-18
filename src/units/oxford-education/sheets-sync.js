import { appendRow, updateRow, findRowByColumn, sheetExists, createSheet, updateRange, readRange } from '../../core/sheets/client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';
import prisma from '../../core/database/client.js';
import { cdmxCell } from '../../core/sheets/format.js';

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
  // ── fix/sheets-sync — agregadas AL FINAL para no mover nada de lo que el equipo ya usa ──
  'Asesora original',         // S - a quién se le asignó primero (advisorAttempts[0])
  'Asesora actual',           // T - quién lo tiene hoy (= M, que se conserva por compatibilidad)
  'Estado del ticket',        // U - en palabras: esperando / en atención / atendido / sin confirmar
  'Actualizado (CDMX)',       // V - cuándo se escribió esta fila por última vez
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

// Estados en los que el lead YA fue derivado a una asesora (handoff tibio).
const HANDED_OFF_STATUSES = ['derivado_asesor', 'en_atencion', 'atendido_asesor', 'sin_confirmar'];

/**
 * ¿Este lead fue derivado alguna vez? (columna J "Derivación").
 *
 * Antes la columna usaba solo `handoffOccurred`, que es "hubo handoff EN ESTE
 * TURNO". Como el handoff es tibio (Ori sigue atendiendo), el siguiente mensaje
 * del prospecto reescribía la fila con "No" — y un lead que terminó en
 * `sin_confirmar` (se agotaron las asesoras) también quedaba como "No". En la
 * auditoría de nov-2026 las 10 derivaciones del periodo aparecían como "No".
 *
 * @param {Object} lead - OxfordLead
 * @param {boolean} handoffOccurred - handoff en este turno
 * @returns {boolean}
 */
export function wasHandedOff(lead, handoffOccurred = false) {
  return Boolean(
    handoffOccurred
    || lead?.assignedAdvisor
    || HANDED_OFF_STATUSES.includes(lead?.status)
    || (lead?.tags || []).includes('derivado_travel'),
  );
}

/**
 * Estado del ticket en palabras, para la columna U. La columna M ("Asesor
 * asignado") muestra a quien tiene el lead HOY — tras una cadena de SLA agotada
 * es la última a la que se le avisó, lo que hacía parecer que ella lo atendía.
 * Esta columna dice explícitamente qué pasó.
 *
 * @param {Object} lead - OxfordLead
 * @returns {string}
 */
export function ticketStatusLabel(lead) {
  const asesora = lead?.assignedAdvisor;
  if ((lead?.tags || []).includes('derivado_travel')) return 'Derivado al equipo de viajes';
  switch (lead?.status) {
    case 'derivado_asesor':
      return asesora ? `Esperando confirmación de ${asesora}` : 'Esperando confirmación';
    case 'en_atencion':
      return asesora ? `En atención — ${asesora} confirmó` : 'En atención';
    case 'atendido_asesor':
      return asesora ? `Atendido — ${asesora} lo cerró` : 'Atendido';
    case 'sin_confirmar':
      return `SIN CONFIRMAR — nadie respondió${asesora ? ` (última avisada: ${asesora})` : ''}`;
    default:
      return asesora ? `Asignado a ${asesora}` : 'Sin derivar';
  }
}

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
    lead.primaryProductLabel || lead.primaryProduct || lead.institutionName || lead.estimatedStudents || lead.fullName,
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
  const RESULT_LABELS = { esperando: 'esperando', confirmo: 'confirmó', no_confirmo: 'no confirmó', cedido: 'lo tomó otra asesora' };
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
  const firstAssignedAt = cdmxCell(attempts[0]?.assignedAt);
  const responseMinutes = lead.responseSeconds != null ? (lead.responseSeconds / 60).toFixed(1) : '';

  return [
    lead.id?.toString() || '',                                            // A ID
    cdmxCell(lead.updatedAt || new Date()),                               // B Timestamp (hora CDMX)
    // Leading apostrophe forces Sheets to keep the phone as text (preserves "+").
    contact.phone ? `'${contact.phone}` : '',                             // C Teléfono
    lead.fullName || contact.name || '',                                  // D Nombre
    lead.institutionName || '',                                           // E Colegio/Organización
    roleParts.join(' · '),                                                // F Rol/Tipo
    lead.primaryProductLabel || (lead.primaryProduct ? (PRODUCT_LABELS[lead.primaryProduct] || lead.primaryProduct) : ''), // G Producto
    lead.estimatedStudents?.toString() || '',                            // H No. alumnos
    deriveTemperature(lead, handoffOccurred),                             // I Temperatura
    wasHandedOff(lead, handoffOccurred) ? 'Sí' : 'No',                    // J Derivación (histórica, no solo este turno)
    (summary || '').slice(0, 480),                                        // K Resumen (histórica)
    [lead.municipality, lead.state].filter(Boolean).join(', '),          // L Zona (Estado/Municipio)
    lead.assignedAdvisor || '',                                           // M Asesor asignado (= final/actual)
    firstAssignedAt,                                                      // N Hora asignación inicial
    cdmxCell(lead.confirmedAt),                                           // O Hora confirmación (hora CDMX)
    responseMinutes,                                                      // P Minutos de respuesta
    (lead.reassignCount ?? 0).toString(),                                 // Q # Reasignaciones
    formatAttemptsChain(attempts),                                        // R Asesoras intentadas
    attempts[0]?.advisor || lead.assignedAdvisor || '',                   // S Asesora original
    lead.assignedAdvisor || '',                                           // T Asesora actual
    ticketStatusLabel(lead),                                              // U Estado del ticket
    cdmxCell(new Date()),                                                 // V Actualizado (hora CDMX)
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

    const existingRow = await findRowByColumn(SPREADSHEET_ID, SHEET_NAME, COLUMNS.ID, lead.id?.toString());

    // Los eventos sin conversación (menú determinístico, reasignación, ATIENDO,
    // LISTO) no traen resumen: se conserva el que ya está en la fila en vez de
    // borrarlo.
    let options = opts;
    if (existingRow && opts.summary == null) {
      const previa = await readRange(SPREADSHEET_ID, `'${SHEET_NAME}'!K${existingRow}:K${existingRow}`).catch(() => []);
      options = { ...opts, summary: previa?.[0]?.[0] || '' };
    }
    const rowData = formatLeadRow(lead, contact, conversation, options);

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

/**
 * Sincroniza la fila de un lead leyendo su estado ACTUAL de la base. Para los
 * eventos que no pasan por el camino LLM y antes no actualizaban la hoja: el
 * handoff por menú determinístico, cada reasignación del SLA, ATIENDO y LISTO.
 *
 * Best-effort como todo lo de Sheets: nunca lanza.
 *
 * @param {string} leadId
 * @param {{handoffOccurred?: boolean}} [opts]
 */
export async function syncOxfordLeadById(leadId, opts = {}) {
  try {
    const lead = await prisma.oxfordLead.findUnique({ where: { id: leadId }, include: { contact: true } });
    if (!lead || !lead.contact) return;
    await syncOxfordLeadToSheet(lead, lead.contact, null, opts);
  } catch (error) {
    logger.error({ err: error, unit: 'oxford_education', leadId }, 'Error loading Oxford lead for Sheets sync - continuing anyway');
  }
}
