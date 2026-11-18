/**
 * src/core/flow/text.js — clasificador de CTAs (compartido por Ori y Miri).
 *
 * Regresión del bug real: en el nodo del Oxford TCC, que termina con el CTA
 * "¿Deseas detalles sobre niveles, proceso o costos?", un prospecto escribió
 * "¿Qué pasa si no paso la certificación?" y Ori contestó "Sin problema 😊
 * Escribe Menú cuando quieras…". DECLINE_RE matcheaba el "no" de "si NO paso",
 * así que la duda se clasificaba como rechazo al CTA y NUNCA llegaba al LLM —
 * que sí tenía la respuesta en la FAQ (sin reembolso + diploma de participación).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchMenuChoice as pick } from '../../../src/core/flow/text.js';
import { classifyCta } from '../../../src/core/flow/text.js';

describe('classifyCta — una pregunta nunca es un sí ni un no', () => {
  it('la pregunta exacta del bug NO se clasifica como rechazo', () => {
    assert.strictEqual(classifyCta('¿Qué pasa si no paso la certificación?'), 'ambiguous');
  });

  it('las variantes de la misma duda tampoco', () => {
    for (const t of [
      '¿qué pasa si no apruebo?',
      '¿y si no paso el examen?',
      '¿hay reembolso si no lo apruebo?',
      '¿cuánto cuesta si no lo apruebo?',
      '¿no hay devolución?',
    ]) {
      assert.strictEqual(classifyCta(t), 'ambiguous', `"${t}" debería ir al respaldo LLM`);
    }
  });

  it('reconoce la pregunta aunque no traiga signos', () => {
    for (const t of ['que pasa si no la paso', 'cuanto tarda si no apruebo', 'por que no me llega el certificado']) {
      assert.strictEqual(classifyCta(t), 'ambiguous', `"${t}" arranca con interrogativo`);
    }
  });

  it('una pregunta con intención de aceptar tampoco deriva sola', () => {
    // Erramos al lado seguro: el LLM la atiende y el CTA sigue vivo.
    assert.strictEqual(classifyCta('¿me puedes conectar con un asesor?'), 'ambiguous');
  });
});

describe('classifyCta — el sí/no solo cuenta en respuestas cortas', () => {
  it('un "no" embebido en una frase larga no es un rechazo al CTA', () => {
    for (const t of [
      'necesito pensarlo porque no tengo el presupuesto ahora',
      'mi hija no ha terminado la prepa todavía y quiero saber opciones',
    ]) {
      assert.strictEqual(classifyCta(t), 'ambiguous', `"${t}"`);
    }
  });

  it('una negación bloquea las frases de aceptación', () => {
    assert.strictEqual(classifyCta('no quiero hablar con un asesor por ahora'), 'ambiguous');
  });

  it('las frases de intención sí valen aunque sean largas', () => {
    assert.strictEqual(classifyCta('sí quiero hablar con un asesor'), 'accept');
    assert.strictEqual(classifyCta('me interesa mucho, cuéntame más del programa'), 'accept');
  });
});

describe('classifyCta — el comportamiento de siempre no cambia', () => {
  it('un rechazo claro sigue siendo decline', () => {
    for (const t of ['no', 'no gracias', 'no, gracias', 'todavía no', 'ahorita no', 'todavía no, gracias', 'luego', 'más tarde']) {
      assert.strictEqual(classifyCta(t), 'decline', `"${t}"`);
    }
  });

  it('una aceptación clara sigue siendo accept', () => {
    for (const t of ['sí', 'sí, por favor', 'claro', 'claro que sí', 'ok', 'dale', 'va', 'me interesa', 'de acuerdo']) {
      assert.strictEqual(classifyCta(t), 'accept', `"${t}"`);
    }
  });

  it('vacío y ruido siguen cayendo en ambiguous', () => {
    assert.strictEqual(classifyCta(''), 'ambiguous');
    assert.strictEqual(classifyCta(null), 'ambiguous');
    assert.strictEqual(classifyCta('mmm'), 'ambiguous');
  });
});

describe('matchMenuChoice — opción nombrada en una frase (fix/miri-derivacion)', () => {
// fix/miri-derivacion — opción nombrada dentro de una frase.
const MENU_MIRI = { texto: 'Tenemos tres programas\n1.- English 4 Life (Londres o Dublín, mayo)\n2.- Winter Break (Windsor, Inglaterra)\n3.- Rising Stars (programa con beca)\n4.- Prefiero hablar con una asesora', opciones: { 1: 'a', 2: 'b', 3: 'c', 4: 'd' } };
const CTA_SI_NO = { texto: '¿Te conecto?\n1.- Sí, por favor\n2.- Todavía no, gracias', opciones: { 1: 'x', 2: 'y' } };

it('una opción nombrada dentro de una frase se acepta', () => {
  assert.equal(pick('Es Winter Break', MENU_MIRI), '2');
  assert.equal(pick('quiero english 4 life', MENU_MIRI), '1');
  assert.equal(pick('me interesa rising stars', MENU_MIRI), '3');
});

it('si la frase nombra DOS opciones sigue siendo ambigua', () => {
  assert.equal(pick('¡Hola! Quiero conocer más sobre English 4 Life – Winter Break', MENU_MIRI), null);
});

it('palabras cortas ("sí", "no") no entran por la regla de frase', () => {
  assert.equal(pick('si claro', CTA_SI_NO), null);
  assert.equal(pick('José tiene 14 años', MENU_MIRI), null);
});
});
