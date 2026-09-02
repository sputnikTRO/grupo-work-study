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
import { pickAdvisor, resolveTrack, advisorByName } from './advisors.js';
import { findSchoolPrices } from './prices.js';

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
      if (action.type === 'DERIVAR_ASESOR' && result?.handedOff === true) handoffOccurred = true;
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
export async function executeSendMaterial(materialId, lead, phone, phoneNumberId, actionLogger = logger) {
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

/**
 * [DERIVAR_ASESOR:razón] - Handoff TIBIO a asesora humana.
 *
 * Ruteo por PRODUCTO (ver advisors.js), no por colegio del Sheet ni por zona:
 *   1. ¿El lead ya está derivado? → guard anti-redisparo, no re-notifica.
 *   2. ¿Ya tiene asesora asignada? → esa.
 *   3. Si no → carrusel del track: 'colegio' (Alma/Victor/Cecilia),
 *      'familia' (Camila) o 'rising_stars' (Miriana/Alejandra/Ericka).
 *
 * El track lo pasa el motor de flujo (según el nodo handoff_* que disparó); en el
 * camino LLM se deduce de `reason` + datos del lead con resolveTrack().
 *
 * El MENSAJE de conexión lo genera este código (no el texto del Sheet), para que
 * sea idéntico venga del menú determinístico o del LLM.
 *
 * @returns {Promise<{handedOff: boolean, advisor?: Object}>} handedOff=false cuando
 *   el guard lo saltó o hubo error → el llamador manda su propio texto.
 */
export async function executeHandoffToAdvisor(reason, lead, conv, phone, phoneNumberId, actionLogger = logger, options = {}) {
  actionLogger.info({ reason, leadType: lead.leadType }, 'Handing off to advisor (warm)');

  try {
    // Guard anti-redisparo: si el lead ya está derivado, NO re-notificamos ni
    // duplicamos ticket. Miri sigue activa (handoff tibio) y responde otras dudas.
    if (lead.status === 'derivado_asesor') {
      actionLogger.info({ assignedAdvisor: lead.assignedAdvisor }, 'Lead already handed off — skipping re-notify (warm handoff)');
      return { handedOff: false };
    }

    const track = options.track || resolveTrack(lead, reason);

    // 1. Asesora ya asignada de antes; 2. si no, carrusel del track.
    let advisor = lead.assignedAdvisor ? advisorByName(lead.assignedAdvisor) : null;
    if (advisor) {
      actionLogger.info({ assignedAdvisor: lead.assignedAdvisor }, 'Using pre-assigned advisor');
    } else {
      advisor = await pickAdvisor(track, actionLogger);
      actionLogger.info({ track, advisor: advisor?.nombre }, 'Advisor assigned from track carousel');
    }

    // Persistir asesora en el lead para futuros handoffs
    if (advisor && !lead.assignedAdvisor) {
      await leadService.updateTravelLead(lead.id, { assignedAdvisor: advisor.nombre });
      lead.assignedAdvisor = advisor.nombre; // el llamador (motor de flujo) lo usa para {{asesora}}
    }

    // Mensaje al prospecto: la asesora lo contacta desde SU propio número; Miri
    // sigue disponible en este chat para otras dudas (handoff tibio). Este texto
    // espeja los nodos handoff_* de "Flujo Miri" con {{asesora}} sustituida.
    const nombre = advisor?.nombre;
    let farewellMessage;
    if (!nombre) {
      farewellMessage = '¡Con gusto! 😊 Te conecto con una de nuestras asesoras, que te contactará en breve por WhatsApp.';
    } else if (track === 'rising_stars') {
      farewellMessage = `¡Va! 🌟 Te conecto con ${nombre}, asesora especializada en Rising Stars, que te escribe en breve para confirmar la beca y darte los siguientes pasos.`;
    } else if (track === 'familia') {
      farewellMessage = `¡Con gusto! 😊 Te conecto con ${nombre}, que atiende a las familias y te escribe en breve por WhatsApp para ver la inversión y los siguientes pasos.`;
    } else {
      farewellMessage = `¡Perfecto! 😊 Te conecto con ${nombre}, nuestra asesora educativa, que te escribe en breve por WhatsApp para ver la inversión y los siguientes pasos.`;
    }
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
      await sendAdvisorNotification(advisor, lead, conv, phone, reason, phoneNumberId, actionLogger, track, options.ticketKind);
    } else {
      actionLogger.warn('No advisor WhatsApp found, notification not sent');
    }

    return { handedOff: true, advisor }; // despedida ya enviada → el llamador NO manda otro texto

  } catch (error) {
    actionLogger.error({ err: error }, 'Error during handoff');
    return { handedOff: false }; // en error, deja que Miri responda con su texto (no la silencies)
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
 * Producto del lead para el ticket de la asesora.
 * Prioriza lo capturado por el flujo (program_interest, que el motor fija al
 * entrar a cat_e4l/cat_wb/cat_rs); si no hay, lo deduce del track y del motivo.
 */
function deriveProduct(lead, track, reason = '') {
  if (lead.programInterest) return lead.programInterest;
  if (track === 'rising_stars') return 'Rising Stars';

  const hay = `${reason}`.toLowerCase();
  if (hay.includes('rising') || hay.includes('_rs')) return 'Rising Stars';
  if (hay.includes('wb_') || hay.includes('winter')) return 'Winter Break';
  if (hay.includes('e4l')) return 'English 4 Life';
  return 'Por definir';
}

/**
 * Arma los campos del ticket de la asesora: los mismos 8 en la plantilla y en el
 * texto de respaldo, para que la asesora lea siempre lo mismo.
 */
async function buildTicketFields(lead, conv, prospectPhone, reason, track) {
  // Nombre canónico del colegio: se prefiere el de la hoja VIVA de precios (la
  // misma que alimenta {{colegio}} en el nodo de precio, para que la asesora lea
  // exactamente lo que vio el prospecto); si no está ahí, la pestaña Colegios.
  const priced = lead.schoolCode ? await findSchoolPrices(lead.schoolCode) : null;
  const school = !priced && lead.schoolCode ? await sheetsCache.getSchool(lead.schoolCode) : null;
  const colegio = priced?.colegio
    || school?.['Nombre Colegio']
    || school?.nombre
    || lead.schoolCode
    || 'Sin colegio (familia)';

  const producto = deriveProduct(lead, track, reason);
  const destino = lead.destination
    || (lead.programInterest?.includes('Rising') ? 'Windsor, UK' : null)
    || priced?.destino
    || 'Por definir';

  return {
    ticket: lead.ticketNumber || '?',
    papa: lead.parentName || 'No capturado',
    viajero: `${lead.travelerName || 'No capturado'}${lead.travelerAge ? `, ${lead.travelerAge} años` : ''}`,
    colegio,
    producto,
    destino,
    telefono: formatPhoneReadable(prospectPhone),
    motivo: reason || 'Solicita hablar con una asesora',
  };
}

/**
 * Notifica a la asesora del lead derivado.
 *
 * Formato limpio (mismo estilo que Ori): ticket · papá · viajero+edad · colegio ·
 * producto · destino · teléfono · motivo.
 *
 * `ticketKind: 'ya_inscrito'` cambia el encabezado del texto de respaldo a
 * "🔁 YA INSCRITO #N" y prefija el motivo, para que la asesora distinga de un
 * golpe un lead nuevo de alguien que ya está inscrito y pregunta por su proceso.
 *
 * Dos caminos, en este orden:
 *   1. PLANTILLA aprobada de Meta — se entrega SIEMPRE, aun fuera de la ventana
 *      de 24 h (los avisos de lead son mensajes iniciados por el negocio).
 *      - Por defecto usa TRAVEL_ADVISOR_TEMPLATE_NAME (`nuevo_lead_travel`, la de
 *        siempre, 9 variables) con EXACTAMENTE el mismo mapeo que hoy: no se
 *        toca una plantilla ya aprobada, porque editarla la re-manda a revisión
 *        de Meta y tumba las notificaciones mientras tanto.
 *      - Si se setea TRAVEL_ADVISOR_TEMPLATE_V2 (vacía por default), se usa esa
 *        plantilla con los 8 campos limpios. Copy que hay que dar de alta en Meta:
 *          🔔 Nuevo lead #{{1}}
 *          👤 Papá/mamá: {{2}}
 *          🎒 Viajero: {{3}}
 *          🏫 Colegio: {{4}}
 *          ✈️ Programa: {{5}}
 *          📍 Destino: {{6}}
 *          📱 WhatsApp: {{7}}
 *          📌 Motivo: {{8}}
 *          Responde LISTO {{1}} cuando lo cierres.
 *   2. RESPALDO: texto libre con los mismos 8 campos (solo se entrega dentro de
 *      la ventana de 24 h).
 */
async function sendAdvisorNotification(advisor, lead, conv, prospectPhone, reason, phoneNumberId, actionLogger, track, ticketKind) {
  try {
    actionLogger.info({ advisorWhatsApp: advisor.whatsapp }, 'Sending notification to advisor');

    const f = await buildTicketFields(lead, conv, prospectPhone, reason, track);

    // normalizePhone adds +521 prefix, then strip '+' for WhatsApp Cloud API (E.164 without +)
    const advisorPhone = normalizePhone(advisor.whatsapp).replace('+', '');
    const clean = (v, n) => String(v ?? '—').replace(/\s+/g, ' ').trim().slice(0, n) || '—';
    // El motivo ya viene prefijado con "YA INSCRITO — " desde el motor de flujo,
    // así la asesora distingue el ticket también en la plantilla aprobada, que no
    // se puede cambiar sin volver a pasar por revisión de Meta.
    if (ticketKind === 'ya_inscrito' && !/^ya inscrito/i.test(f.motivo)) f.motivo = `YA INSCRITO — ${f.motivo}`;

    try {
      const v2 = (env.TRAVEL_ADVISOR_TEMPLATE_V2 || '').trim();

      const params = v2
        ? [
            f.ticket,                 // {{1}} ticket
            clean(f.papa, 60),        // {{2}} papá/mamá
            clean(f.viajero, 80),     // {{3}} viajero + edad
            clean(f.colegio, 80),     // {{4}} colegio
            clean(f.producto, 40),    // {{5}} producto
            clean(f.destino, 40),     // {{6}} destino
            f.telefono,               // {{7}} teléfono
            clean(f.motivo, 300),     // {{8}} motivo
          ]
        : [
            // Mapeo LEGACY de `nuevo_lead_travel` (9 variables) — no se altera.
            f.ticket,                                                             // {{1}}
            clean(f.papa, 60),                                                    // {{2}}
            lead.leadType === 'institucion' ? 'institución' : 'padre/madre',      // {{3}}
            clean(f.viajero, 80),                                                 // {{4}}
            clean(`${f.colegio} — ${f.destino}`, 100),                            // {{5}}
            `${conv.interestScore ?? 0}`,                                         // {{6}}
            f.telefono,                                                           // {{7}}
            clean(f.motivo, 300),                                                 // {{8}}
            clean(`${f.papa} interesado/a en ${f.producto} para ${f.viajero}.`, 400), // {{9}}
          ];

      const templateName = v2 || env.TRAVEL_ADVISOR_TEMPLATE_NAME;
      const components = [{ type: 'body', parameters: params.map((x) => ({ type: 'text', text: String(x) })) }];
      await sendTemplateMessage(advisorPhone, templateName, env.TRAVEL_ADVISOR_TEMPLATE_LANG, components, phoneNumberId);
      actionLogger.info({ advisorPhone, via: 'template', template: templateName }, 'Advisor notification sent');
      return;
    } catch (tplErr) {
      actionLogger.warn({ err: tplErr, template: env.TRAVEL_ADVISOR_TEMPLATE_NAME }, 'Template notification failed, falling back to free-form text');
    }

    // 2) RESPALDO: texto libre (solo entrega dentro de la ventana de 24h).
    const esYaInscrito = ticketKind === 'ya_inscrito';
    const encabezado = esYaInscrito ? `🔁 *YA INSCRITO #${f.ticket}*` : `🔔 *Nuevo lead #${f.ticket}*`;
    const notification = `${encabezado}

👤 Papá/mamá: ${f.papa}
🎒 Viajero: ${f.viajero}
🏫 Colegio: ${f.colegio}
✈️ Programa: ${f.producto}
📍 Destino: ${f.destino}
📱 WhatsApp: ${f.telefono}

📌 Motivo: ${f.motivo}

---
Responde *LISTO ${f.ticket}* cuando lo cierres.`;
    await sendTextMessage(advisorPhone, notification, phoneNumberId);
    actionLogger.info({ advisorPhone, via: 'text' }, 'Advisor notification sent (fallback text)');

  } catch (error) {
    actionLogger.error({ err: error }, 'Error sending advisor notification');
    // Don't throw - handoff should continue even if notification fails
  }
}

/**
 * [CAPTURAR_DATO:campo:valor] - Captures lead data
 */
export async function executeCaptureData(field, value, lead, conversation, actionLogger = logger) {
  actionLogger.info({ field, value }, 'Capturing data');

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

      // NOTA: capturar el colegio ya NO asigna asesora. Con el ruteo por producto
      // (advisors.js) la asesora depende de si el prospecto va por English 4 Life /
      // Winter Break o por Rising Stars, y eso todavía no se sabe en este punto:
      // asignar aquí le daba a un lead de Rising Stars una asesora de E4L. La
      // asignación ocurre en executeHandoffToAdvisor, que ya conoce el track.

      await leadService.updateTravelLead(lead.id, updateData);
      // Sincroniza el objeto en memoria: el motor de flujo lo lee en el mismo turno
      // (gate de precio, {{colegio}}, destino del material) sin volver a la DB.
      Object.assign(lead, updateData);
      actionLogger.info({ mappedField }, 'Lead updated');

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
