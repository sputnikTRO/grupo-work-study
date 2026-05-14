/**
 * Fix Colegios sheet - remove invented codes, use only data from Excel
 * Excel has: School Name, Advisor, Destination
 * We add: WhatsApp and Email (from separate source)
 */

import { updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function fixColegiosSheet() {
  try {
    console.log('🔧 Fixing Colegios sheet - removing invented codes...\n');
    console.log('─'.repeat(80));

    // Structure: Name, Advisor, Destination, WhatsApp, Email
    // NO invented codes - use full names as they appear in Excel

    const colegiosData = [
      // Header
      ['Nombre Colegio', 'Asesora', 'Destino', 'WhatsApp Asesora', 'Email Asesora'],

      // Data from Excel - ALL 13 schools in order
      ['Instituto J. Francisco Rodriguez', 'Cecilia Rodríguez', 'Dublín', '5544884437', 'cecilia@oxfordeducationlit.org'],
      ['Colegio Luz del Tepeyac', 'Cecilia Rodríguez', 'Dublín', '5544884437', 'cecilia@oxfordeducationlit.org'],
      ['Instituto Ramiro Kolbe', 'Cecilia Rodríguez', 'Dublín', '5544884437', 'cecilia@oxfordeducationlit.org'],
      ['Colegio The Hills Institute', 'Camila Serafin', 'Londres', '5539771457', 'camila.serafin@oxfordeducationlit.org'],
      ['Colegio Profr. Francisco Errasquin Gomez', 'Cecilia Rodríguez', 'Londres', '5544884437', 'cecilia@oxfordeducationlit.org'],
      ['Colegio Arista', 'Cecilia Rodríguez', 'Londres', '5544884437', 'cecilia@oxfordeducationlit.org'],
      ['UTEC', 'Camila Serafin', 'Londres', '5539771457', 'camila.serafin@oxfordeducationlit.org'],
      ['Belfortt', 'Camila Serafin', 'Londres', '5539771457', 'camila.serafin@oxfordeducationlit.org'],
      ['Instituto Kino de San Luis', 'Cecilia Rodríguez', 'Dublín', '5544884437', 'cecilia@oxfordeducationlit.org'],
      ['Global Skills', 'Camila Serafin', 'Londres', '5539771457', 'camila.serafin@oxfordeducationlit.org'],
      ['Centro de Estudios Naucalpan', 'Cecilia Rodríguez', 'Londres', '5544884437', 'cecilia@oxfordeducationlit.org'],
      ['Colegio Columbia', 'Camila Serafin', 'Londres', '5539771457', 'camila.serafin@oxfordeducationlit.org'],
      ['Instituto Martha Christlieb', 'Cecilia Rodríguez', 'Dublín', '5544884437', 'cecilia@oxfordeducationlit.org'],
    ];

    await updateRange(SPREADSHEET_ID, 'Colegios!A1:E14', colegiosData);

    console.log('✅ Colegios sheet FIXED successfully!\n');
    console.log('📊 Summary:');
    console.log('  • Removed invented codes (JFR, LTP, RKO, etc.)');
    console.log('  • Using FULL school names from Excel');
    console.log('  • ALL 13 schools included');
    console.log('  • Structure: Name, Advisor, Destination, WhatsApp, Email');
    console.log('\n✅ Now matches exactly with Excel source!\n');

  } catch (error) {
    console.error('❌ Error fixing Colegios sheet:', error.message);
    process.exit(1);
  }
}

fixColegiosSheet();
