/**
 * seed-miri-flow.js
 *
 * Siembra la pestaña "Flujo Miri" en Google Sheets: el guion del flujo de Miri
 * (Travel / English 4 Life) por NODOS, editable a mano por el cliente después
 * de la siembra inicial.
 *
 * Gemelo de scripts/seed-ori-flow.js — mismo schema, mismo patrón aditivo, misma
 * CLI. Lo único que cambia es SHEET_NAME, el spreadsheet objetivo y el contenido.
 *
 * Schema: ID | Estado | Texto | Destino opción 1..5 | Notas | Orden | Material
 *   - ID: identificador estable del nodo (clave y destino de las opciones).
 *   - Texto: guion VERBATIM que se envía al usuario (no parafrasear al editar).
 *     Los placeholders {{...}} los sustituye el motor de flujo en tiempo de
 *     ejecución (ver Notas de cada nodo); el resto del texto va tal cual.
 *   - Destino opción N: a qué nodo salta si el usuario responde "N". Vacío si
 *     el nodo no tiene menú numerado (respuesta libre / nodo utilitario).
 *   - Notas: contexto para el equipo (TODOs, origen de los datos, reglas de
 *     ruteo). Nunca se envía al usuario.
 *   - Material: ID del material (pestaña Materiales) que el nodo envía. Vacío en
 *     e4l_material porque ahí el motor lo resuelve por destino del colegio.
 *
 * IMPORTANTE — este script es SOLO CONTENIDO. No implementa ni modifica el
 * handler, el prompt ni la lógica de menú de Miri; eso es otra etapa. Tampoco
 * toca actions.js (handoff tibio, carrusel de asesoras) ni knowledge.js, que ya
 * están en prod.
 *
 * Idempotencia ADITIVA (igual que seed-ori-flow.js): "Flujo Miri" es una pestaña
 * que el CLIENTE edita a mano, así que este script nunca hace clear+rewrite.
 * En cada corrida:
 *   1. Si la pestaña no existe, la crea con el header y siembra todos los nodos.
 *   2. Si ya existe, lee los IDs de la columna A y SOLO añade (append) las filas
 *      cuyo ID todavía no está presente. Las filas existentes — incluyendo
 *      cualquier edición manual del cliente — NUNCA se tocan, borran ni
 *      reordenan.
 *   3. Si el header tiene menos columnas que el schema actual, añade las que
 *      falten al final, también sin reordenar ni sobrescribir.
 *
 * Usage:
 *   node scripts/seed-miri-flow.js --dry-run   # no escribe nada en Sheets
 *   node scripts/seed-miri-flow.js             # siembra/extiende de verdad
 */

import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';

// ── Definición de nodos (VERBATIM) ──────────────────────────────────────────
// texto: se envía tal cual al usuario (salvo los placeholders {{...}}).
// opciones: {numero: idNodoDestino}. estado/notas: metadatos para el equipo.

const FLOW_NODES = [
  // ── Entrada ───────────────────────────────────────────────────────────────
  {
    id: 'bienvenida',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Hola! Soy Miri, del equipo de Oxford Education & Travel ✈️ Acompaño a las familias con nuestros programas de inmersión en inglés en el extranjero.\n\n¿En qué te puedo ayudar hoy?',
    opciones: {},
    notas: 'Se envía junto con filtro_previo al iniciar la conversación (mismo patrón que Ori: dos mensajes seguidos).',
  },
  {
    id: 'filtro_previo',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Para orientarte mejor, cuéntame: ¿ya estás inscrito en alguno de nuestros programas o buscas información?\n1.- Ya estoy inscrito\n2.- Busco información',
    opciones: { 1: 'ya_inscrito', 2: 'solicitud_datos' },
    notas: 'Nodo requerido por el motor de flujo (junto con bienvenida): si falta, el flujo determinístico se deshabilita y cede al camino LLM.',
  },
  {
    id: 'ya_inscrito',
    estado: 'Nuevo (stub — pendiente TODO)',
    texto: '¡Con gusto te apoyamos con tu proceso! ¿Me compartes tu nombre y el colegio de tu hijo o hija?\n\nUna asesora revisa tu caso y te da seguimiento en breve 😊',
    opciones: {},
    notas: 'STUB. TODO(cliente): cablear aquí la consulta al sheet de inscritos / plataforma PorCobrar para dar el link de pago o la etapa del proceso. No dispara cotización ni ruteo por producto. El cableado es otra etapa.',
  },

  // ── Captura ───────────────────────────────────────────────────────────────
  {
    id: 'solicitud_datos',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Perfecto! 😊 Para darte información precisa, ¿me compartes tu nombre, y el nombre y la edad de tu hijo o hija que viajaría?',
    opciones: {},
    notas: 'Nodo de extracción (no menú numerado): captura parent_name, traveler_name y traveler_age con el mismo mapeo/validación que [CAPTURAR_DATO]. Siguiente nodo: solicitud_colegio.',
  },
  {
    id: 'solicitud_colegio',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Gracias 🙌 ¿De qué colegio nos escribes?\n\nInstituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia, Instituto Martha Christlieb, Colegio Iberoamericano, Instituto Internacional o UMIN.\n\nSi tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.',
    opciones: {},
    notas: 'Nodo de extracción: captura school_code contra los 16 colegios con tarifa en la hoja de precios. Lista de referencia (no menú numerado) porque el schema solo admite 5 opciones. "otro"/sin match → familia, sin cotización. Este dato decide el gate de precio Y el carrusel de asesoras. Siguiente nodo: menu_principal.',
  },

  // ── Menú ──────────────────────────────────────────────────────────────────
  {
    id: 'menu_principal',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Tenemos tres programas de inmersión en inglés para 2027. ¿Cuál te interesa conocer?\n1.- English 4 Life (Londres o Dublín, mayo)\n2.- Winter Break (Windsor, Inglaterra)\n3.- Rising Stars (programa con beca)\n4.- Prefiero hablar con una asesora',
    opciones: { 1: 'cat_e4l', 2: 'cat_wb', 3: 'cat_rs', 4: 'handoff_colegio' },
    notas: 'Destino de la palabra clave "Menú" desde cualquier nodo. Opción 4 → handoff_colegio si hay colegio registrado; handoff_familia si el colegio es "otro" o no se capturó.',
  },

  // ── English 4 Life ────────────────────────────────────────────────────────
  {
    id: 'cat_e4l',
    estado: 'Nuevo (redacción provisional)',
    texto: 'English 4 Life es un programa inmersivo de inglés: viajan a Londres o a Dublín del 21 al 30 de mayo de 2027, 9 días y 8 noches, con retos y actividades para practicar el idioma en situaciones reales.\n\nIncluye hospedaje en casa de familia anfitriona, desayuno y cena, las clases y actividades del itinerario, seguro de gastos médicos mayores, staff 24/7 y un profesor de su colegio.\n\n¿Qué te gustaría ver?\n1.- La inversión\n2.- La presentación completa\n3.- Hablar con una asesora',
    opciones: { 1: 'e4l_precio_registrado', 2: 'e4l_material', 3: 'handoff_colegio' },
    notas: 'Fuente: doc "Preguntas asistente virtual English4Life". La opción 1 apunta al nodo de colegio registrado; el motor redirige a e4l_precio_columbia o e4l_precio_otro según el colegio capturado.',
  },
  {
    id: 'e4l_precio_registrado',
    estado: 'Nuevo (redacción provisional)',
    texto: 'En {{colegio}} tienes dos opciones de inversión, siempre programa académico más vuelo redondo desde la Ciudad de México.\n\nSi liquidas todo antes del 31 de marzo de 2027, el programa queda en ${{prog_completo}} MXN y el vuelo en ${{vuelo_completo}} MXN.\n\nSi prefieres apartar tu lugar con $15,000, el programa queda en ${{prog_apartado}} MXN y el vuelo en ${{vuelo_apartado}} MXN, y de ahí armas un plan mensual desde tu inscripción hasta quedar liquidado, máximo 2 meses antes del viaje.\n\n¿Te conecto con una asesora para ver tu plan de pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_colegio', 2: 'util_menu' },
    notas: 'SOLO colegios registrados. Hoja "Colegios inscritos precios" (1JIdKFMAa-mrLowgCiS8k1MWtAL-Vn52lWPn0roYanIU), pestaña CONDICIONES POLÍTICAS: {{prog_completo}}=col F y {{vuelo_completo}}=col G (tier pago completo); {{prog_apartado}}=col H y {{vuelo_apartado}}=col I (tier apartado 15K). PROGRAMA Y VUELO PUEDEN DIFERIR ENTRE TIERS (ej. Global Skills: vuelo 36,000 vs 37,000) — nunca reutilizar el valor de un tier en el otro. Nunca calcular ni sumar. Colegio Columbia → e4l_precio_columbia (plano, sin tiers). Colegio "otro" o sin colegio → e4l_precio_otro. CASO BORDE: Instituto Martha Christlieb tiene "-" en F/G (sin tier de pago completo) — mostrar solo el tier de apartado. PENDIENTE VALIDAR: el encabezado de la hoja dice "hasta el 31 de marzo 2026"; el texto dice 2027 por indicación del cliente.',
  },
  {
    id: 'e4l_precio_columbia',
    estado: 'Nuevo (redacción provisional)',
    texto: 'En Colegio Columbia el programa es en modalidad hotel y la inversión es de $85,000 MXN, que ya incluye el vuelo redondo desde la Ciudad de México.\n\nApartas tu lugar con $15,000 y de ahí armas un plan mensual desde tu inscripción hasta quedar liquidado, máximo 2 meses antes del viaje.\n\n¿Te conecto con una asesora para ver tu plan de pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_colegio', 2: 'util_menu' },
    notas: 'Único colegio con modalidad Hotel y vuelo incluido en la hoja de precios. Precio PLANO: $85,000 en ambos tiers de la hoja, así que aquí NO se muestran dos precios.',
  },
  {
    id: 'e4l_precio_otro',
    estado: 'Nuevo (redacción provisional)',
    texto: 'La inversión depende del convenio que tenemos con cada colegio, por eso prefiero que una asesora te dé el número exacto y tu plan de pagos 😊\n\nLo que sí te adelanto: el lugar se aparta con $15,000 y de ahí armas un plan mensual hasta quedar liquidado, máximo 2 meses antes del viaje.\n\n¿Te conecto con una asesora?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_familia', 2: 'util_menu' },
    notas: 'Colegio "otro" o sin capturar. NUNCA dar precio de programa ni de vuelo aquí, ni confirmar precios que el prospecto haya visto en un PDF o en otro chat.',
  },
  {
    id: 'e4l_precio_unico',
    estado: 'Nuevo (redacción provisional)',
    texto: 'En {{colegio}} la inversión es de ${{precio_unico}} MXN, con el vuelo redondo desde la Ciudad de México ya incluido.\n\nApartas tu lugar con $15,000 y de ahí armas un plan mensual desde tu inscripción hasta quedar liquidado, máximo 2 meses antes del viaje.\n\n¿Te conecto con una asesora para ver tu plan de pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_colegio', 2: 'util_menu' },
    notas: 'Tier ÚNICO de la hoja de precios (encabezado "AGOSTO – SEPTIEMBRE 2027", columna H: PRECIO PROGRAMA CON VUELO INCLUIDO). Aplica a Instituto Internacional y UMIN: un solo número, no el par programa+vuelo, y por eso NO se muestran los dos tramos. El motor elige este nodo cuando la fila del colegio solo tiene precio en esa columna.',
  },
  {
    id: 'e4l_material',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Claro! Te comparto la presentación completa de English 4 Life 2027, con el itinerario, todo lo que incluye y los trámites 📄\n\n¿Quieres que una asesora te contacte para resolver dudas?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_colegio', 2: 'util_menu' },
    notas: 'Material JDP_LONDRES_2027 o JDP_DUBLIN_2027 según el destino del colegio en la hoja de precios (Dublín: J. Francisco Rodríguez, Luz del Tepeyac, Ramiro Kolbe, Kino de San Luis, Martha Christlieb; Londres: los demás). Sin colegio → preguntar destino antes de enviar. El schema no tiene columna de material: la columna Material queda VACÍA a propósito porque aquí el motor resuelve el ID por destino.',
  },

  // ── Winter Break ──────────────────────────────────────────────────────────
  {
    id: 'cat_wb',
    estado: 'Nuevo (redacción provisional)',
    texto: 'English 4 Life Winter Break es una experiencia académica de inmersión en marzo de 2027, con base en Windsor, Inglaterra, hospedados en el Hotel LEGOLAND Windsor Resort. Son 10 días de viaje, 9 días y 8 noches, desde los 13 años.\n\nIncluye vuelo internacional, hospedaje, los tres alimentos, clases de inglés por proyectos, visitas guiadas en Londres, Windsor y Oxford, traslados, travel card, staff 24/7 y diploma.\n\n¿Qué te gustaría ver?\n1.- La inversión\n2.- La presentación completa\n3.- Hablar con una asesora',
    opciones: { 1: 'wb_precio', 2: 'wb_material', 3: 'handoff_colegio' },
    notas: 'Fuente: sección "FAQ – English4Life Winter Break" del doc de English 4 Life. La fecha "marzo de 2027" viene de la pestaña Viajes de producción (WB2027), no de la FAQ — validar el día exacto con el cliente.',
  },
  {
    id: 'wb_precio',
    estado: 'Nuevo (redacción provisional)',
    texto: 'En Winter Break la inversión se arma por colegio, según cómo se integre el grupo, así que prefiero que una asesora te pase la propuesta exacta 😊\n\n¿Te conecto con ella?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_colegio', 2: 'util_menu' },
    notas: 'Winter Break NO se cotiza nunca, ni siquiera a colegio registrado: no hay filas de WB en la hoja de precios y la FAQ dice que las condiciones comerciales se especifican en la propuesta de cada institución. El gate de colegio registrado aplica SOLO a English 4 Life.',
  },
  {
    id: 'wb_material',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Va, te comparto la presentación de Winter Break con el itinerario y todo lo que incluye 📄\n\n¿Quieres que una asesora te contacte para ver la propuesta de tu colegio?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_colegio', 2: 'util_menu' },
    material: 'WB_LONDRES_2027',
    notas: 'Material WB_LONDRES_2027 (pestaña Materiales del spreadsheet principal). El ID vive en la columna Material.',
  },

  // ── Rising Stars (con gate de elegibilidad) ───────────────────────────────
  {
    id: 'cat_rs',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Rising Stars es un programa por invitación para los estudiantes con los mejores puntajes en la certificación Oxford TCC, con una beca del 50% 🌟\n\nPara orientarte bien: ¿tu hijo o hija presentó el Oxford TCC y quedó en los primeros lugares de su grupo?\n1.- Sí\n2.- No, o no estoy seguro',
    opciones: { 1: 'rs_elegible', 2: 'rs_no_elegible' },
    notas: 'GATE obligatorio de elegibilidad. Rising Stars nunca se menciona proactivamente fuera de este nodo (no aparece en cat_e4l ni en cat_wb).',
  },
  {
    id: 'rs_elegible',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Qué gusto! 🌟 Rising Stars 2027 es en Windsor, Inglaterra, hospedados en Legoland Resort: 9 días y 8 noches con talleres de liderazgo, pensamiento creativo, improvisación y oratoria, más visitas a Londres y Oxford.\n\nPrimaria y secundaria viajan del 21 al 30 de enero de 2027, y preparatoria del 29 de enero al 7 de febrero.\n\nLa beca cubre el 50% del programa académico e incluye hospedaje, los tres alimentos, seguro de gastos médicos mayores, traslados, travel card y diploma. Te conecto con una asesora del programa para confirmar la beca y darte los siguientes pasos 😊',
    opciones: {},
    notas: 'Fuente: doc "RISING STARS FAQ". NUNCA dar precio de Rising Stars, ni siquiera el monto con beca. Nodo hoja: dispara handoff_rs (carrusel propio de Rising Stars).',
  },
  {
    id: 'rs_no_elegible',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Sin problema 😊 La beca Rising Stars se otorga solo por desempeño en la certificación Oxford TCC, así que la invitación llega a quienes obtienen los mejores puntajes de su grupo.\n\nSi quieren una experiencia internacional este año, English 4 Life y Winter Break están abiertos a cualquier estudiante desde los 13 años.\n1.- Cuéntame de English 4 Life\n2.- Cuéntame de Winter Break\n3.- Prefiero hablar con una asesora',
    opciones: { 1: 'cat_e4l', 2: 'cat_wb', 3: 'handoff_familia' },
    notas: 'Opción 3 → handoff_familia por default; si hay colegio registrado capturado, el motor usa handoff_colegio.',
  },

  {
    id: 'ya_inscrito_sin_pago',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Gracias{{nombre}}! 🙌 Ya te tengo en el registro de English 4 Life.\n\nPara el siguiente paso de tu proceso te conecto con tu asesora, que revisa tu caso y te escribe en breve.',
    opciones: {},
    notas: 'Rama "ya inscrito", desenlace 2: el teléfono SÍ está en el registro pero el alumno no tiene fila de pagos (o hay filas duplicadas). NUNCA se muestra ningún monto aquí; se deriva con contexto. {{nombre}} = nombre del papá según el registro; si no hay, la línea se ajusta sola.',
  },
  {
    id: 'ya_inscrito_estatus',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Esto es lo que tengo de {{alumno}} 📋\n\nTotal del programa: {{total_a_pagar}}\nLlevas pagado: {{llevan_pagado}}\nFalta por pagar: {{falta_por_pagar}}\n\n¿Te conecto con tu asesora para ver las fechas de tus siguientes pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias',
    opciones: { 1: 'handoff_colegio', 2: 'util_menu' },
    notas: 'Rama "ya inscrito", desenlace 3: SOLO se llega aquí cuando el match alumno→fila de pago es INEQUÍVOCO. Los montos salen de la hoja de inscritos (TOTAL A PAGAR / LLEVAN PAGADO / FALTA POR PAGAR). NO hay columna de próximo pago ni fecha límite: esa la da la asesora, el bot no la inventa.',
  },

  // ── Derivación (handoff tibio) ────────────────────────────────────────────
  {
    id: 'handoff_colegio',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Perfecto! 😊 Te conecto con {{asesora}}, nuestra asesora educativa, que te escribe en breve por WhatsApp para ver la inversión y los siguientes pasos.\n\nMientras tanto, aquí sigo para cualquier otra duda 🙌',
    opciones: {},
    notas: 'English 4 Life y Winter Break, vía COLEGIO. Carrusel de 3: Alma Sotelo, Victor Hugo Cruz, Cecilia Rodríguez. Handoff TIBIO: derivar no silencia a Miri, sigue contestando dudas generales pero nunca precio. {{asesora}} lo inserta el motor. PENDIENTE decidir en la etapa del motor si este texto gana o si se conserva el mensaje que ya genera executeHandoffToAdvisor (para no mandar dos mensajes).',
  },
  {
    id: 'handoff_familia',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Con gusto! 😊 Te conecto con {{asesora}}, que atiende a las familias y te escribe en breve por WhatsApp para ver la inversión y los siguientes pasos.\n\nMientras tanto, aquí sigo para cualquier otra duda 🙌',
    opciones: {},
    notas: 'English 4 Life y Winter Break, vía FAMILIA/ESTUDIANTE (colegio "otro" o sin capturar) → Camila Serafín. Handoff TIBIO, mismas reglas que handoff_colegio.',
  },
  {
    id: 'handoff_rs',
    estado: 'Nuevo (redacción provisional)',
    texto: '¡Va! 🌟 Te conecto con {{asesora}}, asesora especializada en Rising Stars, que te escribe en breve para confirmar la beca y darte los siguientes pasos.\n\nAquí sigo para cualquier otra duda 😊',
    opciones: {},
    notas: 'Rising Stars: carrusel propio (Miriana Galdos, Alejandra Najera, Ericka Arcos), aplica tanto a colegios como a familias. Handoff TIBIO. Nunca dar precio de Rising Stars después de derivar.',
  },

  // ── Utilitario ────────────────────────────────────────────────────────────
  {
    id: 'util_menu',
    estado: 'Nuevo (redacción provisional)',
    texto: 'Cuando quieras volver al menú principal, solo escribe "Menú" y te guío de nuevo 😊',
    opciones: {},
    notas: 'Nodo utilitario: se dispara por palabra clave ("Menú"), no por opción numerada. También es el destino de las respuestas "Todavía no, gracias" de los nodos de precio y material.',
  },
];

const HEADER = [
  'ID', 'Estado', 'Texto',
  'Destino opción 1', 'Destino opción 2', 'Destino opción 3', 'Destino opción 4', 'Destino opción 5',
  'Notas', 'Orden', 'Material',
];
const SHEET_NAME = 'Flujo Miri';
const MAX_OPTIONS = 5;

function buildRow(node, orden) {
  const destinos = [];
  for (let n = 1; n <= MAX_OPTIONS; n++) destinos.push(node.opciones?.[n] || '');
  return [node.id, node.estado || '', node.texto, ...destinos, node.notas || '', orden, node.material || ''];
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
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (dryRun) {
    await printDryRun(spreadsheetId);
    return;
  }

  if (!spreadsheetId) {
    console.error('GOOGLE_SHEETS_ID no está configurado.');
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
  const existingIdRows = (idsResp.data.values || []).slice(1).map((r) => r[0]);
  const existingIds = new Set(existingIdRows.filter(Boolean));

  // Rellenar SOLO celdas vacías de columnas que este script agregó después de la
  // siembra inicial (hoy: Material). Nunca pisa un valor existente, así que una
  // edición del cliente siempre gana.
  await fillMissingMaterialCells(sheets, spreadsheetId, existingIdRows);
  await applyTextMigrations(sheets, spreadsheetId, existingIdRows);

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


/**
 * Migraciones de TEXTO sobre nodos ya sembrados.
 *
 * El patrón aditivo nunca reescribe filas existentes — es lo que protege las
 * ediciones del cliente. Pero a veces el contenido canónico cambia (aquí: se
 * agregó un colegio a la lista de solicitud_colegio). Estas migraciones aplican
 * el cambio SOLO si la celda sigue siendo EXACTAMENTE el texto anterior del
 * seed; si el cliente ya la editó, se respeta su versión y se avisa por consola.
 */
const TEXT_MIGRATIONS = [
  {
    id: 'solicitud_colegio',
    from: 'Gracias 🙌 ¿De qué colegio nos escribes?\n\nInstituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia o Instituto Martha Christlieb.\n\nSi tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.',
    to: 'Gracias 🙌 ¿De qué colegio nos escribes?\n\nInstituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia, Instituto Martha Christlieb, Colegio Iberoamericano, Instituto Internacional o UMIN.\n\nSi tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.',
    motivo: 'Colegio Iberoamericano tiene tarifa en la hoja de precios pero faltaba en la lista.',
  },
  {
    id: 'solicitud_colegio',
    from: 'Gracias 🙌 ¿De qué colegio nos escribes?\n\nInstituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia, Instituto Martha Christlieb o Colegio Iberoamericano.\n\nSi tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.',
    to: 'Gracias 🙌 ¿De qué colegio nos escribes?\n\nInstituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia, Instituto Martha Christlieb, Colegio Iberoamericano, Instituto Internacional o UMIN.\n\nSi tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.',
    motivo: 'Instituto Internacional y UMIN cotizan con el tier único (columna H) pero faltaban en la lista.',
  },
];

/**
 * Aplica TEXT_MIGRATIONS sobre las filas ya sembradas. Nunca pisa una edición
 * del cliente: solo escribe cuando la celda coincide carácter por carácter con
 * el texto anterior.
 */
async function applyTextMigrations(sheets, spreadsheetId, existingIdRows) {
  if (TEXT_MIGRATIONS.length === 0) return;

  const textoCol = colLetter(HEADER.indexOf('Texto'));
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!${textoCol}:${textoCol}`,
  });
  const current = resp.data.values || [];

  const data = [];
  const aplicados = [];
  for (const m of TEXT_MIGRATIONS) {
    const idx = existingIdRows.indexOf(m.id);
    if (idx === -1) continue;                       // aún no sembrado → se insertará con el texto nuevo
    const rowNumber = idx + 2;                      // +1 header, +1 base-1
    const cur = (current[rowNumber - 1] || [])[0] ?? '';
    if (cur === m.to) continue;                     // ya migrado
    if (cur !== m.from) {
      console.log(`[MIGRACIÓN] "${m.id}": el texto fue editado en el Sheet — se RESPETA y no se toca. (${m.motivo})`);
      continue;
    }
    data.push({ range: `'${SHEET_NAME}'!${textoCol}${rowNumber}`, values: [[m.to]] });
    aplicados.push(m.id);
  }

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
  console.log(`Texto migrado en ${data.length} nodo(s): ${aplicados.join(', ')}.`);
}

/**
 * Rellena la columna Material de las filas YA sembradas cuya celda esté vacía.
 * Necesario porque el patrón aditivo solo hace append: cuando se agrega una
 * columna nueva al schema, las filas viejas quedan sin ese valor. Solo escribe
 * celdas vacías — cualquier valor puesto por el cliente se respeta.
 */
async function fillMissingMaterialCells(sheets, spreadsheetId, existingIdRows) {
  const materialCol = colLetter(HEADER.indexOf('Material'));
  const withMaterial = FLOW_NODES.filter((n) => n.material);
  if (withMaterial.length === 0) return;

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!${materialCol}:${materialCol}`,
  });
  const current = resp.data.values || [];

  const data = [];
  for (const node of withMaterial) {
    const idx = existingIdRows.indexOf(node.id);
    if (idx === -1) continue;                       // aún no sembrado → se insertará con su valor
    const rowNumber = idx + 2;                      // +1 header, +1 base-1
    const cur = (current[rowNumber - 1] || [])[0];
    if (cur && String(cur).trim()) continue;        // ya tiene valor → no se toca
    data.push({ range: `'${SHEET_NAME}'!${materialCol}${rowNumber}`, values: [[node.material]] });
  }

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
  console.log(`Columna Material rellenada en ${data.length} fila(s) que estaban vacías.`);
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
