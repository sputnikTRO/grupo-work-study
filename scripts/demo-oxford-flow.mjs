/**
 * demo-oxford-flow.mjs — Recorrido de ejemplo del flujo determinístico de Ori
 * (feature/ori-flow-redesign), en texto legible. NO manda WhatsApp real, NO usa
 * DB/Redis real, NO llama a la API de Claude real — todo mockeado igual que
 * scripts/test-oxford-flow-handler.mjs, pero aquí se IMPRIME la conversación en
 * vez de solo assertions, para revisión humana.
 *
 * Uso: node --experimental-test-module-mocks scripts/demo-oxford-flow.mjs
 */
import { mock } from 'node:test';

const TRANSCRIPT = [];
let DB_CONV = { id: 'conv1', status: 'active', flowNode: null };
let DB_LEAD = {
  id: 'lead1', contactId: 'c1', temperature: 'nuevo', status: 'nuevo',
  tags: [], notes: null, assignedAdvisor: null, state: null, municipality: null,
  fullName: null, institutionName: null, primaryProduct: null, leadType: null, role: null,
};
let EXTRACT_RESULT = {};
let CHAT_REPLY = '';
let officeHoursOverride = true;

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
    chat: async (systemPrompt) => (systemPrompt.includes('extractor de datos') ? JSON.stringify(EXTRACT_RESULT) : CHAT_REPLY),
  },
});
mock.module('../src/config/env.js', {
  namedExports: {
    env: { OXED_FOREIGN_LEAD_FALLBACK: 'meeting_link', OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford', OXED_ADVISOR_TEMPLATE_LANG: 'es_MX' },
  },
});
mock.module('../src/core/database/client.js', { defaultExport: { oxfordLead: { groupBy: async () => [] } } });
mock.module('../src/services/contact.service.js', { namedExports: { findOrCreate: async () => ({ id: 'c1', name: null, phone: '+5215500000000' }) } });
mock.module('../src/services/conversation.service.js', {
  namedExports: {
    findActiveOrCreate: async () => ({ ...DB_CONV }),
    update: async (_id, data) => { Object.assign(DB_CONV, data); return { ...DB_CONV }; },
  },
});
mock.module('../src/services/message.service.js', { namedExports: { createInbound: async () => ({}), createOutbound: async () => ({}) } });
mock.module('../src/units/oxford-education/lead.service.js', {
  namedExports: {
    findOrCreateOxfordLead: async () => ({ ...DB_LEAD }),
    updateOxfordLead: async (_id, data) => { Object.assign(DB_LEAD, data); return { ...DB_LEAD }; },
    getOxfordLeadById: async () => ({ ...DB_LEAD }),
  },
});
mock.module('../src/units/oxford-education/store.js', {
  namedExports: { acquireContactLock: async () => true, releaseContactLock: async () => {}, getHistory: async () => [], formatForClaude: (h) => h, addMessage: async () => {} },
});
mock.module('../src/units/oxford-education/whatsapp.js', {
  namedExports: {
    sendTextMessage: async (_to, text) => { TRANSCRIPT.push({ who: 'Ori', text }); },
    sendTemplateMessage: async (to, name) => { TRANSCRIPT.push({ who: `[plantilla → asesor ${to}]`, text: `(${name})` }); },
    markMessageAsRead: async () => {},
  },
});
mock.module('../src/units/oxford-education/prompts.js', {
  namedExports: { buildFullPrompt: () => 'system prompt de Ori (mock)', HANDOFF_MEETING_URL: 'https://meetings.hubspot.com/camila-serafin-jimenez/' },
});
mock.module('../src/units/oxford-education/knowledge.js', { namedExports: { buildOxfordKnowledge: async () => null } });
mock.module('../src/units/oxford-education/sheets-sync.js', { namedExports: { syncOxfordLeadToSheet: async () => {}, deriveTemperature: () => 'warm' } });
mock.module('../src/units/oxford-education/office-hours.js', {
  namedExports: {
    isWithinOfficeHours: () => officeHoursOverride,
    OUT_OF_HOURS_NOTICE: 'las asesoras atienden de lunes a viernes de 9:00 a 18:00 (CDMX) y te contactarán en ese horario',
  },
});

function row(id, texto, opciones = {}, orden = 1) {
  const d = [1, 2, 3, 4, 5].map((n) => opciones[n] || '');
  return { ID: id, Estado: 'Vigente', Texto: texto, 'Destino opción 1': d[0], 'Destino opción 2': d[1], 'Destino opción 3': d[2], 'Destino opción 4': d[3], 'Destino opción 5': d[4], Notas: '', Orden: String(orden) };
}
const FLOW_ROWS = [
  row('bienvenida', '¡Hola! Gracias por escribir a Oxford Education Lit. Nuestro horario de atención es de lunes a viernes de 9:00 a 18:00 h. ¿En qué puedo apoyarte hoy?', {}, 1),
  row('filtro_previo', 'Para dirigir tu solicitud, cuéntame: ¿ya eres parte de Oxford Education Lit o buscas información?\n1.- Ya estoy inscrito / soy cliente\n2.- Quiero información', { 1: 'ya_inscrito_stub', 2: 'solicitud_datos' }, 2),
  row('ya_inscrito_stub', '¡Con gusto te apoyamos con tu proceso! ¿Me compartes tu nombre y el colegio o institución? Una asesora revisará tu caso y te dará seguimiento.', {}, 3),
  row('solicitud_datos', 'Para ayudarte mejor, ¿me compartes por favor:\n- Tu nombre y puesto (en caso de pertenecer a una institución)\n- Nombre de tu colegio o institución\n- Ciudad y estado', {}, 4),
  row('menu_principal', 'Oxford Education es una EdTech con más de 10 años de experiencia que acompaña a colegios con certificaciones de idiomas, plataformas digitales, programas STEAM y experiencias educativas internacionales, siempre alineadas a estándares internacionales. ¿Qué área te interesa conocer?\n1.- Certificaciones\n2.- Plataformas para aprendizaje del inglés\n3.- Plataformas para el aula\n4.- Experiencias internacionales\n5.- Exámenes diagnósticos de inglés', { 1: 'cat_1', 2: 'cat_2', 3: 'cat_3', 4: 'cat_4', 5: 'cat_5' }, 5),
  row('cat_1', 'Contamos con certificaciones y evaluaciones de inglés alineadas al MCER y con respaldo de la Association of Language Testers in Europe, para distintos niveles y edades. ¿Tu interés principal es:\n1.- Oxford TCC Kids (niños de 7 a 12 años)\n2.- Oxford TCC (A1-C2)\n3.- Oxford ETC (Certificación para docentes)\n4.- No estoy seguro', { 1: 'n_1_1', 2: 'n_1_2', 3: 'n_1_3', 4: 'n_1_4' }, 6),
  row('n_1_1', 'Oxford TCC Kids es la certificación para niños de 7 a 12 años, que mide las habilidades de inglés integralmente y está alineada al MCER. ¿Quieres recibir más información o agendar una llamada con un asesor?', {}, 7),
];
mock.module('../src/core/sheets/cache.js', { namedExports: { getOxfordFlowRows: async () => FLOW_ROWS } });

const { handleMessage } = await import('../src/units/oxford-education/handler.js');
const msg = (text) => ({ from: '5215500000000', id: `wamid.${Math.random()}`, type: 'text', text: { body: text } });

async function send(userText) {
  TRANSCRIPT.push({ who: 'Cliente', text: userText });
  await handleMessage(msg(userText), 'pnid');
}

function printTranscript(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
  for (const t of TRANSCRIPT) {
    console.log(`\n[${t.who}]`);
    console.log(t.text);
  }
  TRANSCRIPT.length = 0;
}

// ── 1) Camino feliz completo ────────────────────────────────────────────────
DB_CONV = { id: 'conv1', status: 'active', flowNode: null };
DB_LEAD = { id: 'lead1', contactId: 'c1', temperature: 'nuevo', status: 'nuevo', tags: [], notes: null, assignedAdvisor: null, state: null, municipality: null, fullName: null, institutionName: null, primaryProduct: null, leadType: null, role: null };
officeHoursOverride = true;

await send('Hola');
await send('2'); // quiero información
EXTRACT_RESULT = { full_name: 'Ana López', role: 'Coordinadora académica', institution_name: 'Colegio Test', state: 'Jalisco', municipality: 'Guadalajara' };
await send('Soy Ana López, coordinadora del Colegio Test, en Guadalajara, Jalisco');
await send('1'); // Certificaciones
await send('1'); // Oxford TCC Kids
await send('Sí, me interesa hablar con un asesor');

printTranscript('RECORRIDO 1 — Camino feliz completo (bienvenida → filtro → datos → menú → categoría → producto → CTA → handoff)');
console.log(`\n[estado final] conversation.flowNode = ${JSON.stringify(DB_CONV.flowNode)}`);
console.log(`[estado final] lead.zoneKey = ${DB_LEAD.zoneKey} · lead.assignedAdvisor = ${DB_LEAD.assignedAdvisor}`);

// ── 2) Caso de texto libre (respaldo LLM, no rompe el flujo) ───────────────
DB_CONV = { id: 'conv2', status: 'active', flowNode: 'cat_1' }; // conversación YA en curso, en cat_1
DB_LEAD = { id: 'lead2', contactId: 'c2', temperature: 'warm', status: 'nuevo', tags: [], notes: null, assignedAdvisor: null, state: null, municipality: null, fullName: null, institutionName: null, primaryProduct: null, leadType: null, role: null };
CHAT_REPLY = 'Claro, te cuento: el proceso de certificación tiene 3 etapas (diagnóstico, mock y certificación), todo en línea 😊';

await send('oye, ¿cuánto dura el proceso de certificación?');

printTranscript('RECORRIDO 2 — Texto libre en medio del flujo (respaldo LLM + recordatorio de "Menú")');
console.log(`\n[estado final] conversation.flowNode = ${JSON.stringify(DB_CONV.flowNode)} (NO cambió — el respaldo no rompe el flujo)`);

process.exit(0);
