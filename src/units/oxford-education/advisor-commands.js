import logger from '../../utils/logger.js';
import prisma from '../../core/database/client.js';
import { env } from '../../config/env.js';
import { normalizePhone } from '../../utils/phone.js';
import { sendTextMessage } from './whatsapp.js';
import * as oxfordLeadService from './lead.service.js';
import { advisorByPhone } from './advisor-zones.js';
import { buildConfirmationFields } from './advisor-sla.js';
import { recordAdvisorSlaOutcome } from './advisor-sla-sheet.js';

/**
 * Oxford Education — comandos de asesor por WhatsApp
 *
 * Espeja el patrón de Travel (advisor-commands.js) pero AISLADO en la unit Oxford:
 * usa el cliente WhatsApp de Oxford, la tabla oxford_leads y el registro único de
 * asesores (advisor-zones.js). Comandos: PENDIENTES · ATIENDO [#] · LISTO # · AYUDA.
 * (REGRESA quedó como no-op: con el handoff "tibio" Ori nunca se silencia.)
 *
 * El whitelist de asesores es advisor-zones.ADVISORS (una sola fuente de verdad),
 * así que cualquier asesor de una dupla puede responder a sus derivaciones.
 *
 * ATIENDO (feature/ori-advisor-sla): el asesor asignado confirma que toma el
 * lead — arranca el tracking de tiempos de respuesta y desactiva la reasignación
 * automática por SLA (ver advisor-sla.js). Solo el asesor ACTUALMENTE asignado
 * puede confirmar (update condicional: si se reasignó justo antes, no aplica).
 */

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

/** ¿El número entrante pertenece a un asesor de Oxford? */
export function isOxfordAdvisorPhone(phone) {
  const normalized = normalizePhone(phone).replace('+', '');
  return advisorByPhone(normalized) !== null;
}

function getAdvisor(phone) {
  const normalized = normalizePhone(phone).replace('+', '');
  const advisor = advisorByPhone(normalized);
  return advisor ? { ...advisor, phone: normalized } : null;
}

/** Punto de entrada: enruta el comando del asesor. */
export async function handleOxfordAdvisorCommand(message) {
  const advisor = getAdvisor(message.from);
  if (!advisor) return;

  const raw = (message.text?.body || '').trim();
  // Insensible a mayúsculas/acentos (ATIENDO no lleva acento, pero se normaliza
  // por robustez ante autocorrección del teléfono; aplica igual al resto de
  // comandos, ninguno de los cuales lleva acentos).
  const text = stripAccents(raw).toUpperCase();
  const cmdLog = logger.child({ unit: 'oxford_education', advisor: advisor.nombre, command: text });
  cmdLog.info('Received Oxford advisor command');

  try {
    if (text === 'PENDIENTES' || text === 'PENDIENTE') {
      await handlePendientes(advisor, message.from, cmdLog);
    } else if (text.startsWith('ATIENDO ') || text === 'ATIENDO') {
      const ticketNumber = text === 'ATIENDO' ? null : parseTicket(text, 'ATIENDO');
      await handleAtiendo(ticketNumber, advisor, message.from, cmdLog);
    } else if (text.startsWith('LISTO ') || text === 'LISTO') {
      await handleListo(parseTicket(text, 'LISTO'), advisor, message.from, cmdLog);
    } else if (text.startsWith('REGRESA ') || text === 'REGRESA') {
      // No-op documentado: Ori ya NO se silencia al derivar (handoff tibio), así
      // que no hay nada que "regresar". Se conserva el comando para no confundir a
      // asesores acostumbrados a Travel.
      await sendTextMessage(
        message.from,
        'ℹ️ Ya no hace falta REGRESA: Ori nunca deja de atender al prospecto tras derivar. ' +
          'Usa *LISTO #* cuando cierres el lead.',
      );
    } else if (text === 'AYUDA' || text === 'HELP' || text === 'HOLA') {
      await sendTextMessage(message.from, getHelpMessage(advisor));
    } else {
      cmdLog.debug('Unknown Oxford advisor command, ignoring');
    }
  } catch (err) {
    if (err instanceof UserError) {
      await sendTextMessage(message.from, `❌ ${err.message}`);
    } else {
      cmdLog.error({ err }, 'Unexpected error in Oxford advisor command');
      await sendTextMessage(message.from, '❌ Error interno. Intenta de nuevo.');
    }
  }
}

// ── PENDIENTES ────────────────────────────────────────────────────────────────

async function handlePendientes(advisor, replyTo, cmdLog) {
  // Los pendientes se rastrean por el LEAD (status 'derivado_asesor'), NO por la
  // conversación: con el handoff tibio la conversación sigue 'active'.
  const leads = await prisma.oxfordLead.findMany({
    where: { assignedAdvisor: advisor.nombre, status: 'derivado_asesor' },
    orderBy: { updatedAt: 'asc' },
    include: { contact: true },
  });

  if (leads.length === 0) {
    await sendTextMessage(replyTo, '✅ No tienes leads pendientes en este momento.');
    return;
  }

  const now = Date.now();
  const lines = leads.map((lead) => {
    const ticket = lead.ticketNumber ? `#${lead.ticketNumber}` : '(sin #)';
    const name = lead.fullName || lead.contact?.name || lead.contact?.phone;
    const zona = lead.state ? ` (${lead.state})` : '';
    const diffMin = Math.floor((now - new Date(lead.updatedAt).getTime()) / 60000);
    const timeAgo = diffMin < 60 ? `hace ${diffMin} min` : `hace ${Math.floor(diffMin / 60)}h ${diffMin % 60}min`;
    return `${ticket} — ${name}${zona} — ${timeAgo}`;
  });

  await sendTextMessage(
    replyTo,
    `📋 *Leads pendientes (${leads.length})*\n` + lines.join('\n') +
      '\n\nUsa *LISTO #* cuando cierres/atiendas el lead.',
  );
  cmdLog.info({ count: leads.length }, 'Oxford pendientes sent');
}

// ── ATIENDO [#] (feature/ori-advisor-sla) ────────────────────────────────────
// El asesor asignado confirma que toma el lead: registra confirmedAt/
// responseSeconds, pasa el lead a 'en_atencion' y desactiva la reasignación
// automática (el job de SLA solo mira leads con confirmedAt=null).

async function handleAtiendo(ticketNumber, advisor, replyTo, cmdLog) {
  const lead = ticketNumber
    ? await findLeadByTicket(ticketNumber, advisor) // reusa el mismo guard/mensaje que LISTO
    : await findPendingConfirmationLeadForAdvisor(advisor);

  if (lead.confirmedAt) {
    await sendTextMessage(replyTo, `ℹ️ El lead #${lead.ticketNumber} ya estaba confirmado.`);
    return;
  }

  const now = new Date();
  const fields = buildConfirmationFields(lead, now);

  // Update CONDICIONAL: si el lead se reasignó a otro asesor justo entre que se
  // leyó arriba y este punto (carrera con el job de SLA), `applied` da false y
  // NO se confirma — el asesor ya no es el actual, se le avisa sin romper nada.
  const applied = await oxfordLeadService.conditionalUpdateOxfordLead(
    lead.id,
    { assignedAdvisor: advisor.nombre, confirmedAt: null },
    fields,
  );

  if (!applied) {
    throw new UserError(`El lead #${lead.ticketNumber} ya no está asignado a ti.`);
  }

  const mins = Math.floor(fields.responseSeconds / 60);
  const secs = fields.responseSeconds % 60;
  const tiempo = fields.responseSeconds != null ? ` (en ${mins}m ${secs}s)` : '';
  await sendTextMessage(
    replyTo,
    `✅ Confirmado, el lead #${lead.ticketNumber} es tuyo${tiempo}. Ori sigue disponible para el prospecto mientras tú tomas precio y cierre.`,
  );
  cmdLog.info({ ticketNumber: lead.ticketNumber, responseSeconds: fields.responseSeconds }, 'Oxford advisor confirmed lead (ATIENDO)');

  // Visibilidad en Sheet (feature/ori-advisor-sla): fila de detalle + resumen
  // por asesora. Best-effort — recordAdvisorSlaOutcome nunca lanza, así que un
  // fallo de Sheets no afecta el ack que ya se mandó arriba.
  await recordAdvisorSlaOutcome({ ...lead, ...fields, assignedAdvisor: advisor.nombre }, lead.contact);
}

/** ATIENDO sin ticket: busca el único lead asignado sin confirmar. Ambiguo → pide especificar. */
async function findPendingConfirmationLeadForAdvisor(advisor) {
  const leads = await prisma.oxfordLead.findMany({
    where: { assignedAdvisor: advisor.nombre, status: 'derivado_asesor', confirmedAt: null },
    orderBy: { assignedAt: 'asc' },
    include: { contact: true },
  });

  if (leads.length === 0) {
    throw new UserError('No tienes ningún lead pendiente de confirmar en este momento. Escribe PENDIENTES para ver tus leads.');
  }
  if (leads.length > 1) {
    const tickets = leads.map((l) => `#${l.ticketNumber}`).join(', ');
    throw new UserError(`Tienes varios leads pendientes de confirmar (${tickets}). Especifica el número: ATIENDO <ticket>.`);
  }
  return leads[0];
}

// ── LISTO # ───────────────────────────────────────────────────────────────────
// Marca de tracking: cierra el lead (status 'atendido_asesor'). NO toca la
// conversación — Ori nunca se silencia, así que no hay mute que revertir.

async function handleListo(ticketNumber, advisor, replyTo, cmdLog) {
  const lead = await findLeadByTicket(ticketNumber, advisor);

  await oxfordLeadService.updateOxfordLead(lead.id, { status: 'atendido_asesor' });

  const name = lead.fullName || lead.contact.name || lead.contact.phone;
  await sendTextMessage(
    replyTo,
    `✅ Lead #${ticketNumber} (${name}) marcado como atendido. Ori sigue disponible para el prospecto.`,
  );
  cmdLog.info({ ticketNumber, name }, 'Oxford lead marked attended (tracking) by advisor');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripAccents(s) {
  return (s || '').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

function parseTicket(text, command) {
  const parts = text.split(' ');
  if (parts.length < 2) throw new UserError(`Falta el número del lead. Ejemplo: ${command} 47`);
  const n = parseInt(parts[1], 10);
  if (isNaN(n) || n < 1) throw new UserError(`Número inválido. Ejemplo: ${command} 47`);
  return n;
}

async function findLeadByTicket(ticketNumber, advisor) {
  const lead = await prisma.oxfordLead.findUnique({ where: { ticketNumber }, include: { contact: true } });
  if (!lead) throw new UserError(`No encontré el lead #${ticketNumber}. Escribe PENDIENTES para ver tus leads.`);
  if (lead.assignedAdvisor !== advisor.nombre) throw new UserError(`El lead #${ticketNumber} no está asignado a ti.`);
  return lead;
}

function getHelpMessage(advisor) {
  return `Hola ${advisor.apodo} 👋 Soy Ori. Comandos disponibles:

⏱️ *ATIENDO [#]* → Confirmar que tomas un lead recién derivado (tienes ${env.OXED_ADVISOR_SLA_MINUTES} min o se reasigna)
✅ *LISTO #* → Marcar como cerrado/atendido un lead (tracking)
📋 *PENDIENTES* → Ver tus leads derivados sin cerrar

Nota: Ori nunca deja de atender al prospecto tras derivar, así que ya no existe REGRESA.

Ejemplo: LISTO 47`;
}
