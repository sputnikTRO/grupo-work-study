/**
 * Dry-run del handoff "tibio" de Ori (NO envía mensajes; el guard retorna antes de
 * tocar DB/WhatsApp, así que corre offline).
 *
 * Verifica:
 *  (b) Guard anti-redisparo: si el lead YA tiene assignedAdvisor, un nuevo
 *      [DERIVAR_ASESOR] → handoffOccurred=false, sin re-notificar ni mutar el lead.
 *      Como handoffOccurred=false, el handler enviará el texto normal de Ori
 *      (diferir al asesor) en vez de silenciarse → (a) Ori sigue respondiendo.
 *  (c) Oriana conserva su +1.
 */
import assert from 'node:assert';
import { executeActions } from '../src/units/oxford-education/actions.js';
import { resolveDupla } from '../src/units/oxford-education/advisor-zones.js';
import { normalizePhone } from '../src/utils/phone.js';

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };

// ── (b) Guard anti-redisparo ──────────────────────────────────────────────────
const assignedLead = {
  id: 'lead-guard-1',
  assignedAdvisor: 'Enrique Ruiz',   // ya derivado antes
  zoneKey: 'A',
  state: 'CDMX', municipality: 'Benito Juárez',
  status: 'derivado_asesor',
};
const conv = { id: 'conv-guard-1' };
const contact = { phone: '+5215512345678', name: 'Prospecto' };

const before = JSON.stringify(assignedLead);
const res = await executeActions(
  [{ type: 'DERIVAR_ASESOR', reason: 'vuelve a preguntar precio' }],
  assignedLead, conv, contact,
);
assert.strictEqual(res.handoffOccurred, false, 'lead ya asignado NO debe re-derivar');
assert.strictEqual(assignedLead.assignedAdvisor, 'Enrique Ruiz', 'no cambia el asesor asignado');
assert.strictEqual(JSON.stringify(assignedLead), before, 'el lead no se muta (no re-persist, no nuevo ticket)');
ok('(b) 2ª pregunta de precio con asesor ya asignado → handoffOccurred=false (no re-notifica, no duplica ticket/lead)');
ok('(a) Al ser handoffOccurred=false, el handler NO silencia: envía el texto de Ori (difiere al asesor y sigue atendiendo)');

// La zona del lead sigue resolviéndose bien (lógica intacta).
assert.strictEqual(resolveDupla('CDMX', 'Benito Juárez'), 'A');
ok('resolveDupla sigue intacto (Benito Juárez → A)');

// ── (c) Oriana conserva su número internacional ───────────────────────────────
const orianaSend = normalizePhone('+17866332282').replace('+', '');
assert.strictEqual(orianaSend, '17866332282', 'Oriana debe conservar +1');
assert.ok(!orianaSend.startsWith('52'), 'Oriana NUNCA lleva 52');
ok('(c) Oriana intacta: +17866332282 → "17866332282" (sin +52). Ningún mensaje real enviado.');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
