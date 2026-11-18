import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlaHours, addBusinessMinutes, slaDueAt, DEFAULT_SLA_HOURS } from '../../../src/units/oxford-education/sla-hours.js';

// Fechas en hora de CDMX (UTC-6, sin horario de verano). 2026-11-09 es lunes.
const mx = (s) => new Date(`${s}-06:00`);
const iso = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'medium' }).format(d);
const due = (from, minutes, spec = DEFAULT_SLA_HOURS) => iso(slaDueAt(mx(from), minutes, spec).dueAt);

test('default: L–V 9–19 y sábado 9–14', () => {
  const { schedule, error } = parseSlaHours(DEFAULT_SLA_HOURS);
  assert.equal(error, null);
  assert.deepEqual(Object.keys(schedule).map(Number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(schedule[1], [{ start: 9 * 3600000, end: 19 * 3600000 }]);
  assert.deepEqual(schedule[6], [{ start: 9 * 3600000, end: 14 * 3600000 }]);
  assert.equal(schedule[7], undefined);
});

test('dentro de horario: el plazo corre normal', () => {
  assert.equal(due('2026-11-09T10:00:00', 60), '2026-11-09 11:00:00');
  assert.equal(slaDueAt(mx('2026-11-09T10:00:00'), 60, DEFAULT_SLA_HOURS).paused, false);
});

test('lead de noche (el caso de la auditoría): el reloj arranca en la apertura', () => {
  assert.equal(due('2026-11-09T21:46:00', 60), '2026-11-10 10:00:00'); // lunes 21:46 → martes 9:00 + 60
  assert.equal(due('2026-11-09T23:59:30', 10), '2026-11-10 09:10:00');
  assert.equal(slaDueAt(mx('2026-11-09T21:46:00'), 60, DEFAULT_SLA_HOURS).paused, true);
});

test('madrugada antes de abrir: cuenta desde la apertura del mismo día', () => {
  assert.equal(due('2026-11-10T02:15:00', 60), '2026-11-10 10:00:00');
  assert.equal(due('2026-11-10T08:59:59', 10), '2026-11-10 09:10:00');
});

test('el plazo cruza el cierre: se pausa y el resto se consume al abrir', () => {
  assert.equal(due('2026-11-09T18:30:00', 60), '2026-11-10 09:30:00'); // 30 min lunes + 30 min martes
  assert.equal(due('2026-11-09T18:59:00', 10), '2026-11-10 09:09:00');
});

test('justo al cierre ya es fuera de horario', () => {
  assert.equal(due('2026-11-09T19:00:00', 60), '2026-11-10 10:00:00');
});

test('viernes en la noche → sábado; sábado después de las 14 → lunes', () => {
  assert.equal(due('2026-11-13T20:00:00', 60), '2026-11-14 10:00:00'); // viernes → sábado 9:00 + 60
  assert.equal(due('2026-11-14T13:30:00', 60), '2026-11-16 09:30:00'); // sábado 13:30: 30 min + 30 el lunes
  assert.equal(due('2026-11-14T14:06:00', 60), '2026-11-16 10:00:00'); // sábado 14:06 → lunes
  assert.equal(due('2026-11-15T12:00:00', 60), '2026-11-16 10:00:00'); // domingo → lunes
});

test('cadena de reasignaciones nocturna: cada intento tiene su hora completa de día', () => {
  // Lead el lunes 21:46 con SLA de 60 min y 8 asesoras: cada reasignación ocurre
  // al vencer la anterior, así que la cadena avanza de 10:00 a 17:00 del martes.
  let t = mx('2026-11-09T21:46:00');
  const vencimientos = [];
  for (let i = 0; i < 8; i++) { t = slaDueAt(t, 60, DEFAULT_SLA_HOURS).dueAt; vencimientos.push(iso(t).slice(11, 16)); }
  assert.deepEqual(vencimientos, ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
});

test('un plazo más largo que una jornada salta de día', () => {
  assert.equal(due('2026-11-13T18:00:00', 7 * 60), '2026-11-16 10:00:00'); // vie 1h + sáb 5h + lun 1h
});

test('sin horario / off / 24x7: corre siempre, como antes', () => {
  for (const spec of [undefined, '', 'off', '24x7', '24/7']) {
    assert.equal(iso(slaDueAt(mx('2026-11-09T21:46:00'), 60, spec).dueAt), '2026-11-09 22:46:00');
    assert.equal(slaDueAt(mx('2026-11-09T21:46:00'), 60, spec).warning, null);
  }
});

test('horario personalizado: listas de días y dos turnos', () => {
  const spec = '1,3,5 09:00-13:00; 1,3,5 15:00-18:00';
  assert.equal(due('2026-11-09T12:30:00', 60, spec), '2026-11-09 15:30:00'); // 30 min antes de comer + 30 después
  assert.equal(due('2026-11-09T18:30:00', 60, spec), '2026-11-11 10:00:00'); // lunes → miércoles (martes no trabaja)
});

test('horario ilegible: NO desactiva la pausa; usa el default y avisa', () => {
  for (const spec of ['lunes a viernes 9 a 7', '1-5 19:00-09:00', '8 09:00-10:00', '1-5 09:00-25:00', '5-1 09:00-10:00']) {
    const r = slaDueAt(mx('2026-11-09T21:46:00'), 60, spec);
    assert.equal(iso(r.dueAt), '2026-11-10 10:00:00', spec);
    assert.match(r.warning, /inválido/, spec);
  }
});

test('addBusinessMinutes con minutos 0 o negativos no retrocede', () => {
  const { schedule } = parseSlaHours(DEFAULT_SLA_HOURS);
  assert.equal(iso(addBusinessMinutes(mx('2026-11-09T10:00:00'), 0, schedule)), '2026-11-09 10:00:00');
  assert.equal(iso(addBusinessMinutes(mx('2026-11-09T10:00:00'), -5, schedule)), '2026-11-09 10:00:00');
});
