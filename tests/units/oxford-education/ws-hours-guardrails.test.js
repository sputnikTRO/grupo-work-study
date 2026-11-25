import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spainWindow, canalizadoMessage, isWithinTeamHours, nextOpening, businessDue } from '../../../src/units/oxford-education/ws/hours.js';
import { sanitizeWsReply } from '../../../src/units/oxford-education/ws/guardrails.js';

const SPEC = '1-5 08:00-16:00';
const cdmx = (iso) => new Date(`${iso}-06:00`);

test('hora de España: invierno, verano y días de cambio de horario', () => {
  assert.deepEqual(spainWindow(cdmx('2026-11-24T10:00')), { start: '15:00', end: '23:00' }); // invierno
  assert.deepEqual(spainWindow(cdmx('2026-07-15T10:00')), { start: '16:00', end: '00:00' }); // verano
  assert.deepEqual(spainWindow(cdmx('2026-03-27T10:00')), { start: '15:00', end: '23:00' }); // viernes antes del cambio (29-mar)
  assert.deepEqual(spainWindow(cdmx('2026-03-30T10:00')), { start: '16:00', end: '00:00' }); // lunes después
  assert.deepEqual(spainWindow(cdmx('2026-10-23T10:00')), { start: '16:00', end: '00:00' }); // antes del 25-oct
  assert.deepEqual(spainWindow(cdmx('2026-10-26T10:00')), { start: '15:00', end: '23:00' }); // después
});

test('mensaje al canalizar: horario de CDMX y España, sin nombres', () => {
  const m = canalizadoMessage(cdmx('2026-11-24T10:00'), SPEC);
  assert.match(m, /de 8:00 a 16:00, hora de Ciudad de México \(hoy, de 15:00 a 23:00 hora peninsular española; en Canarias, una hora menos\)/);
  assert.doesNotMatch(m, /Karen|Jorge|2845|1091603/);
});

test('horario del equipo: dentro, fuera y siguiente apertura', () => {
  assert.equal(isWithinTeamHours(cdmx('2026-11-24T09:00'), SPEC), true);
  assert.equal(isWithinTeamHours(cdmx('2026-11-24T21:00'), SPEC), false);
  assert.equal(isWithinTeamHours(cdmx('2026-11-28T10:00'), SPEC), false); // sábado
  assert.equal(nextOpening(cdmx('2026-11-24T21:00'), SPEC).toISOString(), cdmx('2026-11-25T08:00').toISOString());
  assert.equal(nextOpening(cdmx('2026-11-27T17:00'), SPEC).toISOString(), cdmx('2026-11-30T08:00').toISOString()); // viernes → lunes
  assert.equal(businessDue(cdmx('2026-11-24T15:50'), 30, SPEC).toISOString(), cdmx('2026-11-25T08:20').toISOString()); // se pausa al cierre
});

const CONTACTS = [{ nombre: 'Karen Méndez' }, { nombre: 'Jorge Gil' }];
test('guardarraíles: quita nombres, teléfonos y montos; conserva el correo de la base', () => {
  const { text, changed } = sanitizeWsReply(
    'Escríbele a Karen Méndez al 55 2845 0167 o a Jorge Gil (938 109 1603). La reprogramación cuesta $850 MXN. Tus códigos llegan de karen.mendez@oxfordeducationlit.org.',
    CONTACTS,
  );
  assert.doesNotMatch(text, /Karen M|Jorge|2845|0167|1091603|850/);
  assert.match(text, /karen\.mendez@oxfordeducationlit\.org/);
  assert.ok(changed.includes('telefono') && changed.includes('monto'));
});
test('guardarraíles: no toca fechas, duraciones ni horarios', () => {
  const t = 'El Diagnóstico dura entre 60 y 240 minutos. El equipo atiende de 8:00 a 16:00. Fecha límite: 2026-12-05.';
  assert.equal(sanitizeWsReply(t, CONTACTS).text, t);
});
