import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script de verificación de estructura del Google Sheets
 * (Sin necesidad de Redis)
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

/**
 * Lee datos de una hoja
 */
async function readSheet(sheetName) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A1:Z100`,
    });
    return response.data.values || [];
  } catch (error) {
    return null;
  }
}

/**
 * Verifica estructura de una hoja
 */
function verifySheetStructure(sheetName, data, expectedHeaders) {
  if (!data || data.length === 0) {
    console.log(`   ❌ ${sheetName}: No existe o está vacía`);
    return false;
  }

  const headers = data[0];
  const dataRows = data.length - 1;

  // Verificar headers
  const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
  const hasAllHeaders = missingHeaders.length === 0;

  if (hasAllHeaders) {
    console.log(`   ✅ ${sheetName}: ${dataRows} filas, headers correctos`);
    if (dataRows > 0) {
      console.log(`      Ejemplo: ${JSON.stringify(data[1].slice(0, 3))}...`);
    }
    return true;
  } else {
    console.log(`   ⚠️  ${sheetName}: ${dataRows} filas, faltan headers: ${missingHeaders.join(', ')}`);
    console.log(`      Headers actuales: ${headers.join(', ')}`);
    return false;
  }
}

async function main() {
  console.log('🔍 VERIFICACIÓN DE ESTRUCTURA DE GOOGLE SHEETS\n');
  console.log(`📄 Sheet ID: ${SHEET_ID}\n`);

  const expectedStructure = {
    'Viajes': ['Código', 'Destino', 'Descripción', 'Fecha Salida', 'Fecha Regreso', 'Estado'],
    'Precios': ['Colegio', 'Código Viaje', 'Precio Total', 'Apartado', 'Mensualidades', 'Meses', 'Fecha Límite Pago', 'Notas'],
    'Colegios': ['Código', 'Nombre Colegio', 'Asesora', 'WhatsApp Asesora', 'Email Asesora', 'Zona'],
    'Actividades Extra': ['Código Viaje', 'Nombre', 'Precio', 'Descripción', 'Incluido', 'Fecha Límite'],
    'Info General': ['Código Viaje', 'Categoría', 'Título', 'Contenido', 'Orden'],
    'Materiales': ['ID', 'Nombre', 'Tipo', 'URL', 'Código Viaje', 'Código Colegio', 'Descripción'],
    'Leads': ['ID', 'Fecha', 'Nombre Padre', 'Nombre Viajero', 'Edad', 'Colegio', 'WhatsApp', 'Interés', 'Estado', 'Materiales Enviados', 'Asesor Asignado', 'Última Actualización', 'Canal', 'Notas'],
  };

  console.log('📊 VERIFICACIÓN DE HOJAS:\n');

  let allCorrect = true;

  for (const [sheetName, expectedHeaders] of Object.entries(expectedStructure)) {
    const data = await readSheet(sheetName);
    const isCorrect = verifySheetStructure(sheetName, data, expectedHeaders);
    if (!isCorrect) allCorrect = false;
  }

  console.log('\n📋 VERIFICACIÓN DE LÓGICA:\n');

  // Verificar que existe precio TODOS
  const preciosData = await readSheet('Precios');
  if (preciosData && preciosData.length > 1) {
    const hasTodos = preciosData.slice(1).some(row => row[0] === 'TODOS');
    if (hasTodos) {
      console.log('   ✅ Existe precio con Colegio="TODOS" (fallback)');
    } else {
      console.log('   ⚠️  NO existe precio con Colegio="TODOS" - el fallback no funcionará');
      allCorrect = false;
    }

    const hasWC = preciosData.slice(1).some(row => row[0] === 'WC');
    if (hasWC) {
      console.log('   ✅ Existe precio específico para WC');
    } else {
      console.log('   ℹ️  No existe precio específico para WC (usará TODOS)');
    }
  }

  // Verificar que materiales tienen columnas TODOS
  const materialesData = await readSheet('Materiales');
  if (materialesData && materialesData.length > 1) {
    const hasTodos = materialesData.slice(1).some(row => row[4] === 'TODOS' && row[5] === 'TODOS');
    if (hasTodos) {
      console.log('   ✅ Existen materiales con Código Viaje="TODOS" y Código Colegio="TODOS"');
    } else {
      console.log('   ⚠️  NO existen materiales generales (TODOS/TODOS)');
    }
  }

  // Verificar que existen FAQ en Info General
  const infoGeneralData = await readSheet('Info General');
  if (infoGeneralData && infoGeneralData.length > 1) {
    const faqCount = infoGeneralData.slice(1).filter(row => row[1] === 'FAQ').length;
    if (faqCount > 0) {
      console.log(`   ✅ Existen ${faqCount} FAQs en Info General`);
    } else {
      console.log('   ⚠️  NO existen FAQs en Info General');
    }
  }

  // Verificar que Colegios tiene asesoras
  const colegiosData = await readSheet('Colegios');
  if (colegiosData && colegiosData.length > 1) {
    const withAdvisor = colegiosData.slice(1).filter(row => row[2]).length;
    if (withAdvisor > 0) {
      console.log(`   ✅ ${withAdvisor} colegios tienen asesora asignada`);
    } else {
      console.log('   ⚠️  Ningún colegio tiene asesora asignada');
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');

  if (allCorrect) {
    console.log('✅ ESTRUCTURA CORRECTA - El bot puede funcionar con esta estructura\n');
    console.log('🚀 SIGUIENTE PASO:');
    console.log('   El cache de Redis se limpiará automáticamente al redeploy');
    console.log('   O puedes reiniciar el servicio en Railway manualmente\n');
  } else {
    console.log('⚠️  ESTRUCTURA INCOMPLETA - Revisa los warnings arriba\n');
    console.log('📝 CORRECCIONES RECOMENDADAS:');
    console.log('   1. Asegúrate de que todas las hojas tengan los headers correctos');
    console.log('   2. Agrega al menos una fila con Colegio="TODOS" en Precios');
    console.log('   3. Revisa que todos los datos se migraron correctamente\n');
  }

  console.log('📖 Documentación completa: docs/MIGRACION_SHEETS.md\n');
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
