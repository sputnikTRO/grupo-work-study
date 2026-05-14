/**
 * Fix Precios sheet with correct structure from Excel
 * - Separate Precio Programa and Precio Vuelo columns
 * - Use full school names (no invented codes)
 * - Include ALL 13 schools from Excel
 * - Specify payment period (abril-junio 2026)
 */

import { updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function fixPreciosSheet() {
  try {
    console.log('🔧 Fixing Precios sheet with correct structure...\n');
    console.log('─'.repeat(80));

    // CORRECT structure based on Excel "Colegios inscritos precios.xlsx"
    // Using abril-junio 2026 period (with $15K apartado) since we're already in May

    const preciosData = [
      // Header
      ['Colegio', 'Destino', 'Modalidad', 'Precio Programa', 'Precio Vuelo', 'Apartado', 'Periodo Pago', 'Notas'],

      // Row 1: General Londres
      ['TODOS', 'Londres', 'Homestay', '34990', '35000', '10000', 'Abril-Junio 2026', 'Precio general Londres 2027 (programa + vuelo = $69,990)'],

      // Row 2: General Dublín
      ['TODOS', 'Dublín', 'Homestay', '34990', '35000', '10000', 'Abril-Junio 2026', 'Precio general Dublín 2027 (programa + vuelo = $69,990)'],

      // Row 3: Instituto J. Francisco Rodriguez
      ['Instituto J. Francisco Rodriguez', 'Dublín', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],

      // Row 4: Colegio Luz del Tepeyac
      ['Colegio Luz del Tepeyac', 'Dublín', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],

      // Row 5: Instituto Ramiro Kolbe
      ['Instituto Ramiro Kolbe', 'Dublín', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],

      // Row 6: The Hills Institute
      ['Colegio The Hills Institute', 'Londres', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin'],

      // Row 7: Colegio Profr. Francisco Errasquin Gomez
      ['Colegio Profr. Francisco Errasquin Gomez', 'Londres', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],

      // Row 8: Colegio Arista
      ['Colegio Arista', 'Londres', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],

      // Row 9: UTEC
      ['UTEC', 'Londres', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin'],

      // Row 10: Belfortt
      ['Belfortt', 'Londres', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin'],

      // Row 11: Instituto Kino de San Luis (different price!)
      ['Instituto Kino de San Luis', 'Dublín', 'Homestay', '39990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez - PRECIO ESPECIAL'],

      // Row 12: Global Skills (different flight price!)
      ['Global Skills', 'Londres', 'Homestay', '35000', '37000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin - Vuelo especial'],

      // Row 13: Centro de Estudios Naucalpan (different prices!)
      ['Centro de Estudios Naucalpan', 'Londres', 'Homestay', '39990', '36000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez - PRECIOS ESPECIALES'],

      // Row 14: Colegio Columbia (VERY different - Hotel!)
      ['Colegio Columbia', 'Londres', 'Hotel', '85000', 'Incluido', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin - HOTEL (vuelo incluido)'],

      // Row 15: Instituto Martha Christlieb
      ['Instituto Martha Christlieb', 'Dublín', 'Homestay', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],
    ];

    await updateRange(SPREADSHEET_ID, 'Precios!A1:H16', preciosData);

    console.log('✅ Precios sheet FIXED successfully!\n');
    console.log('📊 Summary:');
    console.log('  • Structure: Precio Programa + Precio Vuelo (separate columns)');
    console.log('  • Schools: ALL 13 schools from Excel included');
    console.log('  • Names: Full school names (no invented codes)');
    console.log('  • Period: Abril-Junio 2026 with $15K apartado');
    console.log('  • Special prices noted:');
    console.log('    - Instituto Kino: $39,990 (programa)');
    console.log('    - Global Skills: $35,000 (programa) + $37,000 (vuelo)');
    console.log('    - Centro Naucalpan: $39,990 (programa) + $36,000 (vuelo)');
    console.log('    - Colegio Columbia: $85,000 HOTEL (vuelo incluido)');
    console.log('\n💡 Miri can now say: "El programa cuesta $34,990 y el vuelo $35,000"');
    console.log('   Total for parents: $69,990 (programa + vuelo)\n');

  } catch (error) {
    console.error('❌ Error fixing Precios sheet:', error.message);
    process.exit(1);
  }
}

fixPreciosSheet();
