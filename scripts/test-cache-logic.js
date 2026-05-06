import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function readSheet(sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${sheetName}!A1:Z100`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const headers = rows[0];
  const data = [];

  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = rows[i][j] || '';
    }
    data.push(obj);
  }

  return data;
}

async function main() {
  console.log('🔍 TESTING CACHE LOGIC\n');

  // Leer Viajes
  const viajes = await readSheet('Viajes');
  console.log('📅 HOJA VIAJES:');
  console.log('Total filas:', viajes.length);
  console.log('Datos completos:', JSON.stringify(viajes, null, 2));

  // Filtrar viajes activos (simular lógica del cache)
  const activos = viajes.filter(trip => {
    const estado = trip['Estado'];
    console.log(`\nProcesando viaje ${trip['Código']}:`);
    console.log('  Estado raw:', JSON.stringify(estado));
    console.log('  Estado length:', estado?.length);
    console.log('  Estado toLowerCase():', estado?.toLowerCase());
    console.log('  Comparación:', estado?.toLowerCase() === 'activo');
    return trip['Estado']?.toLowerCase() === 'activo';
  });

  console.log('\n✅ VIAJES ACTIVOS ENCONTRADOS:', activos.length);
  console.log(JSON.stringify(activos, null, 2));

  // Leer Materiales
  console.log('\n📄 HOJA MATERIALES:');
  const materiales = await readSheet('Materiales');
  console.log('Total materiales:', materiales.length);
  materiales.forEach(m => {
    console.log(`  - ${m['ID']}: ${m['Nombre']}`);
    console.log(`    Tipo: "${m['Tipo']}"`);
    console.log(`    URL: ${m['URL']}`);
    console.log(`    Código Viaje: "${m['Código Viaje']}"`);
    console.log(`    Código Colegio: "${m['Código Colegio']}"`);
  });

  // Leer Precios
  console.log('\n💰 HOJA PRECIOS:');
  const precios = await readSheet('Precios');
  console.log('Total precios:', precios.length);
  console.log(JSON.stringify(precios, null, 2));
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
