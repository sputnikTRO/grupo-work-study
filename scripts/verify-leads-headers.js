#!/usr/bin/env node
/**
 * Verifies the Leads_Log sheet headers
 *
 * Run: node scripts/verify-leads-headers.js
 */

import { readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

const SHEET_NAME = 'Leads_Log';

async function verifyLeadsHeaders() {
  const scriptLogger = logger.child({ script: 'verify-leads-headers' });

  try {
    scriptLogger.info('Reading Leads_Log sheet...');

    // Read the sheet (which will show headers)
    const data = await readSheet(env.GOOGLE_SHEETS_ID, SHEET_NAME);

    // Get the first object keys to see what headers were read
    if (data.length > 0) {
      const headers = Object.keys(data[0]);

      console.log('\n📋 Headers actuales en Google Sheets (normalizados):');
      headers.forEach((header, index) => {
        console.log(`  ${index + 1}. ${header}`);
      });

      console.log(`\n📊 Total de registros en la hoja: ${data.length}`);

      // Show a sample of the first record if exists
      if (data.length > 0) {
        console.log('\n🔍 Ejemplo del primer registro:');
        console.log(JSON.stringify(data[0], null, 2));
      }
    } else {
      console.log('\n⚠️  La hoja está vacía (solo tiene headers)');
    }

  } catch (error) {
    scriptLogger.error({ err: error }, 'Error verifying headers');
    console.error('\n❌ Error al verificar headers:', error.message);
    process.exit(1);
  }
}

// Run the script
verifyLeadsHeaders()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
