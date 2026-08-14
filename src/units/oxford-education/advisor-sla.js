import prisma from '../../core/database/client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';
import { normalizePhone } from '../../utils/phone.js';
import { sendTextMessage } from './whatsapp.js';
import * as oxfordLeadService from './lead.service.js';
import { ADVISORS, DUPLAS } from './advisor-zones.js';
import { notifyAdvisor } from './advisor-notify.js';
import { recordAdvisorSlaOutcome } from './advisor-sla-sheet.js';

/**
 * Oxford Education — SLA de confirmación del asesor (feature/ori-advisor-sla)
 *
 * El asesor asignado tiene OXED_ADVISOR_SLA_MINUTES (default 10) para responder
 * ATIENDO. Si no confirma a tiempo, se reasigna automáticamente:
 *   1. primero a la PAREJA de su misma dupla,
 *   2. si tampoco, a las demás duplas en orden fijo A→B→C→D, asesor por asesor,
 *      saltando a quienes ya se intentaron.
 *   3. Si se agotan las 8 asesoras sin confirmación → status 'sin_confirmar'
 *      (terminal, requiere atención manual) + alerta en logs. Nunca hace bucle
 *      infinito.
 *
 * NO usa BullMQ (no está en el stack — ver auditoría de esta rama). Usa el MISMO
 * patrón de polling con setInterval que ya usan followup.job.js/sheets-sync.job.js:
 * este módulo expone processExpiredAssignments(), y src/jobs/advisor-sla.job.js
 * es el scheduler delgado que lo llama periódicamente. El "job diferido con
 * leadId + intento" del diseño original se traduce aquí a dos columnas en el
 * propio lead (slaDueAt + currentAttempt) que el poll consulta directamente —
 * mismo efecto (delay + payload), sin cola externa.
 *
 * Reutiliza SIN reimplementar: advisor-zones.js (ADVISORS/DUPLAS, única fuente de
 * verdad) y advisor-notify.js (notifyAdvisor, mismo formato/plantilla que el
 * handoff inicial). NUNCA toca el guard anti-redisparo de executeHandoffToAdvisor
 * — la reasignación es un camino distinto (updateMany condicional sobre
 * currentAttempt/confirmedAt), no un nuevo [DERIVAR_ASESOR].
 *
 * El PROSPECTO nunca se entera de las reasignaciones — solo se notifica a
 * asesores (nuevo y anterior); Ori no manda nada al prospecto desde aquí.
 */

// ── Constantes/resultados del rastro de intentos ────────────────────────────

export const ATTEMPT_RESULT = {
  WAITING: 'esperando',
  CONFIRMED: 'confirmo',
  NOT_CONFIRMED: 'no_confirmo',
};

// ── Builders puros (sin I/O) — testeables sin mocks ─────────────────────────

/**
 * Marca el ÚLTIMO intento del rastro con un resultado (confirmo/no_confirmo).
 * No muta el array recibido.
 * @param {Array|null|undefined} attempts
 * @param {'confirmo'|'no_confirmo'} result
 * @param {Date} at
 * @returns {Array}
 */
export function markLastAttempt(attempts, result, at) {
  const arr = Array.isArray(attempts) ? [...attempts] : [];
  if (arr.length > 0) {
    const last = { ...arr[arr.length - 1], result };
    if (result === ATTEMPT_RESULT.CONFIRMED) last.confirmedAt = at.toISOString();
    if (result === ATTEMPT_RESULT.NOT_CONFIRMED) last.expiredAt = at.toISOString();
    arr[arr.length - 1] = last;
  }
  return arr;
}

/**
 * Agrega un nuevo intento "esperando" al rastro. No muta el array recibido.
 * @param {Array|null|undefined} attempts
 * @param {Object} advisor - { nombre, key, ... }
 * @param {Date} at
 * @returns {Array}
 */
export function appendAttempt(attempts, advisor, at) {
  const arr = Array.isArray(attempts) ? [...attempts] : [];
  arr.push({ advisor: advisor.nombre, advisorKey: advisor.key, assignedAt: at.toISOString(), result: ATTEMPT_RESULT.WAITING });
  return arr;
}

/**
 * Campos a mergear en el `leadUpdate` cuando se (re)asigna un lead a `advisor`.
 * Usado TANTO en la asignación inicial (actions.js:executeHandoffToAdvisor /
 * handleForeignFallback) COMO en cada reasignación (processExpiredAssignments) —
 * mismo shape en ambos casos, así el job de SLA los trata de forma idéntica.
 *
 * @param {Object} lead - OxfordLead (lee currentAttempt/triedAdvisorKeys actuales)
 * @param {Object} advisor - { nombre, key } de advisor-zones.ADVISORS
 * @param {Date} [now]
 * @param {Array} [attemptsBase] - rastro base sobre el que se agrega el nuevo
 *   intento (por defecto lead.advisorAttempts; en una reasignación el caller pasa
 *   el rastro YA marcado con el resultado del intento anterior vía markLastAttempt)
 * @returns {Object} { assignedAt, slaDueAt, currentAttempt, triedAdvisorKeys, advisorAttempts }
 */
export function buildAssignmentFields(lead, advisor, now = new Date(), attemptsBase = lead.advisorAttempts) {
  const slaMinutes = env.OXED_ADVISOR_SLA_MINUTES;
  return {
    assignedAt: now,
    slaDueAt: new Date(now.getTime() + slaMinutes * 60000),
    currentAttempt: (lead.currentAttempt || 0) + 1,
    triedAdvisorKeys: Array.from(new Set([...(lead.triedAdvisorKeys || []), advisor.key])),
    advisorAttempts: appendAttempt(attemptsBase, advisor, now),
  };
}

/**
 * Campos a mergear en el `leadUpdate` cuando el asesor asignado confirma (ATIENDO).
 * @param {Object} lead - OxfordLead
 * @param {Date} [now]
 * @returns {Object} { confirmedAt, responseSeconds, status, advisorAttempts }
 */
export function buildConfirmationFields(lead, now = new Date()) {
  const responseSeconds = lead.assignedAt
    ? Math.max(0, Math.round((now.getTime() - new Date(lead.assignedAt).getTime()) / 1000))
    : null;

  return {
    confirmedAt: now,
    responseSeconds,
    status: 'en_atencion',
    advisorAttempts: markLastAttempt(lead.advisorAttempts, ATTEMPT_RESULT.CONFIRMED, now),
  };
}

/**
 * Siguiente candidato a reasignar: primero la pareja de `zoneKey` (si la hay),
 * luego TODAS las duplas en orden fijo A→B→C→D, asesor por asesor, saltando a
 * quienes ya estén en `triedKeys`. `null` si ya se intentaron las 8 (terminal).
 *
 * @param {'A'|'B'|'C'|'D'|null} zoneKey - dupla del lead (puede ser null/desconocida)
 * @param {Array<string>} triedKeys - keys de advisor-zones.ADVISORS ya intentados
 * @returns {string|null} key del siguiente asesor a intentar
 */
export function nextAdvisorCandidateKey(zoneKey, triedKeys = []) {
  const candidates = [];
  if (zoneKey && DUPLAS[zoneKey]) candidates.push(...DUPLAS[zoneKey].advisors);
  for (const k of ['A', 'B', 'C', 'D']) candidates.push(...DUPLAS[k].advisors);

  const seen = new Set();
  const ordered = [];
  for (const key of candidates) {
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered.find((key) => !triedKeys.includes(key)) || null;
}

// ── Helpers locales (derivados de ADVISORS/DUPLAS — sin tocar advisor-zones.js) ──

function advisorKeyByName(nombre) {
  const entry = Object.entries(ADVISORS).find(([, a]) => a.nombre === nombre);
  return entry ? entry[0] : null;
}

function duplaKeyForAdvisor(advisorKey) {
  for (const [duplaKey, def] of Object.entries(DUPLAS)) {
    if (def.advisors.includes(advisorKey)) return duplaKey;
  }
  return null;
}

/** Aviso breve al asesor anterior — el prospecto NUNCA se entera de esto. */
async function notifyPreviousAdvisorReassigned(previousAdvisorKey, lead, log) {
  const previous = previousAdvisorKey ? ADVISORS[previousAdvisorKey] : null;
  if (!previous) return;

  const advisorPhone = normalizePhone(previous.whatsapp).replace('+', '');
  const ticket = lead.ticketNumber || '?';
  try {
    await sendTextMessage(advisorPhone, `ℹ️ El lead #${ticket} se reasignó a otra asesora — ya no requiere tu atención.`);
  } catch (error) {
    log.error({ err: error, advisor: previous.nombre }, 'Error notifying previous Oxford advisor about reassignment');
  }
}

// ── Orquestación (I/O) ───────────────────────────────────────────────────────

/**
 * Reasigna (o marca sin_confirmar) UN lead vencido. Guard de carrera: el update
 * es condicional (currentAttempt sigue siendo el que se leyó Y confirmedAt sigue
 * null) — si alguien más ya confirmó o reasignó este lead entre la lectura y
 * este punto (p.ej. el asesor mandó ATIENDO justo cuando el job disparaba), el
 * update NO aplica (count=0) y esta función no hace nada más: sin doble
 * notificación, sin doble reasignación.
 */
/**
 * Exportada (además de ser llamada por processExpiredAssignments) para poder
 * probar el guard de concurrencia directamente: se le puede pasar un snapshot
 * "viejo" de un lead (como si el job lo hubiera leído antes de una confirmación
 * concurrente) y verificar que el update condicional NO aplica. Ver
 * scripts/test-oxford-advisor-sla.mjs.
 */
export async function reassignOneLead(lead, now, log) {
  const expectedAttempt = lead.currentAttempt;
  const guard = { currentAttempt: expectedAttempt, confirmedAt: null };
  const previousAdvisorKey = advisorKeyByName(lead.assignedAdvisor);
  const nextKey = nextAdvisorCandidateKey(lead.zoneKey, lead.triedAdvisorKeys || []);

  // ── TERMINAL: ya se intentaron las 8 asesoras ─────────────────────────────
  if (!nextKey) {
    const terminalAttempts = markLastAttempt(lead.advisorAttempts, ATTEMPT_RESULT.NOT_CONFIRMED, now);
    const applied = await oxfordLeadService.conditionalUpdateOxfordLead(lead.id, guard, {
      status: 'sin_confirmar',
      advisorAttempts: terminalAttempts,
    });

    if (applied) {
      log.error(
        { leadId: lead.id, ticket: lead.ticketNumber, triedAdvisorKeys: lead.triedAdvisorKeys },
        'ALERTA SLA Oxford: se agotaron TODAS las asesoras sin confirmación — lead sin_confirmar, requiere atención manual',
      );
      // Visibilidad en Sheet: se registra el evento TERMINAL una sola vez (el
      // guard condicional de arriba ya asegura que solo entra aquí si el update
      // realmente aplicó). Best-effort — nunca lanza.
      await recordAdvisorSlaOutcome({ ...lead, status: 'sin_confirmar', advisorAttempts: terminalAttempts }, lead.contact);
    } else {
      log.info({ leadId: lead.id, attempt: expectedAttempt }, 'Job de SLA obsoleto (confirmado/reasignado en paralelo) — sin acción');
    }
    return;
  }

  // ── Reasignar a nextKey ────────────────────────────────────────────────────
  const nextAdvisor = ADVISORS[nextKey];
  const attemptsWithPrevMarked = markLastAttempt(lead.advisorAttempts, ATTEMPT_RESULT.NOT_CONFIRMED, now);
  const assignmentFields = buildAssignmentFields(lead, nextAdvisor, now, attemptsWithPrevMarked);
  const duplaKey = duplaKeyForAdvisor(nextKey) || lead.zoneKey;

  const applied = await oxfordLeadService.conditionalUpdateOxfordLead(lead.id, guard, {
    assignedAdvisor: nextAdvisor.nombre,
    reassignCount: (lead.reassignCount || 0) + 1,
    ...assignmentFields,
    notes: [
      lead.notes,
      `[SLA] Reasignado de ${lead.assignedAdvisor || '—'} a ${nextAdvisor.nombre} (sin confirmación en ${env.OXED_ADVISOR_SLA_MINUTES} min)`,
    ].filter(Boolean).join('\n'),
  });

  if (!applied) {
    log.info({ leadId: lead.id, attempt: expectedAttempt }, 'Job de SLA obsoleto (confirmado/reasignado en paralelo) — sin doble reasignación');
    return;
  }

  // El PROSPECTO no se entera — solo se notifica a asesores.
  const leadForNotify = { ...lead, ...assignmentFields, assignedAdvisor: nextAdvisor.nombre };
  await notifyAdvisor(
    nextAdvisor,
    leadForNotify,
    null,
    lead.contact,
    `Reasignación automática — la asesora anterior no confirmó en ${env.OXED_ADVISOR_SLA_MINUTES} min`,
    duplaKey,
    log,
  );
  await notifyPreviousAdvisorReassigned(previousAdvisorKey, lead, log);

  log.info(
    { leadId: lead.id, ticket: lead.ticketNumber, from: lead.assignedAdvisor, to: nextAdvisor.nombre, attempt: assignmentFields.currentAttempt },
    'Oxford lead reasignado automáticamente (SLA vencido)',
  );
}

/**
 * Busca leads vencidos (asignados, sin confirmar, con slaDueAt cumplido) y los
 * reasigna uno por uno. Llamado periódicamente por src/jobs/advisor-sla.job.js.
 * Nunca lanza — best-effort, igual que el resto de los jobs del repo.
 *
 * @param {Date} [now]
 * @returns {Promise<{found: number, processed: number}>}
 */
export async function processExpiredAssignments(now = new Date()) {
  const log = logger.child({ unit: 'oxford_education', fn: 'advisor-sla.processExpiredAssignments' });

  let dueLeads;
  try {
    dueLeads = await prisma.oxfordLead.findMany({
      where: { status: 'derivado_asesor', confirmedAt: null, slaDueAt: { lte: now } },
      include: { contact: true },
    });
  } catch (error) {
    log.error({ err: error }, 'Error querying due Oxford leads for SLA reassignment');
    return { found: 0, processed: 0 };
  }

  let processed = 0;
  for (const lead of dueLeads) {
    try {
      await reassignOneLead(lead, now, log);
      processed++;
    } catch (error) {
      log.error({ err: error, leadId: lead.id }, 'Error reassigning Oxford lead (SLA) — continuing with the rest');
    }
  }

  if (dueLeads.length > 0) {
    log.info({ found: dueLeads.length, processed }, 'Oxford advisor SLA sweep completed');
  }

  return { found: dueLeads.length, processed };
}
