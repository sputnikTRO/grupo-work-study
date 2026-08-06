/**
 * Test de regresión: ORDEN de acciones en executeActions.
 *
 * Bug de prod (05-ago): cuando el modelo captura ubicación Y deriva en el MISMO
 * mensaje, parseActions ponía DERIVAR antes que CAPTURAR, así que el handoff
 * corría con el lead viejo (municipality=null) → resolveDupla fallaba → fallback
 * pasivo con link de HubSpot, en vez del handoff tibio de zona.
 *
 * Este test usa advisor-zones REAL (para que Xochimilco→dupla C funcione de
 * verdad) y mockea el resto (DB/Redis/WhatsApp). Valida que, con las acciones en
 * el orden que produce parseActions (DERIVAR primero), executeActions:
 *   - aplica la captura ANTES de derivar,
 *   - resuelve zona C y asigna asesor (Alfredo/Paola),
 *   - envía el mensaje TIBIO ("Te conecto con …"), NO el fallback ("Agenda aquí").
 *
 * Requiere: node --experimental-test-module-mocks
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const SENT = [];
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

// Todo lo de infra mockeado; advisor-zones queda REAL (lógica pura de zonas).
mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/config/env.js', { namedExports: { env: { OXED_FOREIGN_LEAD_FALLBACK: 'meeting_link' } } });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/core/database/client.js', {
  defaultExport: { oxfordLead: { groupBy: async () => [] } }, // round-robin → primer asesor
});
mock.module('../src/services/message.service.js', { namedExports: { createOutbound: async () => ({}) } });
mock.module('../src/units/oxford-education/lead.service.js', {
  namedExports: { updateOxfordLead: async () => ({}), getOxfordLeadById: async () => ({}) },
});
mock.module('../src/units/oxford-education/store.js', { namedExports: { addMessage: async () => {} } });
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: { sendTextMessage: async (_to, text) => { SENT.push(text); } },
});
mock.module('../src/units/oxford-education/prompts.js', {
  namedExports: { HANDOFF_MEETING_URL: 'https://meetings.hubspot.com/camila-serafin-jimenez/' },
});

const { parseActions, executeActions } = await import('../src/units/oxford-education/actions.js');

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };

// Reproduce el caso real: captura de alcaldía + derivación en el MISMO mensaje.
// parseActions emite DERIVAR antes que CAPTURAR (orden que causaba el bug).
const raw = '[DERIVAR_ASESOR:solicita cotizacion][CAPTURAR_DATO:state:CDMX][CAPTURAR_DATO:municipality:Xochimilco]';
const actions = parseActions(raw);
assert.strictEqual(actions[0].type, 'DERIVAR_ASESOR', 'parseActions sigue emitiendo DERIVAR primero (orden de entrada)');
ok('parseActions emite DERIVAR antes que CAPTURAR (orden de entrada intacto)');

const lead = { id: 'L1', state: null, municipality: null, leadType: 'b2b_institutional', assignedAdvisor: null, status: 'interesado' };
const conv = { id: 'C1' };
const contact = { phone: '+52115535305000', name: 'Rafael' };

const { handoffOccurred } = await executeActions(actions, lead, conv, contact);

assert.strictEqual(lead.municipality, 'Xochimilco', 'la alcaldía debió capturarse ANTES de derivar');
assert.strictEqual(lead.zoneKey, 'C', 'Xochimilco → dupla C');
assert.ok(['Alfredo Grados', 'Paola Torres'].includes(lead.assignedAdvisor), `asesor de dupla C asignado (fue: ${lead.assignedAdvisor})`);
ok(`Captura aplicada antes del handoff → zona C, asesor ${lead.assignedAdvisor}`);

assert.strictEqual(handoffOccurred, true, 'debió ocurrir handoff tibio real');
assert.ok(SENT.some((t) => t.includes('Te conecto con')), 'debió enviar el mensaje TIBIO de conexión');
assert.ok(!SENT.some((t) => t.includes('Agenda aquí') && t.includes('hubspot')), `NO debió enviar el fallback pasivo con link. Enviados: ${JSON.stringify(SENT)}`);
ok('Envía handoff tibio ("Te conecto con …"), NO el fallback con link de HubSpot');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
