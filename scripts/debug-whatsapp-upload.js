import dotenv from 'dotenv';
dotenv.config();

import * as googleDrive from '../src/core/google-drive/client.js';
import axios from 'axios';
import FormData from 'form-data';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

/**
 * Debug WhatsApp Upload
 * Tests the complete upload process to WhatsApp with detailed logging
 */

async function debugWhatsAppUpload() {
  console.log('\n🔍 Debugging WhatsApp Upload Process\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const testUrl = 'https://drive.google.com/u/0/uc?id=1eTEmYOaLpJ2qrgVa-FNMul6JTNeWvbJp&export=download&confirm=t';
  const filename = 'Brochure_Londres_2026_DEBUG.pdf';
  const mimeType = 'application/pdf';
  const phoneNumberId = env.WA_PHONE_NUMBER_ID_TRAVEL;

  try {
    // Step 1: Download from Drive
    console.log('Step 1: Downloading from Google Drive...');
    const fileId = googleDrive.extractFileId(testUrl);
    const buffer = await googleDrive.downloadFile(fileId);

    console.log('  ✅ File downloaded');
    console.log('  📊 Buffer size:', buffer.length, 'bytes');
    console.log('  📊 Buffer size (MB):', (buffer.length / 1024 / 1024).toFixed(2), 'MB');

    // Verify PDF signature
    const pdfSignature = buffer.slice(0, 4).toString('utf-8');
    console.log('  📄 PDF signature:', pdfSignature);
    console.log('  📄 First 100 bytes:', buffer.slice(0, 100).toString('hex').substring(0, 100) + '...');
    console.log('  📄 Last 100 bytes:', buffer.slice(-100).toString('hex').substring(0, 100) + '...');
    console.log('');

    // Step 2: Create FormData
    console.log('Step 2: Creating FormData for WhatsApp...');
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', buffer, {
      filename: filename,
      contentType: mimeType,
    });

    const formHeaders = formData.getHeaders();
    console.log('  ✅ FormData created');
    console.log('  📋 Content-Type:', formHeaders['content-type']);
    console.log('');

    // Step 3: Upload to WhatsApp
    console.log('Step 3: Uploading to WhatsApp Cloud API...');
    const uploadUrl = `https://graph.facebook.com/${env.WA_API_VERSION}/${phoneNumberId}/media`;
    console.log('  🌐 Upload URL:', uploadUrl);
    console.log('  📦 Uploading', buffer.length, 'bytes...');
    console.log('');

    const startTime = Date.now();
    const response = await axios.post(uploadUrl, formData, {
      headers: {
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
        ...formHeaders,
      },
      maxBodyLength: 100 * 1024 * 1024, // 100MB max
      timeout: 120000, // 2 minute timeout
      maxRedirects: 5,
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        process.stdout.write(`\r  📤 Upload progress: ${percentCompleted}% (${progressEvent.loaded} / ${progressEvent.total} bytes)`);
      },
    });
    const uploadTime = Date.now() - startTime;

    console.log('\n');
    console.log('  ✅ Upload completed!');
    console.log('  ⏱️  Upload time:', uploadTime, 'ms');
    console.log('  📋 Response:', JSON.stringify(response.data, null, 2));
    console.log('');

    const mediaId = response.data.id;

    // Step 4: Verify uploaded media
    console.log('Step 4: Verifying uploaded media...');
    const verifyUrl = `https://graph.facebook.com/${env.WA_API_VERSION}/${mediaId}`;
    const verifyResponse = await axios.get(verifyUrl, {
      headers: {
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
      },
    });

    console.log('  ✅ Media verified');
    console.log('  📋 Media info:', JSON.stringify(verifyResponse.data, null, 2));
    console.log('');

    // Step 5: Send via WhatsApp
    console.log('Step 5: Sending PDF via WhatsApp...');
    const testPhoneNumber = '5535305000';
    const sendUrl = `https://graph.facebook.com/${env.WA_API_VERSION}/${phoneNumberId}/messages`;

    const sendPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: testPhoneNumber,
      type: 'document',
      document: {
        id: mediaId,
        filename: filename,
      },
    };

    console.log('  📋 Send payload:', JSON.stringify(sendPayload, null, 2));
    console.log('');

    const sendResponse = await axios.post(sendUrl, sendPayload, {
      headers: {
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('  ✅ PDF sent!');
    console.log('  📋 Send response:', JSON.stringify(sendResponse.data, null, 2));
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ DEBUG COMPLETED!');
    console.log('');
    console.log('Summary:');
    console.log('  - Downloaded:', buffer.length, 'bytes from Drive');
    console.log('  - Uploaded:', buffer.length, 'bytes to WhatsApp');
    console.log('  - Media ID:', mediaId);
    console.log('  - Upload time:', uploadTime, 'ms');
    console.log('');
    console.log('Check your WhatsApp to verify the PDF size and content!');
    console.log('');

  } catch (error) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('❌ DEBUG FAILED!\n');
    console.error('Error:', error.message);

    if (error.response) {
      console.error('\nWhatsApp API Error Response:');
      console.error('  Status:', error.response.status);
      console.error('  Data:', JSON.stringify(error.response.data, null, 2));
    }

    console.error('\nFull error:', error);
    process.exit(1);
  }
}

debugWhatsAppUpload();
