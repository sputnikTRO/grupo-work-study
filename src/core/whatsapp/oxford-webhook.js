import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';
import * as oxfordHandler from '../../units/oxford-education/handler.js';

/**
 * Oxford Education Webhook Handler
 *
 * Dedicated Meta Cloud API webhook for the Oxford Education number, served on a
 * separate route (/webhook/oxford) with its own verify token (OXED_VERIFY_TOKEN).
 * Keeping it separate from the Travel webhook means the two numbers never share a
 * verify token and a change to one can't break the other.
 */

/**
 * GET /webhook/oxford — verification handshake.
 */
export async function verifyOxfordWebhook(request, reply) {
  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  logger.info({ mode, unit: 'oxford_education' }, 'Oxford webhook verification request');

  if (!env.OXED_VERIFY_TOKEN) {
    logger.error('OXED_VERIFY_TOKEN not configured — cannot verify Oxford webhook');
    reply.status(500);
    return { error: 'Oxford webhook not configured' };
  }

  if (mode === 'subscribe' && token === env.OXED_VERIFY_TOKEN) {
    logger.info('Oxford webhook verified successfully');
    return challenge;
  }

  logger.warn('Oxford webhook verification failed');
  reply.status(403);
  return { error: 'Verification failed' };
}

/**
 * POST /webhook/oxford — inbound messages and status events.
 * Always returns 200 quickly so Meta doesn't retry.
 */
export async function handleOxfordWebhook(request, reply) {
  const body = request.body;

  try {
    if (!body.object || body.object !== 'whatsapp_business_account') {
      logger.warn({ object: body?.object, unit: 'oxford_education' }, 'Invalid Oxford webhook object type');
      reply.status(400);
      return { error: 'Invalid webhook object' };
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          await processOxfordChange(change.value);
        }
      }
    }

    return { status: 'received' };
  } catch (error) {
    logger.error({ err: error, unit: 'oxford_education' }, 'Error processing Oxford webhook');
    return { status: 'error', message: error.message };
  }
}

/**
 * Validates the number id and routes inbound messages to the Oxford handler.
 */
async function processOxfordChange(value) {
  const { messages, metadata } = value;
  const phoneNumberId = metadata?.phone_number_id;

  // Guard: only process events that actually belong to the Oxford number.
  if (env.OXED_PHONE_NUMBER_ID && phoneNumberId && phoneNumberId !== env.OXED_PHONE_NUMBER_ID) {
    logger.warn({ phoneNumberId, unit: 'oxford_education' }, 'Oxford webhook received event for a different number, ignoring');
    return;
  }

  for (const message of messages || []) {
    if (message.type && message.from) {
      try {
        await oxfordHandler.handleMessage(message, phoneNumberId);
      } catch (error) {
        logger.error({ err: error, from: message.from, unit: 'oxford_education' }, 'Error handling Oxford inbound message');
      }
    }
  }
}
