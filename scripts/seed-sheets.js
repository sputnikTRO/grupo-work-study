#!/usr/bin/env node

/**
 * Seed Sheets Script
 *
 * Generates JSON with example data for the 8 Google Sheets tabs
 * Jorge can copy/paste this data into his Google Sheet
 *
 * Usage:
 *   node scripts/seed-sheets.js
 *   node scripts/seed-sheets.js --format=json
 *   node scripts/seed-sheets.js --format=csv
 *   node scripts/seed-sheets.js --format=instructions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sheet data template
const SHEETS_DATA = {
  // Hoja 1: Viajes
  Viajes: {
    headers: ['codigo', 'destino', 'fechas_salida', 'precio', 'status', 'descripcion'],
    rows: [
      {
        codigo: 'LON2025-V',
        destino: 'Londres',
        fechas_salida: '15-Jul-2025',
        precio: '65000',
        status: 'activo',
        descripcion: 'Programa English 4 Life - 3 semanas de inmersión en Londres con curso de inglés intensivo',
      },
      {
        codigo: 'LON2025-I',
        destino: 'Londres',
        fechas_salida: '05-Dic-2025',
        precio: '68000',
        status: 'activo',
        descripcion: 'Programa English 4 Life Invierno - 2 semanas en Londres con actividades navideñas',
      },
      {
        codigo: 'NYC2025',
        destino: 'Nueva York',
        fechas_salida: '20-Jun-2025',
        precio: '72000',
        status: 'activo',
        descripcion: 'Programa English Experience NYC - 3 semanas en Nueva York con curso de inglés',
      },
      {
        codigo: 'PAR2024',
        destino: 'París',
        fechas_salida: '10-Ago-2024',
        precio: '60000',
        status: 'finalizado',
        descripcion: 'Programa French Immersion - Ya finalizó',
      },
    ],
  },

  // Hoja 2: Colegios
  Colegios: {
    headers: ['codigo', 'nombre', 'zona', 'contacto'],
    rows: [
      {
        codigo: 'WC',
        nombre: 'Winston Churchill',
        zona: 'CDMX - Polanco',
        contacto: 'Dir. María López',
      },
      {
        codigo: 'CA',
        nombre: 'Colegio Americano',
        zona: 'Monterrey',
        contacto: 'Dir. Juan Pérez',
      },
      {
        codigo: 'CB',
        nombre: 'Colegio Británico',
        zona: 'Guadalajara',
        contacto: 'Dir. Ana Martínez',
      },
      {
        codigo: 'CF',
        nombre: 'Colegio Francés',
        zona: 'CDMX - Coyoacán',
        contacto: 'Dir. Pierre Dubois',
      },
      {
        codigo: 'LM',
        nombre: 'Liceo Mexicano',
        zona: 'CDMX - Interlomas',
        contacto: 'Dir. Carlos Ramírez',
      },
      {
        codigo: 'IA',
        nombre: 'Instituto Aleman',
        zona: 'CDMX - Lomas',
        contacto: 'Dir. Hans Schmidt',
      },
    ],
  },

  // Hoja 3: Materiales
  Materiales: {
    headers: ['id', 'nombre', 'tipo', 'url', 'contenido', 'descripcion'],
    rows: [
      {
        id: 'BROCHURE_LON',
        nombre: 'Brochure Londres 2025',
        tipo: 'pdf',
        url: 'https://drive.google.com/file/d/XXXXX/view',
        contenido: '',
        descripcion: 'Información completa del programa English 4 Life en Londres',
      },
      {
        id: 'BROCHURE_NYC',
        nombre: 'Brochure Nueva York 2025',
        tipo: 'pdf',
        url: 'https://drive.google.com/file/d/YYYYY/view',
        contenido: '',
        descripcion: 'Información completa del programa English Experience NYC',
      },
      {
        id: 'PRECIOS_WC',
        nombre: 'Lista de Precios Winston Churchill',
        tipo: 'pdf',
        url: 'https://drive.google.com/file/d/ZZZZZ/view',
        contenido: '',
        descripcion: 'Precios especiales y esquemas de pago para Winston Churchill',
      },
      {
        id: 'PRECIOS_GENERAL',
        nombre: 'Lista de Precios General',
        tipo: 'pdf',
        url: 'https://drive.google.com/file/d/AAAAA/view',
        contenido: '',
        descripcion: 'Lista de precios para todos los colegios',
      },
      {
        id: 'TRAMITES_UK',
        nombre: 'Guía de Trámites UK',
        tipo: 'pdf',
        url: 'https://drive.google.com/file/d/BBBBB/view',
        contenido: '',
        descripcion: 'Guía completa para tramitar ETA británica y documentos necesarios',
      },
      {
        id: 'TESTIMONIO_VIDEO',
        nombre: 'Testimonio Padres 2024',
        tipo: 'link',
        url: 'https://youtube.com/watch?v=CCCCC',
        contenido: '',
        descripcion: 'Video con testimonios de padres y estudiantes del programa 2024',
      },
      {
        id: 'ITINERARIO_LON',
        nombre: 'Itinerario Detallado Londres',
        tipo: 'pdf',
        url: 'https://drive.google.com/file/d/DDDDD/view',
        contenido: '',
        descripcion: 'Itinerario día por día del programa en Londres',
      },
      {
        id: 'FORM_INSCRIPCION',
        nombre: 'Formulario de Inscripción',
        tipo: 'link',
        url: 'https://forms.google.com/EEEEE',
        contenido: '',
        descripcion: 'Formulario online para iniciar proceso de inscripción',
      },
    ],
  },

  // Hoja 4: Esquemas_Pago
  Esquemas_Pago: {
    headers: ['viaje_codigo', 'modalidad', 'detalles', 'monto_inicial'],
    rows: [
      {
        viaje_codigo: 'LON2025-V',
        modalidad: 'Contado',
        detalles: 'Pago único con 5% de descuento. Total: $61,750',
        monto_inicial: '61750',
      },
      {
        viaje_codigo: 'LON2025-V',
        modalidad: 'Mensualidades sin intereses',
        detalles: '10 pagos mensuales de $6,500. Apartado: $10,000',
        monto_inicial: '10000',
      },
      {
        viaje_codigo: 'LON2025-V',
        modalidad: 'Mensualidades con financiamiento',
        detalles: '12 pagos mensuales de $5,800. Apartado: $5,000. Incluye 8% de interés',
        monto_inicial: '5000',
      },
      {
        viaje_codigo: 'LON2025-I',
        modalidad: 'Contado',
        detalles: 'Pago único con 5% de descuento. Total: $64,600',
        monto_inicial: '64600',
      },
      {
        viaje_codigo: 'LON2025-I',
        modalidad: 'Mensualidades sin intereses',
        detalles: '8 pagos mensuales de $8,500. Apartado: $12,000',
        monto_inicial: '12000',
      },
      {
        viaje_codigo: 'NYC2025',
        modalidad: 'Contado',
        detalles: 'Pago único con 5% de descuento. Total: $68,400',
        monto_inicial: '68400',
      },
      {
        viaje_codigo: 'NYC2025',
        modalidad: 'Mensualidades sin intereses',
        detalles: '10 pagos mensuales de $7,200. Apartado: $15,000',
        monto_inicial: '15000',
      },
    ],
  },

  // Hoja 5: Actividades
  Actividades: {
    headers: ['viaje_codigo', 'nombre', 'costo', 'descripcion', 'incluido'],
    rows: [
      {
        viaje_codigo: 'LON2025-V',
        nombre: 'Tour Harry Potter Studios',
        costo: '2500',
        descripcion: 'Visita guiada a los estudios de Warner Bros donde se filmó Harry Potter',
        incluido: 'no',
      },
      {
        viaje_codigo: 'LON2025-V',
        nombre: 'London Eye',
        costo: '800',
        descripcion: 'Vuelta en la noria gigante con vista panorámica de Londres',
        incluido: 'no',
      },
      {
        viaje_codigo: 'LON2025-V',
        nombre: 'Excursión a París',
        costo: '5500',
        descripcion: 'Fin de semana en París: Eurotúnel, Torre Eiffel, Louvre (2 noches)',
        incluido: 'no',
      },
      {
        viaje_codigo: 'LON2025-V',
        nombre: 'Musical West End',
        costo: '1800',
        descripcion: 'Entrada a musical en el West End (varios disponibles)',
        incluido: 'no',
      },
      {
        viaje_codigo: 'LON2025-V',
        nombre: 'Tour Buckingham Palace',
        costo: '0',
        descripcion: 'Cambio de guardia y tour exterior del palacio',
        incluido: 'sí',
      },
      {
        viaje_codigo: 'LON2025-V',
        nombre: 'British Museum',
        costo: '0',
        descripcion: 'Visita guiada al museo británico',
        incluido: 'sí',
      },
      {
        viaje_codigo: 'NYC2025',
        nombre: 'Estatua de la Libertad',
        costo: '1200',
        descripcion: 'Ferry y entrada a la Estatua de la Libertad + Ellis Island',
        incluido: 'no',
      },
      {
        viaje_codigo: 'NYC2025',
        nombre: 'Broadway Show',
        costo: '2500',
        descripcion: 'Entrada a show de Broadway (varios disponibles)',
        incluido: 'no',
      },
    ],
  },

  // Hoja 6: Asesores
  Asesores: {
    headers: ['colegio_codigo', 'nombre', 'whatsapp', 'email'],
    rows: [
      {
        colegio_codigo: 'WC',
        nombre: 'Ana García',
        whatsapp: '+5215544332211',
        email: 'ana.garcia@grupoworkstudy.com',
      },
      {
        colegio_codigo: 'CA',
        nombre: 'Laura Mendoza',
        whatsapp: '+5218112345678',
        email: 'laura.mendoza@grupoworkstudy.com',
      },
      {
        colegio_codigo: 'CB',
        nombre: 'Gabriela Ruiz',
        whatsapp: '+5213312345678',
        email: 'gabriela.ruiz@grupoworkstudy.com',
      },
      {
        colegio_codigo: 'CF',
        nombre: 'Ana García',
        whatsapp: '+5215544332211',
        email: 'ana.garcia@grupoworkstudy.com',
      },
      {
        colegio_codigo: 'LM',
        nombre: 'Ana García',
        whatsapp: '+5215544332211',
        email: 'ana.garcia@grupoworkstudy.com',
      },
      {
        colegio_codigo: 'IA',
        nombre: 'Laura Mendoza',
        whatsapp: '+5218112345678',
        email: 'laura.mendoza@grupoworkstudy.com',
      },
    ],
  },

  // Hoja 7: FAQ
  FAQ: {
    headers: ['pregunta', 'respuesta', 'categoria'],
    rows: [
      {
        pregunta: '¿Qué incluye el programa?',
        respuesta: 'El programa incluye: vuelo redondo México-destino, hospedaje en familia anfitriona o residencia, curso de inglés de 40 horas, materiales didácticos, seguro médico internacional, acompañamiento de coordinador mexicano, tours y actividades incluidas, transporte local, y certificado de participación.',
        categoria: 'general',
      },
      {
        pregunta: '¿Mi hijo/a viaja solo?',
        respuesta: 'No, viajan en grupo con otros estudiantes mexicanos del mismo rango de edad. Además, son acompañados por un coordinador mexicano durante todo el viaje que está disponible 24/7.',
        categoria: 'general',
      },
      {
        pregunta: '¿Necesito pasaporte?',
        respuesta: 'Sí, es indispensable contar con pasaporte vigente con mínimo 6 meses de validez a partir de la fecha de viaje. Para Reino Unido también se requiere tramitar la ETA (autorización electrónica). Nosotros asesoramos en todos los trámites.',
        categoria: 'tramites',
      },
      {
        pregunta: '¿Qué es la ETA y cómo se tramita?',
        respuesta: 'La ETA es una autorización electrónica de viaje que Reino Unido requiere desde 2024. Se tramita online, cuesta aproximadamente £10 libras, y se obtiene en 2-3 días. Nosotros enviamos guía paso a paso y asesoramos en el proceso.',
        categoria: 'tramites',
      },
      {
        pregunta: '¿Necesito visa para Reino Unido?',
        respuesta: 'Los ciudadanos mexicanos NO necesitan visa para estancias turísticas menores a 6 meses en Reino Unido, solo la ETA (autorización electrónica). Para Estados Unidos sí se requiere visa de turista.',
        categoria: 'tramites',
      },
      {
        pregunta: '¿Cuándo debo inscribirme?',
        respuesta: 'Te recomendamos inscribirte con 3-4 meses de anticipación mínimo. Los lugares son limitados (máximo 25 estudiantes por grupo) y se llenan rápido. Entre más anticipación, mejores opciones de pago tienes.',
        categoria: 'inscripcion',
      },
      {
        pregunta: '¿Puedo pagar en mensualidades?',
        respuesta: 'Sí, manejamos esquemas de mensualidades sin intereses (10 pagos) o con financiamiento (12 pagos con 8% de interés). También hay descuento por pago de contado (5% de descuento).',
        categoria: 'pago',
      },
      {
        pregunta: '¿Cuánto es el apartado?',
        respuesta: 'El apartado varía según el destino y modalidad de pago, pero generalmente es entre $5,000 y $15,000 MXN. Este monto se aplica al costo total del programa y asegura tu lugar en el grupo.',
        categoria: 'pago',
      },
      {
        pregunta: '¿Qué pasa si cancelo?',
        respuesta: 'Tenemos políticas de cancelación escalonadas según la fecha. Hasta 60 días antes: reembolso del 80%. De 60 a 30 días: reembolso del 50%. Menos de 30 días: no hay reembolso. El apartado nunca es reembolsable. Recomendamos contratar seguro de cancelación.',
        categoria: 'general',
      },
      {
        pregunta: '¿Dónde se hospedan?',
        respuesta: 'Depende del programa. En Londres generalmente es con familias anfitrionas británicas (2 estudiantes por familia). En NYC puede ser residencia estudiantil. Todas las opciones son previamente verificadas y seguras.',
        categoria: 'hospedaje',
      },
      {
        pregunta: '¿Mi hijo tiene celular/internet?',
        respuesta: 'Sí, recomendamos chip internacional o eSIM para tener datos. El hospedaje incluye WiFi. Los estudiantes pueden comunicarse con sus familias vía WhatsApp diariamente. El coordinador también mantiene grupo de WhatsApp con padres.',
        categoria: 'general',
      },
      {
        pregunta: '¿Qué edad es la adecuada?',
        respuesta: 'Nuestros programas están diseñados para jóvenes de 13 a 17 años. Formamos grupos por rangos de edad similares para mejor dinámica. Si tu hijo/a está fuera de este rango, consúltanos para opciones personalizadas.',
        categoria: 'general',
      },
    ],
  },

  // Hoja 8: Configuración
  Configuración: {
    headers: ['clave', 'valor'],
    rows: [
      {
        clave: 'handoff_score_threshold',
        valor: '7',
      },
      {
        clave: 'bot_nombre',
        valor: 'Asistente Virtual',
      },
      {
        clave: 'mensaje_bienvenida',
        valor: '¡Buen día! Soy el asistente virtual de English 4 Life. 🌍✈️',
      },
      {
        clave: 'horario_atencion',
        valor: 'Lun-Vie 9am-6pm, Sáb 10am-2pm',
      },
      {
        clave: 'telefono_contacto',
        valor: '+52 55 1234 5678',
      },
      {
        clave: 'email_contacto',
        valor: 'info@grupoworkstudy.com',
      },
    ],
  },
};

/**
 * Format as JSON
 */
function formatAsJSON() {
  return JSON.stringify(SHEETS_DATA, null, 2);
}

/**
 * Format as CSV for each sheet
 */
function formatAsCSV() {
  const output = [];

  for (const [sheetName, sheetData] of Object.entries(SHEETS_DATA)) {
    output.push(`\n${'='.repeat(60)}`);
    output.push(`SHEET: ${sheetName}`);
    output.push('='.repeat(60) + '\n');

    // Headers
    output.push(sheetData.headers.join(','));

    // Rows
    for (const row of sheetData.rows) {
      const values = sheetData.headers.map(header => {
        const value = row[header] || '';
        // Escape commas and quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      output.push(values.join(','));
    }

    output.push('');
  }

  return output.join('\n');
}

/**
 * Format as instructions
 */
function formatAsInstructions() {
  const output = [];

  output.push('');
  output.push('='.repeat(80));
  output.push('  INSTRUCCIONES PARA CONFIGURAR GOOGLE SHEETS');
  output.push('='.repeat(80));
  output.push('');
  output.push('1. Crea una nueva hoja de cálculo en Google Sheets');
  output.push('');
  output.push('2. Crea 8 pestañas (tabs) con estos nombres EXACTOS:');
  output.push('   - Viajes');
  output.push('   - Colegios');
  output.push('   - Materiales');
  output.push('   - Esquemas_Pago');
  output.push('   - Actividades');
  output.push('   - Asesores');
  output.push('   - FAQ');
  output.push('   - Configuración');
  output.push('');
  output.push('3. Para cada pestaña, copia y pega los datos siguientes:');
  output.push('');

  for (const [sheetName, sheetData] of Object.entries(SHEETS_DATA)) {
    output.push('');
    output.push('-'.repeat(80));
    output.push(`PESTAÑA: ${sheetName}`);
    output.push('-'.repeat(80));
    output.push('');
    output.push('FILA 1 (Headers):');
    output.push(sheetData.headers.join('\t'));
    output.push('');
    output.push(`FILAS 2-${sheetData.rows.length + 1} (Data):`);

    for (const row of sheetData.rows) {
      const values = sheetData.headers.map(header => row[header] || '');
      output.push(values.join('\t'));
    }

    output.push('');
    output.push(`Total de filas en ${sheetName}: ${sheetData.rows.length + 1} (incluyendo header)`);
    output.push('');
  }

  output.push('');
  output.push('='.repeat(80));
  output.push('NOTAS IMPORTANTES:');
  output.push('='.repeat(80));
  output.push('');
  output.push('- Los nombres de las pestañas deben ser EXACTOS (mayúsculas/minúsculas)');
  output.push('- Los headers (primera fila) deben estar en lowercase con underscores');
  output.push('- No agregues columnas extra al inicio, pero sí puedes agregar al final');
  output.push('- El campo "status" en Viajes debe ser "activo" para que aparezca en el bot');
  output.push('- Los códigos (codigo, viaje_codigo, colegio_codigo) son case-sensitive');
  output.push('- Las URLs en Materiales deben ser links compartidos públicamente de Google Drive');
  output.push('- Para PDFs en Drive: Botón derecho > Obtener enlace > Cualquiera con el enlace');
  output.push('');
  output.push('4. Comparte la hoja con el service account de Google:');
  output.push('   - Botón "Compartir" arriba a la derecha');
  output.push('   - Agregar el email del service account (termina en @iam.gserviceaccount.com)');
  output.push('   - Permiso: "Editor"');
  output.push('');
  output.push('5. Copia el ID de la hoja de cálculo:');
  output.push('   - Está en la URL: https://docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/edit');
  output.push('   - Pégalo en el .env como GOOGLE_SHEETS_ID');
  output.push('');

  return output.join('\n');
}

/**
 * Save to files
 */
function saveToFiles() {
  const outputDir = path.join(__dirname, '..', 'docs', 'sheets-seed-data');

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save JSON
  fs.writeFileSync(
    path.join(outputDir, 'sheets-data.json'),
    formatAsJSON(),
    'utf-8'
  );

  // Save CSV
  fs.writeFileSync(
    path.join(outputDir, 'sheets-data.csv'),
    formatAsCSV(),
    'utf-8'
  );

  // Save instructions
  fs.writeFileSync(
    path.join(outputDir, 'SETUP_INSTRUCTIONS.txt'),
    formatAsInstructions(),
    'utf-8'
  );

  console.log('\n✅ Files saved to:', outputDir);
  console.log('   - sheets-data.json');
  console.log('   - sheets-data.csv');
  console.log('   - SETUP_INSTRUCTIONS.txt\n');
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'instructions';

  if (format === 'json') {
    console.log(formatAsJSON());
  } else if (format === 'csv') {
    console.log(formatAsCSV());
  } else if (format === 'instructions') {
    console.log(formatAsInstructions());
  } else if (format === 'save') {
    saveToFiles();
  } else {
    console.error('Invalid format. Use: json, csv, instructions, or save');
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { SHEETS_DATA, formatAsJSON, formatAsCSV, formatAsInstructions };
