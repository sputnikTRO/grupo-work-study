import prisma from '../core/database/client.js';
import logger from '../utils/logger.js';

/**
 * Message Service
 *
 * Manages message CRUD operations
 */

/**
 * Creates a new message
 *
 * @param {Object} data - Message data
 * @param {string} data.conversationId - Conversation UUID
 * @param {string} data.direction - 'inbound' or 'outbound'
 * @param {string} data.senderType - 'user', 'bot', or 'agent'
 * @param {string} data.contentType - 'text', 'image', 'document', etc.
 * @param {string} data.content - Message content
 * @param {string} [data.mediaUrl] - Media URL (optional)
 * @param {string} [data.waMessageId] - WhatsApp message ID (optional)
 * @returns {Promise<Object>} Created message
 */
export async function create(data) {
  const serviceLogger = logger.child({
    conversationId: data.conversationId,
    direction: data.direction,
    service: 'message.create',
  });

  try {
    const message = await prisma.message.create({
      data: {
        ...data,
        createdAt: new Date(),
      },
    });

    serviceLogger.debug({ messageId: message.id }, 'Message created');

    return message;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error creating message');
    throw error;
  }
}

/**
 * Creates an inbound message (from user)
 *
 * @param {string} conversationId - Conversation UUID
 * @param {string} content - Message content
 * @param {string} contentType - Content type (default: 'text')
 * @param {string} waMessageId - WhatsApp message ID
 * @param {string} mediaUrl - Media URL (optional)
 * @returns {Promise<Object>} Created message
 */
export async function createInbound(conversationId, content, contentType = 'text', waMessageId = null, mediaUrl = null) {
  return await create({
    conversationId,
    direction: 'inbound',
    senderType: 'user',
    contentType,
    content,
    waMessageId,
    mediaUrl,
  });
}

/**
 * Creates an outbound message (from bot)
 *
 * @param {string} conversationId - Conversation UUID
 * @param {string} content - Message content
 * @param {string} contentType - Content type (default: 'text')
 * @returns {Promise<Object>} Created message
 */
export async function createOutbound(conversationId, content, contentType = 'text') {
  return await create({
    conversationId,
    direction: 'outbound',
    senderType: 'bot',
    contentType,
    content,
  });
}

/**
 * Gets messages for a conversation
 *
 * @param {string} conversationId - Conversation UUID
 * @param {Object} options - Query options (limit, offset, etc.)
 * @returns {Promise<Array>} Array of messages
 */
export async function getByConversation(conversationId, options = {}) {
  try {
    return await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: options.orderBy || 'asc' },
      take: options.limit,
      skip: options.offset,
    });
  } catch (error) {
    logger.error({ err: error, conversationId }, 'Error getting messages');
    throw error;
  }
}

/**
 * Gets message by WhatsApp message ID
 *
 * @param {string} waMessageId - WhatsApp message ID
 * @returns {Promise<Object|null>} Message or null
 */
export async function getByWaMessageId(waMessageId) {
  try {
    return await prisma.message.findFirst({
      where: { waMessageId },
    });
  } catch (error) {
    logger.error({ err: error, waMessageId }, 'Error getting message by WA ID');
    throw error;
  }
}
