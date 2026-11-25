/**
 * W&S OTCC — casos: aviso, horario, escalamiento Karen → Jorge, sin_confirmar,
 * comandos del equipo y capturas. Horas FIJAS (no depende del reloj).
 * Run: node --experimental-test-module-mocks scripts/test-ws-cases.mjs
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const ENV = {
  OXED_WS_ENABLED: true,
  OXED_WS_SUPPORT_CONTACTS: 'Karen Méndez|5528450167; Jorge Gil|9381091603',
  OXED_WS_SLA_MINUTES: 30, OXED_WS_SLA_HOURS: '1-5 08:00-16:00',
  OXED_WS_TEMPLATE: 'caso_ws_ox', OXED_WS_TEMPLATE_IMG: 'caso_ws_ox_img', OXED_WS_TEMPLATE_LANG: 'es_MX',
};
const CASES = []; const ATTS = []; const NOTIFS = []; const CMDS = []; const TPL = []; const TXT = []; const IMGS = [];
let WINDOW_OPEN = false;
const reset = () => { for (const a of [CASES, ATTS, NOTIFS, CMDS, TPL, TXT, IMGS]) a.length = 0; WINDOW_OPEN = false; ENV.OXED_WS_TEMPLATE = 'caso_ws_ox'; ENV.OXED_WS_TEMPLATE_IMG = 'caso_ws_ox_img'; ENV.OXED_WS_ENABLED = true; };

const matches = (c, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(c[k]);
    if ('lte' in v) return c[k] != null && c[k] <= v.lte;
    if ('not' in v) return c[k] !== v.not;
  }
  return c[k] === v;
});
const noop = () => {}; const logger = { info: noop, warn: noop, error: noop, debug: noop }; logger.child = () => logger;
mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/config/env.js', { namedExports: { env: ENV } });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${String(p).replace(/\D/g, '').slice(-10)}`) } });
mock.module('../src/core/database/client.js', {
  defaultExport: {
    supportCase: {
      create: async ({ data }) => { const c = { id: `case${CASES.length + 1}`, caseNumber: CASES.length + 1, attempts: [], triedKeys: [], createdAt: new Date(), ...data }; CASES.push(c); return { ...c }; },
      findUnique: async ({ where }) => { const c = CASES.find((x) => x.id === where.id || x.caseNumber === where.caseNumber); return c ? { ...c } : null; },
      findMany: async ({ where }) => CASES.filter((c) => matches(c, where)).map((c) => ({ ...c })),
      updateMany: async ({ where, data }) => { const c = CASES.find((x) => matches(x, where)); if (!c) return { count: 0 }; Object.assign(c, data); return { count: 1 }; },
      update: async ({ where, data }) => { const c = CASES.find((x) => x.id === where.id); Object.assign(c, data); return { ...c }; },
    },
    caseAttachment: {
      updateMany: async ({ where, data }) => { for (const a of ATTS) if (a.conversationId === where.conversationId && a.caseId == null) Object.assign(a, data); return {}; },
      findMany: async ({ where }) => ATTS.filter((a) => a.caseId === where.caseId),
      count: async ({ where }) => ATTS.filter((a) => a.caseId === where.caseId).length,
      update: async ({ where, data }) => { const a = ATTS.find((x) => x.id === where.id); if (data.forwardedTo?.push) a.forwardedTo = [...a.forwardedTo, data.forwardedTo.push]; return a; },
    },
    advisorNotification: { create: async ({ data }) => { NOTIFS.push(data); return data; } },
    advisorCommand: { create: async ({ data }) => { CMDS.push(data); return data; }, findFirst: async () => (WINDOW_OPEN ? { id: 'x' } : null) },
    oxfordLead: new Proxy({}, { get: () => { throw new Error('un comando W&S NO debe tocar leads comerciales'); } }),
  },
});
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { TXT.push({ to, text }); return { messages: [{ id: 'w.t' }] }; },
    sendTemplateMessage: async (to, name, lang, params) => { TPL.push({ to, name, params }); return { messages: [{ id: `w.${TPL.length}` }] }; },
    sendTemplateWithImage: async (to, name, lang, mediaId, params) => { TPL.push({ to, name, params, mediaId }); return { messages: [{ id: `w.${TPL.length}` }] }; },
    sendImageMessage: async (to, mediaId) => { IMGS.push({ to, mediaId }); },
    uploadMedia: async () => 'up-1',
  },
});
mock.module('../src/units/oxford-education/ws/cases-sheet.js', { namedExports: { syncCaseToSheet: async () => {} } });

const { createCase, processWsCases, deliverNewAttachment } = await import('../src/units/oxford-education/ws/cases.js');
const { handleWsSupportCommand, isWsSupportPhone } = await import('../src/units/oxford-education/ws/commands.js');

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };
const at = (iso) => new Date(`${iso}-06:00`); // hora CDMX
const KAREN = '5215528450167'; const JORGE = '5219381091603';
const draft = { fullName: 'Ana López', email: 'ana@correo.com', stage: 'Mock', description: 'No me llega\nel código del Mock' };
const conv = { id: 'conv1' }; const contact = { id: 'c1' };
const cmd = (from, body) => handleWsSupportCommand({ from, id: `w.${Math.random()}`, text: { body } }, at('2026-11-25T10:00'));

console.log('\n== Dentro de horario ==');
reset();
let c = await createCase({ conv, contact, phone: '+34612345678', draft, now: at('2026-11-24T10:00') });
assert.strictEqual(TPL.length, 1); assert.strictEqual(TPL[0].to, KAREN); assert.strictEqual(TPL[0].name, 'caso_ws_ox');
assert.strictEqual(TPL[0].params.length, 7); assert.ok(TPL[0].params.every((p) => !/[\n\t]/.test(p)), 'parámetros sin saltos de línea (Meta los rechaza)');
assert.strictEqual(CASES[0].status, 'asignado'); assert.strictEqual(CASES[0].slaDueAt.toISOString(), at('2026-11-24T10:30').toISOString());
assert.strictEqual(NOTIFS[0].kind, 'caso_ws'); assert.strictEqual(NOTIFS[0].ticketNumber, 1);
ok('caso dentro de horario → plantilla a Karen al momento, vence en 30 min');

console.log('\n== Fuera de horario y escalamiento ==');
reset();
c = await createCase({ conv, contact, phone: '+34612345678', draft, now: at('2026-11-24T21:00') });
assert.strictEqual(TPL.length, 0, 'de noche no se avisa');
assert.strictEqual(CASES[0].status, 'pendiente_aviso'); assert.strictEqual(CASES[0].notifyAt.toISOString(), at('2026-11-25T08:00').toISOString());
await processWsCases(at('2026-11-25T07:59'));
assert.strictEqual(TPL.length, 0);
await processWsCases(at('2026-11-25T08:00'));
assert.strictEqual(TPL.length, 1); assert.strictEqual(TPL[0].to, KAREN);
assert.strictEqual(CASES[0].slaDueAt.toISOString(), at('2026-11-25T08:30').toISOString(), 'los 30 min cuentan desde la apertura');
ok('fuera de horario → el aviso a Karen sale a las 8:00 del siguiente día hábil');

await processWsCases(at('2026-11-25T08:29'));
assert.strictEqual(TPL.length, 1);
await processWsCases(at('2026-11-25T08:30'));
assert.strictEqual(TPL.length, 2); assert.strictEqual(TPL[1].to, JORGE);
assert.strictEqual(CASES[0].assignedName, 'Jorge Gil'); assert.deepStrictEqual(CASES[0].triedKeys, ['ws1', 'ws2']);
assert.strictEqual(CASES[0].attempts[0].result, 'no_confirmo');
ok('Karen no responde en 30 min → se reasigna a Jorge Gil');

await processWsCases(at('2026-11-25T09:00'));
assert.strictEqual(CASES[0].status, 'sin_confirmar'); assert.strictEqual(TPL.length, 2, 'no se avisa a nadie más');
await processWsCases(at('2026-11-25T12:00'));
assert.strictEqual(TPL.length, 2); assert.strictEqual(TXT.length, 0);
ok('Jorge tampoco → sin_confirmar, sin más avisos a nadie');

await cmd(JORGE, 'Atiendo 1');
assert.strictEqual(CASES[0].status, 'atendiendo'); assert.strictEqual(CASES[0].confirmedBy, 'Jorge Gil');
assert.ok(TXT.at(-1).text.includes('es tuyo') && TXT.at(-1).text.includes('ana@correo.com'));
assert.strictEqual(CMDS.at(-1).scope, 'caso_ws'); assert.strictEqual(CMDS.at(-1).ticketNumber, 1);
await cmd(KAREN, 'ATIENDO 1');
assert.ok(TXT.at(-1).text.includes('ya lo atiende Jorge Gil'));
await cmd(KAREN, 'LISTO 1');
assert.strictEqual(CASES[0].status, 'resuelto');
ok('después, Jorge lo toma con ATIENDO; Karen ve quién lo atiende; LISTO lo cierra (sin tocar leads comerciales)');

console.log('\n== Capturas ==');
reset();
ATTS.push({ id: 'a1', caseId: null, conversationId: 'conv1', data: Buffer.from('x'), mimeType: 'image/png', forwardedTo: [] });
ATTS.push({ id: 'a2', caseId: null, conversationId: 'conv1', data: Buffer.from('y'), mimeType: 'image/png', forwardedTo: [] });
await createCase({ conv, contact, phone: '+34612345678', draft, now: at('2026-11-24T10:00') });
assert.strictEqual(TPL[0].name, 'caso_ws_ox_img'); assert.strictEqual(TPL[0].mediaId, 'up-1');
assert.ok(TPL[0].params[6].includes('2'), 'avisa cuántas capturas hay');
assert.strictEqual(IMGS.length, 0, 'con la ventana cerrada no se manda la imagen suelta');
await cmd(KAREN, 'ATIENDO 1');
assert.strictEqual(IMGS.length, 1, 'al responder ATIENDO le llega la captura que faltaba (no la del encabezado)');
assert.deepStrictEqual(ATTS.map((a) => a.forwardedTo), [['ws1'], ['ws1']]);
ok('con captura → plantilla con imagen en el encabezado; las demás llegan con ATIENDO');

console.log('\n== Sin plantilla aprobada ==');
reset(); ENV.OXED_WS_TEMPLATE = ''; ENV.OXED_WS_TEMPLATE_IMG = '';
await createCase({ conv, contact, phone: '+34612345678', draft, now: at('2026-11-24T10:00') });
assert.strictEqual(TPL.length + TXT.length, 0); assert.strictEqual(NOTIFS[0].via, 'error');
WINDOW_OPEN = true;
await createCase({ conv, contact, phone: '+34612345678', draft, now: at('2026-11-24T10:00') });
assert.strictEqual(TXT.length, 1); assert.ok(TXT[0].text.includes('Caso W&S · OTCC #2'));
ok('sin plantilla: texto libre solo con ventana abierta; si no, queda registrado como no enviado');

console.log('\n== Capturas que llegan DESPUÉS del aviso ==');
reset();
await createCase({ conv, contact, phone: '+34612345678', draft, now: at('2026-11-24T10:00') }); // sin captura → plantilla de texto
assert.strictEqual(TPL.at(-1).name, 'caso_ws_ox');
const nueva = { id: 'n1', caseId: 'case1', conversationId: 'conv1', data: Buffer.from('z'), mimeType: 'image/png', forwardedTo: [] };
ATTS.push(nueva);
let how = await deliverNewAttachment({ ...CASES[0] }, nueva);
assert.strictEqual(how, 'plantilla', 'ventana cerrada → plantilla con la imagen en el encabezado');
assert.strictEqual(TPL.at(-1).name, 'caso_ws_ox_img'); assert.strictEqual(TPL.at(-1).to, KAREN);
assert.ok(TPL.at(-1).params[6].includes('nueva captura'));
assert.deepStrictEqual(nueva.forwardedTo, ['ws1']);
ok('captura nueva con el caso asignado y ventana cerrada → le llega a Karen por plantilla con imagen');

WINDOW_OPEN = true;
const otra = { id: 'n2', caseId: 'case1', conversationId: 'conv1', data: Buffer.from('w'), mimeType: 'image/png', forwardedTo: [] };
ATTS.push(otra);
how = await deliverNewAttachment({ ...CASES[0] }, otra);
assert.strictEqual(how, 'enviada'); assert.strictEqual(IMGS.at(-1).to, KAREN);
ok('con la ventana abierta → imagen suelta al momento');

WINDOW_OPEN = false; ENV.OXED_WS_TEMPLATE_IMG = '';
const tercera = { id: 'n3', caseId: 'case1', conversationId: 'conv1', data: Buffer.from('v'), mimeType: 'image/png', forwardedTo: [] };
ATTS.push(tercera);
how = await deliverNewAttachment({ ...CASES[0] }, tercera);
assert.strictEqual(how, 'pendiente');
const imgsAntes = IMGS.length;
await cmd(KAREN, 'PENDIENTES');
assert.strictEqual(IMGS.length, imgsAntes + 1, 'al escribir Karen le llega la pendiente');
assert.deepStrictEqual(tercera.forwardedTo, ['ws1']);
ok('sin plantilla con imagen → queda pendiente y le llega en cuanto Karen escribe');

await cmd(JORGE, 'ATIENDO 1');
assert.strictEqual(CASES[0].confirmedBy, 'Jorge Gil');
assert.ok(IMGS.filter((i) => i.to === JORGE).length === 3, 'Jorge recibe las 3 capturas al tomar el caso');
ok('si el caso pasa a Jorge, recibe todas las capturas al tomarlo');

console.log('\n== Ruteo ==');
reset();
assert.ok(isWsSupportPhone('5215528450167') && isWsSupportPhone('529381091603'));
assert.ok(!isWsSupportPhone('5215532676181'), 'una asesora comercial no es contacto W&S');
ENV.OXED_WS_ENABLED = false;
assert.ok(!isWsSupportPhone('5215528450167'), 'apagado → no se enrutan sus mensajes');
ok('el webhook reconoce a Karen y Jorge (y nada si el modo está apagado)');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
