/**
 * Script to fix Rising Stars pricing rows in Google Sheets
 */

import { updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function fixRisingStarsPrices() {
  try {
    console.log('🔧 Fixing Rising Stars pricing rows...\n');

    // Update the last 2 rows with correct structure
    // Row 16 = A17:I17 (WIN2027-PS)
    // Row 17 = A18:I18 (WIN2027-PH)

    const risingStarsPrices = [
      ['TODOS', 'Windsor', 'Hotel', 'WIN2027-PS', 'Por definir', 'Por definir', 'Por definir', 'Por definir', 'Rising Stars Primaria/Secundaria - Beca 50% - Legoland Resort Hotel'],
      ['TODOS', 'Windsor', 'Hotel', 'WIN2027-PH', 'Por definir', 'Por definir', 'Por definir', 'Por definir', 'Rising Stars Preparatoria/Higher Ed - Beca 50% - Legoland Resort Hotel'],
    ];

    await updateRange(SPREADSHEET_ID, 'Precios!A17:I18', risingStarsPrices);

    console.log('✅ Rising Stars pricing rows corrected!');
    console.log('   • WIN2027-PS: TODOS | Windsor | Hotel | Código Viaje: WIN2027-PS');
    console.log('   • WIN2027-PH: TODOS | Windsor | Hotel | Código Viaje: WIN2027-PH');
    console.log('\n📝 Estos precios están marcados como "Por definir" para que los actualices después.\n');

  } catch (error) {
    console.error('❌ Error fixing prices:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

fixRisingStarsPrices();
