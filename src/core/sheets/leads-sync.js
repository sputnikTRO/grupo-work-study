import { appendRow, updateRow, findRowByColumn } from './client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Google Sheets Leads Sync
 *
 * Syncs lead data to "Leads" sheet for easy dashboarding and CRM integration
 *
 * NUEVA ESTRUCTURA SIMPLIFICADA (Mayo 2026):
 * - Sheet name: "Leads" (previously "Leads_Log")
 * - Headers en español
 * - 14 columnas en total
 */

const SHEET_NAME = 'Leads';

// Column structure (keep in sync with sheet headers)
// Headers: ID | Fecha | Nombre Padre | Nombre Viajero | Edad | Colegio | WhatsApp | Interés | Estado | Materiales Enviados | Asesor Asignado | Última Actualización | Canal | Notas
const COLUMNS = {
  ID: 0,                      // A - ID (lead ID from database)
  FECHA: 1,                   // B - Fecha (creation date)
  NOMBRE_PADRE: 2,            // C - Nombre Padre
  NOMBRE_VIAJERO: 3,          // D - Nombre Viajero
  EDAD: 4,                    // E - Edad
  COLEGIO: 5,                 // F - Colegio
  WHATSAPP: 6,                // G - WhatsApp
  INTERES: 7,                 // H - Interés (score 1-10)
  ESTADO: 8,                  // I - Estado (activo, derivado_asesor, etc)
  MATERIALES_ENVIADOS: 9,     // J - Materiales Enviados
  ASESOR_ASIGNADO: 10,        // K - Asesor Asignado
  ULTIMA_ACTUALIZACION: 11,   // L - Última Actualización
  CANAL: 12,                  // M - Canal (WhatsApp)
  NOTAS: 13,                  // N - Notas
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
    lead.id?.toString() || '',                                      // ID
    lead.createdAt?.toISOString() || new Date().toISOString(),     // Fecha
    lead.parentName || contact.name || 'Sin nombre',               // Nombre Padre
    lead.travelerName || 'Sin capturar',                           // Nombre Viajero
    lead.travelerAge?.toString() || '',                            // Edad
    lead.schoolCode || 'Sin asignar',                              // Colegio
    contact.phone,                                                  // WhatsApp
    conversation.interestScore?.toString() || '1',                 // Interés
    lead.status || 'activo',                                       // Estado
    (lead.materialsSent || []).join(', '),                         // Materiales Enviados
    conversation.assignedAgent || conversation.assignedAdvisor || '', // Asesor Asignado
    lead.updatedAt?.toISOString() || new Date().toISOString(),     // Última Actualización
    'WhatsApp',                                                     // Canal
    formatNotes(lead, conversation),                               // Notas
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

  if (lead.destination) {
    notes.push(`Destino: ${lead.destination}`);
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

    // Check if lead already exists in sheet (search by ID in column A)
    const existingRow = await findRowByColumn(
      env.GOOGLE_SHEETS_ID,
      SHEET_NAME,
      COLUMNS.ID,
      lead.id?.toString()
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
 * Creates the header row for Leads sheet
 * Call this once when setting up the sheet for the first time
 *
 * @returns {Array} Header row (Spanish headers)
 */
export function getLeadsLogHeaders() {
  return [
    'ID',
    'Fecha',
    'Nombre Padre',
    'Nombre Viajero',
    'Edad',
    'Colegio',
    'WhatsApp',
    'Interés',
    'Estado',
    'Materiales Enviados',
    'Asesor Asignado',
    'Última Actualización',
    'Canal',
    'Notas',
  ];
}

/**
 * Initializes the Leads sheet with headers
 * Only call this if the sheet doesn't exist or is empty
 *
 * @returns {Promise<void>}
 */
export async function initializeLeadsLogSheet() {
  const syncLogger = logger.child({ function: 'sheets.initializeLeadsLogSheet' });

  try {
    syncLogger.info('Initializing Leads sheet with headers');

    const headers = getLeadsLogHeaders();
    await appendRow(env.GOOGLE_SHEETS_ID, SHEET_NAME, headers);

    syncLogger.info('Leads sheet initialized successfully');

  } catch (error) {
    syncLogger.error({ err: error }, 'Error initializing Leads sheet');
    throw error;
  }
}
