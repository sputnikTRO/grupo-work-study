#!/usr/bin/env node
/**
 * Cambia "Ori" → "Ox" y "Miri" → "Ed" en las pestañas de contenido del Sheet.
 *
 *   node scripts/rename-sheet-personas.mjs                    → dry-run: celda por celda, antes y después
 *   node scripts/rename-sheet-personas.mjs --include-notes    → también la columna Notas (solo la ve quien edita)
 *   node scripts/rename-sheet-personas.mjs --confirm          → guarda respaldo en scratchpad/ y escribe
 *   node scripts/rename-sheet-personas.mjs --restore <archivo> [--confirm]
 *        → regresa las celdas del respaldo (solo las que nadie editó después); dry-run sin --confirm
 *
 * Requiere GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY.
 * Nunca lee pestañas con datos de personas (Leads, INSCRITOS): ver TAB_RULES.
 */
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { TAB_RULES, planRenames, planRestore } from './lib/rename-personas.mjs';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const INCLUDE_NOTES = args.includes('--include-notes');
const restoreIdx = args.indexOf('--restore');
const RESTORE_FILE = restoreIdx >= 0 ? args[restoreIdx + 1] : null;

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
  console.error('Faltan GOOGLE_SHEETS_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY');
  process.exit(2);
}

const auth = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  [CONFIRM ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
);
await auth.authorize();
const sheets = google.sheets({ version: 'v4', auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId });
const present = new Set(meta.data.sheets.map((s) => s.properties.title));
const tabNames = Object.keys(TAB_RULES).filter((t) => present.has(t));
const resp = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabNames.map((t) => `'${t}'`) });
const tabs = Object.fromEntries(tabNames.map((t, i) => [t, resp.data.valueRanges[i].values || []]));

const cellValue = (tab, cell) => {
  const m = /^([A-Z]+)(\d+)$/.exec(cell);
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return tabs[tab]?.[Number(m[2]) - 1]?.[col] ?? '';
};
const show = (s) => JSON.stringify(s.length > 160 ? `${s.slice(0, 160)}…` : s);

async function write(changes, field) {
  const data = changes.map((c) => ({ range: `'${c.tab}'!${c.cell}`, values: [[c[field]]] }));
  for (let i = 0; i < data.length; i += 200) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: data.slice(i, i + 200) } });
  }
}

if (RESTORE_FILE) {
  const backup = JSON.parse(fs.readFileSync(RESTORE_FILE, 'utf8'));
  if (backup.spreadsheetId !== spreadsheetId) { console.error('El respaldo es de otro spreadsheet. Abortado.'); process.exit(3); }
  const { restore, skipped } = planRestore(backup.changes, cellValue);
  console.log(`Restaurar desde ${RESTORE_FILE}: ${restore.length} celda(s) a regresar, ${skipped.length} editada(s) después (no se tocan).`);
  for (const s of skipped) console.log(`  ⚠️  ${s.tab}!${s.cell} cambió después del renombre; se deja como está: ${show(s.now)}`);
  for (const c of restore) console.log(`  ${c.tab}!${c.cell}: ${show(c.after)} → ${show(c.before)}`);
  if (!CONFIRM) { console.log('\nDRY-RUN: no se escribió nada. Agrega --confirm para restaurar.'); process.exit(0); }
  await write(restore, 'before');
  console.log(`\n✅ Restauradas ${restore.length} celda(s).`);
  process.exit(0);
}

const { changes, flags } = planRenames(tabs, { includeNotes: INCLUDE_NOTES });
console.log(`Pestañas revisadas: ${tabNames.join(', ')}${INCLUDE_NOTES ? ' (incluye Notas)' : ' (sin Notas; usa --include-notes)'}`);
console.log(`\n${changes.length} celda(s) cambian:`);
for (const c of changes) console.log(`\n  ${c.tab}!${c.cell}\n    antes:   ${show(c.before)}\n    después: ${show(c.after)}`);
if (flags.length) {
  console.log(`\n${flags.length} celda(s) de Ed con posible femenino para revisar A MANO (el script no las cambia):`);
  for (const f of flags) console.log(`  ${f.tab}!${f.cell}: ${show(f.text)}`);
}
if (!CONFIRM) { console.log('\nDRY-RUN: no se escribió nada. Agrega --confirm para aplicar.'); process.exit(0); }
if (!changes.length) { console.log('\nNada que cambiar.'); process.exit(0); }

const dir = path.resolve('scratchpad');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `backup-rename-personas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify({ spreadsheetId, createdAt: new Date().toISOString(), changes }, null, 2));
console.log(`\nRespaldo: ${file}`);
await write(changes, 'after');
console.log(`✅ ${changes.length} celda(s) actualizadas. Para deshacer: node scripts/rename-sheet-personas.mjs --restore ${path.relative(process.cwd(), file)} --confirm`);
