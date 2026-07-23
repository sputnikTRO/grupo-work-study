import logger from '../../utils/logger.js';
import { normalizePhone } from '../../utils/phone.js';
import { extractMessageContent } from '../../core/whatsapp/parser.js';
import { chat } from '../../core/ai/claude.js';
import * as contactService from '../../services/contact.service.js';
import * as conversationService from '../../services/conversation.service.js';
import * as messageService from '../../services/message.service.js';
import * as oxfordLeadService from './lead.service.js';
import * as store from './store.js';
import { sendTextMessage, markMessageAsRead } from './whatsapp.js';
import { buildFullPrompt, HANDOFF_MEETING_URL } from './prompts.js';
import { buildOxfordKnowledge } from './knowledge.js';
import { parseActions, cleanResponse, executeActions } from './actions.js';
import { syncOxfordLeadToSheet, deriveTemperature } from './sheets-sync.js';

/**
 * Oxford Education Unit Message Handler
 *
 * Processes inbound WhatsApp messages for the Oxford Education LIT number.
 * Mirrors the Travel flow's shape but is fully isolated: its own WhatsApp
 * credentials, Redis namespace (via ./store.js) and lead table (oxford_leads).
 */

/**
 * Entry point called by the webhook router.
 * @param {Object} message - WhatsApp message object
 * @param {string} phoneNumberId - Phone number ID that received the message
 */
export async function handleMessage(message, phoneNumberId) {
  const phone = normalizePhone(message.from);
  const waMessageId = message.id;
  const log = logger.child({ phone, waMessageId, unit: 'oxford_education' });

  const lockAcquired = await store.acquireContactLock(phone);
  if (!lockAcquired) {
    log.warn('Failed to acquire lock, message already being processed');
    return;
  }

  try {
    const content = extractMessageContent(message);
    if (!content) {
      log.warn('Unable to extract message content');
      return;
    }

    // Best-effort read receipt (never blocks the flow).
    markMessageAsRead(waMessageId).catch(() => {});

    const contact = await contactService.findOrCreate(phone, 'oxford_education');
    let conv = await conversationService.findActiveOrCreate(contact.id, 'oxford_education');

    // Always persist the inbound message first.
    await messageService.createInbound(
      conv.id,
      content.text || `[${content.type}]`,
      content.type,
      waMessageId,
      content.mediaUrl,
    );

    // If a human is handling it, stay silent (but the message is saved above).
    if (conv.status === 'waiting_human') {
      log.info('Conversation is waiting for human, bot will not respond');
      return;
    }

    // Reactivate if a human previously finished attending.
    if (conv.status === 'atendido') {
      conv = await conversationService.update(conv.id, { status: 'active' });
    }

    const lead = await oxfordLeadService.findOrCreateOxfordLead(contact.id);

    await processWithAI(phone, content, conv, lead, contact, log);
  } catch (error) {
    log.error({ err: error }, 'Error handling Oxford message');
    try {
      const fallback = 'Disculpa, estamos teniendo un problema técnico momentáneo. Una asesora te contactará en breve. 😊';
      await sendTextMessage(phone, fallback);
    } catch (fallbackError) {
      log.error({ err: fallbackError }, 'Error sending Oxford fallback message');
    }
  } finally {
    await store.releaseContactLock(phone);
    log.info('Lock released');
  }
}

/**
 * Runs the Claude turn: builds prompt + history, parses/executes actions,
 * replies, and updates conversation memory.
 */
async function processWithAI(phone, content, conv, lead, contact, log) {
  const history = await store.getHistory(conv.id);
  const dynamicKnowledge = await buildOxfordKnowledge(lead);
  const systemPrompt = buildFullPrompt(lead, dynamicKnowledge);
  const formattedHistory = store.formatForClaude(history);

  log.info({ historyLength: formattedHistory.length }, 'Sending Oxford request to Claude');
  const claudeResponse = await chat(systemPrompt, formattedHistory, content.text);

  const actions = parseActions(claudeResponse);
  const cleanText = cleanResponse(claudeResponse);

  const { handoffOccurred } = await executeActions(actions, lead);

  // Always send exactly one reply and keep the conversation ACTIVE. On a soft
  // handoff we append the Calendly link to Ori's own message (she never writes
  // the link herself), so she keeps responding to follow-ups afterwards.
  const reply = composeReply(cleanText, handoffOccurred);

  await sendTextMessage(phone, reply);
  await messageService.createOutbound(conv.id, reply);
  await store.addMessage(conv.id, 'user', content.text);
  await store.addMessage(conv.id, 'assistant', reply);

  log.info({ handoffOccurred, actionCount: actions.length }, 'Oxford message processed');

  // Persist temperature + log the lead to Google Sheets (best-effort; never blocks).
  const temperature = deriveTemperature(lead, handoffOccurred);
  if (lead.temperature !== temperature) {
    await oxfordLeadService.updateOxfordLead(lead.id, { temperature });
    lead.temperature = temperature;
  }
  const freshLead = await oxfordLeadService.getOxfordLeadById(lead.id);
  const summary = buildConversationSummary(history, content.text, reply);
  await syncOxfordLeadToSheet(freshLead || lead, contact, conv, { handoffOccurred, summary });
}

/**
 * Builds a short conversation summary for the sheet: the latest exchanges,
 * compacted to a single line.
 *
 * @param {Array<{role:string, content:string}>} history - Prior turns (pre-current)
 * @param {string} userText - Current user message
 * @param {string} botReply - Current bot reply
 * @returns {string}
 */
function buildConversationSummary(history, userText, botReply) {
  const turns = history.map((m) => ({ role: m.role, content: m.content }));

  // `history` (rebuilt from DB) may already include the current inbound message,
  // since it's persisted before this runs — avoid duplicating it.
  const last = turns[turns.length - 1];
  if (!(last && last.role === 'user' && last.content === userText)) {
    turns.push({ role: 'user', content: userText });
  }
  turns.push({ role: 'assistant', content: botReply });

  return turns
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Ori'}: ${String(m.content).replace(/\s+/g, ' ').trim()}`)
    .join(' | ');
}

/**
 * Builds the outgoing message. On handoff, appends the Calendly link to Ori's
 * text (or a reinforcing default if she produced no prose).
 *
 * @param {string} cleanText - Ori's reply with action tags stripped
 * @param {boolean} handoffOccurred - Whether a DERIVAR_ASESOR action ran
 * @returns {string}
 */
function composeReply(cleanText, handoffOccurred) {
  if (handoffOccurred) {
    const linkLine = `Puedes agendar con una asesora aquí 👉 ${HANDOFF_MEETING_URL}`;
    const base = cleanText
      || 'Con gusto 😊 Una asesora puede darte una cotización personalizada y resolver todas tus dudas sobre precios y detalles.';
    // Avoid duplicating the link if the model somehow already included it.
    return base.includes(HANDOFF_MEETING_URL) ? base : `${base}\n\n${linkLine}`;
  }
  return cleanText || 'Con gusto te ayudo. ¿Sobre qué programa te gustaría saber más? 😊';
}
