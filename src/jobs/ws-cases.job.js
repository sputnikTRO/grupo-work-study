import logger from '../utils/logger.js';
import { processWsCases } from '../units/oxford-education/ws/cases.js';
import { wsConfig } from '../units/oxford-education/ws/config.js';
import { advisorByPhone } from '../units/oxford-education/advisor-zones.js';

/**
 * W&S OTCC — poller de casos (avisos que esperaban la apertura y escalamiento
 * Karen → Jorge). Misma mecánica que advisor-sla.job.js; no hace nada con
 * OXED_WS_ENABLED=false.
 */
const POLL_INTERVAL_MS = 60 * 1000;
let timer = null;

export function startWsCasesJob() {
  const cfg = wsConfig();
  if (!cfg.enabled) { logger.info('W&S OTCC apagado (OXED_WS_ENABLED=false) — job de casos no arranca'); return; }
  // Un número no puede ser a la vez asesora comercial y contacto W&S: sus
  // "ATIENDO 12" serían ambiguos.
  for (const c of cfg.contacts) {
    if (advisorByPhone(c.phone)) logger.error({ contact: c.nombre }, 'ALERTA: un contacto W&S también es asesora comercial — sus comandos se tratarán como casos W&S');
  }
  if (!cfg.contacts.length) logger.error('ALERTA: OXED_WS_SUPPORT_CONTACTS vacío — los casos W&S no tendrán a quién avisar');
  const run = () => processWsCases().catch((err) => logger.error({ err }, 'Error en la barrida de casos W&S'));
  run();
  timer = setInterval(run, POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS, contactos: cfg.contacts.length }, 'Job de casos W&S iniciado');
}

export function stopWsCasesJob() {
  if (timer) { clearInterval(timer); timer = null; }
}
