import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutAmounts } from '../../../src/units/travel/price-guard.js';

const row = (Título, Contenido) => ({ 'Código Viaje': 'TODOS', Categoría: 'Pagos', Título, Contenido });

test('quita las filas con montos (la FAQ del vuelo que Miri citaba a colegios "otro")', () => {
  const vuelo = row('¿Cuánto cuesta el vuelo?', 'El vuelo redondo tiene un costo aproximado de $35,000 a $37,000 pesos mexicanos.');
  const apartado = row('¿Cómo aparto?', 'El lugar se aparta con $15,000.');
  assert.deepEqual(withoutAmounts([vuelo, apartado]), []);
});

test('conserva lo que no es precio aunque traiga números', () => {
  const ok = [
    row('¿Desde qué aeropuerto sale el vuelo?', 'Todos los vuelos salen del AICM, Terminal 1.'),
    row('Clima', 'En mayo Londres está entre 10 y 18 °C.'),
    row('Edad', 'Desde los 13 años; viajan del 21 al 30 de mayo de 2027.'),
  ];
  assert.deepEqual(withoutAmounts(ok), ok);
});

test('tolera entradas vacías', () => {
  assert.deepEqual(withoutAmounts(undefined), []);
  assert.deepEqual(withoutAmounts([{}]), [{}]);
});
