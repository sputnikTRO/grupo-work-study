import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const SHEETS_ID = '18a2zVagPSu5iJf8GBdM_WcEnDC3vnZ2SHn7s_ftPmnk';
const SERVICE_ACCOUNT_EMAIL = 'grupo-w-s@travel-bot-490001.iam.gserviceaccount.com';
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDCEUQAusjmVI3o
7FdRrnxQGdKT5yQuD1crpTFloTKmZD1fjd5ebphPnXQ9YpWjIeji6akxGL+vR1A6
Mdkx61JbqBdayB9bXDq5RbE2/hzNN7dTsNdFU8OjT0xvMGm+f1JN8LcaiVrHuiqU
uEB4Xril7mQZFyMAXpV7nx7rsN0aOlnB3sOEb1+rAGsxV30hHst29ebC1wsgpZIo
TQZ0hhC1tCfoyNr4di7hUBcxjg1xEkeIUa+uFjohrbZIJWbRyO91gpQASZHr6jgj
1Psw9t40fhXd6yL++DwyRP7tGji92746BHrMuQQqrCvSc1Byh/HJhE38EHGdy6b7
hm0PgW07AgMBAAECggEAW3wFKSzkUQRSI5fqb+SH0MDjjnqbiSUNLFOC7kxn0p2V
ewqnZa/QGFP6/IcRUGZHYVTSQAVRM4E0NkLShyBOYkviupZ1hb18J2PNr0VqcWmP
ACJw0Ms0gjN7Lj1N1BI0S+6qepV+mIHP2ezj43qPpBU11cgc5WsxH6Y6ztPA30AJ
ITS04FlwzLHQOYZHRPohmbgW4iYkveehI3QAlAIX8T4hCaHVzOBwXuhL9q2oelPl
aebXu5Uv4dof7J9SM2+L7EHtN+aB4vVCHsXxic/dxrC4I1UUl4NZQm17g7a9qPss
SpYS6kSe1GLS0z/6Aoshta19gs63ZkRMmEUXRWXlJQKBgQDrhAGqycj5h62mYVUr
uhqtmCI5OaxjY8IAkMgF7d7g4S6vVZrtxvT4Ks7FhqyMPbcfUbXXUP3cxntKjZVk
1rRkuyCEyortsN+sEBS04ZJTKetog3ZBgPg9BBPnO3iuLzYFLk/ZR8LyNAsAirZ3
bI/VvFZ4jebgsNEr1wy3VC83twKBgQDS8l99E0b6LeQ5/4wduiYbNjZVUoj5e0AX
wQyT19+lTT9c2/3qnmWOZ1DqdlhOxlBkJ1fljUa9MeGvead4xUJHdBiW5iHt53K6
z7l19DtxSYDGrxyDOQRvnD5ouC/+37JaXV4q+0WvDNogiVZpKagtnJVoBBm2eIz2
bdlIiAHOnQKBgQDRR1Aj74MDGSmZe0wvuwQR1eozZ6hj+TVfQ0g63JD8y5yseSle
uTjdfUyYAYA6bmzXC8jGOFYdZNISAZYLMS7Dg/T1ivXBGTbosrFzui5IcCubh5YB
xxTPQ1xcUWB/h7w9BlY2Aaqdhtlv9dMGdBWsG9vK7G2IpBZ7GnFWRxxeKQKBgAIj
IoSJ5XYzcNSFmk3SzQAJlJNYurqMXSHgetgkn8d0+Odf8zqlUDIZKeC2Qj7KE5Zw
L5vLyqOwFbFJckDu/rTqoDUnL8DRT4BFCoP/bXrAW+WncIqD0V+wHZHCC/pxGcWA
nKui0Bnt72fU/GMkYOfVZk4ffIM0xXjZtBHgDuShAoGAUDwwcYjWX9q4/MT6LONZ
SYef6EEDSHmrs9krCo7oAKVZYISTz7Rx5boEDmKQ/mcQeybwzTrSUmyCQZ+3bL8w
d7bVWq0iM1WDqLZpiI9pAYZIqqCsAnoDQB3wLgpa4ckZi64GFEeP++c7Lglfz24Q
hGqRJj91+arunvKboZno0Sw=
-----END PRIVATE KEY-----`;

// Sheet definitions with headers and sample data
const SHEETS_CONFIG = [
  {
    name: 'Colegios',
    headers: ['codigo', 'nombre', 'zona', 'contacto'],
    sampleData: [
      ['WC', 'Winston Churchill', 'Norte', 'contacto@wc.edu.mx'],
      ['AM', 'Colegio Americano', 'Sur', 'info@americano.mx'],
      ['CB', 'Colegio Británico', 'Poniente', 'admisiones@britanico.mx'],
    ]
  },
  {
    name: 'Viajes',
    headers: ['codigo', 'destino', 'fechas_salida', 'precio', 'status', 'descripcion'],
    sampleData: [
      ['LON2026', 'Londres 2026', 'Julio 2026', '45000', 'activo', 'Viaje cultural a Londres con clases de inglés'],
      ['NYC2026', 'Nueva York 2026', 'Agosto 2026', '52000', 'activo', 'Experiencia en Nueva York con homestay'],
    ]
  },
  {
    name: 'Materiales',
    headers: ['id', 'nombre', 'tipo', 'url', 'contenido', 'descripcion'],
    sampleData: [
      ['BROCHURE_LON', 'Brochure Londres', 'PDF', 'https://example.com/brochure.pdf', '', 'Información completa del viaje a Londres'],
      ['PRECIOS', 'Lista de Precios', 'PDF', 'https://example.com/precios.pdf', '', 'Precios y esquemas de pago'],
    ]
  },
  {
    name: 'Esquemas de Pago',
    headers: ['viaje_codigo', 'modalidad', 'detalles', 'monto_inicial'],
    sampleData: [
      ['LON2026', 'Mensualidades', '12 meses sin intereses', '5000'],
      ['LON2026', 'Contado', 'Pago único con 10% descuento', '40500'],
    ]
  },
  {
    name: 'Actividades',
    headers: ['viaje_codigo', 'nombre', 'costo', 'descripcion', 'incluido'],
    sampleData: [
      ['LON2026', 'Museo Británico', '0', 'Visita al museo más importante de Londres', 'sí'],
      ['LON2026', 'London Eye', '500', 'Paseo en la rueda de la fortuna', 'no'],
    ]
  },
  {
    name: 'Asesoras',
    headers: ['school_code', 'nombre', 'whatsapp', 'email'],
    sampleData: [
      ['WC', 'María González', '5215512345678', 'maria@grupoworkystudy.com'],
      ['AM', 'Laura Martínez', '5215587654321', 'laura@grupoworkystudy.com'],
    ]
  },
  {
    name: 'FAQ',
    headers: ['pregunta', 'respuesta', 'categoria'],
    sampleData: [
      ['¿Qué incluye el viaje?', 'El viaje incluye: vuelo redondo, hospedaje, clases de inglés, actividades culturales y seguro médico.', 'General'],
      ['¿Necesito visa?', 'Sí, necesitas visa de turista. Te ayudamos con todo el proceso de tramitación.', 'Documentación'],
    ]
  },
  {
    name: 'Configuración',
    headers: ['parametro', 'valor'],
    sampleData: [
      ['handoff_score_threshold', '7'],
      ['max_follow_ups', '3'],
    ]
  },
  {
    name: 'Leads_Log',
    headers: [
      'timestamp',
      'nombre',
      'telefono',
      'colegio',
      'programa',
      'destino',
      'edad_estudiante',
      'score',
      'estatus',
      'asesor_asignado',
      'materiales_enviados',
      'ultimo_contacto',
      'notas'
    ],
    sampleData: [] // No sample data for logs
  }
];

async function setupSheets() {
  console.log('🚀 Iniciando configuración de Google Sheets...\n');

  try {
    // Authenticate
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: PRIVATE_KEY,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Get existing sheets
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEETS_ID,
    });

    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    console.log('📄 Hojas existentes:', existingSheets.join(', '));
    console.log('');

    // Create new sheets
    const requests = [];
    for (const config of SHEETS_CONFIG) {
      if (!existingSheets.includes(config.name)) {
        requests.push({
          addSheet: {
            properties: {
              title: config.name,
            }
          }
        });
        console.log(`➕ Programando creación de: ${config.name}`);
      } else {
        console.log(`✅ Ya existe: ${config.name}`);
      }
    }

    // Execute batch create
    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEETS_ID,
        resource: { requests }
      });
      console.log(`\n✅ ${requests.length} hojas creadas exitosamente\n`);
    } else {
      console.log('\n✅ Todas las hojas ya existen\n');
    }

    // Add headers and sample data to each sheet
    console.log('📝 Agregando encabezados y datos de ejemplo...\n');

    for (const config of SHEETS_CONFIG) {
      const allData = [config.headers, ...config.sampleData];

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEETS_ID,
        range: `${config.name}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: allData
        }
      });

      console.log(`✅ ${config.name}: ${config.headers.length} columnas, ${config.sampleData.length} filas de ejemplo`);
    }

    console.log('\n🎉 ¡Configuración completada exitosamente!');
    console.log(`\n🔗 Abre tu hoja: https://docs.google.com/spreadsheets/d/${SHEETS_ID}/edit`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 403) {
      console.error('\n⚠️  Asegúrate de que has compartido la hoja con:');
      console.error(`   ${SERVICE_ACCOUNT_EMAIL}`);
    }
    process.exit(1);
  }
}

// Run the setup
setupSheets();
