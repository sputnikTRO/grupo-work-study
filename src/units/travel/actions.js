import logger from '../../utils/logger.js';
import prisma from '../../core/database/client.js';
import { env } from '../../config/env.js';
import * as sheetsCache from '../../core/sheets/cache.js';
import * as leadService from '../../services/lead.service.js';
import * as contactService from '../../services/contact.service.js';
import { normalizePhone } from '../../utils/phone.js';
import * as conversationService from '../../services/conversation.service.js';
import * as messageService from '../../services/message.service.js';
import { sendTextMessage, sendTemplateMessage, sendMediaMessage, sendMediaMessageByUrl } from '../../core/whatsapp/client.js';
import * as conversation from '../../core/ai/conversation.js';
import { getOrUploadMedia, getMimeType } from '../../core/whatsapp/media-uploader.js';

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
    return { handoffOccurred: false };
  }

  actionsLogger.info({ actions }, 'Executing actions');

  let handoffOccurred = false;

  for (const action of actions) {
    try {
      const result = await executeAction(action, lead, conversation, phone, phoneNumberId);
      // Solo cuenta como handoff (silencia el texto de Miri este turno) cuando el
      // handoff REALMENTE ocurrió. Si el guard lo saltó (lead ya derivado), result=false
      // y Miri responde con su texto normal.
      if (action.type === 'DERIVAR_ASESOR' && result === true) handoffOccurred = true;
    } catch (error) {
      actionsLogger.error({ err: error, action }, 'Error executing action');
      // Continue with other actions even if one fails
    }
  }

  return { handoffOccurred };
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
      return await executeHandoffToAdvisor(action.reason, lead, conversation, phone, phoneNumberId, actionLogger);

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
 * Converts Google Drive URLs to direct download format
 *
 * Handles various Google Drive URL formats and converts them to use
 * drive.usercontent.google.com which provides direct file access
 * without HTML confirmation pages (even for large files)
 *
 * @param {string} url - Original URL (may or may not be Google Drive)
 * @returns {string} - Converted URL or original if not Google Drive
 */
function convertGoogleDriveUrl(url) {
  // Extract file ID from various Google Drive URL formats
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,           // /file/d/ID
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,           // /open?id=ID
    /drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/,             // /uc?id=ID
    /drive\.google\.com\/u\/\d+\/uc\?id=([a-zA-Z0-9_-]+)/,     // /u/0/uc?id=ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      const fileId = match[1];
      // Use drive.usercontent.google.com for direct download without confirmation page
      // This format works reliably with WhatsApp Cloud API even for large files
      return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0`;
    }
  }

  // Not a Google Drive URL, return as-is
  return url;
}

/**
 * [ENVIAR_MATERIAL:ID] - Sends material via WhatsApp
 *
 * Uses WhatsApp's media upload API for reliable delivery:
 * 1. Downloads file from source (Google Drive, etc)
 * 2. Uploads to WhatsApp and gets media_id (cached for 29 days)
 * 3. Sends using media_id (more reliable than external URLs)
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

    // New structure uses 'URL' column instead of 'url' or 'contenido'
    let materialUrl = material['URL'] || material.url || material.contenido;

    if (!materialUrl) {
      actionLogger.warn('Material has no URL or content');
      return;
    }

    // Note: We DON'T convert Google Drive URLs here because media-uploader.js
    // has logic to detect drive.google.com URLs and use authenticated Google Drive API,
    // which works for private files. Converting to drive.usercontent.google.com
    // breaks that detection and only works for public files.
    // See: src/core/whatsapp/media-uploader.js lines 25-38

    // Determine media type
    const urlLower = materialUrl.toLowerCase();
    // New structure uses 'Tipo' column instead of 'tipo'
    const tipoLower = (material['Tipo'] || material.tipo || '').toLowerCase();

    // Check tipo field first (case-insensitive), then fallback to URL pattern
    const isPdf = tipoLower === 'pdf' || tipoLower === 'document' || urlLower.endsWith('.pdf');
    const isImage = tipoLower === 'imagen' || tipoLower === 'image' || urlLower.match(/\.(jpg|jpeg|png|gif|webp)$/i);

    if (isPdf || isImage) {
      // Upload to WhatsApp and get media_id (or use cached media_id)
      const mimeType = getMimeType(material['Tipo'] || material.tipo, materialUrl);
      // New structure uses 'Nombre' column instead of 'nombre'
      const filename = material['Nombre'] || material.nombre || (isPdf ? 'documento.pdf' : 'imagen.jpg');

      actionLogger.info({ materialId, mimeType, filename }, 'Uploading media to WhatsApp');

      const mediaId = await getOrUploadMedia(
        materialId,
        materialUrl,
        mimeType,
        filename,
        phoneNumberId
      );

      // Send using media_id (more reliable than URL)
      if (isPdf) {
        actionLogger.info({ mediaId, filename }, 'Sending PDF document via WhatsApp using media_id');
        await sendMediaMessage(
          phone,
          'document',
          mediaId,
          null, // No caption for documents
          filename, // Filename for the document
          phoneNumberId
        );
        actionLogger.info('PDF document sent successfully');

      } else if (isImage) {
        actionLogger.info({ mediaId }, 'Sending image via WhatsApp using media_id');
        await sendMediaMessage(
          phone,
          'image',
          mediaId,
          material['Descripción'] || material.descripcion || null, // Image caption
          null, // No filename for images
          phoneNumberId
        );
        actionLogger.info('Image sent successfully');
      }

    } else {
      // Send as text message with link
      actionLogger.info('Sending link as text message');
      // New structure uses 'Descripción' column instead of 'descripcion'
      const descripcion = material['Descripción'] || material.descripcion;
      const linkMessage = descripcion
        ? `${descripcion}\n\n${materialUrl}`
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

// Catálogo centralizado de asesores
const ADVISORS = {
  cecilia: {
    nombre: 'Cecilia Rodríguez',
    whatsapp: '5544884437',
    email: 'cecilia@oxfordeducationlit.org',
    tipo: 'familia',
  },
  camila: {
    nombre: 'Camila Serafín',
    whatsapp: '5539771457',
    email: 'camila.serafin@oxfordeducationlit.org',
    tipo: 'familia',
  },
  miguel: {
    nombre: 'Miguel Rodríguez',
    whatsapp: '5651070832',
    email: 'customer.experience@oxfordeducationlit.org',
    tipo: 'institucion',
  },
};

/**
 * Resuelve el objeto advisor a partir de un nombre guardado en BD
 */
function resolveAdvisorByName(name) {
  return Object.values(ADVISORS).find(a => a.nombre === name) || null;
}

/**
 * [DERIVAR_ASESOR:razón] - Handoff to human advisor
 *
 * Lógica de asignación (en orden):
 * 1. ¿Ya tiene assigned_advisor? → usar ese
 * 2. ¿Es institución? → Miguel siempre
 * 3. ¿Tiene colegio registrado en Sheets? → asesora del sheet
 * 4. ¿Colegio no registrado? → carrusel Cecy/Cami
 * 5. ¿Sin colegio? → carrusel Cecy/Cami (familia es el default)
 */
async function executeHandoffToAdvisor(reason, lead, conv, phone, phoneNumberId, actionLogger) {
  actionLogger.info({ reason, leadType: lead.leadType }, 'Handing off to advisor (warm)');

  try {
    // Guard anti-redisparo: si el lead ya está derivado, NO re-notificamos ni
    // duplicamos ticket. Miri sigue activa (handoff tibio) y responde otras dudas.
    if (lead.status === 'derivado_asesor') {
      actionLogger.info({ assignedAdvisor: lead.assignedAdvisor }, 'Lead already handed off — skipping re-notify (warm handoff)');
      return false; // no fue un handoff nuevo → el handler enviará el texto normal de Miri
    }

    let advisor = null;

    // 1. Ya tiene asesora asignada desde antes
    if (lead.assignedAdvisor) {
      advisor = resolveAdvisorByName(lead.assignedAdvisor);
      actionLogger.info({ assignedAdvisor: lead.assignedAdvisor }, 'Using pre-assigned advisor');
    }

    // 2. Institución → Miguel siempre
    if (!advisor && lead.leadType === 'institucion') {
      advisor = ADVISORS.miguel;
      actionLogger.info('Institution lead → assigning Miguel Rodríguez');
    }

    // 3. Tiene colegio → buscar en Sheets
    if (!advisor && lead.schoolCode) {
      advisor = await sheetsCache.getAdvisor(lead.schoolCode);
      if (advisor) actionLogger.info({ schoolCode: lead.schoolCode }, 'Using advisor from school registry');
    }

    // 4 y 5. Sin asesora aún (colegio no registrado o sin colegio) → carrusel Cecy/Cami
    if (!advisor) {
      advisor = await assignFamilyCarousel(actionLogger);
      actionLogger.info({ advisor: advisor.nombre }, 'Assigned via family carousel');
    }

    // Persistir asesora en el lead para futuros handoffs
    if (advisor && !lead.assignedAdvisor) {
      await leadService.updateTravelLead(lead.id, { assignedAdvisor: advisor.nombre });
    }

    // Mensaje al prospecto: la asesora lo contacta desde SU propio número; Miri
    // sigue disponible en este chat para otras dudas (handoff tibio).
    const esInstitucion = lead.leadType === 'institucion';
    const titulo = esInstitucion ? 'nuestro ejecutivo especializado' : 'nuestra asesora especializada';
    let farewellMessage = advisor
      ? `¡Con gusto! 😊 Te conecto con ${advisor.nombre}, ${titulo}. Te contactará en breve por WhatsApp para una atención personalizada.`
      : `¡Con gusto! 😊 Te conecto con uno de nuestros asesores, que te contactará en breve por WhatsApp.`;
    farewellMessage += '\n\nMientras tanto, aquí sigo para cualquier otra duda. 🙌';

    await sendTextMessage(phone, farewellMessage, phoneNumberId);
    actionLogger.info('Warm handoff message sent to prospect');

    // Handoff TIBIO: la conversación queda ACTIVA (NO waiting_human), así Miri
    // sigue respondiendo. Solo marcamos el asesor asignado en la conversación.
    await conversationService.update(conv.id, { assignedAgent: advisor?.nombre || 'Sin asignar' });

    // Marcar el lead como derivado (tracking + guard anti-redisparo).
    await leadService.updateTravelLeadStatus(lead.id, 'derivado_asesor');
    lead.status = 'derivado_asesor';

    // Notificar al asesor por WhatsApp
    if (advisor?.whatsapp) {
      await sendAdvisorNotification(advisor, lead, conv, phone, reason, phoneNumberId, actionLogger);
    } else {
      actionLogger.warn('No advisor WhatsApp found, notification not sent');
    }

    return true; // handoff nuevo realizado (despedida enviada) → el handler NO manda otro texto

  } catch (error) {
    actionLogger.error({ err: error }, 'Error during handoff');
    return false; // en error, deja que Miri responda con su texto (no la silencies)
  }
}

/**
 * Formats a 10-digit Mexican phone number with spaces: 5535305000 → 55 3530 5000
 */
function formatPhoneReadable(phone) {
  // Strip everything except digits
  const digits = phone.replace(/\D/g, '');
  // Take last 10 digits (local Mexican number)
  const local = digits.slice(-10);
  if (local.length === 10) {
    return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  return phone; // fallback: return as-is
}

/**
 * Builds a 1-2 line natural language summary of the conversation
 * using lead data — no extra Claude call needed.
 */
function buildConversationSummary(lead, reason, schoolName) {
  const destino = lead.destination || lead.programInterest || 'destino por definir';

  if (lead.leadType === 'institucion') {
    return `Representante de ${schoolName} preguntando por ${reason}.`;
  }

  const nombre   = lead.parentName  || 'Prospecto';
  const viajero  = lead.travelerName || 'su hijo/a';
  const edad     = lead.travelerAge  ? `${lead.travelerAge} años` : 'edad no capturada';

  return `${nombre} interesado/a en E4L ${destino} para ${viajero} (${edad}). ${reason}.`;
}

/**
 * Sends WhatsApp notification to advisor when lead is handed off
 */
async function sendAdvisorNotification(advisor, lead, conv, prospectPhone, reason, phoneNumberId, actionLogger) {
  try {
    actionLogger.info({ advisorWhatsApp: advisor.whatsapp }, 'Sending notification to advisor');

    // School display name
    const school = lead.schoolCode ? await sheetsCache.getSchool(lead.schoolCode) : null;
    const schoolName = school
      ? (school['Nombre Colegio'] || school.nombre || lead.schoolCode)
      : (lead.schoolCode || 'Colegio no detectado');

    // Lead type label
    const leadTypeLabel = lead.leadType === 'institucion' ? 'institución' : 'padre/madre';

    // Destination label
    const destinoLabel = lead.destination || (lead.programInterest ? lead.programInterest.replace('English 4 Life ', '') : null) || 'destino no definido';

    // Formatted phone (last 10 digits with spaces)
    const phoneFormatted = formatPhoneReadable(prospectPhone);

    // Natural language summary (no extra Claude call)
    const summary = buildConversationSummary(lead, reason, schoolName);

    const ticket = lead.ticketNumber || '?';

    // normalizePhone adds +521 prefix, then strip '+' for WhatsApp Cloud API (E.164 without +)
    const advisorPhone = normalizePhone(advisor.whatsapp).replace('+', '');

    // 1) PLANTILLA aprobada: se entrega SIEMPRE, aun fuera de la ventana de 24h.
    // Los avisos de lead son mensajes iniciados por el negocio; el texto libre solo
    // se entrega si el asesor escribió al número en las últimas 24h.
    try {
      const clean = (s, n) => String(s ?? '—').replace(/\s+/g, ' ').trim().slice(0, n) || '—';
      const params = [
        ticket,                                                                          // {{1}}
        clean(lead.parentName || 'No capturado', 60),                                    // {{2}}
        leadTypeLabel,                                                                   // {{3}}
        clean(`${lead.travelerName || 'No capturado'}, ${lead.travelerAge ? `${lead.travelerAge} años` : 'edad no capturada'}`, 80), // {{4}}
        clean(`${schoolName} — ${destinoLabel}`, 100),                                   // {{5}}
        `${conv.interestScore ?? 0}`,                                                    // {{6}}
        phoneFormatted,                                                                  // {{7}}
        clean(reason, 300),                                                              // {{8}}
        clean(summary, 400),                                                             // {{9}}
      ];
      const components = [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }];
      await sendTemplateMessage(advisorPhone, env.TRAVEL_ADVISOR_TEMPLATE_NAME, env.TRAVEL_ADVISOR_TEMPLATE_LANG, components, phoneNumberId);
      actionLogger.info({ advisorPhone, via: 'template' }, 'Advisor notification sent');
      return;
    } catch (tplErr) {
      actionLogger.warn({ err: tplErr, template: env.TRAVEL_ADVISOR_TEMPLATE_NAME }, 'Template notification failed, falling back to free-form text');
    }

    // 2) RESPALDO: texto libre (solo entrega dentro de la ventana de 24h).
    const notification = `🔔 *Nuevo lead #${ticket}*

👤 ${lead.parentName || 'No capturado'} (${leadTypeLabel})
👨‍🎓 ${lead.travelerName || 'No capturado'}, ${lead.travelerAge ? `${lead.travelerAge} años` : 'edad no capturada'}
🏫 ${schoolName} — ${destinoLabel}
📊 Interés: ${conv.interestScore}/10
📱 ${phoneFormatted}

📌 Razón: ${reason}

💬 *Resumen:*
${summary}

---
Responde aquí:
✅ *LISTO ${ticket}* → cuando termines de atenderlo
🔄 *REGRESA ${ticket}* → si quieres que Miri retome`;
    await sendTextMessage(advisorPhone, notification, phoneNumberId);
    actionLogger.info({ advisorPhone, via: 'text' }, 'Advisor notification sent (fallback text)');

  } catch (error) {
    actionLogger.error({ err: error }, 'Error sending advisor notification');
    // Don't throw - handoff should continue even if notification fails
  }
}

/**
 * Carrusel de asesoras de FAMILIA: Cecilia ↔ Camila según carga actual
 * Se usa cuando no hay colegio registrado en Sheets o no hay colegio capturado.
 */
async function assignFamilyCarousel(actionLogger) {
  try {
    const counts = await prisma.travelLead.groupBy({
      by: ['assignedAdvisor'],
      where: { assignedAdvisor: { in: [ADVISORS.cecilia.nombre, ADVISORS.camila.nombre] } },
      _count: { assignedAdvisor: true },
    });

    const ceciliaCount = counts.find(r => r.assignedAdvisor === ADVISORS.cecilia.nombre)?._count.assignedAdvisor ?? 0;
    const camilaCount  = counts.find(r => r.assignedAdvisor === ADVISORS.camila.nombre)?._count.assignedAdvisor ?? 0;

    const advisor = ceciliaCount <= camilaCount ? ADVISORS.cecilia : ADVISORS.camila;

    actionLogger.info({ ceciliaCount, camilaCount, assigned: advisor.nombre }, 'Family carousel assigned');
    return advisor;

  } catch (error) {
    actionLogger.error({ err: error }, 'Error in family carousel, defaulting to Cecilia');
    return ADVISORS.cecilia;
  }
}

/**
 * Asigna asesora al capturar school_code.
 *
 * Lógica:
 * 1. Institución → Miguel
 * 2. Colegio registrado en Sheets → asesora del sheet
 * 3. Colegio nuevo → carrusel Cecy/Cami
 */
async function assignAdvisorWithCarousel(schoolName, lead, actionLogger) {
  try {
    // 1. Institución → Miguel siempre
    if (lead.leadType === 'institucion') {
      actionLogger.info('Institution lead → assigning Miguel Rodríguez');
      return ADVISORS.miguel;
    }

    // 2. Colegio registrado en Sheets
    const school = await sheetsCache.getSchoolByName(schoolName);
    if (school) {
      const sheetAdvisor = await sheetsCache.getAdvisor(schoolName);
      if (sheetAdvisor) {
        actionLogger.info({ school: schoolName, advisor: sheetAdvisor.nombre }, 'Using advisor from school registry');
        return sheetAdvisor;
      }
    }

    // 3. Colegio nuevo → carrusel familia
    actionLogger.info({ school: schoolName }, 'School not in registry, using family carousel');
    return await assignFamilyCarousel(actionLogger);

  } catch (error) {
    actionLogger.error({ err: error, school: schoolName }, 'Error assigning advisor, defaulting to Cecilia');
    return ADVISORS.cecilia;
  }
}

/**
 * [CAPTURAR_DATO:campo:valor] - Captures lead data
 */
async function executeCaptureData(field, value, lead, conversation, actionLogger) {
  actionLogger.info({ field, value }, 'Capturing data');

  // ── DEBUG ─────────────────────────────────────────────────────────────────
  console.log(`[MIRI-DEBUG] CAPTURAR_DATO → field="${field}" value="${value}" leadId=${lead.id}`);

  try {
    const leadFields = ['parent_name', 'traveler_name', 'traveler_age', 'school_code', 'program_interest', 'budget_range', 'destination', 'lead_type'];

    if (leadFields.includes(field)) {
      const updateData = {};

      const fieldMapping = {
        parent_name:      'parentName',
        traveler_name:    'travelerName',
        traveler_age:     'travelerAge',
        school_code:      'schoolCode',
        program_interest: 'programInterest',
        budget_range:     'budgetRange',
        destination:      'destination',
        lead_type:        'leadType',
      };

      const mappedField = fieldMapping[field] || field;

      if (mappedField === 'travelerAge') {
        updateData[mappedField] = parseInt(value, 10);
      } else {
        updateData[mappedField] = value;
      }

      // Al capturar lead_type=institucion → asignar Miguel de inmediato
      if (mappedField === 'leadType' && value === 'institucion' && !lead.assignedAdvisor) {
        updateData.assignedAdvisor = ADVISORS.miguel.nombre;
        actionLogger.info('Institution detected → assigning Miguel Rodríguez');
      }

      // Al capturar school_code → asignar asesora según tipo y registro
      if (mappedField === 'schoolCode') {
        const updatedLead = { ...lead, ...updateData }; // incluye leadType recién capturado si aplica
        const advisor = await assignAdvisorWithCarousel(value, updatedLead, actionLogger);
        if (advisor) {
          updateData.assignedAdvisor = advisor.nombre;
          actionLogger.info({ school: value, advisor: advisor.nombre }, 'Advisor assigned to lead');
        }
      }

      console.log(`[MIRI-DEBUG] CAPTURAR_DATO updateData:`, JSON.stringify(updateData));
      await leadService.updateTravelLead(lead.id, updateData);
      actionLogger.info({ mappedField }, 'Lead updated');
      console.log(`[MIRI-DEBUG] CAPTURAR_DATO ✅ lead ${lead.id} updated OK`);

      if (field === 'parent_name') {
        await contactService.update(conversation.contactId, { name: value });
        actionLogger.info('Contact name updated');
      }
    } else {
      actionLogger.warn({ field }, 'Unknown field, ignoring');
      console.log(`[MIRI-DEBUG] CAPTURAR_DATO ⚠️ field "${field}" NOT in leadFields list`);
    }

  } catch (error) {
    actionLogger.error({ err: error }, 'Error capturing data');
    console.log(`[MIRI-DEBUG] CAPTURAR_DATO ❌ ERROR: ${error.message}`);
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
