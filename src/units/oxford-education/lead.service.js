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
 * Updates an Oxford lead ONLY if `where` still matches (optimistic concurrency).
 *
 * Usado por el SLA de confirmación de asesor (feature/ori-advisor-sla) para dos
 * guards de carrera:
 *   - ATIENDO: solo confirma si `assignedAdvisor` sigue siendo ese asesor y
 *     `confirmedAt` sigue null (si ya se reasignó a otro/otra, no aplica).
 *   - Reasignación del job: solo reasigna si `currentAttempt` sigue siendo el
 *     que el job leyó y `confirmedAt` sigue null (si el asesor confirmó justo
 *     antes de que el job corriera, el job no debe pisar esa confirmación).
 *
 * @param {string} leadId - OxfordLead UUID
 * @param {Object} guard - Condiciones extra de `where` (además de `id`)
 * @param {Object} data - Fields to update
 * @returns {Promise<boolean>} true si el update SÍ aplicó (ganó la carrera)
 */
export async function conditionalUpdateOxfordLead(leadId, guard, data) {
  try {
    const result = await prisma.oxfordLead.updateMany({
      where: { id: leadId, ...guard },
      data,
    });
    return result.count > 0;
  } catch (error) {
    logger.error({ err: error, leadId, unit: 'oxford_education' }, 'Error in conditional Oxford lead update');
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
