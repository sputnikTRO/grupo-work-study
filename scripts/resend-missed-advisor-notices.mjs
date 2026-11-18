#!/usr/bin/env node
/**
 * resend-missed-advisor-notices.mjs — utilidad MANUAL (no se importa en la app).
 *
 * Reenvía el aviso de lead a la asesora ORIGINAL de los tickets que se quedaron
 * sin atender porque Meta no entregó los avisos (oct–nov 2026: primero plantilla
 * MARKETING, después 131042 — las WABA de Oxford y de Travel sin método de pago).
 *
 *   - Ori: tickets sin_confirmar → primera asesora de su cadena (notifyAdvisor).
 *   - Miri: leads derivado_asesor sin LISTO → su asesora asignada
 *     (sendAdvisorNotification). Miri no tiene SLA ni cadena.
 *
 * Se excluyen siempre los leads con la etiqueta 'prueba' y los del número de
 * prueba del equipo (TEST_PHONES).
 *
 * Qué hace por ticket, con --confirm:
 *   - Manda el aviso con notifyAdvisor (el MISMO código y la misma plantilla que
 *     un handoff real) a la primera asesora de su cadena, con la zona real del
 *     prospecto y un motivo que dice que es un reenvío.
 *   - El envío queda en advisor_notifications con su wamid, así que su entrega se
 *     ve en el webhook de status.
 *
 * Qué NO hace: no toca el lead. No cambia status, asesora, slaDueAt,
 * currentAttempt ni la cadena: el SLA no se reinicia y nadie más recibe avisos.
 * La asesora original puede tomarlo con "ATIENDO #" porque ya estaba en
 * triedAdvisorKeys (ATIENDO tardío, fix/ori-atiendo-y-avisos).
 *
 * SALVAGUARDAS
 *   1. DRY-RUN por default: solo lee e imprime a quién se mandaría qué.
 *   2. Requiere el código de fix/ori-atiendo-y-avisos desplegado (sin él, el
 *      ATIENDO de la asesora original se rechazaría): verifica que existan las
 *      tablas advisor_notifications y advisor_commands, o aborta.
 *   3. Antes de enviar revisa en Meta que la plantilla en uso sea UTILITY +
 *      APPROVED (template-health); si no, aborta.
 *   4. No reenvía un ticket que ya tenga un aviso ENTREGADO a esa asesora
 *      (advisor_notifications), así que se puede volver a correr sin duplicar.
 *   5. Un ticket cuya asesora original ya no está en advisor-zones.js se omite y
 *      se reporta (p. ej. Diana Castillo): se decide a mano.
 *
 * Uso (prod: DATABASE_URL por el proxy público; mismas OXED_* que Railway):
 *   node scripts/resend-missed-advisor-notices.mjs                       # dry-run, sin_confirmar del 1-oct a hoy
 *   node scripts/resend-missed-advisor-notices.mjs --tickets 5,6,7       # solo esos tickets de Ori
 *   node scripts/resend-missed-advisor-notices.mjs --travel-tickets 10,14,18   # solo esos de Miri
 *   node scripts/resend-missed-advisor-notices.mjs --unit oxford|travel|all
 *   node scripts/resend-missed-advisor-notices.mjs --from 2026-10-01 --to 2026-11-18
 *   node scripts/resend-missed-advisor-notices.mjs --confirm             # envía
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TZ_OFFSET = '-06:00';
const RESEND_REASON = 'REENVÍO: este aviso no se te entregó en su momento por una falla de WhatsApp. El prospecto sigue sin atender. Responde ATIENDO para tomarlo.';
const PAUSE_MS = 1500;
const TEST_PHONES = ['5535305000']; // últimos 10 dígitos de los números de prueba del equipo
const isTestLead = (lead) => (lead.tags || []).includes('prueba') || TEST_PHONES.some((t) => String(lead.contact?.phone || '').replace(/\D/g, '').endsWith(t));

export function parseArgs(argv) {
  const a = { confirm: false, unit: 'all', tickets: null, travelTickets: null, from: '2026-10-01', to: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date()) };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--confirm') a.confirm = true;
    else if (k === '--tickets') a.tickets = argv[++i].split(',').map((t) => parseInt(t.trim().replace('#', ''), 10)).filter(Number.isInteger);
    else if (k === '--travel-tickets') a.travelTickets = argv[++i].split(',').map((t) => parseInt(t.trim().replace('#', ''), 10)).filter(Number.isInteger);
    else if (k === '--unit') { a.unit = argv[++i]; if (!['oxford', 'travel', 'all'].includes(a.unit)) throw new Error('--unit debe ser oxford | travel | all'); }
    else if (k === '--from') a.from = argv[++i];
    else if (k === '--to') a.to = argv[++i];
    else throw new Error(`Parámetro desconocido: ${k}`);
  }
  a.gte = new Date(`${a.from}T00:00:00${TZ_OFFSET}`);
  a.lt = new Date(new Date(`${a.to}T00:00:00${TZ_OFFSET}`).getTime() + 86400000);
  return a;
}

/**
 * Arma el plan sin enviar nada.
 * @returns {Promise<{ send: Array, skip: Array }>}
 */
export async function planResend({ prisma, ADVISORS, args }) {
  const where = args.tickets
    ? { ticketNumber: { in: args.tickets } }
    : { status: 'sin_confirmar', confirmedAt: null, createdAt: { gte: args.gte, lt: args.lt } };
  const leads = await prisma.oxfordLead.findMany({ where, include: { contact: true }, orderBy: { ticketNumber: 'asc' } });

  const send = [];
  const skip = [];
  for (const lead of leads) {
    const first = Array.isArray(lead.advisorAttempts) ? lead.advisorAttempts[0] : null;
    const originalName = first?.advisor || lead.assignedAdvisor;
    const advisor = Object.values(ADVISORS).find((x) => x.key === first?.advisorKey || x.nombre === originalName);
    const base = { ticket: lead.ticketNumber, status: lead.status, original: originalName || '—', zona: lead.zoneKey || '—' };

    if (isTestLead(lead)) { skip.push({ ...base, motivo: 'lead de prueba del equipo' }); continue; }
    if (lead.confirmedAt) { skip.push({ ...base, motivo: `ya confirmado por ${lead.assignedAdvisor}` }); continue; }
    if (!['sin_confirmar', 'derivado_asesor'].includes(lead.status)) { skip.push({ ...base, motivo: `status ${lead.status}: no está esperando asesora` }); continue; }
    if (!originalName) { skip.push({ ...base, motivo: 'sin cadena de asignación' }); continue; }
    if (!advisor) { skip.push({ ...base, motivo: `${originalName} ya no está en advisor-zones.js — decidir a mano` }); continue; }

    const delivered = await prisma.advisorNotification.findFirst({
      where: { unit: 'oxford_education', leadId: lead.id, advisorName: advisor.nombre, status: { in: ['delivered', 'read'] } },
    });
    if (delivered) { skip.push({ ...base, motivo: `ya tiene un aviso entregado a ${advisor.nombre} (${delivered.status})` }); continue; }

    send.push({ ...base, lead, advisor });
  }
  return { send, skip };
}

/**
 * Miri: leads derivados sin LISTO → su asesora asignada. Sin enviar nada.
 */
export async function planResendTravel({ prisma, advisorByName, args }) {
  const where = args.travelTickets
    ? { ticketNumber: { in: args.travelTickets } }
    : { status: 'derivado_asesor', createdAt: { gte: args.gte, lt: args.lt } };
  const leads = await prisma.travelLead.findMany({ where, include: { contact: true }, orderBy: { ticketNumber: 'asc' } });
  const send = [];
  const skip = [];
  for (const lead of leads) {
    const base = { ticket: lead.ticketNumber, status: lead.status, original: lead.assignedAdvisor || '—' };
    if (isTestLead(lead)) { skip.push({ ...base, motivo: 'lead de prueba del equipo' }); continue; }
    if (lead.status !== 'derivado_asesor') { skip.push({ ...base, motivo: `status ${lead.status}: ya se atendió o no está derivado` }); continue; }
    const advisor = advisorByName(lead.assignedAdvisor);
    if (!advisor) { skip.push({ ...base, motivo: lead.assignedAdvisor ? `${lead.assignedAdvisor} ya no está en advisors.js — decidir a mano` : 'sin asesora asignada' }); continue; }
    const delivered = await prisma.advisorNotification.findFirst({
      where: { unit: 'travel', leadId: lead.id, advisorName: advisor.nombre, status: { in: ['delivered', 'read'] } },
    });
    if (delivered) { skip.push({ ...base, motivo: `ya tiene un aviso entregado a ${advisor.nombre} (${delivered.status})` }); continue; }
    send.push({ ...base, lead, advisor });
  }
  return { send, skip };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { default: prisma } = await import('../src/core/database/client.js');
  const { ADVISORS } = await import('../src/units/oxford-education/advisor-zones.js');
  const { notifyAdvisor } = await import('../src/units/oxford-education/advisor-notify.js');
  const { checkAdvisorTemplates } = await import('../src/services/template-health.service.js');
  const { advisorByName, resolveTrack } = await import('../src/units/travel/advisors.js');
  const { sendAdvisorNotification } = await import('../src/units/travel/actions.js');
  const { env } = await import('../src/config/env.js');
  const { default: logger } = await import('../src/utils/logger.js');

  try {
    console.log(`\n=== Reenvío de avisos a la asesora ORIGINAL — ${args.confirm ? 'CONFIRM (envía)' : 'DRY-RUN (no envía)'} ===`);
    try { const u = new URL(process.env.DATABASE_URL); console.log(`Base: ${u.hostname}:${u.port}${u.pathname}`); } catch { /* sin url */ }

    // Salvaguarda 2: el código de fix/ori-atiendo-y-avisos debe estar desplegado.
    try {
      await prisma.advisorNotification.count();
      await prisma.advisorCommand.count();
    } catch {
      throw new Error('Esta base no tiene advisor_notifications/advisor_commands: despliega primero fix/ori-atiendo-y-avisos (sin él, el ATIENDO de la asesora original se rechaza).');
    }

    const ori = args.unit === 'travel' ? { send: [], skip: [] } : await planResend({ prisma, ADVISORS, args });
    const miri = args.unit === 'oxford' ? { send: [], skip: [] } : await planResendTravel({ prisma, advisorByName, args });

    console.log(`\nOri — se reenviaría a ${ori.send.length} ticket(s):`);
    for (const s of ori.send) console.log(`  #${s.ticket} · ${s.status} · zona ${s.zona} → ${s.advisor.nombre} (****${s.advisor.whatsapp.slice(-4)})`);
    if (ori.skip.length) console.log(`  Se omiten ${ori.skip.length}:`);
    for (const s of ori.skip) console.log(`    #${s.ticket} · ${s.status} · original ${s.original} — ${s.motivo}`);
    console.log(`\nMiri — se reenviaría a ${miri.send.length} lead(s):`);
    for (const s of miri.send) console.log(`  #${s.ticket} · ${s.status} → ${s.advisor.nombre} (****${s.advisor.whatsapp.slice(-4)})`);
    if (miri.skip.length) console.log(`  Se omiten ${miri.skip.length}:`);
    for (const s of miri.skip) console.log(`    #${s.ticket} · ${s.status} · asesora ${s.original} — ${s.motivo}`);
    console.log('\nNo se modifica ningún lead (status, asesora, slaDueAt, cadena).');

    if (!args.confirm) { console.log('\nDRY-RUN: no se envió nada. Para enviar, el mismo comando con --confirm.\n'); return; }
    if (ori.send.length + miri.send.length === 0) { console.log('\nNada que enviar.\n'); return; }

    // Salvaguarda 3: plantillas UTILITY + APPROVED en la(s) unidad(es) a usar.
    const health = await checkAdvisorTemplates();
    for (const [unit, n] of [['oxford_education', ori.send.length], ['travel', miri.send.length]]) {
      if (!n) continue;
      const h = health.find((f) => f.unit === unit);
      if (!h || h.ok !== true) throw new Error(`La plantilla de ${unit} no está lista: ${h?.problem || 'sin respuesta de Meta'}. No se envió nada.`);
      console.log(`Plantilla ${unit}: ${h.name} · ${h.category} · ${h.status}`);
    }

    const report = async (unit, s) => {
      const row = await prisma.advisorNotification.findFirst({ where: { unit, leadId: s.lead.id, advisorName: s.advisor.nombre }, orderBy: { createdAt: 'desc' } });
      console.log(`  ${unit === 'travel' ? 'Miri' : 'Ori'} #${s.ticket} → ${s.advisor.nombre}: ${row ? `${row.via} · ${row.status}${row.waMessageId ? ` · …${row.waMessageId.slice(-12)}` : ''}` : 'sin rastro (revisar logs)'}`);
    };
    for (const s of ori.send) {
      // reassignCount 0 solo para el rastro: el aviso es un "nuevo_lead" para ella.
      await notifyAdvisor(s.advisor, { ...s.lead, reassignCount: 0 }, null, s.lead.contact, RESEND_REASON, s.lead.zoneKey, logger.child({ resend: true, ticket: s.ticket }));
      await report('oxford_education', s);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    for (const s of miri.send) {
      const conv = await prisma.conversation.findFirst({ where: { contactId: s.lead.contactId, unit: 'travel' }, orderBy: { lastMessageAt: 'desc' } });
      await sendAdvisorNotification(
        s.advisor, s.lead, conv || { interestScore: 0 }, s.lead.contact.phone, RESEND_REASON,
        env.WA_PHONE_NUMBER_ID_TRAVEL, logger.child({ resend: true, ticket: s.ticket, unit: 'travel' }), resolveTrack(s.lead), undefined,
      );
      await report('travel', s);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    console.log('\nEnviados. La entrega llega por webhook en segundos: revisa advisor_notifications (status delivered/failed).\n');
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => { console.error(`\n✖ ${e.message}\n`); process.exit(1); });
}
