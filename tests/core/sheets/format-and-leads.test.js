import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCdmx, cdmxCell, ISO_UTC_RE } from '../../../src/core/sheets/format.js';
import { formatLeadRow, displayInterest } from '../../../src/core/sheets/leads-sync.js';
import { ticketStatusLabel } from '../../../src/units/oxford-education/sheets-sync.js';

test('formatCdmx: UTC → hora de CDMX, cruzando la medianoche', () => {
  assert.equal(formatCdmx('2026-11-11T04:11:23.000Z'), '2026-11-10 22:11'); // el caso de la fila del 11-nov
  assert.equal(formatCdmx(new Date('2026-10-01T18:03:00-06:00')), '2026-10-01 18:03');
  assert.equal(formatCdmx('2026-07-16T22:06:23.677Z'), '2026-07-16 16:06'); // julio: México ya no tiene horario de verano
});

test('formatCdmx / cdmxCell: vacío o inválido → cadena vacía, nunca "Invalid Date"', () => {
  for (const v of [null, undefined, '', 'no es fecha']) { assert.equal(formatCdmx(v), ''); assert.equal(cdmxCell(v), ''); }
  assert.equal(cdmxCell('2026-11-11T04:11:23.000Z'), "'2026-11-10 22:11");
});

test('ISO_UTC_RE reconoce solo las fechas viejas, no las ya convertidas ni texto', () => {
  assert.ok(ISO_UTC_RE.test('2026-11-11T04:11:23.000Z'));
  assert.ok(ISO_UTC_RE.test('2026-11-11T04:11:23Z'));
  for (const v of ['2026-11-10 22:11', '10/11/2026', 'Rosaura Pinto', '', '2026-11-11T04:11:23-06:00']) assert.ok(!ISO_UTC_RE.test(v), v);
});

const contact = { phone: '+5215500001111', name: 'Mamá' };
const baseLead = { id: 'T1', createdAt: new Date('2026-11-11T04:11:00Z'), updatedAt: new Date('2026-11-11T04:17:00Z'), parentName: 'Alicia', schoolCode: 'otro', status: 'derivado_asesor', assignedAdvisor: 'Camila Serafín', materialsSent: [] };

test('Miri: "Asesor Asignado" sale del lead aunque la conversación en memoria aún no lo traiga', () => {
  const row = formatLeadRow(baseLead, contact, { interestScore: 0, flowNode: 'handoff_familia' }); // conv SIN assignedAgent (turno del handoff)
  assert.equal(row[10], 'Camila Serafín');
});

test('Miri: fechas en hora de CDMX', () => {
  const row = formatLeadRow(baseLead, contact, { interestScore: 0 });
  assert.equal(row[1], "'2026-11-10 22:11");
  assert.equal(row[11], "'2026-11-10 22:17");
});

test('Miri: "Interés" ya no es 0 para todos — refleja hasta dónde llegó el prospecto', () => {
  const conv = { interestScore: 0, flowNode: 'filtro_previo' };
  assert.equal(displayInterest({ status: 'nuevo' }, conv), 1, 'solo escribió');
  assert.equal(displayInterest({ status: 'nuevo', travelerName: 'Diego' }, conv), 3, 'dejó datos');
  assert.equal(displayInterest({ status: 'nuevo', travelerName: 'Diego' }, { interestScore: 0, flowNode: 'cat_wb' }), 5, 'eligió programa');
  assert.equal(displayInterest({ status: 'nuevo', programInterest: 'Winter Break' }, { interestScore: 0, flowNode: 'wb_precio' }), 6, 'pidió precio');
  assert.equal(displayInterest({ status: 'derivado_asesor' }, conv), 8, 'derivado');
  assert.equal(formatLeadRow(baseLead, contact, conv)[7], '8');
});

test('Miri: si el puntaje del camino LLM es mayor, gana (y nunca pasa de 10)', () => {
  assert.equal(displayInterest({ status: 'nuevo' }, { interestScore: 7 }), 7);
  assert.equal(displayInterest({ status: 'derivado_asesor' }, { interestScore: 14 }), 10);
});

test('Ori: "Estado del ticket" en palabras', () => {
  assert.equal(ticketStatusLabel({ status: 'derivado_asesor', assignedAdvisor: 'Rosaura Pinto' }), 'Esperando confirmación de Rosaura Pinto');
  assert.equal(ticketStatusLabel({ status: 'en_atencion', assignedAdvisor: 'Rosaura Pinto' }), 'En atención — Rosaura Pinto confirmó');
  assert.equal(ticketStatusLabel({ status: 'atendido_asesor', assignedAdvisor: 'Rosaura Pinto' }), 'Atendido — Rosaura Pinto lo cerró');
  assert.equal(ticketStatusLabel({ status: 'sin_confirmar', assignedAdvisor: 'Paola Torres' }), 'SIN CONFIRMAR — nadie respondió (última avisada: Paola Torres)');
  assert.equal(ticketStatusLabel({ status: 'interesado', tags: ['derivado_travel'] }), 'Derivado al equipo de viajes');
  assert.equal(ticketStatusLabel({ status: 'nuevo' }), 'Sin derivar');
});
