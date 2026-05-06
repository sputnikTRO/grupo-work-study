import { google } from 'googleapis';

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

// FAQs reales de English 4 Life
const FAQS = [
  {
    pregunta: '¿De qué trata el programa English 4 Life?',
    respuesta: 'English 4 Life es un programa inmersivo de inglés que combina un viaje educativo a Londres o Dublín con actividades y retos diseñados para practicar el idioma en situaciones reales.',
    categoria: 'Programa'
  },
  {
    pregunta: '¿Cuál es el objetivo del programa?',
    respuesta: 'El objetivo es que los estudiantes mejoren su inglés mientras viven experiencias culturales reales, ganan confianza al comunicarse y desarrollar habilidades para la vida, no solo para el salón de clases.',
    categoria: 'Programa'
  },
  {
    pregunta: '¿A qué países se viaja con English 4 Life?',
    respuesta: 'El programa 2027 se realiza en dos destinos principales: Londres, en Inglaterra, y Dublín, en Irlanda.',
    categoria: 'Programa'
  },
  {
    pregunta: '¿Cuánto dura el viaje?',
    respuesta: 'El viaje tiene una duración de 9 días y 8 noches, 10 días totales de viaje.',
    categoria: 'Programa'
  },
  {
    pregunta: '¿Cuánto cuesta?',
    respuesta: 'El precio del programa académico es de $29,990 pesos mexicanos y es posible apartar un espacio desde $10,000 pesos. Precio promoción vigente al 30 de marzo 2026.',
    categoria: 'Costos'
  },
  {
    pregunta: '¿Mi hijo puede viajar solo aunque más compañeros de la escuela no lo hagan?',
    respuesta: 'Sí es grupo de edad que se forme para el viaje, con Staff nuestro como responsable.',
    categoria: 'Logística'
  },
  {
    pregunta: '¿El viaje es seguro para los estudiantes?',
    respuesta: 'Sí, el programa está acompañado por Staff responsable 24/7 y un profesor de su Colegio. Los estudiantes viajan en grupo, con supervisión y actividades planificadas.',
    categoria: 'Seguridad'
  },
  {
    pregunta: '¿Cuál es la edad mínima y máxima para participar en English 4 Life?',
    respuesta: 'El programa está diseñado para alumnos de 13 años en adelante. Hay subdivisiones por edades y nivel de idioma, se definen al momento de armar los grupos.',
    categoria: 'Requisitos'
  },
  {
    pregunta: '¿Mi hijo necesita tener un nivel avanzado de inglés para ir?',
    respuesta: 'Para participar en el programa no es necesario tener un nivel avanzado de inglés; el programa está diseñado para que los estudiantes practiquen y mejoren su fluidez y la confianza al hablarlo. Para la parte académica se hacen grupos de acuerdo a su nivel de manejo del idioma.',
    categoria: 'Requisitos'
  },
  {
    pregunta: '¿Se necesita visa para viajar desde México a Londres o Dublín?',
    respuesta: 'No es necesario tramitar visa para este viaje. Sin embargo, los viajeros mexicanos deben tramitar la ETA (Electronic Travel Authorisation) para el Reino Unido (Londres), la cual debe tramitarse con suficiente anticipación. Para Dublín no se requiere ningún trámite para ingreso al País. Otras nacionalidades diferentes a la mexicana se deben validar en la página de la embajada de cada país.',
    categoria: 'Documentación'
  },
  {
    pregunta: '¿Qué vigencia mínima debe tener el pasaporte del estudiante?',
    respuesta: 'Por ley todos los pasaportes deben tener una vigencia mínima de 6 meses posteriores a la fecha de regreso del viaje, para English 4 Life Mayo 2027, el pasaporte debe tener vigencia mínima de noviembre de 2027 en adelante.',
    categoria: 'Documentación'
  },
  {
    pregunta: '¿Cuáles son las fechas exactas de salida y regreso para 2027?',
    respuesta: 'Las fechas se definen al momento de formar los grupos. Aparta tu lugar y asegura los mejores precios.',
    categoria: 'Fechas'
  },
  {
    pregunta: '¿Cómo se agrupan los estudiantes (por edad, escuela, género)?',
    respuesta: 'Los grupos se integran de la siguiente manera: para la parte académica por nivel de idioma; para el hospedaje: por Colegio, edad y género.',
    categoria: 'Logística'
  },
  {
    pregunta: '¿Hay opción de habitación individual por un costo extra?',
    respuesta: 'El programa incluye alojamiento en casa de familia en habitación doble, obligatorio para menores de edad. Si desea habitación individual, se proporciona el costo según la fecha elegida para viajar (solo mayores de edad). En caso de querer la opción de hotel, solicita una asesoría especial.',
    categoria: 'Hospedaje'
  },
  {
    pregunta: '¿El itinerario es fijo o es susceptible a cambios?',
    respuesta: 'El itinerario final se confirma previo a la salida del grupo, es sujeto a cambios, solo en casos extraordinarios como factores climatológicos o extraordinarios, sin embargo todas las actividades están garantizadas.',
    categoria: 'Actividades'
  },
  {
    pregunta: '¿Cómo son los días "libres" en la ciudad, tienen acompañamiento?',
    respuesta: 'Los días en Londres no son "libres" como tal, son días con itinerario estructurado y supervisión constante. Todas las visitas están organizadas y guiadas por nuestro staff, con acompañamiento del profesor del colegio en todo momento. Si hay pequeños espacios de tiempo libre, son limitadas y siempre bajo supervisión. La idea es que vivan la experiencia con autonomía, pero dentro de un entorno seguro y organizado.',
    categoria: 'Actividades'
  },
  {
    pregunta: '¿Este viaje aporta algo relevante para su futuro académico?',
    respuesta: 'Sí. English 4 Life es una experiencia académica internacional que fortalece el perfil del estudiante. Además de la mejora significativa en el idioma, reciben un diploma de participación con valor curricular y desarrollan habilidades clave como autonomía, adaptación cultural, comunicación intercultural y pensamiento global, competencias altamente valoradas en procesos universitarios y profesionales.',
    categoria: 'Beneficios'
  },
  {
    pregunta: '¿Pueden unirse hermanos no del mismo colegio o padres como acompañantes opcionales?',
    respuesta: 'Al ser un viaje para estudiantes, sí es posible inscribir a los hermanos menores o mayores, sin embargo, no es posible admitir a padres de familia u otro familiar, como parte de los grupos.',
    categoria: 'Requisitos'
  },
  {
    pregunta: '¿Cuánto deben considerar para gastos adicionales como almuerzo y souvenirs?',
    respuesta: 'El programa incluye desayuno y cena. Para el almuerzo se recomienda considerar un promedio de £20 por día, dependiendo de lo que el estudiante decida consumir. En cuanto a souvenirs o compras personales, el monto es completamente a criterio de cada familia, ya que dependerá de los hábitos y preferencias individuales.',
    categoria: 'Costos'
  },
  {
    pregunta: '¿Cuánto cuesta el vuelo?',
    respuesta: 'El vuelo internacional redondo se considera saliendo de la Ciudad de México y el costo se proporciona al momento de cerrar los primeros grupos. En este momento se publican las opciones y el plan de pagos flexible a meses sin intereses.',
    categoria: 'Costos'
  },
  {
    pregunta: '¿Se puede cancelar después del apartado y cuánto se pierde del pago realizado?',
    respuesta: 'Contamos con un seguro de cancelación de $1,500 MXN, el cual garantiza el reembolso del monto pagado según las siguientes condiciones: Si la cancelación es 90 días antes del viaje, se regresa el 100% del monto pagado hasta el momento. Si se cancela 60 días antes, se reembolsa el 50%. Y una cancelación 30 días antes solamente permite el reembolso del 30%. En todos los casos se retiene un total de $2,000 MXN por concepto de inscripción.',
    categoria: 'Cancelaciones'
  },
  {
    pregunta: '¿Qué pasa si no se forma el grupo?',
    respuesta: 'En caso de que el grupo no se forme, se reembolsa todo el monto pagado, incluida la inscripción. O bien las familias pueden decidir que los estudiantes viajen prorrateando el costo del profesor entre ellos.',
    categoria: 'Cancelaciones'
  },
  {
    pregunta: '¿Los estudiantes cuentan con supervisión durante el viaje?',
    respuesta: 'Los estudiantes cuentan con acompañamiento permanente del staff y del profesor del colegio. Todas las actividades se desarrollan bajo un itinerario organizado y con supervisión continua, priorizando en todo momento la seguridad y el bienestar del grupo. En caso de cualquier situación extraordinaria, el equipo actúa conforme a los protocolos establecidos para garantizar el bienestar del grupo.',
    categoria: 'Seguridad'
  },
  {
    pregunta: '¿Cuál es el protocolo en caso de una emergencia?',
    respuesta: 'Contamos con protocolos para situaciones médicas, operativas o extraordinarias y de fuerza mayor. El staff actúa de inmediato según el tipo de caso, activa el seguro cuando es necesario y mantiene comunicación constante con las familias. Siempre priorizamos la seguridad y seguimos las indicaciones de las autoridades locales en caso de situaciones mayores.',
    categoria: 'Seguridad'
  },
  {
    pregunta: '¿Qué cubre exactamente el seguro de gastos médicos mayores?',
    respuesta: 'El programa incluye un seguro de gastos médicos mayores con cobertura amplia en Reino Unido e Irlanda. Cubre atención médica por enfermedad o accidente durante la estancia, incluyendo consultas, hospitalización, estudios y tratamientos que sean médicamente necesarios. No requiere deducible ni coaseguro por parte de la familia. En caso de requerir atención médica, el staff acompaña al estudiante y activa el seguro conforme al protocolo establecido.',
    categoria: 'Seguros'
  },
  {
    pregunta: '¿Cómo se maneja la comunicación conmigo como padre (WhatsApp, llamadas, reportes)?',
    respuesta: 'La comunicación con padres se realiza mediante un grupo oficial de WhatsApp administrado por el Group Leader y el staff. Se comparten actualizaciones generales y, de ser necesario, se contacta a las familias de forma privada. Los estudiantes pueden comunicarse con sus padres en horarios establecidos, considerando actividades y diferencia de horario.',
    categoria: 'Comunicación'
  },
  {
    pregunta: '¿A qué se refiere con que el hospedaje es en familia anfitriona o residencia, y con quién se comparte habitación?',
    respuesta: 'El hospedaje es en casas de familia anfitriona (homestay), previamente evaluadas y autorizadas bajo lineamientos oficiales del país. Estas familias cumplen estándares de seguridad, comodidad e instalaciones adecuadas para recibir estudiantes internacionales. Las casas se ubican en zonas residenciales seguras, con acceso a transporte público y dentro de rutas previamente definidas para el programa. La asignación contempla: 2 estudiantes por habitación en camas individuales, hasta 4 estudiantes en una misma casa (regularmente del mismo colegio), no se mezclan géneros en la asignación.',
    categoria: 'Hospedaje'
  },
  {
    pregunta: '¿El pago incluye la entrada a todas las actividades del itinerario?',
    respuesta: 'Así es, el pago contempla todas las actividades incluidas en el itinerario base. Sin embargo, contamos con un paquete de actividades adicionales que pueden adquirirse una vez que tenemos formados los grupos de viaje.',
    categoria: 'Actividades'
  },
  {
    pregunta: '¿Qué actividades diarias hay para practicar inglés (retos, talleres)?',
    respuesta: 'El programa combina actividades formales de inglés con actividades prácticas diseñadas para fomentar el uso constante del idioma. Los estudiantes participan en dinámicas, retos culturales, actividades guiadas y proyectos donde deben usar el inglés en situaciones reales. El objetivo es practicar el idioma todos los días en contextos auténticos.',
    categoria: 'Actividades'
  },
  {
    pregunta: '¿Cómo inscribo a mi hijo y cuánto es el pago inicial para apartar lugar?',
    respuesta: '¡Muy fácil! Llena el formulario, aparta con $10,000 MXN en la semana siguiente a la junta de padres.',
    categoria: 'Inscripción'
  },
  {
    pregunta: '¿Desde qué aeropuerto sale el vuelo y quién acompaña a los estudiantes?',
    respuesta: 'Todos los vuelos salen desde el Aeropuerto Internacional de la Ciudad de México, Benito Juárez. En todo momento contarán con staff de acompañamiento al grupo, desde el proceso de check-in y vuelo hasta llegar al destino.',
    categoria: 'Logística'
  },
  {
    pregunta: '¿Qué debe llevar en la maleta (ropa, documentos) y cuáles son las restricciones?',
    respuesta: '1 maleta de 23kg + equipaje de mano de 10kg.',
    categoria: 'Logística'
  },
  {
    pregunta: '¿Cómo funciona la ETA?',
    respuesta: 'El costo de la ETA o Electronic Travel Authorisation es de 16 libras. Deberá solicitarse en la siguiente liga: https://www.gov.uk/eta. Recuerda que, una vez cerrado el grupo, te acompañamos a lo largo de todo el proceso para completar correctamente los trámites.',
    categoria: 'Documentación'
  },
  {
    pregunta: '¿Qué trámites migratorios requiere el estudiante para salir del país?',
    respuesta: 'El estudiante deberá contar con: Pasaporte vigente, con una validez mínima de 6 meses posteriores a la fecha de término del viaje. Para viajar a Reino Unido, los estudiantes con nacionalidad mexicana deberán tramitar una ETA (Electronic Travel Authorisation) previa al viaje. Para viajar a Irlanda (Dublín), los estudiantes mexicanos no requieren visa para estancias cortas. Para otras nacionalidades, los requisitos migratorios deberán validarse según el país de origen. En el caso de menores de edad que viajen sin ambos padres, se requerirá el Formato SAM (Salida de Menores) conforme a la normativa mexicana vigente.',
    categoria: 'Documentación'
  }
];

async function updateFAQs() {
  console.log('📝 Actualizando FAQs en Google Sheets...\n');

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: PRIVATE_KEY,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Clear existing data (keep header)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEETS_ID,
      range: 'FAQ!A2:Z1000',
    });

    console.log('✅ Datos anteriores eliminados');

    // Prepare data rows
    const headers = ['pregunta', 'respuesta', 'categoria'];
    const rows = FAQS.map(faq => [
      faq.pregunta,
      faq.respuesta,
      faq.categoria
    ]);

    // Add headers + data
    const allData = [headers, ...rows];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEETS_ID,
      range: 'FAQ!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: allData
      }
    });

    console.log(`✅ ${FAQS.length} FAQs reales agregados a la hoja`);

    // Print summary by category
    const categories = {};
    FAQS.forEach(faq => {
      categories[faq.categoria] = (categories[faq.categoria] || 0) + 1;
    });

    console.log('\n📊 FAQs por categoría:');
    Object.entries(categories).forEach(([cat, count]) => {
      console.log(`   ${cat}: ${count} FAQs`);
    });

    console.log('\n🎉 ¡Actualización completada exitosamente!');
    console.log(`\n🔗 Verifica la hoja: https://docs.google.com/spreadsheets/d/${SHEETS_ID}/edit#gid=0`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

updateFAQs();
