/**
 * Panel — lectura de Postgres. Todo corre en una transacción de SOLO LECTURA con
 * statement_timeout de 3 s, para que el panel nunca escriba ni bloquee al bot.
 * Una asesora (fase 2) solo recibe sus leads: el filtro va en la consulta.
 */
import { buildRow, filterRows, sortRows, paginate, presentRow, computeIndicators, startOfDayCdmx, isExcludedPhone } from './rows.js';

const ACTIVE = { ox: ['derivado_asesor', 'en_atencion', 'sin_confirmar'], ed: ['derivado_asesor'] };
const DAY = 24 * 60 * 60 * 1000;

export async function readOnly(prisma, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3s'");
    return fn(tx);
  }, { timeout: 8000 });
}

const contactSelect = { select: { id: true, phone: true, name: true } };

async function fetchLeads(tx, { from, to, user }) {
  const scope = user?.role === 'asesora' ? { assignedAdvisor: user.advisorName || '__nadie__' } : {};
  const range = { createdAt: { gte: from, ...(to ? { lte: to } : {}) } };
  const [ox, ed] = await Promise.all([
    tx.oxfordLead.findMany({ where: { ...scope, OR: [range, { status: { in: ACTIVE.ox } }] }, include: { contact: contactSelect }, orderBy: { createdAt: 'desc' }, take: 2000 }),
    tx.travelLead.findMany({ where: { ...scope, OR: [range, { status: { in: ACTIVE.ed } }] }, include: { contact: contactSelect }, orderBy: { createdAt: 'desc' }, take: 2000 }),
  ]);
  return { ox, ed };
}

async function fetchContext(tx, { ox, ed }) {
  const ids = { ox: ox.map((l) => l.id), ed: ed.map((l) => l.id) };
  const contactIds = { ox: [...new Set(ox.map((l) => l.contactId))], ed: [...new Set(ed.map((l) => l.contactId))] };
  const [notifs, convs, ws] = await Promise.all([
    tx.advisorNotification.findMany({
      where: { OR: [{ unit: 'oxford_education', leadId: { in: ids.ox } }, { unit: 'travel', leadId: { in: ids.ed } }] },
      orderBy: { createdAt: 'asc' },
      select: { unit: true, leadId: true, advisorName: true, status: true, createdAt: true, deliveredAt: true, errorCode: true, kind: true },
    }),
    tx.conversation.findMany({
      where: { OR: [{ unit: 'oxford_education', contactId: { in: contactIds.ox } }, { unit: 'travel', contactId: { in: contactIds.ed } }] },
      select: { contactId: true, unit: true, lastMessageAt: true },
    }),
    tx.supportCase.findMany({ where: { contactId: { in: contactIds.ox } }, orderBy: { createdAt: 'desc' }, select: { contactId: true, caseNumber: true, status: true } }),
  ]);
  const byLead = new Map();
  for (const n of notifs) {
    const k = `${n.unit}:${n.leadId}`;
    if (!byLead.has(k)) byLead.set(k, []);
    byLead.get(k).push(n);
  }
  const lastMsg = new Map();
  for (const c of convs) {
    const k = `${c.unit}:${c.contactId}`;
    if (!lastMsg.has(k) || c.lastMessageAt > lastMsg.get(k)) lastMsg.set(k, c.lastMessageAt);
  }
  const wsByContact = new Map();
  for (const c of ws) if (!wsByContact.has(c.contactId)) wsByContact.set(c.contactId, c);
  return { byLead, lastMsg, wsByContact };
}

function rowsFrom({ ox, ed }, ctx, { schoolName = () => null, now = new Date() } = {}) {
  const rows = [];
  for (const l of ox) {
    rows.push(buildRow('ox', l, {
      notifications: ctx.byLead.get(`oxford_education:${l.id}`), lastMessageAt: ctx.lastMsg.get(`oxford_education:${l.contactId}`),
      wsCase: ctx.wsByContact.get(l.contactId), now,
    }));
  }
  for (const l of ed) {
    rows.push(buildRow('ed', l, {
      notifications: ctx.byLead.get(`travel:${l.id}`), lastMessageAt: ctx.lastMsg.get(`travel:${l.contactId}`),
      schoolName: l.schoolCode ? schoolName(l.schoolCode) : null, now,
    }));
  }
  return rows;
}

/**
 * Fuente de datos del panel sobre Prisma.
 * @param {Object} prisma
 * @param {Object} opts - { excludePhones: string[], schoolName: (code) => string|null }
 */
export function makePrismaDataSource(prisma, { excludePhones = [], schoolName = () => null } = {}) {
  return {
    /** Tabla en vivo. filters: { bot, advisor, stage, status, q, from, to, includeTest, page, since } */
    async list(filters, user, now = new Date()) {
      const from = filters.from || new Date(now - 7 * DAY);
      const data = await readOnly(prisma, async (tx) => {
        const leads = await fetchLeads(tx, { from, to: filters.to, user });
        return { leads, ctx: await fetchContext(tx, leads) };
      });
      let rows = rowsFrom(data.leads, data.ctx, { schoolName, now })
        .filter((r) => new Date(r.createdAt) >= from && (!filters.to || new Date(r.createdAt) <= filters.to));
      rows = sortRows(filterRows(rows, { ...filters, excludePhones, user }));
      const page = paginate(rows, filters.page);
      const changed = filters.since ? page.rows.filter((r) => new Date(r.updatedAt) > filters.since || (r.lastMessageAt && new Date(r.lastMessageAt) > filters.since)).map((r) => r.key) : null;
      return { ...page, rows: page.rows.map((r) => presentRow(r, user)), changed, at: now.toISOString() };
    },

    /** Indicadores de hoy y 7 días. */
    async summary(user, now = new Date()) {
      const from7 = new Date(startOfDayCdmx(now) - 6 * DAY);
      const fromHoy = startOfDayCdmx(now);
      const data = await readOnly(prisma, async (tx) => {
        const leads = await fetchLeads(tx, { from: from7, user });
        const ctx = await fetchContext(tx, leads);
        const oxResp = await tx.oxfordLead.findMany({
          where: { confirmedAt: { gte: from7 }, responseSeconds: { not: null }, ...(user?.role === 'asesora' ? { assignedAdvisor: user.advisorName } : {}) },
          select: { confirmedAt: true, responseSeconds: true, contact: { select: { phone: true } } },
        });
        const listos = await tx.advisorCommand.findMany({
          where: { unit: 'travel', command: 'LISTO', outcome: 'aceptado', createdAt: { gte: from7 }, scope: 'comercial' },
          select: { ticketNumber: true, createdAt: true },
        });
        const edLeads = listos.length ? await tx.travelLead.findMany({ where: { ticketNumber: { in: listos.map((c) => c.ticketNumber).filter(Number.isInteger) } }, select: { id: true, ticketNumber: true, assignedAdvisor: true, contact: { select: { phone: true } } } }) : [];
        const edNotifs = edLeads.length ? await tx.advisorNotification.findMany({ where: { unit: 'travel', leadId: { in: edLeads.map((l) => l.id) } }, orderBy: { createdAt: 'asc' }, select: { leadId: true, createdAt: true } }) : [];
        const wsCases = user?.role === 'admin' ? await tx.supportCase.findMany({ where: { status: { not: 'resuelto' } }, select: { status: true } }) : [];
        return { leads, ctx, oxResp, listos, edLeads, edNotifs, wsCases };
      });
      const rows = filterRows(rowsFrom(data.leads, data.ctx, { schoolName, now }), { excludePhones, user });
      const firstNotif = new Map();
      for (const n of data.edNotifs) if (!firstNotif.has(n.leadId)) firstNotif.set(n.leadId, n.createdAt);
      const edListoSeconds = data.listos.map((c) => {
        const lead = data.edLeads.find((l) => l.ticketNumber === c.ticketNumber);
        if (!lead || isExcludedPhone(lead.contact?.phone, excludePhones)) return null;
        if (user?.role === 'asesora' && lead.assignedAdvisor !== user.advisorName) return null;
        const t0 = firstNotif.get(lead.id);
        return t0 ? { at: c.createdAt, seconds: Math.round((new Date(c.createdAt) - new Date(t0)) / 1000) } : null;
      }).filter(Boolean);
      const oxResponseSeconds = data.oxResp.filter((x) => !isExcludedPhone(x.contact?.phone, excludePhones));
      const base = { rows, oxResponseSeconds, edListoSeconds, wsCases: data.wsCases };
      return { hoy: computeIndicators(base, { from: fromHoy }), semana: computeIndicators(base, { from: from7 }), at: now.toISOString() };
    },

    /** Detalle de un prospecto. null si no existe o (asesora) no es suyo. */
    async detail(bot, ticket, user, { before = null, now = new Date() } = {}) {
      const isAdmin = user?.role === 'admin';
      return readOnly(prisma, async (tx) => {
        const model = bot === 'ox' ? tx.oxfordLead : tx.travelLead;
        const unit = bot === 'ox' ? 'oxford_education' : 'travel';
        const lead = await model.findUnique({ where: { ticketNumber: Number(ticket) }, include: { contact: contactSelect } });
        if (!lead) return null;
        if (!isAdmin && lead.assignedAdvisor !== user?.advisorName) return null;
        const notifications = await tx.advisorNotification.findMany({ where: { unit, leadId: lead.id }, orderBy: { createdAt: 'asc' } });
        const commands = await tx.advisorCommand.findMany({ where: { unit, ticketNumber: lead.ticketNumber, scope: 'comercial' }, orderBy: { createdAt: 'asc' } });
        const ctx = await fetchContext(tx, bot === 'ox' ? { ox: [lead], ed: [] } : { ox: [], ed: [lead] });
        const row = presentRow(rowsFrom(bot === 'ox' ? { ox: [lead], ed: [] } : { ox: [], ed: [lead] }, ctx, { schoolName, now })[0], user);

        let messages = null; let moreBefore = false;
        if (isAdmin) {
          const convs = await tx.conversation.findMany({ where: { contactId: lead.contactId, unit }, select: { id: true } });
          const batch = await tx.message.findMany({
            where: { conversationId: { in: convs.map((c) => c.id) }, ...(before ? { createdAt: { lt: before } } : {}) },
            orderBy: { createdAt: 'desc' }, take: 101,
            select: { id: true, direction: true, senderType: true, contentType: true, content: true, createdAt: true },
          });
          moreBefore = batch.length > 100;
          messages = batch.slice(0, 100).reverse();
        }
        let wsCases = [];
        if (isAdmin && bot === 'ox') {
          const cases = await tx.supportCase.findMany({ where: { contactId: lead.contactId }, orderBy: { createdAt: 'desc' }, include: { attachments: { select: { mimeType: true, sizeBytes: true, forwardedTo: true, createdAt: true } } } });
          const wsCmds = cases.length ? await tx.advisorCommand.findMany({ where: { scope: 'caso_ws', ticketNumber: { in: cases.map((c) => c.caseNumber) } }, orderBy: { createdAt: 'asc' } }) : [];
          wsCases = cases.map((c) => ({ ...c, commands: wsCmds.filter((x) => x.ticketNumber === c.caseNumber) }));
        }
        const leadFields = isAdmin ? lead : { ...lead, travelerName: undefined, travelerAge: undefined, contact: undefined };
        return { bot, row, lead: leadFields, notifications, commands, attempts: bot === 'ox' ? lead.advisorAttempts || [] : [], messages, moreBefore, wsCases };
      });
    },
  };
}
