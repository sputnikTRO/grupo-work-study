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

    try {
      // Extract message content
      const content = extractMessageContent(message);

      if (!content) {
        msgLogger.warn('Unable to extract message content');
        return;
      }

      msgLogger.info({ contentType: content.type, textLength: content.text?.length }, 'Message content extracted');

      // Get or create contact
      const contact = await contactService.findOrCreate(phone, 'travel');

      // Get or create conversation
      const conv = await conversationService.findActiveOrCreate(contact.id, 'travel');

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

      // Get or create travel lead
      const lead = await leadService.findOrCreateTravelLead(contact.id);

      // FIRST MESSAGE: Detect school if this is likely a first message
      if (isLikelyFirstMessage(content.text) && !lead.schoolCode) {
        const detectedSchool = await detectSchool(content.text);

        if (detectedSchool) {
          msgLogger.info({ schoolCode: detectedSchool.codigo, schoolName: detectedSchool.nombre }, 'School detected');

          // Update lead with school code
          await leadService.updateTravelLead(lead.id, {
            schoolCode: detectedSchool.codigo,
          });

          // Refresh lead object
          lead.schoolCode = detectedSchool.codigo;
        }
      }

      // Save incoming message to database
      await messageService.createInbound(
        conv.id,
        content.text || `[${content.type}]`,
        content.type,
        waMessageId,
        content.mediaUrl
      );

      msgLogger.info({ conversationId: conv.id, leadId: lead.id }, 'Message saved to database');

      // Process the message with Claude AI + full integration
      await processMessageWithAI(phone, content, conv, lead, contact, phoneNumberId);

    } finally {
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
    processLogger.info({ actionCount: actions.length }, 'Action tags parsed');

    // Clean response (remove action tags)
    const cleanText = cleanResponse(claudeResponse);

    // Execute actions with REAL implementation
    await executeActions(actions, lead, conv, phone, phoneNumberId);

    // Send response to WhatsApp
    await sendTextMessage(phone, cleanText, phoneNumberId);
    processLogger.info('Response sent to WhatsApp');

    // Save outbound message to database
    await messageService.createOutbound(conv.id, cleanText);

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

    // SYNC TO GOOGLE SHEETS: Sync lead data to Leads_Log sheet for dashboards/CRM
    // This happens AFTER all updates to ensure we sync the latest data
    // Failures here won't break the main flow (errors are logged but not thrown)
    await syncLeadToSheet(lead, contact, conv);
    processLogger.debug('Lead synced to Google Sheets');

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
