/**
 * Verifies Oxford Sheets logging against the real spreadsheet:
 * creates the dedicated tab + headers (if needed), writes a sample row,
 * reads it back, and prints the shareable URL (with the tab gid).
 *
 * Pass `--clean` to remove the sample data row afterwards.
 */
import { google } from 'googleapis';
import { env } from '../src/config/env.js';
import { syncOxfordLeadToSheet } from '../src/units/oxford-education/sheets-sync.js';
import { readSheet, getSpreadsheetMetadata } from '../src/core/sheets/client.js';

const SAMPLE_ID = 'SAMPLE-VERIFY-ROW';

const sampleLead = {
  id: SAMPLE_ID,
  updatedAt: new Date(),
  fullName: 'Ejemplo (verificación)',
  institutionName: 'Colegio Demo',
  role: 'Coordinador académico',
  leadType: 'b2b_institutional',
  primaryProduct: 'oxford_tcc',
  estimatedStudents: 120,
  status: 'interesado',
  temperature: 'hot',
};
const sampleContact = { phone: '+5215500000000', name: 'Ejemplo' };
const sampleConv = { id: 'verify-conv' };

await syncOxfordLeadToSheet(sampleLead, sampleContact, sampleConv, {
  handoffOccurred: true,
  summary: 'Cliente: me interesa Oxford TCC para mi colegio | Ori: con gusto, una asesora te dará la cotización',
});

const meta = await getSpreadsheetMetadata(env.OXED_SHEETS_ID);
const tab = meta.sheets.find((s) => s.title === env.OXED_LEADS_SHEET_NAME);
const rows = await readSheet(env.OXED_SHEETS_ID, env.OXED_LEADS_SHEET_NAME);

console.log('\n=== Oxford leads sheet ===');
console.log('Spreadsheet title :', meta.title);
console.log('Tab               :', env.OXED_LEADS_SHEET_NAME, '(gid=' + tab?.sheetId + ')');
console.log('Row count (data)  :', rows.length);
console.log('Headers           :', Object.keys(rows[0] || {}).join(' | '));
console.log('Sample row        :', JSON.stringify(rows.find((r) => r.ID === SAMPLE_ID) || rows[rows.length - 1]));
console.log('URL               : https://docs.google.com/spreadsheets/d/' + env.OXED_SHEETS_ID + '/edit#gid=' + tab?.sheetId);

if (process.argv.includes('--clean')) {
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_PRIVATE_KEY },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  // Re-read raw to find the sample row's 1-based index.
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: env.OXED_SHEETS_ID, range: `${env.OXED_LEADS_SHEET_NAME}!A:A` });
  const vals = resp.data.values || [];
  const idx = vals.findIndex((r) => r[0] === SAMPLE_ID); // 0-based incl header
  if (idx > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.OXED_SHEETS_ID,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } } }] },
    });
    console.log('Sample row removed (clean).');
  }
}

process.exit(0);
