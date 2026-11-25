import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseKbDoc } from '../../../src/units/oxford-education/ws/kb-parse.js';
import { buildWsPrompt, stripWsTags, TAG_CANALIZAR } from '../../../src/units/oxford-education/ws/prompt.js';

const rows = parseKbDoc(fs.readFileSync(new URL('../../../docs/kb-ws-otcc.md', import.meta.url), 'utf8'));

test('el documento da las 10 secciones de preguntas', () => {
  assert.equal(new Set(rows.map((r) => r.seccion)).size, 10);
  assert.ok(rows.length >= 50);
  assert.ok(rows.every((r) => r.pregunta.endsWith('?') && r.respuesta && !r.respuesta.startsWith('(nueva)')));
});

test('prompt W&S: base completa, sin equipo, con el correo de la base y la hora de España', () => {
  const p = buildWsPrompt(rows, { now: new Date('2026-11-24T16:00:00Z') });
  assert.match(p, /BASE W&S OTCC/);
  assert.match(p, /¿Cuánto dura el Diagnóstico\?/);
  assert.match(p, /karen\.mendez@oxfordeducationlit\.org/);
  assert.doesNotMatch(p, /Karen Méndez|Jorge Gil|2845|0167|938 109|1091603/, 'nombres y teléfonos del equipo nunca entran al prompt');
  assert.match(p, /15:00–23:00 hora peninsular/);
  assert.doesNotMatch(p, /Alphable es|Rising Stars|precio/i, 'nada del catálogo comercial');
});

test('etiquetas: se detectan y no salen al participante', () => {
  const raw = 'Te ayudo a canalizarlo. [CANALIZAR:no llega el código]';
  assert.equal(TAG_CANALIZAR.exec(raw)[1], 'no llega el código');
  assert.equal(stripWsTags(raw), 'Te ayudo a canalizarlo.');
  assert.equal(stripWsTags('No aplica. [NO_ES_WS]'), 'No aplica.');
});
