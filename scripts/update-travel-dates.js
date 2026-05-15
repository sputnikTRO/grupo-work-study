/**
 * Script to update Travel dates in Google Sheets
 * - English 4 Life: "Mayo 2027" (without specific days)
 * - Rising Stars: Keep specific dates
 */

import { updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function updateTravelDates() {
  try {
    console.log('📅 Actualizando fechas en Google Sheets...\n');

    // Update Viajes sheet - only update London and Dublin dates
    // Keep Rising Stars with specific dates
    const viajesUpdates = [
      ['LON2027', 'Londres 2027', 'Viaje English 4 Life a Londres - Programa de inmersión con clases de inglés y actividades culturales', 'Mayo 2027', 'Mayo 2027', 'activo'],
      ['DUB2027', 'Dublín 2027', 'Viaje English 4 Life a Dublín - Programa de inmersión con clases de inglés y actividades culturales', 'Mayo 2027', 'Mayo 2027', 'activo'],
    ];

    // Update rows 2 and 3 (LON2027 and DUB2027)
    await updateRange(SPREADSHEET_ID, 'Viajes!A2:F3', viajesUpdates);

    console.log('✅ Fechas actualizadas:');
    console.log('   • LON2027: Mayo 2027 (sin días específicos)');
    console.log('   • DUB2027: Mayo 2027 (sin días específicos)');
    console.log('   • WIN2027-PS y WIN2027-PH mantienen fechas exactas');
    console.log('\n📝 Si preguntan por día exacto, Miri derivará a asesor.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

updateTravelDates();
