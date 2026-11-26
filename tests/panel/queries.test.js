import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePrismaDataSource, readOnly } from '../../src/panel/queries.js';

function fakePrisma(seed = {}) {
  const raw = []; const wheres = {};
  const model = (name, rows = []) => ({
    findMany: async ({ where } = {}) => { (wheres[name] ||= []).push(where); return rows; },
    findUnique: async ({ where }) => rows.find((r) => r.ticketNumber === where.ticketNumber) || null,
  });
  const tx = {
    $executeRawUnsafe: async (sql) => { raw.push(sql); },
    oxfordLead: model('oxfordLead', seed.ox || []), travelLead: model('travelLead', seed.ed || []),
    advisorNotification: model('advisorNotification'), conversation: model('conversation', seed.convs || []),
    supportCase: model('supportCase'), advisorCommand: model('advisorCommand'), message: model('message', seed.msgs || []),
  };
  return { raw, wheres, $transaction: async (fn) => fn(tx) };
}
const lead = (o) => ({ id: 'l1', contactId: 'c1', ticketNumber: 5, status: 'derivado_asesor', createdAt: new Date(), updatedAt: new Date(), contact: { phone: '+5215512344821' }, assignedAdvisor: 'Alma Sotelo', ...o });

test('cada consulta corre en transacción de solo lectura con tiempo máximo', async () => {
  const p = fakePrisma();
  await readOnly(p, async () => {});
  assert.deepEqual(p.raw, ['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '3s'"]);
});

test('asesora: el filtro por su nombre va en la consulta, no solo en pantalla', async () => {
  const p = fakePrisma({ ed: [lead()] });
  const ds = makePrismaDataSource(p, { excludePhones: ['5535305000'] });
  const out = await ds.list({ page: 1 }, { role: 'asesora', advisorName: 'Alma Sotelo' });
  assert.equal(p.wheres.travelLead[0].assignedAdvisor, 'Alma Sotelo');
  assert.equal(p.wheres.oxfordLead[0].assignedAdvisor, 'Alma Sotelo');
  assert.equal(out.rows[0].phone, '55 •••• 4821');
});

test('asesora: el detalle de un lead ajeno no existe para ella, y nunca ve la conversación', async () => {
  const p = fakePrisma({ ed: [lead({ assignedAdvisor: 'Otra Asesora' })] });
  const ds = makePrismaDataSource(p);
  assert.equal(await ds.detail('ed', 5, { role: 'asesora', advisorName: 'Alma Sotelo' }), null);
  const p2 = fakePrisma({ ed: [lead({ travelerName: 'Menor', travelerAge: 14 })], msgs: [{ id: 'm', content: 'hola' }] });
  const mine = await makePrismaDataSource(p2).detail('ed', 5, { role: 'asesora', advisorName: 'Alma Sotelo' });
  assert.equal(mine.messages, null);
  assert.equal(mine.lead.travelerName, undefined, 'datos del menor solo para admin');
  const admin = await makePrismaDataSource(p2).detail('ed', 5, { role: 'admin' });
  assert.equal(admin.lead.travelerName, 'Menor');
});
