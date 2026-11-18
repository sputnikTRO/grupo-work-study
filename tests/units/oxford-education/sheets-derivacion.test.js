import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wasHandedOff } from '../../../src/units/oxford-education/sheets-sync.js';

// Columna J "Derivación" de la pestaña "Leads Oxford". Regresión de la auditoría
// de nov-2026: las 10 derivaciones del periodo salían como "No".

test('handoff en este turno cuenta como derivado', () => {
  assert.equal(wasHandedOff({ status: 'interesado' }, true), true);
});

test('un turno posterior al handoff NO borra la derivación (handoff tibio)', () => {
  assert.equal(wasHandedOff({ status: 'derivado_asesor', assignedAdvisor: 'Rosaura Pinto' }, false), true);
});

test('sin_confirmar (se agotaron las asesoras) sigue contando como derivado', () => {
  assert.equal(wasHandedOff({ status: 'sin_confirmar', assignedAdvisor: 'Paola Torres' }, false), true);
  assert.equal(wasHandedOff({ status: 'sin_confirmar' }, false), true);
});

test('en_atencion y atendido_asesor cuentan como derivado', () => {
  assert.equal(wasHandedOff({ status: 'en_atencion' }, false), true);
  assert.equal(wasHandedOff({ status: 'atendido_asesor' }, false), true);
});

test('derivado al equipo de viajes (derivado_travel) cuenta como derivado', () => {
  assert.equal(wasHandedOff({ status: 'interesado', tags: ['derivado_travel'] }, false), true);
});

test('lead que nunca se derivó sigue en "No"', () => {
  assert.equal(wasHandedOff({ status: 'nuevo', tags: [] }, false), false);
  assert.equal(wasHandedOff({ status: 'primer_contacto', tags: ['ya_inscrito'] }, false), false);
  assert.equal(wasHandedOff({ status: 'interesado', notes: 'Sin zona (fallback link): pide precio' }, false), false);
});
