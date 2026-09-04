/**
 * seed-ori-flow.js
 *
 * Siembra la pestaña "Flujo Ori" en Google Sheets: el guion del flujo de Ori
 * (Oxford Education) por NODOS, editable a mano por el cliente después de la
 * siembra inicial.
 *
 * Schema: ID | Estado | Texto | Destino opción 1..5 | Notas | Orden
 *   - ID: identificador estable del nodo (usado como clave y como destino en
 *     el mapeo de opciones de otros nodos).
 *   - Texto: guion VERBATIM que se envía al usuario (no parafrasear al editar).
 *   - Destino opción N: a qué nodo salta si el usuario responde "N". Vacío si
 *     el nodo no tiene menú numerado (respuesta libre / nodo utilitario).
 *   - Notas: contexto para el equipo (p. ej. TODOs, nodos nuevos/provisionales).
 *     Nunca se envía al usuario.
 *
 * IMPORTANTE — este script es SOLO CONTENIDO. No implementa ni modifica el
 * handler, el prompt ni la lógica de menú de Ori; eso es otra etapa. Tampoco
 * toca advisor-zones.js (ruteo geográfico) ni el handoff tibio, que ya están
 * en prod.
 *
 * Idempotencia ADITIVA (a propósito distinta de seed-oxford-faq.js):
 * "Flujo Ori" es una pestaña que el CLIENTE edita a mano, así que este script
 * nunca hace clear+rewrite. En cada corrida:
 *   1. Si la pestaña no existe, la crea con el header y siembra todos los nodos.
 *   2. Si ya existe, lee los IDs de la columna A y SOLO añade (append) las filas
 *      cuyo ID todavía no está presente. Las filas existentes — incluyendo
 *      cualquier edición manual del cliente — NUNCA se tocan, borran ni
 *      reordenan.
 *   3. Si el header tiene menos columnas que el schema actual, añade las que
 *      falten al final (igual que sheets-sync.js con la tab de leads),
 *      también sin reordenar ni sobrescribir columnas existentes.
 *
 * Usage:
 *   node scripts/seed-ori-flow.js --dry-run   # no escribe nada en Sheets
 *   node scripts/seed-ori-flow.js             # siembra/extiende de verdad
 */

import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';

// ── Definición de nodos (VERBATIM) ──────────────────────────────────────────
// texto: se envía tal cual al usuario. opciones: {numero: idNodoDestino}.
// estado/notas: metadatos para el equipo, nunca se envían al usuario.

const FLOW_NODES = [
  {
    id: 'bienvenida',
    estado: 'Vigente',
    texto: '¡Hola! Gracias por escribir a Oxford Education Lit. Nuestro horario de atención es de lunes a viernes de 9:00 a 18:00 h. ¿En qué puedo apoyarte hoy?',
    opciones: {},
    notas: 'Se usa SIEMPRE, sin versión de fuera de horario.',
  },
  {
    id: 'filtro_previo',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Para dirigir tu solicitud, cuéntame: ¿ya eres parte de Oxford Education Lit o buscas información?\n1.- Ya estoy inscrito / soy cliente\n2.- Quiero información',
    opciones: { 1: 'ya_inscrito_stub', 2: 'solicitud_datos' },
    notas: 'NUEVO — no está en el Sheet actual; redacción provisional, sujeta a validación del cliente.',
  },
  {
    id: 'ya_inscrito_stub',
    estado: 'Nuevo (stub — pendiente TODO)',
    texto: '¡Con gusto te apoyamos con tu proceso! ¿Me compartes tu nombre y el colegio o institución? Una asesora revisará tu caso y te dará seguimiento.',
    opciones: {},
    notas: 'NUEVO — stub hasta conectar el Sheet de "por cobrar". TODO: aquí se cableará después la consulta al Sheet de inscritos/por cobrar para dar el link de pago o la etapa. El cableado es otra etapa (no handler/prompt aquí).',
  },
  {
    id: 'solicitud_datos',
    estado: 'Vigente',
    texto: 'Para ayudarte mejor, ¿me compartes por favor:\n- Tu nombre y puesto (en caso de pertenecer a una institución)\n- Nombre de tu colegio o institución\n- Ciudad y estado',
    opciones: {},
    notas: 'Estos datos —incluida ciudad y estado— alimentan la captura y el ruteo geográfico ya existente (advisor-zones.js). El enganche es en la etapa de lógica, no aquí.',
  },
  {
    id: 'menu_principal',
    estado: 'Vigente',
    texto: 'Oxford Education es una EdTech con más de 10 años de experiencia que acompaña a colegios con certificaciones de idiomas, plataformas digitales, programas STEAM y experiencias educativas internacionales, siempre alineadas a estándares internacionales. ¿Qué área te interesa conocer?\n1.- Certificaciones\n2.- Plataformas para aprendizaje del inglés\n3.- Plataformas para el aula\n4.- Experiencias internacionales\n5.- Exámenes diagnósticos de inglés',
    opciones: { 1: 'cat_1', 2: 'cat_2', 3: 'cat_3', 4: 'cat_4', 5: 'cat_5' },
  },
  {
    id: 'cat_1',
    estado: 'Vigente',
    texto: 'Contamos con certificaciones y evaluaciones de inglés alineadas al MCER y con respaldo de la Association of Language Testers in Europe, para distintos niveles y edades. ¿Tu interés principal es:\n1.- Oxford TCC Kids (niños de 7 a 12 años)\n2.- Oxford TCC (A1-C2)\n3.- Oxford ETC (Certificación para docentes)\n4.- No estoy seguro',
    opciones: { 1: 'n_1_1', 2: 'n_1_2', 3: 'n_1_3', 4: 'n_1_4' },
  },
  {
    id: 'n_1_1',
    estado: 'Vigente',
    texto: 'Oxford TCC Kids es la certificación para niños de 7 a 12 años, que mide las habilidades de inglés integralmente y está alineada al MCER. ¿Quieres recibir más información o agendar una llamada con un asesor?',
    opciones: {},
  },
  {
    id: 'n_1_2',
    estado: 'Vigente',
    texto: 'El Oxford TCC evalúa el dominio del inglés como lengua extranjera, reconocido internacionalmente y alineado al MCER. ¿Deseas detalles sobre niveles, proceso o costos? Recuerda que contamos con procesos institucionales y convocatorias individuales para certificar tu nivel de inglés.',
    opciones: {},
  },
  {
    id: 'n_1_3',
    estado: 'Vigente',
    texto: 'Oxford ETC certifica competencias didácticas del profesorado en enseñanza de inglés con un programa integral de desarrollo docente. ¿Te gustaría conocer el contenido o modalidades del curso?',
    opciones: {},
  },
  {
    id: 'n_1_4',
    estado: 'Vigente',
    texto: 'Si aún no estás seguro, podemos ayudarte a entender mejor nuestras certificaciones y evaluaciones de inglés. Contamos con programas que abarcan diferentes niveles y edades, todos alineados al MCER y respaldados por ALTE. Podemos explicarte cuál sería la mejor opción según tus necesidades o nivel actual. ¿Te gustaría recibir una explicación más detallada sobre alguna de nuestras certificaciones, como el Oxford TCC, TCC Kids, o algún otro programa?',
    opciones: {},
  },
  {
    id: 'cat_2',
    estado: 'Vigente',
    texto: 'Plataformas para aprendizaje del inglés. Selecciona la plataforma que te interesa:\n1.- Oxford LIFE\n2.- Alphable',
    opciones: { 1: 'n_2_1', 2: 'n_2_2' },
  },
  {
    id: 'n_2_1',
    estado: 'Vigente',
    texto: 'Oxford LIFE es una plataforma para práctica diaria de inglés basada en micro-aprendizaje con gamificación, ideal para estudiantes de 13 años en adelante. ¿Te interesa platicar con un asesor?',
    opciones: {},
  },
  {
    id: 'n_2_2',
    estado: 'Vigente',
    texto: 'Alphable ofrece clases virtuales con profesores nativos o expertos, con diagnóstico y seguimiento personalizado. ¿Te interesa platicar con un asesor?',
    opciones: {},
  },
  {
    id: 'cat_3',
    estado: 'Vigente',
    texto: 'Plataformas para el aula. Por favor selecciona la plataforma de tu interés:\n1.- Smile and Learn\n2.- Visual Camp\n3.- AINARA\n4.- KNOW BY STEAM TREKS',
    opciones: { 1: 'n_3_1', 2: 'n_3_2', 3: 'n_3_4', 4: 'n_3_5' },
    notas: 'iEduca (n_3_3) se retiró del catálogo: ya no se distribuye. Los IDs n_3_4/n_3_5 NO se renumeraron a propósito — son llaves estables del grafo, no posiciones; el número que ve el usuario vive en el Texto.',
  },
  {
    id: 'n_3_1',
    estado: 'Vigente',
    texto: 'Smile and Learn es una app educativa con miles de actividades interactivas para niños de 3 a 12 años, diseñada para personalizar el aprendizaje y fomentar el bilingüismo. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?',
    opciones: {},
  },
  {
    id: 'n_3_2',
    estado: 'Vigente',
    texto: 'Visual Camp usa eye-tracking e inteligencia artificial para mejorar hábitos y comprensión lectora en inglés y español con métricas en tiempo real. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?',
    opciones: {},
  },
  {
    id: 'n_3_4',
    estado: 'Vigente',
    texto: 'AINARA utiliza IA generativa para crear, adaptar y evaluar contenidos personalizados, apoyando a docentes con recursos inclusivos para diferentes niveles y contextos. La plataforma permite el desarrollo de materiales para diferentes materias y planes de estudio, no se limita al aprendizaje del inglés. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?',
    opciones: {},
  },
  {
    id: 'n_3_5',
    estado: 'Vigente',
    texto: 'KNOW BY STEAM TREKS son cursos en academia virtual para docentes y alumnos que permiten la correcta implementación de la metodología STEAM (Ciencias, Tecnología, Ingeniería, Arte y Matemáticas) en el aula. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?',
    opciones: {},
  },
  {
    id: 'cat_4',
    estado: 'Vigente',
    texto: 'Experiencias internacionales. Por favor selecciona la experiencia que te interesa:\n1.- English Life\n2.- Rising STARS\n3.- Global Insights\n4.- Wish and Go',
    opciones: { 1: 'n_4_1', 2: 'n_4_2', 3: 'n_4_3', 4: 'n_4_4' },
  },
  {
    id: 'n_4_1',
    estado: 'Vigente',
    texto: 'English Life ofrece inmersión total en inglés a través de experiencias educativas internacionales con apoyo académico y cultural. Los viajeros pueden elegir entre viajar a Londres o a Dublín y contamos con dos salidas al año, una en mayo y otra en octubre. Este programa está abierto al público en general y es adecuado para viajeros de 13 a 30 años. También es posible formar grupos por colegio o institución. ¿Te interesaría hablar con un asesor?',
    opciones: {},
  },
  {
    id: 'n_4_2',
    estado: 'Vigente',
    texto: 'Rising STARS es un programa exclusivo en Inglaterra para estudiantes de alto rendimiento, con beca del 50% para quienes obtienen los mejores puntajes en su certificación Oxford TCC. Si tu colegio ya certifica con nosotros y necesitas más información sobre el programa, podemos comunicarte con un asesor.',
    opciones: {},
  },
  {
    id: 'n_4_3',
    estado: 'Vigente',
    texto: 'Global Insights es un viaje académico internacional para tomadores de decisiones educativas, enfocado en conocer y explorar los mejores sistemas educativos del mundo. En 2026, nos vamos a Corea del Sur. ¿Te interesa platicar con un asesor sobre fechas y costos?',
    opciones: {},
  },
  {
    id: 'n_4_4',
    estado: 'Vigente',
    texto: 'Wish and Go es un servicio integral para hacer realidad el viaje educativo de tu institución. Tú lo imaginas, nosotros lo hacemos posible. ¿Te interesa platicar con un asesor sobre el programa?',
    opciones: {},
  },
  {
    id: 'cat_5',
    estado: 'Vigente',
    texto: 'Exámenes diagnósticos de inglés. Elige la herramienta de medición que te interesa:\n1.- Oxford Checkpoint\n2.- Oxford Checkpoint Kids',
    opciones: { 1: 'n_5_1', 2: 'n_5_2' },
  },
  {
    id: 'n_5_1',
    estado: 'Vigente',
    texto: 'Oxford Checkpoint es una evaluación diseñada para estudiantes desde primaria avanzada hasta educación media superior, que cubre niveles desde Pre-A1 hasta C2. Evalúa las cinco habilidades del idioma inglés de forma integral, con procesos rigurosos y plataforma segura. Incluye reportes analíticos detallados y respaldo internacional por ALTE y MCER, ayudando en decisiones académicas y pedagógicas. ¿Quieres información sobre el proceso?',
    opciones: {},
  },
  {
    id: 'n_5_2',
    estado: 'Vigente',
    texto: 'Oxford Checkpoint Kids está dirigido a niños de 6 a 12 años en educación primaria. Mide habilidades básicas de inglés en niveles desde Pre-A1 hasta B1, evaluando comprensión auditiva, lectura, expresión oral y escrita, y uso del idioma. Sus reportes permiten un seguimiento efectivo del progreso infantil, con adaptaciones inclusivas y soporte especializado para facilitar una evaluación confiable y positiva para los niños. ¿Quieres que te enviemos más información sobre cómo inscribir a tus estudiantes o sobre los beneficios específicos de esta evaluación?',
    opciones: {},
  },
  {
    id: 'util_menu',
    estado: 'Vigente',
    texto: "Si deseas volver al menú principal en cualquier momento, solo escribe 'Menú' y te guiaré nuevamente.",
    opciones: {},
    notas: 'Nodo utilitario: se dispara por palabra clave ("Menú"), no por opción numerada.',
  },
  {
    id: 'util_llamada',
    estado: 'Vigente',
    texto: '¿Prefieres recibir una llamada? Por favor, comparte tu número y horario preferido, y uno de nuestros asesores te contactará a la brevedad.',
    opciones: {},
    notas: 'Nodo utilitario.',
  },
  {
    id: 'util_cierre',
    estado: 'Vigente',
    texto: 'Gracias por comunicarte con Oxford Education Lit. Si tienes más dudas en el futuro, no dudes en contactarnos nuevamente. ¡Que tengas un excelente día!',
    opciones: {},
    notas: 'Nodo utilitario: cierre de conversación.',
  },
];

const HEADER = [
  'ID', 'Estado', 'Texto',
  'Destino opción 1', 'Destino opción 2', 'Destino opción 3', 'Destino opción 4', 'Destino opción 5',
  'Notas', 'Orden',
];
const SHEET_NAME = 'Flujo Ori';
const MAX_OPTIONS = 5;

function buildRow(node, orden) {
  const destinos = [];
  for (let n = 1; n <= MAX_OPTIONS; n++) destinos.push(node.opciones?.[n] || '');
  return [node.id, node.estado || '', node.texto, ...destinos, node.notas || '', orden];
}

const ALL_ROWS = FLOW_NODES.map((node, i) => buildRow(node, i + 1));

// ── Auth ──────────────────────────────────────────────────────────────────────

function hasCredentials() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

async function buildSheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// ── Dry run ───────────────────────────────────────────────────────────────────

async function printDryRun(spreadsheetId) {
  console.log(`Target sheet: "${SHEET_NAME}" in spreadsheet ${spreadsheetId || '(GOOGLE_SHEETS_ID no configurado)'}`);
  console.log(`Nodos definidos en el script: ${FLOW_NODES.length}\n`);

  let existingIds = null; // null = no se pudo verificar (sin credenciales / sin acceso)

  if (spreadsheetId && hasCredentials()) {
    try {
      const sheets = await buildSheetsClient();
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
      if (exists) {
        const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SHEET_NAME}'!A:A` });
        const values = resp.data.values || [];
        existingIds = new Set(values.slice(1).map((r) => r[0]).filter(Boolean)); // skip header
        console.log(`[LECTURA] La pestaña "${SHEET_NAME}" YA EXISTE con ${existingIds.size} nodo(s) sembrado(s).`);
      } else {
        existingIds = new Set();
        console.log(`[LECTURA] La pestaña "${SHEET_NAME}" NO existe todavía — se crearía desde cero.`);
      }
    } catch (err) {
      console.log(`[LECTURA] No se pudo leer el Sheet en vivo (${err.message}). Modo simulación pura: se asume pestaña nueva.\n`);
    }
  } else {
    console.log('[LECTURA] Sin credenciales de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY) en este entorno.');
    console.log('Modo simulación pura: se listan los nodos que el script maneja, sin verificar contra el Sheet real.\n');
  }

  console.log('Header:');
  console.log(`  ${JSON.stringify(HEADER)}\n`);

  console.log('Nodos:');
  ALL_ROWS.forEach((row, i) => {
    const node = FLOW_NODES[i];
    let tag;
    if (existingIds === null) tag = '?';
    else tag = existingIds.has(node.id) ? 'YA EXISTE — se conserva, no se toca' : 'NUEVO — se insertaría';
    const destinos = row.slice(3, 3 + MAX_OPTIONS).filter(Boolean).join(', ') || '(sin opciones numeradas)';
    console.log(`  ${String(i + 1).padStart(2, '0')}. [${node.id}] (${tag})`);
    console.log(`      Texto: ${JSON.stringify(node.texto)}`);
    console.log(`      Opciones → ${destinos}`);
    if (node.notas) console.log(`      Notas: ${node.notas}`);
  });

  if (existingIds !== null) {
    const toInsert = FLOW_NODES.filter((n) => !existingIds.has(n.id));
    console.log(`\nResumen: ${existingIds.size} existentes (sin tocar) + ${toInsert.length} nuevas a insertar = ${FLOW_NODES.length} nodos totales del script.`);
  } else {
    console.log(`\nResumen: ${FLOW_NODES.length} nodos definidos en el script (no se pudo comparar contra el Sheet real).`);
  }
}

// ── Main (escritura real) ────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const spreadsheetId = process.env.OXED_SHEETS_ID || process.env.GOOGLE_SHEETS_ID;

  if (dryRun) {
    await printDryRun(spreadsheetId);
    return;
  }

  if (!spreadsheetId) {
    console.error('GOOGLE_SHEETS_ID (o OXED_SHEETS_ID) no está configurado.');
    process.exit(1);
  }
  if (!hasCredentials()) {
    console.error('Faltan credenciales: GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY.');
    process.exit(1);
  }

  const sheets = await buildSheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);

  if (!exists) {
    console.log(`Sheet "${SHEET_NAME}" no existe — creándola...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER, ...ALL_ROWS] },
    });
    console.log(`Sheet "${SHEET_NAME}" creada con ${FLOW_NODES.length} nodos (header + datos).`);
    return;
  }

  // Pestaña existente: reconciliar header de forma ADITIVA (nunca reordena ni borra).
  const headerResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SHEET_NAME}'!1:1` });
  const currentHeader = headerResp.data.values?.[0] || [];

  if (currentHeader.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] },
    });
    console.log(`Sheet "${SHEET_NAME}" no tenía header — se escribió.`);
  } else if (currentHeader.length < HEADER.length) {
    const missing = HEADER.slice(currentHeader.length);
    const startCol = colLetter(currentHeader.length);
    const endCol = colLetter(HEADER.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!${startCol}1:${endCol}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [missing] },
    });
    console.log(`Header reconciliado de forma aditiva: se agregaron columnas [${missing.join(', ')}] en ${startCol}1:${endCol}1.`);
  }

  // Leer IDs existentes (columna A, saltando header) para no duplicar ni sobrescribir.
  const idsResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SHEET_NAME}'!A:A` });
  const existingIds = new Set((idsResp.data.values || []).slice(1).map((r) => r[0]).filter(Boolean));

  const rowsToAppend = FLOW_NODES
    .map((node, i) => ({ node, row: ALL_ROWS[i] }))
    .filter(({ node }) => !existingIds.has(node.id))
    .map(({ row }) => row);

  if (rowsToAppend.length === 0) {
    console.log(`Sin cambios: los ${FLOW_NODES.length} nodos del script ya están presentes en "${SHEET_NAME}".`);
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:Z`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rowsToAppend },
  });

  console.log(`Listo. ${rowsToAppend.length} nodo(s) nuevo(s) añadidos a "${SHEET_NAME}" (${existingIds.size} existentes se dejaron intactos).`);
}

/** Índice de columna 0-based → letra A1 (0→A, 11→L). */
function colLetter(index) {
  let n = index;
  let letter = '';
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
