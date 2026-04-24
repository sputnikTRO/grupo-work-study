/**
 * Admin Routes
 *
 * Endpoints for administrative tasks
 * WARNING: These should be protected in production
 */

import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../utils/phone.js';
import logger from '../utils/logger.js';

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

  logger.info('Admin routes registered');
}
