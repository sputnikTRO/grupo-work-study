/**
 * Reemplazo en memoria de src/core/sheets/client.js para los evals.
 *
 * Mismas firmas y mismo formato de salida que el cliente real (readSheet →
 * objetos por encabezado, readRange → matriz), pero leyendo de los fixtures:
 *   - evals/fixtures/sheets.json      snapshot de las pestañas de contenido
 *   - evals/fixtures/enrollment.json  hoja de inscritos SINTÉTICA
 * Las escrituras (sync de leads, tiempos de asesoras) quedan en memoria y se
 * pueden inspeccionar vía WRITES; nunca salen a Google.
 */
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export const SPREADSHEET_IDS = {
  main: 'eval-main',
  prices: 'eval-prices',
  enrollment: 'eval-enrollment',
};

let BOOKS;
export const WRITES = [];

export function resetSheets() {
  const snap = load('sheets.json');
  const enrollment = load('enrollment.json');
  BOOKS = {
    [SPREADSHEET_IDS.main]: structuredClone(snap.main),
    [SPREADSHEET_IDS.prices]: structuredClone(snap.prices),
    [SPREADSHEET_IDS.enrollment]: structuredClone(enrollment.tabs),
  };
  WRITES.length = 0;
}
resetSheets();

function book(id) {
  if (!BOOKS[id]) BOOKS[id] = {};
  return BOOKS[id];
}

/** "'Tab'!A:H" · "Tab!1:1" · "'Tab'" → "Tab". */
function tabOf(range) {
  const raw = String(range).split('!')[0];
  return raw.replace(/^'(.*)'$/, '$1');
}

function toObjects(rows) {
  if (!rows?.length) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((r) => r.length > 0)
    .map((r) => Object.fromEntries(headers.map((h, i) => [String(h).trim(), r[i] !== undefined ? String(r[i]).trim() : null])));
}

export async function readSheet(spreadsheetId, sheetName) {
  return toObjects(book(spreadsheetId)[sheetName] || []);
}

export async function readMultipleSheets(spreadsheetId, sheetNames) {
  const out = {};
  for (const name of sheetNames) out[name] = await readSheet(spreadsheetId, name);
  return out;
}

export async function getSpreadsheetMetadata(spreadsheetId) {
  const titles = Object.keys(book(spreadsheetId));
  return { title: `eval ${spreadsheetId}`, sheets: titles.map((title, i) => ({ title, sheetId: i, index: i })) };
}

export async function readRange(spreadsheetId, range) {
  const rows = book(spreadsheetId)[tabOf(range)] || [];
  // Rango de una fila ("Tab!1:1"): el llamador solo quiere los encabezados.
  const oneRow = String(range).match(/!(\d+):\1$/);
  if (oneRow) return rows.slice(Number(oneRow[1]) - 1, Number(oneRow[1])).map((r) => [...r]);
  return rows.map((r) => [...r]);
}

export async function sheetExists(spreadsheetId, sheetTitle) {
  return sheetTitle in book(spreadsheetId);
}

export async function createSheet(spreadsheetId, sheetTitle) {
  book(spreadsheetId)[sheetTitle] ||= [];
  WRITES.push({ op: 'createSheet', spreadsheetId, sheetTitle });
  return { sheetId: 0, title: sheetTitle };
}

export async function appendRow(spreadsheetId, sheetName, rowData) {
  (book(spreadsheetId)[sheetName] ||= []).push([...rowData].map((v) => (v == null ? '' : String(v))));
  WRITES.push({ op: 'appendRow', spreadsheetId, sheetName });
  return {};
}

export async function appendRows(spreadsheetId, sheetName, rowsData) {
  for (const r of rowsData) await appendRow(spreadsheetId, sheetName, r);
  return {};
}

export async function updateRow(spreadsheetId, sheetName, rowNumber, rowData) {
  const rows = (book(spreadsheetId)[sheetName] ||= []);
  rows[rowNumber - 1] = [...rowData].map((v) => (v == null ? '' : String(v)));
  WRITES.push({ op: 'updateRow', spreadsheetId, sheetName, rowNumber });
  return {};
}

export async function updateRange(spreadsheetId, range, values) {
  WRITES.push({ op: 'updateRange', spreadsheetId, range, rows: values?.length || 0 });
  return {};
}

/** Igual que Sheets: el apóstrofo de "forzar texto" no se guarda, así que se busca sin él. */
export async function findRowByColumn(spreadsheetId, sheetName, columnIndex, searchValue) {
  const rows = book(spreadsheetId)[sheetName] || [];
  const needle = String(searchValue).replace(/^'/, '');
  const i = rows.findIndex((r, idx) => idx > 0 && String(r[columnIndex] ?? '').replace(/^'/, '') === needle);
  return i >= 0 ? i + 1 : null;
}
