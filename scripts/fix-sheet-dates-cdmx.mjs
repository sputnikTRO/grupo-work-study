#!/usr/bin/env node
/**
 * fix-sheet-dates-cdmx.mjs — utilidad MANUAL (no se importa en la app).
 *
 * Reescribe las fechas VIEJAS de las hojas que usa el equipo, de UTC
 * ("2026-11-11T04:11:23.000Z") a hora de la Ciudad de México
 * ("2026-11-10 22:11"). Las filas nuevas ya se escriben así (core/sheets/format.js);
 * esto solo empareja las que se escribieron antes.
 *
 * Qué toca — y nada más:
 *   - "Leads Oxford":     Timestamp · Hora asignación inicial · Hora confirmación
 *   - "Tiempos asesores": Fecha/hora del lead
 *   - "Leads" (Miri):     Fecha · Última Actualización
 *   Las columnas se ubican POR NOMBRE de encabezado, no por letra. Solo se cambia
 *   una celda si su contenido es exactamente una fecha ISO en UTC; cualquier otra
 *   cosa (vacía, ya convertida, texto escrito a mano) se deja intacta. No agrega,
 *   borra ni reordena filas o columnas.
 *
 * SALVAGUARDAS
 *   1. DRY-RUN por default: sin --confirm abre el Sheet en SOLO LECTURA y solo
 *      imprime qué cambiaría.
 *   2. Con --confirm respalda primero los valores originales en
 *      scratchpad/sheet-dates-backup-<timestamp>.json; si el respaldo falla, aborta.
 *   3. Es idempotente: una segunda corrida no encuentra nada que cambiar.
 *
 * Uso:
 *   node scripts/fix-sheet-dates-cdmx.mjs             # dry-run
 *   node scripts/fix-sheet-dates-cdmx.mjs --confirm   # respalda y escribe
 *   node scripts/fix-sheet-dates-cdmx.mjs --restore scratchpad/sheet-dates-backup-….json
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { formatCdmx, ISO_UTC_RE } from '../src/core/sheets/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPREADSHEET_ID = process.env.OXED_SHEETS_ID || process.env.GOOGLE_SHEETS_ID;
const TARGETS = [
  { tab: process.env.OXED_LEADS_SHEET_NAME || 'Leads Oxford', headers: ['Timestamp', 'Hora asignación inicial', 'Hora confirmación'] },
  { tab: 'Tiempos asesores', headers: ['Fecha/hora del lead'] },
  { tab: 'Leads', headers: ['Fecha', 'Última Actualización'] },
];

function colLetter(index) {
  let n = index; let letter = '';
  do { letter = String.fromCharCode(65 + (n % 26)) + letter; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return letter;
}

function sheetsApi(write) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key || !SPREADSHEET_ID) { console.error('✖ Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_SHEETS_ID'); process.exit(1); }
  const scope = write ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly';
  return google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key: key.replace(/\\n/g, '\n'), scopes: [scope] }) });
}

/** Lee las hojas y arma la lista de celdas a cambiar. No escribe nada. */
export async function planChanges(api) {
  const changes = [];
  const notes = [];
  for (const { tab, headers } of TARGETS) {
    let values;
    try {
      values = (await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values || [];
    } catch (e) { notes.push(`"${tab}": no se pudo leer (${e.errors?.[0]?.message || e.message}) — se omite`); continue; }
    const head = values[0] || [];
    for (const h of headers) {
      const col = head.indexOf(h);
      if (col === -1) { notes.push(`"${tab}": no existe la columna "${h}" — se omite`); continue; }
      let n = 0;
      values.slice(1).forEach((row, i) => {
        const before = row[col];
        if (typeof before !== 'string' || !ISO_UTC_RE.test(before)) return;
        const after = formatCdmx(before);
        if (!after) return;
        changes.push({ tab, header: h, range: `'${tab}'!${colLetter(col)}${i + 2}`, before, after });
        n++;
      });
      notes.push(`"${tab}" · ${h} (columna ${colLetter(col)}): ${n} de ${values.length - 1} celdas`);
    }
  }
  return { changes, notes };
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const restoreIdx = args.indexOf('--restore');

  if (restoreIdx !== -1) {
    const file = args[restoreIdx + 1];
    if (!file || !fs.existsSync(file)) { console.error('✖ Indica el archivo de respaldo: --restore <archivo.json>'); process.exit(1); }
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    const api = sheetsApi(true);
    await api.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: backup.changes.map((c) => ({ range: c.range, values: [[c.before]] })) } });
    console.log(`✔ Restauradas ${backup.changes.length} celdas a su valor original desde ${file}`);
    return;
  }

  console.log(`\nFechas UTC → hora CDMX · ${confirm ? 'ESCRITURA (--confirm)' : 'DRY-RUN (no escribe nada)'}\n`);
  const { changes, notes } = await planChanges(sheetsApi(false));
  for (const n of notes) console.log(`  ${n}`);
  console.log(`\n  Total: ${changes.length} celdas por cambiar.`);
  for (const c of changes.filter((_, i) => i < 3 || i >= changes.length - 2)) console.log(`    ${c.range.padEnd(26)} ${c.before}  →  ${c.after}`);

  if (!confirm) { console.log('\nNo se escribió nada. Para aplicar: node scripts/fix-sheet-dates-cdmx.mjs --confirm\n'); return; }
  if (changes.length === 0) { console.log('\nNada que cambiar.\n'); return; }

  const dir = path.join(ROOT, 'scratchpad');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `sheet-dates-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ spreadsheetId: SPREADSHEET_ID, respaldadoEl: new Date().toISOString(), changes }, null, 2));
  if (JSON.parse(fs.readFileSync(file, 'utf8')).changes.length !== changes.length) { console.error('✖ El respaldo no cuadra — no se escribe nada.'); process.exit(1); }
  console.log(`\n  Respaldo: ${file}`);

  const api = sheetsApi(true);
  // RAW: el texto se guarda tal cual (Sheets no lo convierte a su formato regional).
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: changes.map((c) => ({ range: c.range, values: [[c.after]] })) } });
  const again = await planChanges(sheetsApi(false));
  console.log(`✔ Escritas ${changes.length} celdas. Verificación: quedan ${again.changes.length} fechas en UTC.`);
  console.log(`  Para deshacer: node scripts/fix-sheet-dates-cdmx.mjs --restore ${path.relative(ROOT, file)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('✖', e.message); process.exit(1); });
}
