#!/usr/bin/env node

/**
 * Share Google Drive Files with Service Account
 *
 * This script verifies if Drive files are accessible by the service account
 * and provides instructions to share them if needed
 */

import { extractFileId, downloadFile, isGoogleDriveUrl } from '../src/core/google-drive/client.js';
import { readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

async function main() {
  console.log('🔍 Checking Google Drive files access...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Service Account: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}\n`);

  try {
    // Read materials from Google Sheets
    const materials = await readSheet(env.GOOGLE_SHEETS_ID, 'Materiales');

    console.log(`Found ${materials.length} materials in Google Sheets\n`);

    // Filter Drive URLs
    const driveFiles = materials.filter(m => {
      const url = m.url || m.contenido;
      return url && isGoogleDriveUrl(url);
    });

    if (driveFiles.length === 0) {
      console.log('✅ No Google Drive files found. Nothing to check.\n');
      return;
    }

    console.log(`Found ${driveFiles.length} Google Drive files. Checking access...\n`);

    for (const material of driveFiles) {
      const url = material.url || material.contenido;
      const fileId = extractFileId(url);

      console.log(`\n📄 ${material.nombre || material.id}`);
      console.log(`   ID: ${material.id}`);
      console.log(`   File ID: ${fileId}`);
      console.log(`   URL: ${url}`);

      try {
        const buffer = await downloadFile(fileId);
        console.log(`   ✅ SUCCESS - File accessible (${buffer.length} bytes)`);
      } catch (error) {
        console.log(`   ❌ ERROR - ${error.message}`);

        if (error.message.includes('404') || error.message.includes('not found')) {
          console.log(`\n   🔧 TO FIX:`);
          console.log(`   1. Open: https://drive.google.com/file/d/${fileId}/view`);
          console.log(`   2. Click "Share" button`);
          console.log(`   3. Add this email: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
          console.log(`   4. Give "Viewer" permission`);
          console.log(`   5. Click "Send"\n`);
        } else if (error.message.includes('403') || error.message.includes('Permission denied')) {
          console.log(`\n   🔧 TO FIX:`);
          console.log(`   1. Open: https://drive.google.com/file/d/${fileId}/view`);
          console.log(`   2. Click "Share" button`);
          console.log(`   3. Make sure ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL} has "Viewer" permission`);
          console.log(`   4. If not listed, add it with "Viewer" permission\n`);
        }
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 Summary:');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('All files must be shared with the service account for the bot to send them.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
