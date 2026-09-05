/**
 * Test de regresión del HANDLER de Ori (processWithAI vía handleMessage).
 *
 * Por qué existe: los 3 suites previos (warm-handoff, geo, unit) NO ejecutan
 * processWithAI —el warm-handoff llama a executeActions DIRECTO—, así que el
 * ReferenceError "reply is not defined" (handler.js:137, `reply` quedó
 * block-scoped dentro de if(!handoffOccurred)) nunca se corría en pruebas y llegó
 * a prod. Este test corre el handler REAL con todas sus dependencias stubbeadas
 * (sin DB/Redis/Meta/Claude) en los DOS caminos: sin handoff y con handoff.
 *
 * Detección del bug: si `reply` vuelve a quedar fuera de scope, la línea 137 tira
 * ReferenceError → el catch de handleMessage manda el fallback "problema técnico".
 * El test FALLA si ese fallback se envía en cualquiera de los dos caminos.
 *
 * Requiere: node --experimental-test-module-mocks (mock.module).
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const SENT = [];                 // todos los textos que Ori "envía"
const state = { handoff: false }; // controla el camino (executeActions mock)

const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

// ── Stubs de TODO lo que importa handler.js (paths relativos a scripts/) ──────
mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/core/whatsapp/parser.js', {
  namedExports: { extractMessageContent: (m) => ({ text: m.text?.body || 'hola', type: 'text', mediaUrl: null }) },
});
mock.module('../src/core/ai/claude.js', { namedExports: { chat: async () => 'Hola, con gusto te ayudo 😊' } });
mock.module('../src/services/contact.service.js', { namedExports: { findOrCreate: async () => ({ id: 'c1', name: 'Test' }) } });
mock.module('../src/services/conversation.service.js', {
  namedExports: { findActiveOrCreate: async () => ({ id: 'conv1', status: 'active' }), update: async (id, d) => ({ id, ...d }) },
});
mock.module('../src/services/message.service.js', {
  namedExports: { createInbound: async () => ({}), createOutbound: async () => ({}) },
});
mock.module('../src/units/oxford-education/lead.service.js', {
  namedExports: {
    findOrCreateOxfordLead: async () => ({ id: 'lead1', temperature: 'nuevo', status: 'nuevo' }),
    updateOxfordLead: async () => ({}),
    getOxfordLeadById: async () => ({ id: 'lead1', temperature: 'warm', status: 'nuevo' }),
  },
});
mock.module('../src/units/oxford-education/store.js', {
  namedExports: {
    acquireContactLock: async () => true,
    releaseContactLock: async () => {},
    getHistory: async () => [],
    formatForClaude: (h) => h,
    addMessage: async () => {},
  },
});
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (_to, text) => { SENT.push(text); },
    markMessageAsRead: async () => {},
  },
});
mock.module('../src/units/oxford-education/prompts.js', { namedExports: { buildFullPrompt: () => 'system' } });
mock.module('../src/units/oxford-education/knowledge.js', { namedExports: { buildOxfordKnowledge: async () => null, buildFlowKnowledge: async () => null } });
mock.module('../src/units/oxford-education/actions.js', {
  namedExports: {
    parseActions: () => [],
    cleanResponse: (r) => r,
    executeActions: async () => ({ handoffOccurred: state.handoff }),
    // buildLeadUpdate/executeHandoffToAdvisor: agregados por feature/ori-flow-redesign
    // — flow-engine.js (nuevo, importado por handler.js) también los toma de
    // actions.js. No los ejercita este test (ver mock de cache.js abajo: "Flujo
    // Ori" vacío → flujo determinístico deshabilitado → camino LLM puro, igual
    // que antes), pero el import estático de handler.js exige que el nombre
    // exista en el mock o el módulo no resuelve.
    buildLeadUpdate: () => null,
    executeHandoffToAdvisor: async () => ({ handedOff: false }),
  },
});
mock.module('../src/units/oxford-education/sheets-sync.js', {
  namedExports: { syncOxfordLeadToSheet: async () => {}, deriveTemperature: () => 'warm' },
});
// feature/ori-flow-redesign: handler.js ahora también importa flow-engine.js →
// flow-content.js → core/sheets/cache.js (Redis real). Sin este stub, este test
// golpearía un Redis real inexistente en CI. "Flujo Ori" vacío → loadFlowGraph()
// devuelve null → tryDeterministicFlow() → {handled:false} SIEMPRE → el turno cae
// íntegro en processWithAI, exactamente el comportamiento que este archivo prueba.
mock.module('../src/core/sheets/cache.js', {
  namedExports: { getOxfordFlowRows: async () => [] },
});

const { handleMessage } = await import('../src/units/oxford-education/handler.js');

const FALLBACK = 'problema técnico';
const msg = { from: '5215500000000', id: 'wamid.TEST', type: 'text', text: { body: 'hola' } };
let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };

// ── Caso 1: SIN handoff → Ori manda respuesta real, NADA de fallback ──────────
state.handoff = false; SENT.length = 0;
await handleMessage(msg, 'pnid');
assert.ok(SENT.some((t) => t.includes('con gusto te ayudo')), 'debió enviar la respuesta real de Ori');
assert.ok(!SENT.some((t) => t.includes(FALLBACK)), `NO debió enviar el fallback de error. Enviados: ${JSON.stringify(SENT)}`);
ok('Camino SIN handoff: envía respuesta real y NO el fallback (reply en scope)');

// ── Caso 2: CON handoff → sin ReferenceError, sin fallback ────────────────────
state.handoff = true; SENT.length = 0;
await handleMessage(msg, 'pnid');
assert.ok(!SENT.some((t) => t.includes(FALLBACK)), `Camino handoff NO debió tirar error → sin fallback. Enviados: ${JSON.stringify(SENT)}`);
ok('Camino CON handoff: reply="" no rompe la línea 137 (sin fallback de error)');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
