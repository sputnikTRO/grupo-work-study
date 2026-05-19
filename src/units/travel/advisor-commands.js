import logger from '../../utils/logger.js';
import prisma from '../../core/database/client.js';
import { sendTextMessage } from '../../core/whatsapp/client.js';
import * as conversationService from '../../services/conversation.service.js';
import * as leadService from '../../services/lead.service.js';
import { normalizePhone } from '../../utils/phone.js';

/**
 * Números de WhatsApp de los asesores autorizados para usar comandos.
 * Clave: número normalizado E.164 sin '+'. Valor: nombre del asesor.
 */
const ADVISOR_PHONES = {
  '5651070832': 'Miguel Rodríguez',
  '5544884437': 'Cecilia Rodríguez',
  '5539771457': 'Camila Serafín',
};

/**
 * Asesoras de familia para el comando ASIGNAR
 */
const FAMILY_ADVISORS = {
  cecilia: { nombre: 'Cecilia Rodríguez', whatsapp: '5544884437' },
  camila:  { nombre: 'Camila Serafín',    whatsapp: '5539771457' },
  miguel:  { nombre: 'Miguel Rodríguez',  whatsapp: '5651070832' },
};

/**
 * Verifica si un número de teléfono pertenece a un asesor autorizado.
 */
export function isAdvisorPhone(phone) {
  const normalized = normalizePhone(phone).replace('+', '');
  return normalized in ADVISOR_PHONES;
}

/**
 * Maneja un mensaje de WhatsApp enviado por un asesor.
 * Detecta el comando y lo ejecuta.
 *
 * @param {Object} message - Objeto de mensaje de WhatsApp
 * @param {string} phoneNumberId - ID del número de WhatsApp de Miri
 */
export async function handleAdvisorCommand(message, phoneNumberId) {
  const phone = normalizePhone(message.from).replace('+', '');
  const advisorName = ADVISOR_PHONES[phone];
  const text = (message.text?.body || '').trim().toUpperCase();

  const cmdLogger = logger.child({ advisor: advisorName, command: text });

  cmdLogger.info('Received advisor command');

  try {
    if (text === 'PENDIENTES' || text === 'PENDIENTE') {
      await handlePendientes(advisorName, message.from, phoneNumberId, cmdLogger);

    } else if (text.startsWith('ASIGNAR ')) {
      const parts = text.split(' ');
      const leadIndex = parseInt(parts[1], 10);
      const targetAdvisor = parts[2]?.toLowerCase(); // 'cecilia', 'camila', 'miguel' (opcional)
      await handleAsignar(leadIndex, targetAdvisor, advisorName, message.from, phoneNumberId, cmdLogger);

    } else if (text === 'AYUDA' || text === 'HELP') {
      await sendTextMessage(message.from, getHelpMessage(), phoneNumberId);

    } else {
      // Comando desconocido — ignorar silenciosamente (el asesor puede estar chateando)
      cmdLogger.debug('Unknown advisor command, ignoring');
    }
  } catch (error) {
    cmdLogger.error({ err: error }, 'Error handling advisor command');
    await sendTextMessage(message.from, '❌ Error al ejecutar el comando. Intenta de nuevo.', phoneNumberId);
  }
}

/**
 * PENDIENTES — Lista los leads en waiting_human con número de índice, tipo y tiempo
 */
async function handlePendientes(advisorName, replyTo, phoneNumberId, cmdLogger) {
  const conversations = await prisma.conversation.findMany({
    where: { status: 'waiting_human', unit: 'travel' },
    orderBy: { lastMessageAt: 'asc' }, // más antiguos primero (esperan más)
    include: {
      contact: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (conversations.length === 0) {
    await sendTextMessage(replyTo, '✅ No hay leads pendientes en este momento.', phoneNumberId);
    return;
  }

  // Obtener leads relacionados para extraer leadType, schoolCode, parentName
  const contactIds = conversations.map(c => c.contact.id);
  const leads = await prisma.travelLead.findMany({
    where: { contactId: { in: contactIds } },
  });
  const leadByContactId = Object.fromEntries(leads.map(l => [l.contactId, l]));

  const now = Date.now();

  const lines = conversations.map((conv, i) => {
    const lead = leadByContactId[conv.contact.id];
    const index = i + 1;

    const name = lead?.parentName || conv.contact.name || conv.contact.phone;
    const school = lead?.schoolCode ? `(${lead.schoolCode})` : '';
    const typeEmoji = lead?.leadType === 'institucion' ? '🏫' : '👨‍👩‍👧';
    const assignedTo = conv.assignedAgent ? ` → ${conv.assignedAgent}` : '';

    const diffMs = now - new Date(conv.lastMessageAt).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const timeAgo = diffMin < 60
      ? `hace ${diffMin} min`
      : `hace ${Math.floor(diffMin / 60)}h ${diffMin % 60}min`;

    return `#${index} — ${name} ${school} ${typeEmoji}${assignedTo} — ${timeAgo}`;
  });

  const header = `📋 *Leads pendientes (${conversations.length})*\n`;
  const footer = '\n\nResponde *ASIGNAR #N* para tomarlo, o *ASIGNAR #N cecilia/camila/miguel* para asignarlo a otro asesor.';
  const body = lines.join('\n');

  await sendTextMessage(replyTo, header + body + footer, phoneNumberId);
  cmdLogger.info({ count: conversations.length }, 'Pendientes list sent');
}

/**
 * ASIGNAR #N [asesor] — Asigna un lead pendiente a un asesor y reactiva la conversación
 *
 * Ejemplos:
 *   ASIGNAR 3          → se asigna a quien envió el comando
 *   ASIGNAR 3 camila   → se asigna a Camila Serafín
 *   ASIGNAR 3 miguel   → se asigna a Miguel Rodríguez
 */
async function handleAsignar(leadIndex, targetAdvisorKey, requestingAdvisorName, replyTo, phoneNumberId, cmdLogger) {
  if (isNaN(leadIndex) || leadIndex < 1) {
    await sendTextMessage(replyTo, '❌ Uso: *ASIGNAR #N* (ej: ASIGNAR 2) o *ASIGNAR #N cecilia/camila/miguel*', phoneNumberId);
    return;
  }

  // Obtener lista actual de pendientes (mismo orden que PENDIENTES)
  const conversations = await prisma.conversation.findMany({
    where: { status: 'waiting_human', unit: 'travel' },
    orderBy: { lastMessageAt: 'asc' },
    include: { contact: true },
  });

  const conv = conversations[leadIndex - 1];
  if (!conv) {
    await sendTextMessage(replyTo, `❌ No existe el lead #${leadIndex}. Usa *PENDIENTES* para ver la lista actual.`, phoneNumberId);
    return;
  }

  // Determinar asesor destino
  let targetAdvisor;
  if (targetAdvisorKey && FAMILY_ADVISORS[targetAdvisorKey]) {
    targetAdvisor = FAMILY_ADVISORS[targetAdvisorKey];
  } else {
    // Asignar a quien envía el comando
    targetAdvisor = Object.values(FAMILY_ADVISORS).find(a => a.nombre === requestingAdvisorName)
      || { nombre: requestingAdvisorName, whatsapp: null };
  }

  // Actualizar conversación: asignar asesor y mantener waiting_human
  await conversationService.update(conv.id, {
    assignedAgent: targetAdvisor.nombre,
  });

  // Actualizar lead con asesora asignada
  const lead = await prisma.travelLead.findFirst({ where: { contactId: conv.contact.id } });
  if (lead) {
    await leadService.updateTravelLead(lead.id, { assignedAdvisor: targetAdvisor.nombre });
  }

  const prospectName = lead?.parentName || conv.contact.name || conv.contact.phone;
  const prospectPhone = conv.contact.phone;

  await sendTextMessage(
    replyTo,
    `✅ Lead #${leadIndex} (${prospectName}) asignado a *${targetAdvisor.nombre}*.\n📱 WhatsApp del prospecto: ${prospectPhone}`,
    phoneNumberId
  );

  cmdLogger.info({ leadIndex, assignedTo: targetAdvisor.nombre, prospectPhone }, 'Lead assigned via command');
}

/**
 * Mensaje de ayuda para asesores
 */
function getHelpMessage() {
  return `🤖 *Comandos disponibles para asesores:*

*PENDIENTES* — Ver lista de leads esperando atención

*ASIGNAR N* — Tomar el lead #N (se asigna a ti)
  ej: ASIGNAR 2

*ASIGNAR N cecilia* — Asignar lead #N a Cecilia
*ASIGNAR N camila* — Asignar lead #N a Camila
*ASIGNAR N miguel* — Asignar lead #N a Miguel

*AYUDA* — Ver este mensaje`;
}
