import axios from 'axios';
import { env } from '../../config/env.js';
import { WHATSAPP, OXED_REDIS_KEYS } from '../../config/constants.js';
import logger from '../../utils/logger.js';
import redis from '../../core/database/redis.js';

/**
 * Oxford Education WhatsApp Client
 *
 * Dedicated Cloud API client for the Oxford Education number. It is intentionally
 * isolated from the Travel client (src/core/whatsapp/client.js):
 * - Uses OXED_ACCESS_TOKEN + OXED_PHONE_NUMBER_ID (never the Travel credentials)
 * - Uses its own Redis rate-limit bucket (OXED namespace)
 *
 * This keeps a credential or quota issue in one unit from affecting the other.
 */

const API_BASE_URL = `https://graph.facebook.com/${env.WA_API_VERSION}`;

/**
 * Token-bucket rate limiter (Meta Cloud API: 25 msg / 10s), scoped to Oxford.
 * Mirrors the Travel limiter but with an independent bucket so the two numbers
 * don't share a quota counter.
 */
async function acquireRateLimit() {
  const BUCKET_KEY = `${OXED_REDIS_KEYS.RATE_LIMIT}:bucket`;
  const MAX_TOKENS = 25;
  const REFILL_RATE_MS = 10000;
  const TOKEN_COST = 1;

  try {
    const now = Date.now();
    const bucketData = await redis.getClient().get(BUCKET_KEY);

    let tokens = MAX_TOKENS;
    let lastRefill = now;

    if (bucketData) {
      const parsed = JSON.parse(bucketData);
      tokens = parsed.tokens;
      lastRefill = parsed.lastRefill;

      const refillCycles = Math.floor((now - lastRefill) / REFILL_RATE_MS);
      if (refillCycles > 0) {
        tokens = Math.min(MAX_TOKENS, tokens + refillCycles * MAX_TOKENS);
        lastRefill = now;
      }
    }

    if (tokens < TOKEN_COST) {
      const timeUntilRefill = REFILL_RATE_MS - (now - lastRefill);
      logger.warn({ unit: 'oxford_education', timeUntilRefill }, 'Oxford rate limit reached, waiting');
      await new Promise((resolve) => setTimeout(resolve, timeUntilRefill + 100));
      tokens = MAX_TOKENS;
      lastRefill = Date.now();
    }

    tokens -= TOKEN_COST;
    await redis.getClient().setex(BUCKET_KEY, 60, JSON.stringify({ tokens, lastRefill }));
  } catch (error) {
    logger.warn({ err: error, unit: 'oxford_education' }, 'Oxford rate limiter error, proceeding without limit');
  }
}

/**
 * Core sender for the Oxford number.
 * @param {Object} payload - Cloud API message payload
 * @returns {Promise<Object>} API response
 */
async function sendMessage(payload) {
  if (!env.OXED_PHONE_NUMBER_ID || !env.OXED_ACCESS_TOKEN) {
    throw new Error('Oxford WhatsApp credentials missing (OXED_PHONE_NUMBER_ID / OXED_ACCESS_TOKEN)');
  }

  const url = `${API_BASE_URL}/${env.OXED_PHONE_NUMBER_ID}/messages`;

  await acquireRateLimit();

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${env.OXED_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    logger.debug({
      unit: 'oxford_education',
      to: payload.to,
      type: payload.type,
      messageId: response.data.messages?.[0]?.id,
    }, 'Oxford WhatsApp message sent');

    return response.data;
  } catch (error) {
    logger.error({
      err: error,
      unit: 'oxford_education',
      to: payload.to,
      type: payload.type,
      responseData: error.response?.data,
    }, 'Error sending Oxford WhatsApp message');

    throw new Error(`WhatsApp API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Sends a text message from the Oxford number.
 * @param {string} to - Recipient phone (E.164)
 * @param {string} text - Message body
 * @returns {Promise<Object>} API response
 */
export async function sendTextMessage(to, text) {
  const truncatedText = text.length > WHATSAPP.MAX_MESSAGE_LENGTH
    ? text.substring(0, WHATSAPP.MAX_MESSAGE_LENGTH - 3) + '...'
    : text;

  return await sendMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: truncatedText },
  });
}

/**
 * Sends an approved WhatsApp template message from the Oxford number.
 *
 * Se usa para notificar a los asesores: al ser un mensaje iniciado por el negocio,
 * el texto libre solo se entrega dentro de la ventana de 24h; una plantilla
 * aprobada se entrega siempre. Ver notifyAdvisor en actions.js.
 *
 * @param {string} to - Recipient phone (E.164, sin '+')
 * @param {string} templateName - Nombre de la plantilla aprobada en Meta
 * @param {string} languageCode - Código de idioma (p.ej. 'es_MX')
 * @param {Array<string|number>} bodyParams - Valores para {{1}}..{{n}} del BODY
 * @returns {Promise<Object>} API response
 */
export async function sendTemplateMessage(to, templateName, languageCode, bodyParams = []) {
  const components = bodyParams.length
    ? [{ type: 'body', parameters: bodyParams.map((p) => ({ type: 'text', text: String(p ?? '—') })) }]
    : [];

  return await sendMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  });
}

/**
 * Marks an inbound message as read (best-effort, never throws).
 * @param {string} messageId - WhatsApp message ID
 */
export async function markMessageAsRead(messageId) {
  if (!env.OXED_PHONE_NUMBER_ID || !env.OXED_ACCESS_TOKEN) return;

  const url = `${API_BASE_URL}/${env.OXED_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(url, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }, {
      headers: {
        Authorization: `Bearer ${env.OXED_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    logger.error({ err: error, unit: 'oxford_education', messageId }, 'Error marking Oxford message as read');
  }
}
