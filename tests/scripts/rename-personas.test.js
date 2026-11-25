import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRenames, planRestore, colLetter } from '../../scripts/lib/rename-personas.mjs';

const tabs = {
  'Flujo Miri': [
    ['ID', 'Estado', 'Texto', 'Destino opción 1', 'Notas'],
    ['bienvenida', '', '¡Hola! Soy Miri, del equipo de Oxford Education & Travel ✈️', '', 'Mismo patrón que Ori y Miri'],
    ['handoff_rs', '', 'Te atiende Miriana Galdos 😊', '', ''],
    ['x', '', 'Estoy encantada de ayudarte', '', ''],
  ],
  'Flujo Ori': [['ID', 'Texto'], ['bienvenida', 'Hola, soy Ori de Oxford Education']],
  Leads: [['Nombre'], ['Miri Pérez']],
};

test('dry-run: cambia texto visible, respeta Notas, Miriana y pestañas con datos', () => {
  const { changes, flags } = planRenames(tabs);
  assert.deepEqual(changes.map((c) => `${c.tab}!${c.cell}`), ['Flujo Miri!C2', 'Flujo Ori!B2']);
  assert.equal(changes[0].after, '¡Hola! Soy Ed, del equipo de Oxford Education & Travel ✈️');
  assert.equal(changes[1].after, 'Hola, soy Ox de Oxford Education');
  assert.deepEqual(flags.map((f) => f.cell), ['C4'], 'el femenino de Ed se reporta, no se cambia');
});

test('--include-notes también toca Notas', () => {
  const { changes } = planRenames(tabs, { includeNotes: true });
  const nota = changes.find((c) => c.cell === 'E2');
  assert.equal(nota.after, 'Mismo patrón que Ori y Ed', 'en Flujo Miri solo cambia Miri');
});

test('restore solo regresa celdas que nadie editó después', () => {
  const backup = [
    { tab: 'Flujo Miri', cell: 'C2', before: 'Soy Miri', after: 'Soy Ed' },
    { tab: 'Flujo Ori', cell: 'B2', before: 'soy Ori', after: 'soy Ox' },
  ];
  const now = { 'Flujo Miri!C2': 'Soy Ed', 'Flujo Ori!B2': 'soy Ox, editado por el cliente' };
  const { restore, skipped } = planRestore(backup, (t, c) => now[`${t}!${c}`]);
  assert.deepEqual(restore.map((c) => c.cell), ['C2']);
  assert.deepEqual(skipped.map((c) => c.cell), ['B2']);
});

test('colLetter', () => {
  assert.equal(colLetter(0), 'A'); assert.equal(colLetter(25), 'Z'); assert.equal(colLetter(26), 'AA');
});
