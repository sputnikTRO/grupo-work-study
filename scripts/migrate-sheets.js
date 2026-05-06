import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script de Migración de Google Sheets
 *
 * Migra la estructura antigua a la nueva con headers en español
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
      range: `${sheetName}!A1:Z1000`,
    });
    return response.data.values || [];
  } catch (error) {
    console.log(`⚠️  Hoja "${sheetName}" no existe o está vacía`);
    return [];
  }
}

/**
 * Escribe datos en una hoja (reemplaza todo)
 */
async function writeSheet(sheetName, data) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    resource: { values: data },
  });
}

/**
 * Crea una nueva hoja
 */
async function createSheet(sheetName) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      resource: {
        requests: [{
          addSheet: {
            properties: { title: sheetName }
          }
        }]
      }
    });
    console.log(`✅ Hoja "${sheetName}" creada`);
  } catch (error) {
    console.log(`⚠️  Hoja "${sheetName}" ya existe o error al crear:`, error.message);
  }
}

/**
 * Renombra una hoja
 */
async function renameSheet(oldName, newName) {
  try {
    // Primero obtener el ID de la hoja
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });

    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === oldName);
    if (!sheet) {
      console.log(`⚠️  Hoja "${oldName}" no encontrada`);
      return;
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      resource: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: sheet.properties.sheetId,
              title: newName
            },
            fields: 'title'
          }
        }]
      }
    });
    console.log(`✅ Hoja "${oldName}" renombrada a "${newName}"`);
  } catch (error) {
    console.error(`❌ Error renombrando "${oldName}":`, error.message);
  }
}

/**
 * PASO 1: Leer estructura actual
 */
async function step1_readCurrentStructure() {
  console.log('\n📖 PASO 1: Leyendo estructura actual...\n');

  const sheets = ['Colegios', 'Viajes', 'Actividades', 'Materiales', 'Asesoras', 'Esquemas de Pago', 'FAQ', 'Info_Viajes'];

  const data = {};
  for (const sheetName of sheets) {
    data[sheetName] = await readSheet(sheetName);
    console.log(`   ${sheetName}: ${data[sheetName].length} filas`);
  }

  return data;
}

/**
 * PASO 2: Actualizar hoja Viajes
 */
async function step2_updateViajes(currentData) {
  console.log('\n🔄 PASO 2: Actualizando hoja "Viajes"...\n');

  const oldViajes = currentData['Viajes'] || [];
  if (oldViajes.length === 0) {
    console.log('⚠️  No hay datos en Viajes');
    return;
  }

  // Nuevos headers
  const newHeaders = ['Código', 'Destino', 'Descripción', 'Fecha Salida', 'Fecha Regreso', 'Estado'];

  // Mapear datos antiguos a nuevos
  const newData = [newHeaders];

  // Asumiendo estructura antigua: codigo, destino, fechas_salida, precio, status, descripcion
  for (let i = 1; i < oldViajes.length; i++) {
    const row = oldViajes[i];
    newData.push([
      row[0] || '',  // Código
      row[1] || '',  // Destino
      row[5] || '',  // Descripción (era columna 6)
      row[2] || '',  // Fecha Salida (era fechas_salida)
      '',            // Fecha Regreso (nueva columna, llenar manualmente)
      row[4] || 'activo',  // Estado (era status)
    ]);
  }

  await writeSheet('Viajes', newData);
  console.log(`✅ Hoja "Viajes" actualizada con ${newData.length - 1} filas`);
}

/**
 * PASO 3: Crear hoja Precios y migrar datos
 */
async function step3_createPrecios(currentData) {
  console.log('\n🔄 PASO 3: Creando hoja "Precios"...\n');

  await createSheet('Precios');

  const oldViajes = currentData['Viajes'] || [];
  const oldEsquemas = currentData['Esquemas de Pago'] || [];

  // Headers
  const newHeaders = ['Colegio', 'Código Viaje', 'Precio Total', 'Apartado', 'Mensualidades', 'Meses', 'Fecha Límite Pago', 'Notas'];
  const newData = [newHeaders];

  // Para cada viaje, crear entrada TODOS
  for (let i = 1; i < oldViajes.length; i++) {
    const viaje = oldViajes[i];
    const codigo = viaje[0];
    const precioTotal = viaje[3] || '75990'; // Columna precio en viajes antiguos

    // Buscar esquema de pago para este viaje
    let apartado = '15000';
    let mensualidades = '6';
    let meses = '6';

    const esquema = oldEsquemas.find(e => e[0] === codigo);
    if (esquema) {
      apartado = esquema[3] || '15000'; // monto_inicial
      // Parsear detalles si existen
    }

    // Crear fila TODOS (precio general)
    newData.push([
      'TODOS',
      codigo,
      precioTotal,
      apartado,
      mensualidades,
      meses,
      '15/06/2026', // Fecha límite ejemplo
      'Precio general para todos los colegios'
    ]);

    console.log(`   ✓ Agregado precio TODOS para viaje ${codigo}: $${precioTotal}`);
  }

  // Agregar entrada específica para Winston Churchill (ejemplo)
  if (newData.length > 1) {
    const primeraFila = newData[1];
    newData.push([
      'WC',
      primeraFila[1], // Mismo código de viaje
      '72000',        // Precio especial WC
      '12000',
      '6',
      '6',
      '15/06/2026',
      'Precio especial Winston Churchill'
    ]);
    console.log(`   ✓ Agregado precio específico para WC: $72,000`);
  }

  await writeSheet('Precios', newData);
  console.log(`✅ Hoja "Precios" creada con ${newData.length - 1} filas`);
}

/**
 * PASO 4: Actualizar hoja Colegios con datos de Asesoras
 */
async function step4_updateColegios(currentData) {
  console.log('\n🔄 PASO 4: Actualizando hoja "Colegios"...\n');

  const oldColegios = currentData['Colegios'] || [];
  const oldAsesoras = currentData['Asesoras'] || [];

  if (oldColegios.length === 0) {
    console.log('⚠️  No hay datos en Colegios');
    return;
  }

  // Nuevos headers
  const newHeaders = ['Código', 'Nombre Colegio', 'Asesora', 'WhatsApp Asesora', 'Email Asesora', 'Zona'];
  const newData = [newHeaders];

  // Mapear datos
  for (let i = 1; i < oldColegios.length; i++) {
    const colegio = oldColegios[i];
    const codigo = colegio[0];

    // Buscar asesora para este colegio
    const asesora = oldAsesoras.find(a => a[0] === codigo);

    newData.push([
      codigo || '',           // Código
      colegio[1] || '',       // Nombre Colegio (era nombre)
      asesora ? asesora[1] : '', // Asesora nombre
      asesora ? asesora[2] : '', // WhatsApp Asesora
      asesora ? asesora[3] : '', // Email Asesora
      colegio[2] || '',       // Zona
    ]);
  }

  await writeSheet('Colegios', newData);
  console.log(`✅ Hoja "Colegios" actualizada con ${newData.length - 1} filas`);
}

/**
 * PASO 5: Renombrar Actividades a Actividades Extra
 */
async function step5_renameActividades(currentData) {
  console.log('\n🔄 PASO 5: Renombrando "Actividades" a "Actividades Extra"...\n');

  const oldActividades = currentData['Actividades'] || [];

  if (oldActividades.length === 0) {
    console.log('⚠️  No hay datos en Actividades');
    return;
  }

  // Primero crear la nueva hoja
  await createSheet('Actividades Extra');

  // Nuevos headers
  const newHeaders = ['Código Viaje', 'Nombre', 'Precio', 'Descripción', 'Incluido', 'Fecha Límite'];
  const newData = [newHeaders];

  // Migrar datos (asumiendo: viaje_codigo, nombre, costo, descripcion, incluido)
  for (let i = 1; i < oldActividades.length; i++) {
    const row = oldActividades[i];
    newData.push([
      row[0] || '',  // Código Viaje (era viaje_codigo)
      row[1] || '',  // Nombre
      row[2] || '',  // Precio (era costo)
      row[3] || '',  // Descripción
      row[4] || '',  // Incluido
      '',            // Fecha Límite (nueva columna)
    ]);
  }

  await writeSheet('Actividades Extra', newData);
  console.log(`✅ Hoja "Actividades Extra" creada con ${newData.length - 1} filas`);
}

/**
 * PASO 6: Crear Info General fusionando FAQ e Info_Viajes
 */
async function step6_createInfoGeneral(currentData) {
  console.log('\n🔄 PASO 6: Creando "Info General"...\n');

  await createSheet('Info General');

  const oldFAQ = currentData['FAQ'] || [];
  const oldInfoViajes = currentData['Info_Viajes'] || [];

  // Headers
  const newHeaders = ['Código Viaje', 'Categoría', 'Título', 'Contenido', 'Orden'];
  const newData = [newHeaders];

  let orden = 1;

  // Migrar FAQ (asumiendo: pregunta, respuesta, categoria)
  for (let i = 1; i < oldFAQ.length; i++) {
    const row = oldFAQ[i];
    newData.push([
      'TODOS',       // Código Viaje (FAQ aplica a todos)
      'FAQ',         // Categoría
      row[0] || '',  // Título (era pregunta)
      row[1] || '',  // Contenido (era respuesta)
      orden++,       // Orden
    ]);
  }
  console.log(`   ✓ Migrados ${oldFAQ.length - 1} FAQ`);

  // Migrar Info_Viajes (asumiendo: viaje_codigo, categoria, titulo, contenido)
  for (let i = 1; i < oldInfoViajes.length; i++) {
    const row = oldInfoViajes[i];
    newData.push([
      row[0] || '',  // Código Viaje
      row[1] || '',  // Categoría
      row[2] || '',  // Título
      row[3] || '',  // Contenido
      orden++,       // Orden
    ]);
  }
  console.log(`   ✓ Migrados ${oldInfoViajes.length - 1} Info Viajes`);

  await writeSheet('Info General', newData);
  console.log(`✅ Hoja "Info General" creada con ${newData.length - 1} filas`);
}

/**
 * PASO 7: Actualizar Materiales
 */
async function step7_updateMateriales(currentData) {
  console.log('\n🔄 PASO 7: Actualizando "Materiales"...\n');

  const oldMateriales = currentData['Materiales'] || [];

  if (oldMateriales.length === 0) {
    console.log('⚠️  No hay datos en Materiales');
    return;
  }

  // Nuevos headers
  const newHeaders = ['ID', 'Nombre', 'Tipo', 'URL', 'Código Viaje', 'Código Colegio', 'Descripción'];
  const newData = [newHeaders];

  // Migrar datos (asumiendo: id, nombre, tipo, url, contenido, descripcion)
  for (let i = 1; i < oldMateriales.length; i++) {
    const row = oldMateriales[i];
    newData.push([
      row[0] || '',  // ID
      row[1] || '',  // Nombre
      row[2] || '',  // Tipo
      row[3] || row[4] || '',  // URL (era url o contenido)
      'TODOS',       // Código Viaje (por defecto TODOS, ajustar manualmente si necesario)
      'TODOS',       // Código Colegio (por defecto TODOS, ajustar manualmente si necesario)
      row[5] || '',  // Descripción
    ]);
  }

  await writeSheet('Materiales', newData);
  console.log(`✅ Hoja "Materiales" actualizada con ${newData.length - 1} filas`);
}

/**
 * PASO 8: Crear hoja Leads
 */
async function step8_createLeads() {
  console.log('\n🔄 PASO 8: Creando hoja "Leads"...\n');

  await createSheet('Leads');

  const headers = ['ID', 'Fecha', 'Nombre Padre', 'Nombre Viajero', 'Edad', 'Colegio', 'WhatsApp', 'Interés', 'Estado', 'Materiales Enviados', 'Asesor Asignado', 'Última Actualización', 'Canal', 'Notas'];

  await writeSheet('Leads', [headers]);
  console.log(`✅ Hoja "Leads" creada (se llenará automáticamente por el bot)`);
}

/**
 * Ejecutar migración completa
 */
async function main() {
  console.log('🚀 INICIANDO MIGRACIÓN DE GOOGLE SHEETS\n');
  console.log(`📄 Sheet ID: ${SHEET_ID}\n`);

  try {
    // Paso 1: Leer estructura actual
    const currentData = await step1_readCurrentStructure();

    // Paso 2: Actualizar Viajes
    await step2_updateViajes(currentData);

    // Paso 3: Crear Precios
    await step3_createPrecios(currentData);

    // Paso 4: Actualizar Colegios
    await step4_updateColegios(currentData);

    // Paso 5: Renombrar Actividades
    await step5_renameActividades(currentData);

    // Paso 6: Crear Info General
    await step6_createInfoGeneral(currentData);

    // Paso 7: Actualizar Materiales
    await step7_updateMateriales(currentData);

    // Paso 8: Crear Leads
    await step8_createLeads();

    console.log('\n✅ MIGRACIÓN COMPLETADA EXITOSAMENTE\n');
    console.log('📋 SIGUIENTES PASOS MANUALES:');
    console.log('   1. Revisar la hoja "Viajes" y agregar "Fecha Regreso"');
    console.log('   2. Revisar la hoja "Precios" y ajustar precios por colegio');
    console.log('   3. Revisar "Materiales" y asignar Código Viaje y Código Colegio específicos');
    console.log('   4. ELIMINAR hojas antiguas: Asesoras, Esquemas de Pago, FAQ, Info_Viajes, Configuración, Actividades (antigua)');
    console.log('\n🔄 Limpia el cache de Redis para que el bot cargue la nueva estructura');

  } catch (error) {
    console.error('\n❌ ERROR EN MIGRACIÓN:', error.message);
    console.error(error);
  }
}

main();
