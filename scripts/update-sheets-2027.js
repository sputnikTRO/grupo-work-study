/**
 * Script to update Google Sheets with 2027 program information
 */

import { updateRange, appendRows } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function updateSheets2027() {
  try {
    console.log('📊 Updating Google Sheets with 2027 Program Data...\n');
    console.log('Spreadsheet ID:', SPREADSHEET_ID);
    console.log('─'.repeat(80));

    // ========================================
    // 1. UPDATE VIAJES SHEET
    // ========================================
    console.log('\n🌍 Updating Viajes sheet...');

    const viajesData = [
      ['Código', 'Destino', 'Descripción', 'Fecha Salida', 'Fecha Regreso', 'Estado'],
      ['LON2027', 'Londres 2027', 'Viaje cultural a Londres con clases de inglés', '21 mayo 2027', '30 mayo 2027', 'activo'],
      ['DUB2027', 'Dublín 2027', 'Viaje cultural a Dublín con clases de inglés', '21 mayo 2027', '30 mayo 2027', 'activo'],
    ];

    await updateRange(SPREADSHEET_ID, 'Viajes!A1:F3', viajesData);
    console.log('✅ Viajes updated: 2 destinations added (Londres 2027, Dublín 2027)');

    // ========================================
    // 2. UPDATE COLEGIOS SHEET
    // ========================================
    console.log('\n🏫 Updating Colegios sheet...');

    const colegiosData = [
      ['Código', 'Nombre Colegio', 'Asesora', 'WhatsApp Asesora', 'Email Asesora', 'Zona'],
      ['JFR', 'Instituto J. Francisco Rodriguez', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Dublín'],
      ['LTP', 'Colegio Luz del Tepeyac', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Dublín'],
      ['RKO', 'Instituto Ramiro Kolbe', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Dublín'],
      ['TH', 'The Hills Institute', 'Camila Serafin', '5539771457', 'camila.serafin@oxfordeducationlit.org', 'Londres'],
      ['FER', 'Colegio Profr. Francisco Errasquin Gomez', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Londres'],
      ['ARI', 'Colegio Arista', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Londres'],
      ['UTC', 'UTEC', 'Camila Serafin', '5539771457', 'camila.serafin@oxfordeducationlit.org', 'Londres'],
      ['BEL', 'Belfortt', 'Camila Serafin', '5539771457', 'camila.serafin@oxfordeducationlit.org', 'Londres'],
      ['KSL', 'Instituto Kino de San Luis', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Dublín'],
      ['GSK', 'Global Skills', 'Camila Serafin', '5539771457', 'camila.serafin@oxfordeducationlit.org', 'Londres'],
      ['CEN', 'Centro de Estudios Naucalpan', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Londres'],
      ['COL', 'Colegio Columbia', 'Camila Serafin', '5539771457', 'camila.serafin@oxfordeducationlit.org', 'Londres'],
      ['IMC', 'Instituto Martha Christlieb', 'Cecilia Rodríguez', '5544884437', 'cecilia@oxfordeducationlit.org', 'Dublín'],
    ];

    await updateRange(SPREADSHEET_ID, 'Colegios!A1:F14', colegiosData);
    console.log('✅ Colegios updated: 13 schools added with assigned advisors');

    // ========================================
    // 3. UPDATE PRECIOS SHEET
    // ========================================
    console.log('\n💰 Updating Precios sheet...');

    const preciosData = [
      ['Colegio', 'Código Viaje', 'Precio Total', 'Apartado', 'Mensualidades', 'Meses', 'Fecha Límite Pago', 'Notas'],
      ['TODOS', 'LON2027', '34990', '10000', 'Por definir', 'Por definir', '30/06/2026', 'Precio general Londres 2027'],
      ['TODOS', 'DUB2027', '34990', '10000', 'Por definir', 'Por definir', '30/06/2026', 'Precio general Dublín 2027'],
      ['TH', 'LON2027', '34990', '10000', 'Por definir', 'Por definir', '30/06/2026', 'The Hills Institute'],
      ['KSL', 'DUB2027', '39990', '10000', 'Por definir', 'Por definir', '30/06/2026', 'Instituto Kino de San Luis'],
      ['GSK', 'LON2027', '35000', '10000', 'Por definir', 'Por definir', '30/06/2026', 'Global Skills - Vuelo $37,000'],
      ['CEN', 'LON2027', '39990', '10000', 'Por definir', 'Por definir', '30/06/2026', 'Centro de Estudios Naucalpan - Vuelo $36,000'],
      ['COL', 'LON2027', '85000', '15000', 'Por definir', 'Por definir', '30/06/2026', 'Colegio Columbia - Modalidad Hotel'],
    ];

    await updateRange(SPREADSHEET_ID, 'Precios!A1:H8', preciosData);
    console.log('✅ Precios updated: 7 pricing schemes added');

    // ========================================
    // 4. UPDATE INFO GENERAL WITH FAQS
    // ========================================
    console.log('\n❓ Updating Info General (FAQs)...');

    const faqsData = [
      ['Código Viaje', 'Categoría', 'Título', 'Contenido', 'Orden'],
      ['TODOS', 'FAQ', '¿De qué trata el programa English 4 Life?', 'English 4 Life es un programa inmersivo de inglés que combina un viaje educativo a Londres o Dublín con actividades y retos diseñados para practicar el idioma en situaciones reales.', '1'],
      ['TODOS', 'FAQ', '¿Cuál es el objetivo del programa?', 'El objetivo es que los estudiantes mejoren su inglés mientras viven experiencias culturales reales, ganan confianza al comunicarse y desarrollar habilidades para la vida, no solo para el salón de clases.', '2'],
      ['TODOS', 'FAQ', '¿A qué países se viaja con English 4 Life?', 'El programa 2027 se realiza en dos destinos principales: Londres, en Inglaterra, y Dublín, en Irlanda.', '3'],
      ['TODOS', 'FAQ', '¿Cuánto dura el viaje?', 'El viaje tiene una duración de 9 días y 8 noches, 10 días totales de viaje del 21 al 30 de Mayo 2027.', '4'],
      ['TODOS', 'FAQ', '¿Cuánto cuesta?', 'El precio del programa académico es de $34,990 pesos mexicanos y es posible apartar un espacio desde $10,000 pesos. Precio promoción vigente al 30 de junio 2026. El vuelo se cotiza por separado (aproximadamente $35,000-$37,000 MXN).', '5'],
      ['TODOS', 'FAQ', '¿Mi hijo puede viajar solo aunque sus compañeros de colegio no lo hagan?', 'Sí, es posible, se integraría al grupo de edad que se forme para el viaje, con Staff nuestro como responsable.', '6'],
      ['TODOS', 'FAQ', '¿El viaje es seguro para los estudiantes?', 'Sí, el programa está acompañado por Staff responsable 24/7 y un profesor de su Colegio. Los estudiantes viajan en grupo, con supervisión y actividades planificadas.', '7'],
      ['TODOS', 'FAQ', '¿Cuál es la edad mínima y máxima para participar?', 'El programa está diseñado para alumnos de 13 años en adelante. Hay subdivisiones por edades y nivel de idioma, se definen al momento de armar los grupos.', '8'],
      ['TODOS', 'FAQ', '¿Se necesita nivel avanzado de inglés?', 'No es necesario tener un nivel avanzado de inglés; el programa está diseñado para que los estudiantes practiquen y mejoren su fluidez y la confianza al hablarlo. Para la parte académica se hacen grupos de acuerdo a su nivel de manejo del idioma.', '9'],
      ['TODOS', 'Trámites', '¿Se necesita visa para viajar?', 'No es necesario tramitar visa. Para Londres se requiere tramitar la ETA (Electronic Travel Authorisation) con anticipación. Para Dublín no se requiere ningún trámite de ingreso. Otras nacionalidades diferentes a la mexicana se deben validar en la página de la embajada de cada país.', '10'],
      ['TODOS', 'Trámites', '¿Qué vigencia mínima debe tener el pasaporte?', 'Por ley todos los pasaportes deben tener una vigencia mínima de 6 meses posteriores a la fecha de regreso del viaje. Para English 4 Life Mayo 2027, el pasaporte debe tener vigencia mínima de noviembre de 2027 en adelante.', '11'],
      ['TODOS', 'Trámites', '¿Cómo funciona la ETA?', 'El costo de la ETA es de 16 libras. Debe solicitarse en https://www.gov.uk/eta. Una vez cerrado el grupo, se acompaña en el proceso para completar correctamente los trámites. Solo se requiere para Londres, NO para Dublín.', '12'],
      ['TODOS', 'Hospedaje', '¿Cómo es el hospedaje?', 'El hospedaje es en casas de familia anfitriona (homestay), previamente evaluadas y autorizadas. 2 estudiantes por habitación en camas individuales. Hasta 4 estudiantes en una misma casa, regularmente del mismo colegio. No se mezclan géneros en la asignación. Las casas se ubican en zonas residenciales seguras.', '13'],
      ['TODOS', 'Pagos', '¿Cómo inscribo a mi hijo y cuánto es el pago inicial?', 'Llena el formulario, aparta con $10,000 MXN en la semana siguiente a la junta de padres.', '14'],
      ['TODOS', 'Pagos', '¿Se puede cancelar después del apartado?', 'Contamos con un seguro de cancelación de $1,500 MXN. Si la cancelación es 90 días antes del viaje, se regresa el 100% del monto pagado. Si se cancela 60 días antes, se reembolsa el 50%. Y una cancelación 30 días antes permite el reembolso del 30%. En todos los casos se retiene $7,500 pesos por concepto de inscripción.', '15'],
      ['TODOS', 'Seguros', '¿Qué cubre el seguro de gastos médicos?', 'El programa incluye un seguro de gastos médicos mayores con cobertura amplia en Reino Unido e Irlanda. Cubre atención médica por enfermedad o accidente durante la estancia, incluyendo consultas, hospitalización, estudios y tratamientos. No requiere deducible ni coaseguro por parte de la familia.', '16'],
      ['TODOS', 'General', '¿Cuánto deben considerar para gastos adicionales?', 'El programa incluye desayuno y cena. Para el almuerzo, se recomienda considerar un promedio de £20 por día. En cuanto a souvenirs o compras personales, el monto es a criterio de cada familia.', '17'],
      ['TODOS', 'General', '¿Este viaje aporta algo para su futuro académico?', 'Sí. English 4 Life es una experiencia académica internacional que fortalece el perfil del estudiante. Además de la mejora en el idioma, reciben un diploma de participación con valor curricular y desarrollan habilidades como autonomía, adaptación cultural y comunicación intercultural, competencias valoradas en procesos universitarios.', '18'],
    ];

    await updateRange(SPREADSHEET_ID, 'Info General!A1:E19', faqsData);
    console.log('✅ Info General updated: 18 FAQs added');

    console.log('\n' + '─'.repeat(80));
    console.log('\n✅ All updates completed successfully!\n');
    console.log('📊 Summary:');
    console.log('  • Viajes: 2 destinations added (Londres 2027, Dublín 2027)');
    console.log('  • Colegios: 13 schools with assigned advisors');
    console.log('  • Precios: 7 pricing schemes');
    console.log('  • Info General: 18 FAQs');
    console.log('\n🎯 Next steps:');
    console.log('  1. Add remaining FAQs from PDF (12 more questions)');
    console.log('  2. Update Materiales sheet with brochures');
    console.log('  3. Implement carousel logic for new schools');
    console.log('  4. Test Miri with updated information\n');

  } catch (error) {
    console.error('❌ Error updating sheets:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run update
updateSheets2027();
