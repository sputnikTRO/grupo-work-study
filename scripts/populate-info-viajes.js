#!/usr/bin/env node
/**
 * Populates Info_Viajes sheet with London 2026 (CEWIN) trip information
 * Extracted from "Pre-Travel Experience - The Opening E4L" PDF
 */

import { appendRows, updateRange, sheetExists, createSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

const SHEET_ID = env.GOOGLE_SHEETS_ID;
const SHEET_NAME = 'Info_Viajes';

// Headers for Info_Viajes sheet
const INFO_VIAJES_HEADERS = ['viaje_codigo', 'categoria', 'titulo', 'contenido'];

// All Info_Viajes rows for LON2026 (CEWIN trip)
const INFO_VIAJES_DATA = [
  {
    viaje_codigo: 'LON2026',
    categoria: 'Fechas',
    titulo: 'Fechas del programa CEWIN',
    contenido: 'Salida CDMX 22 mayo 2026, Llegada Londres 23 mayo 2026, Regreso CDMX 31 mayo 2026'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Trámites',
    titulo: 'ETA (Electronic Travel Authorization)',
    contenido: 'Descargar app UK ETA del App Store o Google Play. Se requiere foto del pasaporte (vigencia 6 meses post-viaje), escaneo de rostro del menor, contestar preguntas. Pago con Visa o Mastercard. Precio: 16 libras. Vigencia: 2 años. Realizarlo con 1 mes de anticipación.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Trámites',
    titulo: 'Formato SAM (Salida de Menores)',
    contenido: 'Autorización para que menores salgan de México. Indispensable, sin él NO puede viajar. Vigencia 6 meses. Costo $294 MXN pagado en línea. Requiere: pasaporte original del menor, ID del padre/tutor, acta de nacimiento, comprobante de pago (original y 3 copias). Debe ser sellada por Agente Federal de Migración del INM. El menor y profesor acompañante deben estar presentes. Tramitar con 30 días de anticipación en aeropuerto. Página: https://www.inm.gob.mx/spublic/portal/inmex.html'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Clima',
    titulo: 'Clima en Londres - Mayo',
    contenido: 'Templado y variable, días frescos a ligeramente cálidos con posibles lluvias intermitentes. Temperaturas aprox 10-18°C, mezcla de nubes y ratos de sol.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Equipaje',
    titulo: 'Lista de equipaje recomendada',
    contenido: 'NECESER: desodorante, cepillo y pasta dental, shampoo, acondicionador, jabón, cremas, bloqueador, cepillo de cabello. ROPA: 1-2 sudaderas, 9-10 playeras, 1 chamarra impermeable, 4-6 pantalones, 10-13 pares calcetines, 10-13 mudas ropa interior, pijama abrigadora, chanclas de baño, 1-2 calza. IMPORTANTE: móvil (opcional), laptop/tablet, cargadores, batería externa, adaptadores UK, tarjeta Visa/Mastercard, auriculares. COMPLEMENTOS: paraguas, cojín para cuello, botiquín, botella de agua rellenable. NO LLEVAR: plancha de cabello, secadora, plancha de ropa. BACKPACK: cargador, dispositivos, adaptador, batería, cepillo dental. CARRY ON: cambio de ropa, snacks.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Equipaje',
    titulo: 'Botiquín recomendado',
    contenido: 'Paracetamol, Ibuprofeno, Buscapina, Graneodin B, Antigripal, Dramamine, Pepto Bismol, Melox Plus. Si el medicamento es de venta controlada, llevar medicamento y receta médica.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Conectividad',
    titulo: 'Opciones de conectividad en Londres',
    contenido: 'Opción 1: SIM local (EE, Vodafone, Three, O2) con planes prepago. Opción 2: eSIM internacional antes de viajar (Airalo, Holafly, TravSIM). Opción 3: Roaming con Telcel, AT&T o Movistar (más costoso). Tips: asegurar que el celular esté desbloqueado, usar WhatsApp para llamadas con datos o WiFi.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Finanzas',
    titulo: 'Información financiera recomendada',
    contenido: 'Llevar tarjetas de crédito o débito desbloqueadas para compras. Opcional llevar aprox 50 libras esterlinas en efectivo.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Actividades Extra',
    titulo: 'Opción 1: London Eye + West End Musical + Estadio',
    contenido: 'Incluye ingreso al London Eye (30 min), entradas a Musical de West End, visita a estadio de futbol (Wembley o Chelsea, sujeto a disponibilidad, 75 min). Precio: $5,300 MXN. Confirmar antes del 27 de febrero. Liquidar antes del 15 de marzo. El grupo completo debe escoger la misma opción.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Actividades Extra',
    titulo: 'Opción 2: Harry Potter Studio Tour',
    contenido: 'Visita por sets de grabación, efectos visuales, vestuarios originales. Actividades interactivas: volar en escoba, probar butter beer. Tiempo aprox 3.5 horas sin límite. Precio: $4,500 MXN. Confirmar antes del 27 de febrero. Liquidar antes del 15 de marzo.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Extensión',
    titulo: 'Extensión a París',
    contenido: 'Precio: $42,990 MXN por estudiante. Confirmar antes del 30 de enero (grupo completo). Pago antes del 15 de febrero. Incluye: traslado Londres-París, hospedaje hotel tipo ejecutivo (ej: Ibis), desayunos, walking tours, entrada a Disney Paris, entrada a Versalles, traslados, transfer al hotel, seguro de gastos médicos mayores, seguro de viaje, staff 24/7. Itinerario: Día 11 llegada + tour guiado + Trocadero noche. Día 12 Louvre + Eiffel Tower. Día 13 Disneyland. Día 14 Versalles + Montmartre. Día 15 Champs Elysees + partida.'
  },
  {
    viaje_codigo: 'LON2026',
    categoria: 'Sesiones',
    titulo: 'Sesiones Pre-Viaje',
    contenido: '1era sesión: Marzo. 2da sesión: Abril. 3ra sesión: Mayo.'
  }
];

async function populateInfoViajes() {
  const scriptLogger = logger.child({ script: 'populate-info-viajes' });

  try {
    console.log('\n🚀 Poblando hoja Info_Viajes con información de LON2026 (CEWIN)...\n');

    // Step 0: Check if sheet exists, create if not
    scriptLogger.info('Checking if Info_Viajes sheet exists');
    console.log('🔍 Paso 0: Verificando si existe la hoja Info_Viajes...');

    const exists = await sheetExists(SHEET_ID, SHEET_NAME);

    if (!exists) {
      console.log('⚠️  La hoja no existe. Creando...');
      scriptLogger.info('Creating Info_Viajes sheet');
      await createSheet(SHEET_ID, SHEET_NAME);
      console.log('✅ Hoja Info_Viajes creada correctamente\n');
    } else {
      console.log('✅ La hoja Info_Viajes ya existe\n');
    }

    // Step 1: Create headers row
    scriptLogger.info('Creating Info_Viajes sheet headers');
    console.log('📝 Paso 1: Creando headers de la hoja Info_Viajes...');

    await updateRange(SHEET_ID, `${SHEET_NAME}!A1:D1`, [INFO_VIAJES_HEADERS]);
    console.log('✅ Headers creados correctamente\n');

    // Step 2: Append all data rows
    scriptLogger.info({ rowCount: INFO_VIAJES_DATA.length }, 'Appending Info_Viajes data');
    console.log(`📝 Paso 2: Agregando ${INFO_VIAJES_DATA.length} filas de información...\n`);

    // Convert objects to arrays matching header order
    const rows = INFO_VIAJES_DATA.map(item => [
      item.viaje_codigo,
      item.categoria,
      item.titulo,
      item.contenido
    ]);

    await appendRows(SHEET_ID, SHEET_NAME, rows);

    console.log('✅ Todas las filas agregadas correctamente\n');
    console.log('📊 Resumen de información agregada:');
    console.log(`   - Viaje: LON2026 (CEWIN)`);
    console.log(`   - Total de filas: ${INFO_VIAJES_DATA.length}`);
    console.log(`   - Categorías incluidas:`);

    // Count by category
    const categoryCounts = {};
    INFO_VIAJES_DATA.forEach(item => {
      categoryCounts[item.categoria] = (categoryCounts[item.categoria] || 0) + 1;
    });

    Object.entries(categoryCounts).forEach(([cat, count]) => {
      console.log(`     • ${cat}: ${count} entradas`);
    });

    console.log('\n✨ Hoja Info_Viajes poblada exitosamente!\n');
    console.log('🔄 El bot sincronizará esta información automáticamente en los próximos 5 minutos.\n');

    scriptLogger.info('Info_Viajes sheet populated successfully');

  } catch (error) {
    scriptLogger.error({ err: error }, 'Error populating Info_Viajes');
    console.error('\n❌ Error:', error.message);
    console.error('\nDetalles del error:', error);
    process.exit(1);
  }
}

// Run the script
populateInfoViajes();
