#!/usr/bin/env node
/**
 * Updates the Leads_Log sheet headers with the new structure
 *
 * Run: node scripts/update-leads-headers.js
 */

import { updateRow } from '../src/core/sheets/client.js';
import { getLeadsLogHeaders } from '../src/core/sheets/leads-sync.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

const SHEET_NAME = 'Leads_Log';

async function updateLeadsHeaders() {
  const scriptLogger = logger.child({ script: 'update-leads-headers' });

  try {
    scriptLogger.info('Starting Leads_Log headers update...');

    // Get the new headers structure
    const newHeaders = getLeadsLogHeaders();

    scriptLogger.info({ newHeaders }, 'New headers structure');

    // Update row 1 (headers) in the sheet
    await updateRow(
      env.GOOGLE_SHEETS_ID,
      SHEET_NAME,
      1, // Row 1 = header row
      newHeaders
    );

    scriptLogger.info('✅ Headers updated successfully!');

    console.log('\n✅ Headers actualizados exitosamente en Google Sheets!');
    console.log('\nNueva estructura:');
    newHeaders.forEach((header, index) => {
      const col = String.fromCharCode(65 + index); // A, B, C...
      console.log(`  ${col}: ${header}`);
    });
    console.log('\n');

  } catch (error) {
    scriptLogger.error({ err: error }, 'Error updating headers');
    console.error('\n❌ Error al actualizar headers:', error.message);
    process.exit(1);
  }
}

// Run the script
updateLeadsHeaders()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
