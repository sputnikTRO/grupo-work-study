import prisma from '../core/database/client.js';
import logger from '../utils/logger.js';

/**
 * Contact Service
 *
 * Manages contact CRUD operations
 */

/**
 * Finds or creates a contact by phone number
 *
 * @param {string} phone - Normalized E.164 phone number
 * @param {string} sourceUnit - Unit that created the contact ('travel', 'work_study', 'oxford_education')
 * @returns {Promise<Object>} Contact object
 */
export async function findOrCreate(phone, sourceUnit) {
  const serviceLogger = logger.child({ phone, sourceUnit, service: 'contact.findOrCreate' });

  try {
    // Try to find existing contact
    let contact = await prisma.contact.findUnique({
      where: { phone },
    });

    if (contact) {
      serviceLogger.debug({ contactId: contact.id }, 'Contact found');

      // Add sourceUnit to activeUnits if not already present
      if (!contact.activeUnits.includes(sourceUnit)) {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: {
            activeUnits: [...contact.activeUnits, sourceUnit],
          },
        });

        serviceLogger.info({ contactId: contact.id }, `Added ${sourceUnit} to activeUnits`);
      }

      return contact;
    }

    // Create new contact
    contact = await prisma.contact.create({
      data: {
        phone,
        sourceUnit,
        activeUnits: [sourceUnit],
      },
    });

    serviceLogger.info({ contactId: contact.id }, 'New contact created');

    return contact;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error in findOrCreate');
    throw error;
  }
}

/**
 * Updates contact information
 *
 * @param {string} contactId - Contact UUID
 * @param {Object} data - Data to update
 * @returns {Promise<Object>} Updated contact
 */
export async function update(contactId, data) {
  const serviceLogger = logger.child({ contactId, service: 'contact.update' });

  try {
    const contact = await prisma.contact.update({
      where: { id: contactId },
      data,
    });

    serviceLogger.info({ updates: Object.keys(data) }, 'Contact updated');

    return contact;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error updating contact');
    throw error;
  }
}

/**
 * Gets contact by ID
 *
 * @param {string} contactId - Contact UUID
 * @returns {Promise<Object|null>} Contact or null
 */
export async function getById(contactId) {
  try {
    return await prisma.contact.findUnique({
      where: { id: contactId },
    });
  } catch (error) {
    logger.error({ err: error, contactId }, 'Error getting contact by ID');
    throw error;
  }
}

/**
 * Gets contact by phone number
 *
 * @param {string} phone - Normalized E.164 phone number
 * @returns {Promise<Object|null>} Contact or null
 */
export async function getByPhone(phone) {
  try {
    return await prisma.contact.findUnique({
      where: { phone },
    });
  } catch (error) {
    logger.error({ err: error, phone }, 'Error getting contact by phone');
    throw error;
  }
}
