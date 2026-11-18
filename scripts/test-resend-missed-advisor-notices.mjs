/**
 * Regresión de scripts/resend-missed-advisor-notices.mjs (plan, sin enviar).
 *
 *   node --experimental-test-module-mocks scripts/test-resend-missed-advisor-notices.mjs
 */
import assert from 'node:assert';

const { planResend, parseArgs } = await import('./resend-missed-advisor-notices.mjs');
const { ADVISORS } = await import('../src/units/oxford-education/advisor-zones.js');

const att = (key, nombre, result = 'no_confirmo') => ({ advisor: nombre, advisorKey: key, assignedAt: '2026-10-01T00:03:00.000Z', result });
const LEADS = [
  { id: 'L5', ticketNumber: 5, status: 'sin_confirmar', zoneKey: 'CENTRO', assignedAdvisor: 'Paola Torres', advisorAttempts: [att('rosaura', 'Rosaura Pinto'), att('paola', 'Paola Torres')], contact: {} },
  { id: 'L6', ticketNumber: 6, status: 'sin_confirmar', zoneKey: 'NORTE', assignedAdvisor: 'Paola Torres', advisorAttempts: [att('enrique', 'Enrique Ruiz'), att('paola', 'Paola Torres')], contact: {} },
  { id: 'L9', ticketNumber: 9, status: 'sin_confirmar', zoneKey: 'CENTRO', assignedAdvisor: 'Paola Torres', advisorAttempts: [att('diana', 'Diana Castillo')], contact: {} },
  { id: 'L20', ticketNumber: 20, status: 'derivado_asesor', zoneKey: 'SUR', assignedAdvisor: 'Enrique Ruiz', advisorAttempts: [att('balam', 'Balam Hernández'), att('paola', 'Paola Torres'), att('enrique', 'Enrique Ruiz', 'esperando')], contact: {} },
  { id: 'L21', ticketNumber: 21, status: 'en_atencion', confirmedAt: new Date(), zoneKey: 'SUR', assignedAdvisor: 'Balam Hernández', advisorAttempts: [att('balam', 'Balam Hernández', 'confirmo')], contact: {} },
  { id: 'L22', ticketNumber: 22, status: 'atendido_asesor', zoneKey: 'SUR', assignedAdvisor: 'Balam Hernández', advisorAttempts: [att('balam', 'Balam Hernández')], contact: {} },
];
const DELIVERED = [{ leadId: 'L6', advisorName: 'Enrique Ruiz', status: 'delivered' }];
const writes = [];
const prisma = {
  oxfordLead: {
    findMany: async ({ where }) => LEADS.filter((l) => (where.ticketNumber ? where.ticketNumber.in.includes(l.ticketNumber) : l.status === where.status && !l.confirmedAt)),
    update: async () => { writes.push('update'); }, updateMany: async () => { writes.push('updateMany'); },
  },
  advisorNotification: {
    findFirst: async ({ where }) => DELIVERED.find((d) => d.leadId === where.leadId && d.advisorName === where.advisorName && where.status.in.includes(d.status)) || null,
  },
};

let pass = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); pass++; };

{
  const { send, skip } = await planResend({ prisma, ADVISORS, args: parseArgs(['--tickets', '5,6,9,20,21,22']) });
  assert.deepStrictEqual(send.map((s) => [s.ticket, s.advisor.nombre]), [[5, 'Rosaura Pinto'], [20, 'Balam Hernández']]);
  ok('Se manda a la asesora ORIGINAL de la cadena (#5 → Rosaura, #20 → Balam), no a la actual');
  const motivo = Object.fromEntries(skip.map((s) => [s.ticket, s.motivo]));
  assert.match(motivo[6], /ya tiene un aviso entregado/);
  ok('Un ticket con aviso ya ENTREGADO a su asesora original no se reenvía (se puede correr dos veces)');
  assert.match(motivo[9], /Diana Castillo ya no está/);
  ok('Asesora original que ya no está en advisor-zones.js → se omite y se reporta');
  assert.match(motivo[21], /ya confirmado/);
  assert.match(motivo[22], /no está esperando/);
  ok('Confirmados o cerrados no se tocan');
}

{
  const { send } = await planResend({ prisma, ADVISORS, args: parseArgs([]) });
  assert.deepStrictEqual(send.map((s) => s.ticket), [5], 'sin --tickets: solo sin_confirmar del periodo');
  ok('Sin --tickets toma solo los sin_confirmar del periodo');
}

assert.deepStrictEqual(writes, [], 'el plan nunca escribe en los leads');
ok('El plan no modifica ningún lead');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
