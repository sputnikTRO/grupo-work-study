/**
 * PASO 2: Actualizar Hoja de Viajes con Datos 2027
 *
 * Fechas del programa: 21-30 Mayo 2027
 * Destinos: Londres y Dublín
 * Códigos: LON2027 y DUB2027
 */

import { updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function fixViajes2027() {
  try {
    console.log('🔧 Actualizando hoja Viajes con datos 2027...\n');
    console.log('─'.repeat(80));

    // ESTRUCTURA: Código | Destino | Descripción | Fecha Salida | Fecha Regreso | Estado
    const viajesData = [
      // Header
      ['Código', 'Destino', 'Descripción', 'Fecha Salida', 'Fecha Regreso', 'Estado'],

      // LON2027 - Londres 2027
      [
        'LON2027',
        'Londres 2027',
        'Viaje English 4 Life a Londres - Programa de inmersión con clases de inglés y actividades culturales',
        '21 mayo 2027',
        '30 mayo 2027',
        'activo'
      ],

      // DUB2027 - Dublín 2027
      [
        'DUB2027',
        'Dublín 2027',
        'Viaje English 4 Life a Dublín - Programa de inmersión con clases de inglés y actividades culturales',
        '21 mayo 2027',
        '30 mayo 2027',
        'activo'
      ],
    ];

    await updateRange(SPREADSHEET_ID, 'Viajes!A1:F3', viajesData);

    console.log('✅ Hoja Viajes ACTUALIZADA con datos 2027!\n');
    console.log('📋 Viajes registrados:');
    console.log('  ✓ LON2027: Londres (21-30 mayo 2027) - ACTIVO');
    console.log('  ✓ DUB2027: Dublín (21-30 mayo 2027) - ACTIVO');
    console.log('\n📊 Estructura:');
    console.log('  Columnas: Código | Destino | Descripción | Fecha Salida | Fecha Regreso | Estado');
    console.log('  Total registros: 2 viajes activos');
    console.log('\n💡 Relación con otras hojas:');
    console.log('  • Hoja Precios usa estos códigos en columna "Código Viaje"');
    console.log('  • cache.js filtra por Estado="activo" en getActiveTrips()');
    console.log('  • Fechas: 21-30 de Mayo 2027 (10 días/9 noches)\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixViajes2027();
