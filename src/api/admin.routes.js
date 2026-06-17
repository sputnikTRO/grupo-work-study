/**
 * Admin Routes
 *
 * Endpoints for administrative tasks
 * WARNING: These should be protected in production
 */

import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../utils/phone.js';
import logger from '../utils/logger.js';
import redis from '../core/database/redis.js';
import * as sheetsCache from '../core/sheets/cache.js';
import { readSheet, appendRow, updateRange } from '../core/sheets/client.js';
import { env } from '../config/env.js';
import { getCircuitBreakerStatus, forceResetCircuitBreaker } from '../core/ai/claude.js';

const prisma = new PrismaClient();

/**
 * Registers admin routes on Fastify server
 *
 * @param {FastifyInstance} fastify - Fastify server instance
 */
export async function registerAdminRoutes(fastify) {
  /**
   * POST /admin/reset-conversation
   * Resets a conversation from 'waiting_human' to 'active'
   *
   * Body: { "phone": "+5215531122119" }
   */
  fastify.post('/admin/reset-conversation', async (request, reply) => {
    const adminLogger = logger.child({ endpoint: 'admin.reset-conversation' });

    try {
      const { phone } = request.body;

      if (!phone) {
        return reply.code(400).send({
          success: false,
          error: 'Phone number is required',
        });
      }

      const normalizedPhone = normalizePhone(phone);
      adminLogger.info({ phone: normalizedPhone }, 'Resetting conversation');

      // Find contact
      const contact = await prisma.contact.findUnique({
        where: { phone: normalizedPhone },
      });

      if (!contact) {
        return reply.code(404).send({
          success: false,
          error: 'Contact not found',
          phone: normalizedPhone,
        });
      }

      // Find conversations in waiting_human status
      const conversations = await prisma.conversation.findMany({
        where: {
          contactId: contact.id,
          status: 'waiting_human',
        },
      });

      if (conversations.length === 0) {
        return reply.send({
          success: true,
          message: 'No conversations in waiting_human status',
          conversationsReset: 0,
        });
      }

      // Reset all to active
      const result = await prisma.conversation.updateMany({
        where: {
          contactId: contact.id,
          status: 'waiting_human',
        },
        data: {
          status: 'active',
          assignedAgent: null,
        },
      });

      adminLogger.info({ count: result.count }, 'Conversations reset successfully');

      return reply.send({
        success: true,
        message: `${result.count} conversation(s) reset to active`,
        conversationsReset: result.count,
        phone: normalizedPhone,
      });

    } catch (error) {
      adminLogger.error({ err: error }, 'Error resetting conversation');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * DELETE /admin/delete-conversation/:phone
   * Completely deletes all conversations and leads for a phone number
   * Use this to force a fresh start with new prompts
   */
  fastify.delete('/admin/delete-conversation/:phone', async (request, reply) => {
    const adminLogger = logger.child({ endpoint: 'admin.delete-conversation' });

    try {
      const { phone } = request.params;
      const normalizedPhone = normalizePhone(phone);

      adminLogger.info({ phone: normalizedPhone }, 'Deleting conversation completely');

      // Find contact
      const contact = await prisma.contact.findUnique({
        where: { phone: normalizedPhone },
        include: { conversations: true }
      });

      if (!contact) {
        return reply.code(404).send({
          success: false,
          error: 'Contact not found',
          phone: normalizedPhone,
        });
      }

      let deletedConversations = 0;
      let deletedMessages = 0;

      // Delete all conversations and messages
      for (const conv of contact.conversations) {
        // Delete messages
        const result = await prisma.message.deleteMany({
          where: { conversationId: conv.id }
        });
        deletedMessages += result.count;

        // Delete conversation
        await prisma.conversation.delete({
          where: { id: conv.id }
        });
        deletedConversations++;

        // Clear Redis history (key format matches redis.js: CONVERSATION_HISTORY:conversationId)
        const historyKey = `conversation:history:${conv.id}`;
        await redis.getClient().del(historyKey);
      }

      // Delete leads
      const deletedLeads = await prisma.travelLead.deleteMany({
        where: { contactId: contact.id }
      });

      adminLogger.info({
        deletedConversations,
        deletedMessages,
        deletedLeads: deletedLeads.count
      }, 'Conversation deleted successfully');

      return reply.send({
        success: true,
        message: 'Conversation deleted completely',
        phone: normalizedPhone,
        deletedConversations,
        deletedMessages,
        deletedLeads: deletedLeads.count,
      });

    } catch (error) {
      adminLogger.error({ err: error }, 'Error deleting conversation');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /admin/conversation-status/:phone
   * Gets the status of conversations for a phone number
   */
  fastify.get('/admin/conversation-status/:phone', async (request, reply) => {
    const adminLogger = logger.child({ endpoint: 'admin.conversation-status' });

    try {
      const { phone } = request.params;
      const normalizedPhone = normalizePhone(phone);

      adminLogger.info({ phone: normalizedPhone }, 'Getting conversation status');

      // Find contact
      const contact = await prisma.contact.findUnique({
        where: { phone: normalizedPhone },
        include: {
          conversations: {
            orderBy: { startedAt: 'desc' },
          },
        },
      });

      if (!contact) {
        return reply.code(404).send({
          success: false,
          error: 'Contact not found',
          phone: normalizedPhone,
        });
      }

      return reply.send({
        success: true,
        contact: {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
        },
        conversations: contact.conversations.map(conv => ({
          id: conv.id,
          unit: conv.unit,
          status: conv.status,
          assignedAgent: conv.assignedAgent,
          interestScore: conv.interestScore,
          startedAt: conv.startedAt,
          lastMessageAt: conv.lastMessageAt,
        })),
      });

    } catch (error) {
      adminLogger.error({ err: error }, 'Error getting conversation status');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /admin/clear-media-cache
   * Clears all WhatsApp media cache from Redis
   */
  fastify.post('/admin/clear-media-cache', async (request, reply) => {
    const adminLogger = logger.child({ endpoint: 'admin.clear-media-cache' });

    try {
      adminLogger.info('Clearing WhatsApp media cache');

      const client = redis.getClient();

      // Find all WhatsApp media keys
      const keys = await client.keys('whatsapp:media:*');

      adminLogger.info({ keyCount: keys.length }, 'Found cached media items');

      if (keys.length === 0) {
        return reply.send({
          success: true,
          message: 'Cache is already empty',
          deletedCount: 0,
        });
      }

      // Delete all keys
      const result = await client.del(...keys);

      adminLogger.info({ deletedCount: result }, 'Cache cleared successfully');

      return reply.send({
        success: true,
        message: 'Cache cleared successfully',
        deletedCount: result,
        keys: keys,
      });

    } catch (error) {
      adminLogger.error({ err: error }, 'Error clearing cache');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /admin/media-cache-status
   * Shows current media cache status
   */
  fastify.get('/admin/media-cache-status', async (request, reply) => {
    const adminLogger = logger.child({ endpoint: 'admin.media-cache-status' });

    try {
      const client = redis.getClient();

      // Find all WhatsApp media keys
      const keys = await client.keys('whatsapp:media:*');

      const cacheItems = [];
      for (const key of keys) {
        const mediaId = await client.get(key);
        const ttl = await client.ttl(key);
        cacheItems.push({
          key,
          mediaId,
          ttlSeconds: ttl,
          ttlDays: (ttl / 86400).toFixed(1),
        });
      }

      return reply.send({
        success: true,
        totalCached: keys.length,
        items: cacheItems,
      });

    } catch (error) {
      adminLogger.error({ err: error }, 'Error getting cache status');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /admin/refresh-sheets-cache
   * Force refresh of Google Sheets cache
   */
  fastify.post('/admin/refresh-sheets-cache', async (request, reply) => {
    const adminLogger = logger.child({ endpoint: 'admin.refresh-sheets-cache' });

    try {
      adminLogger.info('Forcing Google Sheets cache refresh');

      const success = await sheetsCache.refreshCache();

      if (success) {
        const status = await sheetsCache.getCacheStatus();

        adminLogger.info({ sheetCount: Object.keys(status.sheets).length }, 'Cache refreshed successfully');

        return reply.send({
          success: true,
          message: 'Google Sheets cache refreshed successfully',
          timestamp: new Date().toISOString(),
          status,
        });
      } else {
        return reply.code(500).send({
          success: false,
          error: 'Failed to refresh cache',
        });
      }

    } catch (error) {
      adminLogger.error({ err: error }, 'Error refreshing cache');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /admin/circuit-breaker
   * Returns Claude circuit breaker status
   */
  fastify.get('/admin/circuit-breaker', async (request, reply) => {
    return reply.send(getCircuitBreakerStatus());
  });

  /**
   * POST /admin/circuit-breaker/reset
   * Manually resets the Claude circuit breaker
   */
  fastify.post('/admin/circuit-breaker/reset', async (request, reply) => {
    forceResetCircuitBreaker();
    return reply.send({ success: true, message: 'Circuit breaker reset', status: getCircuitBreakerStatus() });
  });

  /**
   * POST /admin/update-info-general
   * One-time: update FAQ security row + append accompaniment entry
   */
  fastify.post('/admin/update-info-general', async (request, reply) => {
    try {
      const spreadsheetId = env.GOOGLE_SHEETS_ID;
      const sheetName = 'Info General';

      // Read all rows to find the security question row
      const rows = await readSheet(spreadsheetId, sheetName);

      // Find header row to determine column indices
      const headerRow = rows[0] || [];
      const tituloIdx = headerRow.findIndex(h => h.toString().toLowerCase().includes('título') || h.toString().toLowerCase().includes('titulo'));
      const contenidoIdx = headerRow.findIndex(h => h.toString().toLowerCase().includes('contenido'));

      const results = { debug: { headerRow, tituloIdx, contenidoIdx, totalRows: rows.length } };

      // Find security row using detected column index
      let securityRowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        const titulo = (rows[i][tituloIdx >= 0 ? tituloIdx : 2] || '').toString();
        if (titulo.toLowerCase().includes('seguro')) {
          securityRowIndex = i + 1; // 1-indexed spreadsheet row
          break;
        }
      }

      // Update security row if found
      if (securityRowIndex > 0) {
        const colLetter = String.fromCharCode(65 + (contenidoIdx >= 0 ? contenidoIdx : 3));
        const newContent = 'Los estudiantes están supervisados durante las actividades del programa. Se hospedan en familias anfitrionas y se trasladan en transporte público local como parte del aprendizaje. Cuentan con Group Leaders y equipo local que pueden asistirles cuando sea necesario.';
        await updateRange(spreadsheetId, `${sheetName}!${colLetter}${securityRowIndex}`, [[newContent]]);
        results.securityRowUpdated = { row: securityRowIndex, col: colLetter, success: true };
      } else {
        results.securityRowUpdated = { success: false, reason: 'Row not found', searched: 'seguro' };
      }

      // Append new accompaniment entry
      const newRow = [
        'TODOS',
        'FAQ',
        '¿Cómo funciona el acompañamiento y los traslados?',
        'Los estudiantes se hospedan con familias anfitrionas seleccionadas, entre 2 y 4 estudiantes por hogar. Cada mañana, tras el desayuno, se trasladan al meeting point donde se reúne todo el grupo para las actividades del día. Al terminar, regresan juntos al mismo punto y de ahí a sus hogares.\n\nLos trayectos se hacen en transporte público local como parte del aprendizaje cultural y desarrollo de autonomía. Antes del viaje y durante los primeros días, los estudiantes reciben orientación detallada sobre rutas, uso de la tarjeta de transporte, normas de seguridad y protocolos ante imprevistos.\n\nLas rutas son supervisadas por el equipo del programa. Los estudiantes nunca hacen desplazamientos improvisados y cuentan con el apoyo de sus Group Leaders y el equipo local cuando sea necesario.',
        '10',
      ];
      await appendRow(spreadsheetId, sheetName, newRow);
      results.newRowAppended = { success: true };

      return reply.send({ success: true, results });
    } catch (error) {
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /admin/sheets-content
   * Returns raw FAQ + Info General content from Sheets cache (diagnostic)
   */
  fastify.get('/admin/sheets-content', async (request, reply) => {
    try {
      const faq = await sheetsCache.getFAQ();
      const trips = await sheetsCache.getActiveTrips();
      // Also get raw Viajes sheet to see all rows regardless of Estado
      const allViajes = await sheetsCache.getAllViajes();
      const allInfoGeneral = await sheetsCache.getAllInfoGeneral();
      const infoByTrip = {};
      for (const trip of trips) {
        if (trip['Código']) {
          infoByTrip[trip['Código']] = await sheetsCache.getInfoGeneral(trip['Código']);
        }
      }
      return reply.send({ faq, trips, allViajes, allInfoGeneral, infoByTrip });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/lead-status/:phone
   * Returns full lead data for a phone number (diagnostic)
   */
  fastify.get('/admin/lead-status/:phone', async (request, reply) => {
    try {
      const normalizedPhone = normalizePhone(request.params.phone);
      const contact = await prisma.contact.findUnique({ where: { phone: normalizedPhone } });
      if (!contact) return reply.code(404).send({ error: 'Contact not found', phone: normalizedPhone });

      const leads = await prisma.travelLead.findMany({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ phone: normalizedPhone, contactName: contact.name, leads });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  logger.info('Admin routes registered');
}
