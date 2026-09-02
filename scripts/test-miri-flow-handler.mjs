/**
 * Test de regresión del HANDLER real de Miri recorriendo el FLUJO DETERMINÍSTICO
 * (feature/miri-flow).
 *
 * Gemelo de scripts/test-oxford-flow-handler.mjs: corre handleMessage() REAL de
 * travel, turno a turno, contra un grafo de "Flujo Miri" realista (los mismos
 * textos verbatim del seed), con solo la infraestructura mockeada
 * (DB/Redis/WhatsApp/Claude/Sheets/reloj de horario).
 *
 * Corren SIN mockear, a propósito, las piezas cuyo comportamiento se quiere
 * probar de verdad: actions.js (executeCaptureData, executeHandoffToAdvisor,
 * executeSendMaterial), advisors.js (carruseles) y prices.js (gate de precio y
 * regla de tier vacío, alimentado por un readRange falso que espeja la hoja real).
 *
 * Cubre:
 *   A. bienvenida → filtro → datos → colegio → menú → E4L → precio (2 tiers) → handoff
 *   B. opción inválida en un menú → re-muestra opciones, flowNode intacto
 *   C. "Menú" resetea a menu_principal, incluso desde modo libre
 *   D. gate de precio: Columbia (plano) y "otro" (sin número → handoff familia)
 *   E. regla de tier vacío: Martha Christlieb muestra solo el tier de apartado
 *   F. material por destino (Londres/Dublín/Winter Break) + pregunta de destino
 *   G. Rising Stars: gate → elegible → handoff al carrusel propio
 *   H. handoff tibio: guard anti-redisparo no re-notifica ni duplica ticket
 *   I. respaldo LLM con texto libre → NO rompe flowNode + nudge de "Menú"
 *   J. fallback seguro: Sheet no disponible → cede el turno completo al LLM
 *   K. sync a Sheets también en turnos puramente de menú
 *   L. comandos de asesora sin rol admin: PENDIENTES solo muestra leads propios
 *   M. rama ya_inscrito: 3 desenlaces, varios hijos, match ambiguo, hoja caída
 *   N. tier único con vuelo incluido y colegios con varias filas (UMIN)
 *   O. regresión del chat real: opción por texto, número en frase, nudge una vez
 *
 * Requiere: node --experimental-test-module-mocks
 */
import assert from 'node:assert';
import { mock } from 'node:test';

// ── Estado fake compartido ───────────────────────────────────────────────────
const SENT = [];           // { to, text }
const MEDIA_SENT = [];     // { to, type, mediaId, filename }
const TEMPLATES_SENT = []; // { to, name }
const SHEET_SYNCS = [];    // { leadId, schoolCode }
let DB_CONV;
let DB_LEAD;
let EXTRACT_RESULT = {};
let CHAT_REPLY = 'Con gusto te cuento más sobre eso 😊';
let officeHoursOverride = true;
let TEMPLATE_V2 = '';
let ENROLL_ROWS = {};

function resetState() {
  SENT.length = 0;
  MEDIA_SENT.length = 0;
  TEMPLATES_SENT.length = 0;
  SHEET_SYNCS.length = 0;
  DB_CONV = { id: 'conv1', contactId: 'c1', status: 'active', flowNode: null, interestScore: 0, metadata: {} };
  DB_LEAD = {
    id: 'lead1', contactId: 'c1', status: 'nuevo', ticketNumber: 42,
    parentName: null, travelerName: null, travelerAge: null, schoolCode: null,
    destination: null, programInterest: null, leadType: null, assignedAdvisor: null,
    materialsSent: [], notes: null,
  };
  EXTRACT_RESULT = {};
  CHAT_REPLY = 'Con gusto te cuento más sobre eso 😊';
  officeHoursOverride = true;
}
resetState();

// ── Mocks de infraestructura ─────────────────────────────────────────────────
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', {
  // Espeja el comportamiento real de utils/phone.js en lo que importa aquí:
  // los mexicanos quedan +521…, y los internacionales conservan su lada (Miriana, +51).
  namedExports: {
    normalizePhone: (p) => {
      const d = String(p).replace(/\D/g, '');
      if (d.startsWith('52')) return `+${d}`;
      if (d.length === 10) return `+521${d}`;
      return `+${d}`;
    },
  },
});
mock.module('../src/core/whatsapp/parser.js', {
  namedExports: { extractMessageContent: (m) => ({ text: m.text?.body ?? '', type: 'text', mediaUrl: null }) },
});
mock.module('../src/core/ai/claude.js', {
  namedExports: {
    // Un solo mock cubre los dos usos: el extractor estructurado (systemPrompt
    // distintivo) y el respaldo conversacional de processMessageWithAI.
    chat: async (systemPrompt) => {
      if (systemPrompt.includes('extractor de datos')) return JSON.stringify(EXTRACT_RESULT);
      return CHAT_REPLY;
    },
  },
});
mock.module('../src/core/ai/conversation.js', {
  namedExports: { getHistory: async () => [], formatForClaude: (h) => h, addMessage: async () => {} },
});
mock.module('../src/core/database/redis.js', {
  defaultExport: { acquireContactLock: async () => true, releaseContactLock: async () => {} },
});
const PRISMA_QUERIES = []; // { op, where } — para verificar el alcance de PENDIENTES
mock.module('../src/core/database/client.js', {
  defaultExport: {
    travelLead: {
      groupBy: async () => [],                                  // carrusel → primera del track
      findMany: async ({ where }) => { PRISMA_QUERIES.push({ op: 'findMany', where }); return []; },
      findUnique: async ({ where }) => {
        PRISMA_QUERIES.push({ op: 'findUnique', where });
        return { ...DB_LEAD, ticketNumber: where.ticketNumber, assignedAdvisor: 'Camila Serafín', contact: { name: 'Laura', phone: '+5215500000000' } };
      },
    },
  },
});
mock.module('../src/core/whatsapp/client.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { SENT.push({ to, text }); },
    sendTemplateMessage: async (to, name, lang, components) => { TEMPLATES_SENT.push({ to, name, lang, params: components[0].parameters.map((p) => p.text) }); },
    sendMediaMessage: async (to, type, mediaId, caption, filename) => { MEDIA_SENT.push({ to, type, mediaId, filename }); },
    sendMediaMessageByUrl: async () => {},
  },
});
mock.module('../src/core/whatsapp/media-uploader.js', {
  namedExports: { getOrUploadMedia: async (id) => `media-${id}`, getMimeType: () => 'application/pdf' },
});
mock.module('../src/services/contact.service.js', {
  namedExports: {
    findOrCreate: async () => ({ id: 'c1', name: null, phone: '+5215500000000' }),
    update: async () => ({}),
  },
});
mock.module('../src/services/conversation.service.js', {
  namedExports: {
    findActiveOrCreate: async () => ({ ...DB_CONV }),
    update: async (_id, data) => { Object.assign(DB_CONV, data); return { ...DB_CONV }; },
    updateInterestScore: async (_id, score) => { DB_CONV.interestScore = score; },
  },
});
mock.module('../src/services/message.service.js', {
  namedExports: { createInbound: async () => ({}), createOutbound: async () => ({}) },
});
mock.module('../src/services/lead.service.js', {
  namedExports: {
    findOrCreateTravelLead: async () => ({ ...DB_LEAD }),
    updateTravelLead: async (_id, data) => { Object.assign(DB_LEAD, data); return { ...DB_LEAD }; },
    updateTravelLeadStatus: async (_id, status) => { DB_LEAD.status = status; return { ...DB_LEAD }; },
    getTravelLeadById: async () => ({ ...DB_LEAD }),
    addMaterialSent: async (_id, mid) => { DB_LEAD.materialsSent = [...DB_LEAD.materialsSent, mid]; },
  },
});
mock.module('../src/core/sheets/leads-sync.js', {
  namedExports: {
    syncLeadToSheet: async (lead) => { SHEET_SYNCS.push({ leadId: lead.id, schoolCode: lead.schoolCode }); },
  },
});
mock.module('../src/config/env.js', {
  namedExports: {
    env: {
      get TRAVEL_ADVISOR_TEMPLATE_NAME() { return 'nuevo_lead_travel'; },
      get TRAVEL_ADVISOR_TEMPLATE_LANG() { return 'es_MX'; },
      get TRAVEL_ADVISOR_TEMPLATE_V2() { return TEMPLATE_V2; },
      get TRAVEL_PRICES_SHEETS_ID() { return 'sheet-precios'; },
      get TRAVEL_ENROLLMENT_SHEETS_ID() { return 'sheet-inscritos'; },
      get SHEETS_CACHE_TTL_SECONDS() { return 3600; },
    },
  },
});
mock.module('../src/units/travel/prompts.js', { namedExports: { buildFullPrompt: () => 'system prompt de Miri (mock)' } });
mock.module('../src/units/travel/knowledge.js', { namedExports: { buildDynamicKnowledge: async () => '' } });
mock.module('../src/core/flow/office-hours.js', {
  namedExports: {
    isWithinOfficeHours: () => officeHoursOverride,
    OUT_OF_HOURS_NOTICE: 'las asesoras atienden de lunes a viernes de 9:00 a 18:00 (CDMX) y te contactarán en ese horario',
  },
});

// ── Hoja de precios (espeja la hoja viva 1Ggg, pestaña CONDICIONES POLÍTICAS) ─
// prices.js corre REAL contra este readRange falso.
const PRICE_ROWS = [
  ['CON PAGO COMPLETO DEL PROGRAMA HASTA EL 31 DE MARZO 2027', '', '', '', '', 'ABRIL - JUNIO (CON APARTADO DE 15K)'],
  ['INSTITUTO', 'DESTINO', 'MODALIDAD', 'PRECIO PROGRAMA', 'PRECIO VUELO', 'PRECIO PROGRAMA', 'PRECIO VUELO'],
  ['Colegio The Hills Institute', 'Londres', 'Homestay', '29990', '35000', '34990', '35000'],
  ['Global Skills', 'Londres', 'Homestay', '29990', '36000', '35000', '37000'],
  ['Colegio Columbia', 'Londres', 'Hotel', '85000', '', '85000'],
  ['Instituto Martha Christlieb', 'Dublín', 'Homestay', '-', '-', '34990', '35000'],
  ['Colegio Iberoamericano', 'Londres', 'Homestay', '-', '-', '34990', '35000'],
  ['Instituto Ramiro Kolbe', 'Dublín', 'Homestay', '29990', '35000', '34990', '35000'],
  // Segundo bloque: tier ÚNICO (columna H) — precio con vuelo incluido.
  ['', '', '', '', '', '', '', 'AGOSTO - SEPTIEMBRE 2027'],
  ['INSTITUTO', 'DESTINO', 'MODALIDAD', '', '', '', '', 'PRECIO PROGRAMA CON VUELO INCLUIDO'],
  ['Instituto Internacional', 'Londres', 'Winter Break', '', '', '', '', '69990'],
  ['UMIN', 'Dublín', 'Homestay', '', '', '', '', '69990'],
  ['UMIN', 'Londres', 'Winter Break', '', '', '', '', '69990'],
];
// readRange sirve a DOS hojas: la de precios y la de inscritos. Se distingue por
// spreadsheetId, igual que en producción.
mock.module('../src/core/sheets/client.js', {
  namedExports: {
    readRange: async (id, range) => {
      if (id === 'sheet-precios') return PRICE_ROWS;
      const tab = String(range).replace(/^'|'$/g, '');
      return ENROLL_ROWS[tab] || [];
    },
    getSpreadsheetMetadata: async () => ({ sheets: Object.keys(ENROLL_ROWS).map((title) => ({ title })) }),
  },
});

// ── Cache de Sheets: flujo + materiales + colegios ───────────────────────────
function row(id, texto, opciones = {}, orden = 1, material = '') {
  const d = [1, 2, 3, 4, 5].map((n) => opciones[n] || '');
  return {
    ID: id, Estado: 'Vigente', Texto: texto,
    'Destino opción 1': d[0], 'Destino opción 2': d[1], 'Destino opción 3': d[2],
    'Destino opción 4': d[3], 'Destino opción 5': d[4],
    Notas: '', Orden: String(orden), Material: material,
  };
}

const FULL_FLOW_ROWS = [
  row('bienvenida', '¡Hola! Soy Miri, del equipo de Oxford Education & Travel ✈️ Acompaño a las familias con nuestros programas de inmersión en inglés en el extranjero.\n\n¿En qué te puedo ayudar hoy?', {}, 1),
  row('filtro_previo', 'Para orientarte mejor, cuéntame: ¿ya estás inscrito en alguno de nuestros programas o buscas información?\n1.- Ya estoy inscrito\n2.- Busco información', { 1: 'ya_inscrito', 2: 'solicitud_datos' }, 2),
  row('ya_inscrito', '¡Con gusto te apoyamos con tu proceso! ¿Me compartes tu nombre y el colegio de tu hijo o hija?\n\nUna asesora revisa tu caso y te da seguimiento en breve 😊', {}, 3),
  row('solicitud_datos', '¡Perfecto! 😊 Para darte información precisa, ¿me compartes tu nombre, y el nombre y la edad de tu hijo o hija que viajaría?', {}, 4),
  row('solicitud_colegio', 'Gracias 🙌 ¿De qué colegio nos escribes?\n\nInstituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia, Instituto Martha Christlieb, Colegio Iberoamericano, Instituto Internacional o UMIN.\n\nSi tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.', {}, 5),
  row('menu_principal', 'Tenemos tres programas de inmersión en inglés para 2027. ¿Cuál te interesa conocer?\n1.- English 4 Life (Londres o Dublín, mayo)\n2.- Winter Break (Windsor, Inglaterra)\n3.- Rising Stars (programa con beca)\n4.- Prefiero hablar con una asesora', { 1: 'cat_e4l', 2: 'cat_wb', 3: 'cat_rs', 4: 'handoff_colegio' }, 6),
  row('cat_e4l', 'English 4 Life es un programa inmersivo de inglés: viajan a Londres o a Dublín del 21 al 30 de mayo de 2027, 9 días y 8 noches.\n\n¿Qué te gustaría ver?\n1.- La inversión\n2.- La presentación completa\n3.- Hablar con una asesora', { 1: 'e4l_precio_registrado', 2: 'e4l_material', 3: 'handoff_colegio' }, 7),
  row('e4l_precio_registrado', 'En {{colegio}} tienes dos opciones de inversión, siempre programa académico más vuelo redondo desde la Ciudad de México.\n\nSi liquidas todo antes del 31 de marzo de 2027, el programa queda en ${{prog_completo}} MXN y el vuelo en ${{vuelo_completo}} MXN.\n\nSi prefieres apartar tu lugar con $15,000, el programa queda en ${{prog_apartado}} MXN y el vuelo en ${{vuelo_apartado}} MXN, y de ahí armas un plan mensual desde tu inscripción hasta quedar liquidado, máximo 2 meses antes del viaje.\n\n¿Te conecto con una asesora para ver tu plan de pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 8),
  row('e4l_precio_columbia', 'En Colegio Columbia el programa es en modalidad hotel y la inversión es de $85,000 MXN, que ya incluye el vuelo redondo desde la Ciudad de México.\n\n¿Te conecto con una asesora para ver tu plan de pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 9),
  row('e4l_precio_otro', 'La inversión depende del convenio que tenemos con cada colegio, por eso prefiero que una asesora te dé el número exacto y tu plan de pagos 😊\n\n¿Te conecto con una asesora?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_familia', 2: 'util_menu' }, 10),
  row('e4l_precio_unico', 'En {{colegio}} la inversión es de ${{precio_unico}} MXN, con el vuelo redondo desde la Ciudad de México ya incluido.\n\nApartas tu lugar con $15,000 y de ahí armas un plan mensual desde tu inscripción hasta quedar liquidado, máximo 2 meses antes del viaje.\n\n¿Te conecto con una asesora para ver tu plan de pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 10),
  row('e4l_material', '¡Claro! Te comparto la presentación completa de English 4 Life 2027 📄\n\n¿Quieres que una asesora te contacte para resolver dudas?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 11),
  row('cat_wb', 'English 4 Life Winter Break es una experiencia académica de inmersión en marzo de 2027, con base en Windsor, Inglaterra.\n\n¿Qué te gustaría ver?\n1.- La inversión\n2.- La presentación completa\n3.- Hablar con una asesora', { 1: 'wb_precio', 2: 'wb_material', 3: 'handoff_colegio' }, 12),
  row('wb_precio', 'En Winter Break la inversión se arma por colegio, según cómo se integre el grupo, así que prefiero que una asesora te pase la propuesta exacta 😊\n\n¿Te conecto con ella?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 13),
  row('wb_material', 'Va, te comparto la presentación de Winter Break 📄\n\n¿Quieres que una asesora te contacte?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 14, 'WB_LONDRES_2027'),
  row('cat_rs', 'Rising Stars es un programa por invitación para los estudiantes con los mejores puntajes en la certificación Oxford TCC, con una beca del 50% 🌟\n\n¿tu hijo o hija presentó el Oxford TCC y quedó en los primeros lugares de su grupo?\n1.- Sí\n2.- No, o no estoy seguro', { 1: 'rs_elegible', 2: 'rs_no_elegible' }, 15),
  row('rs_elegible', '¡Qué gusto! 🌟 Rising Stars 2027 es en Windsor, Inglaterra, hospedados en Legoland Resort.\n\nTe conecto con una asesora del programa para confirmar la beca y darte los siguientes pasos 😊', {}, 16),
  row('rs_no_elegible', 'Sin problema 😊 La beca Rising Stars se otorga solo por desempeño en la certificación Oxford TCC.\n1.- Cuéntame de English 4 Life\n2.- Cuéntame de Winter Break\n3.- Prefiero hablar con una asesora', { 1: 'cat_e4l', 2: 'cat_wb', 3: 'handoff_familia' }, 17),
  row('ya_inscrito_sin_pago', '¡Gracias{{nombre}}! 🙌 Ya te tengo en el registro de English 4 Life.\n\nPara el siguiente paso de tu proceso te conecto con tu asesora, que revisa tu caso y te escribe en breve.', {}, 18),
  row('ya_inscrito_estatus', 'Esto es lo que tengo de {{alumno}} 📋\n\nTotal del programa: {{total_a_pagar}}\nLlevas pagado: {{llevan_pagado}}\nFalta por pagar: {{falta_por_pagar}}\n\n¿Te conecto con tu asesora para ver las fechas de tus siguientes pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 19),
  row('handoff_colegio', '¡Perfecto! 😊 Te conecto con {{asesora}}, nuestra asesora educativa.', {}, 18),
  row('handoff_familia', '¡Con gusto! 😊 Te conecto con {{asesora}}, que atiende a las familias.', {}, 19),
  row('handoff_rs', '¡Va! 🌟 Te conecto con {{asesora}}, asesora especializada en Rising Stars.', {}, 20),
  row('util_menu', 'Cuando quieras volver al menú principal, solo escribe "Menú" y te guío de nuevo 😊', {}, 21),
];

let flowRowsOverride = FULL_FLOW_ROWS;
mock.module('../src/core/sheets/cache.js', {
  namedExports: {
    getTravelFlowRows: async () => flowRowsOverride,
    getMaterial: async (id) => ({ ID: id, Nombre: `${id}.pdf`, Tipo: 'PDF', URL: 'https://drive.google.com/uc?id=x' }),
    getSchool: async (name) => ({ 'Nombre Colegio': name }),
    getAllSchools: async () => [],
    getConfig: async () => null,
    getActiveTrips: async () => [],
    getMaterials: async () => [],
    getActivities: async () => [],
    getInfoGeneral: async () => [],
    getFAQ: async () => [],
    getAdvisor: async () => null,
    getSchoolByName: async () => null,
    getPrice: async () => null,
  },
});

const { handleMessage } = await import('../src/units/travel/handler.js');
const { __resetCache } = await import('../src/units/travel/prices.js');
const { __resetCache: __resetEnroll } = await import('../src/units/travel/enrollment.js');
const { handleAdvisorCommand, isAdvisorPhone } = await import('../src/units/travel/advisor-commands.js');

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };
let FROM = '5215500000000';
const msg = (text) => ({ from: FROM, id: `wamid.${Math.random()}`, type: 'text', text: { body: text } });
const lastText = () => SENT[SENT.length - 1].text;
const allText = () => SENT.map((s) => s.text).join('\n---\n');

// Hoja de INSCRITOS de prueba: espeja la estructura real (registro + pestañas de
// pago con encabezados en POSICIONES distintas, que es lo que obliga a mapear por
// nombre de encabezado). Datos ficticios.
const REGISTRO = [
  ['Marca temporal', 'Nombre completo del estudiante (Nombre, segundo nombre, primer apellido, segundo apellido):', 'Edad:', 'Nombre del Colegio:', 'Nombre completo (Nombre, segundo nombre, primer apellido, segundo apellido):', 'Correo electrónico del Padre/Madre o Tutor:', 'Celular / Whatsapp:'],
  ['x', 'Diego Méndez Ruiz', '15', 'Colegio The Hills Institute', 'Laura Méndez Soto', 'l@x.com', '5533445566'],       // con pagos
  ['x', 'Sofía Ramos Lara', '14', 'Colegio Arista', 'Ana Ramos Díaz', 'a@x.com', '+52 55 7788 9900'],                  // sin fila de pagos
  ['x', 'Mateo Cruz Vega', '13', 'UTEC', 'Jorge Cruz Ríos', 'j@x.com', '55 1122 3344'],                                // dos hijos, mismo tel
  ['x', 'Emilia Cruz Vega', '16', 'UTEC', 'Jorge Cruz Ríos', 'j@x.com', '5511223344'],
  ['x', 'Pablo Duarte Nava', '15', 'Belfortt', 'Rosa Duarte Lima', 'r@x.com', '5599887766'],                           // duplicado en pagos → ambiguo
];
// Encabezados en columnas distintas a propósito (como las pestañas reales).
const PAGOS_A = [
  ['', 'CONTRATO', 'INSTITUCIÓN', 'ALUMNO', 'NIVEL', 'EDAD', 'GÉNERO', 'SEGURO', 'TOTAL A PAGAR', 'ABRIL', 'FECHA', 'LLEVAN PAGADO', 'FALTA POR PAGAR'],
  ['1', 'TRUE', 'The Hills', 'Diego Méndez Ruiz', '3', '15', 'M', 'SI', '64990', '15000', '01/04/2026', '15000', '49990'],
];
const PAGOS_B = [
  ['', 'INSTITUCIÓN', 'ALUMNO', 'EDAD', 'TOTAL A PAGAR', 'MARZO', 'FECHA', 'LLEVAN PAGADO', 'FALTA POR PAGAR'],
  ['1', 'Belfortt', 'Pablo Duarte Nava', '15', '64990', '15000', '01/03/2026', '15000', '49990'],
  ['2', 'Belfortt', 'Pablo Duarte Nava', '15', '64990', '20000', '01/03/2026', '20000', '44990'], // fila duplicada → ambiguo
  ['3', 'UTEC', 'Emilia Cruz Vega', '16', '64990', '30000', '01/03/2026', '30000', '34990'],
];
const ENROLL_FULL = {
  'REGISTRO GENERAL ': REGISTRO,
  'INSCRITOS LONDRES THE HILLS 64,990': PAGOS_A,
  'INSCRITOS LONDRES BELFORTT 64990': PAGOS_B,
};

function reset() {
  resetState();
  __resetCache();
  __resetEnroll();
  flowRowsOverride = FULL_FLOW_ROWS;
  ENROLL_ROWS = ENROLL_FULL;
  FROM = '5215500000000';
}

// ============================================================================
console.log('\n== A. Camino feliz: bienvenida → datos → colegio → menú → E4L → precio → handoff ==');
reset();

await handleMessage(msg('Hola'), 'pnid');
assert.strictEqual(SENT.length, 2, 'primer turno = bienvenida + filtro_previo');
assert.ok(SENT[0].text.includes('Soy Miri'), 'msg 1 = bienvenida verbatim');
assert.ok(SENT[1].text.includes('¿ya estás inscrito'), 'msg 2 = filtro_previo verbatim');
assert.strictEqual(DB_CONV.flowNode, 'filtro_previo', 'flowNode = filtro_previo');
ok('bienvenida + filtro_previo, flowNode persistido');

EXTRACT_RESULT = { parent_name: 'Laura Méndez', traveler_name: 'Diego Méndez', traveler_age: '15' };
await handleMessage(msg('2'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'solicitud_datos', 'opción 2 → solicitud_datos');
ok('menú numerado navega al nodo destino');

await handleMessage(msg('Soy Laura Méndez, mi hijo Diego tiene 15 años'), 'pnid');
assert.strictEqual(DB_LEAD.parentName, 'Laura Méndez', 'parentName capturado');
assert.strictEqual(DB_LEAD.travelerName, 'Diego Méndez', 'travelerName capturado');
assert.strictEqual(DB_LEAD.travelerAge, 15, 'travelerAge capturado como número');
assert.strictEqual(DB_CONV.flowNode, 'solicitud_colegio', 'pasa a solicitud_colegio');
ok('captura de datos vía executeCaptureData real (edad parseada a int)');

EXTRACT_RESULT = { school_code: 'The Hills' };
await handleMessage(msg('The Hills'), 'pnid');
assert.strictEqual(DB_LEAD.schoolCode, 'The Hills', 'schoolCode capturado');
assert.strictEqual(DB_LEAD.assignedAdvisor, null, 'capturar colegio NO asigna asesora (eso pasa al derivar)');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal', 'pasa al menú principal');
ok('captura de colegio sin asignar asesora en captura');

await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'cat_e4l', 'menú → cat_e4l');
ok('menú principal → English 4 Life');

await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_registrado', 'gate → nodo de colegio registrado');
assert.ok(lastText().includes('Colegio The Hills Institute'), '{{colegio}} sustituido con el nombre de la hoja');
assert.ok(lastText().includes('$29,990 MXN'), 'tier pago completo: programa');
assert.ok(lastText().includes('$35,000 MXN'), 'tier pago completo: vuelo');
assert.ok(lastText().includes('$34,990 MXN'), 'tier apartado: programa');
assert.ok(!lastText().includes('{{'), 'no quedan placeholders sin sustituir');
ok('precio con DOS tiers y placeholders sustituidos');

await handleMessage(msg('1'), 'pnid');
assert.ok(allText().includes('Te conecto con Alma Sotelo'), 'carrusel de colegios → Alma Sotelo');
assert.ok(lastText().includes('aquí sigo para cualquier otra duda'), 'handoff TIBIO: Miri sigue disponible');
assert.strictEqual(DB_LEAD.status, 'derivado_asesor', 'lead marcado derivado');
assert.strictEqual(DB_LEAD.assignedAdvisor, 'Alma Sotelo', 'asesora persistida en el lead');
assert.strictEqual(TEMPLATES_SENT.length, 1, 'asesora notificada por plantilla');
assert.strictEqual(DB_CONV.flowNode, 'llm_freeform', 'tras derivar queda en modo libre');
ok('handoff tibio real con carrusel de colegios + notificación');

// ============================================================================
console.log('\n== B. Opción inválida y "Menú" ==');
reset();
DB_CONV.flowNode = 'menu_principal';

await handleMessage(msg('9'), 'pnid');
assert.ok(lastText().includes('no es válida'), 'avisa opción inválida');
assert.ok(lastText().includes('1.- English 4 Life'), 're-muestra las opciones');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal', 'flowNode intacto');
ok('opción inválida re-muestra el nodo sin mover flowNode');

DB_CONV.flowNode = 'llm_freeform';
await handleMessage(msg('MENÚ'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal', '"MENÚ" resetea desde modo libre');
assert.ok(lastText().includes('Tenemos tres programas'), 'muestra el menú principal');
ok('"Menú" (mayúsculas/acentos) resetea desde modo libre');

// ============================================================================
console.log('\n== C. Gate de precio: Columbia / otro / tier vacío ==');
reset();
DB_LEAD.schoolCode = 'Colegio Columbia';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_columbia', 'Columbia → nodo plano');
assert.ok(lastText().includes('$85,000'), 'precio plano de Columbia');
assert.ok(!lastText().includes('31 de marzo'), 'Columbia NO muestra los dos tiers');
ok('gate: Columbia va al nodo plano sin tiers');

reset();
DB_LEAD.schoolCode = 'otro';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_otro', '"otro" → nodo sin cotización');
assert.ok(!/\$\d/.test(lastText()), 'no da ningún número de precio');
await handleMessage(msg('1'), 'pnid');
assert.ok(allText().includes('Te conecto con Camila Serafín'), 'familia → Camila Serafín');
ok('gate: colegio "otro" no cotiza y deriva a la asesora de familias');

reset();
DB_LEAD.schoolCode = 'Instituto Martha Christlieb';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_registrado', 'sigue siendo colegio registrado');
assert.ok(!lastText().includes('31 de marzo de 2027'), 'la línea del tier vacío se omite completa');
assert.ok(lastText().includes('$34,990 MXN'), 'muestra el tier de apartado');
assert.ok(!lastText().includes('$- '), 'nunca imprime un guion como precio');
assert.ok(!lastText().includes('{{'), 'sin placeholders colgados');
ok('regla de tier vacío: Martha Christlieb muestra solo el tier de apartado');

reset();
DB_LEAD.schoolCode = 'UMIN';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_otro', 'colegio sin tarifa → no cotizable');
ok('colegio del bloque sin precios cae a e4l_precio_otro');

// ============================================================================
console.log('\n== D. Envío de material por destino ==');
reset();
DB_LEAD.schoolCode = 'The Hills';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('2'), 'pnid');
assert.strictEqual(MEDIA_SENT.length, 1, 'se envió un archivo');
assert.strictEqual(MEDIA_SENT[0].mediaId, 'media-JDP_LONDRES_2027', 'colegio de Londres → PDF de Londres');
assert.strictEqual(DB_CONV.flowNode, 'e4l_material', 'permanece en el nodo de material');
ok('material E4L por destino del colegio (Londres)');

reset();
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('2'), 'pnid'); // sin colegio → pregunta destino
assert.strictEqual(MEDIA_SENT.length, 0, 'no envía nada sin destino');
assert.ok(lastText().includes('Londres o Dublín'), 'pregunta el destino primero');
assert.strictEqual(DB_CONV.flowNode, 'e4l_material_destino', 'queda en el nodo virtual de destino');
await handleMessage(msg('Dublín'), 'pnid');
assert.strictEqual(DB_LEAD.destination, 'Dublín', 'destino capturado en el lead');
assert.strictEqual(MEDIA_SENT[0].mediaId, 'media-JDP_DUBLIN_2027', 'manda el PDF de Dublín');
ok('sin colegio: pregunta destino y luego envía el PDF correcto');

reset();
DB_CONV.flowNode = 'cat_wb';
await handleMessage(msg('2'), 'pnid');
assert.strictEqual(MEDIA_SENT[0].mediaId, 'media-WB_LONDRES_2027', 'Winter Break usa la columna Material');
ok('material de Winter Break desde la columna Material del Sheet');

// ============================================================================
console.log('\n== E. Rising Stars: gate + carrusel propio ==');
reset();
DB_LEAD.schoolCode = 'The Hills';
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('3'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'cat_rs', 'menú → Rising Stars');
assert.ok(lastText().includes('presentó el Oxford TCC'), 'muestra el gate de elegibilidad');
await handleMessage(msg('1'), 'pnid');
assert.ok(allText().includes('Legoland Resort'), 'da los detalles del programa');
assert.ok(allText().includes('Te conecto con Miriana Galdos'), 'carrusel propio de Rising Stars');
assert.ok(!/\$\d/.test(allText()), 'Rising Stars nunca da precio');
assert.strictEqual(DB_LEAD.assignedAdvisor, 'Miriana Galdos', 'asesora de RS, no la de colegios');
ok('Rising Stars: gate → elegible → handoff al carrusel propio, sin precio');

reset();
DB_CONV.flowNode = 'cat_rs';
await handleMessage(msg('2'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'rs_no_elegible', 'no elegible → nodo alterno');
assert.ok(lastText().includes('English 4 Life'), 'ofrece las alternativas');
ok('Rising Stars: no elegible explica y ofrece alternativas');

// ============================================================================
console.log('\n== F. Handoff tibio: guard anti-redisparo ==');
reset();
DB_LEAD.schoolCode = 'The Hills';
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('4'), 'pnid');
assert.strictEqual(TEMPLATES_SENT.length, 1, 'primera derivación notifica');
const ticketsAfterFirst = TEMPLATES_SENT.length;

DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('3'), 'pnid'); // intenta derivar de nuevo
assert.strictEqual(TEMPLATES_SENT.length, ticketsAfterFirst, 'NO re-notifica ni duplica ticket');
assert.ok(lastText().includes('Alma Sotelo'), 'difiere a la asesora ya asignada');
ok('guard anti-redisparo: segunda derivación no duplica ticket');

// ============================================================================
console.log('\n== G. Respaldo LLM y fallback seguro ==');
reset();
DB_CONV.flowNode = 'menu_principal';
CHAT_REPLY = 'El viaje incluye seguro médico 😊';
await handleMessage(msg('¿y el seguro médico qué cubre?'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal', 'el respaldo LLM NO rompe flowNode');
assert.ok(allText().includes('El viaje incluye seguro médico'), 'respondió el LLM');
assert.ok(lastText().includes('Menú'), 'nudge para volver al menú');
ok('texto libre en un menú → respaldo LLM sin romper el estado + nudge');

reset();
flowRowsOverride = []; // Sheet caído
await handleMessage(msg('Hola'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, null, 'no toca flowNode');
assert.ok(allText().includes(CHAT_REPLY), 'cede el turno completo al camino LLM');
ok('fallback seguro: sin Sheet, el bot sigue vivo por el camino LLM');

// ============================================================================
console.log('\n== H. Sync a Sheets en turnos del flujo determinístico ==');
reset();
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(SHEET_SYNCS.length, 1, 'un turno puramente de menú también sincroniza');
ok('syncLeadToSheet corre en el camino determinístico (finally del handler)');


// ============================================================================
console.log('\n== I. Colegio Iberoamericano: en la lista y con tier vacío ==');
reset();
DB_CONV.flowNode = 'solicitud_datos';
EXTRACT_RESULT = { parent_name: 'Ana Ruiz' };
await handleMessage(msg('Soy Ana Ruiz'), 'pnid');
assert.ok(lastText().includes('Colegio Iberoamericano'), 'el nodo lista a Colegio Iberoamericano');
ok('solicitud_colegio incluye Colegio Iberoamericano');

reset();
DB_LEAD.schoolCode = 'Colegio Iberoamericano';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_registrado', 'Iberoamericano SÍ cotiza');
assert.ok(!lastText().includes('31 de marzo de 2027'), 'NO renderiza el tier de pago completo');
assert.ok(lastText().includes('$34,990 MXN'), 'sí muestra el tier de apartado');
assert.ok(!lastText().includes('$- '), 'nunca imprime un guion como precio');
assert.ok(!lastText().includes('{{'), 'sin placeholders colgados');
ok('Iberoamericano cae en la regla de tier vacío, como Martha Christlieb');

// ============================================================================
console.log('\n== J. Ticket de la asesora: formato limpio con campos de viaje ==');
reset();
DB_LEAD.schoolCode = 'The Hills';
DB_LEAD.parentName = 'Laura Méndez';
DB_LEAD.travelerName = 'Diego Méndez';
DB_LEAD.travelerAge = 15;
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('1'), 'pnid');                       // cat_e4l → fija el producto
assert.strictEqual(DB_LEAD.programInterest, 'English 4 Life', 'entrar a la categoría captura el producto');
await handleMessage(msg('3'), 'pnid');                       // → handoff
const p = TEMPLATES_SENT[0].params;
assert.strictEqual(TEMPLATES_SENT[0].name, 'nuevo_lead_travel', 'sin V2 sigue usando la plantilla aprobada');
assert.strictEqual(p.length, 9, 'la plantilla legacy conserva sus 9 variables');
assert.strictEqual(p[0], '42', 'ticket');
assert.strictEqual(p[1], 'Laura Méndez', 'papá/mamá');
assert.strictEqual(p[3], 'Diego Méndez, 15 años', 'viajero + edad');
assert.ok(p[4].includes('The Hills'), 'colegio');
assert.ok(p[8].includes('English 4 Life'), 'producto en el resumen');
ok('ticket con ticket/papá/viajero+edad/colegio/producto, sin romper la plantilla aprobada');

reset();
DB_LEAD.schoolCode = 'The Hills';
DB_LEAD.parentName = 'Laura Méndez';
DB_LEAD.travelerName = 'Diego Méndez';
DB_LEAD.travelerAge = 15;
DB_LEAD.destination = 'Londres';
DB_LEAD.programInterest = 'Winter Break';
TEMPLATE_V2 = 'nuevo_lead_travel_v2';
DB_CONV.flowNode = 'cat_wb';
await handleMessage(msg('3'), 'pnid');
const q = TEMPLATES_SENT[0].params;
assert.strictEqual(TEMPLATES_SENT[0].name, 'nuevo_lead_travel_v2', 'con V2 usa la plantilla nueva');
assert.deepStrictEqual(q, [
  '42', 'Laura Méndez', 'Diego Méndez, 15 años', 'Colegio The Hills Institute',
  'Winter Break', 'Londres', '55 0000 0000', q[7],
], 'los 8 campos limpios en orden');
assert.ok(q[7].length > 0, 'motivo presente');
TEMPLATE_V2 = '';
ok('plantilla V2: 8 campos limpios (ticket · papá · viajero · colegio · producto · destino · tel · motivo)');


// ============================================================================
console.log('\n== K. Comandos de asesora: sin rol admin (igual que Ori) ==');
reset();
PRISMA_QUERIES.length = 0;

// Alma (5651070832) pide PENDIENTES: debe filtrar SOLO por sus leads.
await handleAdvisorCommand({ from: '5215651070832', text: { body: 'PENDIENTES' } }, 'pnid');
const pendQuery = PRISMA_QUERIES.find((x) => x.op === 'findMany');
assert.deepStrictEqual(pendQuery.where, { status: 'derivado_asesor', assignedAdvisor: 'Alma Sotelo' },
  'PENDIENTES siempre filtra por la asesora que pregunta');
ok('PENDIENTES muestra solo los leads propios (sin vista de "todos")');

// El número que antes era admin ya no ve leads de otras: LISTO ajeno se rechaza.
SENT.length = 0;
await handleAdvisorCommand({ from: '5215651070832', text: { body: 'LISTO 42' } }, 'pnid');
assert.ok(lastText().includes('no está asignado a ti'), 'no puede cerrar un lead de otra asesora');
ok('LISTO sobre un lead ajeno se rechaza (ya no hay bypass de admin)');

// isAdvisorPhone sigue reconociendo a las 7 asesoras del registro
assert.ok(isAdvisorPhone('5215539771457'), 'Camila reconocida');
assert.ok(isAdvisorPhone('51988847322'), 'Miriana (internacional) reconocida');
assert.ok(!isAdvisorPhone('5215500000000'), 'un prospecto NO es asesora');
ok('registro único de asesoras reconoce a las 7, incluida la internacional');


// ============================================================================
console.log('\n== M. Rama "ya inscrito": 3 desenlaces + varios hijos + ambiguo ==');

// — Desenlace 1: teléfono NO registrado → capta como lead y deriva
reset();
FROM = '5219999999999';
DB_CONV.flowNode = 'filtro_previo';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito', 'teléfono desconocido → pide datos');
assert.ok(lastText().includes('¿Me compartes tu nombre'), 'muestra el nodo de captura');
assert.ok(!/\$\d/.test(allText()), 'no muestra ningún monto');
EXTRACT_RESULT = { parent_name: 'Ana Ruiz', school_code: 'Colegio Arista' };
await handleMessage(msg('Ana Ruiz, Colegio Arista'), 'pnid');
assert.strictEqual(DB_LEAD.parentName, 'Ana Ruiz', 'captura el nombre');
assert.strictEqual(DB_LEAD.status, 'derivado_asesor', 'deriva como lead');
assert.ok(TEMPLATES_SENT[0].params[7].startsWith('YA INSCRITO'), 'ticket marcado YA INSCRITO');
ok('desenlace 1: no registrado → capta, deriva, ticket YA INSCRITO, sin datos financieros');

// — Desenlace 2: registrado SIN fila de pagos → deriva con contexto, sin montos
reset();
FROM = '5215577889900';                                  // Sofía Ramos (registro, sin pagos)
DB_CONV.flowNode = 'filtro_previo';
await handleMessage(msg('1'), 'pnid');
assert.ok(allText().includes('Ya te tengo en el registro'), 'reconoce que está registrada');
assert.ok(!/\$\d/.test(allText()), 'NO muestra ningún monto');
assert.strictEqual(DB_LEAD.travelerName, 'Sofía Ramos Lara', 'guarda el alumno del registro');
assert.strictEqual(DB_LEAD.parentName, 'Ana Ramos Díaz', 'guarda al papá del registro');
assert.strictEqual(DB_LEAD.status, 'derivado_asesor', 'deriva');
assert.ok(TEMPLATES_SENT[0].params[7].includes('registrado sin pagos'), 'motivo explica el caso');
ok('desenlace 2: registrado sin pagos → contexto + deriva, cero montos');

// — Desenlace 3: con pagos → muestra los tres montos
reset();
FROM = '5215533445566';                                  // Diego Méndez
DB_CONV.flowNode = 'filtro_previo';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito_estatus', 'llega al nodo de estatus');
assert.ok(lastText().includes('Diego Méndez Ruiz'), 'nombra al alumno correcto');
assert.ok(lastText().includes('$64,990'), 'total a pagar');
assert.ok(lastText().includes('$15,000'), 'llevan pagado');
assert.ok(lastText().includes('$49,990'), 'falta por pagar');
assert.ok(!lastText().includes('{{'), 'sin placeholders colgados');
assert.ok(!/pr[oó]ximo pago|fecha l[ií]mite/i.test(lastText()), 'NO inventa próximo pago ni fecha límite');
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_LEAD.status, 'derivado_asesor', 'acepta conectar → deriva');
assert.ok(TEMPLATES_SENT[0].params[7].startsWith('YA INSCRITO'), 'ticket marcado YA INSCRITO');
ok('desenlace 3: con pagos → total/pagado/falta y ofrece conectar');

// — Varios hijos: pregunta cuál ANTES de mostrar nada
reset();
FROM = '5215511223344';                                  // Jorge Cruz: Mateo y Emilia
DB_CONV.flowNode = 'filtro_previo';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito_hijo', 'queda esperando la elección');
assert.ok(lastText().includes('Mateo Cruz Vega') && lastText().includes('Emilia Cruz Vega'), 'lista a los dos hijos');
assert.ok(!/\$\d/.test(allText()), 'todavía no muestra montos');
await handleMessage(msg('2'), 'pnid');                   // elige a Emilia (sí tiene pagos)
assert.ok(lastText().includes('Emilia Cruz Vega'), 'muestra el estatus del hijo elegido');
assert.ok(lastText().includes('$34,990'), 'falta por pagar de Emilia');
assert.ok(!lastText().includes('Mateo'), 'no filtra datos del otro hijo');
ok('varios hijos: pregunta cuál y solo muestra el elegido');

// — Match ambiguo: 2 filas de pago para el mismo alumno → NADA financiero
reset();
FROM = '5215599887766';                                  // Pablo Duarte: duplicado en pagos
DB_CONV.flowNode = 'filtro_previo';
await handleMessage(msg('1'), 'pnid');
assert.ok(!/\$\d/.test(allText()), 'match ambiguo → NO muestra ningún monto');
assert.ok(allText().includes('Ya te tengo en el registro'), 'responde sin exponer datos');
assert.strictEqual(DB_LEAD.status, 'derivado_asesor', 'deriva');
assert.ok(TEMPLATES_SENT[0].params[7].includes('duplicadas'), 'el motivo avisa a la asesora del duplicado');
ok('match ambiguo → deriva sin mostrar nada financiero');

// — La hoja de inscritos caída no rompe la rama
reset();
FROM = '5215533445566';
ENROLL_ROWS = {};                                        // sin pestañas
DB_CONV.flowNode = 'filtro_previo';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito', 'cae al camino de captura');
assert.ok(!/\$\d/.test(allText()), 'sin montos inventados');
ok('hoja de inscritos no disponible → se trata como no registrado, nunca inventa');


// ============================================================================
console.log('\n== N. Tier único (vuelo incluido) y colegios multi-producto ==');

// Instituto Internacional: solo tier único, y su producto es Winter Break.
reset();
DB_LEAD.schoolCode = 'Instituto Internacional';
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('2'), 'pnid');                      // cat_wb → fija el producto
assert.strictEqual(DB_LEAD.programInterest, 'Winter Break', 'producto capturado');
await handleMessage(msg('1'), 'pnid');                      // pide la inversión
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_unico', 'Winter Break CON tarifa propia sí cotiza');
assert.ok(lastText().includes('$69,990'), 'muestra el precio único');
assert.ok(lastText().includes('vuelo redondo desde la Ciudad de México ya incluido'), 'aclara que el vuelo va incluido');
assert.ok(!lastText().includes('31 de marzo'), 'no muestra el par programa+vuelo');
assert.ok(!lastText().includes('{{'), 'sin placeholders colgados');
ok('tier único: cotiza un solo precio con vuelo incluido');

// UMIN por English 4 Life → fila Dublín/Homestay
reset();
DB_LEAD.schoolCode = 'UMIN';
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('1'), 'pnid');                      // cat_e4l
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_unico', 'UMIN cotiza');
assert.ok(lastText().includes('$69,990'), 'precio único de UMIN');
ok('UMIN multi-producto: por English 4 Life resuelve su fila de Dublín');

// UMIN por Winter Break → fila Londres/Winter Break
reset();
DB_LEAD.schoolCode = 'UMIN';
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('2'), 'pnid');                      // cat_wb
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'e4l_precio_unico', 'también cotiza por Winter Break');
ok('UMIN multi-producto: por Winter Break resuelve su fila de Londres');

// Winter Break SIN tarifa propia sigue derivando, como hasta ahora.
reset();
DB_LEAD.schoolCode = 'The Hills';
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('2'), 'pnid');
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'wb_precio', 'sin tarifa de WB → nodo que deriva');
assert.ok(!/\$\d/.test(lastText()), 'no da número');
ok('Winter Break sin tarifa propia sigue derivando');

// El colegio nuevo aparece en la lista del nodo
reset();
DB_CONV.flowNode = 'solicitud_datos';
EXTRACT_RESULT = { parent_name: 'Ana Ruiz' };
await handleMessage(msg('Ana Ruiz'), 'pnid');
assert.ok(lastText().includes('Instituto Internacional') && lastText().includes('UMIN'), 'lista los colegios nuevos');
ok('solicitud_colegio incluye Instituto Internacional y UMIN');


// ============================================================================
console.log('\n== O. Regresión del chat real: elegir por texto, número en frase, nudge repetido ==');

// El usuario responde con la ETIQUETA, no con el número (caso del chat real).
reset();
DB_CONV.flowNode = 'filtro_previo';
await handleMessage(msg('Busco información'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'solicitud_datos', '"Busco información" elige la opción 2');
ok('el menú acepta el TEXTO de la opción, no solo el número');

reset();
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('winter break'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'cat_wb', 'match parcial por etiqueta');
ok('match por etiqueta parcial ("winter break" → Winter Break)');

// Un número DENTRO de una frase ya no se toma como elección.
reset();
DB_CONV.flowNode = 'filtro_previo';
CHAT_REPLY = 'Con gusto, ¿me confirmas el colegio?';
await handleMessage(msg('José Troncoso tiene 14 años'), 'pnid');
assert.ok(!allText().includes('no es válida'), 'NO responde "esa opción no es válida"');
assert.strictEqual(DB_CONV.flowNode, 'filtro_previo', 'flowNode intacto');
assert.ok(allText().includes(CHAT_REPLY), 'lo atiende el respaldo LLM');
ok('un número dentro de una frase ya no se interpreta como opción');

// El número solo sigue funcionando, con o sin puntuación.
for (const t of ['2', '2.', 'opción 2']) {
  reset();
  DB_CONV.flowNode = 'filtro_previo';
  await handleMessage(msg(t), 'pnid');
  assert.strictEqual(DB_CONV.flowNode, 'solicitud_datos', `"${t}" sigue eligiendo la opción 2`);
}
ok('el número suelto sigue funcionando ("2", "2.", "opción 2")');

// El recordatorio de "Menú" sale UNA vez por nodo, no en cada mensaje.
reset();
DB_CONV.flowNode = 'filtro_previo';
CHAT_REPLY = 'Claro que sí 😊';
await handleMessage(msg('tengo una duda'), 'pnid');
const nudges1 = SENT.filter((x) => x.text.includes('Escribe *Menú*')).length;
await handleMessage(msg('otra duda más'), 'pnid');
await handleMessage(msg('y una tercera'), 'pnid');
const nudgesTotal = SENT.filter((x) => x.text.includes('Escribe *Menú*')).length;
assert.strictEqual(nudges1, 1, 'el primer mensaje sin match sí lleva recordatorio');
assert.strictEqual(nudgesTotal, 1, 'los siguientes YA NO lo repiten');
ok('el recordatorio de "Menú" sale una sola vez por nodo');


// El falso positivo que encontré revisando el diff: "sí" contiene las letras de
// "ri(si)ng stars" y mandaba al prospecto a Rising Stars por escribir que sí.
reset();
DB_CONV.flowNode = 'menu_principal';
CHAT_REPLY = 'Claro, ¿qué programa te interesa?';
await handleMessage(msg('sí'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal', '"sí" NO elige Rising Stars por contener "si"');
ok('el match por etiqueta exige palabras completas (no "sí" ⊂ "rising")');

// Pero en un menú sí/no, "sí" y "no" sí eligen — incluidas las etiquetas con coma.
reset();
DB_LEAD.schoolCode = 'The Hills';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('1'), 'pnid');                    // → precio
await handleMessage(msg('Sí, por favor'), 'pnid');        // etiqueta literal con coma
assert.strictEqual(DB_LEAD.status, 'derivado_asesor', '"Sí, por favor" acepta y deriva');
ok('las etiquetas con puntuación ("Sí, por favor") casan igual');

reset();
DB_LEAD.schoolCode = 'The Hills';
DB_CONV.flowNode = 'cat_e4l';
await handleMessage(msg('1'), 'pnid');
await handleMessage(msg('todavía no'), 'pnid');
assert.strictEqual(DB_LEAD.status, 'nuevo', '"todavía no" NO deriva');
ok('"todavía no" elige la opción 2 y no deriva');

console.log(`\n✅ ${pass} escenarios en verde\n`);
