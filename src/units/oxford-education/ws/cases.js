/**
 * W&S OTCC — casos de soporte: creación, aviso al equipo y escalamiento.
 *
 * Mismo esquema que el SLA comercial pero con su propia configuración:
 *   - Karen (contacto 1) recibe el aviso; si no responde ATIENDO en
 *     OXED_WS_SLA_MINUTES (minutos HÁBILES), pasa a Jorge Gil (contacto 2).
 *   - Si el último contacto tampoco responde: el caso queda `sin_confirmar`.
 *     NO se avisa a nadie más; Karen o Jorge lo pueden tomar después.
 *   - Fuera de horario: el caso se registra y el aviso SALE a la siguiente
 *     apertura (8:00 CDMX del siguiente día hábil); los minutos cuentan desde ahí.
 * Las transiciones son condicionales (updateMany con el estado esperado) para
 * que el poller y un ATIENDO simultáneo no se pisen.
 */
import prisma from '../../../core/database/client.js';
import logger from '../../../utils/logger.js';
import * as wa from '../whatsapp.js';
import { recordAdvisorNotification } from '../../../services/advisor-notification.service.js';
import { isAdvisorWindowOpen } from '../../../services/advisor-command.service.js';
import { wsConfig } from './config.js';
import { isWithinTeamHours, nextOpening, businessDue } from './hours.js';
import { syncCaseToSheet } from './cases-sheet.js';

export const OPEN_STATUSES = ['pendiente_aviso', 'asignado', 'sin_confirmar'];
const log = () => logger.child({ unit: 'oxford_education', mod: 'ws-cases' });

/** Parámetros de plantilla: sin saltos de línea ni tabs (Meta los rechaza) y recortados. */
export function templateParam(v, max = 300) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim() || '—';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function readablePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  const l10 = d.slice(-10);
  return d.startsWith('52') && l10.length === 10 ? `${l10.slice(0, 2)} ${l10.slice(2, 6)} ${l10.slice(6)}` : `+${d}`;
}

export function caseTemplateParams(c, attachmentsCount) {
  const capt = attachmentsCount === 0 ? 'ninguna' : attachmentsCount === 1 ? '1' : `${attachmentsCount} (te llegan las demás al responder ATIENDO)`;
  return [c.caseNumber, c.fullName, c.email, c.stage, readablePhone(c.phone), c.description, capt].map((v) => templateParam(v));
}

export function caseTextNotice(c, attachmentsCount, contact) {
  return `🛟 Caso W&S · OTCC #${c.caseNumber}\n\n👤 ${c.fullName}\n✉️ ${c.email}\n📚 Etapa: ${c.stage}\n📱 ${readablePhone(c.phone)}\n\n📝 ${c.description}\n\n📎 Capturas: ${attachmentsCount}\n\n`
    + `Hola ${contact.apodo}: el participante sigue con Ox para dudas generales. Responde ATIENDO ${c.caseNumber} para tomar el caso — si no confirmas pronto, se reasigna. Responde LISTO ${c.caseNumber} cuando quede resuelto.`;
}

async function attachmentsOf(caseId) {
  return prisma.caseAttachment.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
}

/**
 * Manda el aviso del caso a un contacto del equipo. Nunca lanza.
 * Prioridad: plantilla con imagen (si hay captura) → plantilla de texto → texto
 * libre con la ventana abierta → no sale (queda registrado como error).
 */
export async function notifyContact(c, contact, { kind = 'caso_ws' } = {}) {
  const cfg = wsConfig();
  const atts = await attachmentsOf(c.id).catch(() => []);
  const params = caseTemplateParams(c, atts.length);
  const first = atts.find((a) => a.data);
  const rec = (via, extra = {}) => recordAdvisorNotification({
    unit: 'oxford_education', lead: { id: c.id, ticketNumber: c.caseNumber }, advisor: { nombre: contact.nombre },
    advisorPhone: contact.phone, kind, via, ...extra,
  });
  try {
    if (cfg.templateImg && first) {
      const mediaId = await wa.uploadMedia(Buffer.from(first.data), first.mimeType);
      const resp = await wa.sendTemplateWithImage(contact.phone, cfg.templateImg, cfg.templateLang, mediaId, params);
      await prisma.caseAttachment.update({ where: { id: first.id }, data: { forwardedTo: { push: contact.key } } }).catch(() => {});
      await rec('template', { templateName: cfg.templateImg, apiResponse: resp });
      return { via: 'template', template: cfg.templateImg };
    }
    if (cfg.template) {
      const resp = await wa.sendTemplateMessage(contact.phone, cfg.template, cfg.templateLang, params);
      await rec('template', { templateName: cfg.template, apiResponse: resp });
      return { via: 'template', template: cfg.template };
    }
    if (await isAdvisorWindowOpen({ unit: 'oxford_education', advisorPhone: contact.phone })) {
      const resp = await wa.sendTextMessage(contact.phone, caseTextNotice(c, atts.length, contact));
      await rec('text', { apiResponse: resp });
      await forwardPendingAttachments(c, contact);
      return { via: 'text' };
    }
    const error = new Error('Sin plantilla de caso aprobada (OXED_WS_TEMPLATE) y la ventana de 24h del contacto está cerrada');
    log().error({ caseNumber: c.caseNumber, contact: contact.nombre }, `ALERTA: el aviso del caso W&S NO salió — ${error.message}`);
    await rec('error', { error });
    return { via: 'error' };
  } catch (err) {
    log().error({ err, caseNumber: c.caseNumber, contact: contact.nombre }, 'ALERTA: error mandando el aviso del caso W&S');
    await rec('error', { error: err });
    return { via: 'error' };
  }
}

/** Reenvía las capturas del caso que ese contacto aún no tiene (requiere ventana abierta). */
export async function forwardPendingAttachments(c, contact) {
  const atts = await attachmentsOf(c.id).catch(() => []);
  let sent = 0;
  for (const a of atts) {
    if (!a.data || (a.forwardedTo || []).includes(contact.key)) continue;
    try {
      const mediaId = await wa.uploadMedia(Buffer.from(a.data), a.mimeType);
      await wa.sendImageMessage(contact.phone, mediaId, `Caso W&S #${c.caseNumber}`);
      await prisma.caseAttachment.update({ where: { id: a.id }, data: { forwardedTo: { push: contact.key } } });
      sent++;
    } catch (err) {
      log().warn({ err, caseNumber: c.caseNumber }, 'No se pudo reenviar una captura del caso W&S');
    }
  }
  return sent;
}

/** Quién tiene el caso ahora: quien lo confirmó, o a quien se le avisó. */
export function caseHolder(c, contacts = wsConfig().contacts) {
  if (c.status === 'atendiendo') return contacts.find((k) => k.nombre === c.confirmedBy || k.key === c.assignedKey) || null;
  if (c.status === 'asignado') return contacts.find((k) => k.key === c.assignedKey) || null;
  return null; // pendiente_aviso: la captura irá en el aviso; sin_confirmar/resuelto: nadie lo tiene
}

/**
 * Una captura NUEVA de un caso que ya tiene responsable le llega por WhatsApp:
 *   - ventana de 24h abierta → imagen suelta, al momento;
 *   - ventana cerrada → plantilla con la imagen en el encabezado (se entrega sin ventana);
 *   - sin plantilla con imagen aprobada → queda pendiente y sale con su siguiente mensaje.
 * @returns {Promise<'enviada'|'plantilla'|'pendiente'|'sin_responsable'>}
 */
export async function deliverNewAttachment(c, att) {
  const cfg = wsConfig();
  const contact = caseHolder(c, cfg.contacts);
  if (!contact) return 'sin_responsable';
  if (await isAdvisorWindowOpen({ unit: 'oxford_education', advisorPhone: contact.phone })) {
    await forwardPendingAttachments(c, contact);
    return 'enviada';
  }
  if (cfg.templateImg && att?.data) {
    try {
      const total = await prisma.caseAttachment.count({ where: { caseId: c.id } }).catch(() => 1);
      const params = caseTemplateParams(c, total);
      params[6] = templateParam(`nueva captura (${total} en total)`);
      const mediaId = await wa.uploadMedia(Buffer.from(att.data), att.mimeType);
      const resp = await wa.sendTemplateWithImage(contact.phone, cfg.templateImg, cfg.templateLang, mediaId, params);
      await prisma.caseAttachment.update({ where: { id: att.id }, data: { forwardedTo: { push: contact.key } } }).catch(() => {});
      await recordAdvisorNotification({
        unit: 'oxford_education', lead: { id: c.id, ticketNumber: c.caseNumber }, advisor: { nombre: contact.nombre },
        advisorPhone: contact.phone, kind: 'caso_ws_captura', via: 'template', templateName: cfg.templateImg, apiResponse: resp,
      });
      return 'plantilla';
    } catch (err) {
      log().error({ err, caseNumber: c.caseNumber }, 'No se pudo mandar la captura nueva con plantilla; sale con el siguiente mensaje de la responsable');
    }
  }
  return 'pendiente';
}

/** Al escribir Karen o Jorge (ventana abierta), les llega todo lo pendiente de sus casos. */
export async function flushPendingFor(contact) {
  const mine = await prisma.supportCase.findMany({
    where: { status: { in: ['asignado', 'atendiendo'] }, assignedKey: contact.key },
  }).catch(() => []);
  let sent = 0;
  for (const c of mine) sent += await forwardPendingAttachments(c, contact);
  return sent;
}

const attempt = (contact, at) => ({ key: contact.key, nombre: contact.nombre, assignedAt: at.toISOString(), result: 'esperando' });
function closeLastAttempt(attempts, result, at) {
  const list = Array.isArray(attempts) ? [...attempts] : [];
  if (list.length && list[list.length - 1].result === 'esperando') list[list.length - 1] = { ...list[list.length - 1], result, at: at.toISOString() };
  return list;
}

async function sync(caseId) {
  const c = await prisma.supportCase.findUnique({ where: { id: caseId } }).catch(() => null);
  if (!c) return;
  const n = await prisma.caseAttachment.count({ where: { caseId } }).catch(() => 0);
  await syncCaseToSheet(c, n);
}

/** Asigna y avisa YA a `contact` (dentro de horario). */
async function assignNow(c, contact, now, expectedStatus, extraWhere = {}) {
  const cfg = wsConfig();
  const data = {
    status: 'asignado', assignedKey: contact.key, assignedName: contact.nombre,
    notifiedAt: now, notifyAt: null, slaDueAt: businessDue(now, cfg.slaMinutes, cfg.slaHours),
    triedKeys: Array.from(new Set([...(c.triedKeys || []), contact.key])),
    attempts: [...(expectedStatus === 'asignado' ? closeLastAttempt(c.attempts, 'no_confirmo', now) : (Array.isArray(c.attempts) ? c.attempts : [])), attempt(contact, now)],
  };
  const { count } = await prisma.supportCase.updateMany({ where: { id: c.id, status: expectedStatus, ...extraWhere }, data });
  if (!count) return false; // alguien (ATIENDO o el otro poller) ganó
  await notifyContact({ ...c, ...data }, contact);
  await sync(c.id);
  return true;
}

/**
 * Crea el caso con los datos completos y lo despacha. Liga las capturas que
 * llegaron durante la conversación.
 */
export async function createCase({ conv, contact, phone, draft, motivo = null, now = new Date() }) {
  const cfg = wsConfig();
  const first = cfg.contacts[0];
  const within = isWithinTeamHours(now, cfg.slaHours);
  const created = await prisma.supportCase.create({
    data: {
      conversationId: conv.id, contactId: contact.id, phone: String(phone).replace('+', ''),
      fullName: draft.fullName, email: draft.email, stage: draft.stage, description: draft.description, motivo,
      status: 'pendiente_aviso', assignedKey: first?.key || null, assignedName: first?.nombre || null,
      notifyAt: within ? now : nextOpening(now, cfg.slaHours),
    },
  });
  await prisma.caseAttachment.updateMany({ where: { conversationId: conv.id, caseId: null }, data: { caseId: created.id } }).catch(() => {});
  log().info({ caseNumber: created.caseNumber, within, notifyAt: created.notifyAt }, 'Caso W&S creado');
  if (!first) {
    log().error({ caseNumber: created.caseNumber }, 'ALERTA: OXED_WS_SUPPORT_CONTACTS vacío — el caso W&S quedó sin a quién avisar');
  } else if (within) {
    await assignNow(created, first, now, 'pendiente_aviso');
  } else {
    await sync(created.id);
  }
  return prisma.supportCase.findUnique({ where: { id: created.id } }).then((r) => r || created).catch(() => created);
}

/**
 * Barrida del poller (cada minuto):
 *   1. pendiente_aviso con notifyAt vencido → aviso al contacto asignado.
 *   2. asignado con slaDueAt vencido → siguiente contacto; si no hay, sin_confirmar.
 */
export async function processWsCases(now = new Date()) {
  const cfg = wsConfig();
  if (!cfg.enabled) return { notified: 0, reassigned: 0, unconfirmed: 0 };
  const out = { notified: 0, reassigned: 0, unconfirmed: 0 };

  const due = await prisma.supportCase.findMany({ where: { status: 'pendiente_aviso', notifyAt: { lte: now } }, orderBy: { notifyAt: 'asc' }, take: 50 });
  for (const c of due) {
    if (!isWithinTeamHours(now, cfg.slaHours)) continue;
    const contact = cfg.contacts.find((k) => k.key === c.assignedKey) || cfg.contacts[0];
    if (contact && await assignNow(c, contact, now, 'pendiente_aviso')) out.notified++;
  }

  const expired = await prisma.supportCase.findMany({ where: { status: 'asignado', slaDueAt: { lte: now } }, orderBy: { slaDueAt: 'asc' }, take: 50 });
  for (const c of expired) {
    const next = cfg.contacts.find((k) => !(c.triedKeys || []).includes(k.key));
    if (next) {
      if (await assignNow(c, next, now, 'asignado', { assignedKey: c.assignedKey })) out.reassigned++;
      continue;
    }
    const { count } = await prisma.supportCase.updateMany({
      where: { id: c.id, status: 'asignado', assignedKey: c.assignedKey },
      data: { status: 'sin_confirmar', slaDueAt: null, attempts: closeLastAttempt(c.attempts, 'no_confirmo', now) },
    });
    if (count) {
      out.unconfirmed++;
      log().warn({ caseNumber: c.caseNumber }, 'Caso W&S sin confirmar: nadie respondió ATIENDO. No se avisa a nadie más; Karen o Jorge pueden tomarlo después.');
      await sync(c.id);
    }
  }
  return out;
}

export { sync as syncCase };
