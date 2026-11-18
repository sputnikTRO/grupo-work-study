import { logAdvisorTemplateHealth } from '../services/template-health.service.js';
import logger from '../utils/logger.js';

/**
 * Revisa al arrancar y cada 6 h que las plantillas de aviso a asesoras sigan
 * UTILITY + APPROVED en Meta (ver services/template-health.service.js). Solo
 * hace GET a la Graph API; un fallo nunca afecta al bot.
 */
const INTERVAL_MS = 6 * 60 * 60 * 1000;
let timer = null;
let lastRun = null;
let lastAlerts = 0;

async function run() {
  const findings = await logAdvisorTemplateHealth();
  lastRun = new Date().toISOString();
  lastAlerts = findings.filter((f) => f.ok === false).length;
}

export function startTemplateHealthJob() {
  run().catch(() => {});
  timer = setInterval(() => { run().catch(() => {}); }, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, 'Advisor template health job started');
}

export function stopTemplateHealthJob() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function getTemplateHealthJobStatus() {
  return { running: timer !== null, intervalMs: INTERVAL_MS, lastRun, lastAlerts };
}
