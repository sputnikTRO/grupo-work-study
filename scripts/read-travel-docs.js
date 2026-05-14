/**
 * Script to read and analyze travel documents from Google Drive
 */

import { google } from 'googleapis';
import { env } from '../src/config/env.js';
import fs from 'fs';
import path from 'path';

const FOLDER_ID = '1fs2CLOV93_qS6SHtoAv85ZsMBZoXa58d'; // Documentos Bot travel

async function readTravelDocuments() {
  try {
    console.log('📂 Accessing "Documentos Bot travel" folder...\n');

    // Initialize Google Drive API
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY,
      },
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });

    const drive = google.drive({ version: 'v3', auth });

    // List all files in the folder
    console.log('📄 Listing files...\n');

    const filesResponse = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)',
      orderBy: 'name',
      spaces: 'drive',
      pageSize: 100,
    });

    const files = filesResponse.data.files || [];

    if (files.length === 0) {
      console.log('⚠️  No files found in folder\n');
      return;
    }

    console.log(`Total files: ${files.length}\n`);
    console.log('─'.repeat(80));

    // Process each file
    for (const [idx, file] of files.entries()) {
      console.log(`\n${idx + 1}. ${file.name}`);
      console.log(`   Type: ${file.mimeType}`);
      console.log(`   Size: ${file.size ? (parseInt(file.size) / 1024).toFixed(2) + ' KB' : 'N/A'}`);
      console.log(`   Modified: ${file.modifiedTime}`);
      console.log(`   ID: ${file.id}`);

      // Download text-based files for analysis
      if (
        file.mimeType === 'application/vnd.google-apps.document' ||
        file.mimeType === 'text/plain' ||
        file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        try {
          console.log('   📖 Reading content...');

          let content;
          if (file.mimeType === 'application/vnd.google-apps.document') {
            // Export Google Doc as plain text
            const response = await drive.files.export({
              fileId: file.id,
              mimeType: 'text/plain',
            });
            content = response.data;
          } else {
            // Download file directly
            const response = await drive.files.get({
              fileId: file.id,
              alt: 'media',
            });
            content = response.data;
          }

          // Show preview (first 500 chars)
          const preview = content.toString().substring(0, 500);
          console.log(`   Preview:\n${preview}${content.length > 500 ? '...' : ''}\n`);

        } catch (error) {
          console.log(`   ❌ Error reading: ${error.message}`);
        }
      }

      // For PDFs, just note them
      if (file.mimeType === 'application/pdf') {
        console.log('   📕 PDF file (cannot read text directly)');
        console.log(`   Link: ${file.webViewLink}`);
      }

      // For images
      if (file.mimeType.startsWith('image/')) {
        console.log('   🖼️  Image file');
        console.log(`   Link: ${file.webViewLink}`);
      }

      // For spreadsheets
      if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
        console.log('   📊 Google Sheets');
        console.log(`   Link: ${file.webViewLink}`);
      }
    }

    console.log('\n' + '─'.repeat(80));
    console.log('\n✅ Analysis complete!\n');

    return files;

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run
readTravelDocuments();
