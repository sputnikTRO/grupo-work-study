#!/usr/bin/env node
/**
 * Siembra lo que necesita el modo W&S OTCC en el Sheet. DRY-RUN por defecto.
 *
 *   node scripts/seed-ws-otcc.mjs                 → muestra qué haría
 *   node scripts/seed-ws-otcc.mjs --confirm       → aplica (guarda respaldo en scratchpad/)
 *   node scripts/seed-ws-otcc.mjs --restore <archivo> [--confirm]
 *        → regresa el texto de filtro_previo (si nadie lo editó después)
 *
 * Qué hace (solo AGREGA, salvo el texto de filtro_previo):
 *   1. Pestaña "FAQ OTCC W&S" desde docs/kb-ws-otcc.md (sección 5). Si ya existe, no se toca.
 *      La tabla de contactos del equipo NO se siembra.
 *   2. "Flujo Ori": agrega los nodos ws_* que falten (textos editables por el cliente).
 *   3. "Flujo Ori": cambia el texto de filtro_previo (opción 1 → "Ya formo parte de un programa").
 *   4. Pestaña "Casos W&S" (spreadsheet OXED_SHEETS_ID) con encabezados, si no existe.
 * Requiere GOOGLE_SHEETS_ID, OXED_SHEETS_ID (opcional), GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY.
 */
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { parseKbDoc } from '../src/units/oxford-education/ws/kb-parse.js';
import { WS_TEXTS } from '../src/units/oxford-education/ws/texts.js';
import { CASES_HEADERS, CASES_SHEET_NAME } from './lib/ws-sheet-constants.mjs';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const restoreIdx = args.indexOf('--restore');
const RESTORE_FILE = restoreIdx >= 0 ? args[restoreIdx + 1] : null;
const MAIN_ID = process.env.GOOGLE_SHEETS_ID;
const OXED_ID = process.env.OXED_SHEETS_ID || MAIN_ID;
if (!MAIN_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
  console.error('Faltan GOOGLE_SHEETS_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY'); process.exit(2);
}

export const FAQ_TAB = 'FAQ OTCC W&S';
const FAQ_HEADER = ['Sección', 'Pregunta', 'Respuesta', 'Orden', 'Activo'];
const FLOW_TAB = 'Flujo Ori';
export const FILTRO_PREVIO_NUEVO = 'Para dirigir tu solicitud, cuéntame: ¿ya formas parte de algún programa o buscas información?\n1.- Ya formo parte de un programa\n2.- Quiero información';
const WS_NODES = [
  ['ws_filtro', 'Filtro W&S. Sale cuando preguntan por OTCC / Oxford TCC (texto libre o menú). Las opciones las maneja el código (1 W&S, 2 no, 3 no estoy seguro); no agregar destinos.'],
  ['ws_filtro_programa', 'Variante del filtro W&S para filtro_previo → 1. Mismas opciones que ws_filtro.'],
  ['ws_no_seguro', 'Texto del documento W&S. 1 sí → modo W&S, 2 no → comercial, 3 → pide datos y canaliza.'],
  ['ws_tema', 'Solo en el camino de filtro_previo. 1 OTCC → modo W&S, 2 otro tema (Life incluido) → ya_inscrito_stub.'],
  ['ws_otcc', 'Texto de entrada al modo W&S (sin volver a presentarse). Después contesta el LLM con la pestaña FAQ OTCC W&S.'],
];

const auth = new google.auth.JWT(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null, process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  [CONFIRM ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly']);
await auth.authorize();
const sheets = google.sheets({ version: 'v4', auth });
const tabsOf = async (id) => new Set((await sheets.spreadsheets.get({ spreadsheetId: id })).data.sheets.map((s) => s.properties.title));
const read = async (id, range) => (await sheets.spreadsheets.values.get({ spreadsheetId: id, range })).data.values || [];
const show = (s) => JSON.stringify(s);

const flow = await read(MAIN_ID, `'${FLOW_TAB}'`);
const header = flow[0] || [];
const col = (name) => header.indexOf(name);
const iId = col('ID'); const iTexto = col('Texto');
const fpIdx = flow.findIndex((r, i) => i > 0 && r[iId] === 'filtro_previo');
const fpCell = fpIdx > 0 ? `${String.fromCharCode(65 + iTexto)}${fpIdx + 1}` : null;

if (RESTORE_FILE) {
  const b = JSON.parse(fs.readFileSync(RESTORE_FILE, 'utf8'));
  const now = flow[fpIdx]?.[iTexto];
  if (now !== b.after) { console.log(`⚠️ filtro_previo cambió después del sembrado; no se toca. Ahora dice: ${show(now)}`); process.exit(0); }
  console.log(`filtro_previo ${fpCell}: ${show(b.after)} → ${show(b.before)}`);
  if (!CONFIRM) { console.log('\nDRY-RUN. Agrega --confirm para restaurar.'); process.exit(0); }
  await sheets.spreadsheets.values.update({ spreadsheetId: MAIN_ID, range: `'${FLOW_TAB}'!${fpCell}`, valueInputOption: 'RAW', requestBody: { values: [[b.before]] } });
  console.log('✅ Restaurado.'); process.exit(0);
}

const kb = parseKbDoc(fs.readFileSync('docs/kb-ws-otcc.md', 'utf8'));
const mainTabs = await tabsOf(MAIN_ID);
const oxedTabs = OXED_ID === MAIN_ID ? mainTabs : await tabsOf(OXED_ID);
const existingIds = new Set(flow.slice(1).map((r) => r[iId]));
const missingNodes = WS_NODES.filter(([id]) => !existingIds.has(id));
const maxOrden = Math.max(0, ...flow.slice(1).map((r) => parseInt(r[col('Orden')], 10) || 0));
const fpBefore = fpIdx > 0 ? flow[fpIdx][iTexto] : null;

console.log(`1. ${FAQ_TAB}: ${mainTabs.has(FAQ_TAB) ? 'YA EXISTE — no se toca' : `NUEVA con ${kb.length} preguntas en ${new Set(kb.map((r) => r.seccion)).size} secciones`}`);
console.log(`2. ${FLOW_TAB}: nodos W&S a agregar: ${missingNodes.map(([id]) => id).join(', ') || '(ninguno, ya están)'}`);
for (const [id] of missingNodes) console.log(`   + ${id}: ${show(WS_TEXTS[id])}`);
console.log(`3. filtro_previo (${fpCell || 'NO ENCONTRADO'}):\n   antes:   ${show(fpBefore)}\n   después: ${show(FILTRO_PREVIO_NUEVO)}${fpBefore === FILTRO_PREVIO_NUEVO ? '  (ya está)' : ''}`);
console.log(`4. ${CASES_SHEET_NAME}: ${oxedTabs.has(CASES_SHEET_NAME) ? 'YA EXISTE' : `NUEVA con encabezados ${show(CASES_HEADERS)}`}`);
if (!CONFIRM) { console.log('\nDRY-RUN: no se escribió nada. Agrega --confirm para aplicar.'); process.exit(0); }

if (!mainTabs.has(FAQ_TAB)) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: MAIN_ID, requestBody: { requests: [{ addSheet: { properties: { title: FAQ_TAB } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: MAIN_ID, range: `'${FAQ_TAB}'!A1`, valueInputOption: 'RAW',
    requestBody: { values: [FAQ_HEADER, ...kb.map((r) => [r.seccion, r.pregunta, r.respuesta, String(r.orden), 'Sí'])] } });
}
if (missingNodes.length) {
  const rows = missingNodes.map(([id, nota], i) => header.map((h) => ({ ID: id, Estado: 'Vigente', Texto: WS_TEXTS[id], Notas: nota, Orden: String(maxOrden + i + 1) }[h] ?? '')));
  await sheets.spreadsheets.values.append({ spreadsheetId: MAIN_ID, range: `'${FLOW_TAB}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows } });
}
if (fpCell && fpBefore !== FILTRO_PREVIO_NUEVO) {
  fs.mkdirSync('scratchpad', { recursive: true });
  const file = path.join('scratchpad', `backup-filtro-previo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ spreadsheetId: MAIN_ID, cell: fpCell, before: fpBefore, after: FILTRO_PREVIO_NUEVO }, null, 2));
  await sheets.spreadsheets.values.update({ spreadsheetId: MAIN_ID, range: `'${FLOW_TAB}'!${fpCell}`, valueInputOption: 'RAW', requestBody: { values: [[FILTRO_PREVIO_NUEVO]] } });
  console.log(`Respaldo de filtro_previo: ${file} (deshacer: --restore ${file} --confirm)`);
}
if (!oxedTabs.has(CASES_SHEET_NAME)) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: OXED_ID, requestBody: { requests: [{ addSheet: { properties: { title: CASES_SHEET_NAME } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: OXED_ID, range: `'${CASES_SHEET_NAME}'!A1`, valueInputOption: 'RAW', requestBody: { values: [CASES_HEADERS] } });
}
console.log('✅ Listo.');
