#!/usr/bin/env node

/**
 * Upload PDF to Google Drive and Add to Materiales Sheet
 *
 * This script:
 * 1. Uploads a PDF to Google Drive using the service account
 * 2. Makes it publicly accessible
 * 3. Adds a row to the "Materiales" sheet in Google Sheets
 *
 * Usage: node scripts/upload-pdf-to-drive.js <pdf-path> <material-id> <material-name> <trip-code> [description]
 */

import { google } from 'googleapis';
import { createReadStream, statSync } from 'fs';
import { resolve } from 'path';
import { env } from '../src/config/env.js';
import { appendRow } from '../src/core/sheets/client.js';
import logger from '../src/utils/logger.js';

const PDF_PATH = process.argv[2];
const MATERIAL_ID = process.argv[3];
const MATERIAL_NAME = process.argv[4];
const TRIP_CODE = process.argv[5];
const DESCRIPTION = process.argv[6] || '';

if (!PDF_PATH || !MATERIAL_ID || !MATERIAL_NAME || !TRIP_CODE) {
  console.error('❌ Error: Missing required arguments\n');
  console.error('Usage: node scripts/upload-pdf-to-drive.js <pdf-path> <material-id> <material-name> <trip-code> [description]\n');
  console.error('Example:');
  console.error('  node scripts/upload-pdf-to-drive.js \\');
  console.error('    "/path/to/file.pdf" \\');
  console.error('    "BROCHURE_LON_CEWIN" \\');
  console.error('    "Brochure English 4 Life Londres 2026 - CEWIN" \\');
  console.error('    "LON2026" \\');
  console.error('    "Información completa del viaje a Londres 2026 para CEWIN"');
  process.exit(1);
}

async function main() {
  console.log('🚀 Starting PDF upload process...\n');

  // Validate PDF file exists
  const pdfFullPath = resolve(PDF_PATH);
  try {
    const stats = statSync(pdfFullPath);
    console.log(`✅ PDF found: ${pdfFullPath}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`);
  } catch (error) {
    console.error(`❌ Error: PDF file not found at ${pdfFullPath}`);
    process.exit(1);
  }

  // Initialize Google Drive API
  console.log('📡 Authenticating with Google Drive API...');
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY,
    },
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  const drive = google.drive({ version: 'v3', auth });
  console.log('✅ Authenticated successfully\n');

  // Upload PDF to Google Drive
  console.log('📤 Uploading PDF to Google Drive...');

  const fileMetadata = {
    name: `${MATERIAL_NAME}.pdf`,
    mimeType: 'application/pdf',
  };

  const media = {
    mimeType: 'application/pdf',
    body: createReadStream(pdfFullPath),
  };

  let driveFile;
  try {
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink',
    });

    driveFile = response.data;
    console.log('✅ PDF uploaded successfully!');
    console.log(`   File ID: ${driveFile.id}`);
    console.log(`   Name: ${driveFile.name}\n`);
  } catch (error) {
    console.error('❌ Error uploading PDF to Drive:', error.message);
    process.exit(1);
  }

  // Make the file publicly accessible
  console.log('🔓 Making file publicly accessible...');
  try {
    await drive.permissions.create({
      fileId: driveFile.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
    console.log('✅ File is now publicly accessible\n');
  } catch (error) {
    console.error('❌ Error setting permissions:', error.message);
    process.exit(1);
  }

  // Generate public URL
  const publicUrl = `https://drive.google.com/uc?id=${driveFile.id}&export=download`;
  console.log('🔗 Public URL generated:');
  console.log(`   ${publicUrl}\n`);

  // Add row to Materiales sheet
  console.log('📝 Adding material to Google Sheets "Materiales"...');

  const rowData = [
    MATERIAL_ID,           // id
    MATERIAL_NAME,         // nombre
    'pdf',                 // tipo
    publicUrl,             // url
    TRIP_CODE,             // viaje_codigo
    DESCRIPTION || '',     // descripcion
  ];

  try {
    await appendRow(env.GOOGLE_SHEETS_ID, 'Materiales', rowData);
    console.log('✅ Material added to Materiales sheet successfully!\n');
  } catch (error) {
    console.error('❌ Error adding material to sheet:', error.message);
    console.error('   You can add it manually with this data:');
    console.error(`   ID: ${MATERIAL_ID}`);
    console.error(`   Nombre: ${MATERIAL_NAME}`);
    console.error(`   Tipo: pdf`);
    console.error(`   URL: ${publicUrl}`);
    console.error(`   Viaje Código: ${TRIP_CODE}`);
    console.error(`   Descripción: ${DESCRIPTION}`);
    process.exit(1);
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ SUCCESS! PDF uploaded and configured successfully!');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📋 Summary:');
  console.log(`   Material ID: ${MATERIAL_ID}`);
  console.log(`   Material Name: ${MATERIAL_NAME}`);
  console.log(`   Trip Code: ${TRIP_CODE}`);
  console.log(`   Drive File ID: ${driveFile.id}`);
  console.log(`   Public URL: ${publicUrl}`);
  console.log(`   Sheet: Materiales (row added)\n`);
  console.log('🤖 The bot can now send this PDF using:');
  console.log(`   [ENVIAR_MATERIAL:${MATERIAL_ID}]\n`);
  console.log('💡 To test, you can use the demo script:');
  console.log(`   node scripts/demo-bot.js\n`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
