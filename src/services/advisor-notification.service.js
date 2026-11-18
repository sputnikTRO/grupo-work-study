import prisma from '../core/database/client.js';
import logger from '../utils/logger.js';

/**
 * Rastro de las notificaciones de lead a las asesoras (Ori y Miri).
 *
 * Meta responde 200 al ACEPTAR un envío; que se entregue es otra cosa. Los fallos
 * de entrega (131049 = límite de mensajes de marketing por usuario, 131047 =
 * fuera de la ventana de 24h, 131026 = no entregable…) llegan después, por el
 * webhook de status. Sin guardar el wamid y esos status no hay forma de
 * responder "¿le llegó a la asesora?" (auditoría de nov-2026).
 *
 * Dos momentos:
 *   1. recordAdvisorNotification — al enviar: guarda a quién, por qué vía
 *      (plantilla o texto libre) y el wamid que devolvió Meta.
 *   2. applyStatusUpdate — al llegar un status del webhook: si el wamid es de una
 *      notificación, avanza su estado y guarda el error si falló.
 *
 * REGLA: nada de aquí puede romper un handoff ni un webhook. Todo va en
 * try/catch y jamás lanza — si la tabla no existe o la base falla, se loguea y
 * el flujo sigue exactamente igual que antes.
 */

// Orden de avance. Un status atrasado (llega "sent" después de "delivered") no
// retrocede el estado; "failed" siempre gana porque es terminal.
const RANK = { send_error: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };
const TIMESTAMP_FIELD = { sent: 'sentAt', delivered: 'deliveredAt', read: 'readAt', failed: 'failedAt' };

function safeLog(level, obj, msg) {
  try { logger[level](obj, msg); } catch { /* logger mockeado/ausente: nunca romper */ }
}

/**
 * Guarda una notificación enviada (o que no pudo salir) a una asesora.
 *
 * @param {Object} p
 * @param {'travel'|'oxford_education'} p.unit
 * @param {Object} p.lead - OxfordLead o TravelLead (se usan id y ticketNumber)
 * @param {Object} p.advisor - { nombre }
 * @param {string} p.advisorPhone - número al que se envió (sin '+')
 * @param {'template'|'text'|'error'} p.via - 'error' = no salió por ninguna vía
 * @param {string} [p.templateName]
 * @param {Object} [p.apiResponse] - respuesta de la Cloud API ({ messages: [{ id }] })
 * @param {string} [p.kind] - nuevo_lead | reasignacion | ya_inscrito
 * @param {Error} [p.error] - error del envío cuando via === 'error'
 * @returns {Promise<Object|null>} la fila creada, o null si no se pudo guardar
 */
export async function recordAdvisorNotification({ unit, lead, advisor, advisorPhone, via, templateName = null, apiResponse = null, kind = 'nuevo_lead', error = null }) {
  try {
    const waMessageId = apiResponse?.messages?.[0]?.id || null;
    const failed = via === 'error';
    return await prisma.advisorNotification.create({
      data: {
        unit,
        leadId: lead?.id || null,
        ticketNumber: Number.isInteger(lead?.ticketNumber) ? lead.ticketNumber : null,
        advisorName: advisor?.nombre || 'desconocida',
        advisorPhone: String(advisorPhone || ''),
        kind,
        via,
        templateName: via === 'template' ? templateName : null,
        waMessageId,
        status: failed ? 'send_error' : 'accepted',
        errorDetail: failed ? String(error?.message || error || '').slice(0, 500) : null,
        failedAt: failed ? new Date() : null,
      },
    });
  } catch (err) {
    safeLog('error', { err, unit, leadId: lead?.id }, 'No se pudo guardar el rastro de la notificación a la asesora (el handoff continúa)');
    return null;
  }
}

/**
 * Aplica un status del webhook de Meta a la notificación con ese wamid.
 * Los status de mensajes a prospectos no tienen fila aquí y se ignoran.
 *
 * @param {Object} status - elemento de `value.statuses[]` del webhook
 * @returns {Promise<Object|null>} la fila actualizada, o null si no aplicaba
 */
export async function applyStatusUpdate(status) {
  try {
    const waMessageId = status?.id;
    const next = status?.status;
    if (!waMessageId || !(next in TIMESTAMP_FIELD)) return null;

    const row = await prisma.advisorNotification.findUnique({ where: { waMessageId } });
    if (!row) return null; // no es una notificación a asesora

    const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
    const data = {};
    if (!row[TIMESTAMP_FIELD[next]]) data[TIMESTAMP_FIELD[next]] = at;

    if (next === 'failed') {
      const e = status.errors?.[0] || {};
      data.status = 'failed';
      data.errorCode = Number.isInteger(e.code) ? e.code : null;
      data.errorTitle = (e.title || e.message || '').slice(0, 200) || null;
      data.errorDetail = (e.error_data?.details || e.message || '').slice(0, 500) || null;
    } else if (row.status !== 'failed' && (RANK[next] ?? 0) > (RANK[row.status] ?? 0)) {
      data.status = next;
    }

    if (Object.keys(data).length === 0) return row;
    const updated = await prisma.advisorNotification.update({ where: { id: row.id }, data });

    if (next === 'failed') {
      // Nivel ERROR a propósito: es la señal que faltaba ("Meta aceptó pero no entregó").
      safeLog('error', {
        unit: row.unit, ticket: row.ticketNumber, advisor: row.advisorName, via: row.via, template: row.templateName,
        errorCode: data.errorCode, errorTitle: data.errorTitle, errorDetail: data.errorDetail,
      }, 'ALERTA: la notificación a la asesora NO se entregó (status failed de Meta)');
    }
    return updated;
  } catch (err) {
    safeLog('error', { err, waMessageId: status?.id }, 'No se pudo aplicar el status de entrega (el webhook continúa)');
    return null;
  }
}

/**
 * Aplica todos los status de un `value` del webhook. Nunca lanza.
 * @param {Array<Object>} statuses - `value.statuses`
 */
export async function applyStatusUpdates(statuses) {
  for (const status of statuses || []) {
    await applyStatusUpdate(status);
  }
}
