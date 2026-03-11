import axios from 'axios';
import { env } from '../../config/env.js';
import { WHATSAPP } from '../../config/constants.js';
import logger from '../../utils/logger.js';
import redis from '../database/redis.js';

/**
 * WhatsApp Cloud API Client
 *
 * Sends messages via Meta Cloud API
 * Supports text, media, templates, and interactive messages
 */

const API_BASE_URL = `https://graph.facebook.com/${env.WA_API_VERSION}`;

/**
 * Sends a text message via WhatsApp
 *
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} text - Message text (max 4096 characters)
 * @param {string} phoneNumberId - WhatsApp phone number ID to send from
 * @returns {Promise<Object>} API response with message ID
 */
export async function sendTextMessage(to, text, phoneNumberId) {
  // Truncate if exceeds max length
  const truncatedText = text.length > WHATSAPP.MAX_MESSAGE_LENGTH
    ? text.substring(0, WHATSAPP.MAX_MESSAGE_LENGTH - 3) + '...'
    : text;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body: truncatedText,
    },
  };

  return await sendMessage(payload, phoneNumberId);
}

/**
 * Sends a media message (image, document, audio, video)
 *
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} mediaType - Type: 'image', 'document', 'audio', 'video'
 * @param {string} mediaId - Media ID from Meta Upload API
 * @param {string} caption - Optional caption for image/video
 * @param {string} phoneNumberId - WhatsApp phone number ID to send from
 * @returns {Promise<Object>} API response
 */
export async function sendMediaMessage(to, mediaType, mediaId, caption, phoneNumberId) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: mediaType,
    [mediaType]: {
      id: mediaId,
      ...(caption && (mediaType === 'image' || mediaType === 'video') ? { caption } : {}),
    },
  };

  return await sendMessage(payload, phoneNumberId);
}

/**
 * Sends a media message using a public URL
 * Meta Cloud API accepts public URLs without needing to upload first
 *
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} mediaType - Type: 'image', 'document', 'audio', 'video'
 * @param {string} mediaUrl - Public URL to the media file
 * @param {string} caption - Optional caption for image/video
 * @param {string} filename - Optional filename for documents
 * @param {string} phoneNumberId - WhatsApp phone number ID to send from
 * @returns {Promise<Object>} API response
 */
export async function sendMediaMessageByUrl(to, mediaType, mediaUrl, caption, filename, phoneNumberId) {
  const mediaObject = {
    link: mediaUrl,
  };

  // Add caption for images and videos
  if (caption && (mediaType === 'image' || mediaType === 'video')) {
    mediaObject.caption = caption;
  }

  // Add filename for documents
  if (filename && mediaType === 'document') {
    mediaObject.filename = filename;
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: mediaType,
    [mediaType]: mediaObject,
  };

  return await sendMessage(payload, phoneNumberId);
}

/**
 * Sends a template message (pre-approved message template)
 *
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} templateName - Template name from Meta Business Manager
 * @param {string} languageCode - Language code (e.g., 'es_MX')
 * @param {Array} components - Template components (parameters)
 * @param {string} phoneNumberId - WhatsApp phone number ID to send from
 * @returns {Promise<Object>} API response
 */
export async function sendTemplateMessage(to, templateName, languageCode, components, phoneNumberId) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      components,
    },
  };

  return await sendMessage(payload, phoneNumberId);
}

/**
 * Rate Limiter using Token Bucket algorithm in Redis
 * Meta Cloud API limit: 25 messages per 10 seconds
 *
 * @returns {Promise<void>} Resolves when a token is acquired
 */
async function acquireRateLimit() {
  const BUCKET_KEY = 'whatsapp:rate_limit:bucket';
  const MAX_TOKENS = 25;
  const REFILL_RATE_MS = 10000; // 10 seconds
  const TOKEN_COST = 1;

  try {
    const now = Date.now();

    // Get current bucket state
    const bucketData = await redis.getClient().get(BUCKET_KEY);

    let tokens = MAX_TOKENS;
    let lastRefill = now;

    if (bucketData) {
      const parsed = JSON.parse(bucketData);
      tokens = parsed.tokens;
      lastRefill = parsed.lastRefill;

      // Calculate tokens to add based on time elapsed
      const timeSinceRefill = now - lastRefill;
      const refillCycles = Math.floor(timeSinceRefill / REFILL_RATE_MS);

      if (refillCycles > 0) {
        tokens = Math.min(MAX_TOKENS, tokens + (refillCycles * MAX_TOKENS));
        lastRefill = now;
      }
    }

    // If no tokens available, wait for next refill
    if (tokens < TOKEN_COST) {
      const timeUntilRefill = REFILL_RATE_MS - (now - lastRefill);
      logger.warn({ timeUntilRefill }, 'Rate limit reached, waiting for token refill');

      await new Promise(resolve => setTimeout(resolve, timeUntilRefill + 100));

      // After waiting, refill and try again
      tokens = MAX_TOKENS;
      lastRefill = Date.now();
    }

    // Consume token
    tokens -= TOKEN_COST;

    // Save bucket state
    await redis.getClient().setex(
      BUCKET_KEY,
      60, // TTL 60 seconds (longer than refill rate)
      JSON.stringify({ tokens, lastRefill })
    );

    logger.debug({ tokensRemaining: tokens }, 'Rate limit token acquired');

  } catch (error) {
    // If Redis fails, log but don't block sending
    logger.warn({ err: error }, 'Rate limiter error, proceeding without limit');
  }
}

/**
 * Core function to send any message type via WhatsApp Cloud API
 *
 * @param {Object} payload - Message payload
 * @param {string} phoneNumberId - WhatsApp phone number ID to send from
 * @returns {Promise<Object>} API response with message ID
 */
async function sendMessage(payload, phoneNumberId) {
  const url = `${API_BASE_URL}/${phoneNumberId}/messages`;

  // Acquire rate limit token before sending
  await acquireRateLimit();

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });

    logger.debug({
      to: payload.to,
      type: payload.type,
      messageId: response.data.messages?.[0]?.id,
    }, 'WhatsApp message sent');

    return response.data;
  } catch (error) {
    logger.error({
      err: error,
      to: payload.to,
      type: payload.type,
      responseData: error.response?.data,
    }, 'Error sending WhatsApp message');

    throw new Error(`WhatsApp API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Marks a message as read
 *
 * @param {string} messageId - WhatsApp message ID to mark as read
 * @param {string} phoneNumberId - WhatsApp phone number ID
 * @returns {Promise<Object>} API response
 */
export async function markMessageAsRead(messageId, phoneNumberId) {
  const url = `${API_BASE_URL}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  } catch (error) {
    logger.error({ err: error, messageId }, 'Error marking message as read');
    // Don't throw - marking as read is not critical
  }
}
