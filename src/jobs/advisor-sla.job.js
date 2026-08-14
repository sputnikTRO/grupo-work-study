import { processExpiredAssignments } from '../units/oxford-education/advisor-sla.js';
import logger from '../utils/logger.js';

/**
 * Oxford Advisor SLA Job (feature/ori-advisor-sla)
 *
 * Scheduler DELGADO — mismo patrón que followup.job.js/sheets-sync.job.js
 * (setInterval; BullMQ no está en el stack, ver auditoría de esta rama). Toda la
 * lógica de reasignación vive en units/oxford-education/advisor-sla.js; este
 * archivo solo la llama periódicamente.
 *
 * Intervalo de poll deliberadamente corto (1 min) frente al SLA típico (10 min,
 * OXED_ADVISOR_SLA_MINUTES) para que una reasignación no tarde de más en
 * dispararse una vez vencido el plazo.
 */

const POLL_INTERVAL_MS = 60 * 1000; // 1 minuto

let pollInterval = null;

/**
 * Arranca el job. Corre una barrida inmediata y luego cada POLL_INTERVAL_MS.
 */
export function startAdvisorSlaJob() {
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Starting Oxford advisor SLA job');

  processExpiredAssignments().catch((err) => {
    logger.error({ err }, 'Error in initial Oxford advisor SLA sweep');
  });

  pollInterval = setInterval(async () => {
    try {
      await processExpiredAssignments();
    } catch (err) {
      logger.error({ err }, 'Error in scheduled Oxford advisor SLA sweep');
    }
  }, POLL_INTERVAL_MS);

  logger.info('Oxford advisor SLA job started');
}

/**
 * Detiene el job (graceful shutdown).
 */
export function stopAdvisorSlaJob() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Oxford advisor SLA job stopped');
  }
}

/**
 * Estado del job (para /health).
 */
export function getAdvisorSlaJobStatus() {
  return {
    running: pollInterval !== null,
    intervalMs: POLL_INTERVAL_MS,
  };
}
