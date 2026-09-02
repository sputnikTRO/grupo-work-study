import logger from '../../utils/logger.js';
import { normalizePhone } from '../../utils/phone.js';
import redis from '../../core/database/redis.js';
import { sendTextMessage } from '../../core/whatsapp/client.js';
import { extractMessageContent } from '../../core/whatsapp/parser.js';
import { chat } from '../../core/ai/claude.js';
import * as conversation from '../../core/ai/conversation.js';
import { buildFullPrompt } from './prompts.js';
import { buildDynamicKnowledge } from './knowledge.js';
import { detectSchool, isLikelyFirstMessage } from './flows/welcome.js';
import { parseActions, cleanResponse, executeActions } from './actions.js';
import { updateScore, getScoreClassification } from './scoring.js';
import * as contactService from '../../services/contact.service.js';
import * as conversationService from '../../services/conversation.service.js';
import * as messageService from '../../services/message.service.js';
import * as leadService from '../../services/lead.service.js';
import * as sheetsCache from '../../core/sheets/cache.js';
import { syncLeadToSheet } from '../../core/sheets/leads-sync.js';
import { tryDeterministicFlow } from './flow-engine.js';

/**
 * Travel Unit Message Handler
 *
 * Processes all WhatsApp messages for the Travel (English 4 Life) unit.
 * Implements full conversational flow with Claude AI + Google Sheets + Scoring.
 */

/**
 * Main message handler for Travel unit
 * Acquires lock, processes message with full integration, and releases lock
 *
 * @param {Object} message - WhatsApp message object from webhook
 * @param {string} phoneNumberId - WhatsApp phone number ID that received the message
 */
export async function handleMessage(message, phoneNumberId) {
  const phone = normalizePhone(message.from);
  const waMessageId = message.id;

  const msgLogger = logger.child({ phone, waMessageId, unit: 'travel' });

  try {
    // Acquire lock for this contact to prevent race conditions
    const lockAcquired = await redis.acquireContactLock(phone);

    if (!lockAcquired) {
      msgLogger.warn('Failed to acquire lock, message already being processed');
      return; // Skip this message, it's already being handled
    }

    msgLogger.info('Lock acquired, processing message');

    // Declarados FUERA del try porque el finally (sync a Sheets) los usa; si se
    // declaran dentro, el finally revienta con ReferenceError por block scoping.
    let contact = null;
    let conv = null;
    let lead = null;

    try {
      // Extract message content
      const content = extractMessageContent(message);

      if (!content) {
        msgLogger.warn('Unable to extract message content');
        return;
      }

      msgLogger.info({ contentType: content.type, textLength: content.text?.length }, 'Message content extracted');

      // Get or create contact
      contact = await contactService.findOrCreate(phone, 'travel');

      // Get or create conversation
      conv = await conversationService.findActiveOrCreate(contact.id, 'travel');

      // CHECK: If conversation status is "waiting_human", bot should NOT respond
      if (conv.status === 'waiting_human') {
        msgLogger.info('Conversation is waiting for human, bot will not respond');

        // Still save the inbound message
        await messageService.createInbound(
          conv.id,
          content.text || `[${content.type}]`,
          content.type,
          waMessageId,
          content.mediaUrl
        );

        return; // Bot remains silent
      }

      // If conversation was previously attended by an advisor ('atendido'),
      // reactivate it so Miri resumes with full context.
      if (conv.status === 'atendido') {
        msgLogger.info('Conversation returning after advisor attended — reactivating');
        conv = await conversationService.update(conv.id, { status: 'active' });
      }

      // Get or create travel lead
      lead = await leadService.findOrCreateTravelLead(contact.id);

      // NOTE: Automatic school detection disabled to prevent false positives.
      // Claude will now explicitly ask for the school instead of auto-detecting from message text.
      // The school code should only be captured after explicit user confirmation via [CAPTURAR_DATO:school_code:XX]
      //
      // Previously, the bot would auto-detect schools from greetings like "Hola desde Americano"
      // and immediately assume that was the user's school, which caused incorrect assumptions.
      //
      // FIRST MESSAGE: Detect school if this is likely a first message
      // if (isLikelyFirstMessage(content.text) && !lead.schoolCode) {
      //   const detectedSchool = await detectSchool(content.text);
      //
      //   if (detectedSchool) {
      //     msgLogger.info({ schoolCode: detectedSchool.codigo, schoolName: detectedSchool.nombre }, 'School detected');
      //
      //     // Update lead with school code
      //     await leadService.updateTravelLead(lead.id, {
      //       schoolCode: detectedSchool.codigo,
      //     });
      //
      //     // Refresh lead object
      //     lead.schoolCode = detectedSchool.codigo;
      //   }
      // }

      // Save incoming message to database
      await messageService.createInbound(
        conv.id,
        content.text || `[${content.type}]`,
        content.type,
        waMessageId,
        content.mediaUrl
      );

      msgLogger.info({ conversationId: conv.id, leadId: lead.id }, 'Message saved to database');

      // Capa determinística: recorre el grafo de la pestaña "Flujo Miri" con
      // textos VERBATIM. Si no aplica (Sheet caído, modo libre, o el mensaje no
      // es número/"Menú"/respuesta clara), cede el turno COMPLETO al camino LLM
      // de siempre (processMessageWithAI, sin cambios). El handoff tibio y la
      // captura son los MISMOS en ambos caminos: el flujo los reutiliza.
      const flowResult = await tryDeterministicFlow({
        phone, content, conv, lead, contact, phoneNumberId, log: msgLogger,
      });

      if (!flowResult.handled) {
        await processMessageWithAI(phone, content, conv, lead, contact, phoneNumberId);

        // El flujo seguía activo (flowNode intacto) pero el mensaje no matcheó
        // ninguna opción → el LLM ya respondió; lo reencauzamos al menú con un
        // recordatorio corto, SIN tocar flowNode.
        //
        // El recordatorio sale UNA SOLA VEZ por nodo: repetirlo en cada mensaje
        // ensucia la conversación (se veía debajo de cada respuesta de Miri).
        // Se recuerda en conversation.metadata, que ya existe y es Json libre.
        const meta = conv.metadata || {};
        if (flowResult.midFlowFallback && meta.nudgedNode !== conv.flowNode) {
          const reminder = 'Escribe *Menú* cuando quieras ver las opciones de nuevo 😊';
          await sendTextMessage(phone, reminder, phoneNumberId);
          await messageService.createOutbound(conv.id, reminder);
          await conversation.addMessage(conv.id, 'assistant', reminder);
          await conversationService.update(conv.id, { metadata: { ...meta, nudgedNode: conv.flowNode } });
          conv.metadata = { ...meta, nudgedNode: conv.flowNode };
        }
      }

    } finally {
      // SYNC A GOOGLE SHEETS: va en el finally para que los turnos del flujo
      // determinístico (que no pasan por processMessageWithAI) TAMBIÉN actualicen
      // la pestaña Leads. Nunca rompe el turno: syncLeadToSheet loguea sus errores.
      try {
        if (lead && contact && conv) {
          const freshLead = await leadService.getTravelLeadById(lead.id);
          await syncLeadToSheet(freshLead || lead, contact, conv);
          msgLogger.debug('Lead synced to Google Sheets');
        }
      } catch (syncError) {
        msgLogger.error({ err: syncError }, 'Error syncing lead to Sheets (no rompe el turno)');
      }

      // Always release the lock
      await redis.releaseContactLock(phone);
      msgLogger.info('Lock released');
    }

  } catch (error) {
    msgLogger.error({ err: error }, 'Error handling message');
    throw error;
  }
}

/**
 * Processes message using Claude AI with full integration
 *
 * @param {string} phone - Contact phone number
 * @param {Object} content - Extracted message content
 * @param {Object} conv - Conversation object
 * @param {Object} lead - TravelLead object
 * @param {Object} contact - Contact object
 * @param {string} phoneNumberId - WhatsApp phone number ID
 */
async function processMessageWithAI(phone, content, conv, lead, contact, phoneNumberId) {
  const processLogger = logger.child({
    phone,
    conversationId: conv.id,
    leadId: lead.id,
    schoolCode: lead.schoolCode,
  });

  try {
    // Load conversation history from Redis
    const history = await conversation.getHistory(conv.id);
    processLogger.debug({ historyLength: history.length }, 'History loaded from Redis');

    // Build dynamic knowledge from Google Sheets
    const dynamicKnowledge = await buildDynamicKnowledge(lead.schoolCode);
    processLogger.debug({ knowledgeLength: dynamicKnowledge.length }, 'Dynamic knowledge built from Sheets');

    // Build system prompt with knowledge and lead context
    const systemPrompt = buildFullPrompt(lead, dynamicKnowledge);
    processLogger.debug({ systemPromptLength: systemPrompt.length }, 'System prompt built');

    // Format history for Claude (remove timestamps)
    const formattedHistory = conversation.formatForClaude(history);

    // Send to Claude AI
    processLogger.info('Sending request to Claude AI');
    const claudeResponse = await chat(systemPrompt, formattedHistory, content.text);

    processLogger.info({ responseLength: claudeResponse.length }, 'Received response from Claude');

    // Parse action tags
    const actions = parseActions(claudeResponse);
    processLogger.info({ actionCount: actions.length, actions }, 'Action tags parsed');

    // Clean response (remove action tags)
    const cleanText = cleanResponse(claudeResponse);

    // Execute actions with REAL implementation
    const { handoffOccurred } = await executeActions(actions, lead, conv, phone, phoneNumberId);

    // Reload lead from DB so syncLeadToSheet gets fresh data
    // (CAPTURAR_DATO inside executeActions updates the DB but not the in-memory lead object)
    const freshLead = await leadService.getTravelLeadById(lead.id);
    if (freshLead) lead = freshLead;

    // When a handoff occurred, the farewell message was already sent inside executeActions.
    // Skip sending Claude's text to avoid a double message to the prospect.
    if (!handoffOccurred) {
      await sendTextMessage(phone, cleanText, phoneNumberId);
      processLogger.info('Response sent to WhatsApp');
      await messageService.createOutbound(conv.id, cleanText);
    } else {
      processLogger.info('Handoff occurred — skipping Claude text send (farewell already sent)');
    }

    // Add both messages to conversation history in Redis
    await conversation.addMessage(conv.id, 'user', content.text);
    await conversation.addMessage(conv.id, 'assistant', cleanText);

    // SCORING: Analyze user message and update score
    const scoringResult = updateScore(content.text, lead, conv.interestScore);

    if (scoringResult.delta !== 0) {
      processLogger.info({
        oldScore: conv.interestScore,
        newScore: scoringResult.newScore,
        classification: getScoreClassification(scoringResult.newScore),
      }, 'Score updated');

      // Update score in conversation
      await conversationService.updateInterestScore(conv.id, scoringResult.newScore);

      // Check if score crossed threshold for automatic handoff
      const handoffThreshold = await getHandoffThreshold();

      if (scoringResult.newScore >= handoffThreshold && conv.status === 'active') {
        processLogger.info({ score: scoringResult.newScore, threshold: handoffThreshold }, 'Score crossed handoff threshold, forcing derivation');

        // Force handoff (will be executed in next message from Claude or manually trigger)
        // For now, just log it - the next Claude response should detect high score and derive
      }

      // Update conv object with new score for sync
      conv.interestScore = scoringResult.newScore;
    }

    processLogger.info('Conversation history updated in Redis');

    // NOTA: el sync a Google Sheets se hace ahora en el finally de handleMessage,
    // para que también corra en los turnos del flujo determinístico.

  } catch (error) {
    processLogger.error({ err: error }, 'Error processing message with AI');

    // Try to send a fallback response
    try {
      const fallbackMessage = 'Disculpe, estamos experimentando problemas técnicos. Una asesora le contactará pronto. 😊';
      await sendTextMessage(phone, fallbackMessage, phoneNumberId);
      await messageService.createOutbound(conv.id, fallbackMessage);
    } catch (fallbackError) {
      processLogger.error({ err: fallbackError }, 'Error sending fallback message');
    }

    throw error;
  }
}

/**
 * Gets handoff threshold from config (or default to 7)
 */
async function getHandoffThreshold() {
  try {
    const threshold = await sheetsCache.getConfig('handoff_score_threshold');
    return threshold ? parseInt(threshold, 10) : 7;
  } catch (error) {
    logger.warn({ err: error }, 'Error getting handoff threshold, using default 7');
    return 7;
  }
}
