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
  // WhatsApp sends Mexican numbers as 521XXXXXXXXXX (13 digits).
  // normalizePhone produces +52115XXXXXXXXX which strips to 14 chars.
  // ADVISORS keys are 10-digit local numbers, so compare last 10 digits.
  const normalized = normalizePhone(phone).replace('+', '');
  return normalized.slice(-10) in ADVISORS;
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
      // No-op: con el handoff tibio Miri nunca se silencia, no hay nada que "regresar".
      await sendTextMessage(
        message.from,
        'ℹ️ Ya no hace falta REGRESA: Miri nunca deja de atender al prospecto tras derivar. Usa *LISTO #* cuando cierres el lead.',
        phoneNumberId,
      );

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
  // Con el handoff tibio la conversación queda 'active'; los pendientes se rastrean
  // por el LEAD (status 'derivado_asesor', sin cerrar por LISTO).
  const where = advisor.role === 'admin'
    ? { status: 'derivado_asesor' }
    : { status: 'derivado_asesor', assignedAdvisor: advisor.nombre };

  const leads = await prisma.travelLead.findMany({
    where,
    orderBy: { updatedAt: 'asc' },
    include: { contact: true },
  });

  if (leads.length === 0) {
    await sendTextMessage(replyTo, '✅ No tienes leads pendientes en este momento.', phoneNumberId);
    return;
  }

  const now = Date.now();
  const lines = leads.map(lead => {
    const ticket    = lead.ticketNumber ? `#${lead.ticketNumber}` : '(sin #)';
    const name      = lead.parentName || lead.contact?.name || lead.contact?.phone;
    const school    = lead.schoolCode ? ` (${lead.schoolCode})` : '';
    const typeEmoji = lead.leadType === 'institucion' ? '🏫' : '👨‍👩‍👧';
    const assigned  = lead.assignedAdvisor ? ` → ${lead.assignedAdvisor}` : '';

    const diffMin = Math.floor((now - new Date(lead.updatedAt).getTime()) / 60000);
    const timeAgo = diffMin < 60
      ? `hace ${diffMin} min`
      : `hace ${Math.floor(diffMin / 60)}h ${diffMin % 60}min`;

    return `${ticket} — ${name}${school} ${typeEmoji}${assigned} — ${timeAgo}`;
  });

  await sendTextMessage(
    replyTo,
    `📋 *Leads pendientes (${leads.length})*\n` + lines.join('\n') + '\n\nUsa *LISTO #* cuando cierres/atiendas el lead.',
    phoneNumberId
  );
  cmdLogger.info({ count: leads.length }, 'Pendientes sent');
}

// ---------------------------------------------------------------------------
// LISTO #
// ---------------------------------------------------------------------------

async function handleListo(ticketNumber, advisor, replyTo, phoneNumberId, cmdLogger) {
  const lead = await findLeadByTicket(ticketNumber, advisor);

  // Solo tracking: cierra el lead. NO toca la conversación (Miri nunca se silencia).
  await leadService.updateTravelLead(lead.id, { status: 'atendido_asesor' });

  const name = lead.parentName || lead.contact.name || lead.contact.phone;
  await sendTextMessage(
    replyTo,
    `✅ Lead #${ticketNumber} (${name}) marcado como atendido. Miri sigue disponible para el prospecto.`,
    phoneNumberId
  );
  cmdLogger.info({ ticketNumber, name }, 'Lead marked attended (tracking) by advisor');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdvisor(phone) {
  const normalized = normalizePhone(phone).replace('+', '');
  const last10 = normalized.slice(-10);
  const data = ADVISORS[last10];
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

function getHelpMessage(advisor) {
  return `Hola ${advisor.apodo} 👋 Soy Miri. Comandos disponibles:

✅ *LISTO #* → Marcar como cerrado/atendido un lead (tracking)
📋 *PENDIENTES* → Ver tus leads derivados sin cerrar

Nota: Miri nunca deja de atender al prospecto tras derivar, así que ya no existe REGRESA.

Ejemplo: LISTO 47`;
}

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}
