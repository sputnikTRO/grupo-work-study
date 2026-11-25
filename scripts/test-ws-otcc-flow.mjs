/**
 * W&S OTCC — filtro por intención y modo W&S contra el handler REAL de Ox.
 * Run: node --experimental-test-module-mocks scripts/test-ws-otcc-flow.mjs
 *
 * Cubre los tres casos pedidos ("pregunta OTCC → sí W&S", "→ no", "ya respondió
 * → no se repite"), el caso de borde de "2 Quiero información", W&S explícito,
 * filtro_previo → 1, no estoy seguro, interruptor apagado, aislamiento de
 * prompts y la canalización completa hasta crear el caso.
 */
import assert from 'node:assert';
import { mock } from 'node:test';

const ENV = {
      OXED_WS_ENABLED: true,
      OXED_WS_SUPPORT_CONTACTS: 'Karen Méndez|5528450167; Jorge Gil|9381091603',
      OXED_WS_SLA_MINUTES: 30,
      OXED_WS_SLA_HOURS: '1-5 08:00-16:00',
      OXED_WS_TEMPLATE: 'caso_ws_ox',
      OXED_WS_TEMPLATE_IMG: '',
      OXED_WS_TEMPLATE_LANG: 'es_MX',
      OXED_SHEETS_ID: 'sheet-test',
      OXED_FOREIGN_LEAD_FALLBACK: 'meeting_link',
      OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford',
      OXED_ADVISOR_TEMPLATE_LANG: 'es_MX',
      // Credenciales de TRAVEL: el handoff cruzado notifica a la asesora de
      // viajes con el número y la plantilla de esa unidad, no con los de Ori.
      WA_PHONE_NUMBER_ID_TRAVEL: 'pnid-travel',
      TRAVEL_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_travel',
      TRAVEL_ADVISOR_TEMPLATE_LANG: 'es_MX',
};


// ── Estado fake compartido (reseteable entre escenarios) ───────────────────
const SENT = [];           // { to, text }
const TEMPLATES_SENT = []; // { to, name, lang, params }
let DB_CONV;
let DB_LEAD;
let officeHoursOverride = true;
let EXTRACT_RESULT = {};
let DB_TRAVEL_LEAD;              // lead de la unidad Travel (handoff cruzado)
const TRAVEL_TEMPLATES = [];     // plantillas enviadas a la asesora de viajes    // lo que "extrae" el LLM en el próximo turno de solicitud_datos/ya_inscrito_stub
let CHAT_REPLY = 'Claro, con gusto te cuento más sobre eso 😊'; // respuesta conversacional del respaldo LLM
let ON_CHAT = null;
const LLM_CALLS = [];        // { system, user } de cada llamada conversacional
const CASES = [];            // support_cases en memoria
const ATTS = [];             // case_attachments en memoria
const NOTIFS = [];           // advisor_notifications
const IMAGES_SENT = []; // efecto opcional DURANTE la llamada al LLM (simula otro paso que escribe en el turno)

function resetState() {
  SENT.length = 0;
  TEMPLATES_SENT.length = 0;
  DB_CONV = { id: 'conv1', status: 'active', flowNode: null, metadata: {} };
  LLM_CALLS.length = 0; CASES.length = 0; ATTS.length = 0; NOTIFS.length = 0; IMAGES_SENT.length = 0;
  ENV.OXED_WS_ENABLED = true;
  DB_LEAD = {
    id: 'lead1', contactId: 'c1', temperature: 'nuevo', status: 'nuevo',
    tags: [], notes: null, assignedAdvisor: null, zoneKey: undefined,
    state: null, municipality: null, fullName: null, institutionName: null,
    primaryProduct: null, primaryProductLabel: null, leadType: null, role: null,
  };
  officeHoursOverride = true;
  EXTRACT_RESULT = {};
  DB_TRAVEL_LEAD = {
    id: 'tlead1', contactId: 'c1', status: 'nuevo', ticketNumber: 77,
    parentName: null, schoolCode: null, programInterest: null, destination: null,
    leadType: null, assignedAdvisor: null, notes: null, travelerName: null, travelerAge: null,
  };
  TRAVEL_TEMPLATES.length = 0;
  CHAT_REPLY = 'Claro, con gusto te cuento más sobre eso 😊';
  ON_CHAT = null;
}
resetState();

// ── Mocks de infraestructura ─────────────────────────────────────────────────
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/core/whatsapp/parser.js', {
  namedExports: { extractMessageContent: (m) => (m.type === 'image' ? { text: m.image?.caption || '[Imagen]', type: 'image', mediaUrl: m.image?.id } : { text: m.text?.body ?? '', type: 'text', mediaUrl: null }) },
});
mock.module('../src/core/ai/claude.js', {
  namedExports: {
    // Un solo mock cubre los DOS usos del LLM: el extractor estructurado
    // (solicitud_datos/ya_inscrito_stub, systemPrompt distintivo) y el respaldo
    // conversacional (processWithAI, prompt normal de Ori).
    chat: async function (systemPrompt) {
      if (systemPrompt.includes('extractor de datos')) return JSON.stringify(EXTRACT_RESULT);
      LLM_CALLS.push({ system: systemPrompt, user: arguments[2] });
      if (ON_CHAT) ON_CHAT();
      return CHAT_REPLY;
    },
  },
});
mock.module('../src/config/env.js', { namedExports: { env: ENV } });
mock.module('../src/core/database/client.js', {
  // travelLead lo consulta pickAdvisor de Miri en el handoff cruzado.
  defaultExport: {
    oxfordLead: { groupBy: async () => [] },   // round-robin → primer asesor de la zona
    travelLead: { groupBy: async () => [] },   // carrusel de viajes → primera del track
    supportCase: {
      create: async ({ data }) => { const c = { id: `case${CASES.length + 1}`, caseNumber: CASES.length + 1, attempts: [], triedKeys: [], createdAt: new Date(), ...data }; CASES.push(c); return { ...c }; },
      findUnique: async ({ where }) => { const c = CASES.find((x) => x.id === where.id || x.caseNumber === where.caseNumber); return c ? { ...c } : null; },
      findFirst: async ({ where }) => CASES.filter((x) => x.conversationId === where.conversationId && x.status !== 'resuelto').at(-1) || null,
      findMany: async () => [],
      updateMany: async ({ where, data }) => { const c = CASES.find((x) => x.id === where.id && (!where.status || x.status === where.status)); if (!c) return { count: 0 }; Object.assign(c, data); return { count: 1 }; },
      update: async ({ where, data }) => { const c = CASES.find((x) => x.id === where.id); Object.assign(c, data); return { ...c }; },
    },
    caseAttachment: {
      create: async ({ data }) => { const a = { id: `att${ATTS.length + 1}`, forwardedTo: [], ...data }; ATTS.push(a); return a; },
      updateMany: async ({ where, data }) => { let n = 0; for (const a of ATTS) if (a.conversationId === where.conversationId && a.caseId == null) { Object.assign(a, data); n++; } return { count: n }; },
      findMany: async ({ where }) => ATTS.filter((a) => a.caseId === where.caseId),
      count: async ({ where }) => ATTS.filter((a) => a.caseId === where.caseId).length,
      update: async () => ({}),
    },
    advisorNotification: { create: async ({ data }) => { NOTIFS.push(data); return data; } },
    advisorCommand: { findFirst: async () => null, create: async ({ data }) => data },
  },
});
mock.module('../src/services/contact.service.js', {
  namedExports: { findOrCreate: async () => ({ id: 'c1', name: null, phone: '+5215500000000' }) },
});
mock.module('../src/services/conversation.service.js', {
  namedExports: {
    findActiveOrCreate: async () => ({ ...DB_CONV }),
    mergeMetadata: async (_id, patch) => { DB_CONV.metadata = { ...(DB_CONV.metadata || {}), ...patch }; return { ...DB_CONV.metadata }; },
    update: async (_id, data) => { Object.assign(DB_CONV, data); return { ...DB_CONV }; },
  },
});
mock.module('../src/services/message.service.js', {
  namedExports: { createInbound: async () => ({}), createOutbound: async () => ({}) },
});
mock.module('../src/units/oxford-education/lead.service.js', {
  namedExports: {
    findOrCreateOxfordLead: async () => ({ ...DB_LEAD }),
    updateOxfordLead: async (_id, data) => { Object.assign(DB_LEAD, data); return { ...DB_LEAD }; },
    getOxfordLeadById: async () => ({ ...DB_LEAD }),
  },
});
mock.module('../src/units/oxford-education/store.js', {
  namedExports: {
    acquireContactLock: async () => true,
    releaseContactLock: async () => {},
    getHistory: async () => [],
    formatForClaude: (h) => h,
    addMessage: async () => {},
  },
});
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { SENT.push({ to, text }); },
    sendTemplateMessage: async (to, name, lang, params) => { TEMPLATES_SENT.push({ to, name, lang, params }); return { messages: [{ id: `wamid.t${TEMPLATES_SENT.length}` }] }; },
    sendTemplateWithImage: async (to, name, lang, mediaId, params) => { TEMPLATES_SENT.push({ to, name, lang, params, mediaId }); return { messages: [{ id: 'wamid.img' }] }; },
    sendImageMessage: async (to, mediaId) => { IMAGES_SENT.push({ to, mediaId }); },
    downloadMedia: async () => ({ buffer: Buffer.from('png-bytes'), mimeType: 'image/png' }),
    uploadMedia: async () => 'media-up-1',
    markMessageAsRead: async () => {},
  },
});
mock.module('../src/units/oxford-education/prompts.js', {
  namedExports: {
    buildFullPrompt: () => 'system prompt de Ori (mock)',
    HANDOFF_MEETING_URL: 'https://meetings.hubspot.com/camila-serafin-jimenez/',
  },
});
mock.module('../src/units/oxford-education/knowledge.js', {
  namedExports: { buildOxfordKnowledge: async () => null, buildFlowKnowledge: async () => null },
});
mock.module('../src/units/oxford-education/sheets-sync.js', {
  namedExports: { syncOxfordLeadToSheet: async () => {}, deriveTemperature: () => 'warm' },
});
mock.module('../src/units/oxford-education/office-hours.js', {
  namedExports: {
    isWithinOfficeHours: () => officeHoursOverride,
    OUT_OF_HOURS_NOTICE: 'las asesoras atienden de lunes a viernes de 9:00 a 18:00 (CDMX) y te contactarán en ese horario',
  },
});

// ── Grafo "Flujo Ori" REALISTA (mismos textos verbatim del seed) ───────────
function row(id, texto, opciones = {}, orden = 1) {
  const destinos = [1, 2, 3, 4, 5].map((n) => opciones[n] || '');
  return {
    ID: id, Estado: 'Vigente', Texto: texto,
    'Destino opción 1': destinos[0], 'Destino opción 2': destinos[1], 'Destino opción 3': destinos[2],
    'Destino opción 4': destinos[3], 'Destino opción 5': destinos[4],
    Notas: '', Orden: String(orden),
  };
}

const FULL_FLOW_ROWS = [
  row('bienvenida',
    '¡Hola! Gracias por escribir a Oxford Education. Nuestro horario de atención es de lunes a viernes de 9:00 a 18:00 h. ¿En qué puedo apoyarte hoy?',
    {}, 1),
  row('filtro_previo',
    'Para dirigir tu solicitud, cuéntame: ¿ya eres parte de Oxford Education o buscas información?\n1.- Ya estoy inscrito / soy cliente\n2.- Quiero información',
    { 1: 'ya_inscrito_stub', 2: 'solicitud_datos' }, 2),
  row('ya_inscrito_stub',
    '¡Con gusto te apoyamos con tu proceso! ¿Me compartes tu nombre y el colegio o institución? Una asesora revisará tu caso y te dará seguimiento.',
    {}, 3),
  row('solicitud_datos',
    'Para ayudarte mejor, ¿me compartes por favor:\n- Tu nombre y puesto (en caso de pertenecer a una institución)\n- Nombre de tu colegio o institución\n- Ciudad y estado',
    {}, 4),
  row('menu_principal',
    'Oxford Education es una EdTech con más de 10 años de experiencia que acompaña a colegios con certificaciones de idiomas, plataformas digitales, programas STEAM y experiencias educativas internacionales, siempre alineadas a estándares internacionales. ¿Qué área te interesa conocer?\n1.- Certificaciones\n2.- Plataformas para aprendizaje del inglés\n3.- Plataformas para el aula\n4.- Experiencias internacionales\n5.- Exámenes diagnósticos de inglés',
    { 1: 'cat_1', 2: 'cat_2', 3: 'cat_3', 4: 'cat_4', 5: 'cat_5' }, 5),
  row('cat_1',
    'Contamos con certificaciones y evaluaciones de inglés alineadas al MCER y con respaldo de la Association of Language Testers in Europe, para distintos niveles y edades. ¿Tu interés principal es:\n1.- Oxford TCC Kids (niños de 7 a 12 años)\n2.- Oxford TCC (A1-C2)\n3.- Oxford ETC (Certificación para docentes)\n4.- No estoy seguro',
    { 1: 'n_1_1', 2: 'n_1_2', 3: 'n_1_3', 4: 'n_1_4' }, 6),
  row('n_1_1',
    'Oxford TCC Kids es la certificación para niños de 7 a 12 años, que mide las habilidades de inglés integralmente y está alineada al MCER. ¿Quieres recibir más información o agendar una llamada con un asesor?',
    {}, 7),
  row('n_1_2',
    'El Oxford TCC evalúa el dominio del inglés como lengua extranjera, reconocido internacionalmente y alineado al MCER. ¿Deseas detalles sobre niveles, proceso o costos?',
    {}, 8),
  row('n_1_3',
    'Oxford ETC certifica competencias didácticas del profesorado en enseñanza de inglés. ¿Te gustaría conocer el contenido o modalidades del curso?',
    {}, 9),
  // Experiencias internacionales: las atiende el equipo de TRAVEL, no el de Oxford.
  row('cat_4', 'Experiencias internacionales. Selecciona la que te interesa:\n1.- English Life\n2.- Rising STARS\n3.- Global Insights',
    { 1: 'n_4_1', 2: 'n_4_2', 3: 'n_4_3' }, 30),
  row('n_4_1', 'English Life ofrece inmersión total en inglés en Londres o Dublín. ¿Te interesaría hablar con un asesor?', {}, 31),
  row('n_4_2', 'Rising STARS es un programa exclusivo en Inglaterra para estudiantes de alto rendimiento. ¿Te interesaría hablar con un asesor?', {}, 32),
  row('n_4_3', 'Global Insights es un viaje académico para tomadores de decisiones educativas. ¿Te interesaría hablar con un asesor?', {}, 33),
];

let flowRowsOverride = FULL_FLOW_ROWS;
// ── Lado TRAVEL: el handoff cruzado crea el lead allá y notifica con SU
// plantilla y SU phone_number_id (por eso el cliente de core, no el de Ori).
mock.module('../src/services/lead.service.js', {
  namedExports: {
    findOrCreateTravelLead: async () => ({ ...DB_TRAVEL_LEAD }),
    updateTravelLead: async (_id, d) => { Object.assign(DB_TRAVEL_LEAD, d); return { ...DB_TRAVEL_LEAD }; },
    updateTravelLeadStatus: async (_id, st) => { DB_TRAVEL_LEAD.status = st; return { ...DB_TRAVEL_LEAD }; },
    getTravelLeadById: async () => ({ ...DB_TRAVEL_LEAD }),
    addMaterialSent: async () => {},
  },
});
mock.module('../src/core/whatsapp/client.js', {
  namedExports: {
    sendTextMessage: async () => {},
    sendTemplateMessage: async (to, name, lang, components, pnid) =>
      { TRAVEL_TEMPLATES.push({ to, name, pnid, params: (components?.[0]?.parameters || []).map((x) => x.text) }); },
    sendMediaMessage: async () => {},
    sendMediaMessageByUrl: async () => {},
  },
});
mock.module('../src/core/sheets/leads-sync.js', { namedExports: { syncLeadToSheet: async () => {} } });
// buildTicketFields (travel/actions.js) busca el nombre canónico del colegio en
// la hoja VIVA de precios; sin mock haría una llamada real a Google y la
// notificación se perdería en silencio (sendAdvisorNotification traga su error).
mock.module('../src/units/travel/prices.js', {
  namedExports: {
    findSchoolPrices: async () => null,
    isQuotable: () => false, isSinglePrice: () => false,
    isAllInclusiveHotel: () => false, isWinterBreakRow: () => false,
  },
});

mock.module('../src/core/sheets/cache.js', {
  namedExports: {
    getOxfordFlowRows: async () => flowRowsOverride,
    // getSchool lo usa buildTicketFields de travel/actions.js en el handoff
    // cruzado. Sin él, la notificación reventaba y se perdía en silencio: su
    // catch traga el error para no tumbar el handoff.
    getSchool: async () => null,
    getWsOtccFAQ: async () => [],   // pestaña aún no sembrada → el modo W&S usa docs/kb-ws-otcc.md
  },
});
const SHEET_ROWS = [];
mock.module('../src/units/oxford-education/ws/cases-sheet.js', {
  namedExports: { syncCaseToSheet: async (c) => { SHEET_ROWS.push(c.caseNumber); } },
});


const { handleMessage } = await import('../src/units/oxford-education/handler.js');
const { WS_TEXTS } = await import('../src/units/oxford-education/ws/texts.js');

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };
const msg = (text) => ({ from: '5215500000000', id: `wamid.${Math.random()}`, type: 'text', text: { body: text } });
const img = () => ({ from: '5215500000000', id: `wamid.${Math.random()}`, type: 'image', image: { id: 'meta-media-1' } });
const texts = () => SENT.map((m) => m.text);
const wsCalls = () => LLM_CALLS.filter((c) => c.system.includes('BASE W&S OTCC'));
const comCalls = () => LLM_CALLS.filter((c) => !c.system.includes('BASE W&S OTCC'));
const send = async (t) => { SENT.length = 0; await handleMessage(typeof t === 'string' ? msg(t) : t, 'pnid'); };
const isFiltro = (t) => t.includes('¿Formas parte de algún programa, como Work and Study?');

// ============================================================================
console.log('\n== 1. Pregunta OTCC → sí, Work and Study ==');
resetState(); DB_CONV.flowNode = 'llm_freeform';
CHAT_REPLY = 'Tu código llega por correo desde karen.mendez@oxfordeducationlit.org 😊';
await send('¿cuándo me llega el código del OTCC?');
assert.strictEqual(SENT.length, 1); assert.ok(isFiltro(SENT[0].text), 'sale SOLO el filtro');
assert.strictEqual(LLM_CALLS.length, 0, 'no se llama al LLM todavía');
assert.strictEqual(DB_CONV.flowNode, 'ws_filtro');
assert.deepStrictEqual(DB_CONV.metadata.wsFiltro.pendiente, { texto: '¿cuándo me llega el código del OTCC?', volverA: 'llm_freeform' });
await send('1');
const f1 = DB_CONV.metadata.wsFiltro;
assert.strictEqual(f1.respuesta, 'ws'); assert.strictEqual(f1.via, 'texto'); assert.strictEqual(f1.pendiente, undefined);
assert.strictEqual(DB_CONV.metadata.programa, 'ws'); assert.strictEqual(DB_CONV.metadata.tema, 'otcc');
assert.strictEqual(wsCalls().length, 1, 'contesta el LLM con el prompt W&S'); assert.strictEqual(comCalls().length, 0);
assert.strictEqual(wsCalls()[0].user, '¿cuándo me llega el código del OTCC?', 'contesta la pregunta ORIGINAL');
assert.ok(!wsCalls()[0].system.includes('system prompt de Ori'), 'sin prompt comercial');
assert.ok(wsCalls()[0].system.includes('¿De qué correo recibo mis códigos y fechas?'), 'trae la base (respaldo del documento)');
assert.ok(texts().includes(CHAT_REPLY) && !texts().includes(WS_TEXTS.ws_otcc), 'responde sin el texto de entrada');
assert.ok(texts().join(' ').includes('karen.mendez@oxfordeducationlit.org'), 'el correo de la base se conserva');
assert.strictEqual(DB_CONV.flowNode, 'ws_otcc');
ok('1a texto libre → filtro → "1" → modo W&S contesta la pregunta original');

resetState(); DB_CONV.flowNode = 'cat_1';
await send('2');
assert.ok(isFiltro(SENT[0].text) && !texts().join().includes('El Oxford TCC evalúa'), 'filtro antes de la ficha n_1_2');
await send('sí, soy de work and study');
assert.strictEqual(DB_CONV.metadata.wsFiltro.via, 'menu'); assert.strictEqual(DB_CONV.metadata.wsFiltro.respuesta, 'ws');
assert.deepStrictEqual(texts(), [WS_TEXTS.ws_otcc]); assert.strictEqual(DB_CONV.flowNode, 'ws_otcc');
ok('1b menú Oxford TCC → filtro → respuesta escrita "sí" → texto de entrada al modo');

resetState();
CHAT_REPLY = 'Los resultados llegan por correo al terminar cada etapa.';
await send('hola, tengo una duda con mi certificación de inglés');
assert.strictEqual(SENT.length, 2); assert.ok(SENT[0].text.includes('Gracias por escribir'), 'bienvenida'); assert.ok(isFiltro(SENT[1].text), 'y el filtro (no filtro_previo)');
await send('1');
assert.strictEqual(wsCalls().at(-1).user, 'hola, tengo una duda con mi certificación de inglés');
ok('1c primer mensaje con intención → bienvenida + filtro → "1" → W&S');

// ============================================================================
console.log('\n== 2. Pregunta OTCC → no ==');
resetState(); DB_CONV.flowNode = 'llm_freeform';
CHAT_REPLY = 'El Oxford TCC tiene distintas modalidades 😊';
await send('¿cuánto cuesta el Oxford TCC?');
assert.ok(isFiltro(SENT[0].text));
await send('2');
assert.strictEqual(DB_CONV.metadata.wsFiltro.respuesta, 'no'); assert.strictEqual(DB_CONV.metadata.programa, undefined);
assert.strictEqual(DB_CONV.flowNode, 'llm_freeform');
assert.strictEqual(comCalls().length, 1); assert.strictEqual(wsCalls().length, 0);
assert.strictEqual(comCalls()[0].user, '¿cuánto cuesta el Oxford TCC?'); assert.ok(!comCalls()[0].system.includes('BASE W&S'));
assert.strictEqual(CASES.length, 0); assert.ok(!SENT.some((m) => /5528450167|9381091603/.test(m.to)), 'nada a Karen ni Jorge');
ok('2a texto libre → "2" → LLM comercial contesta la pregunta original, sin base W&S');

resetState(); DB_CONV.flowNode = 'cat_1';
await send('2'); await send('no');
assert.ok(SENT[0].text.includes('El Oxford TCC evalúa'), 'ficha n_1_2 tal cual');
assert.strictEqual(DB_CONV.flowNode, 'n_1_2'); assert.strictEqual(DB_LEAD.primaryProduct, 'oxford_tcc');
ok('2b menú → "no" → n_1_2 y producto capturado como hoy');

resetState(); DB_CONV.flowNode = 'menu_principal';
CHAT_REPLY = 'Sí, es reconocida internacionalmente.';
await send('¿la certificación Oxford tiene validez oficial?');
assert.ok(isFiltro(SENT[0].text));
await send('otro programa');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal');
assert.ok(texts().includes(CHAT_REPLY) && texts().some((t) => t.includes('Menú')), 'LLM comercial + recordatorio de Menú, igual que hoy');
assert.strictEqual(DB_CONV.metadata.wsFiltro.respuesta, 'no'); assert.strictEqual(DB_CONV.metadata.nudgedNode, 'menu_principal');
ok('2c a mitad del menú → "otro programa" → vuelve a su nodo; wsFiltro y nudgedNode conviven en metadata');

// ============================================================================
console.log('\n== 3. Ya respondió el filtro → no se repite ==');
resetState(); DB_CONV.flowNode = 'llm_freeform'; DB_CONV.metadata = { wsFiltro: { respuesta: 'no' } };
await send('¿y el certificado de inglés de Oxford llega físico?');
assert.ok(!texts().some(isFiltro)); assert.strictEqual(comCalls().length, 1); assert.strictEqual(DB_CONV.flowNode, 'llm_freeform');
ok('3a respondió "no" → no se pregunta, contesta el comercial');

resetState(); DB_CONV.flowNode = 'menu_principal'; DB_CONV.metadata = { wsFiltro: { respuesta: 'ws' }, programa: 'ws', tema: 'otcc' };
await send('otra duda del OTCC: ¿cuánto dura el speaking?');
assert.ok(!texts().some(isFiltro)); assert.strictEqual(wsCalls().length, 1); assert.strictEqual(DB_CONV.flowNode, 'ws_otcc');
ok('3b respondió "sí" → vuelve al modo W&S sin preguntar');

resetState(); DB_CONV.flowNode = 'cat_1'; DB_CONV.metadata = { wsFiltro: { respuesta: 'no' } };
await send('2');
assert.ok(SENT[0].text.includes('El Oxford TCC evalúa')); assert.strictEqual(DB_CONV.flowNode, 'n_1_2');
ok('3c menú después de "no" → n_1_2 directo');

resetState(); DB_CONV.flowNode = 'llm_freeform';
await send('¿qué es el OTCC?');
await send('Menú');
assert.ok(SENT[0].text.includes('¿Qué área te interesa conocer?'), 'sale el menú');
assert.strictEqual(DB_CONV.metadata.wsFiltro.respuesta, 'no', '"Menú" en vez de contestar = "no"');
await send('¿qué es el OTCC?');
assert.ok(!texts().some(isFiltro));
ok('3e escapó con "Menú" → cuenta como "no" y no se vuelve a preguntar');

resetState(); DB_CONV.flowNode = 'llm_freeform'; DB_CONV.metadata = {};  // conversación NUEVA del mismo contacto
await send('¿qué es el OTCC?');
assert.ok(isFiltro(SENT[0].text));
ok('3f conversación nueva → sí se vuelve a preguntar (una vez por conversación)');

// ============================================================================
console.log('\n== 5. Participante W&S que entró por "2 Quiero información" ==');
resetState(); DB_CONV.flowNode = 'filtro_previo';
await send('2');
assert.strictEqual(DB_CONV.flowNode, 'solicitud_datos');
let extractCalls = 0; const prevExtract = EXTRACT_RESULT;
CHAT_REPLY = 'Tu Mock tiene su propio código 😊';
await send('Hola, soy Ana López, tengo dudas con mi OTCC');
assert.ok(isFiltro(SENT[0].text), 'el filtro va ANTES de pedirle su estado');
assert.ok(!texts().join().includes('Ciudad y estado'));
await send('1');
assert.strictEqual(wsCalls().length, 1); assert.strictEqual(DB_LEAD.state, null, 'nunca se le pidió el estado');
ok('5a filtro antes de solicitud_datos → W&S sin pedir estado');

resetState(); DB_CONV.flowNode = 'solicitud_datos';
await send('Soy Luis Pérez, coordinador del Colegio Sol en Toluca, Estado de México; quiero info del Oxford TCC');
assert.ok(isFiltro(SENT[0].text));
EXTRACT_RESULT = { full_name: 'Luis Pérez', role: 'coordinador', institution_name: 'Colegio Sol', state: 'Estado de México', municipality: 'Toluca' };
await send('2');
assert.strictEqual(DB_LEAD.state, 'Estado de México', 'con "no", el mismo mensaje se procesa como solicitud_datos');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal');
ok('5b "no" → el mensaje retenido se procesa en solicitud_datos, como hoy');

// ============================================================================
console.log('\n== Otros caminos ==');
resetState(); DB_CONV.flowNode = 'llm_freeform';
CHAT_REPLY = 'Revisa spam y promociones.';
await send('Soy de Work and Study y no me llega el código del OTCC');
assert.ok(!texts().some(isFiltro)); assert.strictEqual(wsCalls().length, 1);
assert.strictEqual(DB_CONV.metadata.wsFiltro.via, 'explicito');
ok('W&S explícito + intención → entra directo, sin preguntar');

resetState(); DB_CONV.flowNode = 'filtro_previo';
await send('1');
assert.ok(SENT[0].text.includes('¿Tu programa es Work and Study?'), 'variante del filtro');
await send('1');
assert.ok(SENT[0].text.includes('¿Tu duda es sobre tu certificación Oxford TCC'), 'ws_tema');
await send('1');
assert.deepStrictEqual(texts(), [WS_TEXTS.ws_otcc]);
resetState(); DB_CONV.flowNode = 'ws_tema'; DB_CONV.metadata = { wsFiltro: { respuesta: 'ws', via: 'filtro_previo' } };
await send('2');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito_stub', 'otro tema / Life → flujo actual');
resetState(); DB_CONV.flowNode = 'filtro_previo';
await send('1'); await send('2');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito_stub', '"no" → ya_inscrito_stub como hoy');
ok('filtro_previo → 1 → variante → tema; "otro tema" y "no" siguen el flujo actual');

resetState(); DB_CONV.flowNode = 'llm_freeform';
await send('¿qué es el OTCC?'); await send('3');
assert.ok(SENT[0].text.includes('grupo de WhatsApp de W&S'));
await send('3');
assert.deepStrictEqual(texts(), [WS_TEXTS.pedir_datos]); assert.strictEqual(DB_CONV.flowNode, 'ws_datos');
ok('no estoy seguro → texto del documento → "sigo sin estar seguro" → pide datos para canalizar');

resetState(); DB_CONV.flowNode = 'llm_freeform';
await send('¿qué es el OTCC?'); await send('mmm');
assert.ok(SENT[0].text.startsWith(WS_TEXTS.reintento));
CHAT_REPLY = 'Es una certificación de inglés.';
await send('¿eh?');
assert.strictEqual(DB_CONV.metadata.wsFiltro.respuesta, 'no'); assert.strictEqual(comCalls().length, 1);
ok('respuesta que no se entiende → se re-pregunta una vez; a la segunda cuenta como "no"');

resetState(); ENV.OXED_WS_ENABLED = false; DB_CONV.flowNode = 'llm_freeform';
CHAT_REPLY = 'El OTCC es nuestra certificación.';
await send('¿qué es el OTCC?');
assert.deepStrictEqual(texts(), [CHAT_REPLY]); assert.strictEqual(wsCalls().length, 0);
DB_CONV.flowNode = 'filtro_previo'; await send('1');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito_stub');
ok('OXED_WS_ENABLED=false → sin filtro y la opción 1 como hoy');

resetState(); DB_CONV.flowNode = 'ws_otcc'; DB_CONV.metadata = { wsFiltro: { respuesta: 'ws' }, programa: 'ws', tema: 'otcc' };
CHAT_REPLY = 'Con gusto te cuento de nuestras certificaciones.';
await send('perdón, no soy de Work and Study');
assert.strictEqual(DB_CONV.metadata.programa, null); assert.strictEqual(DB_CONV.metadata.wsFiltro.respuesta, 'no');
assert.strictEqual(comCalls().length, 1); assert.strictEqual(wsCalls().length, 0);
assert.ok(!texts().join().includes('theoxfordtcc.co.uk'), 'sin link oficial: sigue el comercial');
ok('"no soy de W&S" dentro del modo → sale y contesta el comercial');

// ============================================================================
console.log('\n== Canalización y caso ==');
resetState(); DB_CONV.flowNode = 'ws_otcc'; DB_CONV.metadata = { wsFiltro: { respuesta: 'ws' }, programa: 'ws', tema: 'otcc' };
CHAT_REPLY = 'Escríbele a Karen Méndez al 55 2845 0167 si no te llega. [CANALIZAR:no le llega el código]';
await send('ya revisé spam y no me llega mi código del Mock');
assert.ok(!texts().join().match(/Karen|2845|CANALIZAR/), 'sin nombre, teléfono ni etiqueta');
assert.ok(texts().includes(WS_TEXTS.pedir_datos), 'pide los datos del documento');
assert.strictEqual(DB_CONV.flowNode, 'ws_datos');
assert.strictEqual(DB_CONV.metadata.wsCaso.description, 'ya revisé spam y no me llega mi código del Mock');
await send(img());
assert.strictEqual(ATTS.length, 1); assert.ok(ATTS[0].data.length > 0, 'captura guardada en la base');
assert.ok(SENT[0].text.startsWith(WS_TEXTS.captura_recibida));
EXTRACT_RESULT = { fullName: 'Ana López', email: 'ana@correo.com' };
await send('Ana López, ana@correo.com');
assert.ok(SENT[0].text.includes('la etapa de evaluación'), 'pide solo lo que falta');
assert.strictEqual(CASES.length, 0, 'sin datos completos no hay caso');
EXTRACT_RESULT = { stage: 'mock' };
await send('es el Mock');
assert.strictEqual(CASES.length, 1);
assert.deepStrictEqual([CASES[0].fullName, CASES[0].email, CASES[0].stage], ['Ana López', 'ana@correo.com', 'Mock']);
assert.strictEqual(ATTS[0].caseId, CASES[0].id, 'la captura queda ligada al caso');
assert.ok(SENT.at(-1).text.includes('hora peninsular española') && !/Karen|Jorge/.test(SENT.at(-1).text));
assert.strictEqual(DB_CONV.flowNode, 'ws_otcc'); assert.strictEqual(DB_CONV.metadata.wsCaso, null);
ok('[CANALIZAR] → pide datos → captura guardada → faltantes → caso creado con horario de España, sin nombres');

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
