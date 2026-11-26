import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDraft, missingFields, normalizeStage } from '../../../src/units/oxford-education/ws/draft.js';

test('la pregunta con la que se canalizó no se pierde (caso real #1, 26-nov)', () => {
  let d = { description: 'Cuando me entregan mi certificado' };
  d = mergeDraft(d, { fullName: 'Rafael Troncoso', email: 'rafael@etla4.com.mx', description: 'ya hice todo' });
  assert.equal(d.description, 'Cuando me entregan mi certificado — ya hice todo');
  d = mergeDraft(d, { stage: 'Certificación' });
  assert.equal(d.description, 'Cuando me entregan mi certificado — ya hice todo', 'sin descripción nueva no cambia');
  assert.deepEqual(missingFields(d), []);
});

test('sin pregunta previa, la descripción es la que da el participante', () => {
  assert.equal(mergeDraft({}, { description: 'No me llega el código del Mock' }).description, 'No me llega el código del Mock');
});

test('no repite texto que ya está y no agrega fragmentos cortos', () => {
  const d = { description: 'No me llega el código del Mock' };
  assert.equal(mergeDraft(d, { description: 'no me llega el código del mock' }).description, d.description);
  assert.equal(mergeDraft(d, { description: 'sí' }).description, d.description);
});

test('valida nombre, correo y etapa', () => {
  const d = mergeDraft({}, { fullName: 'Ana', email: 'no-es-correo', stage: 'el oral' });
  assert.equal(d.fullName, undefined, 'un solo nombre no basta');
  assert.equal(d.email, undefined);
  assert.equal(d.stage, 'Speaking');
  assert.equal(normalizeStage('diagnostico'), 'Diagnóstico');
});
