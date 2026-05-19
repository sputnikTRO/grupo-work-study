import logger from '../../utils/logger.js';
import prisma from '../../core/database/client.js';
import { sendTextMessage } from '../../core/whatsapp/client.js';
import * as leadService from '../../services/lead.service.js';
import { normalizePhone } from '../../utils/phone.js';

/**
 * Registro de asesores autorizados.
 * Clave: número E.164 sin '+'. role 'admin' = Miguel (puede usar ASIGNAR y ve todos los leads).
 */
const ADVISORS = {
  '5651070832': { nombre: 'Miguel Rodríguez', apodo: 'Miguel', role: 'admin' },
  '5544884437': { nombre: 'Cecilia Rodríguez', apodo: 'Cecy',  role: 'asesor' },
  '5539771457': { nombre: 'Camila Serafín',    apodo: 'Cami',  role: 'asesor' },
};


// ---------------------------------------------------------------------------
// Exports públicos
// ---------------------------------------------------------------------------

export function isAdvisorPhone(phone) {
  return normalizePhone(phone).replace('+', '') in ADVISORS;
}

export async function handleAdvisorCommand(message, phoneNumberId) {
  const advisor = getAdvisor(message.from);
  if (!advisor) return;

  const raw  = (message.text?.body || '').trim();
  const text = raw.toUpperCase();
  const cmdLogger = logger.child({ advisor: advisor.nombre, command: text });
  cmdLogger.info('Received advisor command');

  try {
    if (text === 'PENDIENTES' || text === 'PENDIENTE') {
      await handlePendientes(advisor, message.from, phoneNumberId, cmdLogger);

    } else if (text.startsWith('LISTO ') || text === 'LISTO') {
      const ticketNumber = parseTicket(text, 'LISTO');
      await handleListo(ticketNumber, advisor, message.from, phoneNumberId, cmdLogger);

    } else if (text.startsWith('REGRESA ') || text === 'REGRESA') {
      const ticketNumber = parseTicket(text, 'REGRESA');
      await handleRegresa(ticketNumber, advisor, message.from, phoneNumberId, cmdLogger);

    } else if (text === 'AYUDA' || text === 'HELP' || text === 'HOLA') {
      await sendTextMessage(message.from, getHelpMessage(advisor), phoneNumberId);

    } else {
      cmdLogger.debug('Unknown advisor command, ignoring');
    }

  } catch (err) {
    if (err instanceof UserError) {
      await sendTextMessage(message.from, `❌ ${err.message}`, phoneNumberId);
    } else {
      cmdLogger.error({ err }, 'Unexpected error in advisor command');
      await sendTextMessage(message.from, '❌ Error interno. Intenta de nuevo.', phoneNumberId);
    }
  }
}

// ---------------------------------------------------------------------------
// PENDIENTES
// ---------------------------------------------------------------------------

async function handlePendientes(advisor, replyTo, phoneNumberId, cmdLogger) {
  const where = advisor.role === 'admin'
    ? { status: 'waiting_human', unit: 'travel' }
    : { status: 'waiting_human', unit: 'travel', assignedAgent: advisor.nombre };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: 'asc' },
    include: { contact: true },
  });

  if (conversations.length === 0) {
    await sendTextMessage(replyTo, '✅ No tienes leads pendientes en este momento.', phoneNumberId);
    return;
  }

  const contactIds = conversations.map(c => c.contact.id);
  const leads = await prisma.travelLead.findMany({
    where: { contactId: { in: contactIds } },
  });
  const leadByContactId = Object.fromEntries(leads.map(l => [l.contactId, l]));

  const now = Date.now();
  const lines = conversations.map(conv => {
    const lead      = leadByContactId[conv.contact.id];
    const ticket    = lead?.ticketNumber ? `#${lead.ticketNumber}` : '(sin #)';
    const name      = lead?.parentName || conv.contact.name || conv.contact.phone;
    const school    = lead?.schoolCode ? ` (${lead.schoolCode})` : '';
    const typeEmoji = lead?.leadType === 'institucion' ? '🏫' : '👨‍👩‍👧';
    const assigned  = conv.assignedAgent ? ` → ${conv.assignedAgent}` : '';

    const diffMin = Math.floor((now - new Date(conv.lastMessageAt).getTime()) / 60000);
    const timeAgo = diffMin < 60
      ? `hace ${diffMin} min`
      : `hace ${Math.floor(diffMin / 60)}h ${diffMin % 60}min`;

    return `${ticket} — ${name}${school} ${typeEmoji}${assigned} — ${timeAgo}`;
  });

  const footer = advisor.role === 'admin'
    ? '\n\nUsa: *LISTO #* · *REGRESA #* · *ASIGNAR # cecy/cami/miguel*'
    : '\n\nUsa: *LISTO #* para cerrar · *REGRESA #* para devolver a Miri';

  await sendTextMessage(
    replyTo,
    `📋 *Leads pendientes (${conversations.length})*\n` + lines.join('\n') + footer,
    phoneNumberId
  );
  cmdLogger.info({ count: conversations.length }, 'Pendientes sent');
}

// ---------------------------------------------------------------------------
// LISTO #
// ---------------------------------------------------------------------------

async function handleListo(ticketNumber, advisor, replyTo, phoneNumberId, cmdLogger) {
  const lead = await findLeadByTicket(ticketNumber, advisor);
  const conv = await findWaitingConversation(lead, ticketNumber);

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { status: 'closed', closedAt: new Date() },
  });

  await leadService.updateTravelLead(lead.id, { status: 'cerrado_por_asesor' });

  const name = lead.parentName || lead.contact.name || lead.contact.phone;
  await sendTextMessage(
    replyTo,
    `✅ Lead #${ticketNumber} (${name}) cerrado. ¡Gracias ${advisor.apodo}!`,
    phoneNumberId
  );
  cmdLogger.info({ ticketNumber, name }, 'Lead closed by advisor');
}

// ---------------------------------------------------------------------------
// REGRESA #
// ---------------------------------------------------------------------------

async function handleRegresa(ticketNumber, advisor, replyTo, phoneNumberId, cmdLogger) {
  const lead = await findLeadByTicket(ticketNumber, advisor);
  const conv = await findWaitingConversation(lead, ticketNumber);

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { status: 'active', assignedAgent: null },
  });

  const name = lead.parentName || lead.contact.name || lead.contact.phone;
  await sendTextMessage(
    replyTo,
    `🔄 Lead #${ticketNumber} (${name}) devuelto a Miri. Retomo la atención automática.`,
    phoneNumberId
  );
  cmdLogger.info({ ticketNumber, name }, 'Lead returned to bot');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdvisor(phone) {
  const normalized = normalizePhone(phone).replace('+', '');
  const data = ADVISORS[normalized];
  return data ? { ...data, phone: normalized } : null;
}

function parseTicket(text, command) {
  const parts = text.split(' ');
  if (parts.length < 2) {
    throw new UserError(`Falta el número del lead. Ejemplo: ${command} 47`);
  }
  const n = parseInt(parts[1], 10);
  if (isNaN(n) || n < 1) {
    throw new UserError(`Número inválido. Ejemplo: ${command} 47`);
  }
  return n;
}

async function findLeadByTicket(ticketNumber, advisor) {
  const lead = await prisma.travelLead.findUnique({
    where: { ticketNumber },
    include: { contact: true },
  });

  if (!lead) {
    throw new UserError(`No encontré el lead #${ticketNumber}. Escribe PENDIENTES para ver tus leads.`);
  }

  if (advisor.role !== 'admin' && lead.assignedAdvisor !== advisor.nombre) {
    throw new UserError(`El lead #${ticketNumber} no está asignado a ti.`);
  }

  return lead;
}

async function findWaitingConversation(lead, ticketNumber) {
  const conv = await prisma.conversation.findFirst({
    where: { contactId: lead.contactId, status: 'waiting_human' },
  });

  if (!conv) {
    const any = await prisma.conversation.findFirst({
      where: { contactId: lead.contactId },
      orderBy: { lastMessageAt: 'desc' },
    });
    const currentStatus = any?.status || 'desconocido';
    throw new UserError(`El lead #${ticketNumber} no está en espera. Estado actual: ${currentStatus}`);
  }

  return conv;
}

function getHelpMessage(advisor) {
  return `Hola ${advisor.apodo} 👋 Soy Miri. Comandos disponibles:

✅ *LISTO #* → Cerrar un lead que ya atendiste
🔄 *REGRESA #* → Devolver un lead para que yo lo atienda
📋 *PENDIENTES* → Ver tus leads activos

Ejemplo: LISTO 47`;
}

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}
