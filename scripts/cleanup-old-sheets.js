import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para limpiar hojas antiguas del Google Sheets
 */

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

// Hojas que DEBEN mantenerse (nueva estructura)
const KEEP_SHEETS = [
  'Viajes',
  'Precios',
  'Colegios',
  'Actividades Extra',
  'Info General',
  'Materiales',
  'Leads',
];

// Hojas que DEBEN eliminarse (estructura antigua)
const DELETE_SHEETS = [
  'Actividades',        // Reemplazada por "Actividades Extra"
  'Asesoras',          // Consolidada en "Colegios"
  'Esquemas de Pago',  // Consolidada en "Precios"
  'FAQ',               // Consolidada en "Info General"
  'Info_Viajes',       // Consolidada en "Info General"
  'Configuración',     // Movida a variables de entorno
  'Leads_Log',         // Reemplazada por "Leads"
];

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function main() {
  console.log('🧹 LIMPIEZA DE HOJAS ANTIGUAS\n');
  console.log(`📄 Sheet ID: ${SHEET_ID}\n`);

  // Obtener todas las hojas del spreadsheet
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });

  const allSheets = spreadsheet.data.sheets.map(s => ({
    id: s.properties.sheetId,
    title: s.properties.title,
  }));

  console.log(`📊 Total de hojas encontradas: ${allSheets.length}\n`);

  // Listar todas las hojas
  console.log('📋 HOJAS ACTUALES:\n');
  for (const sheet of allSheets) {
    const shouldKeep = KEEP_SHEETS.includes(sheet.title);
    const shouldDelete = DELETE_SHEETS.includes(sheet.title);

    if (shouldKeep) {
      console.log(`   ✅ ${sheet.title} (MANTENER)`);
    } else if (shouldDelete) {
      console.log(`   ❌ ${sheet.title} (ELIMINAR)`);
    } else {
      console.log(`   ⚠️  ${sheet.title} (DESCONOCIDA)`);
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Identificar hojas a eliminar
  const sheetsToDelete = allSheets.filter(sheet =>
    DELETE_SHEETS.includes(sheet.title) ||
    (!KEEP_SHEETS.includes(sheet.title) && sheet.title !== 'Hoja 1')  // Evitar eliminar "Hoja 1" por si acaso
  );

  if (sheetsToDelete.length === 0) {
    console.log('✅ No hay hojas antiguas para eliminar\n');
    return;
  }

  console.log(`🗑️  ELIMINANDO ${sheetsToDelete.length} HOJAS ANTIGUAS:\n`);

  // Eliminar hojas una por una
  for (const sheet of sheetsToDelete) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: {
          requests: [{
            deleteSheet: {
              sheetId: sheet.id
            }
          }]
        }
      });
      console.log(`   ✓ Eliminada: ${sheet.title}`);
    } catch (error) {
      console.error(`   ✗ Error eliminando ${sheet.title}:`, error.message);
    }
  }

  console.log('\n✅ LIMPIEZA COMPLETADA\n');

  // Verificar hojas finales
  const finalSpreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });

  const finalSheets = finalSpreadsheet.data.sheets.map(s => s.properties.title);

  console.log('📊 HOJAS FINALES:\n');
  finalSheets.forEach(title => {
    console.log(`   ✅ ${title}`);
  });

  console.log(`\n🎉 Total de hojas: ${finalSheets.length}\n`);

  if (finalSheets.length === 7) {
    console.log('✅ PERFECTO - Exactamente 7 hojas (6 + Leads)\n');
  } else {
    console.log(`⚠️  Se esperaban 7 hojas, pero hay ${finalSheets.length}\n`);
  }
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
