#!/usr/bin/env node
/**
 * Shows the complete structure of all Google Sheets used by the bot
 * Displays headers and sample data for each sheet
 *
 * Run: node scripts/show-sheets-structure.js
 */

import { readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

const SHEET_NAMES = [
  'Colegios',
  'Viajes',
  'Actividades',
  'Materiales',
  'Asesoras',
  'Esquemas de Pago',
  'FAQ',
  'Configuración',
];

async function showSheetsStructure() {
  const scriptLogger = logger.child({ script: 'show-sheets-structure' });

  console.log('\n📊 ESTRUCTURA DE GOOGLE SHEETS\n');
  console.log('='.repeat(80));

  for (const sheetName of SHEET_NAMES) {
    try {
      scriptLogger.info({ sheetName }, 'Reading sheet');

      const data = await readSheet(env.GOOGLE_SHEETS_ID, sheetName);

      console.log(`\n📋 HOJA: ${sheetName}`);
      console.log('-'.repeat(80));

      if (data.length === 0) {
        console.log('⚠️  Hoja vacía (sin datos)\n');
        continue;
      }

      // Get headers (keys from first object)
      const headers = Object.keys(data[0]);
      console.log(`\n📌 Headers (${headers.length} columnas):`);
      headers.forEach((header, index) => {
        const col = String.fromCharCode(65 + index); // A, B, C...
        console.log(`  ${col}. ${header}`);
      });

      // Show total rows
      console.log(`\n📊 Total de registros: ${data.length}`);

      // Show first 3 rows as examples
      const sampleCount = Math.min(3, data.length);
      console.log(`\n🔍 Ejemplo de datos (primeros ${sampleCount} registros):\n`);

      for (let i = 0; i < sampleCount; i++) {
        console.log(`--- Registro ${i + 1} ---`);
        const record = data[i];

        // Show each field
        for (const [key, value] of Object.entries(record)) {
          const displayValue = value || '(vacío)';
          console.log(`  ${key}: ${displayValue}`);
        }
        console.log('');
      }

    } catch (error) {
      scriptLogger.error({ err: error, sheetName }, 'Error reading sheet');
      console.log(`\n❌ Error al leer hoja "${sheetName}": ${error.message}\n`);
    }
  }

  console.log('='.repeat(80));
  console.log('\n✅ Análisis completado\n');
}

// Run the script
showSheetsStructure()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
