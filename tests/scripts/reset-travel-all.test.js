/**
 * Tests de scripts/reset-travel-all.mjs + restore-travel-backup.mjs contra un
 * Postgres/Redis REALES de prueba (la transacción y el SCAN no se mockean bien).
 *
 * Requiere (si faltan, se saltan):
 *   RESET_TEST_DATABASE_URL  — el nombre de la base DEBE contener "test"
 *   RESET_TEST_REDIS_URL     — con índice de db distinto de 0 (p. ej. /9)
 *
 * Ejemplo con la infra de evals:
 *   docker exec gws-evals-postgres-1 psql -U eval -d gws_eval -c "CREATE DATABASE gws_reset_test"
 *   DATABASE_URL=postgresql://eval:eval@localhost:5440/gws_reset_test npx prisma db push --skip-generate
 *   RESET_TEST_DATABASE_URL=postgresql://eval:eval@localhost:5440/gws_reset_test \
 *   RESET_TEST_REDIS_URL=redis://localhost:6390/9 \
 *   node --test --test-force-exit tests/scripts/reset-travel-all.test.js
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DB_URL = process.env.RESET_TEST_DATABASE_URL;
const REDIS_URL = process.env.RESET_TEST_REDIS_URL;
const skip = !DB_URL || !REDIS_URL
  ? 'RESET_TEST_DATABASE_URL / RESET_TEST_REDIS_URL no definidas'
  : !/test/i.test(new URL(DB_URL).pathname)
    ? 'RESET_TEST_DATABASE_URL no apunta a una base *test*'
    : /\/0?$/.test(new URL(REDIS_URL).pathname)
      ? 'RESET_TEST_REDIS_URL debe usar un índice de db != 0'
      : false;

let prisma, redis, mod, restoreMod, tmp;
const PHONES = { A: '+5215511110001', B: '+5215522220002', C: '+5215533330003', D: '+5215544440004' };
let ids;

/** Hoja "Leads" en memoria, misma forma que el adaptador real. */
function fakeSheet(values) {
  return {
    values,
    async read() { return this.values.map((r) => [...r]); },
    async clearData() { this.values = [this.values[0]]; },
    async deleteRows(nums) {
      const drop = new Set(nums.map((n) => n - 1));
      this.values = this.values.filter((_r, i) => !drop.has(i));
    },
    async append(rows) { this.values.push(...rows); },
  };
}

async function seed() {
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.travelLead.deleteMany({});
  await prisma.oxfordLead.deleteMany({});
  await prisma.contact.deleteMany({});
  await redis.flushdb(); // db de prueba dedicada (índice != 0, verificado arriba)

  const c = {};
  for (const [k, phone] of Object.entries(PHONES)) {
    c[k] = await prisma.contact.create({ data: { phone, sourceUnit: k === 'C' ? 'oxford_education' : 'travel' } });
  }
  const conv = async (contact, unit, last, n, extra = {}) => {
    const cv = await prisma.conversation.create({
      data: { contactId: contact.id, unit, lastMessageAt: new Date(last), flowNode: 'menu_principal', metadata: { nudgedNode: 'menu_principal' }, ...extra },
    });
    for (let i = 0; i < n; i++) {
      await prisma.message.create({ data: { conversationId: cv.id, direction: i % 2 ? 'outbound' : 'inbound', senderType: i % 2 ? 'bot' : 'user', content: `m${i}` } });
    }
    return cv;
  };
  const convA = await conv(c.A, 'travel', '2026-10-01T10:00:00Z', 3);
  const convB = await conv(c.B, 'travel', '2026-10-10T10:00:00Z', 2);
  const convBox = await conv(c.B, 'oxford_education', '2026-10-11T10:00:00Z', 2);
  const convCox = await conv(c.C, 'oxford_education', '2026-10-12T10:00:00Z', 4);
  const convD = await conv(c.D, 'travel', '2026-10-14T10:00:00Z', 1);

  const leadA = await prisma.travelLead.create({ data: { contactId: c.A.id, status: 'derivado_asesor', assignedAdvisor: 'Ana' } });
  const leadB = await prisma.travelLead.create({ data: { contactId: c.B.id, status: 'nuevo' } });
  const leadC = await prisma.travelLead.create({ data: { contactId: c.C.id, status: 'derivado_asesor', notes: '[Vía Ori] Interés en English Life' } });
  await prisma.oxfordLead.create({ data: { contactId: c.C.id, tags: ['derivado_travel'] } });
  await prisma.oxfordLead.create({ data: { contactId: c.B.id } });

  const orphan = randomUUID();
  await redis.set(`conversation:history:${convA.id}`, '[{"role":"user"}]', 'EX', 3600);
  await redis.set(`conversation:history:${convB.id}`, '[]');
  await redis.set(`conversation:history:${convD.id}`, '[]');
  await redis.set(`conversation:history:${orphan}`, '[]'); // huérfano
  await redis.set(`conversation:history:${convBox.id}`, '[]'); // de una conv viva de Oxford → se queda
  await redis.set(`oxed:conversation:history:${convBox.id}`, '[]');
  await redis.set(`oxed:conversation:history:${convCox.id}`, '[]');
  await redis.set(`lock:contact:${PHONES.A}`, '1', 'EX', 30);
  await redis.set(`oxed:lock:contact:${PHONES.A}`, '1', 'EX', 30);
  await redis.set('sheets:cache:Leads', '{}');
  await redis.set('zoho:access_token', 'x');

  const sheet = fakeSheet([
    ['ID', 'Fecha', 'Nombre Padre'],
    [leadA.id, '2026-10-01', 'Equipo'],
    [leadB.id, '2026-10-10', 'Prospecto'],
    ['lead-viejo-ya-borrado', '2026-09-01', 'Viejo'],
  ]);
  ids = { c, convA, convB, convBox, convCox, convD, leadA, leadB, leadC, orphan };
  return sheet;
}

const opts = (extra = {}) => ({ confirm: true, sheet: false, includeOriHandoffs: false, onlyPhones: null, outDir: tmp, ...extra });
const quiet = () => {};

before(async () => {
  if (skip) return;
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  const Redis = (await import('ioredis')).default;
  redis = new Redis(REDIS_URL);
  mod = await import('../../scripts/reset-travel-all.mjs');
  restoreMod = await import('../../scripts/restore-travel-backup.mjs');
});
after(async () => { await prisma?.$disconnect(); redis?.disconnect(); });
beforeEach(() => { if (!skip) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-travel-')); });

test('maskPhone y parseArgs', { skip: false }, async () => {
  const m = await import('../../scripts/reset-travel-all.mjs');
  assert.equal(m.maskPhone('+5215512341234'), '55****1234');
  assert.equal(m.maskPhone('5512341234'), '55****1234');
  const o = m.parseArgs(['--confirm', '--only-phones=5511110001, +52 55 2222 0002', '--sheet', '--out=x']);
  assert.deepEqual(o, { confirm: true, sheet: true, includeOriHandoffs: false, onlyPhones: ['5511110001', '+52 55 2222 0002'], outDir: 'x' });
  assert.equal(m.parseArgs([]).confirm, false, 'dry-run por default');
  assert.throws(() => m.parseArgs(['--only-phones=123']));
  assert.throws(() => m.parseArgs(['--only-phones=']));
});

test('dry-run: cuenta bien y no borra nada', { skip }, async () => {
  const sheet = await seed();
  const plan = await mod.buildPlan({ prisma, redis, sheet, opts: opts({ confirm: false, sheet: true }) });
  assert.equal(plan.convIds.length, 3); // A, B, D (no las de Oxford)
  assert.equal(plan.messageCount, 6);
  assert.deepEqual(plan.leadIds.sort(), [ids.leadA.id, ids.leadB.id].sort()); // C es de Ori → se conserva
  assert.deepEqual(plan.keptOriLeads.map((l) => l.id), [ids.leadC.id]);
  assert.equal(plan.openTickets.length, 1);
  assert.deepEqual(plan.redisKeys.sort(), [
    `conversation:history:${ids.convA.id}`, `conversation:history:${ids.convB.id}`,
    `conversation:history:${ids.convD.id}`, `conversation:history:${ids.orphan}`,
    `lock:contact:${PHONES.A}`,
  ].sort());
  assert.equal(plan.sheetRows.rows.length, 3);
  assert.deepEqual(plan.people.map((p) => p.masked), ['55****0004', '55****0002', '55****0001'], 'más reciente primero');

  const lines = [];
  mod.printPlan(plan, opts(), (l) => lines.push(l));
  const out = lines.join('\n');
  assert.ok(!out.includes('5511110001') && !out.includes(PHONES.A), 'no imprime teléfonos completos');
  assert.match(out, /55\*\*\*\*0001 .* 2026-10-01 10:00Z/);

  assert.equal(await prisma.conversation.count(), 5, 'nada borrado');
  assert.equal(await prisma.travelLead.count(), 3);
});

test('--confirm total: borra travel, deja Oxford, Contact, llaves oxed:* y respaldo', { skip }, async () => {
  const sheet = await seed();
  const o = opts({ sheet: true });
  const plan = await mod.buildPlan({ prisma, redis, sheet, opts: o });
  const { backupFile, deleted } = await mod.execute({ prisma, redis, sheet, plan, opts: o, log: quiet });

  assert.deepEqual(deleted, { messages: 6, conversations: 3, travelLeads: 2, redisKeys: 5, sheetRows: 3 });
  assert.equal(await prisma.conversation.count({ where: { unit: 'travel' } }), 0);
  assert.equal(await prisma.conversation.count({ where: { unit: 'oxford_education' } }), 2);
  assert.equal(await prisma.message.count(), 6, 'mensajes de Oxford intactos');
  assert.equal(await prisma.contact.count(), 4, 'Contact nunca se borra');
  assert.equal(await prisma.oxfordLead.count(), 2);
  assert.deepEqual((await prisma.travelLead.findMany()).map((l) => l.id), [ids.leadC.id], 'lead de Ori se conserva');

  assert.equal(await redis.exists(`conversation:history:${ids.convA.id}`), 0);
  assert.equal(await redis.exists(`conversation:history:${ids.orphan}`), 0);
  assert.equal(await redis.exists(`lock:contact:${PHONES.A}`), 0);
  for (const k of [`conversation:history:${ids.convBox.id}`, `oxed:conversation:history:${ids.convBox.id}`,
    `oxed:conversation:history:${ids.convCox.id}`, `oxed:lock:contact:${PHONES.A}`, 'sheets:cache:Leads', 'zoho:access_token']) {
    assert.equal(await redis.exists(k), 1, `${k} debe seguir vivo`);
  }
  assert.deepEqual(sheet.values, [['ID', 'Fecha', 'Nombre Padre']], 'solo encabezados');

  assert.match(path.basename(backupFile), /^backup-travel-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
  const b = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  assert.equal(b.conversaciones.length, 3);
  assert.equal(b.mensajes.length, 6);
  assert.equal(b.travelLeads.length, 2);
  assert.equal(b.redis[`conversation:history:${ids.convA.id}`].value, '[{"role":"user"}]');
  assert.equal(b.sheet.rows.length, 3);
});

test('--only-phones: solo esos números (y solo su fila del Sheet)', { skip }, async () => {
  const sheet = await seed();
  const o = opts({ sheet: true, onlyPhones: ['55 1111 0001', '5599999999'] });
  const plan = await mod.buildPlan({ prisma, redis, sheet, opts: o });
  assert.deepEqual(plan.notFound, ['5599999999']);
  assert.deepEqual(plan.convIds, [ids.convA.id]);
  assert.deepEqual(plan.redisKeys.sort(), [`conversation:history:${ids.convA.id}`, `lock:contact:${PHONES.A}`].sort(), 'sin barrido de huérfanos');
  await mod.execute({ prisma, redis, sheet, plan, opts: o, log: quiet });

  assert.equal(await prisma.conversation.count({ where: { unit: 'travel' } }), 2);
  assert.equal(await prisma.travelLead.count({ where: { id: ids.leadA.id } }), 0);
  assert.equal(await prisma.travelLead.count(), 2);
  assert.equal(await redis.exists(`conversation:history:${ids.convB.id}`), 1);
  assert.equal(await redis.exists(`conversation:history:${ids.orphan}`), 1);
  assert.deepEqual(sheet.values.map((r) => r[0]), ['ID', ids.leadB.id, 'lead-viejo-ya-borrado']);
});

test('--include-ori-handoffs también borra el TravelLead creado por Ori', { skip }, async () => {
  const sheet = await seed();
  const o = opts({ includeOriHandoffs: true });
  const plan = await mod.buildPlan({ prisma, redis, sheet: null, opts: o });
  await mod.execute({ prisma, redis, sheet, plan, opts: o, log: quiet });
  assert.equal(await prisma.travelLead.count(), 0);
  assert.equal(await prisma.oxfordLead.count(), 2, 'OxfordLead intacto');
});

test('si el respaldo falla, no borra nada', { skip }, async () => {
  await seed();
  const blocker = path.join(tmp, 'soy-un-archivo');
  fs.writeFileSync(blocker, '');
  const o = opts({ outDir: path.join(blocker, 'sub') }); // mkdir falla: el padre es un archivo
  const plan = await mod.buildPlan({ prisma, redis, sheet: null, opts: o });
  await assert.rejects(mod.execute({ prisma, redis, sheet: null, plan, opts: o, log: quiet }));
  assert.equal(await prisma.conversation.count({ where: { unit: 'travel' } }), 3);
  assert.equal(await prisma.message.count(), 12);
  assert.equal(await redis.exists(`conversation:history:${ids.convA.id}`), 1);
});

test('si llega un mensaje entre plan y respaldo, el respaldo no cuadra y no borra', { skip }, async () => {
  await seed();
  const o = opts();
  const plan = await mod.buildPlan({ prisma, redis, sheet: null, opts: o });
  await prisma.message.create({ data: { conversationId: ids.convA.id, direction: 'inbound', senderType: 'user', content: 'tarde' } });
  await assert.rejects(mod.execute({ prisma, redis, sheet: null, plan, opts: o, log: quiet }), /NO se borró nada/);
  assert.equal(await prisma.message.count(), 13);
  assert.equal(await prisma.conversation.count({ where: { unit: 'travel' } }), 3);
});

test('si llega un mensaje entre respaldo y borrado, rollback completo', { skip }, async () => {
  await seed();
  const o = opts();
  const plan = await mod.buildPlan({ prisma, redis, sheet: null, opts: o });
  // Mensaje que entra DESPUÉS del respaldo, justo antes de abrir la transacción.
  const racy = new Proxy(prisma, {
    get(target, prop) {
      if (prop !== '$transaction') return Reflect.get(target, prop);
      return async (...args) => {
        await target.message.create({ data: { conversationId: ids.convA.id, direction: 'inbound', senderType: 'user', content: 'tarde' } });
        return target.$transaction(...args);
      };
    },
  });
  await assert.rejects(mod.execute({ prisma: racy, redis, sheet: null, plan, opts: o, log: quiet }), /rollback/);
  assert.equal(await prisma.conversation.count({ where: { unit: 'travel' } }), 3, 'conversaciones intactas');
  assert.equal(await prisma.message.count(), 13, 'mensajes intactos (los borrados dentro de la tx regresaron)');
  assert.equal(await prisma.travelLead.count(), 3);
  assert.equal(await redis.exists(`conversation:history:${ids.convA.id}`), 1, 'Redis no se tocó');
});

test('restore deja todo como estaba (ids, tickets, flowNode, Redis con TTL, Sheet)', { skip }, async () => {
  const sheet = await seed();
  const before = {
    convs: await prisma.conversation.findMany({ where: { unit: 'travel' }, orderBy: { id: 'asc' } }),
    leads: await prisma.travelLead.findMany({ orderBy: { id: 'asc' } }),
    msgs: await prisma.message.count(),
  };
  const o = opts({ sheet: true });
  const plan = await mod.buildPlan({ prisma, redis, sheet, opts: o });
  const { backupFile } = await mod.execute({ prisma, redis, sheet, plan, opts: o, log: quiet });

  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  const r = await restoreMod.restore({ prisma, redis, sheet, backup, log: quiet });
  assert.deepEqual(r, { travelLeads: 2, conversations: 3, messages: 6, redisKeys: 5, sheetRows: 3 });

  assert.deepEqual(await prisma.conversation.findMany({ where: { unit: 'travel' }, orderBy: { id: 'asc' } }), before.convs);
  assert.deepEqual(await prisma.travelLead.findMany({ orderBy: { id: 'asc' } }), before.leads);
  assert.equal(await prisma.message.count(), before.msgs);
  assert.equal(await redis.get(`conversation:history:${ids.convA.id}`), '[{"role":"user"}]');
  assert.ok((await redis.ttl(`conversation:history:${ids.convA.id}`)) > 0, 'TTL repuesto');
  assert.equal(sheet.values.length, 4);

  const again = await restoreMod.restore({ prisma, redis, sheet: null, backup, log: quiet });
  assert.equal(again.conversations + again.messages + again.travelLeads, 0, 'idempotente');
});
