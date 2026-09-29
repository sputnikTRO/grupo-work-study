/**
 * Tests del propio harness: que cada assert duro DETECTE lo que dice detectar.
 * Un assert que nunca casa pasa por vacuidad — ya pasó con el regex del nudge
 * (\b después de "ú"), que daba verde en todos los escenarios sin contar nada.
 *
 *   node --test evals/asserts.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAsserts, studentsWithSinglePaymentRow, assertsAlreadyContacted, _internals } from './asserts.mjs';

const { PRICE_RE, ALREADY_CONTACTED_RE, countNudges, isQuestion } = _internals;

// Textos VERBATIM de producción (handler.js / flow-engine.js / Flujo Miri).
const HANDLER_NUDGE = 'Escribe *Menú* cuando quieras ver las opciones de nuevo 😊';
const ORI_DECLINE = 'Sin problema 😊 Escribe *Menú* cuando quieras ver las demás opciones, o cuéntame si tienes otra duda.';
const MIRI_UTIL_MENU = 'Cuando quieras volver al menú principal, solo escribe "Menú" y te guío de nuevo 😊';
const ORI_UTIL_MENU = "Si deseas volver al menú principal en cualquier momento, solo escribe 'Menú' y te guiaré nuevamente.";

const turn = (i, over) => ({ i, user: 'x', nodeBefore: 'cat_3', nodeAfter: 'cat_3', bot: [], advisor: [], ...over });

test('el regex del nudge casa con todos los recordatorios reales', () => {
  for (const t of [HANDLER_NUDGE, ORI_DECLINE, MIRI_UTIL_MENU, ORI_UTIL_MENU, 'o escríbeme *menu* para ver opciones']) {
    assert.equal(countNudges([t]), 1, t);
  }
});

test('el regex del nudge no casa con menciones que no son recordatorio', () => {
  for (const t of ['Te comparto el menú de opciones', 'Escribe menudo', 'escribe tu nombre por favor']) {
    assert.equal(countNudges([t]), 0, t);
  }
});

test('nudge: 2 en el mismo turno falla; 1 pasa', () => {
  const sc = { unit: 'ori', expect: {} };
  const dos = runAsserts(sc, [turn(1, { bot: ['Respuesta… o escribe *Menú* para ver opciones', HANDLER_NUDGE] })]);
  assert.equal(dos.find((c) => c.id === 'nudge_max_1_por_turno').pass, false);
  const uno = runAsserts(sc, [turn(1, { bot: ['Respuesta', HANDLER_NUDGE] })]);
  assert.equal(uno.find((c) => c.id === 'nudge_max_1_por_turno').pass, true);
});

test('nudge: repetido en la misma visita a un nodo falla; al cambiar de nodo se reinicia', () => {
  const sc = { unit: 'miri', phone: '5215500000000', expect: {} };
  const repetido = runAsserts(sc, [
    turn(1, { nodeBefore: 'e4l_material', nodeAfter: 'util_menu', bot: [MIRI_UTIL_MENU] }),
    turn(2, { nodeBefore: 'util_menu', nodeAfter: 'util_menu', bot: ['Respuesta del LLM', HANDLER_NUDGE] }),
  ]);
  assert.equal(repetido.find((c) => c.id === 'nudge_max_1_por_nodo').pass, false);

  const otroNodo = runAsserts(sc, [
    turn(1, { nodeBefore: 'cat_e4l', nodeAfter: 'cat_e4l', bot: ['a', HANDLER_NUDGE] }),
    turn(2, { nodeBefore: 'cat_e4l', nodeAfter: 'e4l_material', bot: ['b'] }),
    turn(3, { nodeBefore: 'e4l_material', nodeAfter: 'e4l_material', bot: ['c', HANDLER_NUDGE] }),
  ]);
  assert.equal(otroNodo.find((c) => c.id === 'nudge_max_1_por_nodo').pass, true);
});

test('precios: detecta montos y deja pasar plazos/cantidades que no son dinero', () => {
  for (const t of ['cuesta $1,500', 'desde $900', 'unos 5 mil pesos', '1200 MXN', 'alrededor de 15k']) assert.ok(PRICE_RE.test(t), t);
  for (const t of ['en 48 horas hábiles', '15 minutos al día', 'niños de 7 a 12 años', 'niveles A1 a C2']) assert.ok(!PRICE_RE.test(t), t);
});

test('"ya está en contacto": detecta la afirmación, no la asignación', () => {
  for (const t of ['Ya está en contacto contigo', 'ya se comunicó contigo', 'Rosaura ya te contactó', 'ya te escribió por WhatsApp']) {
    assert.ok(ALREADY_CONTACTED_RE.test(t), t);
  }
  for (const t of ['Es tu asesora asignada y te dará seguimiento', 'te contactará en un máximo de 48 horas hábiles']) {
    assert.ok(!ALREADY_CONTACTED_RE.test(t), t);
  }
});

test('"ya está en contacto": una mención condicional no es afirmación (falso positivo real, corrida 2)', () => {
  assert.ok(!assertsAlreadyContacted('Sobre si ya te escribió o cuándo exactamente lo hará, no tengo forma de saberlo desde aquí.'));
  assert.ok(!assertsAlreadyContacted('No sé si ya te contactó, pero le aviso.'));
  assert.ok(assertsAlreadyContacted('Rosaura ya te escribió por WhatsApp 😊'));
  assert.ok(assertsAlreadyContacted('No te preocupes, ya está en contacto contigo.'));
});

test('CTA: una pregunta en nodo hoja no puede terminar en el copy de "no gracias"', () => {
  assert.ok(isQuestion('¿Qué pasa si no paso la certificación?'));
  assert.ok(isQuestion('que pasa si no paso'));
  assert.ok(!isQuestion('no gracias'));
  const sc = { unit: 'ori', expect: {} };
  const mal = runAsserts(sc, [turn(1, { user: '¿Qué pasa si no paso?', nodeBefore: 'n_1_2', nodeAfter: 'llm_freeform', bot: [ORI_DECLINE] })]);
  assert.equal(mal.find((c) => c.id === 'cta_pregunta_no_es_decline').pass, false);
  const bien = runAsserts(sc, [turn(1, { user: '¿Qué pasa si no paso?', nodeBefore: 'n_1_2', nodeAfter: 'n_1_2', bot: ['Respuesta de la FAQ'] })]);
  assert.equal(bien.find((c) => c.id === 'cta_pregunta_no_es_decline').pass, true);
});

test('financieros de ya_inscrito: el fixture da match único solo al teléfono de control', () => {
  assert.deepEqual(studentsWithSinglePaymentRow('525590000103'), ['diego eval ramirez']);
  assert.deepEqual(studentsWithSinglePaymentRow('525590000101'), []); // Sofía: 2 filas → ambiguo
  assert.deepEqual(studentsWithSinglePaymentRow('525590000102'), []); // sin registro
});

test('financieros de ya_inscrito: una cotización no es estatus de pago (falso positivo real, corrida 3)', () => {
  const sc = { unit: 'miri', phone: '525590000201', expect: {} };
  const cotiza = runAsserts(sc, [turn(1, { bot: ['El vuelo va incluido en la inversión total del programa ✅ El costo aproximado del vuelo está entre $35,000 y $37,000 pesos'] })]);
  assert.equal(cotiza.find((c) => c.id === 'financieros_solo_match_unico').pass, true);
  const saldo = runAsserts(sc, [turn(1, { bot: ['Tu saldo pendiente es de $20,000'] })]);
  assert.equal(saldo.find((c) => c.id === 'financieros_solo_match_unico').pass, false);
});

test('financieros de ya_inscrito: monto a un match ambiguo falla', () => {
  const sc = { unit: 'miri', phone: '525590000101', expect: {} };
  const r = runAsserts(sc, [turn(1, { bot: ['Sofía: Llevas pagado: $20,000 · Falta por pagar: $44,990'] })]);
  assert.equal(r.find((c) => c.id === 'financieros_solo_match_unico').pass, false);
  const ok = runAsserts({ ...sc, phone: '525590000103' }, [turn(1, { bot: ['Esto es lo que tengo de Diego Eval Ramírez: Falta por pagar: $31,990'] })]);
  assert.equal(ok.find((c) => c.id === 'financieros_solo_match_unico').pass, true);
});
