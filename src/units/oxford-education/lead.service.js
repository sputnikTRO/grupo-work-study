import prisma from '../../core/database/client.js';
import logger from '../../utils/logger.js';

/**
 * Oxford Education Lead Service
 *
 * CRUD for the oxford_leads table — fully separate from travel_leads.
 */

/**
 * Finds the contact's Oxford lead or creates a fresh one.
 * @param {string} contactId - Contact UUID
 * @returns {Promise<Object>} OxfordLead
 */
export async function findOrCreateOxfordLead(contactId) {
  const log = logger.child({ contactId, unit: 'oxford_education', service: 'oxfordLead.findOrCreate' });

  try {
    let lead = await prisma.oxfordLead.findFirst({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
    });

    if (lead) {
      log.debug({ leadId: lead.id }, 'Oxford lead found');
      return lead;
    }

    lead = await prisma.oxfordLead.create({
      data: { contactId, status: 'nuevo', temperature: 'nuevo' },
    });

    log.info({ leadId: lead.id }, 'New Oxford lead created');
    return lead;
  } catch (error) {
    log.error({ err: error }, 'Error in findOrCreateOxfordLead');
    throw error;
  }
}

/**
 * Updates an Oxford lead.
 * @param {string} leadId - OxfordLead UUID
 * @param {Object} data - Fields to update
 * @returns {Promise<Object>} Updated lead
 */
export async function updateOxfordLead(leadId, data) {
  try {
    return await prisma.oxfordLead.update({ where: { id: leadId }, data });
  } catch (error) {
    logger.error({ err: error, leadId, unit: 'oxford_education' }, 'Error updating Oxford lead');
    throw error;
  }
}

/**
 * Gets an Oxford lead by id.
 * @param {string} leadId - OxfordLead UUID
 * @returns {Promise<Object|null>}
 */
export async function getOxfordLeadById(leadId) {
  try {
    return await prisma.oxfordLead.findUnique({ where: { id: leadId } });
  } catch (error) {
    logger.error({ err: error, leadId, unit: 'oxford_education' }, 'Error getting Oxford lead');
    throw error;
  }
}
