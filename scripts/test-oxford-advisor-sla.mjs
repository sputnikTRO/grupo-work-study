/**
 * Test de regresión del SLA de confirmación de asesor de Ori (feature/ori-advisor-sla).
 *
 * Ejercita el COMANDO real (handleOxfordAdvisorCommand, el mismo entry point que
 * usa oxford-webhook.js) para ATIENDO, y el WORKER real (processExpiredAssignments/
 * reassignOneLead, las mismas funciones que llama src/jobs/advisor-sla.job.js) —
 * no solo helpers internos, por la misma razón que test-oxford-handler.mjs existe:
 * el bug de scope pasado se coló porque nadie corría el handler/comando real.
 *
 * Infra mockeada (DB vía un fake prisma en memoria, WhatsApp, logger, env);
 * advisor-zones.js (ADVISORS/DUPLAS/advisorByPhone) y toda la lógica de
 * advisor-sla.js/advisor-notify.js/advisor-commands.js corren REALES.
 *
 * Requiere: node --experimental-test-module-mocks
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const SENT = [];           // { to, text }
const TEMPLATES_SENT = []; // { to, name, params }
const SLA_MINUTES = 10;

// ── Fake Google Sheets (Map en memoria: sheetName → filas, fila 0 = header) ──
// Sin esto, advisor-sla-sheet.js (nuevo, importado transitivamente por
// advisor-commands.js/advisor-sla.js) intentaría pegarle a la API real de
// Google con credenciales inexistentes — el fallback seguro lo atraparía en
// silencio, pero entonces NUNCA se probaría la escritura real.
let SHEETS = new Map();

/**
 * Limpia las FILAS DE DATOS pero conserva el header de cada tab que ya exista.
 * IMPORTANTE: advisor-sla-sheet.js cachea `detailReady`/`summaryReady` a nivel
 * de módulo (mismo patrón que `sheetReady` en sheets-sync.js — legítimo en
 * producción, un Sheet real no se "resetea" a mitad de proceso). Si aquí
 * reemplazáramos SHEETS por un Map() vacío, el módulo seguiría pensando que ya
 * aseguró el header (cache aún en `true`) y nunca lo volvería a escribir,
 * dejando el fake Sheets sin header — justo el bug que este comentario
 * documenta haber encontrado. Conservar el header replica el comportamiento
 * real y respeta esa caché tal como está diseñada.
 */
function resetSheets() {
  for (const [name, rows] of SHEETS) {
    SHEETS.set(name, rows.length > 0 ? [rows[0]] : []);
  }
}

function colLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Replica el comportamiento REAL de Sheets con valueInputOption 'USER_ENTERED':
 * un apóstrofo inicial fuerza texto pero NO forma parte del contenido guardado
 * — Sheets lo quita al escribir. Sin esto, el fake guardaría "'9001" literal en
 * vez de "9001", y findRowByColumn nunca matchearía un upsert posterior contra
 * el mismo valor sin apóstrofo (justo el truco que usa el ticket como texto).
 */
function coerceCell(v) {
  return typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
}

const fakeSheetsClient = {
  async sheetExists(_id, name) { return SHEETS.has(name); },
  async createSheet(_id, name) { if (!SHEETS.has(name)) SHEETS.set(name, []); return {}; },
  async appendRow(_id, name, rowData) {
    const rows = SHEETS.get(name) || [];
    rows.push(rowData.map(coerceCell));
    SHEETS.set(name, rows);
    return {};
  },
  async updateRow(_id, name, rowNumber, rowData) {
    const rows = SHEETS.get(name) || [];
    rows[rowNumber - 1] = rowData.map(coerceCell); // rowNumber es 1-indexed (fila 1 = header)
    SHEETS.set(name, rows);
    return {};
  },
  async findRowByColumn(_id, name, columnIndex, searchValue) {
    const rows = SHEETS.get(name) || [];
    for (let i = 1; i < rows.length; i++) { // salta el header (fila 0)
      if (rows[i][columnIndex] === searchValue) return i + 1; // 1-indexed
    }
    return null;
  },
  async updateRange(_id, range, values) {
    const m = range.match(/^'([^']+)'!([A-Z]+)(\d+):([A-Z]+)\d+$/);
    const [, name, startColLetter] = m;
    const rows = SHEETS.get(name) || [];
    if (!rows[0]) rows[0] = [];
    const startIdx = colLetterToIndex(startColLetter);
    values[0].forEach((v, i) => { rows[0][startIdx + i] = v; });
    SHEETS.set(name, rows);
    return {};
  },
  async readRange(_id, range) {
    const m = range.match(/^'([^']+)'!(\d+):(\d+)$/);
    if (!m) return [];
    const [, name, r1] = m;
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

// ── Fake DB (Map en memoria) ────────────────────────────────────────────────
let DB = new Map();
let nextTicket = 1;
let nextId = 1;

function resetDB() {
  DB = new Map();
  nextTicket = 1;
  nextId = 1;
}

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
      if (!row) throw new Error(`fakePrisma.update: no existe id=${where.id}`);
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

// ── Mocks de infraestructura ─────────────────────────────────────────────────
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/core/database/client.js', { defaultExport: fakePrisma });
// Objeto MUTABLE (no un literal nuevo cada vez) — se referencia después en el
// escenario 8 para prender/apagar OXED_ADVISOR_SLA_TEMPLATE en caliente y
// confirmar que advisor-notify.js lee el valor vigente en cada llamada.
const envMock = {
  OXED_ADVISOR_SLA_MINUTES: SLA_MINUTES,
  OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford',
  OXED_ADVISOR_TEMPLATE_LANG: 'es_MX',
  OXED_ADVISOR_SLA_TEMPLATE: '', // vacía por default — igual que en prod hasta que Meta apruebe
};
mock.module('../src/config/env.js', { namedExports: { env: envMock } });
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { SENT.push({ to, text }); },
    sendTemplateMessage: async (to, name, _lang, params) => { TEMPLATES_SENT.push({ to, name, params }); },
  },
});
mock.module('../src/core/sheets/client.js', { namedExports: fakeSheetsClient });

const { handleOxfordAdvisorCommand } = await import('../src/units/oxford-education/advisor-commands.js');
const { ADVISORS } = await import('../src/units/oxford-education/advisor-zones.js');
const { buildAssignmentFields, nextAdvisorCandidateKey, processExpiredAssignments, reassignOneLead } =
  await import('../src/units/oxford-education/advisor-sla.js');
const { notifyAdvisor } = await import('../src/units/oxford-education/advisor-notify.js');

/** Llama a notifyAdvisor directo (sin pasar por el handoff completo) para el escenario 8. */
async function notifyAdvisorDirect(lead, advisorKey) {
  await notifyAdvisor(ADVISORS[advisorKey], lead, null, lead.contact, 'motivo de prueba', lead.zoneKey, logger);
}

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };

// ── Helpers de fixtures ──────────────────────────────────────────────────────

function makeLead(overrides = {}) {
  const id = `lead-${nextId++}`;
  const lead = {
    id,
    contactId: 'c1',
    contact: { id: 'c1', name: null, phone: '+5215500000001' },
    leadType: 'b2c_individual',
    fullName: 'Prospecto Test',
    institutionName: null,
    state: 'CDMX',
    municipality: 'Coyoacán', // → dupla A
    zoneKey: 'A',
    primaryProduct: null,
    status: 'derivado_asesor',
    ticketNumber: overrides.ticketNumber ?? nextTicket++,
    assignedAdvisor: null,
    assignedAt: null,
    confirmedAt: null,
    responseSeconds: null,
    slaDueAt: null,
    currentAttempt: 0,
    reassignCount: 0,
    triedAdvisorKeys: [],
    advisorAttempts: [],
    notes: null,
    tags: [],
    ...overrides,
  };
  DB.set(id, lead);
  return lead;
}

/** Asigna con la MISMA función que usa actions.js al derivar (buildAssignmentFields real). */
function assignAdvisor(lead, advisorKey, at) {
  const advisor = ADVISORS[advisorKey];
  const fields = buildAssignmentFields(lead, advisor, at);
  Object.assign(lead, { assignedAdvisor: advisor.nombre, ...fields });
  return lead;
}

function overdueAssignAt() {
  return new Date(Date.now() - (SLA_MINUTES + 1) * 60000); // vencido: hace más de OXED_ADVISOR_SLA_MINUTES
}

function msgFrom(advisorWhatsapp, text) {
  return { from: advisorWhatsapp, id: `wamid.${Math.random()}`, type: 'text', text: { body: text } };
}

// ============================================================================
// 1) ATIENDO del asesor asignado: confirma + registra tiempo + neutraliza el job
// ============================================================================
console.log('\n== 1. ATIENDO del asesor asignado ==');
resetDB();
{
  const lead = makeLead({});
  assignAdvisor(lead, 'enrique', new Date(Date.now() - 3 * 60000)); // asignado hace 3 min

  SENT.length = 0;
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.enrique.whatsapp, `ATIENDO ${lead.ticketNumber}`));

  assert.ok(SENT.some((m) => m.text.includes('Confirmado') && m.text.includes(`#${lead.ticketNumber}`)), 'ack de confirmación enviado');
  assert.ok(lead.confirmedAt, 'confirmedAt quedó registrado');
  assert.strictEqual(lead.status, 'en_atencion', 'status pasó a en_atencion');
  assert.ok(lead.responseSeconds >= 170 && lead.responseSeconds <= 190, `responseSeconds ~180s (fue ${lead.responseSeconds})`);
  ok('ATIENDO confirma, registra responseSeconds y pasa a en_atencion');

  // "neutraliza el job": una barrida de SLA después de esto NO debe tocar este lead
  // (ya no está 'derivado_asesor', y confirmedAt no es null → la query ni lo trae).
  SENT.length = 0;
  const result = await processExpiredAssignments(new Date());
  assert.strictEqual(result.found, 0, 'el job de SLA ya no encuentra este lead (confirmado)');
  assert.strictEqual(SENT.length, 0, 'ninguna notificación de reasignación tras confirmar');
  ok('Tras confirmar, el job de SLA no actúa sobre este lead (neutralizado)');

  // ATIENDO sin ticket también funciona cuando hay un único pendiente.
  const lead2 = makeLead({});
  assignAdvisor(lead2, 'enrique', new Date());
  SENT.length = 0;
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.enrique.whatsapp, 'ATIENDO'));
  assert.ok(lead2.confirmedAt, 'ATIENDO sin ticket confirma el único lead pendiente');
  ok('ATIENDO sin número de ticket confirma el único lead pendiente del asesor');
}

// ============================================================================
// 2) ATIENDO de un asesor NO asignado se rechaza
// ============================================================================
console.log('\n== 2. ATIENDO de un asesor no asignado ==');
resetDB();
{
  const lead = makeLead({});
  assignAdvisor(lead, 'enrique', new Date());

  SENT.length = 0;
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.oriana.whatsapp, `ATIENDO ${lead.ticketNumber}`));

  assert.ok(SENT.some((m) => m.text.includes('no está asignado a ti')), 'rechazo con mensaje claro');
  assert.strictEqual(lead.confirmedAt, null, 'confirmedAt sigue null (no se rompió nada)');
  assert.strictEqual(lead.assignedAdvisor, 'Enrique Ruiz', 'assignedAdvisor no cambió');
  ok('ATIENDO de un asesor no asignado se rechaza sin romper el lead');
}

// ============================================================================
// 3) El worker reasigna a la PAREJA de la dupla si no hay confirmación
// ============================================================================
console.log('\n== 3. Reasignación a la pareja de dupla ==');
resetDB();
let chainLead; // se reutiliza en los escenarios 4/5/6 (cadena completa)
{
  chainLead = makeLead({ zoneKey: 'A' });
  assignAdvisor(chainLead, 'enrique', overdueAssignAt());

  SENT.length = 0;
  TEMPLATES_SENT.length = 0;
  await processExpiredAssignments(new Date());

  assert.strictEqual(chainLead.assignedAdvisor, 'Oriana Pullas', 'reasignado a la pareja de dupla A (Oriana)');
  assert.strictEqual(chainLead.reassignCount, 1);
  assert.deepStrictEqual(chainLead.triedAdvisorKeys, ['enrique', 'oriana']);
  assert.strictEqual(chainLead.advisorAttempts[0].result, 'no_confirmo', 'intento de Enrique marcado no_confirmo');
  assert.strictEqual(chainLead.advisorAttempts[1].result, 'esperando', 'nuevo intento de Oriana en esperando');
  assert.ok(SENT.some((m) => m.text.includes('ya no requiere tu atención')), 'aviso breve al asesor anterior (Enrique)');
  ok('Sin confirmación → reasigna a la pareja de la dupla (Enrique → Oriana)');
}

// ============================================================================
// 4) Si la pareja tampoco confirma, pasa a la SIGUIENTE dupla (B)
// ============================================================================
console.log('\n== 4. Pareja tampoco confirma → siguiente dupla (B) ==');
{
  chainLead.assignedAt = overdueAssignAt();
  chainLead.slaDueAt = new Date(Date.now() - 60000);

  await processExpiredAssignments(new Date());

  assert.strictEqual(chainLead.assignedAdvisor, 'Rosaura Pinto', 'pasa a la dupla B (primer asesor: Rosaura)');
  assert.strictEqual(chainLead.reassignCount, 2);
  ok('Pareja tampoco confirma → siguiente dupla en orden fijo (B: Rosaura)');
}

// ============================================================================
// 5) Salta a las ya intentadas (prueba directa del algoritmo puro)
// ============================================================================
console.log('\n== 5. nextAdvisorCandidateKey salta a los ya intentados ==');
{
  const next = nextAdvisorCandidateKey('A', ['enrique', 'oriana', 'rosaura']);
  assert.strictEqual(next, 'diana', 'salta rosaura (ya intentada) y da el siguiente de dupla B (Diana)');
  ok('nextAdvisorCandidateKey salta correctamente a los asesores ya intentados');
}

// ============================================================================
// 6) TERMINAL: se agotan las 8 asesoras sin confirmación
// ============================================================================
console.log('\n== 6. Terminal tras agotar TODAS las asesoras ==');
{
  // Ya van 3 intentos (enrique, oriana, rosaura) de los escenarios 3-4. Se
  // necesitan 5 reasignaciones más para agotar a las 5 asesoras restantes
  // (diana, alfredo, paola, gilberto, anamaria) → tried.length llega a 8, y UNA
  // vuelta MÁS (la 6ª) para que el job detecte que la 8ª tampoco confirmó y
  // recién ahí dispare el terminal (nextAdvisorCandidateKey ya no encuentra a
  // nadie sin intentar).
  for (let i = 0; i < 6; i++) {
    chainLead.assignedAt = overdueAssignAt();
    chainLead.slaDueAt = new Date(Date.now() - 60000);
    await processExpiredAssignments(new Date());
  }

  assert.strictEqual(chainLead.triedAdvisorKeys.length, 8, 'las 8 asesoras fueron intentadas');
  assert.strictEqual(chainLead.status, 'sin_confirmar', 'terminal: status sin_confirmar');
  ok('Tras agotar las 8 asesoras, el lead queda sin_confirmar (terminal)');

  // Una barrida MÁS no debe hacer nada (no bucle infinito): la query ya no lo trae.
  SENT.length = 0;
  const result = await processExpiredAssignments(new Date());
  assert.strictEqual(result.found, 0, 'ya no se vuelve a encontrar (status ya no es derivado_asesor)');
  assert.strictEqual(SENT.length, 0, 'sin más notificaciones — no hay bucle infinito');
  ok('Barrida adicional tras el terminal: sin acción, sin bucle infinito');
}

// ============================================================================
// 7) CARRERA: confirma justo cuando el job se dispara → sin doble asignación
// ============================================================================
console.log('\n== 7. Carrera: confirmación vs. job de reasignación ==');
resetDB();
{
  const lead = makeLead({ zoneKey: 'A' });
  assignAdvisor(lead, 'enrique', overdueAssignAt());

  // "Snapshot" que el job habría leído ANTES de la confirmación.
  const staleSnapshot = { ...lead };

  // El asesor confirma DE VERDAD (comando real) — muta la fila real.
  SENT.length = 0;
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.enrique.whatsapp, `ATIENDO ${lead.ticketNumber}`));
  assert.strictEqual(lead.status, 'en_atencion', 'confirmación real aplicó primero');

  // El job actúa sobre el snapshot VIEJO (currentAttempt/confirmedAt de ANTES).
  // El guard condicional debe ver que la fila REAL ya cambió y no reasignar.
  SENT.length = 0;
  TEMPLATES_SENT.length = 0;
  await reassignOneLead(staleSnapshot, new Date(), logger);

  assert.strictEqual(lead.assignedAdvisor, 'Enrique Ruiz', 'NO se reasignó — sigue con quien confirmó');
  assert.strictEqual(lead.reassignCount, 0, 'reassignCount no se incrementó');
  assert.strictEqual(SENT.length, 0, 'ninguna notificación de reasignación (sin doble asignación)');
  assert.strictEqual(TEMPLATES_SENT.length, 0, 'ninguna plantilla de reasignación enviada');
  ok('Carrera confirmar-vs-job: el guard condicional evita la doble asignación');
}

// ============================================================================
// 8) OXED_ADVISOR_SLA_TEMPLATE configurable — sin romper el fallback existente
// ============================================================================
console.log('\n== 8. Plantilla del SLA configurable (nuevo_lead_oxford_sla) ==');
resetDB();
{
  // 8a) Sin configurar (default de prod hasta que Meta apruebe) → usa la
  // plantilla base de siempre. Cero cambio de comportamiento.
  envMock.OXED_ADVISOR_SLA_TEMPLATE = '';
  const lead = makeLead({ zoneKey: 'A' });
  TEMPLATES_SENT.length = 0;
  assignAdvisor(lead, 'enrique', new Date());
  await notifyAdvisorDirect(lead, 'enrique');
  assert.strictEqual(TEMPLATES_SENT.at(-1).name, 'nuevo_lead_oxford', 'sin OXED_ADVISOR_SLA_TEMPLATE → sigue usando la plantilla base');
  ok('OXED_ADVISOR_SLA_TEMPLATE vacía → usa nuevo_lead_oxford (comportamiento actual intacto)');

  // 8b) Configurada (Meta ya aprobó) → usa la plantilla nueva.
  envMock.OXED_ADVISOR_SLA_TEMPLATE = 'nuevo_lead_oxford_sla';
  TEMPLATES_SENT.length = 0;
  await notifyAdvisorDirect(lead, 'enrique');
  assert.strictEqual(TEMPLATES_SENT.at(-1).name, 'nuevo_lead_oxford_sla', 'con OXED_ADVISOR_SLA_TEMPLATE seteada → usa la plantilla nueva');
  ok('OXED_ADVISOR_SLA_TEMPLATE seteada → usa nuevo_lead_oxford_sla');

  envMock.OXED_ADVISOR_SLA_TEMPLATE = ''; // restaurar default para no afectar otras corridas
}

// ============================================================================
// 9) Pestañas de tiempos: confirmar escribe la fila de detalle correcta
// ============================================================================
console.log('\n== 9. ATIENDO escribe la fila de detalle correcta ==');
resetDB();
resetSheets();
{
  const lead = makeLead({ zoneKey: 'A' });
  assignAdvisor(lead, 'enrique', new Date(Date.now() - 3 * 60000)); // hace 3 min

  SENT.length = 0;
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.enrique.whatsapp, `ATIENDO ${lead.ticketNumber}`));

  const detailRows = SHEETS.get('Tiempos asesores');
  assert.ok(detailRows && detailRows.length >= 2, 'la pestaña "Tiempos asesores" se creó con al menos header + 1 fila');
  const row = detailRows.slice(1).find((r) => r[0] === `${lead.ticketNumber}`); // sin apóstrofo: Sheets lo quita al guardar como texto forzado
  assert.ok(row, 'se encontró la fila del ticket confirmado');
  assert.strictEqual(row[5], 'Enrique Ruiz', 'columna F = asesora que atendió');
  const minutos = parseFloat(row[6]);
  assert.ok(minutos >= 2.9 && minutos <= 3.1, `columna G = minutos hasta confirmar ~3 (fue ${minutos})`);
  assert.strictEqual(row[9], 'Atendido', 'columna J = estado final');
  ok('ATIENDO escribe fila de detalle con asesora y minutos correctos');
}

// ============================================================================
// 10) Upsert por ticket: un segundo evento ACTUALIZA, no duplica
// ============================================================================
console.log('\n== 10. Segundo evento sobre el mismo ticket actualiza, no duplica ==');
{
  const lead = makeLead({ zoneKey: 'A', ticketNumber: 9001 });
  assignAdvisor(lead, 'enrique', new Date());

  const { recordAdvisorSlaOutcome } = await import('../src/units/oxford-education/advisor-sla-sheet.js');

  await recordAdvisorSlaOutcome({ ...lead, responseSeconds: 60, status: 'en_atencion' }, lead.contact);
  await recordAdvisorSlaOutcome({ ...lead, responseSeconds: 600, status: 'en_atencion' }, lead.contact); // "segundo evento"

  const detailRows = SHEETS.get('Tiempos asesores');
  const matches = detailRows.slice(1).filter((r) => r[0] === `${lead.ticketNumber}`); // sin apóstrofo: Sheets lo quita al guardar como texto forzado
  assert.strictEqual(matches.length, 1, 'sigue habiendo UNA sola fila para ese ticket (no se duplicó)');
  assert.strictEqual(parseFloat(matches[0][6]), 10, 'la fila refleja el valor del segundo evento (10 min), no el primero');
  ok('Segundo evento sobre el mismo ticket actualiza la fila existente en vez de duplicarla');
}

// ============================================================================
// 11) Terminal (sin_confirmar) también escribe fila de detalle
// ============================================================================
console.log('\n== 11. Terminal (sin_confirmar) escribe fila con "—" y estado correcto ==');
resetDB();
resetSheets();
{
  const lead = makeLead({ zoneKey: 'A' });
  assignAdvisor(lead, 'enrique', overdueAssignAt());
  // Ya va 1 intento (enrique). Se necesitan 7 reasignaciones más para agotar a
  // las 7 asesoras restantes (tried.length llega a 8) + 1 vuelta MÁS para que el
  // job detecte que la 8ª tampoco confirmó y recién ahí dispare el terminal.
  for (let i = 0; i < 8; i++) {
    lead.assignedAt = overdueAssignAt();
    lead.slaDueAt = new Date(Date.now() - 60000);
    await processExpiredAssignments(new Date());
  }
  assert.strictEqual(lead.status, 'sin_confirmar', 'precondición: terminal alcanzado');

  const detailRows = SHEETS.get('Tiempos asesores');
  const row = detailRows.slice(1).find((r) => r[0] === `${lead.ticketNumber}`); // sin apóstrofo: Sheets lo quita al guardar como texto forzado
  assert.ok(row, 'el terminal también escribió una fila de detalle');
  assert.strictEqual(row[5], '—', 'columna F = "—" (nadie confirmó)');
  assert.strictEqual(row[9], 'Sin confirmar', 'columna J = Sin confirmar');
  ok('Terminal (sin_confirmar) escribe fila de detalle con "—" y estado "Sin confirmar"');
}

// ============================================================================
// 12) Resumen por asesora: suma bien (2 leads de la misma asesora) + reasignados
// ============================================================================
console.log('\n== 12. Resumen por asesora agrega correctamente ==');
resetDB();
resetSheets();
{
  // Dos leads confirmados por Enrique: 2 min y 4 min → promedio 3, min 2, max 4.
  const leadA = makeLead({ zoneKey: 'A' });
  assignAdvisor(leadA, 'enrique', new Date(Date.now() - 2 * 60000));
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.enrique.whatsapp, `ATIENDO ${leadA.ticketNumber}`));

  const leadB = makeLead({ zoneKey: 'A' });
  assignAdvisor(leadB, 'enrique', new Date(Date.now() - 4 * 60000));
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.enrique.whatsapp, `ATIENDO ${leadB.ticketNumber}`));

  let summaryRows = SHEETS.get('Resumen asesoras');
  let enriqueRow = summaryRows.slice(1).find((r) => r[0] === 'Enrique Ruiz');
  assert.strictEqual(enriqueRow[1], '2', 'leads atendidos = 2');
  assert.strictEqual(parseFloat(enriqueRow[2]).toFixed(1), '3.0', 'promedio = (2+4)/2 = 3.0 min');
  assert.strictEqual(parseFloat(enriqueRow[3]).toFixed(1), '2.0', 'mínimo = 2.0 min');
  assert.strictEqual(parseFloat(enriqueRow[4]).toFixed(1), '4.0', 'máximo = 4.0 min');
  ok('Resumen agrega correctamente 2 leads de la misma asesora (count/promedio/min/max)');

  // Un tercer lead: Enrique no confirma → se reasigna a su pareja (Oriana), que sí confirma.
  const leadC = makeLead({ zoneKey: 'A' });
  assignAdvisor(leadC, 'enrique', overdueAssignAt());
  await processExpiredAssignments(new Date()); // reasigna a Oriana; Enrique queda "no_confirmo" en la cadena
  await handleOxfordAdvisorCommand(msgFrom(ADVISORS.oriana.whatsapp, `ATIENDO ${leadC.ticketNumber}`));

  summaryRows = SHEETS.get('Resumen asesoras');
  enriqueRow = summaryRows.slice(1).find((r) => r[0] === 'Enrique Ruiz');
  assert.strictEqual(enriqueRow[1], '2', 'a Enrique le sigue contando 2 leads ATENDIDOS (el 3º no lo confirmó él)');
  assert.strictEqual(enriqueRow[5], '1', '# Reasignado por no confirmar = 1 para Enrique');
  ok('Resumen distingue "leads atendidos" de "# reasignado por no confirmar" por asesora');
}

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
