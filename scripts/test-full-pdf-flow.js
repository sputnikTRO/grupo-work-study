import dotenv from 'dotenv';
dotenv.config();

import * as googleDrive from '../src/core/google-drive/client.js';
import * as mediaUploader from '../src/core/whatsapp/media-uploader.js';
import { sendMediaMessage } from '../src/core/whatsapp/client.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

/**
 * Test complete PDF sending flow:
 * 1. Download from Google Drive
 * 2. Upload to WhatsApp
 * 3. Send via WhatsApp using media_id
 */

async function testFullFlow() {
  console.log('\n🧪 Testing Full PDF Flow\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Configuration
  const testUrl = 'https://drive.google.com/u/0/uc?id=1eTEmYOaLpJ2qrgVa-FNMul6JTNeWvbJp&export=download&confirm=t';
  const testPhoneNumber = '523312773940'; // Your test number
  const phoneNumberId = env.WA_PHONE_NUMBER_ID;

  try {
    console.log('📋 Test Configuration:');
    console.log('  URL:', testUrl);
    console.log('  Test Number:', testPhoneNumber);
    console.log('  WhatsApp Phone ID:', phoneNumberId);
    console.log('');

    // Step 1: Extract file ID
    console.log('Step 1: Extracting file ID...');
    const fileId = googleDrive.extractFileId(testUrl);
    console.log('  ✅ File ID:', fileId);
    console.log('');

    // Step 2: Download from Drive
    console.log('Step 2: Downloading from Google Drive...');
    const buffer = await googleDrive.downloadFile(fileId);
    console.log('  ✅ Downloaded:', buffer.length, 'bytes');
    console.log('  ✅ Size (MB):', (buffer.length / 1024 / 1024).toFixed(2), 'MB');

    // Verify PDF signature
    const pdfSignature = buffer.slice(0, 4).toString('utf-8');
    if (pdfSignature !== '%PDF') {
      throw new Error('Downloaded file is not a valid PDF!');
    }
    console.log('  ✅ Valid PDF file');
    console.log('');

    // Step 3: Upload to WhatsApp (simulating the media uploader)
    console.log('Step 3: Uploading to WhatsApp...');
    const mimeType = 'application/pdf';
    const filename = 'Brochure_Londres_2026.pdf';

    // Use getOrUploadMedia which handles caching
    const mediaId = await mediaUploader.getOrUploadMedia(
      'BROCHURE_LON_CEWIN',
      testUrl,
      mimeType,
      filename,
      phoneNumberId
    );

    console.log('  ✅ Media uploaded to WhatsApp');
    console.log('  ✅ Media ID:', mediaId);
    console.log('');

    // Step 4: Send via WhatsApp
    console.log('Step 4: Sending PDF via WhatsApp...');
    await sendMediaMessage(
      testPhoneNumber,
      'document',
      mediaId,
      null, // No caption
      filename, // Filename
      phoneNumberId
    );

    console.log('  ✅ PDF sent successfully!');
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ FULL FLOW COMPLETED SUCCESSFULLY!');
    console.log('');
    console.log('Check your WhatsApp to verify the PDF was received correctly.');
    console.log('If the PDF is empty, the problem is with WhatsApp Cloud API.');
    console.log('If the PDF is correct, the problem was elsewhere in the code.');
    console.log('');

  } catch (error) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('❌ Test FAILED!\n');
    console.error('Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

testFullFlow();
