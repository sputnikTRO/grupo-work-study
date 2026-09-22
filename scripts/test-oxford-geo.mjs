/**
 * Dry-run del ruteo geográfico de Ori (NO envía mensajes ni toca DB).
 * Verifica: mapeo estado→zona→asesor, cobertura de los 32 estados, LATAM,
 * la alternancia de CDMX, tolerancia a acentos/alias, y el passthrough
 * internacional de Oriana.
 *
 * Organigrama vigente (3 equipos, tamaños distintos):
 *   NORTE  — Enrique Ruiz (coord) · Mayra Villareal · Silvana Meza · Oriana Pullas (back)
 *   CENTRO — Rosaura Pinto · Diana Castillo (back)
 *   SUR    — Balam Hernández · Paola Torres (back)   [+ cartera LATAM]
 */
import assert from 'node:assert';
import { ADVISORS, ZONAS, ZONA_ORDER, CDMX_SENTINEL, CDMX_ZONAS, resolveZona, zonaAdvisors, advisorByPhone } from '../src/units/oxford-education/advisor-zones.js';
import { normalizePhone } from '../src/utils/phone.js';

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };

// ── 1. Zona → asesores ────────────────────────────────────────────────────────
console.log('\n== Equipos ==');
const ESPERADO = {
  NORTE: ['Enrique Ruiz', 'Mayra Villareal', 'Silvana Meza', 'Oriana Pullas'],
  CENTRO: ['Rosaura Pinto', 'Diana Castillo'],
  SUR: ['Balam Hernández', 'Paola Torres'],
};
for (const k of ZONA_ORDER) {
  const advs = zonaAdvisors(k).map((a) => a.nombre);
  console.log(`  ${k.padEnd(7)} ${advs.join('  ·  ')}`);
  assert.deepStrictEqual(advs, ESPERADO[k], `equipo ${k}`);
}
assert.strictEqual(Object.keys(ADVISORS).length, 8, 'son 8 asesores en total');
assert.deepStrictEqual(Object.keys(ZONAS), ZONA_ORDER);
ok('Los 3 equipos con su gente exacta (NORTE 4 · CENTRO 2 · SUR 2)');

// Las zonas ya NO son parejas: el picker no puede asumir length === 2.
assert.strictEqual(zonaAdvisors('NORTE').length, 4, 'NORTE tiene 4, no una pareja');
ok('NORTE rompe el supuesto viejo de "dupla" de 2 — queda explícito en el test');

// ── 2. Cobertura de los 31 estados (CDMX va aparte) ───────────────────────────
const STATES = [
  ['Baja California','NORTE'],['Baja California Sur','NORTE'],['Sonora','NORTE'],['Chihuahua','NORTE'],
  ['Sinaloa','NORTE'],['Coahuila','NORTE'],['Nuevo León','NORTE'],['Tamaulipas','NORTE'],
  ['Durango','NORTE'],['Zacatecas','NORTE'],['San Luis Potosí','NORTE'],
  ['Hidalgo','CENTRO'],['Querétaro','CENTRO'],['Guanajuato','CENTRO'],['Jalisco','CENTRO'],
  ['Aguascalientes','CENTRO'],['Nayarit','CENTRO'],['Colima','CENTRO'],['Michoacán','CENTRO'],
  ['Tlaxcala','CENTRO'],['Estado de México','CENTRO'],['Puebla','CENTRO'],['Morelos','CENTRO'],
  ['Guerrero','SUR'],['Oaxaca','SUR'],['Veracruz','SUR'],['Tabasco','SUR'],['Chiapas','SUR'],
  ['Campeche','SUR'],['Yucatán','SUR'],['Quintana Roo','SUR'],
];
const gaps = STATES.filter(([n, e]) => resolveZona(n, null) !== e).map(([n, e]) => `${n}: esperado ${e}, obtuvo ${resolveZona(n, null)}`);
assert.strictEqual(gaps.length, 0, 'Gaps de estado: ' + gaps.join(' | '));
assert.strictEqual(STATES.length, 31, 'son 31 estados + CDMX = 32');
ok('Los 31 estados mapean a su equipo según el organigrama');

// Tamaulipas y San Luis Potosí cambiaron de equipo respecto al mapa anterior.
assert.strictEqual(resolveZona('Tamaulipas', null), 'NORTE');
assert.strictEqual(resolveZona('Jalisco', null), 'CENTRO');
ok('Los estados que cambiaron de manos quedaron donde dice el organigrama');

// ── 3. CDMX: centinela + alternancia ──────────────────────────────────────────
assert.strictEqual(resolveZona('CDMX', null), CDMX_SENTINEL, 'CDMX sin alcaldía YA se rutea (antes caía al fallback)');
assert.strictEqual(resolveZona('CDMX', 'Coyoacán'), CDMX_SENTINEL, 'la alcaldía ya no decide la zona');
assert.strictEqual(resolveZona(null, 'Xochimilco'), CDMX_SENTINEL, 'solo alcaldía → infiere CDMX');
assert.deepStrictEqual(CDMX_ZONAS, ['NORTE', 'CENTRO'], 'CDMX se reparte entre esos dos equipos');
ok('CDMX devuelve el centinela; la reparte actions.js entre NORTE y CENTRO');

// ── 4. Edo. de México + alias y acentos ───────────────────────────────────────
assert.strictEqual(resolveZona('Estado de México', 'Ecatepec'), 'CENTRO');
assert.strictEqual(resolveZona('Edomex', 'Nezahualcóyotl'), 'CENTRO');
ok('Cualquier municipio de Edo. México (listado o no) → CENTRO');

assert.strictEqual(resolveZona('SLP', null), 'NORTE');
assert.strictEqual(resolveZona('Nuevo Leon', null), 'NORTE');
assert.strictEqual(resolveZona('nl', null), 'NORTE');
assert.strictEqual(resolveZona('QROO', null), 'SUR');
assert.strictEqual(resolveZona('Michoacán de Ocampo', null), 'CENTRO');
ok('Tolerante a acentos, mayúsculas y alias (SLP, NL, QROO, nombres largos)');

// ── 5. LATAM → SUR (antes caían todos al fallback) ────────────────────────────
for (const pais of ['Venezuela', 'Costa Rica', 'Colombia', 'Chile', 'Ecuador', 'Brasil']) {
  assert.strictEqual(resolveZona(pais, null), 'SUR', `${pais} → SUR`);
}
assert.strictEqual(resolveZona(null, 'Venezuela'), 'SUR', 'también si el país llega en el campo de ciudad');
ok('Los 6 países de LATAM se rutean al equipo SUR');

// ── 6. Fuera de cobertura → null (dispara el fallback) ────────────────────────
assert.strictEqual(resolveZona('Florida', null), null);
assert.strictEqual(resolveZona('USA', 'Miami'), null);
assert.strictEqual(resolveZona('España', null), null);
assert.strictEqual(resolveZona(null, null), null);
ok('Lo que no es México ni LATAM sigue cayendo en OXED_FOREIGN_LEAD_FALLBACK');

// ── 7. advisorByPhone (whitelist de comandos) ─────────────────────────────────
for (const a of Object.values(ADVISORS)) {
  const found = advisorByPhone(normalizePhone(a.whatsapp).replace('+', ''));
  assert.ok(found && found.nombre === a.nombre, `advisorByPhone falló para ${a.nombre}`);
}
ok('advisorByPhone reconoce a los 8 (Mayra, Silvana y Balam ya pueden usar comandos)');

// Los que salieron del equipo ya no deben ser reconocidos.
for (const [nombre, tel] of [['Alfredo Grados', '5551064383'], ['Gilberto Osnaya', '5560703259']]) {
  assert.strictEqual(advisorByPhone(normalizePhone(tel).replace('+', '')), null, `${nombre} ya no debe estar`);
}
ok('Alfredo y Gilberto quedaron fuera del whitelist');

// Balam heredó la línea de Anamaría: el número resuelve a ÉL, no a ella.
const balam = advisorByPhone(normalizePhone('5541947449').replace('+', ''));
assert.ok(balam && balam.nombre === 'Balam Hernández', 'el 5541947449 ahora es de Balam');
ok('El número que era de Anamaría ahora resuelve a Balam Hernández');

// ── 8. Oriana conserva su número internacional (dry-run, sin enviar nada) ─────
console.log('\n== Formato de número para envío (normalizePhone → sin +) ==');
for (const a of [ADVISORS.oriana, ADVISORS.enrique, ADVISORS.silvana, ADVISORS.balam]) {
  console.log(`  ${a.nombre.padEnd(18)} ${a.whatsapp.padEnd(14)} → to="${normalizePhone(a.whatsapp).replace('+', '')}"`);
}
const orianaSend = normalizePhone(ADVISORS.oriana.whatsapp).replace('+', '');
assert.strictEqual(orianaSend, '17866332282', 'Oriana debe conservar +1, NO +52');
assert.ok(!orianaSend.startsWith('52'), 'Oriana NUNCA debe llevar prefijo 52');
assert.strictEqual(normalizePhone(ADVISORS.enrique.whatsapp).replace('+', ''), '5215532676181');
// Silvana tiene lada 844 (Saltillo): 10 dígitos igual que las de lada 55.
assert.strictEqual(normalizePhone(ADVISORS.silvana.whatsapp).replace('+', ''), '5218441222124');
ok('Oriana intacta (+1); MX recibe 521, incluida la lada 844 de Silvana. NINGÚN mensaje real enviado.');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
