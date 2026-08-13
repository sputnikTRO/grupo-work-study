/**
 * Test de regresión del HANDLER real de Ori recorriendo el FLUJO DETERMINÍSTICO
 * (feature/ori-flow-redesign).
 *
 * Por qué existe: el bug de scope de processWithAI (ver test-oxford-handler.mjs)
 * se coló porque nadie ejecutaba el handler real en pruebas. Este archivo hace lo
 * mismo para la máquina de estados nueva: corre handleMessage() REAL, turno a
 * turno, contra un grafo de "Flujo Ori" REALISTA (mismos textos verbatim del
 * seed), con solo la infraestructura (DB/Redis/WhatsApp/Meta/Claude/reloj de
 * horario) mockeada. advisor-zones.js y actions.js (executeHandoffToAdvisor,
 * buildLeadUpdate) corren SIN mockear — así se prueba que el ruteo geográfico y
 * el handoff tibio, ya en prod, siguen intactos y de verdad se disparan con los
 * datos que captura el flujo determinístico.
 *
 * Cubre (todos los caminos pedidos):
 *   - bienvenida → filtro_previo → solicitud_datos → menu_principal → cat_1 →
 *     n_1_1 → CTA → handoff tibio (con ruteo geográfico REAL)
 *   - número inválido en un menú → aviso + re-muestra opciones, flowNode intacto
 *   - "Menú" (mayúsculas/acentos) resetea a menu_principal desde cualquier punto,
 *     incluido modo libre
 *   - respaldo LLM con texto libre en un nodo de menú → NO rompe flowNode
 *   - CTA "no" → invita al menú; CTA ambiguo → respaldo LLM, NO rompe flowNode
 *   - aviso de horario al derivar fuera de lun–vie 9–18 CDMX (Ori sigue viva)
 *   - ya_inscrito_stub: capta datos, marca seguimiento pendiente, SIN handoff geo
 *   - fallback seguro: Sheet no disponible / sin nodos requeridos → NO tumba el
 *     bot, cede el turno completo al camino LLM de siempre
 *
 * Requiere: node --experimental-test-module-mocks
 */
import assert from 'node:assert';
import { mock } from 'node:test';

// ── Estado fake compartido (reseteable entre escenarios) ───────────────────
const SENT = [];           // { to, text }
const TEMPLATES_SENT = []; // { to, name, lang, params }
let DB_CONV;
let DB_LEAD;
let officeHoursOverride = true;
let EXTRACT_RESULT = {};    // lo que "extrae" el LLM en el próximo turno de solicitud_datos/ya_inscrito_stub
let CHAT_REPLY = 'Claro, con gusto te cuento más sobre eso 😊'; // respuesta conversacional del respaldo LLM

function resetState() {
  SENT.length = 0;
  TEMPLATES_SENT.length = 0;
  DB_CONV = { id: 'conv1', status: 'active', flowNode: null };
  DB_LEAD = {
    id: 'lead1', contactId: 'c1', temperature: 'nuevo', status: 'nuevo',
    tags: [], notes: null, assignedAdvisor: null, zoneKey: undefined,
    state: null, municipality: null, fullName: null, institutionName: null,
    primaryProduct: null, leadType: null, role: null,
  };
  officeHoursOverride = true;
  EXTRACT_RESULT = {};
  CHAT_REPLY = 'Claro, con gusto te cuento más sobre eso 😊';
}
resetState();

// ── Mocks de infraestructura ─────────────────────────────────────────────────
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? p : `+521${p}`) } });
mock.module('../src/core/whatsapp/parser.js', {
  namedExports: { extractMessageContent: (m) => ({ text: m.text?.body ?? '', type: 'text', mediaUrl: null }) },
});
mock.module('../src/core/ai/claude.js', {
  namedExports: {
    // Un solo mock cubre los DOS usos del LLM: el extractor estructurado
    // (solicitud_datos/ya_inscrito_stub, systemPrompt distintivo) y el respaldo
    // conversacional (processWithAI, prompt normal de Ori).
    chat: async (systemPrompt) => {
      if (systemPrompt.includes('extractor de datos')) return JSON.stringify(EXTRACT_RESULT);
      return CHAT_REPLY;
    },
  },
});
mock.module('../src/config/env.js', {
  namedExports: {
    env: {
      OXED_FOREIGN_LEAD_FALLBACK: 'meeting_link',
      OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford',
      OXED_ADVISOR_TEMPLATE_LANG: 'es_MX',
    },
  },
});
mock.module('../src/core/database/client.js', {
  defaultExport: { oxfordLead: { groupBy: async () => [] } }, // round-robin → primer asesor de la dupla
});
mock.module('../src/services/contact.service.js', {
  namedExports: { findOrCreate: async () => ({ id: 'c1', name: null, phone: '+5215500000000' }) },
});
mock.module('../src/services/conversation.service.js', {
  namedExports: {
    findActiveOrCreate: async () => ({ ...DB_CONV }),
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
    sendTemplateMessage: async (to, name, lang, params) => { TEMPLATES_SENT.push({ to, name, lang, params }); },
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
  namedExports: { buildOxfordKnowledge: async () => null },
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
    '¡Hola! Gracias por escribir a Oxford Education Lit. Nuestro horario de atención es de lunes a viernes de 9:00 a 18:00 h. ¿En qué puedo apoyarte hoy?',
    {}, 1),
  row('filtro_previo',
    'Para dirigir tu solicitud, cuéntame: ¿ya eres parte de Oxford Education Lit o buscas información?\n1.- Ya estoy inscrito / soy cliente\n2.- Quiero información',
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
];

let flowRowsOverride = FULL_FLOW_ROWS;
mock.module('../src/core/sheets/cache.js', {
  namedExports: { getOxfordFlowRows: async () => flowRowsOverride },
});

const { handleMessage } = await import('../src/units/oxford-education/handler.js');

let pass = 0;
const ok = (n) => { console.log('  ✓ ' + n); pass++; };
const msg = (text) => ({ from: '5215500000000', id: `wamid.${Math.random()}`, type: 'text', text: { body: text } });

// ============================================================================
// Escenario A — Camino feliz completo
// ============================================================================
console.log('\n== A. bienvenida → filtro → datos → menú → categoría → producto → CTA → handoff ==');
resetState();

await handleMessage(msg('Hola'), 'pnid');
assert.strictEqual(SENT.length, 2, 'primer turno: bienvenida + filtro_previo (2 mensajes)');
assert.ok(SENT[0].text.includes('Gracias por escribir a Oxford Education Lit'), 'msg 1 = bienvenida verbatim');
assert.ok(SENT[1].text.includes('¿ya eres parte de Oxford Education Lit'), 'msg 2 = filtro_previo verbatim');
assert.strictEqual(DB_CONV.flowNode, 'filtro_previo', 'flowNode persistido = filtro_previo');
ok('Conversación nueva → bienvenida + filtro_previo (verbatim), flowNode=filtro_previo');

SENT.length = 0;
await handleMessage(msg('2'), 'pnid'); // "quiero información"
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Para ayudarte mejor'), 'salta a solicitud_datos verbatim');
assert.strictEqual(DB_CONV.flowNode, 'solicitud_datos');
ok('filtro_previo "2" → solicitud_datos (verbatim)');

SENT.length = 0;
EXTRACT_RESULT = { full_name: 'Ana López', role: 'Coordinadora académica', institution_name: 'Colegio Test', state: 'Jalisco', municipality: 'Guadalajara' };
await handleMessage(msg('Soy Ana López, coordinadora del Colegio Test, en Guadalajara, Jalisco'), 'pnid');
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Oxford Education es una EdTech'), 'salta a menu_principal verbatim');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal');
assert.strictEqual(DB_LEAD.fullName, 'Ana López', 'fullName capturado');
assert.strictEqual(DB_LEAD.state, 'Jalisco', 'state capturado — MISMO campo que alimenta advisor-zones.js');
assert.strictEqual(DB_LEAD.municipality, 'Guadalajara', 'municipality capturado');
ok('solicitud_datos: extrae vía LLM y captura con buildLeadUpdate (mismo que [CAPTURAR_DATO]) → menu_principal');

SENT.length = 0;
await handleMessage(msg('1'), 'pnid'); // Certificaciones
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Contamos con certificaciones'), 'salta a cat_1 verbatim');
assert.strictEqual(DB_CONV.flowNode, 'cat_1');
ok('menu_principal "1" → cat_1 (verbatim)');

SENT.length = 0;
await handleMessage(msg('1'), 'pnid'); // Oxford TCC Kids
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Oxford TCC Kids es la certificación'), 'salta a n_1_1 verbatim');
assert.strictEqual(DB_CONV.flowNode, 'n_1_1');
ok('cat_1 "1" → n_1_1 (verbatim, nodo hoja de producto)');

SENT.length = 0;
TEMPLATES_SENT.length = 0;
officeHoursOverride = true; // dentro de horario: SIN aviso
await handleMessage(msg('Sí, me interesa hablar con un asesor'), 'pnid');
assert.ok(SENT.some((m) => m.text.includes('Te conecto con')), 'CTA "sí" → handoff tibio (mensaje "Te conecto con…")');
assert.ok(!SENT.some((m) => m.text.includes('atienden de lunes a viernes')), 'dentro de horario → SIN aviso extra');
assert.strictEqual(DB_LEAD.zoneKey, 'B', 'Jalisco → dupla B (ruteo geográfico REAL con el state capturado por el flujo)');
assert.ok(DB_LEAD.assignedAdvisor, 'asesor asignado por el handoff tibio REAL');
assert.strictEqual(DB_CONV.flowNode, 'llm_freeform', 'flowNode → modo libre tras el handoff');
assert.strictEqual(TEMPLATES_SENT.length, 1, 'se notificó al asesor (plantilla)');
ok('CTA "sí" en n_1_1 → handoff tibio REAL (ruteo geográfico con datos del flujo) + notifica asesor');

// ============================================================================
// Escenario B — Número inválido
// ============================================================================
console.log('\n== B. Número inválido en un menú ==');
resetState();
DB_CONV.flowNode = 'menu_principal';
SENT.length = 0;
await handleMessage(msg('99'), 'pnid');
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.startsWith('Esa opción no es válida'), 'aviso de opción inválida');
assert.ok(SENT[0].text.includes('Oxford Education es una EdTech'), 'y re-muestra las opciones del nodo actual (verbatim)');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal', 'flowNode NO cambia');
ok('Número inválido en menú → "opción no válida" + re-muestra opciones, flowNode intacto');

// ============================================================================
// Escenario C — "Menú" resetea desde cualquier punto (incluido modo libre)
// ============================================================================
console.log('\n== C. "Menú" (mayúsculas/acentos) resetea a menu_principal ==');
resetState();
DB_CONV.flowNode = 'cat_1';
SENT.length = 0;
await handleMessage(msg('  MENÚ  '), 'pnid');
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Oxford Education es una EdTech'), 'salta a menu_principal verbatim');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal');
ok('"MENÚ" (mayúsculas + acento + espacios) desde cat_1 → menu_principal');

DB_CONV.flowNode = 'llm_freeform';
SENT.length = 0;
await handleMessage(msg('menu'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'menu_principal');
ok('"menu" también funciona en modo libre (llm_freeform)');

// ============================================================================
// Escenario D — Respaldo LLM con texto libre (no rompe el estado del flujo)
// ============================================================================
console.log('\n== D. Respaldo LLM con texto libre en nodo de menú ==');
resetState();
DB_CONV.flowNode = 'cat_1';
SENT.length = 0;
CHAT_REPLY = 'Claro, te cuento: el Oxford TCC Kids es ideal para niños de 7 a 12 años 😊';
await handleMessage(msg('oye, ¿cuánto dura el proceso de certificación?'), 'pnid');
assert.strictEqual(SENT.length, 2, 'LLM responde + recordatorio de "Menú" (2 mensajes)');
assert.strictEqual(SENT[0].text, CHAT_REPLY, 'primer mensaje = respuesta REAL del LLM (prompt actual + KB)');
assert.ok(SENT[1].text.includes('Menú'), 'segundo mensaje = recordatorio para volver al menú');
assert.strictEqual(DB_CONV.flowNode, 'cat_1', 'flowNode NO cambia — el respaldo no rompe el estado del flujo');
ok('Texto libre en nodo de menú → respaldo LLM (prompt actual) + recordatorio, flowNode intacto');

// ============================================================================
// Escenario E — CTA: declina / ambiguo
// ============================================================================
console.log('\n== E. CTA declina / ambiguo ==');
resetState();
DB_CONV.flowNode = 'n_1_1';
SENT.length = 0;
await handleMessage(msg('no gracias'), 'pnid');
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Menú'), 'declina → invita a volver al menú');
assert.strictEqual(DB_CONV.flowNode, 'llm_freeform', 'declina → modo libre');
ok('CTA "no gracias" → invita al menú, flowNode=llm_freeform');

resetState();
DB_CONV.flowNode = 'n_1_1';
SENT.length = 0;
CHAT_REPLY = 'Buena pregunta — el proceso tiene 3 etapas: diagnóstico, mock y certificación.';
await handleMessage(msg('mmm, ¿me explicas mejor primero?'), 'pnid'); // sin "sí"/"no" como palabra suelta → ambiguo
assert.strictEqual(SENT.length, 2, 'ambiguo → LLM responde + recordatorio');
assert.strictEqual(SENT[0].text, CHAT_REPLY);
assert.strictEqual(DB_CONV.flowNode, 'n_1_1', 'CTA ambiguo NO rompe el estado (seguimos en n_1_1)');
ok('CTA ambiguo → respaldo LLM, flowNode intacto (se puede resolver el CTA en el siguiente turno)');

// ============================================================================
// Escenario F — Aviso de horario al derivar FUERA de horario
// ============================================================================
console.log('\n== F. Aviso de horario al derivar fuera de lun–vie 9–18 CDMX ==');
resetState();
DB_CONV.flowNode = 'n_1_1';
DB_LEAD.state = 'Jalisco';
DB_LEAD.municipality = 'Guadalajara';
officeHoursOverride = false; // fuera de horario
SENT.length = 0;
await handleMessage(msg('sí, quiero hablar con un asesor'), 'pnid');
assert.ok(SENT.some((m) => m.text.includes('Te conecto con')), 'handoff tibio ocurre igual (Ori sigue 24/7)');
assert.ok(
  SENT.some((m) => m.text.includes('atienden de lunes a viernes de 9:00 a 18:00')),
  'fuera de horario → SE agrega el aviso',
);
ok('Fuera de horario: el handoff ocurre igual + se agrega el aviso (Ori no se silencia, solo cambia el texto)');

// ============================================================================
// Escenario G — ya_inscrito_stub
// ============================================================================
console.log('\n== G. ya_inscrito_stub: capta datos, SIN handoff geográfico ==');
resetState();
DB_CONV.flowNode = 'filtro_previo';
SENT.length = 0;
await handleMessage(msg('1'), 'pnid'); // "ya soy cliente"
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Con gusto te apoyamos con tu proceso'), 'salta a ya_inscrito_stub verbatim');
assert.strictEqual(DB_CONV.flowNode, 'ya_inscrito_stub');

SENT.length = 0;
EXTRACT_RESULT = { full_name: 'Carlos Ruiz', institution_name: 'Colegio XYZ' };
await handleMessage(msg('Carlos Ruiz, del Colegio XYZ'), 'pnid');
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('Carlos Ruiz') && SENT[0].text.includes('Colegio XYZ'), 'ack con nombre/colegio capturados');
assert.strictEqual(DB_LEAD.fullName, 'Carlos Ruiz');
assert.strictEqual(DB_LEAD.institutionName, 'Colegio XYZ');
assert.ok(DB_LEAD.tags.includes('ya_inscrito') && DB_LEAD.tags.includes('seguimiento_pendiente'), 'lead marcado visible para el equipo (tags)');
assert.ok(DB_LEAD.notes && DB_LEAD.notes.includes('TODO'), 'nota TODO para cablear el Sheet de "por cobrar"');
assert.strictEqual(DB_LEAD.zoneKey, undefined, 'NO se disparó ruteo geográfico (no hay ciudad/estado en este camino)');
assert.strictEqual(DB_CONV.flowNode, 'llm_freeform');
ok('ya_inscrito_stub: extrae nombre/colegio, marca seguimiento pendiente (TODO), SIN handoff geográfico');

// ============================================================================
// Escenario H — Fallback seguro: Sheet no disponible
// ============================================================================
console.log('\n== H. Fallback seguro: Sheet no disponible (no tumba el bot) ==');
resetState();
flowRowsOverride = []; // Sheet vacía / no cargó
SENT.length = 0;
CHAT_REPLY = 'Hola, con gusto te ayudo con información de Oxford Education 😊';
await handleMessage(msg('Hola'), 'pnid'); // conversación NUEVA (flowNode null)
assert.strictEqual(SENT.length, 1, 'sin bienvenida/filtro_previo — un único mensaje, el del LLM de siempre');
assert.strictEqual(SENT[0].text, CHAT_REPLY, 'camino LLM puro, idéntico al comportamiento previo a este cambio');
assert.strictEqual(DB_CONV.flowNode, null, 'flowNode nunca se toca cuando el flujo está deshabilitado');
ok('Sheet vacía → flujo determinístico deshabilitado, camino LLM de siempre (sin romper nada)');

flowRowsOverride = FULL_FLOW_ROWS.filter((r) => r.ID !== 'bienvenida'); // faltan nodos requeridos
SENT.length = 0;
await handleMessage(msg('Hola'), 'pnid');
assert.strictEqual(SENT.length, 1, 'faltando un nodo requerido, también cede al LLM (sin crashear)');
assert.strictEqual(SENT[0].text, CHAT_REPLY);
ok('Sheet sin nodo requerido (bienvenida) → también cede al LLM de forma segura, sin excepciones');

flowRowsOverride = FULL_FLOW_ROWS; // restaurar para no afectar otras corridas del archivo

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
