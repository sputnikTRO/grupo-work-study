import { verifyOxfordWebhook, handleOxfordWebhook } from '../core/whatsapp/oxford-webhook.js';

/**
 * Oxford Education Webhook Routes
 *
 * Dedicated Meta Cloud API endpoints for the Oxford Education number, separate
 * from the Travel webhook (/webhook).
 */
export default async function oxfordWebhookRoutes(fastify, options) {
  // GET /webhook/oxford - verification handshake
  fastify.get('/webhook/oxford', verifyOxfordWebhook);

  // POST /webhook/oxford - incoming messages and events
  fastify.post('/webhook/oxford', handleOxfordWebhook);
}
