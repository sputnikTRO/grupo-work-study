import logger from '../../utils/logger.js';
import * as sheetsCache from '../../core/sheets/cache.js';
import * as leadService from '../../services/lead.service.js';
import * as contactService from '../../services/contact.service.js';
import * as conversationService from '../../services/conversation.service.js';
import * as messageService from '../../services/message.service.js';
import { sendTextMessage, sendMediaMessage, sendMediaMessageByUrl } from '../../core/whatsapp/client.js';
import * as conversation from '../../core/ai/conversation.js';

/**
 * Action Tag Parser and Executor
 *
 * Parses action tags from Claude's response and executes them
 *
 * Supported tags:
 * - [ENVIAR_MATERIAL:ID]
 * - [DERIVAR_ASESOR:razón]
 * - [CAPTURAR_DATO:campo:valor]
 * - [ACTUALIZAR_SCORE:N]
 * - [PROGRAMAR_SEGUIMIENTO:tiempo]
 * - [SOLICITAR_DOCUMENTO:tipo]
 */

// Regex patterns for each action type
const ACTION_PATTERNS = {
  ENVIAR_MATERIAL: /\[ENVIAR_MATERIAL:([^\]]+)\]/g,
  DERIVAR_ASESOR: /\[DERIVAR_ASESOR:([^\]]+)\]/g,
  CAPTURAR_DATO: /\[CAPTURAR_DATO:([^:]+):([^\]]+)\]/g,
  ACTUALIZAR_SCORE: /\[ACTUALIZAR_SCORE:(\d+)\]/g,
  PROGRAMAR_SEGUIMIENTO: /\[PROGRAMAR_SEGUIMIENTO:([^\]]+)\]/g,
  SOLICITAR_DOCUMENTO: /\[SOLICITAR_DOCUMENTO:([^\]]+)\]/g,
};

/**
 * Parses all action tags from Claude's response
 *
 * @param {string} claudeResponse - Raw response from Claude
 * @returns {Array} Array of action objects: {type, ...params}
 */
export function parseActions(claudeResponse) {
  const actions = [];

  // Parse ENVIAR_MATERIAL
  let matches = [...claudeResponse.matchAll(ACTION_PATTERNS.ENVIAR_MATERIAL)];
  for (const match of matches) {
    actions.push({
      type: 'ENVIAR_MATERIAL',
      materialId: match[1].trim(),
    });
  }

  // Parse DERIVAR_ASESOR
  matches = [...claudeResponse.matchAll(ACTION_PATTERNS.DERIVAR_ASESOR)];
  for (const match of matches) {
    actions.push({
      type: 'DERIVAR_ASESOR',
      reason: match[1].trim(),
    });
  }

  // Parse CAPTURAR_DATO
  matches = [...claudeResponse.matchAll(ACTION_PATTERNS.CAPTURAR_DATO)];
  for (const match of matches) {
    actions.push({
      type: 'CAPTURAR_DATO',
      field: match[1].trim(),
      value: match[2].trim(),
    });
  }

  // Parse ACTUALIZAR_SCORE
  matches = [...claudeResponse.matchAll(ACTION_PATTERNS.ACTUALIZAR_SCORE)];
  for (const match of matches) {
    actions.push({
      type: 'ACTUALIZAR_SCORE',
      score: parseInt(match[1], 10),
    });
  }

  // Parse PROGRAMAR_SEGUIMIENTO
  matches = [...claudeResponse.matchAll(ACTION_PATTERNS.PROGRAMAR_SEGUIMIENTO)];
  for (const match of matches) {
    actions.push({
      type: 'PROGRAMAR_SEGUIMIENTO',
      time: match[1].trim(),
    });
  }

  // Parse SOLICITAR_DOCUMENTO
  matches = [...claudeResponse.matchAll(ACTION_PATTERNS.SOLICITAR_DOCUMENTO)];
  for (const match of matches) {
    actions.push({
      type: 'SOLICITAR_DOCUMENTO',
      documentType: match[1].trim(),
    });
  }

  return actions;
}

/**
 * Cleans action tags from Claude's response, leaving only user-visible text
 *
 * @param {string} claudeResponse - Raw response from Claude
 * @returns {string} Clean text without action tags
 */
export function cleanResponse(claudeResponse) {
  let cleaned = claudeResponse;

  // Remove all action tags
  for (const pattern of Object.values(ACTION_PATTERNS)) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove extra blank lines that might result from tag removal
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Trim whitespace
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Executes parsed actions with REAL implementation
 *
 * @param {Array} actions - Array of action objects from parseActions()
 * @param {Object} lead - TravelLead object
 * @param {Object} conversation - Conversation object
 * @param {string} phone - Contact phone number (for WhatsApp)
 * @param {string} phoneNumberId - WhatsApp phone number ID
 * @returns {Promise<void>}
 */
export async function executeActions(actions, lead, conversation, phone, phoneNumberId) {
  const actionsLogger = logger.child({
    leadId: lead.id,
    conversationId: conversation.id,
    actionCount: actions.length,
  });

  if (actions.length === 0) {
    actionsLogger.debug('No actions to execute');
    return;
  }

  actionsLogger.info({ actions }, 'Executing actions');

  for (const action of actions) {
    try {
      await executeAction(action, lead, conversation, phone, phoneNumberId);
    } catch (error) {
      actionsLogger.error({ err: error, action }, 'Error executing action');
      // Continue with other actions even if one fails
    }
  }
}

/**
 * Executes a single action - REAL IMPLEMENTATION
 *
 * @param {Object} action - Action object
 * @param {Object} lead - TravelLead object
 * @param {Object} conversation - Conversation object
 * @param {string} phone - Contact phone number
 * @param {string} phoneNumberId - WhatsApp phone number ID
 * @returns {Promise<void>}
 */
async function executeAction(action, lead, conversation, phone, phoneNumberId) {
  const actionLogger = logger.child({ action: action.type });

  switch (action.type) {
    case 'ENVIAR_MATERIAL':
      await executeSendMaterial(action.materialId, lead, phone, phoneNumberId, actionLogger);
      break;

    case 'DERIVAR_ASESOR':
      await executeHandoffToAdvisor(action.reason, lead, conversation, phone, phoneNumberId, actionLogger);
      break;

    case 'CAPTURAR_DATO':
      await executeCaptureData(action.field, action.value, lead, conversation, actionLogger);
      break;

    case 'ACTUALIZAR_SCORE':
      await executeUpdateScore(action.score, conversation, actionLogger);
      break;

    case 'PROGRAMAR_SEGUIMIENTO':
      await executeScheduleFollowUp(action.time, lead, actionLogger);
      break;

    case 'SOLICITAR_DOCUMENTO':
      await executeRequestDocument(action.documentType, lead, actionLogger);
      break;

    default:
      actionLogger.warn({ actionType: action.type }, 'Unknown action type');
  }
}

/**
 * [ENVIAR_MATERIAL:ID] - Sends material via WhatsApp
 */
async function executeSendMaterial(materialId, lead, phone, phoneNumberId, actionLogger) {
  actionLogger.info({ materialId }, 'Sending material');

  try {
    // Get material from cache
    const material = await sheetsCache.getMaterial(materialId);

    if (!material) {
      actionLogger.warn({ materialId }, 'Material not found in cache');
      return;
    }

    const materialUrl = material.url || material.contenido;

    if (!materialUrl) {
      actionLogger.warn('Material has no URL or content');
      return;
    }

    // Determine if URL is a media file (PDF, image) or generic link
    const urlLower = materialUrl.toLowerCase();
    const tipoLower = (material.tipo || '').toLowerCase();

    // Check tipo field first (case-insensitive), then fallback to URL pattern
    const isPdf = tipoLower === 'pdf' || tipoLower === 'document' || urlLower.endsWith('.pdf');
    const isImage = tipoLower === 'imagen' || tipoLower === 'image' || urlLower.match(/\.(jpg|jpeg|png|gif|webp)$/i);

    if (isPdf) {
      // Send PDF as document
      actionLogger.info('Sending PDF document via WhatsApp');
      await sendMediaMessageByUrl(
        phone,
        'document',
        materialUrl,
        null, // No caption for documents
        material.nombre || 'documento.pdf',
        phoneNumberId
      );
      actionLogger.info('PDF document sent successfully');

    } else if (isImage) {
      // Send image
      actionLogger.info('Sending image via WhatsApp');
      await sendMediaMessageByUrl(
        phone,
        'image',
        materialUrl,
        material.descripcion || null, // Image caption
        null,
        phoneNumberId
      );
      actionLogger.info('Image sent successfully');

    } else {
      // Send as text message with link
      actionLogger.info('Sending link as text message');
      const linkMessage = material.descripcion
        ? `${material.descripcion}\n\n${materialUrl}`
        : materialUrl;

      await sendTextMessage(phone, linkMessage, phoneNumberId);
      actionLogger.info('Link sent as text message');
    }

    // Update lead with material sent
    await leadService.addMaterialSent(lead.id, materialId);
    actionLogger.info('Material added to lead sent list');

  } catch (error) {
    actionLogger.error({ err: error }, 'Error sending material');
    // Don't throw - continue with other actions
  }
}

/**
 * [DERIVAR_ASESOR:razón] - Handoff to human advisor
 */
async function executeHandoffToAdvisor(reason, lead, conv, phone, phoneNumberId, actionLogger) {
  actionLogger.info({ reason }, 'Handing off to advisor');

  try {
    // Get advisor for this school
    const advisor = lead.schoolCode ? await sheetsCache.getAdvisor(lead.schoolCode) : null;

    // Send farewell message to prospect
    let farewellMessage = advisor
      ? `Con gusto le comunico con ${advisor.nombre}, nuestra asesora especializada que podrá darle una atención personalizada.`
      : `Con gusto le comunico con una de nuestras asesoras que podrá darle una atención personalizada.`;

    farewellMessage += '\n\nElla le contactará en breve por este mismo medio. ¡Gracias por su interés! 😊';

    await sendTextMessage(phone, farewellMessage, phoneNumberId);
    actionLogger.info('Farewell message sent to prospect');

    // Update conversation status to waiting_human
    await conversationService.update(conv.id, {
      status: 'waiting_human',
      assignedAgent: advisor?.nombre || 'Sin asignar',
    });

    // Update lead status
    await leadService.updateTravelLeadStatus(lead.id, 'derivado_asesor');

    // Send notification to advisor via WhatsApp
    if (advisor && advisor.whatsapp) {
      await sendAdvisorNotification(advisor, lead, conv, phone, reason, phoneNumberId, actionLogger);
    } else {
      actionLogger.warn('No advisor WhatsApp found, notification not sent');
    }

  } catch (error) {
    actionLogger.error({ err: error }, 'Error during handoff');
  }
}

/**
 * Sends WhatsApp notification to advisor when lead is handed off
 */
async function sendAdvisorNotification(advisor, lead, conv, prospectPhone, reason, phoneNumberId, actionLogger) {
  try {
    actionLogger.info({ advisorWhatsApp: advisor.whatsapp }, 'Sending notification to advisor');

    // Get conversation history for summary
    const history = await conversation.getHistory(conv.id);
    const recentMessages = history.slice(-6); // Last 3 exchanges (6 messages)

    // Build conversation summary
    let conversationSummary = '';
    if (recentMessages.length > 0) {
      conversationSummary = '\n\n📝 *Últimos intercambios:*\n';
      for (const msg of recentMessages) {
        const prefix = msg.role === 'user' ? '👤' : '🤖';
        const text = msg.content.substring(0, 100); // Truncate long messages
        conversationSummary += `${prefix} ${text}${msg.content.length > 100 ? '...' : ''}\n`;
      }
    }

    // Get school info
    const school = lead.schoolCode ? await sheetsCache.getSchool(lead.schoolCode) : null;

    // Build notification message
    const notification = `🔔 *NUEVO LEAD DE ALTA PRIORIDAD*

👤 *Contacto:*
${lead.parentName ? `Padre/Madre: ${lead.parentName}` : 'Nombre: No capturado'}
${lead.travelerName ? `Estudiante: ${lead.travelerName}` : ''}
${lead.travelerAge ? `Edad: ${lead.travelerAge} años` : ''}

🏫 *Colegio:*
${school ? school.nombre : lead.schoolCode || 'No detectado'}

📊 *Score de Interés:* ${conv.interestScore}/10
📌 *Razón de Derivación:* ${reason}

📱 *WhatsApp del Prospecto:*
${prospectPhone}
${conversationSummary}
---
_Este lead fue derivado automáticamente por el bot._
_Por favor contacta al prospecto lo antes posible._`;

    // Send notification to advisor's WhatsApp
    await sendTextMessage(advisor.whatsapp, notification, phoneNumberId);

    actionLogger.info('Advisor notification sent successfully');

  } catch (error) {
    actionLogger.error({ err: error }, 'Error sending advisor notification');
    // Don't throw - handoff should continue even if notification fails
  }
}

/**
 * [CAPTURAR_DATO:campo:valor] - Captures lead data
 */
async function executeCaptureData(field, value, lead, conversation, actionLogger) {
  actionLogger.info({ field, value }, 'Capturing data');

  try {
    const leadFields = ['parent_name', 'traveler_name', 'traveler_age', 'school_code', 'program_interest', 'budget_range', 'destination'];

    if (leadFields.includes(field)) {
      // Update lead
      const updateData = {};

      // Map field names to camelCase
      const fieldMapping = {
        parent_name: 'parentName',
        traveler_name: 'travelerName',
        traveler_age: 'travelerAge',
        school_code: 'schoolCode',
        program_interest: 'programInterest',
        budget_range: 'budgetRange',
        destination: 'destination',
      };

      const mappedField = fieldMapping[field] || field;

      // Parse travelerAge as integer
      if (mappedField === 'travelerAge') {
        updateData[mappedField] = parseInt(value, 10);
      } else {
        updateData[mappedField] = value;
      }

      await leadService.updateTravelLead(lead.id, updateData);
      actionLogger.info({ mappedField }, 'Lead updated');

      // Also update contact if it's name or email
      if (field === 'parent_name') {
        await contactService.update(conversation.contactId, { name: value });
        actionLogger.info('Contact name updated');
      }
    } else {
      actionLogger.warn({ field }, 'Unknown field, ignoring');
    }

  } catch (error) {
    actionLogger.error({ err: error }, 'Error capturing data');
  }
}

/**
 * [ACTUALIZAR_SCORE:N] - Updates interest score
 */
async function executeUpdateScore(score, conversation, actionLogger) {
  actionLogger.info({ score }, 'Updating interest score');

  try {
    await conversationService.updateInterestScore(conversation.id, score);
    actionLogger.info({ score }, 'Interest score updated');

  } catch (error) {
    actionLogger.error({ err: error }, 'Error updating score');
  }
}

/**
 * [PROGRAMAR_SEGUIMIENTO:tiempo] - Schedules follow-up
 */
async function executeScheduleFollowUp(time, lead, actionLogger) {
  actionLogger.info({ time }, 'Scheduling follow-up');

  try {
    // Parse time string (e.g., "24h", "3d")
    const followUpDate = parseFollowUpTime(time);

    if (!followUpDate) {
      actionLogger.warn({ time }, 'Unable to parse follow-up time');
      return;
    }

    await leadService.updateTravelLead(lead.id, {
      followUpDate,
      followUpCount: lead.followUpCount || 0,
    });

    actionLogger.info({ followUpDate }, 'Follow-up scheduled');

  } catch (error) {
    actionLogger.error({ err: error }, 'Error scheduling follow-up');
  }
}

/**
 * [SOLICITAR_DOCUMENTO:tipo] - Registers document request
 * Note: Claude's response should already include the user-facing message asking for the document
 * This function just logs the request in the lead notes for tracking
 */
async function executeRequestDocument(documentType, lead, actionLogger) {
  actionLogger.info({ documentType }, 'Requesting document');

  try {
    // Add to lead notes that this document was requested
    const timestamp = new Date().toISOString();
    const noteEntry = `[${timestamp}] Documento solicitado: ${documentType}`;

    const currentNotes = lead.notes || '';
    const updatedNotes = currentNotes
      ? `${currentNotes}\n${noteEntry}`
      : noteEntry;

    await leadService.updateTravelLead(lead.id, {
      notes: updatedNotes,
    });

    actionLogger.info({ documentType }, 'Document request logged in lead notes');

  } catch (error) {
    actionLogger.error({ err: error }, 'Error logging document request');
  }
}

/**
 * Parses follow-up time string to Date
 *
 * @param {string} time - Time string (e.g., "24h", "3d", "1w")
 * @returns {Date|null} Follow-up date or null
 */
function parseFollowUpTime(time) {
  const match = time.match(/^(\d+)(h|d|w)$/);

  if (!match) {
    return null;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  const now = new Date();

  if (unit === 'h') {
    return new Date(now.getTime() + amount * 60 * 60 * 1000);
  } else if (unit === 'd') {
    return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
  } else if (unit === 'w') {
    return new Date(now.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
  }

  return null;
}

/**
 * Validates if an action is well-formed
 *
 * @param {Object} action - Action object
 * @returns {boolean} True if valid
 */
export function validateAction(action) {
  if (!action || !action.type) {
    return false;
  }

  switch (action.type) {
    case 'ENVIAR_MATERIAL':
      return !!action.materialId;

    case 'DERIVAR_ASESOR':
      return !!action.reason;

    case 'CAPTURAR_DATO':
      return !!action.field && action.value !== undefined;

    case 'ACTUALIZAR_SCORE':
      return typeof action.score === 'number' && action.score >= 1 && action.score <= 10;

    case 'PROGRAMAR_SEGUIMIENTO':
      return !!action.time;

    case 'SOLICITAR_DOCUMENTO':
      return !!action.documentType;

    default:
      return false;
  }
}

/**
 * Gets a summary of actions for logging
 *
 * @param {Array} actions - Array of actions
 * @returns {Object} Summary by action type
 */
export function getActionsSummary(actions) {
  const summary = {
    total: actions.length,
    byType: {},
  };

  for (const action of actions) {
    if (!summary.byType[action.type]) {
      summary.byType[action.type] = 0;
    }
    summary.byType[action.type]++;
  }

  return summary;
}
