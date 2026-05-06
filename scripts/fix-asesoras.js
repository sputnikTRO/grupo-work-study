import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para actualizar las asesoras en la hoja Colegios
 */

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

// Configurar autenticación
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function main() {
  console.log('🔧 ACTUALIZANDO ASESORAS EN COLEGIOS\n');

  // Leer hoja Asesoras antigua
  const asesorasResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Asesoras!A1:Z100',
  });

  const asesorasData = asesorasResponse.data.values || [];
  console.log(`📖 Leídas ${asesorasData.length - 1} asesoras\n`);

  // Leer hoja Colegios nueva
  const colegiosResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Colegios!A1:Z100',
  });

  const colegiosData = colegiosResponse.data.values || [];
  console.log(`📖 Leídos ${colegiosData.length - 1} colegios\n`);

  // Actualizar cada colegio con su asesora
  for (let i = 1; i < colegiosData.length; i++) {
    const codigo = colegiosData[i][0];

    // Buscar asesora para este colegio
    const asesora = asesorasData.find(a => a[0] === codigo);

    if (asesora) {
      // Actualizar columnas C, D, E (Asesora, WhatsApp Asesora, Email Asesora)
      colegiosData[i][2] = asesora[1] || '';  // Asesora nombre
      colegiosData[i][3] = asesora[2] || '';  // WhatsApp
      colegiosData[i][4] = asesora[3] || '';  // Email

      console.log(`   ✓ ${codigo}: ${asesora[1]} - ${asesora[2]}`);
    } else {
      console.log(`   ⚠️  ${codigo}: Sin asesora`);
    }
  }

  // Escribir datos actualizados
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Colegios!A1',
    valueInputOption: 'RAW',
    resource: { values: colegiosData },
  });

  console.log('\n✅ Asesoras actualizadas en la hoja Colegios\n');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
