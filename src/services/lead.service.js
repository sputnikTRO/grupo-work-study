import prisma from '../core/database/client.js';
import logger from '../utils/logger.js';

/**
 * Lead Service (Travel Unit)
 *
 * Manages TravelLead CRUD operations
 */

/**
 * Finds or creates a travel lead for a contact
 *
 * @param {string} contactId - Contact UUID
 * @returns {Promise<Object>} TravelLead object
 */
export async function findOrCreateTravelLead(contactId) {
  const serviceLogger = logger.child({ contactId, service: 'lead.findOrCreateTravelLead' });

  try {
    // Look for existing lead
    let lead = await prisma.travelLead.findFirst({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
    });

    if (lead) {
      serviceLogger.debug({ leadId: lead.id }, 'Travel lead found');
      return lead;
    }

    // Create new lead
    lead = await prisma.travelLead.create({
      data: {
        contactId,
        status: 'nuevo',
      },
    });

    serviceLogger.info({ leadId: lead.id }, 'New travel lead created');

    return lead;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error in findOrCreateTravelLead');
    throw error;
  }
}

/**
 * Updates travel lead
 *
 * @param {string} leadId - Lead UUID
 * @param {Object} data - Data to update
 * @returns {Promise<Object>} Updated lead
 */
export async function updateTravelLead(leadId, data) {
  const serviceLogger = logger.child({ leadId, service: 'lead.updateTravelLead' });

  try {
    const lead = await prisma.travelLead.update({
      where: { id: leadId },
      data,
    });

    serviceLogger.info({ updates: Object.keys(data) }, 'Travel lead updated');

    return lead;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error updating travel lead');
    throw error;
  }
}

/**
 * Gets travel lead by ID
 *
 * @param {string} leadId - Lead UUID
 * @returns {Promise<Object|null>} Lead or null
 */
export async function getTravelLeadById(leadId) {
  try {
    return await prisma.travelLead.findUnique({
      where: { id: leadId },
    });
  } catch (error) {
    logger.error({ err: error, leadId }, 'Error getting travel lead by ID');
    throw error;
  }
}

/**
 * Gets travel lead by contact ID
 *
 * @param {string} contactId - Contact UUID
 * @returns {Promise<Object|null>} Lead or null
 */
export async function getTravelLeadByContactId(contactId) {
  try {
    return await prisma.travelLead.findFirst({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
    });
  } catch (error) {
    logger.error({ err: error, contactId }, 'Error getting travel lead by contact');
    throw error;
  }
}

/**
 * Updates lead status
 *
 * @param {string} leadId - Lead UUID
 * @param {string} status - New status
 * @returns {Promise<Object>} Updated lead
 */
export async function updateTravelLeadStatus(leadId, status) {
  return await updateTravelLead(leadId, { status });
}

/**
 * Adds material to sent list
 *
 * @param {string} leadId - Lead UUID
 * @param {string} materialId - Material ID
 * @returns {Promise<Object>} Updated lead
 */
export async function addMaterialSent(leadId, materialId) {
  const serviceLogger = logger.child({ leadId, materialId, service: 'lead.addMaterialSent' });

  try {
    // Get current lead
    const lead = await getTravelLeadById(leadId);

    if (!lead) {
      throw new Error('Lead not found');
    }

    // Add material if not already sent
    const materialsSent = lead.materialsSent || [];
    if (!materialsSent.includes(materialId)) {
      materialsSent.push(materialId);

      const updated = await updateTravelLead(leadId, {
        materialsSent,
        status: 'materiales_enviados',
      });

      serviceLogger.info('Material added to sent list');
      return updated;
    }

    serviceLogger.debug('Material already sent');
    return lead;

  } catch (error) {
    serviceLogger.error({ err: error }, 'Error adding material sent');
    throw error;
  }
}
