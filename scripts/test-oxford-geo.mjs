/**
 * Dry-run del ruteo geográfico de Ori (NO envía mensajes ni toca DB).
 * Verifica: mapeo zona→dupla→asesor, cobertura de 32 estados + 16 alcaldías,
 * tolerancia a acentos/alias, y passthrough internacional de Oriana.
 */
import assert from 'node:assert';
import { ADVISORS, DUPLAS, resolveDupla, duplaAdvisors, advisorByPhone } from '../src/units/oxford-education/advisor-zones.js';
import { normalizePhone } from '../src/utils/phone.js';

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };

// ── 1. Dupla → asesores ───────────────────────────────────────────────────────
console.log('\n== Duplas ==');
for (const k of ['A', 'B', 'C', 'D']) {
  const advs = duplaAdvisors(k).map((a) => a.nombre);
  console.log(`  Dupla ${k}: ${advs.join('  ↔  ')}`);
  assert.strictEqual(advs.length, 2);
}
ok('Cada dupla tiene 2 asesores');

// ── 2. Cobertura de los 32 estados ────────────────────────────────────────────
const STATES = [
  ['Sonora','A'],['Chihuahua','A'],['Coahuila','A'],['Nuevo León','A'],['Sinaloa','A'],['Baja California','A'],['Baja California Sur','A'],
  ['Estado de México','B'],['Puebla','B'],['Morelos','B'],['Michoacán','B'],['Colima','B'],['Jalisco','B'],['Nayarit','B'],['Aguascalientes','B'],
  ['Guerrero','C'],['Oaxaca','C'],['Veracruz','C'],['Tabasco','C'],['Chiapas','C'],['Campeche','C'],['Yucatán','C'],['Quintana Roo','C'],
  ['Tlaxcala','D'],['Hidalgo','D'],['Querétaro','D'],['Guanajuato','D'],['San Luis Potosí','D'],['Zacatecas','D'],['Tamaulipas','D'],['Durango','D'],
];
let stateGaps = [];
for (const [name, expected] of STATES) {
  const got = resolveDupla(name, null);
  if (got !== expected) stateGaps.push(`${name}: esperado ${expected}, obtuvo ${got}`);
}
assert.strictEqual(stateGaps.length, 0, 'Gaps de estado: ' + stateGaps.join(' | '));
ok(`31 estados (+ Edo. México) mapean correctamente; CDMX se resuelve por alcaldía`);

// ── 3. Cobertura de las 16 alcaldías de CDMX ──────────────────────────────────
const ALCALDIAS = [
  ['Álvaro Obregón','A'],['Benito Juárez','A'],['Iztacalco','A'],['Coyoacán','A'],['Tlalpan','A'],
  ['Cuajimalpa','B'],
  ['Magdalena Contreras','C'],['Milpa Alta','C'],['Tláhuac','C'],['Iztapalapa','C'],['Xochimilco','C'],
  ['Miguel Hidalgo','D'],['Cuauhtémoc','D'],['Venustiano Carranza','D'],['Azcapotzalco','D'],['Gustavo A. Madero','D'],
];
let alcGaps = [];
for (const [name, expected] of ALCALDIAS) {
  const got = resolveDupla('CDMX', name);
  if (got !== expected) alcGaps.push(`${name}: esperado ${expected}, obtuvo ${got}`);
}
assert.strictEqual(alcGaps.length, 0, 'Gaps de alcaldía: ' + alcGaps.join(' | '));
ok('16 alcaldías de CDMX mapean (Cuajimalpa → B, excepción intencional)');

// ── 4. Edomex default + tolerancia a acentos/alias ────────────────────────────
assert.strictEqual(resolveDupla('Estado de México', 'Ecatepec'), 'B'); // no listado → default B
assert.strictEqual(resolveDupla('Edomex', 'Nezahualcóyotl'), 'B');
ok('Cualquier municipio de Edo. México (listado o no) → dupla B');

assert.strictEqual(resolveDupla('ciudad de mexico', 'gam'), 'D');       // alias GAM
assert.strictEqual(resolveDupla('CDMX', 'Álvaro Obregón'), 'A');        // acentos
assert.strictEqual(resolveDupla('SLP', null), 'D');                     // alias estado
assert.strictEqual(resolveDupla('Nuevo Leon', null), 'A');             // sin acento
assert.strictEqual(resolveDupla('df', 'benito juarez'), 'A');          // df + minúsculas
assert.strictEqual(resolveDupla(null, 'Coyoacán'), 'A');               // solo alcaldía → infiere CDMX
ok('Tolerante a acentos, mayúsculas y alias (CDMX/DF, GAM, SLP, etc.)');

// ── 5. Fuera de zona / internacional → null (dispara fallback) ────────────────
assert.strictEqual(resolveDupla('Florida', null), null);
assert.strictEqual(resolveDupla('USA', 'Miami'), null);
assert.strictEqual(resolveDupla('CDMX', null), null);                   // CDMX sin alcaldía
ok('Leads sin zona resoluble → null (→ OXED_FOREIGN_LEAD_FALLBACK)');

// ── 6. advisorByPhone (whitelist de comandos) ─────────────────────────────────
for (const a of Object.values(ADVISORS)) {
  const noPlus = normalizePhone(a.whatsapp).replace('+', '');
  const found = advisorByPhone(noPlus);
  assert.ok(found && found.nombre === a.nombre, `advisorByPhone falló para ${a.nombre}`);
}
ok('advisorByPhone reconoce a los 8 asesores (incluida Oriana internacional)');

// ── 7. Oriana conserva su número internacional (envío de prueba, dry-run) ─────
console.log('\n== Formato de número para envío (normalizePhone → sin +) ==');
const samples = [ADVISORS.oriana, ADVISORS.enrique, ADVISORS.rosaura];
for (const a of samples) {
  const toSend = normalizePhone(a.whatsapp).replace('+', '');
  console.log(`  ${a.nombre.padEnd(20)} ${a.whatsapp.padEnd(14)} → to="${toSend}"`);
}
const orianaSend = normalizePhone(ADVISORS.oriana.whatsapp).replace('+', '');
assert.strictEqual(orianaSend, '17866332282', 'Oriana debe conservar +1 (17866332282), NO +52');
assert.ok(!orianaSend.startsWith('52'), 'Oriana NUNCA debe llevar prefijo 52');
const enriqueSend = normalizePhone(ADVISORS.enrique.whatsapp).replace('+', '');
assert.strictEqual(enriqueSend, '5215532676181', 'Enrique (MX 10 díg) → 521...');
ok('Oriana intacta (+1 / 17866332282); MX recibe 521. NINGÚN mensaje real enviado.');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
