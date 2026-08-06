/**
 * Test de regresión: Miri (Travel) notifica al asesor por PLANTILLA aprobada.
 *
 * Motivo: los avisos al asesor eran texto libre → no se entregan fuera de la
 * ventana de 24h de WhatsApp. Ahora sendAdvisorNotification usa plantilla primero
 * (nuevo_lead_travel) con respaldo a texto. Este test mockea las dependencias de
 * travel/actions.js y ejercita executeActions con un DERIVAR (asesor ya asignado,
 * ruta determinista) para verificar que se envía la PLANTILLA con 9 params y el
 * phoneNumberId, y que NO se usa el texto de respaldo.
 *
 * Requiere: node --experimental-test-module-mocks
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const SENT = [];  // sendTextMessage
const TPL = [];   // sendTemplateMessage
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
mock.module('../src/services/conversation.service.js', { namedExports: { update: async () => ({}) } });
mock.module('../src/services/message.service.js', { namedExports: {} });
mock.module('../src/core/whatsapp/client.js', {
  namedExports: {
    sendTextMessage: async (_to, text) => { SENT.push(text); },
    sendTemplateMessage: async (to, name, lang, components, pnid) => { TPL.push({ to, name, lang, components, pnid }); },
    sendMediaMessage: async () => {},
    sendMediaMessageByUrl: async () => {},
  },
});
mock.module('../src/core/ai/conversation.js', { namedExports: {} });
mock.module('../src/core/whatsapp/media-uploader.js', { namedExports: { getOrUploadMedia: async () => {}, getMimeType: () => '' } });

const { executeActions } = await import('../src/units/travel/actions.js');

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };

const lead = {
  id: 'L1', assignedAdvisor: 'Camila Serafín', leadType: 'familia',
  parentName: 'Juan Pérez', travelerName: 'Pedro', travelerAge: 14,
  schoolCode: null, destination: 'Londres', ticketNumber: 99,
};
const conv = { id: 'C1', interestScore: 8 };

await executeActions([{ type: 'DERIVAR_ASESOR', reason: 'colegio no registrado solicita precio' }], lead, conv, '+5215500000000', 'PNID_TRAVEL');

assert.strictEqual(TPL.length, 1, 'debió enviarse exactamente 1 plantilla al asesor');
assert.strictEqual(TPL[0].name, 'nuevo_lead_travel', 'nombre de plantilla');
assert.strictEqual(TPL[0].lang, 'es_MX', 'idioma de plantilla');
assert.strictEqual(TPL[0].pnid, 'PNID_TRAVEL', 'se pasa el phoneNumberId de Travel');
const params = TPL[0].components?.[0]?.parameters || [];
assert.strictEqual(params.length, 9, `9 params de body (fueron: ${params.length})`);
assert.ok(params.every((p) => p.type === 'text' && typeof p.text === 'string' && p.text.length > 0), 'todos los params son texto no vacío');
ok('Notifica al asesor por PLANTILLA nuevo_lead_travel (9 params, es_MX, phoneNumberId correcto)');

assert.ok(!SENT.some((t) => t.includes('Nuevo lead #99')), `NO debió usarse el texto de respaldo. Enviados: ${JSON.stringify(SENT)}`);
ok('NO cae al texto de respaldo cuando la plantilla se envía');

assert.ok(SENT.some((t) => t.includes('Camila Serafín')), 'la despedida al prospecto (texto) sí se envía');
ok('La despedida al prospecto sigue enviándose por texto (sin cambios)');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
