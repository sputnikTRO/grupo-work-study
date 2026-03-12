import { appendRow, updateRow, findRowByColumn } from './client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Google Sheets Leads Sync
 *
 * Syncs lead data to "Leads_Log" sheet for easy dashboarding and CRM integration
 */

const SHEET_NAME = 'Leads_Log';

// Column structure (keep in sync with sheet headers)
const COLUMNS = {
  TIMESTAMP: 0,         // A - timestamp
  NOMBRE: 1,            // B - nombre
  TELEFONO: 2,          // C - telefono
  COLEGIO: 3,           // D - colegio
  PROGRAMA: 4,          // E - programa
  DESTINO: 5,           // F - destino
  EDAD_ESTUDIANTE: 6,   // G - edad_estudiante
  SCORE: 7,             // H - score
  ESTATUS: 8,           // I - estatus
  ASESOR_ASIGNADO: 9,   // J - asesor_asignado
  MATERIALES_ENVIADOS: 10, // K - materiales_enviados
  ULTIMO_CONTACTO: 11,  // L - ultimo_contacto
  NOTAS: 12,            // M - notas
};

/**
 * Formats a lead object into a row array for Google Sheets
 *
 * @param {Object} lead - Lead data from database
 * @param {Object} contact - Contact data from database
 * @param {Object} conversation - Conversation data from database
 * @returns {Array} Row data in correct column order
 */
function formatLeadRow(lead, contact, conversation) {
  return [
    lead.createdAt?.toISOString() || new Date().toISOString(),  // timestamp
    lead.parentName || contact.name || 'Sin nombre',             // nombre
    contact.phone,                                                // telefono
    lead.schoolCode || 'Sin asignar',                            // colegio
    'travel',                                                     // programa
    lead.preferredDestination || 'Sin especificar',              // destino
    lead.travelerAge?.toString() || '',                          // edad_estudiante
    conversation.interestScore?.toString() || '1',               // score
    lead.status || 'activo',                                     // estatus
    conversation.assignedAdvisor || '',                          // asesor_asignado
    (lead.materialsSent || []).join(', '),                       // materiales_enviados
    lead.updatedAt?.toISOString() || new Date().toISOString(),   // ultimo_contacto
    formatNotes(lead, conversation),                             // notas
  ];
}

/**
 * Generates automatic notes from lead and conversation data
 *
 * @param {Object} lead - Lead data
 * @param {Object} conversation - Conversation data
 * @returns {string} Formatted notes
 */
function formatNotes(lead, conversation) {
  const notes = [];

  if (lead.followUpDate) {
    notes.push(`Seguimiento: ${new Date(lead.followUpDate).toLocaleDateString('es-MX')}`);
  }

  if (lead.followUpCount > 0) {
    notes.push(`Intentos seguimiento: ${lead.followUpCount}`);
  }

  if (conversation.status === 'waiting_human') {
    notes.push('Esperando atención humana');
  }

  return notes.join(' | ');
}

/**
 * Syncs a lead to Google Sheets (creates new row or updates existing)
 *
 * @param {Object} lead - Lead object from database
 * @param {Object} contact - Contact object from database
 * @param {Object} conversation - Conversation object from database
 * @returns {Promise<void>}
 */
export async function syncLeadToSheet(lead, contact, conversation) {
  const syncLogger = logger.child({
    leadId: lead.id,
    contactPhone: contact.phone,
    function: 'sheets.syncLeadToSheet'
  });

  try {
    syncLogger.debug('Syncing lead to Google Sheets');

    // Format row data
    const rowData = formatLeadRow(lead, contact, conversation);

    // Check if lead already exists in sheet (search by phone number in column C)
    const existingRow = await findRowByColumn(
      env.GOOGLE_SHEETS_ID,
      SHEET_NAME,
      COLUMNS.TELEFONO,
      contact.phone
    );

    if (existingRow) {
      // Update existing row
      await updateRow(env.GOOGLE_SHEETS_ID, SHEET_NAME, existingRow, rowData);
      syncLogger.info({ rowNumber: existingRow }, 'Lead updated in Google Sheets');
    } else {
      // Append new row
      await appendRow(env.GOOGLE_SHEETS_ID, SHEET_NAME, rowData);
      syncLogger.info('New lead added to Google Sheets');
    }

  } catch (error) {
    // Don't fail the main flow if sheet sync fails - just log the error
    syncLogger.error({ err: error }, 'Error syncing lead to Google Sheets - continuing anyway');
  }
}

/**
 * Creates the header row for Leads_Log sheet
 * Call this once when setting up the sheet for the first time
 *
 * @returns {Array} Header row
 */
export function getLeadsLogHeaders() {
  return [
    'timestamp',
    'nombre',
    'telefono',
    'colegio',
    'programa',
    'destino',
    'edad_estudiante',
    'score',
    'estatus',
    'asesor_asignado',
    'materiales_enviados',
    'ultimo_contacto',
    'notas',
  ];
}

/**
 * Initializes the Leads_Log sheet with headers
 * Only call this if the sheet doesn't exist or is empty
 *
 * @returns {Promise<void>}
 */
export async function initializeLeadsLogSheet() {
  const syncLogger = logger.child({ function: 'sheets.initializeLeadsLogSheet' });

  try {
    syncLogger.info('Initializing Leads_Log sheet with headers');

    const headers = getLeadsLogHeaders();
    await appendRow(env.GOOGLE_SHEETS_ID, SHEET_NAME, headers);

    syncLogger.info('Leads_Log sheet initialized successfully');

  } catch (error) {
    syncLogger.error({ err: error }, 'Error initializing Leads_Log sheet');
    throw error;
  }
}
