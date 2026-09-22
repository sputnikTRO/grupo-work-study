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
    primaryProduct: null, primaryProductLabel: null, leadType: null, role: null,
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
  defaultExport: { oxfordLead: { groupBy: async () => [] } }, // round-robin → primer asesor de la zona
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
  row('n_1_2',
    'El Oxford TCC evalúa el dominio del inglés como lengua extranjera, reconocido internacionalmente y alineado al MCER. ¿Deseas detalles sobre niveles, proceso o costos?',
    {}, 8),
  row('n_1_3',
    'Oxford ETC certifica competencias didácticas del profesorado en enseñanza de inglés. ¿Te gustaría conocer el contenido o modalidades del curso?',
    {}, 9),
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
assert.strictEqual(DB_LEAD.zoneKey, 'CENTRO', 'Jalisco → equipo CENTRO (ruteo geográfico REAL con el state capturado por el flujo)');
assert.ok(DB_LEAD.assignedAdvisor, 'asesor asignado por el handoff tibio REAL');
assert.strictEqual(DB_CONV.flowNode, 'llm_freeform', 'flowNode → modo libre tras el handoff');
assert.strictEqual(TEMPLATES_SENT.length, 1, 'se notificó al asesor (plantilla)');
ok('CTA "sí" en n_1_1 → handoff tibio REAL (ruteo geográfico con datos del flujo) + notifica asesor');

// Bug real: a una asesora le llegó el ticket con el apartado "Producto" VACÍO.
// primaryProduct solo lo escribía [CAPTURAR_DATO] del LLM, así que quien
// navegaba el menú hasta un producto se derivaba sin él — aunque el flujo
// supiera perfectamente en qué nodo estaba. Se captura al aterrizar en el nodo.
assert.strictEqual(DB_LEAD.primaryProduct, 'oxford_tcc_kids', 'n_1_1 = "Oxford TCC Kids" → producto capturado del menú');
assert.ok((DB_LEAD.productsInterest || []).includes('oxford_tcc_kids'), 'y queda en productsInterest');
// El motivo que ve la asesora nombra el producto, no el id del nodo.
const motivo = TEMPLATES_SENT[0].params.join(' | ');
assert.ok(motivo.includes('Oxford TCC Kids'), `el ticket nombra el producto (params: ${motivo})`);
assert.ok(!motivo.includes('nodo n_1_1'), 'y ya no muestra el id interno del nodo');
ok('el ticket de la asesora llega CON el producto (campo + motivo), no vacío');

// Navegar a OTRO producto refleja la elección más reciente y acumula el interés.
resetState();
DB_CONV.flowNode = 'cat_1';
await handleMessage(msg('3'), 'pnid');                    // → n_1_3 (Oxford ETC)
assert.strictEqual(DB_CONV.flowNode, 'n_1_3');
assert.strictEqual(DB_LEAD.primaryProduct, 'english_teaching_certificate', '"Oxford ETC (Certificación para docentes)" → ETC, no el TCC genérico');
await handleMessage(msg('Menú'), 'pnid');
DB_CONV.flowNode = 'cat_1';
await handleMessage(msg('2'), 'pnid');                    // → n_1_2 (Oxford TCC)
assert.strictEqual(DB_LEAD.primaryProduct, 'oxford_tcc', 'el primario es el ÚLTIMO producto visto');
assert.deepStrictEqual([...DB_LEAD.productsInterest].sort(), ['english_teaching_certificate', 'oxford_tcc'], 'productsInterest acumula los dos');
ok('el producto sigue la navegación: primario = el último, productsInterest acumula');

// Dos trampas encontradas probando contra el menú REAL: un patrón laxo metía el
// producto EQUIVOCADO en el ticket, que es peor que dejarlo vacío.
//   "Oxford Checkpoint Kids" (examen diagnóstico) ≠ "Oxford TCC Kids" (certificación)
//   "English Life" (programa de viajes)           ≠ "Oxford LIFE" (la app)
resetState();
flowRowsOverride = [
  ...FULL_FLOW_ROWS,
  row('cat_trampa', 'Elige:\n1.- Oxford Checkpoint Kids\n2.- English Life', { 1: 'n_chk_kids', 2: 'n_eng_life' }, 90),
  row('n_chk_kids', 'Oxford Checkpoint Kids evalúa a niños de 6 a 12 años. ¿Te interesa?', {}, 91),
  row('n_eng_life', 'English Life ofrece inmersión total en inglés en el extranjero. ¿Te interesa?', {}, 92),
];
DB_CONV.flowNode = 'cat_trampa';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'n_chk_kids');
assert.strictEqual(DB_LEAD.primaryProduct, null, '"Oxford Checkpoint Kids" NO debe caer en oxford_tcc_kids');
assert.strictEqual(DB_LEAD.primaryProductLabel, 'Oxford Checkpoint Kids', 'pero sí se captura con su nombre real');
DB_CONV.flowNode = 'cat_trampa';
await handleMessage(msg('2'), 'pnid');
assert.strictEqual(DB_LEAD.primaryProduct, null, '"English Life" NO debe caer en oxford_life');
assert.strictEqual(DB_LEAD.primaryProductLabel, 'English Life', 'y también se captura con su nombre real');
ok('los nombres parecidos no se confunden: el enum queda vacío, la etiqueta es la correcta');

// El objetivo del cambio: CUALQUIER producto del menú llega al ticket, tenga o
// no valor en el enum (que solo cubre 7 de los ~16).
resetState();
flowRowsOverride = [
  ...FULL_FLOW_ROWS,
  row('cat_aula', 'Plataformas para el aula:\n1.- Smile and Learn\n2.- AINARA', { 1: 'n_sl', 2: 'n_ai' }, 95),
  row('n_sl', 'Smile and Learn es una app educativa con miles de actividades. ¿Te interesa?', {}, 96),
  row('n_ai', 'AINARA usa IA generativa para crear contenidos. ¿Te interesa?', {}, 97),
];
DB_LEAD.state = 'Jalisco';
DB_CONV.flowNode = 'cat_aula';
await handleMessage(msg('1'), 'pnid');
assert.strictEqual(DB_LEAD.primaryProductLabel, 'Smile and Learn', 'Smile and Learn se captura aunque no esté en el enum');
assert.strictEqual(DB_LEAD.primaryProduct, null, 'y no se inventa un valor de enum que no existe');

TEMPLATES_SENT.length = 0;
await handleMessage(msg('sí, me interesa'), 'pnid');      // CTA → handoff real
assert.strictEqual(TEMPLATES_SENT.length, 1, 'se notificó a la asesora');
assert.ok(TEMPLATES_SENT[0].params.includes('Smile and Learn'), `el ticket lleva el producto (params: ${TEMPLATES_SENT[0].params.join(' | ')})`);
assert.ok(!TEMPLATES_SENT[0].params.includes('no capturado'), 'el apartado Producto ya NO llega vacío');
ok('un producto fuera del enum (Smile and Learn) llena el apartado Producto del ticket');
flowRowsOverride = FULL_FLOW_ROWS;

// ── Conversación REAL de prod (22-sep): el ticket llegó sin producto ────────
// El prospecto preguntó por AINARA en TEXTO LIBRE estando en cat_2, así que el
// handoff salió por el camino LLM ([DERIVAR_ASESOR]) y no por un nodo del menú.
// La captura desde el nodo no aplicaba, y AINARA no existe en el enum, así que
// el apartado "Producto" del ticket llegó VACÍO a la asesora.
resetState();
DB_CONV.flowNode = 'llm_freeform';
DB_LEAD.state = 'Jalisco';
SENT.length = 0;
TEMPLATES_SENT.length = 0;
CHAT_REPLY = '¡AINARA es una de nuestras plataformas más innovadoras! 😊 [CAPTURAR_DATO:product_label:AINARA][DERIVAR_ASESOR:Interesado en plataforma AINARA para el aula]';
await handleMessage(msg('Me interesa Ainara'), 'pnid');
assert.strictEqual(DB_LEAD.primaryProductLabel, 'AINARA', 'el LLM ya puede registrar un producto fuera del enum');
assert.strictEqual(DB_LEAD.primaryProduct, null, 'sin inventar un valor de enum inexistente');
assert.ok(TEMPLATES_SENT[0].params.includes('AINARA'), `el ticket lleva AINARA (params: ${TEMPLATES_SENT[0].params.join(' | ')})`);
assert.ok(!TEMPLATES_SENT[0].params.includes('no capturado'), 'ya no llega "no capturado"');
ok('AINARA por el camino LLM: el ticket llega CON el producto (bug real del 22-sep)');

// ── El menú acepta el TEXTO de la opción, no solo el número ────────────────
// En la misma conversación, "Me interesa Ainara" no podía elegir nada porque el
// menú de Ori solo miraba dígitos. Miri ya aceptaba texto; ahora Ori también.
resetState();
DB_CONV.flowNode = 'cat_1';
SENT.length = 0;
await handleMessage(msg('Oxford ETC'), 'pnid');
assert.strictEqual(DB_CONV.flowNode, 'n_1_3', 'la etiqueta del menú elige la opción');
assert.strictEqual(DB_LEAD.primaryProductLabel, 'Oxford ETC (Certificación para docentes)');
ok('el menú de Ori acepta el texto de la opción, no solo el número');

// Un número suelto FUERA de rango re-muestra la lista (no cede al LLM).
resetState();
DB_CONV.flowNode = 'cat_1';
SENT.length = 0;
await handleMessage(msg('9'), 'pnid');      // cat_1 solo tiene 1..4
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('no es válida'), 'avisa y re-muestra las opciones');
assert.strictEqual(DB_CONV.flowNode, 'cat_1', 'sin romper el estado');
ok('un número fuera de rango sigue re-mostrando la lista');

// Pero un número DENTRO de una frase es conversación, no una elección.
resetState();
DB_CONV.flowNode = 'cat_1';
SENT.length = 0;
CHAT_REPLY = 'Con gusto, para 30 alumnos aplican condiciones especiales 😊';
await handleMessage(msg('tenemos 30 alumnos, ¿aplica?'), 'pnid');
assert.strictEqual(SENT[0].text, CHAT_REPLY, 'va al LLM, no elige ninguna opción');
assert.strictEqual(DB_CONV.flowNode, 'cat_1');
ok('un número dentro de una frase no se confunde con elegir opción');

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

// El recordatorio sale UNA VEZ por nodo. Antes era incondicional y se colgaba
// debajo de CADA respuesta de Ori (en un tramo real salió tres veces seguidas).
SENT.length = 0;
CHAT_REPLY = 'El proceso completo toma alrededor de 8 semanas 😊';
await handleMessage(msg('¿y cuánto tarda en llegar el certificado físico?'), 'pnid');
assert.strictEqual(SENT.length, 1, 'segundo texto libre en el MISMO nodo → solo la respuesta, sin repetir el recordatorio');
assert.strictEqual(SENT[0].text, CHAT_REPLY);
assert.strictEqual(DB_CONV.flowNode, 'cat_1', 'y el flowNode sigue intacto');
ok('el recordatorio de "Menú" NO se repite turno tras turno en el mismo nodo');

// Al cambiar de nodo vuelve a salir: es una guía de navegación, no un mensaje
// de una sola vez por conversación.
SENT.length = 0;
await handleMessage(msg('1'), 'pnid');                    // cat_1 → n_1_1
assert.strictEqual(DB_CONV.flowNode, 'n_1_1', 'avanza de nodo');
SENT.length = 0;
CHAT_REPLY = 'Sí, incluye examen oral con evaluadores expertos.';
await handleMessage(msg('¿y eso incluye la parte oral?'), 'pnid'); // CTA ambiguo → respaldo LLM
assert.strictEqual(SENT.length, 2, 'en el nodo NUEVO el recordatorio vuelve a salir');
assert.ok(SENT[1].text.includes('Menú'));
ok('al cambiar de nodo el recordatorio reaparece (guía de navegación, no one-shot)');

// ============================================================================
// Escenario D2 — El copy no afirma un contacto que el sistema no puede saber
// ============================================================================
console.log('\n== D2. Copy de la asesora ya asignada: asignada ≠ ya te escribió ==');
resetState();
DB_CONV.flowNode = 'llm_freeform';
DB_LEAD.assignedAdvisor = 'Oriana Pullas';
DB_LEAD.status = 'derivado_asesor';
SENT.length = 0;
CHAT_REPLY = ''; // el LLM no produjo texto → entra el fallback con nombre de asesora
await handleMessage(msg('¿me pasas el precio?'), 'pnid');
const conAsesora = SENT[0].text;
assert.ok(conAsesora.includes('Oriana Pullas'), 'nombra a la asesora asignada');
assert.ok(!/está en contacto|ya te escribió|ya te contactó|ya se comunicó/i.test(conAsesora),
  `el sistema sabe que fue asignada y notificada, NO que ya escribió: "${conAsesora}"`);
assert.ok(/asignada/i.test(conAsesora), 'lo que sí puede afirmar: que es su asesora asignada');
ok('el respaldo sin texto del LLM no da por hecho el contacto con la asesora');

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

// Regresión del bug real: en el nodo del Oxford TCC (CTA "¿Deseas detalles sobre
// niveles, proceso o costos?"), un prospecto preguntó "¿Qué pasa si no paso la
// certificación?" y Ori contestó "Sin problema 😊 Escribe Menú…". DECLINE_RE
// matcheaba el "no" de "si NO paso": la duda se leía como rechazo al CTA y nunca
// llegaba al LLM, que sí tiene la respuesta en la FAQ (sin reembolso + diploma
// de participación).
resetState();
DB_CONV.flowNode = 'n_1_1';
SENT.length = 0;
CHAT_REPLY = 'Si no alcanzas el puntaje no hay reembolso, pero recibes un diploma de participación 😊';
await handleMessage(msg('¿Qué pasa si no paso la certificación?'), 'pnid');
assert.ok(!SENT.some((m) => m.text.includes('Sin problema')), 'la pregunta NO se trata como "no gracias"');
assert.strictEqual(SENT[0].text, CHAT_REPLY, 'la contesta el LLM, que es quien tiene la FAQ');
assert.strictEqual(DB_CONV.flowNode, 'n_1_1', 'el CTA sigue vivo para resolverse en el siguiente turno');
assert.strictEqual(DB_LEAD.assignedAdvisor, null, 'y por supuesto no deriva');
ok('una PREGUNTA con "no" dentro llega al LLM, no al camino de rechazo del CTA');

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

// El ack NO debe sonar a confirmación de inscripción: Ori no consultó ningún
// sistema (el cableado al Sheet de "por cobrar" sigue siendo un TODO). Solo tomó
// datos. "Ya quedó registrado tu caso" leía como "ya estás inscrito".
const ack = SENT[0].text;
assert.ok(!/registrad|inscrit|confirmad|apartad/i.test(ack), `el ack no debe implicar inscripción confirmada: "${ack}"`);
assert.ok(/tomé tus datos/i.test(ack), 'el ack dice explícitamente que solo tomó los datos');
assert.ok(/asesora/i.test(ack) && /revisar/i.test(ack), 'el ack deja el caso en manos de la asesora, sin prometer estatus');
ok('ya_inscrito_stub: el ack no implica inscripción confirmada (solo "tomé tus datos")');

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
