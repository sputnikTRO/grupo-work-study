import redis from '../database/redis.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Conversation Context Manager
 *
 * Manages conversational history in Redis with:
 * - TTL of 1 hour of inactivity (configurable)
 * - Max 20 messages (configurable)
 * - Automatic cleanup of old messages
 */

const MAX_HISTORY = env.MAX_CONVERSATION_HISTORY || 20;
const CONTEXT_TTL = env.CONVERSATION_CONTEXT_TTL_SECONDS || 3600;

/**
 * Gets conversation history from Redis
 *
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<Array>} Array of {role: 'user'|'assistant', content: string}
 */
export async function getHistory(conversationId) {
  const convLogger = logger.child({ conversationId, function: 'conversation.getHistory' });

  try {
    const history = await redis.getConversationHistory(conversationId);

    if (!history) {
      convLogger.debug('No history found in Redis');
      return [];
    }

    convLogger.debug({ messageCount: history.length }, 'History loaded from Redis');
    return history;

  } catch (error) {
    convLogger.error({ err: error }, 'Error loading history from Redis');
    return []; // Return empty on error, don't break the flow
  }
}

/**
 * Adds a message to conversation history
 *
 * @param {string} conversationId - Conversation UUID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @returns {Promise<void>}
 */
export async function addMessage(conversationId, role, content) {
  const convLogger = logger.child({ conversationId, role, function: 'conversation.addMessage' });

  try {
    // Get current history
    let history = await getHistory(conversationId);

    // Add new message
    history.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    // Trim to max length (keep most recent messages)
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
      convLogger.debug({ trimmedTo: MAX_HISTORY }, 'History trimmed to max length');
    }

    // Save back to Redis with TTL
    await redis.setConversationHistory(conversationId, history);

    convLogger.debug({ historyLength: history.length }, 'Message added to history');

  } catch (error) {
    convLogger.error({ err: error }, 'Error adding message to history');
    // Don't throw - history is not critical for operation
  }
}

/**
 * Clears conversation history
 *
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<void>}
 */
export async function clearHistory(conversationId) {
  const convLogger = logger.child({ conversationId, function: 'conversation.clearHistory' });

  try {
    const key = `conversation:history:${conversationId}`;
    await redis.getClient().del(key);

    convLogger.info('History cleared');

  } catch (error) {
    convLogger.error({ err: error }, 'Error clearing history');
  }
}

/**
 * Formats history for Claude API (removes timestamps, keeps only role and content)
 *
 * @param {Array} history - Raw history from Redis
 * @returns {Array} Formatted for Claude: [{role, content}]
 */
export function formatForClaude(history) {
  return history.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Gets conversation summary (for debugging/logging)
 *
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<Object>} Summary with message counts
 */
export async function getSummary(conversationId) {
  const history = await getHistory(conversationId);

  const userMessages = history.filter(m => m.role === 'user').length;
  const assistantMessages = history.filter(m => m.role === 'assistant').length;

  return {
    conversationId,
    totalMessages: history.length,
    userMessages,
    assistantMessages,
    oldestMessage: history[0]?.timestamp,
    newestMessage: history[history.length - 1]?.timestamp,
  };
}

/**
 * Builds context string for system prompt (optional utility)
 * Converts history to a readable format for debugging or injection into prompts
 *
 * @param {Array} history - History array
 * @returns {string} Formatted string
 */
export function buildContextString(history) {
  if (!history || history.length === 0) {
    return 'No hay historial previo.';
  }

  const formatted = history.map((msg, index) => {
    const role = msg.role === 'user' ? 'Usuario' : 'Asistente';
    return `${role}: ${msg.content}`;
  }).join('\n\n');

  return `Historial de conversación:\n\n${formatted}`;
}
