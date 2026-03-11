import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * WhatsApp Webhook Handler
 *
 * Handles Meta Cloud API webhook events:
 * - GET: Webhook verification
 * - POST: Incoming message processing
 */

/**
 * Handles webhook verification (GET request)
 * Meta sends this to verify the webhook endpoint
 *
 * @param {Object} request - Fastify request
 * @param {Object} reply - Fastify reply
 */
export async function verifyWebhook(request, reply) {
  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  logger.info({ mode, token }, 'Webhook verification request');

  // Check if mode and token are correct
  if (mode === 'subscribe' && token === env.WA_VERIFY_TOKEN) {
    logger.info('Webhook verified successfully');
    return challenge; // Return the challenge to verify
  }

  logger.warn('Webhook verification failed');
  reply.status(403);
  return { error: 'Verification failed' };
}

/**
 * Handles incoming webhook events (POST request)
 * Meta sends messages, status updates, and other events here
 *
 * @param {Object} request - Fastify request
 * @param {Object} reply - Fastify reply
 */
export async function handleWebhook(request, reply) {
  const body = request.body;

  logger.debug({ body }, 'Received webhook event');

  try {
    // Validate webhook structure
    if (!body.object || body.object !== 'whatsapp_business_account') {
      logger.warn({ object: body.object }, 'Invalid webhook object type');
      reply.status(400);
      return { error: 'Invalid webhook object' };
    }

    // Process each entry (usually just one)
    for (const entry of body.entry || []) {
      // Process each change in the entry
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          await processMessageChange(change.value);
        } else {
          logger.debug({ field: change.field }, 'Ignoring non-message change');
        }
      }
    }

    // Always respond 200 OK immediately to Meta
    return { status: 'received' };
  } catch (error) {
    logger.error({ err: error }, 'Error processing webhook');

    // Still return 200 to Meta to avoid retries
    return { status: 'error', message: error.message };
  }
}

/**
 * Processes a message change from the webhook
 * Determines which unit should handle the message and routes accordingly
 *
 * @param {Object} value - The 'value' object from the webhook change
 */
async function processMessageChange(value) {
  const { messages, metadata } = value;

  // Extract phone_number_id to determine which unit to route to
  const phoneNumberId = metadata?.phone_number_id;

  if (!phoneNumberId) {
    logger.warn('No phone_number_id found in webhook');
    return;
  }

  logger.info({ phoneNumberId, messageCount: messages?.length }, 'Processing messages');

  // Process each message
  for (const message of messages || []) {
    // Only process inbound messages (ignore status updates)
    if (message.type && message.from) {
      await processInboundMessage(message, phoneNumberId);
    }
  }

  // Process status updates (message delivery, read receipts, etc.)
  const statuses = value.statuses || [];
  for (const status of statuses) {
    logger.debug({ status }, 'Message status update');
    // TODO: Update message status in database if needed
  }
}

/**
 * Processes a single inbound message
 * Routes to the appropriate unit handler based on phone_number_id
 *
 * @param {Object} message - WhatsApp message object
 * @param {string} phoneNumberId - The phone number ID that received the message
 */
async function processInboundMessage(message, phoneNumberId) {
  const { from, id: waMessageId, type, timestamp } = message;

  logger.info({
    from,
    waMessageId,
    type,
    phoneNumberId,
  }, 'Processing inbound message');

  try {
    // Determine which unit this message belongs to
    const unit = getUnitFromPhoneNumberId(phoneNumberId);

    if (!unit) {
      logger.warn({ phoneNumberId }, 'Unknown phone number ID, cannot route message');
      return;
    }

    logger.info({ unit, from }, `Routing message to ${unit} unit`);

    // Import and call the appropriate unit handler
    // TODO: Implement unit routing in next step
    const unitHandler = await getUnitHandler(unit);
    await unitHandler.handleMessage(message, phoneNumberId);

  } catch (error) {
    logger.error({ err: error, from, waMessageId }, 'Error processing inbound message');
    // Don't throw - we already responded 200 OK to Meta
  }
}

/**
 * Maps phone_number_id to business unit
 *
 * @param {string} phoneNumberId - WhatsApp phone number ID
 * @returns {string|null} Unit name ('travel', 'work_study', 'oxford_education') or null
 */
function getUnitFromPhoneNumberId(phoneNumberId) {
  const mapping = {
    [env.WA_PHONE_NUMBER_ID_TRAVEL]: 'travel',
    [env.WA_PHONE_NUMBER_ID_WORK_STUDY]: 'work_study',
    [env.WA_PHONE_NUMBER_ID_OXFORD]: 'oxford_education',
  };

  return mapping[phoneNumberId] || null;
}

/**
 * Dynamically imports the handler for a specific unit
 *
 * @param {string} unit - Unit name ('travel', 'work_study', 'oxford_education')
 * @returns {Promise<Object>} Unit handler module
 */
async function getUnitHandler(unit) {
  switch (unit) {
    case 'travel':
      return await import('../../units/travel/handler.js');
    case 'work_study':
      // TODO: Implement in Fase 2
      throw new Error('Work & Study unit not yet implemented');
    case 'oxford_education':
      // TODO: Implement in Fase 3
      throw new Error('Oxford Education unit not yet implemented');
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}
