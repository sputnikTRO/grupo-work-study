/**
 * Script to list files from Google Drive
 * Lists all files in "documentos agente travel" folder
 */

import { google } from 'googleapis';
import { env } from '../src/config/env.js';

async function listDriveFiles() {
  try {
    console.log('📂 Accessing Google Drive...\n');
    console.log('Service Account:', env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.log('─'.repeat(80));

    // Initialize Google Drive API client with service account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY,
      },
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
      ],
    });

    const drive = google.drive({ version: 'v3', auth });

    console.log('\n🔍 Searching for folder "documentos agente travel"...\n');

    // Search for the folder
    const folderQuery = "name='documentos agente travel' and mimeType='application/vnd.google-apps.folder'";

    const folderResponse = await drive.files.list({
      q: folderQuery,
      fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
      spaces: 'drive',
    });

    if (!folderResponse.data.files || folderResponse.data.files.length === 0) {
      console.log('❌ Folder "documentos agente travel" not found');
      console.log('\n💡 Listing all folders accessible to service account:\n');

      // List all folders
      const allFoldersResponse = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder'",
        fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
        spaces: 'drive',
        pageSize: 50,
      });

      if (allFoldersResponse.data.files && allFoldersResponse.data.files.length > 0) {
        allFoldersResponse.data.files.forEach((folder, idx) => {
          console.log(`${idx + 1}. ${folder.name}`);
          console.log(`   ID: ${folder.id}`);
          console.log(`   Created: ${folder.createdTime}`);
          console.log(`   Modified: ${folder.modifiedTime}\n`);
        });
      } else {
        console.log('No folders found. Make sure to share folders with the service account.');
      }

      return;
    }

    const folder = folderResponse.data.files[0];
    console.log(`✅ Found folder: "${folder.name}"`);
    console.log(`   ID: ${folder.id}`);
    console.log(`   Created: ${folder.createdTime}`);
    console.log(`   Modified: ${folder.modifiedTime}`);

    console.log('\n' + '─'.repeat(80));
    console.log('\n📄 Files in folder:\n');

    // List files in the folder
    const filesQuery = `'${folder.id}' in parents and trashed=false`;

    const filesResponse = await drive.files.list({
      q: filesQuery,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)',
      orderBy: 'modifiedTime desc',
      spaces: 'drive',
      pageSize: 100,
    });

    if (!filesResponse.data.files || filesResponse.data.files.length === 0) {
      console.log('⚠️  Folder is empty\n');
      return;
    }

    const files = filesResponse.data.files;
    console.log(`Total files: ${files.length}\n`);

    files.forEach((file, idx) => {
      console.log(`${idx + 1}. ${file.name}`);
      console.log(`   Type: ${file.mimeType}`);
      console.log(`   Size: ${file.size ? (parseInt(file.size) / 1024).toFixed(2) + ' KB' : 'N/A'}`);
      console.log(`   ID: ${file.id}`);
      console.log(`   Modified: ${file.modifiedTime}`);
      if (file.webViewLink) {
        console.log(`   Link: ${file.webViewLink}`);
      }
      console.log('');
    });

    console.log('─'.repeat(80));
    console.log('\n✅ Drive listing complete!\n');

    // Return file info for further processing
    return {
      folder,
      files,
    };

  } catch (error) {
    console.error('❌ Error accessing Google Drive:', error.message);

    if (error.message.includes('403')) {
      console.log('\n💡 Tip: Make sure the folder is shared with:');
      console.log(`   ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
    }

    process.exit(1);
  }
}

// Run
listDriveFiles();
