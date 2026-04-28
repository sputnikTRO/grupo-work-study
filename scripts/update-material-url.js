#!/usr/bin/env node

/**
 * Update Material URL in Google Sheets
 *
 * Updates the URL of an existing material by finding its row and updating it
 */

import { readSheet, updateRow } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const MATERIAL_ID = process.argv[2];
const NEW_URL = process.argv[3];

if (!MATERIAL_ID || !NEW_URL) {
  console.error('❌ Error: Missing required arguments\n');
  console.error('Usage: node scripts/update-material-url.js <material-id> <new-url>\n');
  console.error('Example:');
  console.error('  node scripts/update-material-url.js BROCHURE_LON_CEWIN "https://new-url.com/file.pdf"');
  process.exit(1);
}

async function main() {
  console.log('🔄 Updating material URL in Google Sheets...\n');

  try {
    // Read current materials
    const materials = await readSheet(env.GOOGLE_SHEETS_ID, 'Materiales');

    // Find the material by ID
    const materialIndex = materials.findIndex(m => m.id === MATERIAL_ID);

    if (materialIndex === -1) {
      console.error(`❌ Material with ID "${MATERIAL_ID}" not found`);
      process.exit(1);
    }

    const material = materials[materialIndex];
    console.log(`✅ Material found: ${material.nombre}`);
    console.log(`   Current URL: ${material.url || material.contenido}`);
    console.log(`   New URL: ${NEW_URL}\n`);

    // Row number is materialIndex + 2 (1 for header row, 1 for 0-based index)
    const rowNumber = materialIndex + 2;

    // Prepare updated row data (maintain all existing fields)
    const updatedRow = [
      material.id,
      material.nombre,
      material.tipo,
      NEW_URL,  // Updated URL
      material.viaje_codigo || '',
      material.descripcion || ''
    ];

    // Update the row
    await updateRow(env.GOOGLE_SHEETS_ID, 'Materiales', rowNumber, updatedRow);

    console.log('✅ Material URL updated successfully!\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Updated Material:');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`   ID: ${material.id}`);
    console.log(`   Name: ${material.nombre}`);
    console.log(`   Type: ${material.tipo}`);
    console.log(`   New URL: ${NEW_URL}`);
    console.log(`   Row: ${rowNumber}\n`);
    console.log('⏱️  Cache will update in 5 minutes, or restart the bot to refresh immediately.\n');

  } catch (error) {
    console.error('❌ Error updating material URL:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
