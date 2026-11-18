import prisma from '../core/database/client.js';
import logger from '../utils/logger.js';

/**
 * Bitácora de los mensajes ENTRANTES de las asesoras y ventana de 24h.
 *
 *   - recordAdvisorCommand: guarda lo que la asesora escribió y qué le contestó el
 *     bot (aceptado / rechazado + motivo). Sin esto un "ATIENDO 5" rechazado no
 *     dejaba rastro y en los reportes aparecía como "no confirmó".
 *   - isAdvisorWindowOpen: ¿la asesora le escribió al bot en las últimas 24h? El
 *     texto libre solo se entrega dentro de esa ventana; fuera de ella Meta lo
 *     acepta y lo descarta. Los avisos informativos (no el lead en sí) se mandan
 *     SOLO con la ventana abierta, para no gastar una plantilla en cada uno.
 *
 * REGLA: nada de aquí puede romper un comando ni un handoff. Todo va en try/catch
 * y nunca lanza. Ante la duda (base caída, tabla sin migrar) la ventana se
 * considera CERRADA: es preferible no mandar un aviso opcional que mandar uno que
 * no llega.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 5 * 60 * 1000; // no apurar el último minuto de la ventana

const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

function safeLog(level, obj, msg) {
  try { logger[level](obj, msg); } catch { /* logger mockeado/ausente */ }
}

/**
 * @param {Object} p
 * @param {'travel'|'oxford_education'} p.unit
 * @param {Object} p.advisor - { nombre }
 * @param {string} p.advisorPhone - número normalizado, sin '+'
 * @param {string} p.text - texto tal como llegó
 * @param {string} p.command - ATIENDO | LISTO | PENDIENTES | AYUDA | REGRESA | OTRO
 * @param {number|null} [p.ticketNumber]
 * @param {'aceptado'|'rechazado'|'info'|'ignorado'|'error'} p.outcome
 * @param {string|null} [p.detail] - motivo del rechazo o nota
 * @param {string|null} [p.waMessageId]
 * @returns {Promise<Object|null>}
 */
export async function recordAdvisorCommand({ unit, advisor, advisorPhone, text, command, ticketNumber = null, outcome, detail = null, waMessageId = null }) {
  try {
    return await prisma.advisorCommand.create({
      data: {
        unit,
        advisorName: advisor?.nombre || 'desconocida',
        advisorPhone: String(advisorPhone || '').replace(/\D/g, ''),
        text: String(text ?? '').slice(0, 500),
        command,
        ticketNumber: Number.isInteger(ticketNumber) ? ticketNumber : null,
        outcome,
        detail: detail ? String(detail).slice(0, 500) : null,
        waMessageId,
      },
    });
  } catch (err) {
    safeLog('error', { err, unit, advisor: advisor?.nombre }, 'No se pudo guardar el comando de la asesora (el comando ya se atendió)');
    return null;
  }
}

/**
 * ¿La asesora tiene abierta la ventana de 24h con el número de esta unidad?
 *
 * @param {Object} p
 * @param {'travel'|'oxford_education'} p.unit
 * @param {string} p.advisorPhone - cualquier formato; se compara por últimos 10 dígitos
 * @param {Date} [p.now]
 * @returns {Promise<boolean>} false también si no se pudo consultar
 */
export async function isAdvisorWindowOpen({ unit, advisorPhone, now = new Date() }) {
  try {
    const tail = last10(advisorPhone);
    if (!tail) return false;
    const since = new Date(now.getTime() - (WINDOW_MS - SAFETY_MARGIN_MS));
    const last = await prisma.advisorCommand.findFirst({
      where: { unit, advisorPhone: { endsWith: tail }, createdAt: { gte: since, lte: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return Boolean(last);
  } catch (err) {
    safeLog('warn', { err, unit }, 'No se pudo consultar la ventana de 24h de la asesora — se asume cerrada');
    return false;
  }
}
