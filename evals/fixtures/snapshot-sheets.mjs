/**
 * Snapshot SOLO-LECTURA de las pestañas de CONTENIDO que usan Ori y Miri, para
 * que los evals corran contra el mismo guion/FAQ/precios que prod sin tocar
 * Google en cada corrida.
 *
 *   node evals/fixtures/snapshot-sheets.mjs
 *
 * Escribe evals/fixtures/sheets.json. Qué NO se snapshotea, a propósito:
 *   - "Leads" / "Leads Oxford" y las pestañas de tiempos: datos de prospectos.
 *   - La hoja de INSCRITOS (TRAVEL_ENROLLMENT_SHEETS_ID): montos de familias con
 *     menores de por medio. Los evals usan evals/fixtures/enrollment.json, sintético.
 *
 * Usa el scope spreadsheets.readonly: aunque el código tuviera un bug, este
 * script no puede escribir en ninguna hoja.
 */
import { google } from 'googleapis';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const MAIN_TABS = [
  'Viajes', 'Precios', 'Colegios', 'Actividades Extra', 'Info General',
  'Materiales', 'FAQ Oxford', 'Flujo Ori', 'Flujo Miri',
];
const PRICES_ID = process.env.TRAVEL_PRICES_SHEETS_ID || '1GggWKDSpg8IaAbUQtEtj03QKYRJY9d_lJmfFpq7hU0c';
const PRICES_TAB = 'CONDICIONES POLÍTICAS';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function readTab(spreadsheetId, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'` });
    return res.data.values || [];
  } catch (err) {
    console.warn(`  ! ${tab}: ${err.message}`);
    return [];
  }
}

// Columnas con datos de contacto del equipo: se enmascaran. Los evals nunca
// mandan nada real, pero el fixture se commitea y no tiene por qué llevarlos.
const SCRUB = [
  [/whatsapp|tel[eé]fono|celular/i, (i) => `52155000000${String(i).padStart(2, '0')}`],
  [/e-?mail|correo/i, (i) => `asesora${i}@eval.invalid`],
];

function scrub(rows) {
  if (!rows.length) return rows;
  const fixes = rows[0].map((h) => SCRUB.find(([re]) => re.test(h))?.[1]);
  return rows.map((r, i) => (i === 0 ? r : r.map((v, c) => (fixes[c] && v ? fixes[c](i) : v))));
}

const out = { main: {}, prices: {} };
for (const tab of MAIN_TABS) {
  out.main[tab] = scrub(await readTab(process.env.GOOGLE_SHEETS_ID, tab));
  console.log(`main/${tab}: ${out.main[tab].length} filas`);
}
out.prices[PRICES_TAB] = await readTab(PRICES_ID, PRICES_TAB);
console.log(`prices/${PRICES_TAB}: ${out.prices[PRICES_TAB].length} filas`);

out.snapshotAt = new Date().toISOString();
const dest = fileURLToPath(new URL('./sheets.json', import.meta.url));
writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`→ ${dest}`);
