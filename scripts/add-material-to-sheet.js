#!/usr/bin/env node

/**
 * Add Material to Materiales Sheet (Manual Drive Upload)
 *
 * Use this script if you uploaded the PDF manually to Google Drive
 * and just need to add it to the Materiales sheet
 *
 * Usage: node scripts/add-material-to-sheet.js <drive-url> <material-id> <material-name> <trip-code> [description]
 */

import { env } from '../src/config/env.js';
import { appendRow } from '../src/core/sheets/client.js';

const DRIVE_URL = process.argv[2];
const MATERIAL_ID = process.argv[3];
const MATERIAL_NAME = process.argv[4];
const TRIP_CODE = process.argv[5];
const DESCRIPTION = process.argv[6] || '';

if (!DRIVE_URL || !MATERIAL_ID || !MATERIAL_NAME || !TRIP_CODE) {
  console.error('❌ Error: Missing required arguments\n');
  console.error('Usage: node scripts/add-material-to-sheet.js <drive-url> <material-id> <material-name> <trip-code> [description]\n');
  console.error('Example:');
  console.error('  node scripts/add-material-to-sheet.js \\');
  console.error('    "https://drive.google.com/uc?id=1ABC123xyz&export=download" \\');
  console.error('    "BROCHURE_LON_CEWIN" \\');
  console.error('    "Brochure English 4 Life Londres 2026 - CEWIN" \\');
  console.error('    "LON2026" \\');
  console.error('    "Información completa del viaje a Londres 2026"');
  process.exit(1);
}

async function main() {
  console.log('📝 Adding material to Google Sheets "Materiales"...\n');

  const rowData = [
    MATERIAL_ID,           // id
    MATERIAL_NAME,         // nombre
    'pdf',                 // tipo
    DRIVE_URL,             // url
    TRIP_CODE,             // viaje_codigo
    DESCRIPTION || '',     // descripcion
  ];

  console.log('Data to add:');
  console.log(`   ID: ${MATERIAL_ID}`);
  console.log(`   Nombre: ${MATERIAL_NAME}`);
  console.log(`   Tipo: pdf`);
  console.log(`   URL: ${DRIVE_URL}`);
  console.log(`   Viaje Código: ${TRIP_CODE}`);
  console.log(`   Descripción: ${DESCRIPTION || '(none)'}\n`);

  try {
    await appendRow(env.GOOGLE_SHEETS_ID, 'Materiales', rowData);
    console.log('✅ Material added to Materiales sheet successfully!\n');
  } catch (error) {
    console.error('❌ Error adding material to sheet:', error.message);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ SUCCESS! Material configured successfully!');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('🤖 The bot can now send this PDF using:');
  console.log(`   [ENVIAR_MATERIAL:${MATERIAL_ID}]\n`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
