import Redis from 'ioredis';
import { env } from '../../config/env.js';
import { REDIS_KEYS } from '../../config/constants.js';

/**
 * Redis Client Singleton
 *
 * Provides Redis connection and utility methods including:
 * - Contact locking to prevent race conditions
 * - Conversation history caching
 * - Google Sheets data caching
 */

class RedisClient {
  constructor() {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetErrors = ['READONLY', 'ECONNRESET'];
        return targetErrors.some(targetError => err.message.includes(targetError));
      },
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
    });
  }

  /**
   * Acquires a lock for a specific contact to prevent concurrent message processing
   * @param {string} phone - Contact phone number (E.164 format)
   * @returns {Promise<boolean>} True if lock acquired, false otherwise
   */
  async acquireContactLock(phone) {
    const lockKey = `${REDIS_KEYS.CONTACT_LOCK}:${phone}`;
    const ttl = env.CONTACT_LOCK_TTL_SECONDS;

    // SET NX EX: Set if Not eXists with EXpiration
    const result = await this.client.set(lockKey, Date.now(), 'EX', ttl, 'NX');
    return result === 'OK';
  }

  /**
   * Releases the lock for a specific contact
   * @param {string} phone - Contact phone number (E.164 format)
   * @returns {Promise<void>}
   */
  async releaseContactLock(phone) {
    const lockKey = `${REDIS_KEYS.CONTACT_LOCK}:${phone}`;
    await this.client.del(lockKey);
  }

  /**
   * Stores conversation history for a contact
   * @param {string} conversationId - Conversation UUID
   * @param {Array} messages - Array of message objects
   * @returns {Promise<void>}
   */
  async setConversationHistory(conversationId, messages) {
    const key = `${REDIS_KEYS.CONVERSATION_HISTORY}:${conversationId}`;
    const ttl = env.CONVERSATION_CONTEXT_TTL_SECONDS;

    await this.client.setex(key, ttl, JSON.stringify(messages));
  }

  /**
   * Retrieves conversation history for a contact
   * @param {string} conversationId - Conversation UUID
   * @returns {Promise<Array|null>} Array of messages or null if not found
   */
  async getConversationHistory(conversationId) {
    const key = `${REDIS_KEYS.CONVERSATION_HISTORY}:${conversationId}`;
    const data = await this.client.get(key);

    return data ? JSON.parse(data) : null;
  }

  /**
   * Caches Google Sheets data
   * @param {string} sheetName - Name of the sheet (e.g., 'schools', 'trips')
   * @param {*} data - Data to cache
   * @returns {Promise<void>}
   */
  async setSheetsCache(sheetName, data) {
    const key = `${REDIS_KEYS.SHEETS_CACHE}:${sheetName}`;
    const ttl = env.SHEETS_CACHE_TTL_SECONDS;

    await this.client.setex(key, ttl, JSON.stringify(data));
  }

  /**
   * Retrieves cached Google Sheets data
   * @param {string} sheetName - Name of the sheet
   * @returns {Promise<*|null>} Cached data or null if not found
   */
  async getSheetsCache(sheetName) {
    const key = `${REDIS_KEYS.SHEETS_CACHE}:${sheetName}`;
    const data = await this.client.get(key);

    return data ? JSON.parse(data) : null;
  }

  /**
   * Stores Zoho access token (for Fase 2)
   * @param {string} token - Access token
   * @param {number} expiresIn - Expiration time in seconds
   * @returns {Promise<void>}
   */
  async setZohoAccessToken(token, expiresIn) {
    const key = REDIS_KEYS.ZOHO_ACCESS_TOKEN;
    await this.client.setex(key, expiresIn, token);
  }

  /**
   * Retrieves Zoho access token (for Fase 2)
   * @returns {Promise<string|null>} Token or null if expired
   */
  async getZohoAccessToken() {
    const key = REDIS_KEYS.ZOHO_ACCESS_TOKEN;
    return await this.client.get(key);
  }

  /**
   * Deletes a key or keys matching a pattern
   * @param {string} pattern - Key or pattern (e.g., 'key:*')
   * @returns {Promise<number>} Number of keys deleted
   */
  async delete(pattern) {
    try {
      if (pattern.includes('*')) {
        // Pattern matching - use keys() to find matches
        const keys = await this.client.keys(pattern);
        if (keys.length === 0) return 0;
        return await this.client.del(...keys);
      } else {
        // Single key
        return await this.client.del(pattern);
      }
    } catch (error) {
      console.error('Redis delete error:', error);
      return 0;
    }
  }

  /**
   * Gracefully closes the Redis connection
   * @returns {Promise<void>}
   */
  async disconnect() {
    await this.client.quit();
  }

  /**
   * Gets the raw Redis client for advanced operations
   * @returns {Redis} ioredis client instance
   */
  getClient() {
    return this.client;
  }
}

// Singleton instance
const redis = new RedisClient();

export default redis;
