/**
 * PASO 3: Actualizar Info General con Correcciones 2027
 *
 * Correcciones principales:
 * 1. Clarificar $10,000 (mínimo para reservar) vs $15,000 (apartado esquema de pagos)
 * 2. Actualizar precios de vuelo a ~$35,000-$37,000 MXN
 * 3. Corregir retención de cancelación a $7,500 (no $2,000)
 * 4. Actualizar códigos LON2026 → LON2027, DUB2027
 * 5. Actualizar fechas 2026 → 2027
 */

import { updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function fixInfoGeneral2027() {
  try {
    console.log('🔧 Actualizando Info General con correcciones 2027...\n');
    console.log('─'.repeat(80));

    // ESTRUCTURA: Código Viaje | Categoría | Título | Contenido | Orden
    const infoGeneralData = [
      // Header
      ['Código Viaje', 'Categoría', 'Título', 'Contenido', 'Orden'],

      // ===== FAQs GENERALES (TODOS) =====

      ['TODOS', 'FAQ', '¿De qué trata el programa English 4 Life?',
       'English 4 Life es un programa inmersivo de inglés que combina un viaje educativo a Londres o Dublín con actividades y retos diseñados para practicar el idioma en situaciones reales.', '1'],

      ['TODOS', 'FAQ', '¿Cuál es el objetivo del programa?',
       'El objetivo es que los estudiantes mejoren su inglés mientras viven experiencias culturales reales, ganan confianza al comunicarse y desarrollar habilidades para la vida, no solo para el salón de clases.', '2'],

      ['TODOS', 'FAQ', '¿A qué países se viaja con English 4 Life?',
       'El programa 2027 se realiza en dos destinos principales: Londres, en Inglaterra, y Dublín, en Irlanda.', '3'],

      ['TODOS', 'FAQ', '¿Cuánto dura el viaje?',
       'El viaje tiene una duración de 9 días y 8 noches, 10 días totales de viaje del 21 al 30 de Mayo 2027.', '4'],

      // CORREGIDO: Clarificar $10K vs $15K
      ['TODOS', 'FAQ', '¿Cuánto cuesta el programa?',
       'El programa académico English 4 Life cuesta $34,990 pesos mexicanos. El vuelo se cotiza por separado y tiene un costo aproximado de $35,000 pesos, haciendo un total de $69,990 pesos. Puedes reservar tu lugar con un mínimo de $10,000 pesos. El esquema de pagos vigente (abril-junio 2026) contempla un apartado de $15,000 pesos. ¿Te gustaría que una asesora te prepare el plan de pagos detallado?', '5'],

      ['TODOS', 'FAQ', '¿Mi hijo puede viajar solo aunque sus compañeros de colegio no lo hagan?',
       'Sí, es posible, se integraría al grupo de edad que se forme para el viaje, con Staff nuestro como responsable.', '6'],

      ['TODOS', 'FAQ', '¿El viaje es seguro para los estudiantes?',
       'Sí, el programa está acompañado por Staff responsable 24/7 y un profesor de su Colegio. Los estudiantes viajan en grupo, con supervisión y actividades planificadas.', '7'],

      ['TODOS', 'FAQ', '¿Cuál es la edad mínima y máxima para participar?',
       'El programa está diseñado para alumnos de 13 años en adelante. Hay subdivisiones por edades y nivel de idioma, se definen al momento de armar los grupos.', '8'],

      ['TODOS', 'FAQ', '¿Se necesita nivel avanzado de inglés?',
       'No es necesario tener un nivel avanzado de inglés; el programa está diseñado para que los estudiantes practiquen y mejoren su fluidez y la confianza al hablarlo. Para la parte académica se hacen grupos de acuerdo a su nivel de manejo del idioma.', '9'],

      // ===== TRÁMITES =====

      ['TODOS', 'Trámites', '¿Se necesita visa para viajar?',
       'No es necesario tramitar visa. Para Londres se requiere tramitar la ETA (Electronic Travel Authorisation) con anticipación. Para Dublín no se requiere ningún trámite de ingreso. Otras nacionalidades diferentes a la mexicana se deben validar en la página de la embajada de cada país.', '10'],

      ['TODOS', 'Trámites', '¿Qué vigencia mínima debe tener el pasaporte?',
       'Por ley todos los pasaportes deben tener una vigencia mínima de 6 meses posteriores a la fecha de regreso del viaje. Para English 4 Life Mayo 2027, el pasaporte debe tener vigencia mínima de noviembre de 2027 en adelante.', '11'],

      ['TODOS', 'Trámites', '¿Cómo funciona la ETA?',
       'El costo de la ETA es de 16 libras. Debe solicitarse en https://www.gov.uk/eta. Una vez cerrado el grupo, se acompaña en el proceso para completar correctamente los trámites. Solo se requiere para Londres, NO para Dublín.', '12'],

      // ===== HOSPEDAJE =====

      ['TODOS', 'Hospedaje', '¿Cómo es el hospedaje?',
       'El hospedaje es en casas de familia anfitriona (homestay), previamente evaluadas y autorizadas. 2 estudiantes por habitación en camas individuales. Hasta 4 estudiantes en una misma casa, regularmente del mismo colegio. No se mezclan géneros en la asignación. Las casas se ubican en zonas residenciales seguras.', '13'],

      ['TODOS', 'Hospedaje', '¿A qué se refiere con que el hospedaje es en familia anfitriona y con quién se comparte habitación?',
       'El hospedaje es en casas de familia anfitriona (homestay), previamente evaluadas y autorizadas bajo lineamientos oficiales del país. Estas familias cumplen estándares de seguridad, comodidad e instalaciones adecuadas para recibir estudiantes internacionales. Las casas se ubican en zonas residenciales seguras, con acceso a transporte público y dentro de rutas previamente definidas para el programa. La asignación contempla: 2 estudiantes por habitación en camas individuales, hasta 4 estudiantes en una misma casa (regularmente del mismo colegio), no se mezclan géneros en la asignación.', '14'],

      // ===== PAGOS =====

      // CORREGIDO: Clarificar $10K mínimo vs $15K apartado
      ['TODOS', 'Pagos', '¿Cómo inscribo a mi hijo y cuánto es el pago inicial?',
       'Puedes reservar el lugar de tu hijo con un pago mínimo de $10,000 MXN. El esquema de pagos vigente (abril-junio 2026) contempla un apartado de $15,000 MXN. Una asesora te contactará para preparar tu plan de pagos personalizado.', '15'],

      // CORREGIDO: Retención correcta $7,500
      ['TODOS', 'Pagos', '¿Se puede cancelar después del apartado?',
       'Contamos con un seguro de cancelación de $1,500 MXN. Si la cancelación es 90 días antes del viaje, se regresa el 100% del monto pagado. Si se cancela 60 días antes, se reembolsa el 50%. Y una cancelación 30 días antes permite el reembolso del 30%. En todos los casos se retiene $7,500 pesos por concepto de inscripción.', '16'],

      // CORREGIDO: Precio específico del vuelo
      ['TODOS', 'Pagos', '¿Cuánto cuesta el vuelo?',
       'El vuelo internacional redondo sale desde la Ciudad de México y tiene un costo aproximado de $35,000 a $37,000 pesos mexicanos. El precio exacto se confirma al momento de cerrar los primeros grupos, y se ofrece un plan de pagos flexible a meses sin intereses.', '17'],

      ['TODOS', 'Pagos', '¿Qué pasa si no se forma el grupo?',
       'En caso de que el grupo no se forme, se reembolsa todo el monto pagado, incluida la inscripción. O bien las familias pueden decidir que los estudiantes viajen prorrateando el costo del profesor entre ellos.', '18'],

      // ===== SEGUROS =====

      ['TODOS', 'Seguros', '¿Qué cubre el seguro de gastos médicos?',
       'El programa incluye un seguro de gastos médicos mayores con cobertura amplia en Reino Unido e Irlanda. Cubre atención médica por enfermedad o accidente durante la estancia, incluyendo consultas, hospitalización, estudios y tratamientos. No requiere deducible ni coaseguro por parte de la familia. En caso de requerir atención médica, el staff acompaña al estudiante y activa el seguro conforme al protocolo establecido.', '19'],

      // ===== GENERAL =====

      ['TODOS', 'General', '¿Cuánto deben considerar para gastos adicionales?',
       'El programa incluye desayuno y cena. Para el almuerzo, se recomienda considerar un promedio de £20 por día. En cuanto a souvenirs o compras personales, el monto es a criterio de cada familia.', '20'],

      ['TODOS', 'General', '¿Este viaje aporta algo para su futuro académico?',
       'Sí. English 4 Life es una experiencia académica internacional que fortalece el perfil del estudiante. Además de la mejora en el idioma, reciben un diploma de participación con valor curricular y desarrollan habilidades como autonomía, adaptación cultural y comunicación intercultural, competencias valoradas en procesos universitarios.', '21'],

      ['TODOS', 'General', '¿El pago incluye la entrada a todas las actividades del itinerario?',
       'Así es, el pago contempla todas las actividades incluidas en el itinerario base. Sin embargo, contamos con un paquete de actividades adicionales que pueden adquirirse una vez que tenemos formados los grupos de viaje.', '22'],

      ['TODOS', 'General', '¿Qué actividades diarias hay para practicar inglés?',
       'El programa combina actividades formales de inglés con actividades prácticas diseñadas para fomentar el uso constante del idioma. Los estudiantes participan en dinámicas, retos culturales, actividades guiadas y proyectos donde deben usar el inglés en situaciones reales. El objetivo es practicar el idioma todos los días en contextos auténticos.', '23'],

      ['TODOS', 'General', '¿Los estudiantes cuentan con supervisión durante el viaje?',
       'Los estudiantes cuentan con acompañamiento permanente del staff y del profesor del colegio. Todas las actividades se desarrollan bajo un itinerario organizado y con supervisión continua, priorizando en todo momento la seguridad y el bienestar del grupo. En caso de cualquier situación extraordinaria, el equipo actúa conforme a los protocolos establecidos para garantizar el bienestar del grupo.', '24'],

      ['TODOS', 'General', '¿Cuál es el protocolo en caso de una emergencia?',
       'Contamos con protocolos para situaciones médicas, operativas o extraordinarias y de fuerza mayor. El staff actúa de inmediato según el tipo de caso, activa el seguro cuando es necesario y mantiene comunicación constante con las familias. Siempre priorizamos la seguridad y seguimos las indicaciones de las autoridades locales en caso de situaciones mayores.', '25'],

      ['TODOS', 'General', '¿Cómo se maneja la comunicación con padres?',
       'La comunicación con padres se realiza mediante un grupo oficial de WhatsApp administrado por el Group Leader y el staff. Se comparten actualizaciones generales y, de ser necesario, se contacta a las familias de forma privada. Los estudiantes pueden comunicarse con sus padres en horarios establecidos, considerando actividades y diferencia de horario.', '26'],

      ['TODOS', 'General', '¿Desde qué aeropuerto sale el vuelo y quién acompaña a los estudiantes?',
       'Todos los vuelos salen desde el Aeropuerto Internacional de la Ciudad de México, Benito Juárez. En todo momento contarán con staff de acompañamiento al grupo, desde el proceso de check-in y vuelo hasta llegar al destino.', '27'],

      // ===== TRÁMITES ESPECÍFICOS (LON2027) =====

      // ACTUALIZADO: LON2026 → LON2027
      ['LON2027', 'Trámites', 'ETA (Electronic Travel Authorization)',
       'Descargar app UK ETA del App Store o Google Play. Se requiere foto del pasaporte (vigencia 6 meses post-viaje), escaneo de rostro del menor, contestar preguntas. Pago con Visa o Mastercard. Precio: 16 libras. Vigencia: 2 años. Realizarlo con 1 mes de anticipación.', '28'],

      ['LON2027', 'Trámites', 'Formato SAM (Salida de Menores)',
       'Autorización para que menores salgan de México. Indispensable, sin él NO puede viajar. Vigencia 6 meses. Costo $294 MXN pagado en línea. Requiere: pasaporte original del menor, ID del padre/tutor, acta de nacimiento, comprobante de pago (original y 3 copias). Debe ser sellada por Agente Federal de Migración del INM. El menor y profesor acompañante deben estar presentes. Tramitar con 30 días de anticipación en aeropuerto. Página: https://www.inm.gob.mx/spublic/portal/inmex.html', '29'],

      ['LON2027', 'Trámites', '¿Qué trámites migratorios requiere el estudiante para salir del país?',
       'El estudiante deberá contar con: Pasaporte vigente, con una validez mínima de 6 meses posteriores a la fecha de término del viaje. Para viajar a Reino Unido, los estudiantes con nacionalidad mexicana deberán tramitar una ETA (Electronic Travel Authorisation) previa al viaje. En el caso de menores de edad que viajen sin ambos padres, se requerirá el Formato SAM (Salida de Menores) conforme a la normativa mexicana vigente.', '30'],

      // ===== INFO LONDRES 2027 =====

      ['LON2027', 'Clima', 'Clima en Londres - Mayo',
       'Templado y variable, días frescos a ligeramente cálidos con posibles lluvias intermitentes. Temperaturas aprox 10-18°C, mezcla de nubes y ratos de sol.', '31'],

      ['LON2027', 'Equipaje', 'Lista de equipaje recomendada',
       'NECESER: desodorante, cepillo y pasta dental, shampoo, acondicionador, jabón, cremas, bloqueador, cepillo de cabello. ROPA: 1-2 sudaderas, 9-10 playeras, 1 chamarra impermeable, 4-6 pantalones, 10-13 pares calcetines, 10-13 mudas ropa interior, pijama abrigadora, chanclas de baño, 1-2 calza. IMPORTANTE: móvil (opcional), laptop/tablet, cargadores, batería externa, adaptadores UK, tarjeta Visa/Mastercard, auriculares. COMPLEMENTOS: paraguas, cojín para cuello, botiquín, botella de agua rellenable. NO LLEVAR: plancha de cabello, secadora, plancha de ropa. BACKPACK: cargador, dispositivos, adaptador, batería. CARRY ON: cambio de ropa, snacks.', '32'],

      ['LON2027', 'Equipaje', 'Botiquín recomendado',
       'Paracetamol, Ibuprofeno, Buscapina, Graneodin B, Antigripal, Dramamine, Pepto Bismol, Melox Plus. Si el medicamento es de venta controlada, llevar medicamento y receta médica.', '33'],

      ['LON2027', 'Equipaje', '¿Qué debe llevar en la maleta y cuáles son las restricciones?',
       '1 maleta de 23kg + equipaje de mano de 10kg. Ver lista de equipaje recomendada para detalles completos.', '34'],

      ['LON2027', 'Conectividad', 'Opciones de conectividad en Londres',
       'Opción 1: SIM local (EE, Vodafone, Three, O2) con planes prepago. Opción 2: eSIM internacional antes de viajar (Airalo, Holafly, TravSIM). Opción 3: Roaming con Telcel, AT&T o Movistar (más costoso). Tips: asegurar que el celular esté desbloqueado, usar WhatsApp para llamadas con datos o WiFi.', '35'],

      ['LON2027', 'Finanzas', 'Información financiera recomendada',
       'Llevar tarjetas de crédito o débito desbloqueadas para compras. Opcional llevar aprox 50 libras esterlinas en efectivo.', '36'],

      // ===== INFO DUBLÍN 2027 =====

      ['DUB2027', 'Trámites', 'Formato SAM (Salida de Menores)',
       'Autorización para que menores salgan de México. Indispensable, sin él NO puede viajar. Vigencia 6 meses. Costo $294 MXN pagado en línea. Requiere: pasaporte original del menor, ID del padre/tutor, acta de nacimiento, comprobante de pago (original y 3 copias). Debe ser sellada por Agente Federal de Migración del INM. El menor y profesor acompañante deben estar presentes. Tramitar con 30 días de anticipación en aeropuerto. Página: https://www.inm.gob.mx/spublic/portal/inmex.html', '37'],

      ['DUB2027', 'Trámites', '¿Qué trámites migratorios requiere el estudiante para viajar a Dublín?',
       'El estudiante deberá contar con: Pasaporte vigente, con una validez mínima de 6 meses posteriores a la fecha de término del viaje. Para viajar a Irlanda (Dublín), los estudiantes mexicanos no requieren visa para estancias cortas. En el caso de menores de edad que viajen sin ambos padres, se requerirá el Formato SAM (Salida de Menores) conforme a la normativa mexicana vigente.', '38'],

      ['DUB2027', 'Clima', 'Clima en Dublín - Mayo',
       'Templado y húmedo, días frescos con posibles lluvias frecuentes. Temperaturas aprox 8-15°C. Se recomienda llevar ropa impermeable y capas para adaptarse al clima variable.', '39'],

      ['DUB2027', 'Equipaje', 'Lista de equipaje recomendada',
       'NECESER: desodorante, cepillo y pasta dental, shampoo, acondicionador, jabón, cremas, bloqueador, cepillo de cabello. ROPA: 1-2 sudaderas, 9-10 playeras, 1 chamarra impermeable, 4-6 pantalones, 10-13 pares calcetines, 10-13 mudas ropa interior, pijama abrigadora, chanclas de baño, 1-2 calza. IMPORTANTE: móvil (opcional), laptop/tablet, cargadores, batería externa, adaptadores UK/Irlandeses, tarjeta Visa/Mastercard, auriculares. COMPLEMENTOS: paraguas, cojín para cuello, botiquín, botella de agua rellenable. NO LLEVAR: plancha de cabello, secadora, plancha de ropa. BACKPACK: cargador, dispositivos, adaptador, batería. CARRY ON: cambio de ropa, snacks.', '40'],

      ['DUB2027', 'Conectividad', 'Opciones de conectividad en Dublín',
       'Opción 1: SIM local (Three, Vodafone, Eir) con planes prepago. Opción 2: eSIM internacional antes de viajar (Airalo, Holafly, TravSIM). Opción 3: Roaming con Telcel, AT&T o Movistar (más costoso). Tips: asegurar que el celular esté desbloqueado, usar WhatsApp para llamadas con datos o WiFi.', '41'],

      ['DUB2027', 'Finanzas', 'Información financiera recomendada',
       'Llevar tarjetas de crédito o débito desbloqueadas para compras. Opcional llevar aprox 50 euros en efectivo.', '42'],
    ];

    await updateRange(SPREADSHEET_ID, 'Info General!A1:E43', infoGeneralData);

    console.log('✅ Info General ACTUALIZADA con correcciones 2027!\n');
    console.log('📋 Correcciones aplicadas:');
    console.log('  ✓ Orden 5: Clarificado $10K (mínimo reservar) vs $15K (apartado esquema)');
    console.log('  ✓ Orden 15: Actualizada info de inscripción con ambos montos');
    console.log('  ✓ Orden 16: Corregida retención a $7,500 (antes $2,000)');
    console.log('  ✓ Orden 17: Precio vuelo específico $35,000-$37,000 MXN');
    console.log('  ✓ Códigos actualizados: LON2026 → LON2027');
    console.log('  ✓ Agregada info específica de DUB2027 (Dublín)');
    console.log('\n📊 Estructura final:');
    console.log('  Total FAQs: 42 registros (sin contar header)');
    console.log('  Distribución:');
    console.log('    • TODOS: 27 FAQs generales');
    console.log('    • LON2027: 9 FAQs específicos Londres');
    console.log('    • DUB2027: 6 FAQs específicos Dublín');
    console.log('\n💡 Notas importantes:');
    console.log('  • $10,000 = mínimo para RESERVAR lugar');
    console.log('  • $15,000 = apartado del ESQUEMA de pagos (abril-junio 2026)');
    console.log('  • $7,500 = retención por inscripción en caso de cancelación');
    console.log('  • Programa: $34,990 + Vuelo: ~$35,000 = Total: ~$69,990 MXN\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixInfoGeneral2027();
