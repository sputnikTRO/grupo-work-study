#!/usr/bin/env node
/**
 * audit-leads.mjs — auditoría de leads de Ori (oxford-education) y Miri (travel).
 * Utilidad MANUAL, SOLO LECTURA. No se importa en la app.
 *
 * Qué responde, por lead: cuándo entró, hasta dónde llegó en el flujo, si se
 * derivó, a qué asesora y por qué regla, si la asesora confirmó (ATIENDO, solo
 * Ori) o cerró (LISTO), y un resumen extractivo de la conversación.
 *
 * SALVAGUARDAS
 *   1. La sesión de Postgres se abre con `default_transaction_read_only = on`
 *      sobre UNA sola conexión: cualquier INSERT/UPDATE/DELETE revienta en la
 *      base, no depende de que este archivo "se porte bien".
 *   2. No importa nada que hable con WhatsApp ni con Redis. No envía mensajes.
 *   3. Google Sheets se abre con scope `spreadsheets.readonly` y solo lee las 4
 *      pestañas del cruce. La hoja INSCRITOS (datos de menores) nunca se lee.
 *   4. El .xlsx lleva PII: se escribe en scratchpad/ (está en .gitignore). La
 *      consola solo imprime agregados y teléfonos enmascarados (últimos 4).
 *
 * ENTREGA DE NOTIFICACIONES: si la base ya tiene la tabla advisor_notifications
 * (migración 20261111120000), el script lee de ahí la plantilla, el wamid y el
 * status de entrega de cada notificación. Los handoffs anteriores a ese
 * despliegue no tienen rastro y se marcan así. Sin la tabla aplica lo de abajo.
 *
 * LO QUE LA BASE **NO** GUARDABA (y por tanto este script no puede afirmar):
 *   - La notificación a la asesora no se persiste: ni qué plantilla salió, ni
 *     el ID del mensaje de Meta, ni si cayó al respaldo de texto libre.
 *   - Los webhooks de status (sent/delivered/read/failed) se descartan en
 *     src/core/whatsapp/webhook.js (solo logger.debug) y en oxford-webhook.js
 *     (ni se leen). No hay forma de saber desde la DB si a la asesora le llegó.
 *   La única evidencia de entrega está en los logs de Railway → ver --logs.
 *
 * Uso (prod):
 *   DATABASE_URL='postgresql://…@switchback.proxy.rlwy.net:11281/r' \
 *     node scripts/audit-leads.mjs
 *
 * Parámetros:
 *   --from YYYY-MM-DD     default 2026-10-01           (America/Mexico_City)
 *   --to   YYYY-MM-DD     default hoy, inclusive       (America/Mexico_City)
 *   --unit oxford-education | travel | all             (default all)
 *   --out  <dir>          default scratchpad/
 *   --test-phones a,b,c   números de prueba ya confirmados (últimos 10 dígitos)
 *   --logs <archivo>      log de Railway exportado (`railway logs > archivo`)
 *   --no-sheet            no cruzar contra Google Sheets
 *   --no-backups          ignorar los respaldos de reset en scratchpad/
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TZ = 'America/Mexico_City';
const TZ_OFFSET = '-06:00'; // México abolió el horario de verano en 2022
const DEFAULT_SHEET_ID = '18a2zVagPSu5iJf8GBdM_WcEnDC3vnZ2SHn7s_ftPmnk';
const SHEET_TABS = { miri: 'Leads', ori: 'Leads Oxford', tiempos: 'Tiempos asesores', resumen: 'Resumen asesoras' };
const NO_GUARDA = 'NO SE GUARDA';

// ── Argumentos ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { from: '2026-10-01', to: todayMx(), unit: 'all', out: path.join(ROOT, 'scratchpad'), sheet: true, backups: true, testPhones: [], logs: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) fail(`Falta el valor de ${k}`); return v; };
    if (k === '--from') a.from = next();
    else if (k === '--to') a.to = next();
    else if (k === '--unit') a.unit = next();
    else if (k === '--out') a.out = path.resolve(next());
    else if (k === '--test-phones') a.testPhones = next().split(',').map(last10).filter(Boolean);
    else if (k === '--logs') a.logs = path.resolve(next());
    else if (k === '--no-sheet') a.sheet = false;
    else if (k === '--no-backups') a.backups = false;
    else if (k === '--help' || k === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else fail(`Parámetro desconocido: ${k}`);
  }
  for (const d of [a.from, a.to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(`Fecha inválida "${d}" (usa YYYY-MM-DD)`);
  if (!['oxford-education', 'travel', 'all'].includes(a.unit)) fail('--unit debe ser oxford-education | travel | all');
  a.gte = new Date(`${a.from}T00:00:00${TZ_OFFSET}`);
  a.lt = new Date(new Date(`${a.to}T00:00:00${TZ_OFFSET}`).getTime() + 86400000);
  if (!(a.gte < a.lt)) fail('--from debe ser anterior o igual a --to');
  return a;
}
function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

// ── Utilidades ───────────────────────────────────────────────────────────────
function todayMx() { return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date()); }
function fmt(d) {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(x);
}
function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
function maskPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d ? `****${d.slice(-4)}` : '—'; }
function isIntl(p) { return !String(p || '').replace(/[^\d+]/g, '').replace(/^\+?/, '+').startsWith('+52'); }
function inRange(d, a) { const t = d ? new Date(d).getTime() : NaN; return t >= a.gte.getTime() && t < a.lt.getTime(); }
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const mins = (secs) => (secs == null ? '' : Math.round((secs / 60) * 10) / 10);
/** Quita montos y secuencias largas de dígitos (teléfonos, cuentas) de un texto citado. */
function scrub(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/\$\s?\d[\d.,]*/g, '$•••')
    .replace(/\d[\d.,]*\s?(pesos|mxn|usd|d[oó]lares|libras|euros)/gi, '••• $1')
    .replace(/\d[\d\s-]{6,}\d/g, '•••');
}
const clip = (s, n) => { const t = scrub(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ── Fuentes de verdad del repo (módulos puros, sin WhatsApp ni Redis) ────────
async function loadRouting() {
  const zones = await import('../src/units/oxford-education/advisor-zones.js');
  let travel = null;
  try {
    travel = await import('../src/units/travel/advisors.js'); // importa prisma+logger; no envía nada
  } catch (e) {
    console.warn(`⚠ No se pudo importar travel/advisors.js (${e.message}). El ruteo de Miri se marca "sin verificar".`);
  }
  return { zones, travel };
}

const ORI_PRODUCT_LABELS = { // copia local, mismo patrón que advisor-notify.js / sheets-sync.js
  oxford_tcc: 'Oxford TCC', oxford_tcc_kids: 'Oxford TCC Kids', english_teaching_certificate: 'English Teaching Certificate',
  alphable: 'Alphable', oxford_life: 'Oxford LIFE', rising_stars: 'Rising Stars', work_study_spain: 'Work & Study Spain',
};
const ORI_HANDOFF_STATUS = new Set(['derivado_asesor', 'en_atencion', 'atendido_asesor', 'sin_confirmar']);
const MIRI_HANDOFF_STATUS = new Set(['derivado_asesor', 'atendido_asesor', 'cerrado_por_asesor']);

// ── Lectura de la base ───────────────────────────────────────────────────────
function describeDb(url) {
  try {
    const u = new URL(url);
    const esRailway = /rlwy\.net|railway/.test(u.hostname);
    return { label: `${u.hostname}:${u.port || 5432}${u.pathname}`, esRailway };
  } catch { return { label: '(DATABASE_URL ilegible)', esRailway: false }; }
}

async function openReadOnly() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail('Falta DATABASE_URL');
  const u = new URL(raw);
  u.searchParams.set('connection_limit', '1'); // una sola conexión → el SET de abajo aplica a TODAS las queries
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  await prisma.$executeRawUnsafe('SET default_transaction_read_only = on');
  const [{ ro }] = await prisma.$queryRawUnsafe('SHOW default_transaction_read_only').then((r) => r.map((x) => ({ ro: Object.values(x)[0] })));
  if (ro !== 'on') fail('No se pudo poner la sesión en solo lectura — abortando sin consultar nada.');
  return prisma;
}

async function fetchUnit(prisma, unit, a) {
  const isOri = unit === 'oxford_education';
  const range = { gte: a.gte, lt: a.lt };
  const withMsgs = { contact: true, messages: { orderBy: { createdAt: 'asc' } } };
  const model = isOri ? prisma.oxfordLead : prisma.travelLead;

  const convs = await prisma.conversation.findMany({ where: { unit, OR: [{ startedAt: range }, { lastMessageAt: range }] }, include: withMsgs });
  const contactIds = [...new Set(convs.map((c) => c.contactId))];
  const leads = await model.findMany({
    where: { OR: [{ createdAt: range }, { contactId: { in: contactIds } }, ...(isOri ? [{ assignedAt: range }] : [])] },
    include: { contact: true },
  });
  const missing = [...new Set(leads.map((l) => l.contactId))].filter((id) => !contactIds.includes(id));
  if (missing.length) convs.push(...await prisma.conversation.findMany({ where: { unit, contactId: { in: missing } }, include: withMsgs }));
  // Rastro de notificaciones a asesoras (tabla advisor_notifications). Si la base
  // aún no tiene la migración, se sigue sin él: notifs = null → "NO SE GUARDA".
  let notifs = null;
  try {
    notifs = await prisma.advisorNotification.findMany({ where: { unit, leadId: { in: leads.map((l) => l.id) } }, orderBy: { createdAt: 'asc' } });
  } catch { notifs = null; }
  return { convs, leads, notifs };
}

/** Respaldos de scripts/reset-*.mjs: lo que se borró de la DB durante el periodo. */
function readBackups(dir, a) {
  const out = { oxford_education: { convs: [], leads: [] }, travel: { convs: [], leads: [] }, files: [] };
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((n) => /backup.*\.json$/i.test(n))) {
    let b;
    try { b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!Array.isArray(b.conversaciones)) continue;
    const contacts = new Map((b.contactos || []).map((c) => [c.id, c]));
    const msgs = new Map();
    for (const m of b.mensajes || []) { if (!msgs.has(m.conversationId)) msgs.set(m.conversationId, []); msgs.get(m.conversationId).push(m); }
    let used = 0;
    const tag = (o) => ({ ...o, __backup: f, contact: contacts.get(o.contactId) || { id: o.contactId, phone: '', name: null } });
    for (const c of b.conversaciones) {
      if (!out[c.unit]) continue;
      const messages = (msgs.get(c.id) || []).sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
      if (inRange(c.startedAt, a) || inRange(c.lastMessageAt, a)) { out[c.unit].convs.push({ ...tag(c), messages }); used++; }
    }
    for (const [key, unit] of [['travelLeads', 'travel'], ['oxfordLeads', 'oxford_education']]) {
      const inConv = new Set(out[unit].convs.filter((c) => c.__backup === f).map((c) => c.contactId));
      for (const l of b[key] || []) if (inRange(l.createdAt, a) || inConv.has(l.contactId)) { out[unit].leads.push(tag(l)); used++; }
    }
    if (used) out.files.push({ file: f, respaldadoEl: b.respaldadoEl, unit: b.unit || 'ambas', registrosEnRango: used });
  }
  return out;
}

// ── Detección de números de prueba ───────────────────────────────────────────
function buildTestDetector(a, routing, perUnitPhones) {
  const advisorPhones = new Map();
  for (const adv of Object.values(routing.zones.ADVISORS)) advisorPhones.set(last10(adv.whatsapp), `asesora Oxford (${adv.nombre})`);
  for (const adv of Object.values(routing.travel?.ADVISORS || {})) advisorPhones.set(last10(adv.whatsapp), `asesora Travel (${adv.nombre})`);
  const confirmed = new Set(a.testPhones);
  const NAME_RE = /\b(test|testing|prueba|pruebas|demo|qa|jorge|rafael|rafa)\b/i;
  return (phone, names, fromBackup) => {
    const p = last10(phone);
    if (confirmed.has(p)) return { nivel: 'confirmado', motivo: '--test-phones' };
    const motivos = [];
    if (advisorPhones.has(p)) motivos.push(`número de ${advisorPhones.get(p)}`);
    const hit = names.filter(Boolean).find((n) => NAME_RE.test(norm(n)));
    if (hit) motivos.push(`nombre "${hit}"`);
    if (perUnitPhones.oxford_education.has(p) && perUnitPhones.travel.has(p)) motivos.push('escribió a ambos bots');
    if (fromBackup) motivos.push('borrado en un reset manual');
    return motivos.length ? { nivel: 'candidato', motivo: motivos.join(' · ') } : { nivel: 'no', motivo: '' };
  };
}

// ── Conversación → métricas + resumen extractivo ─────────────────────────────
function convStats(messages) {
  const inb = messages.filter((m) => m.direction === 'inbound');
  const outb = messages.filter((m) => m.direction === 'outbound');
  // Un turno = bloque de entrantes consecutivos. Sin respuesta guardada = no hay saliente antes del siguiente bloque.
  let turnos = 0; let turnosSin = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].direction !== 'inbound') continue;
    while (i + 1 < messages.length && messages[i + 1].direction === 'inbound') i++;
    turnos++;
    if (i + 1 >= messages.length) turnosSin++;
  }
  const texto = (m) => m.content || `[${m.contentType}]`;
  const pedidos = inb.map(texto).filter((t) => t.trim().length > 2 && !/^\d{1,2}[.)-]?$/.test(t.trim()));
  const partes = [];
  if (inb.length) partes.push(`Prospecto: "${clip((pedidos.length ? pedidos : inb.map(texto)).slice(0, 3).join(' / '), 220)}"`);
  if (inb.length > 3) partes.push(`Último del prospecto: "${clip(texto(inb[inb.length - 1]), 120)}"`);
  partes.push(!messages.length ? '(sin conversación con este bot)' : outb.length ? `Bot (último): "${clip(texto(outb[outb.length - 1]), 220)}"` : 'Bot: SIN MENSAJES SALIENTES GUARDADOS');
  return {
    entrantes: inb.length, salientes: outb.length, turnos, turnosSin,
    ultimo: messages.length ? messages[messages.length - 1].createdAt : null,
    resumen: partes.join(' · '), outText: outb.map(texto).join('\n'), inText: inb.map(texto).join('\n'),
  };
}

function groupByContact(convs) {
  const m = new Map();
  for (const c of convs) { if (!m.has(c.contactId)) m.set(c.contactId, []); m.get(c.contactId).push(c); }
  for (const list of m.values()) list.sort((x, y) => new Date(x.startedAt) - new Date(y.startedAt));
  return m;
}

function baseRow(bot, lead, convList, a, detect) {
  const contact = lead?.contact || convList[0]?.contact || {};
  const conv = convList[convList.length - 1] || null;
  const messages = convList.flatMap((c) => c.messages || []).sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
  const stats = convStats(messages);
  const entrada = [conv?.startedAt, lead?.createdAt].filter(Boolean).map((d) => new Date(d)).sort((x, y) => x - y)[0];
  const backup = lead?.__backup || conv?.__backup || null;
  const names = [contact.name, lead?.fullName, lead?.parentName, lead?.travelerName, lead?.institutionName];
  const test = detect(contact.phone, names, Boolean(backup));
  return { contact, conv, stats, backup, test, common: {
    Bot: bot,
    Origen: backup ? `RESPALDO ${backup} (ya no está en la DB)` : 'DB',
    'Entrada (MX)': fmt(entrada),
    'Nuevo en el periodo': inRange(entrada, a) ? 'sí' : 'no (contacto previo con actividad en el periodo)',
    Nombre: lead?.fullName || lead?.parentName || contact.name || '',
    Teléfono: contact.phone || '',
    Internacional: contact.phone ? (isIntl(contact.phone) ? 'sí' : 'no') : '',
    '¿Prueba?': test.nivel,
    'Motivo prueba': test.motivo,
  } };
}

const tail = (stats, lead, conv) => ({
  'Msgs entrantes': stats.entrantes,
  'Msgs salientes guardados': stats.salientes,
  'Turnos sin respuesta guardada': stats.turnosSin,
  'Último mensaje (MX)': fmt(stats.ultimo),
  'Resumen (extractivo)': stats.resumen,
  'Notas del lead': lead?.notes || '',
  'Lead ID': lead?.id || '',
  'Conversation ID': conv?.id || '',
});

// ── Ori ──────────────────────────────────────────────────────────────────────
function oriRow(lead, convList, a, detect, routing) {
  const { conv, stats, common, test } = baseRow('Ori', lead, convList, a, detect);
  const { resolveZona, ADVISORS, ZONAS } = routing.zones;
  const tags = lead?.tags || [];
  const attempts = Array.isArray(lead?.advisorAttempts) ? lead.advisorAttempts : [];
  const viaTravel = tags.includes('derivado_travel');
  const linkFallback = /Sin zona/i.test(lead?.notes || '') && !lead?.assignedAdvisor;
  const derivado = Boolean(lead && (lead.assignedAdvisor || attempts.length || ORI_HANDOFF_STATUS.has(lead.status)));
  const capturado = Boolean(lead && (lead.fullName || lead.institutionName || lead.state || lead.municipality || lead.role
    || lead.primaryProduct || lead.primaryProductLabel || lead.estimatedStudents));
  const yaInscrito = tags.includes('ya_inscrito');

  let etapa = 'solo bienvenida';
  if (derivado) etapa = 'handoff a asesora Oxford';
  else if (viaTravel) etapa = 'handoff cruzado a Travel';
  else if (linkFallback) etapa = 'handoff SIN asesora (solo link de agenda)';
  else if (yaInscrito) etapa = 'ya inscrito (seguimiento pendiente, sin handoff)';
  else if (capturado) etapa = 'dio datos';

  const zonaMapa = lead ? resolveZona(lead.state, lead.municipality) : null;
  let regla = '';
  if (viaTravel) regla = `producto de viajes → equipo Travel: ${(lead.notes || '').match(/\[TRAVEL\][^\n]*/)?.[0] || 'ver notas'}`;
  else if (derivado && zonaMapa === 'CDMX') regla = `CDMX → alterna NORTE/CENTRO por carga → ${lead.zoneKey}; round-robin por carga dentro del equipo`;
  else if (derivado && zonaMapa) regla = `${lead.state || lead.municipality} → zona ${zonaMapa}; round-robin por carga dentro del equipo`;
  else if (derivado) regla = `ubicación no reconocida → OXED_FOREIGN_LEAD_FALLBACK=${lead.zoneKey || '?'}`;
  else if (linkFallback) regla = 'ubicación no reconocida/extranjero → link de agenda: NO se asignó ni notificó a nadie';
  if (derivado && zonaMapa && zonaMapa !== 'CDMX' && lead.zoneKey && lead.zoneKey !== zonaMapa) regla += ` ⚠ zona guardada (${lead.zoneKey}) ≠ mapa actual (${zonaMapa})`;
  if (lead?.assignedAdvisor && !Object.values(ADVISORS).some((x) => x.nombre === lead.assignedAdvisor)) regla += ' ⚠ asesora que ya no está en advisor-zones.js';
  if (lead?.zoneKey && !ZONAS[lead.zoneKey]) regla += ` ⚠ zona "${lead.zoneKey}" del esquema anterior (duplas A–D)`;

  const cadena = attempts.map((t) => `${t.advisor} ${fmt(t.assignedAt).slice(5)} → ${t.result}${t.confirmedAt ? ` ${fmt(t.confirmedAt).slice(11)}` : ''}${t.expiredAt ? ` ${fmt(t.expiredAt).slice(11)}` : ''}`).join('  |  ');
  const nodo = conv?.flowNode || '';
  const cat = nodo.match(/^(?:cat|n)_(\d)/)?.[1];
  const row = {
    ...common,
    Etapa: lead ? etapa : 'conversación sin lead',
    'flowNode final': nodo || '(null)',
    'Ya inscrito': yaInscrito ? 'sí' : 'no',
    Estado: lead?.state || '',
    'Alcaldía/Municipio': lead?.municipality || '',
    'Tipo de lead': lead?.leadType === 'b2b_institutional' ? 'institución' : lead ? 'individual' : '',
    Institución: lead?.institutionName || '',
    'Categoría (según nodo)': cat ? `cat_${cat}` : '',
    'Producto (etiqueta menú)': lead?.primaryProductLabel || '',
    'Producto (enum)': lead?.primaryProduct || '',
    'Producto en el ticket': lead ? (lead.primaryProductLabel || ORI_PRODUCT_LABELS[lead.primaryProduct] || lead.primaryProduct || 'no capturado') : '',
    'Status del lead': lead?.status || '',
    Ticket: derivado ? lead.ticketNumber : '',
    'Asesora actual': lead?.assignedAdvisor || '',
    'Zona guardada': lead?.zoneKey || '',
    'Zona según mapa actual': zonaMapa || '',
    'Regla de ruteo': regla,
    'Asignación inicial (MX)': fmt(attempts[0]?.assignedAt),
    'assigned_at intento actual (MX)': fmt(lead?.assignedAt),
    'confirmed_at / ATIENDO (MX)': fmt(lead?.confirmedAt),
    'Min. hasta ATIENDO': mins(lead?.responseSeconds),
    LISTO: lead?.status === 'atendido_asesor' ? 'sí' : derivado ? 'no' : '',
    '# Reasignaciones SLA': derivado ? lead.reassignCount || 0 : '',
    'Cadena SLA (asesora, hora, resultado)': cadena,
    'Notificaciones esperadas': derivado ? Math.max(attempts.length, 1) : 0,
    'Plantilla enviada': derivado ? `${NO_GUARDA} (OXED_ADVISOR_SLA_TEMPLATE o nuevo_lead_oxford; respaldo: texto libre)` : '',
    'Meta message ID': derivado ? NO_GUARDA : '',
    'Status de entrega': derivado ? `${NO_GUARDA} (webhook de status descartado)` : '',
    Tags: tags.join(', '),
    ...tail(stats, lead, conv),
  };
  return { row, lead, derivado, viaTravel, linkFallback, capturado, yaInscrito, test, attempts };
}

// ── Miri ─────────────────────────────────────────────────────────────────────
function miriRow(lead, convList, a, detect, routing) {
  const { conv, stats, common, test } = baseRow('Miri', lead, convList, a, detect);
  const nodo = conv?.flowNode || '';
  const out = stats.outText;
  const viaOri = /\[V[ií]a Ori\]/.test(lead?.notes || '');
  const derivado = Boolean(lead && MIRI_HANDOFF_STATUS.has(lead.status));
  const capturado = Boolean(lead && (lead.parentName || lead.travelerName || lead.schoolCode || lead.programInterest || lead.travelerAge || lead.destination));

  let yaInscrito = '';
  if (/falta por pagar/i.test(out) || nodo === 'ya_inscrito_estatus') yaInscrito = 'con pagos';
  else if (/ya tom[eé] tus datos/i.test(out)) yaInscrito = 'no registrado (dio datos → handoff)';
  else if (/ya te tengo en el registro/i.test(out) || nodo === 'ya_inscrito_sin_pago') yaInscrito = 'registrado sin pagos';
  else if (nodo === 'ya_inscrito_hijo') yaInscrito = 'eligiendo estudiante (sin terminar)';
  else if (nodo === 'ya_inscrito') yaInscrito = 'no registrado (no dio datos)';

  let etapa = 'solo bienvenida';
  if (derivado) etapa = viaOri ? 'handoff (creado por Ori, sin chat con Miri)' : 'handoff a asesora';
  else if (capturado) etapa = 'dio datos';

  const school = String(lead?.schoolCode || '').trim();
  const colegioTipo = !school ? 'sin colegio' : /^otro$/i.test(school) ? 'otro' : 'registrado/capturado';
  const hay = norm(`${lead?.programInterest || ''} ${lead?.destination || ''} ${nodo} ${out.slice(0, 4000)} ${stats.inText.slice(0, 2000)}`);
  const producto = lead?.programInterest
    || (/rising|windsor|(^| )rs_|cat_rs/.test(hay) ? 'Rising Stars (inferido)' : /winter|wb_|cat_wb/.test(hay) ? 'Winter Break (inferido)' : /english 4 life|e4l/.test(hay) ? 'English 4 Life (inferido)' : '');

  let track = ''; let regla = '';
  if (lead && routing.travel) {
    track = routing.travel.resolveTrack(lead, lead.notes || '');
    const esperadas = routing.travel.trackAdvisors(track).map((x) => x.nombre);
    if (derivado) {
      regla = { colegio: 'colegio capturado → carrusel por carga', familia: 'sin colegio u "otro" → familias', rising_stars: 'Rising Stars/Windsor → equipo RS' }[track];
      regla += ` (${esperadas.join(' / ')})`;
      if (viaOri) regla += ' · track elegido por Ori según producto';
      if (lead.assignedAdvisor && !esperadas.includes(lead.assignedAdvisor)) regla += ` ⚠ ${lead.assignedAdvisor} no es del track recalculado (preasignada, vía Ori o datos cambiados después)`;
      if (!lead.assignedAdvisor) regla += ' ⚠ derivado SIN asesora asignada → no se notificó a nadie';
    }
  } else if (derivado) regla = 'sin verificar (no cargó travel/advisors.js)';

  const row = {
    ...common,
    Etapa: lead ? etapa : 'conversación sin lead',
    'flowNode final': nodo || '(null)',
    'Ya inscrito': yaInscrito ? 'sí' : 'no',
    'Desenlace ya_inscrito (inferido)': yaInscrito,
    Colegio: school,
    'Colegio: registrado u otro': lead ? colegioTipo : '',
    Producto: producto,
    'Tipo (track)': track,
    'lead_type': lead?.leadType || '',
    'Status del lead': lead?.status || '',
    Ticket: derivado ? lead.ticketNumber : '',
    'Asesora asignada': lead?.assignedAdvisor || '',
    'Regla de ruteo': regla,
    'Señal de atención': !derivado ? '' : lead.status === 'atendido_asesor' ? `LISTO (última actualización ${fmt(lead.updatedAt)})` : lead.status === 'cerrado_por_asesor' ? 'cerrado por asesora' : 'ninguna (Miri no tiene ATIENDO/SLA; sin LISTO)',
    'Última actualización del lead (MX)': fmt(lead?.updatedAt),
    'Plantilla enviada': derivado ? `${NO_GUARDA} (TRAVEL_ADVISOR_TEMPLATE_V2 o nuevo_lead_travel; respaldo: texto libre)` : '',
    'Meta message ID': derivado ? NO_GUARDA : '',
    'Status de entrega': derivado ? `${NO_GUARDA} (webhook de status descartado)` : '',
    'Despedida de handoff guardada': !derivado || viaOri ? '' : /te conecto con/i.test(out) ? 'sí' : 'NO (actions.js no la persiste)',
    ...tail(stats, lead, conv),
  };
  return { row, lead, derivado, viaOri, capturado, yaInscrito, test };
}

// ── Ensamble por unidad ──────────────────────────────────────────────────────
function assemble(unit, db, bk, a, detect, routing) {
  const dbLeadIds = new Set(db.leads.map((l) => l.id));
  const dbConvIds = new Set(db.convs.map((c) => c.id));
  const leads = [...db.leads, ...bk.leads.filter((l) => !dbLeadIds.has(l.id))];
  const convs = [...db.convs, ...bk.convs.filter((c) => !dbConvIds.has(c.id))];
  const byContact = groupByContact(convs);
  const make = unit === 'travel' ? miriRow : oriRow;
  const items = leads.map((l) => make(l, byContact.get(l.contactId) || [], a, detect, routing));
  const withLead = new Set(leads.map((l) => l.contactId));
  for (const [contactId, list] of byContact) if (!withLead.has(contactId)) items.push(make(null, list, a, detect, routing));
  items.sort((x, y) => String(x.row['Entrada (MX)']).localeCompare(String(y.row['Entrada (MX)'])));
  // Con rastro disponible, las columnas de notificación dejan de ser "NO SE GUARDA".
  const hayRastro = Array.isArray(db.notifs);
  for (const i of items) {
    i.notifs = hayRastro && i.lead ? db.notifs.filter((n) => n.leadId === i.lead.id) : [];
    if (!hayRastro || !i.derivado) continue;
    if (!i.notifs.length) {
      const sinRastro = 'sin rastro (handoff anterior al despliegue del rastro)';
      Object.assign(i.row, { 'Plantilla enviada': sinRastro, 'Meta message ID': sinRastro, 'Status de entrega': sinRastro });
      continue;
    }
    i.row['Plantilla enviada'] = i.notifs.map((n) => (n.via === 'template' ? n.templateName : n.via === 'text' ? 'texto libre (respaldo)' : 'NO SALIÓ')).join(' | ');
    i.row['Meta message ID'] = i.notifs.map((n) => n.waMessageId || '—').join(' | ');
    i.row['Status de entrega'] = i.notifs.map((n) => `${n.advisorName}: ${n.status}${n.errorCode ? ` (${n.errorCode} ${n.errorTitle || ''})` : n.status === 'send_error' ? ` (${n.errorDetail || ''})` : ''}`).join(' | ');
  }
  return { items, convCount: byContact.size, hayRastro };
}

function tally(items, convCount) {
  const real = (i) => i.test.nivel === 'no';
  const t = {
    conversaciones: convCount, filas: items.length,
    prueba_confirmada: items.filter((i) => i.test.nivel === 'confirmado').length,
    prueba_candidata: items.filter((i) => i.test.nivel === 'candidato').length,
    reales: items.filter(real).length,
    solo_bienvenida: items.filter((i) => !i.capturado && !i.derivado && !i.viaTravel && !i.linkFallback && !i.yaInscrito).length,
    dio_datos_sin_handoff: items.filter((i) => i.capturado && !i.derivado && !i.viaTravel && !i.linkFallback).length,
    handoffs: items.filter((i) => i.derivado).length,
    handoffs_reales: items.filter((i) => i.derivado && real(i)).length,
    ya_inscrito: items.filter((i) => i.yaInscrito).length,
    turnos_sin_respuesta: items.reduce((s, i) => s + (i.row['Turnos sin respuesta guardada'] || 0), 0),
  };
  return t;
}

// ── Por asesora ──────────────────────────────────────────────────────────────
function advisorSheet(ori, miri, routing) {
  const rows = new Map();
  const get = (bot, nombre, equipo) => {
    const k = `${bot}|${nombre}`;
    if (!rows.has(k)) rows.set(k, { Bot: bot, Asesora: nombre, Equipo: equipo, recibidos: 0, reales: 0, atiendo: 0, secs: [], reasignado: 0, esperando: 0, listo: 0, sinConfirmar: 0, vigentes: 0, entregadas: 0, fallidas: 0, enTransito: 0 });
    return rows.get(k);
  };
  const zonaDe = (key) => Object.entries(routing.zones.ZONAS).find(([, z]) => z.advisors.includes(key))?.[0] || '—';
  for (const a of Object.values(routing.zones.ADVISORS)) get('Ori', a.nombre, zonaDe(a.key));
  for (const [track, keys] of Object.entries(routing.travel?.TRACKS || {})) for (const k of keys) get('Miri', routing.travel.ADVISORS[k].nombre, track);

  for (const i of ori?.items || []) {
    if (!i.derivado) continue;
    const real = i.test.nivel === 'no';
    const attempts = i.attempts.length ? i.attempts : [{ advisor: i.lead.assignedAdvisor, result: i.lead.confirmedAt ? 'confirmo' : 'esperando', assignedAt: i.lead.assignedAt, confirmedAt: i.lead.confirmedAt }];
    for (const t of attempts) {
      if (!t.advisor) continue;
      const r = get('Ori', t.advisor, '(fuera del registro actual)');
      r.recibidos++; if (real) r.reales++;
      if (t.result === 'confirmo') { r.atiendo++; if (t.confirmedAt && t.assignedAt) r.secs.push((new Date(t.confirmedAt) - new Date(t.assignedAt)) / 1000); }
      else if (t.result === 'no_confirmo') r.reasignado++;
      else r.esperando++;
    }
    if (i.lead.assignedAdvisor) {
      const r = get('Ori', i.lead.assignedAdvisor, '(fuera del registro actual)');
      r.vigentes++;
      if (i.lead.status === 'atendido_asesor') r.listo++;
      if (i.lead.status === 'sin_confirmar') r.sinConfirmar++;
    }
  }
  for (const i of miri?.items || []) {
    if (!i.derivado || !i.lead.assignedAdvisor) continue;
    const r = get('Miri', i.lead.assignedAdvisor, '(fuera del registro actual)');
    r.recibidos++; r.vigentes++; if (i.test.nivel === 'no') r.reales++;
    if (i.lead.status === 'atendido_asesor') r.listo++;
  }
  const rastro = { Ori: Boolean(ori?.hayRastro), Miri: Boolean(miri?.hayRastro) };
  for (const [bot, unit] of [['Ori', ori], ['Miri', miri]]) {
    for (const i of unit?.items || []) for (const n of i.notifs || []) {
      const r = get(bot, n.advisorName, '(fuera del registro actual)');
      if (n.status === 'delivered' || n.status === 'read') r.entregadas++;
      else if (n.status === 'failed' || n.status === 'send_error') r.fallidas++;
      else r.enTransito++;
    }
  }
  return [...rows.values()].map((r) => ({
    Bot: r.Bot, Asesora: r.Asesora, 'Equipo / track': r.Equipo,
    'Leads recibidos (asignaciones)': r.recibidos,
    '… de prospectos reales': r.reales,
    'Leads que conserva hoy': r.vigentes,
    'Notificaciones entregadas': rastro[r.Bot] ? r.entregadas : NO_GUARDA,
    'Notificaciones fallidas': rastro[r.Bot] ? r.fallidas : NO_GUARDA,
    'Notificaciones sin confirmar entrega': rastro[r.Bot] ? r.enTransito : NO_GUARDA,
    'ATIENDO (Ori)': r.Bot === 'Ori' ? r.atiendo : 'n/a',
    'Tiempo medio de respuesta (min)': r.Bot === 'Ori' ? (r.secs.length ? mins(r.secs.reduce((s, x) => s + x, 0) / r.secs.length) : '') : 'n/a',
    'Reasignado por no confirmar (Ori)': r.Bot === 'Ori' ? r.reasignado : 'n/a',
    'Esperando confirmación (Ori)': r.Bot === 'Ori' ? r.esperando : 'n/a',
    'Terminó en sin_confirmar (Ori)': r.Bot === 'Ori' ? r.sinConfirmar : 'n/a',
    LISTO: r.listo,
  }));
}

// ── Cruce con Google Sheets (solo lectura) ───────────────────────────────────
async function crossCheckSheets(a, ori, miri) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) return [['Sheet', 'OMITIDO: faltan GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY']];
  const { google } = await import('googleapis');
  const auth = new google.auth.JWT({ email, key: key.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const api = google.sheets({ version: 'v4', auth });
  const spreadsheetId = DEFAULT_SHEET_ID;
  const read = async (tab) => {
    try { return (await api.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'` })).data.values || []; }
    catch (e) { return { error: e.errors?.[0]?.message || e.message }; }
  };
  const parseDate = (v) => {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '12').padStart(2, '0')}:${m[5] || '00'}:00${TZ_OFFSET}`);
    const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
  };
  const out = [];
  const compareById = (label, tab, rowsOrErr, items, dateCol) => {
    if (!Array.isArray(rowsOrErr)) { out.push([label, `ERROR leyendo "${tab}": ${rowsOrErr.error}`]); return; }
    const data = rowsOrErr.slice(1).filter((r) => r[0]);
    const sheetIds = new Set(data.map((r) => String(r[0]).trim()));
    const enRango = data.filter((r) => { const d = parseDate(r[dateCol]); return d && inRange(d, a); });
    const dbItems = (items || []).filter((i) => i.lead && !i.lead.__backup);
    const dbIds = new Set(dbItems.map((i) => i.lead.id));
    out.push([label, `filas totales en "${tab}": ${data.length}`]);
    out.push([label, `filas con fecha dentro del periodo: ${enRango.length}`]);
    out.push([label, `leads en DB (periodo): ${dbIds.size}`]);
    out.push([label, `en DB y también en el Sheet: ${[...dbIds].filter((id) => sheetIds.has(id)).length}`]);
    out.push([label, `en DB pero NO en el Sheet: ${[...dbIds].filter((id) => !sheetIds.has(id)).length}  (solo se sincroniza al capturar datos/derivar)`]);
    out.push([label, `en el Sheet (periodo) pero NO en DB: ${enRango.filter((r) => !dbIds.has(String(r[0]).trim())).length}  (borrados por reset o anteriores)`]);
    return { data, enRango };
  };
  if (miri) compareById('Sheet "Leads" (Miri)', SHEET_TABS.miri, await read(SHEET_TABS.miri), miri.items, 1);
  if (ori) {
    const r = compareById('Sheet "Leads Oxford"', SHEET_TABS.ori, await read(SHEET_TABS.ori), ori.items, 1);
    if (r) {
      const dbDeriv = ori.items.filter((i) => i.derivado && !i.lead.__backup).length;
      out.push(['Sheet "Leads Oxford"', `Derivación = "Sí" en filas del periodo: ${r.enRango.filter((x) => /^s[ií]/i.test(x[9] || '')).length}  vs  handoffs en DB: ${dbDeriv}`]);
    }
    const tiempos = await read(SHEET_TABS.tiempos);
    if (!Array.isArray(tiempos)) out.push(['Sheet "Tiempos asesores"', `ERROR: ${tiempos.error}`]);
    else {
      const tickets = new Set(tiempos.slice(1).map((x) => String(x[0] || '').trim()).filter(Boolean));
      const esperados = ori.items.filter((i) => i.derivado && !i.lead.__backup && (i.lead.confirmedAt || i.lead.status === 'sin_confirmar'));
      out.push(['Sheet "Tiempos asesores"', `filas: ${tickets.size}`]);
      out.push(['Sheet "Tiempos asesores"', `tickets del periodo que deberían estar (ATIENDO o sin_confirmar): ${esperados.length}; presentes: ${esperados.filter((i) => tickets.has(String(i.lead.ticketNumber))).length}`]);
      out.push(['Sheet "Tiempos asesores"', `estados finales en la hoja: ${Object.entries(tiempos.slice(1).reduce((m, x) => { const k = x[9] || '(vacío)'; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`]);
    }
    const resumen = await read(SHEET_TABS.resumen);
    if (!Array.isArray(resumen)) out.push(['Sheet "Resumen asesoras"', `ERROR: ${resumen.error}`]);
    else for (const x of resumen.slice(1)) out.push(['Sheet "Resumen asesoras"', `${x[0]}: atendidos=${x[1] ?? ''} · prom(min)=${x[2] ?? ''} · reasignado por no confirmar=${x[5] ?? ''}  (acumulado histórico de la hoja, no solo el periodo)`]);
  }
  return out;
}

// ── Logs de Railway (archivo exportado) ──────────────────────────────────────
function scanLogs(file) {
  if (!file) return [['Logs', 'OMITIDO: pasa --logs <archivo> con la salida de `railway logs`']];
  if (!fs.existsSync(file)) return [['Logs', `No existe ${file}`]];
  const patterns = [
    ['Notificación por PLANTILLA aceptada por Meta', /Advisor notification sent"|Advisor notification sent(?! \(fallback)/],
    ['Notificación por TEXTO LIBRE (respaldo; solo llega dentro de 24h)', /Advisor notification sent \(fallback text\)/],
    ['Plantilla FALLÓ → cayó a texto libre', /Template notification failed/],
    ['Notificación a asesora con ERROR (no salió)', /Error notifying advisor|Error sending advisor notification/],
    ['Error de la API de WhatsApp (Ori)', /Error sending Oxford WhatsApp message/],
    ['Error de la API de WhatsApp (Travel)', /Error sending WhatsApp message|WhatsApp API error/],
    ['Reasignación por SLA', /reasignado autom[aá]ticamente/],
    ['ALERTA SLA: se agotaron las asesoras', /ALERTA SLA Oxford/],
    ['Error del poller de SLA', /Error in (initial|scheduled) Oxford advisor SLA sweep|Error querying due Oxford leads|Error reassigning Oxford lead/],
    ['Arranques del job de SLA (reinicios del servicio)', /Oxford advisor SLA job started/],
    ['Lead sin zona → solo link de agenda', /passive meeting-link fallback/],
    ['Handoff sin WhatsApp de asesora (Miri)', /No advisor WhatsApp found/],
  ];
  const counts = patterns.map(() => 0); const metaErrors = new Map(); let first = null; let last = null; let total = 0;
  const vistas = new Set(); // un export armado con varios --filter repite líneas
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    // La misma línea bajada por dos filtros llega con las claves en otro orden: se deduplica por evento.
    const ev = line.match(/"time":\s*"?([^",}]+)/)?.[1];
    const clave = ev
      ? [ev, line.match(/"message":\s*"([^"]{0,80})/)?.[1], line.match(/"advisor":\s*"([^"]*)/)?.[1], line.match(/"leadId":\s*"([^"]*)/)?.[1]].join('|')
      : line;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    total++;
    const ts = line.match(/"time":\s*"?([\d-]{10}T[\d:.]+Z?|\d{13})/)?.[1] || line.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0];
    if (ts) { const d = /^\d{13}$/.test(ts) ? new Date(Number(ts)) : new Date(ts); if (!first || d < first) first = d; if (!last || d > last) last = d; }
    patterns.forEach(([, re], i) => { if (re.test(line)) counts[i]++; });
    const code = line.match(/"code":\s*(\d{3,6})/)?.[1];
    if (code && /error/i.test(line)) { const msg = line.match(/"message":\s*"([^"]{0,140})/)?.[1] || ''; const k = `${code} ${msg}`; metaErrors.set(k, (metaErrors.get(k) || 0) + 1); }
  }
  const out = [['Logs', `${path.basename(file)}: ${total} líneas únicas, de ${fmt(first) || '?'} a ${fmt(last) || '?'} (MX)`]];
  patterns.forEach(([label], i) => out.push(['Logs', `${label}: ${counts[i]}`]));
  for (const [k, v] of [...metaErrors].sort((x, y) => y[1] - x[1]).slice(0, 10)) out.push(['Logs · código de error de Meta', `${k}  ×${v}`]);
  return out;
}

// ── Salida ───────────────────────────────────────────────────────────────────
async function writeWorkbook(file, sheets) {
  let XLSX;
  try { XLSX = (await import('xlsx')).default; } catch { XLSX = null; }
  if (!XLSX) {
    const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const written = [];
    for (const [name, aoa] of sheets) { const f = file.replace(/\.xlsx$/, `-${name.replace(/\W+/g, '_')}.csv`); fs.writeFileSync(f, `﻿${csv(aoa)}`); written.push(f); }
    console.warn('⚠ El paquete `xlsx` no está instalado: se escribieron CSV. Para .xlsx: npm i --no-save xlsx@0.18.5');
    return written;
  }
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = (aoa[0] || []).map((h, c) => ({ wch: Math.min(60, Math.max(String(h).length + 2, ...aoa.slice(1, 200).map((r) => String(r[c] ?? '').length + 1), 8)) }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, file);
  return [file];
}
const toAoa = (rows) => (rows.length ? [Object.keys(rows[0]), ...rows.map((r) => Object.keys(rows[0]).map((k) => r[k] ?? ''))] : [['(sin filas en el periodo)']]);

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const a = parseArgs(process.argv.slice(2));
  const db = describeDb(process.env.DATABASE_URL || '');
  console.log(`\nAuditoría de leads · ${a.from} → ${a.to} (${TZ}) · unit=${a.unit}`);
  console.log(`Base: ${db.label}  ${db.esRailway ? '[Railway]' : '[⚠ NO es Railway — ¿local/test?]'}  · sesión en SOLO LECTURA\n`);

  const routing = await loadRouting();
  const prisma = await openReadOnly();
  const want = { oxford_education: a.unit !== 'travel', travel: a.unit !== 'oxford-education' };
  const bk = a.backups ? readBackups(a.out, a) : { oxford_education: { convs: [], leads: [] }, travel: { convs: [], leads: [] }, files: [] };

  const raw = {};
  try {
    for (const unit of Object.keys(want)) if (want[unit]) raw[unit] = await fetchUnit(prisma, unit, a);
  } finally { await prisma.$disconnect(); }

  const phones = { oxford_education: new Set(), travel: new Set() };
  for (const unit of Object.keys(raw)) for (const c of [...raw[unit].convs, ...bk[unit].convs]) if (c.contact?.phone) phones[unit].add(last10(c.contact.phone));
  const detect = buildTestDetector(a, routing, phones);

  const ori = raw.oxford_education ? assemble('oxford_education', raw.oxford_education, bk.oxford_education, a, detect, routing) : null;
  const miri = raw.travel ? assemble('travel', raw.travel, bk.travel, a, detect, routing) : null;
  const tOri = ori ? tally(ori.items, ori.convCount) : null;
  const tMiri = miri ? tally(miri.items, miri.convCount) : null;

  const sheetRows = a.sheet ? await crossCheckSheets(a, ori, miri).catch((e) => [['Sheet', `ERROR: ${e.message}`]]) : [['Sheet', 'OMITIDO (--no-sheet)']];
  const logRows = scanLogs(a.logs);

  // Resumen
  const R = [['Sección', 'Métrica', 'Ori', 'Miri']];
  const line = (sec, label, key) => R.push([sec, label, tOri ? tOri[key] : 'n/a', tMiri ? tMiri[key] : 'n/a']);
  R.push(['Corrida', 'Periodo', `${a.from} → ${a.to}`, TZ], ['Corrida', 'Base de datos', db.label, db.esRailway ? 'Railway' : 'NO es Railway'], ['Corrida', 'Generado (MX)', fmt(new Date()), '']);
  line('Conteos', 'Contactos con conversación en el periodo', 'conversaciones');
  line('Conteos', 'Filas (leads + conversaciones sin lead)', 'filas');
  line('Conteos', 'Prospectos reales (ni confirmados ni candidatos a prueba)', 'reales');
  line('Conteos', 'Prueba: confirmados (--test-phones)', 'prueba_confirmada');
  line('Conteos', 'Prueba: candidatos por confirmar', 'prueba_candidata');
  line('Embudo', 'Entraron pero no dieron datos (nunca fueron lead)', 'solo_bienvenida');
  line('Embudo', 'Dieron datos sin llegar a handoff', 'dio_datos_sin_handoff');
  line('Embudo', 'Handoffs a asesora (todos)', 'handoffs');
  line('Embudo', 'Handoffs a asesora (prospectos reales)', 'handoffs_reales');
  line('Embudo', 'Ya inscritos', 'ya_inscrito');
  line('Persistencia', 'Turnos del prospecto sin respuesta guardada', 'turnos_sin_respuesta');
  if (ori) {
    const d = ori.items.filter((i) => i.derivado);
    const c = (f) => d.filter(f).length;
    R.push(['Ori · SLA', 'Handoffs confirmados con ATIENDO', c((i) => i.lead.confirmedAt), ''],
      ['Ori · SLA', 'Handoffs cerrados con LISTO', c((i) => i.lead.status === 'atendido_asesor'), ''],
      ['Ori · SLA', 'Handoffs en sin_confirmar (se agotaron las 8 asesoras)', c((i) => i.lead.status === 'sin_confirmar'), ''],
      ['Ori · SLA', 'Handoffs aún esperando confirmación', c((i) => i.lead.status === 'derivado_asesor' && !i.lead.confirmedAt), ''],
      ['Ori · SLA', 'Reasignaciones totales', d.reduce((s, i) => s + (i.lead.reassignCount || 0), 0), ''],
      ['Ori · ruteo', 'Derivados a Travel (derivado_travel)', ori.items.filter((i) => i.viaTravel).length, ''],
      ['Ori · ruteo', 'Sin zona → solo link de agenda (nadie notificado)', ori.items.filter((i) => i.linkFallback).length, ''],
      ['Ori · ticket', 'Handoffs cuyo ticket dice "Producto: no capturado"', c((i) => i.row['Producto en el ticket'] === 'no capturado'), ''],
      ['Ori · ticket', 'Handoffs sin estado/municipio ("Zona: no capturada")', c((i) => !i.lead.state && !i.lead.municipality), '']);
  }
  if (miri) {
    const d = miri.items.filter((i) => i.derivado);
    R.push(['Miri · handoff', 'Handoffs con LISTO', '', d.filter((i) => i.lead.status === 'atendido_asesor').length],
      ['Miri · handoff', 'Handoffs sin asesora asignada', '', d.filter((i) => !i.lead.assignedAdvisor).length],
      ['Miri · handoff', 'Handoffs creados por Ori (sin chat con Miri)', '', d.filter((i) => i.viaOri).length],
      ['Miri · persistencia', 'Handoffs cuya despedida no quedó guardada', '', d.filter((i) => String(i.row['Despedida de handoff guardada']).startsWith('NO')).length]);
  }
  const rastroTxt = (u) => (!u ? 'n/a' : u.hayRastro
    ? `tabla advisor_notifications: ${u.items.reduce((n, i) => n + i.notifs.length, 0)} notificaciones de estos leads`
    : `${NO_GUARDA} (esta base aún no tiene la tabla advisor_notifications)`);
  const cuenta = (u, f) => (!u || !u.hayRastro ? NO_GUARDA : u.items.reduce((n, i) => n + i.notifs.filter(f).length, 0));
  R.push(['Entrega', 'Rastro de notificaciones (plantilla + wamid + status)', rastroTxt(ori), rastroTxt(miri)],
    ['Entrega', 'Notificaciones entregadas (delivered/read)', cuenta(ori, (n) => ['delivered', 'read'].includes(n.status)), cuenta(miri, (n) => ['delivered', 'read'].includes(n.status))],
    ['Entrega', 'Notificaciones fallidas (failed/send_error)', cuenta(ori, (n) => ['failed', 'send_error'].includes(n.status)), cuenta(miri, (n) => ['failed', 'send_error'].includes(n.status))],
    ['Entrega', 'Aceptadas por Meta sin confirmación de entrega', cuenta(ori, (n) => ['accepted', 'sent'].includes(n.status)), cuenta(miri, (n) => ['accepted', 'sent'].includes(n.status))],
    ['Huecos', 'Mensajes de la asesora (ATIENDO/LISTO/PENDIENTES)', 'no se guardan como Message', 'no se guardan como Message']);
  for (const f of bk.files) R.push(['Respaldos de reset', f.file, `unit=${f.unit} · ${f.respaldadoEl}`, `${f.registrosEnRango} registros del periodo recuperados`]);
  if (!bk.files.length) R.push(['Respaldos de reset', a.backups ? 'ninguno con datos del periodo' : 'omitidos (--no-backups)', '', '']);
  for (const [s, v] of [...sheetRows, ...logRows]) R.push([s, v, '', '']);

  const candidates = [...(ori?.items || []), ...(miri?.items || [])].filter((i) => i.test.nivel !== 'no');
  R.push(['Números de prueba', '(lista para confirmar)', '', '']);
  for (const i of candidates) R.push(['Números de prueba', `${i.row.Bot} · ${i.row.Teléfono} · ${i.row.Nombre || 's/n'}`, i.test.nivel, i.test.motivo]);

  fs.mkdirSync(a.out, { recursive: true });
  const file = path.join(a.out, `audit-leads-${todayMx()}.xlsx`);
  const written = await writeWorkbook(file, [
    ['Leads Ori', toAoa((ori?.items || []).map((i) => i.row))],
    ['Leads Miri', toAoa((miri?.items || []).map((i) => i.row))],
    ['Por asesora', toAoa(advisorSheet(ori, miri, routing))],
    ['Resumen', R],
  ]);

  // Consola: SOLO agregados y teléfonos enmascarados.
  const show = (name, t) => {
    if (!t) return;
    console.log(`── ${name} ──`);
    console.log(`  contactos con conversación: ${t.conversaciones} · filas de prospectos reales: ${t.reales} · prueba confirmada: ${t.prueba_confirmada} · candidatos a prueba: ${t.prueba_candidata}`);
    console.log(`  solo bienvenida: ${t.solo_bienvenida} · dieron datos sin handoff: ${t.dio_datos_sin_handoff} · handoffs: ${t.handoffs} (reales: ${t.handoffs_reales}) · ya inscritos: ${t.ya_inscrito}`);
    console.log(`  turnos sin respuesta guardada: ${t.turnos_sin_respuesta}`);
  };
  show('Ori (oxford-education)', tOri); show('Miri (travel)', tMiri);
  for (const r of R.filter((x) => /^(Ori ·|Miri ·)/.test(x[0]))) console.log(`  ${r[0]} — ${r[1]}: ${r[2] !== '' ? r[2] : r[3]}`);
  console.log('\n── Por asesora ──');
  for (const r of advisorSheet(ori, miri, routing)) {
    console.log(`  ${r.Bot.padEnd(4)} ${r.Asesora.padEnd(20)} recibidos=${r['Leads recibidos (asignaciones)']} reales=${r['… de prospectos reales']}`
      + (r.Bot === 'Ori' ? ` ATIENDO=${r['ATIENDO (Ori)']} prom=${r['Tiempo medio de respuesta (min)'] || '—'}min reasignado=${r['Reasignado por no confirmar (Ori)']} esperando=${r['Esperando confirmación (Ori)']}` : '')
      + ` LISTO=${r.LISTO} entregadas=${r['Notificaciones entregadas']} fallidas=${r['Notificaciones fallidas']}`);
  }
  console.log('\n── Cruces ──');
  for (const [s, v] of [...sheetRows, ...logRows]) console.log(`  ${s}: ${v}`);
  for (const f of bk.files) console.log(`  Respaldo ${f.file}: ${f.registrosEnRango} registros del periodo (borrados de la DB el ${fmt(f.respaldadoEl)})`);
  console.log('\n── Candidatos a número de prueba (confirmar) ──');
  const seen = new Set();
  for (const i of candidates) { const k = `${maskPhone(i.row.Teléfono)}|${i.test.motivo}`; if (!seen.has(k)) { seen.add(k); console.log(`  ${i.row.Bot.padEnd(4)} ${maskPhone(i.row.Teléfono)}  ${i.test.nivel}: ${i.test.motivo}`); } }
  if (!candidates.length) console.log('  (ninguno detectado)');
  console.log('\n── Entrega de notificaciones ──');
  for (const r of R.filter((x) => x[0] === 'Entrega')) console.log(`  ${r[1]} — Ori: ${r[2]} · Miri: ${r[3]}`);
  console.log(`\n✔ Escrito (contiene PII, no compartir ni commitear):\n  ${written.join('\n  ')}\n`);
}

main().catch((e) => { console.error('✖ Error en la auditoría:', e); process.exit(1); });
