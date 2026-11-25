import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectOtccIntent, parseFiltroAnswer, parseNoSeguroAnswer, parseTemaAnswer, saysNotWorkAndStudy, asksForHuman,
} from '../../../src/units/oxford-education/ws/intent.js';

const ACTIVA = [
  '¿cuándo me llega el código del OTCC?',
  'dudas del oxford tcc',
  'Oxford TCC',
  'o tcc',
  'mi examen tcc no carga',
  '¿cuándo llega mi certificado de inglés?',
  'tengo una duda con mi certificación Oxford',
  'cómo va la certificación de inglés',
];
const NO_ACTIVA = [
  'mi certificación',                       // "certificación" sola: la mayoría son prospectos comerciales
  '¿cuándo llega mi certificado?',
  'quiero certificar a mis alumnos',
  'info del Oxford TCC Kids',
  'Oxford TCC Kids para mi hijo de 9',
  'certificación de inglés para docentes',
  'el ETC para maestros',
  'Oxford Checkpoint Kids da certificado de inglés?',
  'hola', 'precio de English Life', 'tengo 30 alumnos', 'Alphable', '',
];

test('activa el filtro (tabla de frases)', () => {
  for (const t of ACTIVA) assert.equal(detectOtccIntent(t).otcc, true, t);
});
test('NO activa el filtro (tabla de frases)', () => {
  for (const t of NO_ACTIVA) assert.equal(detectOtccIntent(t).otcc, false, t);
});
test('Work and Study + intención → entra directo; sin intención no', () => {
  assert.deepEqual(detectOtccIntent('soy de Work and Study y no me deja entrar al TCC'), { otcc: true, ws: true });
  assert.deepEqual(detectOtccIntent('Soy de W&S, ¿cuándo es el OTCC?'), { otcc: true, ws: true });
  assert.deepEqual(detectOtccIntent('mi certificado de Work and Study no llegó'), { otcc: true, ws: true });
  assert.equal(detectOtccIntent('soy de work and study, pregunta de visa').otcc, false);
});

test('respuestas al filtro', () => {
  const cases = {
    '1': 'ws', '1.-': 'ws', 'Sí': 'ws', 'si, soy de work and study': 'ws', 'W&S': 'ws', 'claro': 'ws',
    '2': 'no', 'no': 'no', 'No, otro programa': 'no', 'otro programa': 'no',
    '3': 'no_seguro', 'no sé': 'no_seguro', 'no estoy segura': 'no_seguro', 'creo que sí': 'no_seguro',
    '¿cuánto cuesta?': null, 'mmm': null, '': null,
  };
  for (const [t, want] of Object.entries(cases)) assert.equal(parseFiltroAnswer(t), want, t);
});
test('respuestas a "no estoy seguro" y a ws_tema', () => {
  assert.equal(parseNoSeguroAnswer('1'), 'ws');
  assert.equal(parseNoSeguroAnswer('2'), 'no');
  assert.equal(parseNoSeguroAnswer('3'), 'canalizar');
  assert.equal(parseNoSeguroAnswer('sigo sin estar seguro'), 'canalizar');
  assert.equal(parseTemaAnswer('1'), 'otcc');
  assert.equal(parseTemaAnswer('es sobre Life'), 'otro');
  assert.equal(parseTemaAnswer('2'), 'otro');
});
test('"no soy de W&S" y "quiero hablar con una persona"', () => {
  assert.ok(saysNotWorkAndStudy('perdón, no soy de Work and Study'));
  assert.ok(saysNotWorkAndStudy('no formo parte de W&S'));
  assert.ok(!saysNotWorkAndStudy('soy de work and study'));
  assert.ok(asksForHuman('quiero hablar con una persona'));
  assert.ok(!asksForHuman('¿cuánto dura el speaking?'));
});
