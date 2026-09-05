/**
 * Ori — el LLM conoce el contenido de "Flujo Ori", no solo la FAQ.
 *
 * Por qué existe: varios productos del menú (AINARA, Visual Camp, KNOW BY STEAM
 * TREKS) no tienen ficha en "FAQ Oxford". Antes de este cambio, una pregunta de
 * TEXTO LIBRE sobre ellos solo llegaba al LLM con su NOMBRE en el catálogo, así
 * que lo mejor que podía hacer era reconocerlo y derivar. Ahora las
 * descripciones de sus nodos de "Flujo Ori" también viajan en el prompt.
 *
 * A diferencia de test-oxford-flow-handler.mjs, aquí prompts.js, knowledge.js y
 * flow-content.js corren REALES: lo que se verifica es el systemPrompt que de
 * verdad recibe Claude. Solo se mockea infraestructura (Sheets/DB/Redis/
 * WhatsApp/Claude).
 *
 * Cubre:
 *   A. buildFlowKnowledge separa nodos de CONTENIDO de los de NAVEGACIÓN
 *   B. (a) "¿qué es AINARA?" en texto libre → su descripción llega al prompt
 *   C. (b) Smile and Learn (sí tiene FAQ) → ambas fuentes, con su precedencia
 *   D. (c) algo que NO es producto → sin material inventado + guardarraíles vivos
 *   E. la navegación determinística del menú sigue igual (esto es aditivo)
 *   F. fallback seguro: sin "Flujo Ori" el prompt sale sin la sección
 *
 * Requiere: node --experimental-test-module-mocks
 */
import assert from 'node:assert';
import { mock } from 'node:test';

let pass = 0;
const ok = (name) => { console.log(`  ✓ ${name}`); pass++; };

const SENT = [];
const PROMPTS = [];   // systemPrompt de cada llamada conversacional a Claude
let DB_CONV;
let DB_LEAD;
let flowRowsOverride = null;
let faqRowsOverride = null;
const CHAT_REPLY = 'Con gusto te cuento 😊';

function resetState() {
  SENT.length = 0;
  PROMPTS.length = 0;
  DB_CONV = { id: 'conv1', status: 'active', flowNode: null };
  DB_LEAD = {
    id: 'lead1', contactId: 'c1', temperature: 'nuevo', status: 'nuevo',
    tags: [], notes: null, assignedAdvisor: null, state: null, municipality: null,
    fullName: null, institutionName: null, primaryProduct: null, leadType: null, role: null,
  };
}
resetState();

// ── Infraestructura mockeada ─────────────────────────────────────────────────
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
    chat: async (systemPrompt) => {
      if (systemPrompt.includes('extractor de datos')) return '{}';
      PROMPTS.push(systemPrompt);
      return CHAT_REPLY;
    },
  },
});
mock.module('../src/config/env.js', {
  namedExports: {
    env: {
      OXED_HANDOFF_MEETING_URL: 'https://meetings.hubspot.com/camila-serafin-jimenez/',
      OXED_FOREIGN_LEAD_FALLBACK: 'meeting_link',
      OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford',
      OXED_ADVISOR_TEMPLATE_LANG: 'es_MX',
    },
  },
});
mock.module('../src/core/database/client.js', { defaultExport: { oxfordLead: { groupBy: async () => [] } } });
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
    acquireContactLock: async () => true, releaseContactLock: async () => {},
    getHistory: async () => [], formatForClaude: (h) => h, addMessage: async () => {},
  },
});
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { SENT.push({ to, text }); },
    sendTemplateMessage: async () => {},
    markMessageAsRead: async () => {},
  },
});
mock.module('../src/units/oxford-education/sheets-sync.js', {
  namedExports: { syncOxfordLeadToSheet: async () => {}, deriveTemperature: () => 'warm' },
});
mock.module('../src/units/oxford-education/office-hours.js', {
  namedExports: { isWithinOfficeHours: () => true, OUT_OF_HOURS_NOTICE: '' },
});

// ── Grafo "Flujo Ori" (textos verbatim del seed, ya sin iEduca) ─────────────
function row(id, texto, opciones = {}, orden = 1) {
  const d = [1, 2, 3, 4, 5].map((n) => opciones[n] || '');
  return {
    ID: id, Estado: 'Vigente', Texto: texto,
    'Destino opción 1': d[0], 'Destino opción 2': d[1], 'Destino opción 3': d[2],
    'Destino opción 4': d[3], 'Destino opción 5': d[4], Notas: '', Orden: String(orden),
  };
}

const AINARA_TXT = 'AINARA utiliza IA generativa para crear, adaptar y evaluar contenidos personalizados, apoyando a docentes con recursos inclusivos para diferentes niveles y contextos. La plataforma permite el desarrollo de materiales para diferentes materias y planes de estudio, no se limita al aprendizaje del inglés. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?';
const SMILE_TXT = 'Smile and Learn es una app educativa con miles de actividades interactivas para niños de 3 a 12 años, diseñada para personalizar el aprendizaje y fomentar el bilingüismo. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?';
const VISUAL_TXT = 'Visual Camp usa eye-tracking e inteligencia artificial para mejorar hábitos y comprensión lectora en inglés y español con métricas en tiempo real. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?';
const KNOW_TXT = 'KNOW BY STEAM TREKS son cursos en academia virtual para docentes y alumnos que permiten la correcta implementación de la metodología STEAM (Ciencias, Tecnología, Ingeniería, Arte y Matemáticas) en el aula. ¿Te interesaría agendar una llamada o recorrido virtual con un asesor?';
const NO_SEGURO_TXT = 'Si aún no estás seguro, podemos ayudarte a entender mejor nuestras certificaciones y evaluaciones de inglés. ¿Te gustaría recibir una explicación más detallada?';
const TCC_TXT = 'El Oxford TCC evalúa el dominio del inglés como lengua extranjera, reconocido internacionalmente y alineado al MCER. ¿Deseas detalles sobre niveles, proceso o costos?';

const FULL_FLOW_ROWS = [
  row('bienvenida', '¡Hola! Gracias por escribir a Oxford Education Lit. ¿En qué puedo apoyarte hoy?', {}, 1),
  row('filtro_previo', 'Para dirigir tu solicitud, cuéntame: ¿ya eres parte de Oxford Education Lit o buscas información?\n1.- Ya estoy inscrito / soy cliente\n2.- Quiero información',
    { 1: 'ya_inscrito_stub', 2: 'solicitud_datos' }, 2),
  row('ya_inscrito_stub', '¡Con gusto te apoyamos con tu proceso! ¿Me compartes tu nombre y el colegio o institución?', {}, 3),
  row('solicitud_datos', 'Para ayudarte mejor, ¿me compartes tu nombre, tu colegio y tu ciudad y estado?', {}, 4),
  row('menu_principal', 'Oxford Education es una EdTech. ¿Qué área te interesa conocer?\n1.- Certificaciones\n2.- Plataformas para aprendizaje del inglés\n3.- Plataformas para el aula',
    { 1: 'cat_1', 2: 'cat_2', 3: 'cat_3' }, 5),
  row('cat_1', 'Certificaciones y evaluaciones de inglés alineadas al MCER. ¿Tu interés principal es:\n1.- Oxford TCC (A1-C2)\n2.- No estoy seguro', { 1: 'n_1_2', 2: 'n_1_4' }, 6),
  row('n_1_2', TCC_TXT, {}, 7),
  row('n_1_4', NO_SEGURO_TXT, {}, 8),
  row('cat_2', 'Plataformas para aprendizaje del inglés. Selecciona la plataforma que te interesa:\n1.- Oxford LIFE', { 1: 'n_2_1' }, 8),
  row('n_2_1', 'Oxford LIFE es una plataforma para práctica diaria de inglés basada en micro-aprendizaje con gamificación. ¿Te interesa platicar con un asesor?', {}, 9),
  row('cat_3', 'Plataformas para el aula. Por favor selecciona la plataforma de tu interés:\n1.- Smile and Learn\n2.- Visual Camp\n3.- AINARA\n4.- KNOW BY STEAM TREKS',
    { 1: 'n_3_1', 2: 'n_3_2', 3: 'n_3_4', 4: 'n_3_5' }, 10),
  row('n_3_1', SMILE_TXT, {}, 11),
  row('n_3_2', VISUAL_TXT, {}, 12),
  row('n_3_4', AINARA_TXT, {}, 13),
  row('n_3_5', KNOW_TXT, {}, 14),
  row('util_menu', "Si deseas volver al menú principal, solo escribe 'Menú'.", {}, 15),
  row('util_cierre', 'Gracias por comunicarte con Oxford Education Lit. ¡Que tengas un excelente día!', {}, 16),
];

// Solo Smile and Learn tiene ficha en el FAQ — el hueco que motivó este cambio.
const FAQ_ROWS = [
  { Programa: 'smile_and_learn', Categoría: 'General', Pregunta: '¿Cuántos idiomas tiene Smile and Learn?', Respuesta: 'Está disponible en 10 idiomas.', Orden: '1' },
  { Programa: 'oxford_tcc', Categoría: 'General', Pregunta: '¿Cuánto dura el Oxford TCC?', Respuesta: 'El proceso completo toma alrededor de 8 semanas.', Orden: '2' },
];

mock.module('../src/core/sheets/cache.js', {
  namedExports: {
    getOxfordFlowRows: async () => (flowRowsOverride ?? FULL_FLOW_ROWS),
    getOxfordFAQ: async () => (faqRowsOverride ?? FAQ_ROWS),
  },
});

const { handleMessage } = await import('../src/units/oxford-education/handler.js');
const { buildFlowKnowledge } = await import('../src/units/oxford-education/knowledge.js');

const msg = (text) => ({ from: '5215500000000', id: `wamid.${Math.random()}`, type: 'text', text: { body: text } });

/** Deja la conversación en modo libre y manda un mensaje de texto libre. */
async function freeform(text) {
  resetState();
  DB_CONV.flowNode = 'llm_freeform';
  await handleMessage(msg(text), 'pnid');
  assert.strictEqual(PROMPTS.length, 1, `"${text}" debió ir al camino LLM`);
  return PROMPTS[0];
}

// ============================================================================
// A — buildFlowKnowledge separa CONTENIDO de NAVEGACIÓN
// ============================================================================
console.log('\n== A. Solo entran los nodos con conocimiento real ==');
const block = await buildFlowKnowledge();

// La etiqueta se toma TAL CUAL la escribe el menú, con paréntesis incluidos
// ("Oxford TCC (A1-C2)"): es lo que el prospecto ve, así que es lo que el LLM debe usar.
for (const [nombre, texto] of [['AINARA', AINARA_TXT], ['Visual Camp', VISUAL_TXT], ['KNOW BY STEAM TREKS', KNOW_TXT], ['Smile and Learn', SMILE_TXT], ['Oxford TCC (A1-C2)', TCC_TXT]]) {
  assert.ok(block.includes(texto), `falta la descripción de ${nombre}`);
  assert.ok(block.includes(`**${nombre}**`), `falta la etiqueta **${nombre}** tal como la escribe el menú`);
}
ok('las descripciones de producto entran con su nombre VERBATIM del menú');

// Navegación fuera: su texto es una lista de opciones o un paso de captura.
assert.ok(!block.includes('¿Qué área te interesa conocer?'), 'menu_principal es navegación, no conocimiento');
assert.ok(!block.includes('selecciona la plataforma de tu interés'), 'cat_3 es navegación, no conocimiento');
assert.ok(!block.includes('¿ya eres parte de Oxford Education Lit'), 'filtro_previo es navegación');
assert.ok(!block.includes('Gracias por escribir a Oxford Education Lit'), 'bienvenida es saludo, no conocimiento');
assert.ok(!block.includes('¿Me compartes tu nombre y el colegio'), 'ya_inscrito_stub es captura, no conocimiento');
assert.ok(!block.includes('¿me compartes tu nombre, tu colegio'), 'solicitud_datos es captura, no conocimiento');
assert.ok(!block.includes("solo escribe 'Menú'"), 'util_menu es utilitario');
assert.ok(!block.includes('¡Que tengas un excelente día!'), 'util_cierre es utilitario');
ok('navegación, saludo, pasos de captura y nodos util_* quedan FUERA');

// "No estoy seguro" es una salida de navegación para quien duda, no un producto.
// Sin filtrarla, el LLM la leía como un producto más del catálogo.
assert.ok(!block.includes('**No estoy seguro**'), '"No estoy seguro" no debe figurar como producto');
assert.ok(!block.includes(NO_SEGURO_TXT), 'y su texto tampoco entra al conocimiento de producto');
assert.ok(block.includes('**Oxford TCC (A1-C2)**'), 'pero el resto de su categoría sí entra');
ok('las salidas de navegación ("No estoy seguro") no se cuelan como productos');

// La categoría sale del propio menú, no de una lista hardcodeada.
assert.ok(block.includes('### Plataformas para el aula'), 'agrupa bajo la categoría que usa menu_principal');
assert.ok(block.includes('### Certificaciones'), 'agrupa las certificaciones por su propia categoría');
const idxAula = block.indexOf('### Plataformas para el aula');
assert.ok(block.indexOf(AINARA_TXT) > idxAula, 'AINARA queda bajo su categoría');
ok('agrupado por la categoría que el propio menú declara (sin hardcodear ninguna)');

// ============================================================================
// B — (a) pregunta libre por un producto SIN ficha en la FAQ
// ============================================================================
console.log('\n== B. "¿qué es AINARA?" en texto libre ==');
let prompt = await freeform('¿qué es AINARA?');

assert.ok(prompt.includes('## INFORMACIÓN DE PRODUCTOS DEL MENÚ'), 'la sección nueva viaja en el prompt');
assert.ok(prompt.includes(AINARA_TXT), 'el LLM recibe la descripción COMPLETA de AINARA, no solo su nombre');
ok('el LLM puede describir AINARA con el texto de su nodo de "Flujo Ori"');

// Antes solo tenía el nombre en el catálogo; eso ya no es todo lo que sabe.
const soloNombre = prompt.split('## INFORMACIÓN DE PRODUCTOS DEL MENÚ')[0];
assert.ok(soloNombre.includes('AINARA'), 'el catálogo sigue nombrando AINARA');
assert.ok(!soloNombre.includes('IA generativa'), 'antes de la sección nueva, AINARA solo era un nombre');
ok('la descripción es información NUEVA: el catálogo solo traía el nombre');

assert.strictEqual(SENT.length, 1);
assert.strictEqual(SENT[0].text, CHAT_REPLY, 'contesta el LLM (no el menú determinístico)');
ok('el turno lo resuelve el camino LLM, como cualquier pregunta libre');

// ============================================================================
// C — (b) un producto que SÍ tiene FAQ sigue bien
// ============================================================================
console.log('\n== C. Smile and Learn (con ficha en la FAQ) ==');
prompt = await freeform('¿cuántos idiomas tiene Smile and Learn?');

assert.ok(prompt.includes('Está disponible en 10 idiomas.'), 'la FAQ sigue llegando igual que antes');
assert.ok(prompt.includes(SMILE_TXT), 'y ahora además su descripción del menú');
ok('las dos fuentes conviven: FAQ + descripción del menú');

const idxMenu = prompt.indexOf('## INFORMACIÓN DE PRODUCTOS DEL MENÚ');
const idxFaq = prompt.indexOf('## PREGUNTAS FRECUENTES POR PROGRAMA');
assert.ok(idxMenu > 0 && idxFaq > idxMenu, 'la FAQ va después, por ser la fuente más específica');
assert.ok(/prevalece la información de este bloque/.test(prompt.slice(idxFaq)), 'y su precedencia queda escrita');
assert.ok(prompt.slice(idxFaq).includes('descripciones del menú'), 'la nota de precedencia nombra también al menú');
ok('orden y precedencia explícitos: catálogo < menú < FAQ');

// ============================================================================
// D — (c) algo que NO es producto: nada inventado, guardarraíles vivos
// ============================================================================
console.log('\n== D. Algo que NO está en el catálogo ==');
prompt = await freeform('¿venden uniformes escolares y libros de texto?');

const bloqueMenu = prompt.slice(prompt.indexOf('## INFORMACIÓN DE PRODUCTOS DEL MENÚ'), prompt.indexOf('## PREGUNTAS FRECUENTES'));
assert.ok(!/uniforme|libro de texto/i.test(bloqueMenu), 'la sección no inventa productos que no están en el menú');
assert.ok(!/uniforme/i.test(prompt), 'nada en el prompt sugiere que vendamos uniformes');
ok('la sección nueva no aporta material para inventar un producto inexistente');

// La instrucción anti-invención específica de este bloque.
assert.ok(/sin agregar detalles que no estén escritos aquí/.test(prompt), 'el bloque prohíbe completar por su cuenta');
assert.ok(/dilo con honestidad y ofrece conectar con la asesora/.test(prompt), 'y dice qué hacer en su lugar: derivar');
ok('el bloque nuevo trae su propia instrucción de no inventar + derivar');

// Los guardarraíles que ya existían siguen intactos con la sección nueva puesta.
assert.ok(/NUNCA compartas precios/.test(prompt), 'regla de precios');
assert.ok(/NUNCA NIEGUES UN PRODUCTO/.test(prompt), 'regla de no negar productos del menú');
assert.ok(/NUNCA confirmes, niegues ni des por hecho que alguien está inscrito/.test(prompt), 'guardarraíl de inscripción');
assert.ok(/PROHIBIDO dar fechas de pago, saldos, adeudos/.test(prompt), 'guardarraíl de pagos');
assert.ok(/\[DERIVAR_ASESOR:motivo\]/.test(prompt), 'la etiqueta de derivación sigue disponible');
ok('precios, no-negar, inscripción y pagos: los cuatro guardarraíles siguen en pie');

// ============================================================================
// E — la navegación determinística NO cambia (esto es aditivo)
// ============================================================================
console.log('\n== E. El menú determinístico sigue igual ==');
resetState();
DB_CONV.flowNode = 'menu_principal';
await handleMessage(msg('3'), 'pnid');
assert.strictEqual(PROMPTS.length, 0, 'elegir una opción NO llama al LLM');
assert.strictEqual(SENT.length, 1);
assert.ok(SENT[0].text.includes('selecciona la plataforma de tu interés'), 'salta a cat_3 con su texto verbatim');
assert.strictEqual(DB_CONV.flowNode, 'cat_3');
ok('"3" en menu_principal sigue navegando a cat_3 sin pasar por el LLM');

resetState();
DB_CONV.flowNode = 'cat_3';
await handleMessage(msg('3'), 'pnid');
assert.strictEqual(PROMPTS.length, 0);
assert.strictEqual(SENT[0].text, AINARA_TXT, 'y "3" en cat_3 sigue entregando AINARA verbatim');
assert.strictEqual(DB_CONV.flowNode, 'n_3_4');
ok('la ruta numerada hasta la hoja de producto es idéntica');

// ============================================================================
// F — fallback seguro
// ============================================================================
console.log('\n== F. Fallback seguro cuando "Flujo Ori" no carga ==');
flowRowsOverride = [];
assert.strictEqual(await buildFlowKnowledge(), null, 'sin filas → null, no una sección vacía');
prompt = await freeform('¿qué es AINARA?');
assert.ok(!prompt.includes('## INFORMACIÓN DE PRODUCTOS DEL MENÚ'), 'el prompt sale sin la sección');
assert.ok(prompt.includes('## CATÁLOGO COMPLETO'), 'pero el catálogo y las reglas siguen ahí');
assert.ok(/NUNCA NIEGUES UN PRODUCTO/.test(prompt));
ok('Sheet caído → prompt sin la sección, sin romper el turno');

flowRowsOverride = FULL_FLOW_ROWS.filter((r) => r.ID !== 'bienvenida'); // falta un nodo requerido
assert.strictEqual(await buildFlowKnowledge(), null, 'grafo incompleto → null (mismo criterio que el motor)');
ok('grafo sin nodos requeridos → también cede sin excepciones');

flowRowsOverride = null;
faqRowsOverride = [];
prompt = await freeform('¿qué es AINARA?');
assert.ok(prompt.includes(AINARA_TXT), 'sin FAQ, la sección del menú sigue llegando');
assert.ok(!prompt.includes('## PREGUNTAS FRECUENTES POR PROGRAMA'), 'y la de FAQ no aparece');
ok('las dos fuentes fallan por separado: una caída no se lleva a la otra');
faqRowsOverride = null;

console.log(`\nTODAS las verificaciones pasaron ✅  (${pass})`);
process.exit(0);
