/**
 * Panel — convierte leads de Ox y Ed en filas de la tabla, filtra, pagina y
 * calcula los indicadores (módulo PURO: recibe datos ya leídos, no toca la base).
 */
import { stageFor, STAGES, STATUS_LABELS } from './stages.js';

export const PAGE_SIZE = 50;
const DERIVED_ALERT_MS = 30 * 60 * 1000;

const digits = (p) => String(p || '').replace(/\D/g, '');
export const last10 = (p) => digits(p).slice(-10);

/** "55 1234 5678" a partir de cualquier formato (también el +5211… del bug del 1 doble). */
export function formatPhone(p) {
  const d = digits(p);
  if (d.length >= 10 && (d.startsWith('52') || d.length === 10)) {
    const l = d.slice(-10);
    return `${l.slice(0, 2)} ${l.slice(2, 6)} ${l.slice(6)}`;
  }
  return d ? `+${d}` : '';
}
export function maskPhone(p) {
  const l = last10(p);
  if (l.length === 10) return `${l.slice(0, 2)} •••• ${l.slice(6)}`;
  return l ? `•••• ${l.slice(-4)}` : '';
}

export function isExcludedPhone(phone, excluded = []) {
  const t = last10(phone);
  return Boolean(t) && excluded.map(last10).includes(t);
}

/**
 * @param {'ox'|'ed'} bot
 * @param {Object} lead - OxfordLead o TravelLead con `contact`
 * @param {Object} ctx - { notifications: [] (asc), lastMessageAt, schoolName, wsCase }
 */
export function buildRow(bot, lead, ctx = {}) {
  const notifs = ctx.notifications || [];
  const firstNotif = notifs[0] || null;
  const lastNotif = notifs[notifs.length - 1] || null;
  const stage = stageFor(bot, lead);
  const contact = lead.contact || {};

  const name = bot === 'ox' ? (lead.fullName || contact.name || '') : (lead.parentName || contact.name || '');
  const zone = bot === 'ox'
    ? [[lead.municipality, lead.state].filter(Boolean).join(', '), lead.zoneKey ? `(${lead.zoneKey})` : ''].filter(Boolean).join(' ')
    : (ctx.schoolName || lead.schoolCode || '');
  const product = bot === 'ox'
    ? (lead.primaryProductLabel || lead.primaryProduct || '')
    : [lead.programInterest, lead.destination].filter(Boolean).join(' · ');

  const attempts = Array.isArray(lead.advisorAttempts) ? lead.advisorAttempts : [];
  const advisorOriginal = (bot === 'ox' ? attempts[0]?.advisor : null) || firstNotif?.advisorName || null;

  let sinceAt = lead.createdAt;
  if (stage === 'derivado' || stage === 'sin_confirmar') sinceAt = (bot === 'ox' && lead.assignedAt) || firstNotif?.createdAt || lead.updatedAt || lead.createdAt;
  if (stage === 'atendido') sinceAt = lead.confirmedAt || lead.updatedAt;

  return {
    key: `${bot}-${lead.ticketNumber}`,
    bot,
    botLabel: bot === 'ox' ? 'Ox' : 'Ed',
    leadId: lead.id,
    ticket: lead.ticketNumber,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    name,
    phone: formatPhone(contact.phone),
    phoneMasked: maskPhone(contact.phone),
    phoneLast10: last10(contact.phone),
    zone,
    product,
    stage,
    stageLabel: STAGES[stage],
    status: lead.status,
    statusLabel: STATUS_LABELS[lead.status] || lead.status,
    advisorOriginal,
    advisorCurrent: lead.assignedAdvisor || null,
    delivery: lastNotif ? { status: lastNotif.status, at: lastNotif.deliveredAt || lastNotif.createdAt, errorCode: lastNotif.errorCode || null } : null,
    sinceAt,
    lastMessageAt: ctx.lastMessageAt || null,
    overdue: stage === 'derivado' && sinceAt && (ctx.now || new Date()) - new Date(sinceAt) > DERIVED_ALERT_MS,
    wsCase: ctx.wsCase ? { number: ctx.wsCase.caseNumber, status: ctx.wsCase.status } : null,
  };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * @param {Array} rows
 * @param {Object} f - { bot, advisor, stage, status, q, includeTest, excludePhones, user }
 */
export function filterRows(rows, f = {}) {
  const q = norm(f.q).trim();
  const qDigits = digits(f.q);
  return rows.filter((r) => {
    if (f.user?.role === 'asesora' && r.advisorCurrent !== f.user.advisorName) return false;
    if (!f.includeTest && isExcludedPhone(r.phoneLast10, f.excludePhones)) return false;
    if (f.bot && r.bot !== f.bot) return false;
    if (f.advisor && r.advisorCurrent !== f.advisor && r.advisorOriginal !== f.advisor) return false;
    if (f.stage && r.stage !== f.stage) return false;
    if (f.status && r.status !== f.status) return false;
    if (q) {
      const hay = norm([r.name, r.zone, r.product, `#${r.ticket}`, String(r.ticket)].join(' '));
      const byDigits = qDigits.length >= 4 && r.phoneLast10.includes(qDigits);
      if (!hay.includes(q) && !byDigits) return false;
    }
    return true;
  });
}

export function sortRows(rows) {
  return [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.ticket - a.ticket);
}

export function paginate(rows, page = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/** Lo que ve cada rol: una asesora nunca recibe el teléfono completo. */
export function presentRow(row, user) {
  if (user?.role === 'admin') return row;
  const { phone, phoneLast10, ...rest } = row;
  return { ...rest, phone: row.phoneMasked };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Inicio del día (00:00 CDMX) de `now`. CDMX es UTC-6 sin horario de verano. */
export function startOfDayCdmx(now = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${ymd}T00:00:00-06:00`);
}

/**
 * @param {Object} d - { rows (todas, ya filtradas por pruebas/rol), oxResponseSeconds: [{confirmedAt, responseSeconds}],
 *   edListoSeconds: [{at, seconds}], wsCases: [{status}] }
 * @param {Object} range - { from: Date }
 */
export function computeIndicators(d, { from }) {
  const inRange = (t) => t && new Date(t) >= from;
  const out = {};
  for (const bot of ['ox', 'ed']) {
    const rows = d.rows.filter((r) => r.bot === bot);
    out[bot] = {
      nuevos: rows.filter((r) => inRange(r.createdAt)).length,
      sinAtender: rows.filter((r) => r.stage === 'derivado').length,
      sinAtenderVencidos: rows.filter((r) => r.stage === 'derivado' && r.overdue).length,
      sinConfirmar: bot === 'ox' ? rows.filter((r) => r.stage === 'sin_confirmar').length : null,
    };
  }
  const ox = (d.oxResponseSeconds || []).filter((x) => inRange(x.confirmedAt) && Number.isFinite(x.responseSeconds)).map((x) => x.responseSeconds);
  out.ox.respuesta = { mediana: median(ox), promedio: avg(ox), n: ox.length, hasta: 'ATIENDO' };
  const ed = (d.edListoSeconds || []).filter((x) => inRange(x.at) && Number.isFinite(x.seconds)).map((x) => x.seconds);
  out.ed.respuesta = { mediana: median(ed), promedio: avg(ed), n: ed.length, hasta: 'LISTO' };
  const ws = {};
  for (const c of d.wsCases || []) if (c.status !== 'resuelto') ws[c.status] = (ws[c.status] || 0) + 1;
  out.ws = { abiertos: Object.values(ws).reduce((a, b) => a + b, 0), porEstado: ws };
  return out;
}
