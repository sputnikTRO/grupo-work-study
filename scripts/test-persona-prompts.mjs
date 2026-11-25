/**
 * Cambio de nombre y género: Ox (femenina) y Ed (masculino).
 * Run: node --experimental-test-module-mocks scripts/test-persona-prompts.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../src/config/env.js', { namedExports: { env: { OXED_HANDOFF_MEETING_URL: 'https://example.test/agenda' } } });

const { OXFORD_BASE_PROMPT } = await import('../src/units/oxford-education/prompts.js');
const { TRAVEL_BASE_PROMPT, RESPONSE_FORMAT_INSTRUCTIONS } = await import('../src/units/travel/prompts.js');

test('Ox: se presenta como Ox, en femenino', () => {
  assert.match(OXFORD_BASE_PROMPT, /Eres Ox, la asistente virtual/);
  assert.match(OXFORD_BASE_PROMPT, /Preséntate siempre como Ox/);
  assert.doesNotMatch(OXFORD_BASE_PROMPT, /Eres Ori|Nombre: Ori\n|el asistente virtual/);
});

test('Ed: se presenta como Ed, en masculino', () => {
  assert.match(TRAVEL_BASE_PROMPT, /Eres Ed, el asistente virtual de Oxford Education & Travel, especializado/);
  assert.match(TRAVEL_BASE_PROMPT, /Hablas de ti en masculino/);
  assert.match(RESPONSE_FORMAT_INSTRUCTIONS, /Soy Ed, tu asistente/);
  assert.doesNotMatch(TRAVEL_BASE_PROMPT + RESPONSE_FORMAT_INSTRUCTIONS, /Soy Miri|Eres Miri|Salúdate como Miri|la asistente virtual|asistente virtual[^.\n]*especializada/);
});
