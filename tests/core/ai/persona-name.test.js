import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameLegacyPersona } from '../../../src/core/ai/persona-name.js';

test('Miri → Ed solo en turnos del asistente', () => {
  const h = [
    { role: 'assistant', content: '¡Hola! Soy Miri, del equipo de Oxford Education & Travel ✈️' },
    { role: 'user', content: 'Gracias Miri' },
    { role: 'assistant', content: 'Te atenderá Miriana Galdos, de nuestro equipo.' },
  ];
  const out = renameLegacyPersona(h, 'travel');
  assert.equal(out[0].content, '¡Hola! Soy Ed, del equipo de Oxford Education & Travel ✈️');
  assert.equal(out[1].content, 'Gracias Miri', 'lo que escribió el usuario no se toca');
  assert.equal(out[2].content, 'Te atenderá Miriana Galdos, de nuestro equipo.', 'Miriana (asesora) no se toca');
  assert.equal(h[0].content.includes('Miri'), true, 'no muta el historial original');
});

test('Ori → Ox, sin tocar palabras que la contienen', () => {
  const out = renameLegacyPersona([
    { role: 'assistant', content: 'Soy Ori. Te comparto la Orientación vocacional.' },
  ], 'oxford_education');
  assert.equal(out[0].content, 'Soy Ox. Te comparto la Orientación vocacional.');
});

test('unidad sin cambio de nombre o historial vacío: igual', () => {
  const h = [{ role: 'assistant', content: 'Soy Ori' }];
  assert.equal(renameLegacyPersona(h, 'work_study'), h);
  assert.deepEqual(renameLegacyPersona([], 'travel'), []);
});
