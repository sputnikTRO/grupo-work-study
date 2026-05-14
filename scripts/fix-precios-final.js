/**
 * CORRECCIONES FINALES - Hoja de Precios
 *
 * 1. Cambiar Apartado de TODOS: 10000 → 15000
 * 2. Cambiar Precio Vuelo de Columbia: "Incluido" → 0
 * 3. Agregar columna "Código Viaje" para mantener relación con hoja Viajes
 */

import { updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function fixPreciosFinal() {
  try {
    console.log('🔧 Aplicando correcciones finales a hoja de Precios...\n');
    console.log('─'.repeat(80));

    // ESTRUCTURA FINAL CORRECTA con todas las correcciones
    const preciosData = [
      // Header - AGREGADA COLUMNA "Código Viaje"
      ['Colegio', 'Destino', 'Modalidad', 'Código Viaje', 'Precio Programa', 'Precio Vuelo', 'Apartado', 'Periodo Pago', 'Notas'],

      // ========================================
      // FILAS GENERALES (TODOS)
      // Corrección 1: Apartado 10000 → 15000
      // ========================================
      ['TODOS', 'Londres', 'Homestay', 'LON2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Precio general Londres 2027 (programa + vuelo = $69,990)'],
      ['TODOS', 'Dublín', 'Homestay', 'DUB2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Precio general Dublín 2027 (programa + vuelo = $69,990)'],

      // ========================================
      // COLEGIOS ESPECÍFICOS (13 total)
      // Corrección 3: Agregado "Código Viaje" según destino
      // ========================================

      // Dublín (5 colegios)
      ['Instituto J. Francisco Rodriguez', 'Dublín', 'Homestay', 'DUB2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],
      ['Colegio Luz del Tepeyac', 'Dublín', 'Homestay', 'DUB2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],
      ['Instituto Ramiro Kolbe', 'Dublín', 'Homestay', 'DUB2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],
      ['Instituto Kino de San Luis', 'Dublín', 'Homestay', 'DUB2027', '39990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez - PRECIO ESPECIAL'],
      ['Instituto Martha Christlieb', 'Dublín', 'Homestay', 'DUB2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],

      // Londres (8 colegios)
      ['Colegio The Hills Institute', 'Londres', 'Homestay', 'LON2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin'],
      ['Colegio Profr. Francisco Errasquin Gomez', 'Londres', 'Homestay', 'LON2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],
      ['Colegio Arista', 'Londres', 'Homestay', 'LON2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez'],
      ['UTEC', 'Londres', 'Homestay', 'LON2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin'],
      ['Belfortt', 'Londres', 'Homestay', 'LON2027', '34990', '35000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin'],

      // Precios especiales
      ['Global Skills', 'Londres', 'Homestay', 'LON2027', '35000', '37000', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin - Vuelo especial'],
      ['Centro de Estudios Naucalpan', 'Londres', 'Homestay', 'LON2027', '39990', '36000', '15000', 'Abril-Junio 2026', 'Asesora: Cecilia Rodríguez - PRECIOS ESPECIALES'],

      // Corrección 2: Columbia "Incluido" → 0
      ['Colegio Columbia', 'Londres', 'Hotel', 'LON2027', '85000', '0', '15000', 'Abril-Junio 2026', 'Asesora: Camila Serafin - HOTEL (vuelo incluido)'],
    ];

    await updateRange(SPREADSHEET_ID, 'Precios!A1:I16', preciosData);

    console.log('✅ Hoja de Precios CORREGIDA!\n');
    console.log('📋 Correcciones aplicadas:');
    console.log('  ✓ Corrección 1: Apartado TODOS cambiado de $10,000 → $15,000');
    console.log('  ✓ Corrección 2: Columbia Precio Vuelo cambiado de "Incluido" → 0');
    console.log('  ✓ Corrección 3: Agregada columna "Código Viaje" (LON2027/DUB2027)');
    console.log('\n📊 Estructura final:');
    console.log('  Columnas: Colegio | Destino | Modalidad | Código Viaje | Precio Programa | Precio Vuelo | Apartado | Periodo | Notas');
    console.log('  Total registros: 15 (2 TODOS + 13 colegios)');
    console.log('\n💡 Notas importantes:');
    console.log('  • $10,000 = mínimo para APARTAR lugar');
    console.log('  • $15,000 = apartado del ESQUEMA de pagos (abril-junio 2026)');
    console.log('  • Columbia: Precio Vuelo = 0 (incluido en $85,000)');
    console.log('  • Relación con Viajes: LON2027 y DUB2027\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixPreciosFinal();
