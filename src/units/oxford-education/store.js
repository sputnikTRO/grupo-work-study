import redis from '../../core/database/redis.js';
import prisma from '../../core/database/client.js';
import { env } from '../../config/env.js';
import { OXED_REDIS_KEYS } from '../../config/constants.js';
import logger from '../../utils/logger.js';

/**
 * Oxford Education conversation store (Redis)
 *
 * Isolated from Travel via the OXED Redis namespace (oxed:*):
 * - oxed:lock:contact:<phone>           — per-contact processing lock
 * - oxed:conversation:history:<convId>  — short-term conversation memory
 *
 * History is rebuilt from PostgreSQL if the Redis copy has expired, exactly like
 * the Travel flow, so context survives restarts and TTL expiry.
 */

const MAX_HISTORY = env.MAX_CONVERSATION_HISTORY || 20;
const CONTEXT_TTL = env.CONVERSATION_CONTEXT_TTL_SECONDS || 3600;
const LOCK_TTL = env.CONTACT_LOCK_TTL_SECONDS || 30;

// ── Contact lock ────────────────────────────────────────────────────────────

/**
 * Acquires a per-contact lock to prevent concurrent processing.
 * @param {string} phone - Contact phone (E.164)
 * @returns {Promise<boolean>} True if acquired
 */
export async function acquireContactLock(phone) {
  const key = `${OXED_REDIS_KEYS.CONTACT_LOCK}:${phone}`;
  const result = await redis.getClient().set(key, Date.now(), 'EX', LOCK_TTL, 'NX');
  return result === 'OK';
}

/**
 * Releases the per-contact lock.
 * @param {string} phone - Contact phone (E.164)
 */
export async function releaseContactLock(phone) {
  const key = `${OXED_REDIS_KEYS.CONTACT_LOCK}:${phone}`;
  await redis.getClient().del(key);
}

// ── Conversation history ─────────────────────────────────────────────────────

function historyKey(conversationId) {
  return `${OXED_REDIS_KEYS.CONVERSATION_HISTORY}:${conversationId}`;
}

/**
 * Loads conversation history from Redis, rebuilding from PostgreSQL if empty.
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<Array<{role:string, content:string, timestamp?:string}>>}
 */
export async function getHistory(conversationId) {
  const log = logger.child({ conversationId, unit: 'oxford_education', fn: 'store.getHistory' });

  try {
    const raw = await redis.getClient().get(historyKey(conversationId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.length > 0) return parsed;
    }

    log.info('Redis history empty, rebuilding from PostgreSQL');
    const dbMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: MAX_HISTORY,
    });

    if (dbMessages.length === 0) return [];

    const rebuilt = dbMessages.map((m) => ({
      role: m.senderType === 'user' ? 'user' : 'assistant',
      content: m.content,
      timestamp: m.createdAt.toISOString(),
    }));

    await redis.getClient().setex(historyKey(conversationId), CONTEXT_TTL, JSON.stringify(rebuilt));
    return rebuilt;
  } catch (error) {
    log.error({ err: error }, 'Error loading history');
    return [];
  }
}

/**
 * Appends a message to history and trims to the configured maximum.
 * @param {string} conversationId - Conversation UUID
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
export async function addMessage(conversationId, role, content) {
  try {
    let history = await getHistory(conversationId);
    history.push({ role, content, timestamp: new Date().toISOString() });
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    await redis.getClient().setex(historyKey(conversationId), CONTEXT_TTL, JSON.stringify(history));
  } catch (error) {
    logger.error({ err: error, conversationId, unit: 'oxford_education' }, 'Error adding message to history');
  }
}

/**
 * Formats history for the Claude API (role + content only).
 * @param {Array} history
 * @returns {Array<{role:string, content:string}>}
 */
export function formatForClaude(history) {
  return history.map((m) => ({ role: m.role, content: m.content }));
}
