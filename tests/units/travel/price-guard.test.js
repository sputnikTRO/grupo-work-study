import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withoutAmounts, moneyRule, isThirdPartyCost } from '../../../src/units/travel/price-guard.js';

// ── Filas REALES de "Info General" (la FAQ de Miri sale de la misma pestaña) ─
// Snapshot de evals/fixtures/sheets.json. Si el snapshot se regenera y cambia
// qué se filtra, este test falla a propósito: la lista de abajo se revisa a mano.
const snap = JSON.parse(readFileSync(new URL('../../../evals/fixtures/sheets.json', import.meta.url), 'utf8'));
const [header, ...raw] = snap.main['Info General'];
const ROWS = raw.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
const key = (r) => `${r['Código Viaje']} | ${r['Categoría']} | ${r['Título']}`;

// Las filas con dinero que SE FILTRAN (revisadas una por una).
const EXPECTED_FILTERED = [
  'TODOS | FAQ | ¿Cuánto cuesta el programa?', // apartado $10,000 MXN
  'TODOS | Pagos | ¿Cómo inscribo a mi hijo y cuánto es el pago inicial?', // $10,000 / $15,000 MXN
  'TODOS | Pagos | ¿Se puede cancelar después del apartado?', // seguro $1,500, retención $7,500
  'TODOS | Pagos | ¿Cuánto cuesta el vuelo?', // $35,000 a $37,000
  'LON2027 | Trámites | Formato SAM (Salida de Menores)', // $294 MXN
  'DUB2027 | Trámites | Formato SAM (Salida de Menores)', // $294 MXN
  'LON2026 | Actividades Extra | Opción 1: London Eye + West End Musical + Estadio', // $5,300 MXN
  'LON2026 | Actividades Extra | Opción 2: Harry Potter Studio Tour', // $4,500 MXN
  'LON2026 | Extensión | Extensión a París', // $42,990 MXN
].sort();

// Traen dinero pero son costos de TERCEROS: exentas, se conservan completas.
const EXPECTED_EXEMPT = [
  'TODOS | Trámites | ¿Cómo funciona la ETA?', // 16 libras
  'TODOS | General | ¿Cuánto deben considerar para gastos adicionales?', // £20 por día
  'LON2027 | Trámites | ETA (Electronic Travel Authorization)', // 16 libras
  'LON2027 | Finanzas | Información financiera recomendada', // 50 libras esterlinas
  'DUB2027 | Finanzas | Información financiera recomendada', // 50 euros
  'WIN2027-PS | Trámites | ¿Se necesita visa para Rising Stars?', // 16 libras
  'WIN2027-PH | Trámites | ¿Se necesita visa para Rising Stars?', // 16 libras
].sort();

test('filas reales: se filtran exactamente las que traen montos', () => {
  const kept = new Set(withoutAmounts(ROWS));
  const filtered = ROWS.filter((r) => !kept.has(r)).map(key).sort();
  assert.deepEqual(filtered, EXPECTED_FILTERED);
});

test('filas reales: los costos de terceros con dinero sobreviven completos (exención por pregunta)', () => {
  const kept = withoutAmounts(ROWS);
  const exemptKept = kept.filter((r) => moneyRule(`${r['Título']} ${r['Contenido']}`)).map(key).sort();
  assert.deepEqual(exemptKept, EXPECTED_EXEMPT);
  for (const r of ROWS.filter((x) => EXPECTED_EXEMPT.includes(key(x)))) assert.ok(isThirdPartyCost(r), key(r));
});

test('filas reales: todas las demás sobreviven (fechas, edades, noches, kilos, %)', () => {
  const survivors = withoutAmounts(ROWS).filter((r) => !isThirdPartyCost(r));
  assert.equal(survivors.length, ROWS.length - EXPECTED_FILTERED.length - EXPECTED_EXEMPT.length);
  for (const r of survivors) assert.equal(moneyRule(`${r['Título']} ${r['Contenido']}`), null, key(r));
});

test('la exención es por pregunta, no por monto: una fila nueva con el mismo monto se filtra', () => {
  const nueva = { 'Título': '¿Cuánto cuesta el seguro de viaje?', 'Contenido': 'Son 16 libras.' };
  assert.deepEqual(withoutAmounts([nueva]), []);
  const exenta = { 'Título': '  ¿como funciona la ETA? ', 'Contenido': 'Cuesta 16 libras.' }; // tolera acentos/espacios
  assert.deepEqual(withoutAmounts([exenta]), [exenta]);
});

// ── Casos de la especificación ──────────────────────────────────────────────
test('atrapa dinero en todas sus formas', () => {
  for (const [t, rule] of [
    ['El vuelo cuesta aprox $35,000 a $37,000', 'signo_moneda'],
    ['Considera £20 por día', 'signo_moneda'],
    ['Son 1500 pesos de inscripción', 'moneda'],
    ['alrededor de 20 mil MXN', 'moneda'],
    ['El costo de la ETA es de 16 libras', 'moneda'],
    ['unos 20 mil', 'mil'],
    ['El total es 64,990', 'separador_miles'],
    ['Precio: 42990 por estudiante', 'palabra_de_precio'],
    ['el apartado es de 15000', 'palabra_de_precio'],
  ]) assert.equal(moneyRule(t), rule, t);
});

test('NO atrapa fechas, años, edades, duraciones, horarios, teléfonos ni conteos', () => {
  for (const t of [
    'Te contactamos en máximo 48 horas hábiles',
    'El certificado llega en 3 semanas',
    'Viajan del 21 al 30 de mayo de 2027',
    'Periodo de pago: abril-junio 2026',
    'Para alumnos de 13 años en adelante',
    '9 días y 8 noches',
    'Atendemos de 9:00 a 18:00',
    'Llámanos al 55 1234 5678',
    'Hasta 4 estudiantes por casa; grupos de 15 viajeros',
    'Más de 2 mil alumnos han viajado',
    'Beca del 50%',
    'Una maleta de 23kg',
    'Plan de pagos hasta 2 meses antes del viaje',
  ]) assert.equal(moneyRule(t), null, t);
});

test('tolera entradas vacías', () => {
  assert.deepEqual(withoutAmounts(undefined), []);
  assert.deepEqual(withoutAmounts([{}]), [{}]);
});
