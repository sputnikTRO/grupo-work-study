import dotenv from 'dotenv';
dotenv.config();

import * as sheetsClient from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

/**
 * Check Materiales sheet directly
 */

async function checkMaterials() {
  console.log('\n📋 Checking Materiales Sheet\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const rows = await sheetsClient.readSheet(env.GOOGLE_SHEETS_ID, 'Materiales');

    console.log(`✅ Found ${rows.length} materials\n`);

    // Show all materials
    console.log('All materials:');
    rows.forEach(row => {
      console.log(`\n📄 ${row.id}:`);
      console.log(JSON.stringify(row, null, 2));
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

checkMaterials();
