import logger from '../../utils/logger.js';
import prisma from '../../core/database/client.js';
import { env } from '../../config/env.js';
import { normalizePhone } from '../../utils/phone.js';
import { sendTextMessage } from './whatsapp.js';
import * as oxfordLeadService from './lead.service.js';
import { advisorByPhone, ADVISORS } from './advisor-zones.js';
import { buildClaimFields, canAdvisorClaim, isLateClaim, CLAIMABLE_STATUSES } from './advisor-sla.js';
import { recordAdvisorCommand, isAdvisorWindowOpen } from '../../services/advisor-command.service.js';
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

  // Bitácora: todo mensaje de una asesora queda guardado con lo que se le
  // contestó (services/advisor-command.service.js). También es lo que permite
  // saber si su ventana de 24h está abierta.
  const entry = { command: 'OTRO', ticketNumber: null, outcome: 'ignorado', detail: null };

  try {
    if (text === 'PENDIENTES' || text === 'PENDIENTE') {
      entry.command = 'PENDIENTES';
      await handlePendientes(advisor, message.from, cmdLog);
      entry.outcome = 'info';
    } else if (text.startsWith('ATIENDO ') || text === 'ATIENDO') {
      entry.command = 'ATIENDO';
      const ticketNumber = text === 'ATIENDO' ? null : parseTicket(text, 'ATIENDO');
      entry.ticketNumber = ticketNumber;
      const result = await handleAtiendo(ticketNumber, advisor, message.from, cmdLog);
      entry.ticketNumber = result.ticketNumber;
      entry.outcome = result.outcome;
      entry.detail = result.detail;
    } else if (text.startsWith('LISTO ') || text === 'LISTO') {
      entry.command = 'LISTO';
      entry.ticketNumber = parseTicket(text, 'LISTO');
      await handleListo(entry.ticketNumber, advisor, message.from, cmdLog);
      entry.outcome = 'aceptado';
    } else if (text.startsWith('REGRESA ') || text === 'REGRESA') {
      entry.command = 'REGRESA';
      entry.outcome = 'info';
      // No-op: con el handoff tibio Ori nunca se silencia, no hay nada que "regresar".
      await sendTextMessage(
        message.from,
        'ℹ️ Ya no hace falta REGRESA: Ori nunca deja de atender al prospecto tras derivar. ' +
          'Usa *LISTO #* cuando cierres el lead.',
      );
    } else if (text === 'AYUDA' || text === 'HELP' || text === 'HOLA') {
      entry.command = 'AYUDA';
      entry.outcome = 'info';
      await sendTextMessage(message.from, getHelpMessage(advisor));
    } else {
      cmdLog.debug('Unknown Oxford advisor command, ignoring');
    }
  } catch (err) {
    if (err instanceof UserError) {
      entry.outcome = 'rechazado';
      entry.detail = err.message;
      await sendTextMessage(message.from, `❌ ${err.message}`);
    } else {
      entry.outcome = 'error';
      entry.detail = err?.message || String(err);
      cmdLog.error({ err }, 'Unexpected error in Oxford advisor command');
      await sendTextMessage(message.from, '❌ Error interno. Intenta de nuevo.');
    }
  } finally {
    await recordAdvisorCommand({
      unit: 'oxford_education', advisor, advisorPhone: advisor.phone, text: raw,
      ...entry, waMessageId: message.id || null,
    });
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
    ? await findClaimableLeadByTicket(ticketNumber, advisor)
    : await findPendingConfirmationLeadForAdvisor(advisor);
  const ticket = lead.ticketNumber;

  if (lead.confirmedAt || !CLAIMABLE_STATUSES.includes(lead.status)) {
    if (lead.assignedAdvisor === advisor.nombre) {
      await sendTextMessage(replyTo, `ℹ️ El lead #${ticket} ya estaba confirmado.`);
      return { ticketNumber: ticket, outcome: 'info', detail: 'ya estaba confirmado por ella' };
    }
    throw new UserError(`El lead #${ticket} ya lo atiende ${lead.assignedAdvisor || 'otra asesora'}.`);
  }

  const now = new Date();
  const fields = buildClaimFields(lead, advisor, now);
  const late = isLateClaim(lead, advisor);

  // GANA LA PRIMERA QUE CONFIRME. El update es condicional a que nadie haya
  // confirmado todavía; si dos ATIENDO llegan casi a la vez, solo uno aplica
  // (count=1) y a la otra se le dice quién lo tomó. El mismo guard cubre la
  // carrera contra el job de SLA (que también exige confirmedAt: null).
  const applied = await oxfordLeadService.conditionalUpdateOxfordLead(
    lead.id,
    { confirmedAt: null, status: { in: CLAIMABLE_STATUSES } },
    fields,
  );

  if (!applied) {
    const fresh = await oxfordLeadService.getOxfordLeadById(lead.id).catch(() => null);
    throw new UserError(`El lead #${ticket} ya lo atiende ${fresh?.assignedAdvisor || 'otra asesora'}.`);
  }

  const mins = Math.floor(fields.responseSeconds / 60);
  const secs = fields.responseSeconds % 60;
  const tiempo = fields.responseSeconds != null && !late ? ` (en ${mins}m ${secs}s)` : '';
  await sendTextMessage(
    replyTo,
    `✅ Confirmado, el lead #${ticket} es tuyo${tiempo}. Ori sigue disponible para el prospecto mientras tú tomas precio y cierre.`,
  );
  cmdLog.info({ ticketNumber: ticket, responseSeconds: fields.responseSeconds, late }, 'Oxford advisor confirmed lead (ATIENDO)');

  // Si lo tenía otra asesora en espera, se le avisa que ya lo tomaron — solo con
  // su ventana de 24h abierta (texto libre; nunca una plantilla por esto).
  // (En modo team son todas las del equipo que seguían esperando.)
  const enEspera = (Array.isArray(lead.advisorAttempts) ? lead.advisorAttempts : [])
    .filter((a) => a.result === 'esperando' && a.advisor !== advisor.nombre)
    .map((a) => a.advisor);
  if (enEspera.length === 0 && lead.status === 'derivado_asesor' && lead.assignedAdvisor && lead.assignedAdvisor !== advisor.nombre) {
    enEspera.push(lead.assignedAdvisor);
  }
  for (const nombre of new Set(enEspera)) {
    await notifyTakenByOther(nombre, ticket, advisor, cmdLog, now);
  }

  // Visibilidad en Sheets ("Tiempos asesores" + "Resumen asesoras"). Best-effort.
  await recordAdvisorSlaOutcome({ ...lead, ...fields, assignedAdvisor: advisor.nombre }, lead.contact);

  return { ticketNumber: ticket, outcome: 'aceptado', detail: late ? 'ATIENDO tardío (el lead ya se había reasignado o estaba sin confirmar)' : null };
}

/** Aviso a la asesora que tenía el lead en espera cuando otra lo tomó. Nunca lanza. */
async function notifyTakenByOther(previousName, ticket, claimer, cmdLog, now) {
  try {
    const previous = Object.values(ADVISORS).find((a) => a.nombre === previousName);
    if (!previous) return;
    const phone = normalizePhone(previous.whatsapp).replace('+', '');
    if (!(await isAdvisorWindowOpen({ unit: 'oxford_education', advisorPhone: phone, now }))) return;
    await sendTextMessage(phone, `ℹ️ El lead #${ticket} ya lo atiende ${claimer.nombre}.`);
  } catch (error) {
    cmdLog.error({ err: error, advisor: previousName }, 'Error avisando a la asesora anterior que el lead ya se tomó');
  }
}

// ATIENDO sin número solo mira avisos recientes: evita que un "ATIENDO" suelto
// tome por accidente un lead de hace semanas.
const CLAIM_LOOKBACK_MS = 72 * 60 * 60 * 1000;

/**
 * ATIENDO sin ticket. Primero el lead que tiene asignado sin confirmar (el caso de
 * siempre). Si no tiene ninguno, los que se le avisaron en las últimas 72h y nadie
 * ha confirmado (ATIENDO tardío). Ambiguo → pide el número.
 */
async function findPendingConfirmationLeadForAdvisor(advisor) {
  let leads = await prisma.oxfordLead.findMany({
    where: { assignedAdvisor: advisor.nombre, status: 'derivado_asesor', confirmedAt: null },
    orderBy: { assignedAt: 'asc' },
    include: { contact: true },
  });

  if (leads.length === 0) {
    leads = await prisma.oxfordLead.findMany({
      where: {
        triedAdvisorKeys: { has: advisor.key },
        status: { in: CLAIMABLE_STATUSES },
        confirmedAt: null,
        assignedAt: { gte: new Date(Date.now() - CLAIM_LOOKBACK_MS) },
      },
      orderBy: { assignedAt: 'asc' },
      include: { contact: true },
    });
  }

  if (leads.length === 0) {
    throw new UserError('No tienes ningún lead pendiente de confirmar en este momento. Escribe PENDIENTES para ver tus leads.');
  }
  if (leads.length > 1) {
    const tickets = leads.map((l) => `#${l.ticketNumber}`).join(', ');
    throw new UserError(`Tienes varios leads pendientes de confirmar (${tickets}). Especifica el número: ATIENDO <ticket>.`);
  }
  return leads[0];
}

/**
 * ATIENDO con ticket: lo puede tomar la asignada actual o cualquiera a la que ya
 * se le había avisado de ese lead. Quien nunca recibió el aviso, no.
 */
async function findClaimableLeadByTicket(ticketNumber, advisor) {
  const lead = await prisma.oxfordLead.findUnique({ where: { ticketNumber }, include: { contact: true } });
  if (!lead) throw new UserError(`No encontré el lead #${ticketNumber}. Escribe PENDIENTES para ver tus leads.`);
  if (!canAdvisorClaim(lead, advisor)) throw new UserError(`El lead #${ticketNumber} no está asignado a ti.`);
  return lead;
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
