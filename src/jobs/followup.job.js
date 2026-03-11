import prisma from '../core/database/client.js';
import { sendTextMessage } from '../core/whatsapp/client.js';
import * as leadService from '../services/lead.service.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Follow-up Job
 *
 * Sends automatic follow-up messages to leads that need them
 * Runs every hour
 */

const FOLLOWUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_FOLLOWUP_COUNT = 3;

let followupInterval = null;

/**
 * Starts the follow-up job
 */
export function startFollowUpJob() {
  logger.info('Starting follow-up job');

  followupInterval = setInterval(async () => {
    await processFollowUps();
  }, FOLLOWUP_INTERVAL_MS);

  logger.info({ intervalMs: FOLLOWUP_INTERVAL_MS }, 'Follow-up job started');
}

/**
 * Stops the follow-up job
 */
export function stopFollowUpJob() {
  if (followupInterval) {
    clearInterval(followupInterval);
    followupInterval = null;
    logger.info('Follow-up job stopped');
  }
}

/**
 * Processes all pending follow-ups
 */
async function processFollowUps() {
  const followupLogger = logger.child({ job: 'followup' });

  followupLogger.info('Starting follow-up processing');

  try {
    // Find leads that need follow-up
    const leads = await prisma.travelLead.findMany({
      where: {
        followUpDate: {
          lte: new Date(), // Follow-up date is in the past or now
        },
        status: {
          notIn: ['inscrito', 'no_interesado', 'derivado_asesor'],
        },
      },
      include: {
        contact: {
          include: {
            conversations: {
              where: {
                unit: 'travel',
                status: 'active',
              },
              take: 1,
            },
          },
        },
      },
    });

    followupLogger.info({ leadCount: leads.length }, 'Found leads for follow-up');

    for (const lead of leads) {
      try {
        await processLeadFollowUp(lead, followupLogger);
      } catch (error) {
        followupLogger.error({ err: error, leadId: lead.id }, 'Error processing lead follow-up');
      }
    }

    followupLogger.info('Follow-up processing completed');

  } catch (error) {
    followupLogger.error({ err: error }, 'Error in follow-up job');
  }
}

/**
 * Processes follow-up for a single lead
 */
async function processLeadFollowUp(lead, followupLogger) {
  const leadLogger = followupLogger.child({ leadId: lead.id, followUpCount: lead.followUpCount });

  // Check if max follow-ups reached
  if (lead.followUpCount >= MAX_FOLLOWUP_COUNT) {
    leadLogger.info('Max follow-ups reached, marking as no_interesado');

    await leadService.updateTravelLead(lead.id, {
      status: 'no_interesado',
      followUpDate: null,
    });

    return;
  }

  // Get contact phone and conversation
  const contact = lead.contact;
  const conversation = contact.conversations[0];

  if (!conversation) {
    leadLogger.warn('No active conversation found, skipping');
    return;
  }

  // Build follow-up message based on attempt number
  const message = buildFollowUpMessage(lead.followUpCount + 1, lead);

  // Send message via WhatsApp
  // Note: We need the phone number ID, which should be stored or retrieved
  // For now, using env variable
  await sendTextMessage(contact.phone, message, env.WA_PHONE_NUMBER_ID_TRAVEL);

  leadLogger.info({ followUpCount: lead.followUpCount + 1 }, 'Follow-up message sent');

  // Update lead
  await leadService.updateTravelLead(lead.id, {
    followUpCount: lead.followUpCount + 1,
    followUpDate: null, // Clear until next schedule
  });
}

/**
 * Builds follow-up message based on attempt number
 *
 * @param {number} attemptNumber - 1, 2, or 3
 * @param {Object} lead - TravelLead object
 * @returns {string} Follow-up message
 */
function buildFollowUpMessage(attemptNumber, lead) {
  const parentName = lead.parentName ? ` ${lead.parentName.split(' ')[0]}` : '';

  if (attemptNumber === 1) {
    // First follow-up: soft reminder
    return `Buen día${parentName}, espero que se encuentre bien. ✈️

¿Tuvo oportunidad de revisar la información del programa English 4 Life que le compartimos?

Si tiene cualquier duda, con gusto le ayudo. 😊`;

  } else if (attemptNumber === 2) {
    // Second follow-up: mention dates
    return `Buen día${parentName}.

Le escribo porque se acercan algunas fechas importantes para el programa English 4 Life a Londres.

Si aún tienen interés, con gusto le actualizo la información. 📍`;

  } else {
    // Third and final follow-up: farewell
    return `Buen día${parentName}.

Entiendo que es una decisión importante y requiere tiempo de análisis.

Si más adelante desean retomar la información del viaje a Londres, con gusto quedamos a sus órdenes.

¡Que tenga un excelente día! 😊`;
  }
}

/**
 * Gets follow-up job status
 */
export function getFollowUpJobStatus() {
  return {
    running: followupInterval !== null,
    intervalMs: FOLLOWUP_INTERVAL_MS,
    maxFollowUpCount: MAX_FOLLOWUP_COUNT,
  };
}
