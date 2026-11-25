import prisma from '../core/database/client.js';
import logger from '../utils/logger.js';

/**
 * Conversation Service
 *
 * Manages conversation CRUD operations
 */

/**
 * Finds active conversation or creates a new one
 *
 * @param {string} contactId - Contact UUID
 * @param {string} unit - Unit name ('travel', 'work_study', 'oxford_education')
 * @param {string} channel - Channel name (default: 'whatsapp')
 * @returns {Promise<Object>} Conversation object
 */
export async function findActiveOrCreate(contactId, unit, channel = 'whatsapp') {
  const serviceLogger = logger.child({ contactId, unit, service: 'conversation.findActiveOrCreate' });

  try {
    // Look for active conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        contactId,
        unit,
        status: {
          in: ['active', 'waiting_human', 'atendido'],
        },
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
    });

    if (conversation) {
      serviceLogger.debug({ conversationId: conversation.id }, 'Active conversation found');

      // Update lastMessageAt
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
        },
      });

      return conversation;
    }

    // Create new conversation
    conversation = await prisma.conversation.create({
      data: {
        contactId,
        unit,
        channel,
        status: 'active',
      },
    });

    serviceLogger.info({ conversationId: conversation.id }, 'New conversation created');

    return conversation;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error in findActiveOrCreate');
    throw error;
  }
}

/**
 * Updates conversation
 *
 * @param {string} conversationId - Conversation UUID
 * @param {Object} data - Data to update
 * @returns {Promise<Object>} Updated conversation
 */
export async function update(conversationId, data) {
  const serviceLogger = logger.child({ conversationId, service: 'conversation.update' });

  try {
    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...data,
        lastMessageAt: new Date(),
      },
    });

    serviceLogger.info({ updates: Object.keys(data) }, 'Conversation updated');

    return conversation;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error updating conversation');
    throw error;
  }
}

/**
 * Mezcla campos en conversation.metadata de forma atómica (jsonb ||), sin
 * pisar los que escribió otro paso del mismo turno.
 *
 * Por qué: antes cada escritor copiaba la metadata que leyó al INICIO del turno
 * y guardaba el objeto entero ({ ...meta, nudgedNode }). Si en ese turno otro
 * paso había guardado algo (p. ej. la respuesta del filtro W&S), se perdía.
 * Un valor null en el patch deja la llave en null (los lectores lo tratan como
 * ausente).
 *
 * @param {string} conversationId
 * @param {Object} patch - solo las llaves a escribir
 * @returns {Promise<Object>} metadata completa ya mezclada
 */
export async function mergeMetadata(conversationId, patch) {
  const serviceLogger = logger.child({ conversationId, service: 'conversation.mergeMetadata' });
  try {
    const rows = await prisma.$queryRaw`
      UPDATE conversations
         SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
       WHERE id = ${conversationId}
   RETURNING metadata`;
    serviceLogger.debug({ keys: Object.keys(patch) }, 'Metadata mezclada');
    return rows?.[0]?.metadata || {};
  } catch (error) {
    serviceLogger.error({ err: error }, 'Error mezclando metadata');
    throw error;
  }
}

/**
 * Updates interest score
 *
 * @param {string} conversationId - Conversation UUID
 * @param {number} score - Score (1-10)
 * @returns {Promise<Object>} Updated conversation
 */
export async function updateInterestScore(conversationId, score) {
  return await update(conversationId, { interestScore: score });
}

/**
 * Gets conversation by ID with related data
 *
 * @param {string} conversationId - Conversation UUID
 * @param {Object} options - Include options (contact, messages, etc.)
 * @returns {Promise<Object|null>} Conversation or null
 */
export async function getById(conversationId, options = {}) {
  try {
    return await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: options.include || {},
    });
  } catch (error) {
    logger.error({ err: error, conversationId }, 'Error getting conversation by ID');
    throw error;
  }
}

/**
 * Closes a conversation
 *
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<Object>} Closed conversation
 */
export async function close(conversationId) {
  return await update(conversationId, {
    status: 'closed',
    closedAt: new Date(),
  });
}
