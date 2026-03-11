import { verifyWebhook, handleWebhook } from '../core/whatsapp/webhook.js';

/**
 * WhatsApp Webhook Routes
 *
 * Registers webhook endpoints for Meta Cloud API
 */

export default async function webhookRoutes(fastify, options) {
  // GET /webhook - Webhook verification
  fastify.get('/webhook', verifyWebhook);

  // POST /webhook - Incoming messages and events
  fastify.post('/webhook', handleWebhook);
}
