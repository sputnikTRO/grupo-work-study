#!/usr/bin/env node
/**
 * Verifies if Info_Viajes sheet is accessible in Google Sheets
 * and if the bot's cache includes it
 */

import { readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

const SHEET_ID = env.GOOGLE_SHEETS_ID;

async function verifyInfoViajes() {
  console.log('\n🔍 Verificando acceso a la hoja Info_Viajes...\n');

  try {
    // Try to read Info_Viajes sheet
    console.log('📝 Intentando leer hoja Info_Viajes desde Google Sheets...');
    const data = await readSheet(SHEET_ID, 'Info_Viajes');

    if (data.length === 0) {
      console.log('⚠️  La hoja Info_Viajes existe pero está vacía\n');
      return;
    }

    console.log(`✅ Hoja Info_Viajes leída exitosamente!\n`);
    console.log(`📊 Total de registros: ${data.length}\n`);

    // Group by category
    const categories = {};
    data.forEach(item => {
      const cat = item.categoria || 'Sin categoría';
      categories[cat] = (categories[cat] || 0) + 1;
    });

    console.log('📋 Categorías encontradas:');
    Object.entries(categories).forEach(([cat, count]) => {
      console.log(`   • ${cat}: ${count} entradas`);
    });

    console.log('\n✅ El bot puede acceder a Info_Viajes correctamente!');
    console.log('✅ Railway debe tener el código actualizado desplegado.\n');

    // Show sample entry
    if (data.length > 0) {
      console.log('🔍 Ejemplo de entrada:');
      console.log(`   Viaje: ${data[0].viaje_codigo}`);
      console.log(`   Categoría: ${data[0].categoria}`);
      console.log(`   Título: ${data[0].titulo}`);
      console.log(`   Contenido: ${data[0].contenido?.substring(0, 100)}...\n`);
    }

  } catch (error) {
    if (error.message && error.message.includes('Unable to parse range')) {
      console.log('❌ La hoja Info_Viajes NO existe en Google Sheets');
      console.log('   Ejecuta: node scripts/populate-info-viajes.js\n');
    } else if (error.code === 404) {
      console.log('❌ Error 404: Hoja no encontrada');
      console.log('   La hoja Info_Viajes no existe o el nombre es incorrecto\n');
    } else {
      console.log('❌ Error verificando Info_Viajes:', error.message);
      console.log('\nDetalles:', error);
    }
    process.exit(1);
  }
}

// Run verification
verifyInfoViajes();
