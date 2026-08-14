/**
 * provision-oxford-advisor-sla-sheets.mjs
 *
 * Provisión ÚNICA VEZ (idempotente) de la estructura del SLA de asesor en el
 * spreadsheet de Oxford — SOLO encabezados, CERO datos falsos:
 *   1. "Leads Oxford": reconcilia el header de forma aditiva (agrega las 5
 *      columnas N..R si faltan, sin tocar A..M).
 *   2. "Tiempos asesores": crea la pestaña con su header si no existe.
 *   3. "Resumen asesoras": crea la pestaña con su header si no existe.
 *
 * Normalmente estas pestañas/columnas las crea perezosamente el código de la
 * app (sheets-sync.js / advisor-sla-sheet.js) la PRIMERA VEZ que hay un evento
 * real que escribir. Este script solo adelanta esa creación para que la
 * estructura sea visible antes de que ocurra el primer evento real — no
 * reemplaza ni duplica esa lógica (los headers están copiados literalmente de
 * esos dos archivos; si cambian ahí, actualizar aquí también).
 *
 * Usage:
 *   node scripts/provision-oxford-advisor-sla-sheets.mjs [--dry-run]
 */
import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';

const LEADS_OXFORD_HEADERS = [
  'ID', 'Timestamp', 'Teléfono', 'Nombre', 'Colegio/Organización', 'Rol/Tipo de contacto',
  'Producto de interés', 'No. de alumnos', 'Temperatura', 'Derivación', 'Resumen conversación',
  'Zona (Estado/Municipio)', 'Asesor asignado',
  'Hora asignación inicial', 'Hora confirmación', 'Minutos de respuesta', '# Reasignaciones', 'Asesoras intentadas',
];
const LEADS_OXFORD_SHEET_NAME = process.env.OXED_LEADS_SHEET_NAME || 'Leads Oxford';

const DETAIL_SHEET_NAME = 'Tiempos asesores';
const DETAIL_HEADERS = [
  'Ticket', 'Fecha/hora del lead', 'Prospecto', 'Producto', 'Zona (dupla)',
  'Asesora que atendió', 'Minutos hasta confirmar', '# Reasignaciones', 'Asesoras intentadas', 'Estado final',
];

const SUMMARY_SHEET_NAME = 'Resumen asesoras';
const SUMMARY_HEADERS = [
  'Asesora', 'Leads atendidos', 'Tiempo promedio confirmación (min)',
  'Tiempo mínimo (min)', 'Tiempo máximo (min)', '# Reasignado por no confirmar',
];

function colLetter(index) {
  let n = index, letter = '';
  do { letter = String.fromCharCode(65 + (n % 26)) + letter; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return letter;
}

async function buildSheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeaders(sheets, spreadsheetId, dryRun, sheetName, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === sheetName);

  if (!exists) {
    console.log(`[${sheetName}] No existe.${dryRun ? ' (dry-run: se crearía con header completo)' : ' Creándola...'}`);
    if (dryRun) { console.log(`  Header: ${JSON.stringify(headers)}`); return; }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
    console.log(`[${sheetName}] Creada con ${headers.length} columnas de header.`);
    return;
  }

  const headerResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!1:1` });
  const current = headerResp.data.values?.[0] || [];

  if (current.length >= headers.length) {
    console.log(`[${sheetName}] Ya existe con header completo (${current.length} columnas) — sin cambios.`);
    return;
  }

  const missing = headers.slice(current.length);
  const startCol = colLetter(current.length);
  const endCol = colLetter(headers.length - 1);
  console.log(`[${sheetName}] Existe con ${current.length}/${headers.length} columnas.${dryRun ? ' (dry-run: se agregarían)' : ' Agregando'} ${JSON.stringify(missing)} en ${startCol}1:${endCol}1`);
  if (dryRun) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!${startCol}1:${endCol}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [missing] },
  });
  console.log(`[${sheetName}] Header reconciliado (aditivo) — ${missing.length} columna(s) agregada(s).`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const spreadsheetId = process.env.OXED_SHEETS_ID || process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) { console.error('GOOGLE_SHEETS_ID (o OXED_SHEETS_ID) no configurado.'); process.exit(1); }

  console.log(`Spreadsheet: ${spreadsheetId}${dryRun ? '  [DRY RUN — no se escribe nada]' : ''}\n`);

  const sheets = await buildSheetsClient();

  await ensureHeaders(sheets, spreadsheetId, dryRun, LEADS_OXFORD_SHEET_NAME, LEADS_OXFORD_HEADERS);
  await ensureHeaders(sheets, spreadsheetId, dryRun, DETAIL_SHEET_NAME, DETAIL_HEADERS);
  await ensureHeaders(sheets, spreadsheetId, dryRun, SUMMARY_SHEET_NAME, SUMMARY_HEADERS);

  console.log(`\nListo.${dryRun ? ' (dry-run — nada se escribió)' : ''}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
