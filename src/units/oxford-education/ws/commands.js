/**
 * W&S OTCC — comandos del equipo de soporte (Karen, Jorge) por WhatsApp.
 *
 * Se resuelven por QUIÉN los manda: un "ATIENDO 12" de un contacto W&S busca el
 * caso W&S 12, nunca el lead comercial 12. Comandos: ATIENDO # · LISTO # ·
 * PENDIENTES · AYUDA. Se registran en advisor_commands con scope 'caso_ws'.
 */
import prisma from '../../../core/database/client.js';
import logger from '../../../utils/logger.js';
import * as wa from '../whatsapp.js';
import { recordAdvisorCommand } from '../../../services/advisor-command.service.js';
import { wsConfig, supportContactByPhone } from './config.js';
import { forwardPendingAttachments, syncCase } from './cases.js';
import { normalize } from './intent.js';

/** ¿El número es de un contacto del equipo W&S (y el modo está prendido)? */
export function isWsSupportPhone(phone) {
  const cfg = wsConfig();
  return cfg.enabled && Boolean(supportContactByPhone(phone, cfg.contacts));
}

export function parseCommand(raw) {
  const n = normalize(raw).toUpperCase();
  const m = /^(ATIENDO|LISTO|PENDIENTES|AYUDA)\b\s*#?\s*(\d+)?/.exec(n);
  if (!m) return { command: 'OTRO', number: null };
  return { command: m[1], number: m[2] ? Number(m[2]) : null };
}

function help(contact) {
  return `Hola ${contact.apodo} 👋 Soy Ox. Comandos para casos W&S · OTCC:\n\n`
    + '✅ *ATIENDO #* → tomas el caso (te llegan los datos y las capturas)\n'
    + '🏁 *LISTO #* → el caso quedó resuelto\n'
    + '📋 *PENDIENTES* → casos abiertos';
}

function caseDetail(c) {
  return `👤 ${c.fullName}\n✉️ ${c.email}\n📚 Etapa: ${c.stage}\n📱 +${String(c.phone).replace(/\D/g, '')}\n📝 ${c.description}`;
}

/** @returns {Promise<{reply:string, outcome:string, detail?:string}>} */
async function run(contact, command, number, now) {
  if (command === 'AYUDA' || command === 'OTRO') return { reply: help(contact), outcome: 'info' };

  if (command === 'PENDIENTES') {
    const open = await prisma.supportCase.findMany({
      where: { status: { in: ['pendiente_aviso', 'asignado', 'sin_confirmar', 'atendiendo'] } },
      orderBy: { caseNumber: 'asc' }, take: 30,
    });
    if (!open.length) return { reply: '📋 No hay casos W&S abiertos 🎉', outcome: 'info' };
    const lines = open.map((c) => `#${c.caseNumber} · ${c.fullName} · ${c.stage} · ${c.status === 'atendiendo' ? `lo atiende ${c.confirmedBy}` : c.status.replace('_', ' ')}`);
    return { reply: `📋 Casos W&S abiertos:\n${lines.join('\n')}`, outcome: 'info' };
  }

  if (!number) return { reply: `Indica el número del caso, por ejemplo: *${command} 12*`, outcome: 'rechazado', detail: 'sin número' };
  const c = await prisma.supportCase.findUnique({ where: { caseNumber: number } });
  if (!c) return { reply: `No encontré el caso W&S #${number}.`, outcome: 'rechazado', detail: 'no existe' };

  if (command === 'ATIENDO') {
    if (c.status === 'resuelto') return { reply: `El caso #${number} ya está resuelto.`, outcome: 'rechazado', detail: 'resuelto' };
    if (c.status === 'atendiendo') {
      return c.confirmedBy === contact.nombre
        ? { reply: `Ya tienes el caso #${number} 👍`, outcome: 'info' }
        : { reply: `El caso #${number} ya lo atiende ${c.confirmedBy}.`, outcome: 'rechazado', detail: `ya lo atiende ${c.confirmedBy}` };
    }
    const { count } = await prisma.supportCase.updateMany({
      where: { id: c.id, status: { in: ['pendiente_aviso', 'asignado', 'sin_confirmar'] } },
      data: {
        status: 'atendiendo', confirmedAt: now, confirmedBy: contact.nombre, assignedKey: contact.key, assignedName: contact.nombre, slaDueAt: null,
        attempts: [...(Array.isArray(c.attempts) ? c.attempts : []).map((a) => (a.result === 'esperando' ? { ...a, result: a.key === contact.key ? 'confirmo' : 'otro_confirmo', at: now.toISOString() } : a))],
      },
    });
    if (!count) return { reply: `El caso #${number} cambió justo ahora; manda *PENDIENTES* para ver su estado.`, outcome: 'rechazado', detail: 'carrera' };
    await syncCase(c.id);
    return { reply: `✅ El caso W&S #${number} es tuyo.\n\n${caseDetail(c)}`, outcome: 'aceptado', after: () => forwardPendingAttachments(c, contact) };
  }

  if (command === 'LISTO') {
    if (c.status === 'resuelto') return { reply: `El caso #${number} ya estaba resuelto.`, outcome: 'info' };
    await prisma.supportCase.update({
      where: { id: c.id },
      data: { status: 'resuelto', resolvedAt: now, confirmedAt: c.confirmedAt || now, confirmedBy: c.confirmedBy || contact.nombre, slaDueAt: null },
    });
    await syncCase(c.id);
    return { reply: `🏁 Caso W&S #${number} marcado como resuelto. Gracias, ${contact.apodo}.`, outcome: 'aceptado' };
  }
  return { reply: help(contact), outcome: 'info' };
}

export async function handleWsSupportCommand(message, now = new Date()) {
  const cfg = wsConfig();
  const contact = supportContactByPhone(message.from, cfg.contacts);
  if (!contact) return;
  const raw = (message.text?.body || '').trim();
  const { command, number } = parseCommand(raw);
  const log = logger.child({ unit: 'oxford_education', ws: true, contact: contact.nombre, command });
  let res;
  try {
    res = await run(contact, command, number, now);
  } catch (err) {
    log.error({ err }, 'Error en comando W&S');
    res = { reply: 'Tuve un problema con ese comando 🙏 Intenta de nuevo en un momento.', outcome: 'error', detail: err.message };
  }
  await recordAdvisorCommand({
    unit: 'oxford_education', advisor: { nombre: contact.nombre }, advisorPhone: contact.phone, text: raw,
    command, ticketNumber: number, outcome: res.outcome, detail: res.detail, waMessageId: message.id, scope: 'caso_ws',
  });
  try { await wa.sendTextMessage(contact.phone, res.reply); } catch (err) { log.error({ err }, 'No se pudo responder al contacto W&S'); }
  if (res.after) await res.after();
}
