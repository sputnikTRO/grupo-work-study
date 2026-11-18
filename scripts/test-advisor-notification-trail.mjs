/**
 * Regresión del rastro de notificaciones a asesoras (wamid + status de Meta).
 *
 *   node --experimental-test-module-mocks scripts/test-advisor-notification-trail.mjs
 *
 * Corre el servicio REAL (services/advisor-notification.service.js) y el
 * notifyAdvisor REAL de Ori contra un Prisma en memoria. Cubre lo que la
 * auditoría de nov-2026 no pudo responder: qué se envió, con qué wamid, y si
 * Meta lo entregó o lo rechazó DESPUÉS de aceptarlo (p. ej. 131049).
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const rows = [];
const LOGS = [];
let failDb = false;
const prisma = {
  advisorNotification: {
    create: async ({ data }) => {
      if (failDb) throw new Error('relation "advisor_notifications" does not exist');
      const row = { id: `n${rows.length + 1}`, sentAt: null, deliveredAt: null, readAt: null, failedAt: null, errorCode: null, errorTitle: null, errorDetail: null, ...data };
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }) => {
      if (failDb) throw new Error('db caída');
      return rows.find((r) => r.waMessageId === where.waMessageId) || null;
    },
    update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
  },
};
const logger = {
  info: () => {}, debug: () => {}, warn: () => {},
  error: (obj, msg) => LOGS.push({ level: 'error', obj, msg }),
  child() { return this; },
};
mock.module('../src/core/database/client.js', { defaultExport: prisma });
mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/config/env.js', {
  namedExports: { env: { OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford', OXED_ADVISOR_SLA_TEMPLATE: 'nuevo_lead_oxford_sla', OXED_ADVISOR_TEMPLATE_LANG: 'es_MX', OXED_ADVISOR_SLA_MINUTES: 10 } },
});
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });

let templateBehavior = 'ok';
let wamidSeq = 0;
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTemplateMessage: async () => {
      if (templateBehavior !== 'ok') throw new Error('WhatsApp API error: (#132001) Template name does not exist');
      return { messages: [{ id: `wamid.TPL${++wamidSeq}` }] };
    },
    sendTextMessage: async () => {
      if (templateBehavior === 'all-fail') throw new Error('WhatsApp API error: timeout');
      return { messages: [{ id: `wamid.TXT${++wamidSeq}` }] };
    },
  },
});

const svc = await import('../src/services/advisor-notification.service.js');
const { notifyAdvisor } = await import('../src/units/oxford-education/advisor-notify.js');

let pass = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); pass++; };
const advisor = { key: 'rosaura', nombre: 'Rosaura Pinto', whatsapp: '5500000001' };
const contact = { phone: '+5215511112222', name: 'Prospecto' };
const lead = { id: 'L1', ticketNumber: 16, fullName: 'Prospecto', state: 'Jalisco', primaryProductLabel: 'Oxford TCC', reassignCount: 0 };
const ts = (s) => String(Math.floor(new Date(s).getTime() / 1000));

// 1) Envío por plantilla: queda el wamid, la vía y la plantilla.
await notifyAdvisor(advisor, lead, null, contact, 'pide precio', 'CENTRO', logger);
assert.strictEqual(rows.length, 1);
assert.deepStrictEqual(
  { unit: rows[0].unit, leadId: rows[0].leadId, ticket: rows[0].ticketNumber, advisor: rows[0].advisorName, via: rows[0].via, tpl: rows[0].templateName, status: rows[0].status, kind: rows[0].kind },
  { unit: 'oxford_education', leadId: 'L1', ticket: 16, advisor: 'Rosaura Pinto', via: 'template', tpl: 'nuevo_lead_oxford_sla', status: 'accepted', kind: 'nuevo_lead' },
);
assert.match(rows[0].waMessageId, /^wamid\.TPL/);
assert.strictEqual(rows[0].advisorPhone, '5215500000001');
ok('notifyAdvisor guarda wamid + plantilla + asesora (status accepted)');

// 2) sent → delivered → read avanza y guarda cada hora.
const w1 = rows[0].waMessageId;
await svc.applyStatusUpdates([{ id: w1, status: 'sent', timestamp: ts('2026-11-12T16:00:01Z') }, { id: w1, status: 'delivered', timestamp: ts('2026-11-12T16:00:03Z') }]);
assert.strictEqual(rows[0].status, 'delivered');
await svc.applyStatusUpdate({ id: w1, status: 'read', timestamp: ts('2026-11-12T16:05:00Z') });
assert.strictEqual(rows[0].status, 'read');
assert.ok(rows[0].sentAt && rows[0].deliveredAt && rows[0].readAt);
ok('status sent → delivered → read avanza y guarda sus horas');

// 3) Un status atrasado no retrocede el estado.
await svc.applyStatusUpdate({ id: w1, status: 'sent', timestamp: ts('2026-11-12T16:00:01Z') });
assert.strictEqual(rows[0].status, 'read');
ok('un "sent" atrasado no retrocede un "read"');

// 4) El caso de la auditoría: Meta ACEPTA y luego rechaza la entrega (131049).
await notifyAdvisor(advisor, { ...lead, id: 'L2', ticketNumber: 17, reassignCount: 1 }, null, contact, 'Reasignación automática — la asesora anterior no confirmó', 'CENTRO', logger);
const w2 = rows[1].waMessageId;
assert.strictEqual(rows[1].kind, 'reasignacion');
await svc.applyStatusUpdate({
  id: w2, status: 'failed', timestamp: ts('2026-11-12T17:00:00Z'),
  errors: [{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.', error_data: { details: 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.' } }],
});
assert.strictEqual(rows[1].status, 'failed');
assert.strictEqual(rows[1].errorCode, 131049);
assert.ok(rows[1].failedAt && rows[1].errorTitle && rows[1].errorDetail);
assert.ok(LOGS.some((l) => /NO se entregó/.test(l.msg) && l.obj.errorCode === 131049 && l.obj.ticket === 17), 'debe quedar una alerta en el log');
ok('status failed 131049 queda guardado con código y dispara alerta en el log');

// 5) failed es terminal: un delivered posterior no lo pisa.
await svc.applyStatusUpdate({ id: w2, status: 'delivered', timestamp: ts('2026-11-12T17:00:05Z') });
assert.strictEqual(rows[1].status, 'failed');
ok('"failed" es terminal');

// 6) Plantilla falla → texto libre: queda registrado que salió por texto.
templateBehavior = 'fail';
await notifyAdvisor(advisor, { ...lead, id: 'L3', ticketNumber: 18 }, null, contact, 'pide precio', 'CENTRO', logger);
assert.deepStrictEqual({ via: rows[2].via, tpl: rows[2].templateName }, { via: 'text', tpl: null });
assert.match(rows[2].waMessageId, /^wamid\.TXT/);
ok('si la plantilla falla, queda registrado que salió por TEXTO LIBRE');

// 7) No salió por ninguna vía (plantilla y texto fallan): queda send_error con el motivo.
templateBehavior = 'all-fail';
await notifyAdvisor(advisor, { ...lead, id: 'L5', ticketNumber: 20 }, null, contact, 'pide precio', 'CENTRO', logger);
const fallo = rows[rows.length - 1];
assert.deepStrictEqual({ leadId: fallo.leadId, via: fallo.via, status: fallo.status, wamid: fallo.waMessageId }, { leadId: 'L5', via: 'error', status: 'send_error', wamid: null });
assert.match(fallo.errorDetail, /timeout/);
ok('un envío que no salió por ninguna vía queda como send_error con el motivo');

// 8) Status de un mensaje a un prospecto (wamid desconocido) se ignora.
const snapshot = JSON.stringify(rows);
assert.strictEqual(await svc.applyStatusUpdate({ id: 'wamid.DE_UN_PROSPECTO', status: 'delivered', timestamp: ts('2026-11-12T18:00:00Z') }), null);
assert.strictEqual(JSON.stringify(rows), snapshot);
ok('status de wamid ajeno (mensaje a prospecto) se ignora');

// 9) La base caída NUNCA rompe el handoff ni el webhook.
failDb = true;
templateBehavior = 'ok';
await assert.doesNotReject(notifyAdvisor(advisor, { ...lead, id: 'L4', ticketNumber: 19 }, null, contact, 'pide precio', 'CENTRO', logger));
await assert.doesNotReject(svc.applyStatusUpdates([{ id: w1, status: 'read', timestamp: ts('2026-11-12T19:00:00Z') }]));
await assert.doesNotReject(svc.applyStatusUpdates(undefined));
failDb = false;
ok('con la base caída (o la tabla sin migrar) el handoff y el webhook siguen');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
