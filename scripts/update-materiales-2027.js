/**
 * One-time script: replace Materiales sheet with 2027 PDFs
 * and clear stale LON2026 data from Actividades Extra.
 *
 * Run: node scripts/update-materiales-2027.js
 */

import 'dotenv/config';
import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ── New Materiales data ────────────────────────────────────────────────────
const HEADERS = ['ID', 'Nombre', 'Tipo', 'URL', 'Código Viaje', 'Código Colegio', 'Descripción'];

const MATERIALES = [
  [
    'JDP_LONDRES_2027',
    'Presentación English 4 Life Londres 2027',
    'PDF',
    'https://drive.google.com/uc?id=1ghCQNjhclQjCNRZua0SMuqAtfch4YGUk&export=download',
    'LON2027',
    'TODOS',
    'Presentación completa del programa E4L Londres 2027 - Junta de Padres',
  ],
  [
    'JDP_DUBLIN_2027',
    'Presentación English 4 Life Dublín 2027',
    'PDF',
    'https://drive.google.com/uc?id=1vs04wAaEBQ3E4QMam3vcXee7wCBOLA7l&export=download',
    'DUB2027',
    'TODOS',
    'Presentación completa del programa E4L Dublín 2027 - Junta de Padres',
  ],
  [
    'RISING_STARS_2027',
    'Presentación Rising Stars 2027',
    'PDF',
    'https://drive.google.com/uc?id=1SrRH6cH3Bh-vELh9tsPez7V9VsyKtZ4J&export=download',
    'WIN2027-PS',
    'TODOS',
    'Presentación del programa Rising Stars 2027 - Windsor UK',
  ],
];

async function clearAndWriteSheet(sheetName, headers, rows) {
  // Clear all content (keep the sheet itself)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  console.log(`  ✓ Cleared ${sheetName}`);

  // Write header + data rows in one call
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers, ...rows] },
  });
  console.log(`  ✓ Wrote ${rows.length} row(s) to ${sheetName}`);
}

async function clearActivitiesSheet() {
  // Read current data first to inspect
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Actividades Extra!A:Z',
  });
  const rows = res.data.values || [];
  console.log(`  Actividades Extra: ${rows.length - 1} data rows found`);

  // Clear all data rows (keep header row 1)
  if (rows.length > 1) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Actividades Extra!A2:Z',
    });
    console.log('  ✓ Cleared stale LON2026 activities (header kept)');
  } else {
    console.log('  ✓ Actividades Extra already empty, nothing to clear');
  }
}

async function main() {
  console.log('=== Updating Google Sheets for 2027 ===\n');

  console.log('1. Replacing Materiales sheet...');
  await clearAndWriteSheet('Materiales', HEADERS, MATERIALES);

  console.log('\n2. Clearing stale Actividades Extra (LON2026)...');
  await clearActivitiesSheet();

  console.log('\n✅ Done. Run /admin/refresh-sheets-cache to reload the cache.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
