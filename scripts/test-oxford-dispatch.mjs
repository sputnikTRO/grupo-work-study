/**
 * Reparto de la PRIMERA asesora y modo de aviso (chain | team) — fix/ori-atiendo-y-avisos.
 *
 *   node --experimental-test-module-mocks scripts/test-oxford-dispatch.mjs
 *
 * Corre executeHandoffToAdvisor REAL (actions.js + advisor-zones.js + advisor-sla.js
 * + advisor-notify.js) con la base, WhatsApp y Sheets mockeados.
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const SENT = [];       // { to, text }
const TEMPLATES = [];  // { to, params }
let LEADS = [];        // lo que devuelve prisma.oxfordLead.findMany (historial de la zona)
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;
const envMock = { OXED_FOREIGN_LEAD_FALLBACK: 'meeting_link', OXED_ADVISOR_SLA_MINUTES: 60, OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford', OXED_ADVISOR_TEMPLATE_LANG: 'es_MX' };

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/config/env.js', { namedExports: { env: envMock } });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/core/database/client.js', {
  defaultExport: {
    oxfordLead: {
      findMany: async ({ where = {}, take } = {}) => LEADS.filter((l) => !where.zoneKey || l.zoneKey === where.zoneKey).slice(0, take || 1000),
      groupBy: async () => [],
    },
  },
});
mock.module('../src/services/message.service.js', { namedExports: { createOutbound: async () => ({}) } });
mock.module('../src/units/oxford-education/lead.service.js', {
  namedExports: { updateOxfordLead: async () => ({}), getOxfordLeadById: async () => ({}), conditionalUpdateOxfordLead: async () => true },
});
mock.module('../src/units/oxford-education/store.js', { namedExports: { addMessage: async () => {} } });
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { SENT.push({ to, text }); return { messages: [{ id: 'wamid.t' }] }; },
    sendTemplateMessage: async (to, _name, _lang, params) => { TEMPLATES.push({ to, params }); return { messages: [{ id: `wamid.${TEMPLATES.length}` }] }; },
  },
});
mock.module('../src/units/oxford-education/prompts.js', { namedExports: { HANDOFF_MEETING_URL: 'https://example.test/agenda' } });
mock.module('../src/units/oxford-education/advisor-sla-sheet.js', { namedExports: { recordAdvisorSlaOutcome: async () => {} } });

const { executeHandoffToAdvisor } = await import('../src/units/oxford-education/actions.js');
const { ADVISORS } = await import('../src/units/oxford-education/advisor-zones.js');

let pass = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); pass++; };
const reset = () => { SENT.length = 0; TEMPLATES.length = 0; };
const contact = { phone: '+5215500001111', name: 'Prospecto' };
const conv = { id: 'C1' };
const newLead = (extra = {}) => ({ id: `L${Math.random()}`, ticketNumber: 30, state: 'Puebla', municipality: null, leadType: 'b2c_individual', assignedAdvisor: null, status: 'interesado', triedAdvisorKeys: [], advisorAttempts: [], currentAttempt: 0, tags: [], ...extra });
/** Un lead histórico de la zona, tal como queda tras recorrer la cadena completa. */
const historico = (zoneKey, firstKey, lastName, minutesAgo) => ({
  zoneKey, assignedAdvisor: lastName, createdAt: new Date(Date.now() - minutesAgo * 60000), assignedAt: new Date(),
  advisorAttempts: [{ advisor: ADVISORS[firstKey].nombre, advisorKey: firstKey, assignedAt: new Date(Date.now() - minutesAgo * 60000).toISOString(), result: 'no_confirmo' }],
});

console.log('\n== 1. Reparto por PRIMERA asignación (antes: siempre la primera de la lista) ==');
{
  // El estado real de prod: 6 leads de CENTRO, todos empezaron con Rosaura y
  // terminaron asignados a Paola Torres (última de la cadena).
  LEADS = [1, 2, 3, 4, 5, 6].map((i) => historico('CENTRO', 'rosaura', 'Paola Torres', i * 1000));
  reset();
  const lead = newLead();
  await executeHandoffToAdvisor(lead, conv, contact, 'pide precio');
  assert.strictEqual(lead.assignedAdvisor, 'Danna Paola', `Rosaura ya lleva 6 primeras asignaciones y Danna 0 → le toca a Danna (fue ${lead.assignedAdvisor})`);
  ok('Con 6 primeras asignaciones a Rosaura, el siguiente lead de CENTRO empieza con Danna');

  LEADS = [historico('CENTRO', 'rosaura', 'Paola Torres', 500), historico('CENTRO', 'danna', 'Paola Torres', 100)];
  const lead2 = newLead();
  await executeHandoffToAdvisor(lead2, conv, contact, 'pide precio');
  assert.strictEqual(lead2.assignedAdvisor, 'Rosaura Pinto', 'empate 1–1 → a quien le tocó hace más tiempo');
  ok('Empate en cantidad → le toca a quien recibió su último lead hace más tiempo');

  LEADS = ['enrique', 'mayra', 'silvana', 'enrique', 'mayra'].map((k, i) => historico('NORTE', k, 'Paola Torres', (10 - i) * 100));
  const lead3 = newLead({ state: 'Sonora' });
  await executeHandoffToAdvisor(lead3, conv, contact, 'pide precio');
  assert.strictEqual(lead3.assignedAdvisor, 'Oriana Pullas', 'equipo de 4: la que lleva 0');
  ok('Equipo de 4 (NORTE): rota entre las cuatro');

  LEADS = [];
  const lead4 = newLead();
  await executeHandoffToAdvisor(lead4, conv, contact, 'pide precio');
  assert.strictEqual(lead4.assignedAdvisor, 'Rosaura Pinto', 'sin historial → orden de la zona');
  ok('Sin historial → primera de la zona (orden estable)');
}

console.log('\n== 2. Modo chain (default): un aviso, una asesora ==');
{
  LEADS = [];
  reset();
  const lead = newLead({ state: 'Sonora' });
  const r = await executeHandoffToAdvisor(lead, conv, contact, 'pide precio');
  assert.strictEqual(r.handedOff, true);
  assert.strictEqual(TEMPLATES.length, 1, 'chain → una sola plantilla');
  assert.deepStrictEqual(lead.triedAdvisorKeys, ['enrique']);
  assert.ok(SENT.some((m) => m.text.includes('Te conecto con Enrique Ruiz')));
  ok('Sin flag (o chain): se avisa solo a la asesora asignada');
}

console.log('\n== 3. Modo team (OXED_ADVISOR_DISPATCH_MODE=team): aviso simultáneo al equipo ==');
{
  envMock.OXED_ADVISOR_DISPATCH_MODE = 'team';
  LEADS = [];
  reset();
  const lead = newLead({ state: 'Sonora' });
  const r = await executeHandoffToAdvisor(lead, conv, contact, 'pide precio');
  assert.strictEqual(r.handedOff, true);
  assert.strictEqual(TEMPLATES.length, 4, 'team → una plantilla por asesora de NORTE');
  assert.deepStrictEqual(TEMPLATES.map((t) => t.to.slice(-10)).sort(), ['enrique', 'mayra', 'silvana', 'oriana'].map((k) => ADVISORS[k].whatsapp.replace(/\D/g, '').slice(-10)).sort());
  assert.deepStrictEqual(lead.triedAdvisorKeys, ['enrique', 'mayra', 'silvana', 'oriana']);
  assert.ok(lead.advisorAttempts.length === 4 && lead.advisorAttempts.every((a) => a.result === 'esperando'));
  assert.strictEqual(lead.currentAttempt, 1);
  assert.ok(TEMPLATES.every((t) => /lo atiende la primera que responda ATIENDO/.test(String(t.params[7]))), 'el aviso explica que es simultáneo');
  assert.ok(SENT.some((m) => /nuestro equipo de asesores/.test(m.text)) && !SENT.some((m) => /Te conecto con Enrique/.test(m.text)), 'al prospecto no se le promete un nombre');
  ok('team: las 4 de NORTE reciben el aviso a la vez; el prospecto oye "nuestro equipo"');

  reset();
  const lead2 = newLead({ state: 'Quintana Roo' });
  await executeHandoffToAdvisor(lead2, conv, contact, 'pide precio');
  assert.strictEqual(TEMPLATES.length, 2, 'SUR tiene 2');
  ok('team respeta el tamaño de cada equipo (SUR: 2)');
  delete envMock.OXED_ADVISOR_DISPATCH_MODE;
}

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
