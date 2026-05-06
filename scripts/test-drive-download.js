import dotenv from 'dotenv';
dotenv.config();

import * as googleDrive from '../src/core/google-drive/client.js';
import logger from '../src/utils/logger.js';

/**
 * Test Google Drive file download
 * Verifies that we can actually download the PDF file
 */

async function testDriveDownload() {
  console.log('\n🧪 Testing Google Drive Download\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Test file URL (London brochure - FROM SHEET)
  const testUrl = 'https://drive.google.com/u/0/uc?id=1eTEmYOaLpJ2qrgVa-FNMul6JTNeWvbJp&export=download&confirm=t';

  try {
    console.log('Test URL:', testUrl);
    console.log('');

    // Extract file ID
    const fileId = googleDrive.extractFileId(testUrl);
    console.log('✅ Extracted file ID:', fileId);

    // Check if it's a Drive URL
    const isDriveUrl = googleDrive.isGoogleDriveUrl(testUrl);
    console.log('✅ Is Google Drive URL:', isDriveUrl);
    console.log('');

    // Download file
    console.log('📥 Downloading file from Google Drive...\n');
    const buffer = await googleDrive.downloadFile(fileId);

    console.log('✅ File downloaded successfully!');
    console.log('   Size:', buffer.length, 'bytes');
    console.log('   Size (MB):', (buffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('');

    // Check if buffer is empty
    if (buffer.length === 0) {
      console.log('❌ ERROR: Buffer is EMPTY!');
      console.log('   This means the file was not downloaded correctly.\n');
      return;
    }

    // Check PDF signature (should start with %PDF)
    const pdfSignature = buffer.slice(0, 4).toString('utf-8');
    console.log('📄 File signature:', pdfSignature);

    if (pdfSignature === '%PDF') {
      console.log('✅ Valid PDF file!\n');
    } else {
      console.log('❌ NOT a valid PDF file!');
      console.log('   First 100 bytes:', buffer.slice(0, 100).toString('utf-8'));
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Test completed successfully!\n');

  } catch (error) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('❌ Test FAILED!\n');
    console.error('Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

testDriveDownload();
