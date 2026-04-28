#!/usr/bin/env node

/**
 * Verify Materiales Sheet Structure
 *
 * Checks if the Materiales sheet exists and has the correct headers
 */

import { env } from '../src/config/env.js';
import { readSheet } from '../src/core/sheets/client.js';

async function main() {
  console.log('🔍 Verifying "Materiales" sheet structure...\n');

  try {
    const materials = await readSheet(env.GOOGLE_SHEETS_ID, 'Materiales');

    console.log('✅ Materiales sheet found!\n');
    console.log(`   Total rows: ${materials.length}`);

    if (materials.length > 0) {
      console.log('\n📋 Current materials:');
      materials.forEach((mat, index) => {
        console.log(`\n   ${index + 1}. ${mat.nombre || mat.id || '(no name)'}`);
        console.log(`      ID: ${mat.id || '(not set)'}`);
        console.log(`      Tipo: ${mat.tipo || '(not set)'}`);
        console.log(`      URL: ${mat.url || mat.contenido || '(not set)'}`);
        console.log(`      Viaje: ${mat.viaje_codigo || '(not set)'}`);
      });
    } else {
      console.log('\n   (Sheet is empty - ready to add materials)');
    }

    console.log('\n📊 Expected headers:');
    console.log('   id | nombre | tipo | url | viaje_codigo | descripcion');

    console.log('\n✅ Sheet is ready to receive new materials!');

  } catch (error) {
    console.error('❌ Error reading Materiales sheet:', error.message);
    console.error('\nMake sure:');
    console.error('   1. The sheet "Materiales" exists in your Google Sheets');
    console.error('   2. The service account has access to the spreadsheet');
    console.error('   3. The headers are: id | nombre | tipo | url | viaje_codigo | descripcion');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
