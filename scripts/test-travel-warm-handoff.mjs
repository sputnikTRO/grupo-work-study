/**
 * Test de regresión: Miri (Travel) — HANDOFF TIBIO.
 *
 * Verifica que al derivar:
 *  (1) NO se pone la conversación en 'waiting_human' (Miri no se silencia),
 *      se notifica al asesor y handoffOccurred=true (se marca el lead derivado).
 *  (2) Guard anti-redisparo: si el lead ya está 'derivado_asesor', un nuevo
 *      DERIVAR devuelve handoffOccurred=false y NO re-notifica → el handler
 *      enviará el texto normal de Miri (no la silencia).
 *
 * Requiere: node --experimental-test-module-mocks
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const SENT = [];   // sendTextMessage (despedida)
const TPL = [];    // sendTemplateMessage (notificación asesor)
const CONV = [];   // conversationService.update payloads
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/core/database/client.js', { defaultExport: {} });
mock.module('../src/config/env.js', { namedExports: { env: { TRAVEL_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_travel', TRAVEL_ADVISOR_TEMPLATE_LANG: 'es_MX' } } });
mock.module('../src/core/sheets/cache.js', { namedExports: { getSchool: async () => null } });
mock.module('../src/services/lead.service.js', { namedExports: { updateTravelLead: async () => ({}), updateTravelLeadStatus: async () => ({}) } });
mock.module('../src/services/contact.service.js', { namedExports: {} });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/services/conversation.service.js', { namedExports: { update: async (_id, data) => { CONV.push(data); return {}; } } });
mock.module('../src/services/message.service.js', { namedExports: {} });
mock.module('../src/core/whatsapp/client.js', {
  namedExports: {
    sendTextMessage: async (_to, text) => { SENT.push(text); },
    sendTemplateMessage: async (_to, name) => { TPL.push(name); },
    sendMediaMessage: async () => {},
    sendMediaMessageByUrl: async () => {},
  },
});
mock.module('../src/core/ai/conversation.js', { namedExports: {} });
mock.module('../src/core/whatsapp/media-uploader.js', { namedExports: { getOrUploadMedia: async () => {}, getMimeType: () => '' } });

const { executeActions } = await import('../src/units/travel/actions.js');

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };
const reset = () => { SENT.length = 0; TPL.length = 0; CONV.length = 0; };

// ── (1) Handoff fresco: no silencia, notifica, marca derivado ─────────────────
reset();
const lead1 = { id: 'L1', status: 'contactado', assignedAdvisor: 'Camila Serafín', leadType: 'familia', parentName: 'Juan', travelerName: 'Pedro', travelerAge: 14, schoolCode: null, destination: 'Londres', ticketNumber: 50 };
const conv1 = { id: 'C1', interestScore: 8 };
const r1 = await executeActions([{ type: 'DERIVAR_ASESOR', reason: 'solicita precio' }], lead1, conv1, '+5215500000000', 'PNID');

assert.strictEqual(r1.handoffOccurred, true, 'handoff fresco → handoffOccurred=true');
assert.ok(!CONV.some((d) => d.status === 'waiting_human'), `NO debe ponerse waiting_human. CONV=${JSON.stringify(CONV)}`);
assert.strictEqual(lead1.status, 'derivado_asesor', 'el lead queda derivado_asesor (in-memory)');
assert.strictEqual(TPL.length, 1, 'se notifica al asesor (1 plantilla)');
assert.ok(SENT.some((t) => t.includes('aquí sigo para cualquier otra duda')), 'la despedida dice que Miri sigue disponible');
ok('(1) Handoff tibio: NO waiting_human, notifica al asesor, Miri sigue disponible');

// ── (2) Guard anti-redisparo: lead ya derivado → no re-notifica, no silencia ──
reset();
const lead2 = { id: 'L2', status: 'derivado_asesor', assignedAdvisor: 'Camila Serafín', leadType: 'familia', parentName: 'Ana', ticketNumber: 51 };
const conv2 = { id: 'C2', interestScore: 9 };
const r2 = await executeActions([{ type: 'DERIVAR_ASESOR', reason: 'vuelve a preguntar precio' }], lead2, conv2, '+5215511112222', 'PNID');

assert.strictEqual(r2.handoffOccurred, false, 'lead ya derivado → handoffOccurred=false (Miri responde su texto)');
assert.strictEqual(TPL.length, 0, 'NO re-notifica al asesor');
assert.strictEqual(SENT.length, 0, 'NO reenvía despedida');
assert.ok(!CONV.some((d) => d.status === 'waiting_human'), 'no toca la conversación');
ok('(2) Re-derivación: guard → sin re-notificar/duplicar, handoffOccurred=false');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
