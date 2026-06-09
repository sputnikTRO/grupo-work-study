import { appendRow, updateRow, findRowByColumn, sheetExists, createSheet } from '../../core/sheets/client.js';
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

// Column order (A..K). Column A (ID) is the upsert key.
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
  'Resumen conversación',     // K - short summary
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
 * Builds the row array in column order.
 */
function formatLeadRow(lead, contact, conversation, { handoffOccurred, summary }) {
  const roleParts = [lead.role, lead.leadType ? LEAD_TYPE_LABELS[lead.leadType] : null].filter(Boolean);

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
    (summary || '').slice(0, 480),                                        // K Resumen
  ];
}

let sheetReady = false;

/**
 * Ensures the dedicated tab exists with a header row (runs once per process).
 */
async function ensureSheet() {
  if (sheetReady) return;

  const exists = await sheetExists(SPREADSHEET_ID, SHEET_NAME);
  if (!exists) {
    await createSheet(SPREADSHEET_ID, SHEET_NAME);
    await appendRow(SPREADSHEET_ID, SHEET_NAME, HEADERS);
    logger.info({ unit: 'oxford_education', sheet: SHEET_NAME }, 'Created Oxford leads sheet with headers');
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
