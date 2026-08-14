/**
 * demo-oxford-advisor-sla.mjs — Simulación en logs del SLA de confirmación de
 * asesor (feature/ori-advisor-sla). NO manda WhatsApp real, NO usa DB real —
 * mismo enfoque mockeado que scripts/test-oxford-advisor-sla.mjs, pero aquí se
 * IMPRIME la cadena completa para revisión humana en vez de solo assertions.
 *
 * Cadena simulada: asignado (Enrique) → no confirma → pareja (Oriana) → no
 * confirma → siguiente dupla (Rosaura, dupla B) → confirma.
 *
 * Uso: node --experimental-test-module-mocks scripts/demo-oxford-advisor-sla.mjs
 */
import { mock } from 'node:test';

const LOG = [];
let DB = new Map();

function matchesWhere(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lte' in cond) return row[key] != null && new Date(row[key]).getTime() <= new Date(cond.lte).getTime();
      if ('in' in cond) return cond.in.includes(row[key]);
      return false;
    }
    return row[key] === cond;
  });
}

const fakePrisma = {
  oxfordLead: {
    async findUnique({ where }) {
      if (where.id) return DB.has(where.id) ? { ...DB.get(where.id) } : null;
      if (where.ticketNumber != null) {
        const row = [...DB.values()].find((r) => r.ticketNumber === where.ticketNumber);
        return row ? { ...row } : null;
      }
      return null;
    },
    async findMany({ where = {}, orderBy } = {}) {
      let rows = [...DB.values()].filter((r) => matchesWhere(r, where));
      if (orderBy) {
        const [key] = Object.keys(orderBy);
        const dir = orderBy[key] === 'desc' ? -1 : 1;
        rows = rows.sort((a, b) => dir * (new Date(a[key] || 0) - new Date(b[key] || 0)));
      }
      return rows.map((r) => ({ ...r }));
    },
    async update({ where, data }) {
      const row = DB.get(where.id);
      Object.assign(row, data);
      return { ...row };
    },
    async updateMany({ where, data }) {
      const rows = [...DB.values()].filter((r) => matchesWhere(r, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    async groupBy() { return []; },
  },
};

const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

// ── Fake Google Sheets (Map en memoria) — feature/ori-advisor-sla ───────────
// Mismo enfoque que scripts/test-oxford-advisor-sla.mjs: replica que Sheets
// QUITA el apóstrofo inicial de un valor forzado a texto (el truco que usa el
// ticket como clave de upsert), o el upsert por ticket rompería en silencio.
let SHEETS = new Map();
function colLetterToIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function coerceCell(v) { return typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; }
const fakeSheetsClient = {
  async sheetExists(_id, name) { return SHEETS.has(name); },
  async createSheet(_id, name) { if (!SHEETS.has(name)) SHEETS.set(name, []); return {}; },
  async appendRow(_id, name, rowData) { const rows = SHEETS.get(name) || []; rows.push(rowData.map(coerceCell)); SHEETS.set(name, rows); return {}; },
  async updateRow(_id, name, rowNumber, rowData) { const rows = SHEETS.get(name) || []; rows[rowNumber - 1] = rowData.map(coerceCell); SHEETS.set(name, rows); return {}; },
  async findRowByColumn(_id, name, columnIndex, searchValue) {
    const rows = SHEETS.get(name) || [];
    for (let i = 1; i < rows.length; i++) if (rows[i][columnIndex] === searchValue) return i + 1;
    return null;
  },
  async updateRange(_id, range, values) {
    const [, name, startColLetter] = range.match(/^'([^']+)'!([A-Z]+)\d+:[A-Z]+\d+$/);
    const rows = SHEETS.get(name) || [];
    if (!rows[0]) rows[0] = [];
    const startIdx = colLetterToIndex(startColLetter);
    values[0].forEach((v, i) => { rows[0][startIdx + i] = v; });
    SHEETS.set(name, rows);
    return {};
  },
  async readRange(_id, range) {
    const [, name, r1] = range.match(/^'([^']+)'!(\d+):(\d+)$/);
    const rows = SHEETS.get(name) || [];
    const row = rows[parseInt(r1, 10) - 1];
    return row ? [row] : [];
  },
  async readSheet(_id, name) {
    const rows = SHEETS.get(name) || [];
    if (rows.length === 0) return [];
    const headers = rows[0];
    return rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] !== undefined && r[i] !== null ? String(r[i]) : null; });
      return obj;
    });
  },
};

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/core/database/client.js', { defaultExport: fakePrisma });
mock.module('../src/config/env.js', {
  namedExports: {
    env: { OXED_ADVISOR_SLA_MINUTES: 10, OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford', OXED_ADVISOR_TEMPLATE_LANG: 'es_MX' },
  },
});
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { LOG.push({ who: `WhatsApp → ${to}`, text }); },
    sendTemplateMessage: async (to, name) => { LOG.push({ who: `WhatsApp (plantilla) → ${to}`, text: `(${name})` }); },
  },
});
mock.module('../src/core/sheets/client.js', { namedExports: fakeSheetsClient });

function printSheetTable(title, sheetName) {
  const rows = SHEETS.get(sheetName);
  console.log(`\n--- Google Sheets: "${sheetName}" (${title}) ---`);
  if (!rows || rows.length === 0) { console.log('  (vacío)'); return; }
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col] ?? '').length)));
  for (const row of rows) {
    console.log('  | ' + row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join(' | ') + ' |');
  }
}

const { handleOxfordAdvisorCommand } = await import('../src/units/oxford-education/advisor-commands.js');
const { ADVISORS } = await import('../src/units/oxford-education/advisor-zones.js');
const { buildAssignmentFields, processExpiredAssignments } = await import('../src/units/oxford-education/advisor-sla.js');

function makeLead() {
  const lead = {
    id: 'lead-demo', contactId: 'c1', contact: { id: 'c1', name: 'Ana López', phone: '+5215500000099' },
    leadType: 'b2c_individual', fullName: 'Ana López', institutionName: 'Colegio Test',
    state: 'CDMX', municipality: 'Coyoacán', zoneKey: 'A', primaryProduct: 'oxford_tcc',
    status: 'derivado_asesor', ticketNumber: 501,
    assignedAdvisor: null, assignedAt: null, confirmedAt: null, responseSeconds: null, slaDueAt: null,
    currentAttempt: 0, reassignCount: 0, triedAdvisorKeys: [], advisorAttempts: [], notes: null, tags: [],
  };
  DB.set(lead.id, lead);
  return lead;
}

function assignAdvisor(lead, advisorKey, at) {
  const advisor = ADVISORS[advisorKey];
  Object.assign(lead, { assignedAdvisor: advisor.nombre, ...buildAssignmentFields(lead, advisor, at) });
}

function overdueAt() {
  return new Date(Date.now() - 11 * 60000); // hace 11 min → ya venció el SLA de 10 min
}

function printState(title, lead) {
  console.log(`\n--- ${title} ---`);
  console.log(`  Asesor asignado:     ${lead.assignedAdvisor}`);
  console.log(`  Intento actual:      ${lead.currentAttempt}`);
  console.log(`  Reasignaciones:      ${lead.reassignCount}`);
  console.log(`  Asesoras intentadas: ${lead.triedAdvisorKeys.join(', ')}`);
  console.log(`  Confirmado:          ${lead.confirmedAt ? new Date(lead.confirmedAt).toLocaleString('es-MX') : 'NO'}`);
  console.log(`  Minutos de respuesta:${lead.responseSeconds != null ? ' ' + (lead.responseSeconds / 60).toFixed(1) + ' min' : ' —'}`);
  console.log(`  Rastro:`);
  for (const a of lead.advisorAttempts) {
    console.log(`    - ${a.advisor.padEnd(18)} asignado ${new Date(a.assignedAt).toLocaleTimeString('es-MX')} → ${a.result}`);
  }
}

function flushLog() {
  for (const l of LOG) {
    console.log(`\n[${l.who}]`);
    console.log(l.text);
  }
  LOG.length = 0;
}

console.log('='.repeat(72));
console.log('SIMULACIÓN — SLA de confirmación de asesor (feature/ori-advisor-sla)');
console.log('Cadena: asignado → no confirma → pareja → no confirma → siguiente');
console.log('dupla → confirma');
console.log('='.repeat(72));

const lead = makeLead();

// 1) Asignación inicial (simula lo que hace executeHandoffToAdvisor al derivar).
assignAdvisor(lead, 'enrique', overdueAt());
console.log(`\n>>> Lead #${lead.ticketNumber} derivado a ${lead.assignedAdvisor} (hace 11 min, SLA=10 min)`);
printState('Tras asignación inicial', lead);

// 2) El job de SLA corre (poll cada 1 min) y encuentra el lead vencido → reasigna a la pareja.
console.log('\n>>> El job de SLA corre (Enrique NO confirmó a tiempo)...');
await processExpiredAssignments(new Date());
flushLog();
printState('Tras 1ª reasignación (pareja de dupla A)', lead);

// 3) Oriana tampoco confirma a tiempo → el job vuelve a correr → pasa a dupla B.
lead.assignedAt = overdueAt();
lead.slaDueAt = new Date(Date.now() - 60000);
console.log('\n>>> El job de SLA corre otra vez (Oriana tampoco confirmó)...');
await processExpiredAssignments(new Date());
flushLog();
printState('Tras 2ª reasignación (siguiente dupla: B)', lead);

// 4) La asesora de la dupla B SÍ confirma (comando ATIENDO real) — se retrasa el
// assignedAt 2 min para ilustrar un tiempo de respuesta real (no instantáneo).
lead.assignedAt = new Date(Date.now() - 2 * 60000);
console.log(`\n>>> ${lead.assignedAdvisor} confirma con ATIENDO ${lead.ticketNumber} (2 min después de asignada)...`);
await handleOxfordAdvisorCommand({
  from: ADVISORS[Object.entries(ADVISORS).find(([, a]) => a.nombre === lead.assignedAdvisor)[0]].whatsapp,
  id: 'wamid.demo', type: 'text', text: { body: `ATIENDO ${lead.ticketNumber}` },
});
flushLog();
printState('Tras confirmación (ATIENDO)', lead);

console.log(`\n${'='.repeat(72)}`);
console.log('VISIBILIDAD EN GOOGLE SHEETS (feature/ori-advisor-sla, esta sesión)');
console.log('='.repeat(72));
printSheetTable('fila del lead, upsert por Ticket', 'Tiempos asesores');
printSheetTable('recalculado desde el detalle, upsert por Asesora', 'Resumen asesoras');

console.log(`\n${'='.repeat(72)}`);
console.log('RESUMEN: tiempos por asesora en esta cadena');
console.log('='.repeat(72));
for (const a of lead.advisorAttempts) {
  const label = a.result === 'confirmo' ? '✅ confirmó' : a.result === 'no_confirmo' ? '❌ no confirmó (venció SLA)' : '⏳ esperando';
  console.log(`  ${a.advisor.padEnd(18)} ${label}`);
}
console.log(`\nTotal de reasignaciones: ${lead.reassignCount}`);
console.log(`Confirmó: ${lead.assignedAdvisor} en ${(lead.responseSeconds / 60).toFixed(1)} min (medido desde SU asignación, no desde el inicio de la cadena)`);
console.log('El PROSPECTO nunca se enteró de las reasignaciones (0 mensajes salientes hacia el prospecto en esta simulación).');

process.exit(0);
