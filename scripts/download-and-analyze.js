/**
 * Download and analyze key files from Drive
 */

import { google } from 'googleapis';
import { env } from '../src/config/env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILES_TO_DOWNLOAD = {
  'Colegios inscritos precios.xlsx': '1asHtxHS1rTD4ptWoxWVk17h0L3KXUcC4',
  'Ejecutivos Asignación Aleatoria.docx': '1VhggSNzKje1xCUCHJ7REUoRf1d75yFn0',
  'Preguntas asistente virtual.pdf': '1kzecZDFnNwl6J2QgFhoLXgKHJZdI4e29',
  '_English4Life - JDP DUBLIN GENERAL.pdf': '1gRsB92ZpVBrBSzb69-9v1wNItpr86B7s',
  'English4Life - JDP LONDRES.pdf': '1DwXA4kLifl6aa38EfPN08QctRSF8PDvI',
  'Rising Stars 2027 (2).pdf': '1MwG1ycdRfVHwjtIMJf--xmU-UulYNEcs',
};

async function downloadFiles() {
  try {
    console.log('📥 Downloading files from Google Drive...\n');

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY,
      },
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // Create downloads directory
    const downloadsDir = path.join(__dirname, '..', 'downloads', 'travel-docs');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

    console.log(`📁 Saving to: ${downloadsDir}\n`);
    console.log('─'.repeat(80));

    for (const [filename, fileId] of Object.entries(FILES_TO_DOWNLOAD)) {
      try {
        console.log(`\n📄 Downloading: ${filename}`);

        const destPath = path.join(downloadsDir, filename);

        // Download file
        const response = await drive.files.get(
          {
            fileId: fileId,
            alt: 'media',
          },
          {
            responseType: 'stream',
          }
        );

        const dest = fs.createWriteStream(destPath);

        await new Promise((resolve, reject) => {
          response.data
            .on('end', () => {
              console.log(`   ✅ Saved to: ${filename}`);
              resolve();
            })
            .on('error', err => {
              console.log(`   ❌ Error: ${err.message}`);
              reject(err);
            })
            .pipe(dest);
        });

        // Get file size
        const stats = fs.statSync(destPath);
        console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);

      } catch (error) {
        console.log(`   ❌ Error downloading ${filename}: ${error.message}`);
      }
    }

    console.log('\n' + '─'.repeat(80));
    console.log('\n✅ Download complete!\n');
    console.log(`📂 Files saved to: ${downloadsDir}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

downloadFiles();
