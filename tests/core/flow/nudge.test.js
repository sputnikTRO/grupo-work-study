import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMenuNudge, stripMenuNudge, createNudgeGuard } from '../../../src/core/flow/nudge.js';

const HANDLER = 'Escribe *Menú* cuando quieras ver las opciones de nuevo 😊';

test('reconoce las variantes de redacción del recordatorio', () => {
  for (const t of [
    HANDLER,
    'Sin problema 😊 Escribe *Menú* cuando quieras ver las demás opciones.',
    'Cuando quieras volver al menú principal, solo escribe "Menú" y te guío de nuevo 😊',
    "Si deseas volver al menú principal en cualquier momento, solo escribe 'Menú' y te guiaré nuevamente.",
    'Puedes escribir la palabra *Menú* y el sistema te mostrará todas las opciones',
    '¿Cuál te interesa? Puedes escribirme el nombre o *Menú* para ver las opciones oficiales.',
    'mándame MENU cuando quieras',
  ]) assert.ok(hasMenuNudge(t), t);
});

test('no confunde menciones del menú con el recordatorio', () => {
  for (const t of [
    'Te muestro el menú principal:',
    'Escribe tu nombre y el de tu colegio, por favor.',
    'El menudo es típico de Jalisco.',
    'Tenemos tres programas. ¿Cuál te interesa conocer?',
  ]) assert.ok(!hasMenuNudge(t), t);
});

test('stripMenuNudge quita solo la oración del recordatorio', () => {
  assert.equal(
    stripMenuNudge('Claro, te explico. Puedes escribir la palabra *Menú* y ves todo. ¿Algo más?'),
    'Claro, te explico. ¿Algo más?',
  );
  assert.equal(stripMenuNudge(HANDLER), '');
  assert.equal(stripMenuNudge('Línea uno\nEscribe *Menú* cuando quieras.\nLínea tres'), 'Línea uno\n\nLínea tres');
});

test('guardia: máximo un recordatorio por turno, venga del nodo, del LLM o del handler', () => {
  const g = createNudgeGuard();
  assert.equal(g.forReply('Respuesta. Puedes escribir *Menú* para ver todo.'), 'Respuesta. Puedes escribir *Menú* para ver todo.');
  assert.equal(g.claimReminder(), false); // el handler ya no agrega el suyo
  assert.equal(g.forNode(HANDLER), '');
  assert.equal(g.nudged, true);
});

test('guardia: si el nodo ya tuvo recordatorio, el LLM y el handler no lo repiten', () => {
  const g = createNudgeGuard({ nudgedHere: true });
  assert.equal(g.claimReminder(), false);
  assert.equal(g.forReply('Sí aplica. Escribe *Menú* si quieres ver más.'), 'Sí aplica.');
  // Si la respuesta era SOLO el recordatorio, queda vacía: el handler muestra el menú.
  assert.equal(g.forReply('Escribe *Menú* en cualquier momento y te muestro las opciones 😊'), '');
  // …pero navegar a un nodo nuevo cuyo texto trae el recordatorio sí lo muestra.
  assert.equal(g.forNode(HANDLER), HANDLER);
});

test('guardia: sin recordatorios previos, el handler puede agregar el suyo una sola vez', () => {
  const g = createNudgeGuard();
  assert.equal(g.claimReminder(), true);
  assert.equal(g.claimReminder(), false);
});
