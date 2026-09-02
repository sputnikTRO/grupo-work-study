/**
 * Demo legible del flujo determinístico de Miri (feature/miri-flow).
 *
 * Corre el handler REAL de travel turno a turno con la misma infraestructura
 * mockeada que scripts/test-miri-flow-handler.mjs (DB/Redis/WhatsApp/Claude/
 * Sheets), pero sin asserts: imprime la conversación como la vería el prospecto,
 * más el estado interno (flowNode, lead, asesora asignada) después de cada turno.
 *
 * Sirve para revisión humana del guion, no como prueba.
 *
 * Uso: node --experimental-test-module-mocks scripts/demo-miri-flow.mjs
 */
import { mock } from 'node:test';

const SENT = [];
const MEDIA_SENT = [];
const TEMPLATES_SENT = [];
let DB_CONV = { id: 'conv1', contactId: 'c1', status: 'active', flowNode: null, interestScore: 0 };
let DB_LEAD = {
  id: 'lead1', contactId: 'c1', status: 'nuevo', ticketNumber: 87,
  parentName: null, travelerName: null, travelerAge: null, schoolCode: null,
  destination: null, programInterest: null, leadType: null, assignedAdvisor: null,
  materialsSent: [], notes: null,
};
let EXTRACT_RESULT = {};

const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', { namedExports: { normalizePhone: (p) => (String(p).startsWith('+') ? String(p) : `+521${p}`) } });
mock.module('../src/core/whatsapp/parser.js', { namedExports: { extractMessageContent: (m) => ({ text: m.text?.body ?? '', type: 'text', mediaUrl: null }) } });
mock.module('../src/core/ai/claude.js', {
  namedExports: { chat: async (sp) => (sp.includes('extractor de datos') ? JSON.stringify(EXTRACT_RESULT) : 'Con gusto 😊') },
});
mock.module('../src/core/ai/conversation.js', { namedExports: { getHistory: async () => [], formatForClaude: (h) => h, addMessage: async () => {} } });
mock.module('../src/core/database/redis.js', { defaultExport: { acquireContactLock: async () => true, releaseContactLock: async () => {} } });
mock.module('../src/core/database/client.js', { defaultExport: { travelLead: { groupBy: async () => [] } } });
mock.module('../src/core/whatsapp/client.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { SENT.push(text); },
    sendTemplateMessage: async (to, name) => { TEMPLATES_SENT.push({ to, name }); },
    sendMediaMessage: async (to, type, mediaId, c, filename) => { MEDIA_SENT.push({ mediaId, filename }); },
    sendMediaMessageByUrl: async () => {},
  },
});
mock.module('../src/core/whatsapp/media-uploader.js', { namedExports: { getOrUploadMedia: async (id) => `media-${id}`, getMimeType: () => 'application/pdf' } });
mock.module('../src/services/contact.service.js', { namedExports: { findOrCreate: async () => ({ id: 'c1', name: null, phone: '+5215500000000' }), update: async () => ({}) } });
mock.module('../src/services/conversation.service.js', {
  namedExports: {
    findActiveOrCreate: async () => ({ ...DB_CONV }),
    update: async (_id, d) => { Object.assign(DB_CONV, d); return { ...DB_CONV }; },
    updateInterestScore: async (_id, s) => { DB_CONV.interestScore = s; },
  },
});
mock.module('../src/services/message.service.js', { namedExports: { createInbound: async () => ({}), createOutbound: async () => ({}) } });
mock.module('../src/services/lead.service.js', {
  namedExports: {
    findOrCreateTravelLead: async () => ({ ...DB_LEAD }),
    updateTravelLead: async (_id, d) => { Object.assign(DB_LEAD, d); return { ...DB_LEAD }; },
    updateTravelLeadStatus: async (_id, s) => { DB_LEAD.status = s; return { ...DB_LEAD }; },
    getTravelLeadById: async () => ({ ...DB_LEAD }),
    addMaterialSent: async (_id, m) => { DB_LEAD.materialsSent = [...DB_LEAD.materialsSent, m]; },
  },
});
mock.module('../src/core/sheets/leads-sync.js', { namedExports: { syncLeadToSheet: async () => {} } });
mock.module('../src/units/travel/prompts.js', { namedExports: { buildFullPrompt: () => 'mock' } });
mock.module('../src/units/travel/knowledge.js', { namedExports: { buildDynamicKnowledge: async () => '' } });
mock.module('../src/core/flow/office-hours.js', { namedExports: { isWithinOfficeHours: () => true, OUT_OF_HOURS_NOTICE: '' } });
mock.module('../src/core/sheets/client.js', {
  namedExports: {
    readRange: async () => [
      ['CON PAGO COMPLETO DEL PROGRAMA HASTA EL 31 DE MARZO 2027', '', '', '', '', 'ABRIL - JUNIO (CON APARTADO DE 15K)'],
      ['INSTITUTO', 'DESTINO', 'MODALIDAD', 'PRECIO PROGRAMA', 'PRECIO VUELO', 'PRECIO PROGRAMA', 'PRECIO VUELO'],
      ['Colegio The Hills Institute', 'Londres', 'Homestay', '29990', '35000', '34990', '35000'],
    ],
  },
});

// Grafo: se leen las filas REALES de la pestaña "Flujo Miri" (solo lectura), así
// la demo recorre el contenido que de verdad está sembrado, no una copia.
const FLOW_ROWS = await loadRealFlowRows();
mock.module('../src/core/sheets/cache.js', {
  namedExports: {
    getTravelFlowRows: async () => FLOW_ROWS,
    getMaterial: async (id) => ({ ID: id, Nombre: `${id}.pdf`, Tipo: 'PDF', URL: 'https://drive.google.com/uc?id=x' }),
    getSchool: async (n) => ({ 'Nombre Colegio': n }),
    getAllSchools: async () => [], getConfig: async () => null, getActiveTrips: async () => [],
    getMaterials: async () => [], getActivities: async () => [], getInfoGeneral: async () => [],
    getFAQ: async () => [], getAdvisor: async () => null, getSchoolByName: async () => null, getPrice: async () => null,
  },
});

const { handleMessage } = await import('../src/units/travel/handler.js');


/** Lee la pestaña "Flujo Miri" en vivo (solo lectura) y la devuelve como filas objeto. */
async function loadRealFlowRows() {
  const { google } = await import('googleapis');
  const dotenv = await import('dotenv');
  dotenv.default.config();

  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  );
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "'Flujo Miri'!A:K",
  });
  const [header, ...rows] = resp.data.values || [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', C = '\x1b[36m', R = '\x1b[0m';

async function turn(text, extract = {}) {
  EXTRACT_RESULT = extract;
  SENT.length = 0;
  MEDIA_SENT.length = 0;
  const before = TEMPLATES_SENT.length;

  console.log(`\n${C}👤 Prospecto:${R} ${text}`);
  await handleMessage({ from: '5215500000000', id: `wamid.${Math.random()}`, type: 'text', text: { body: text } }, 'pnid');

  for (const t of SENT) console.log(`${G}🤖 Miri:${R} ${t.split('\n').join(`\n         `)}`);
  for (const m of MEDIA_SENT) console.log(`${G}📎 Archivo:${R} ${m.filename} (${m.mediaId})`);
  if (TEMPLATES_SENT.length > before) console.log(`${D}   📨 [notificación a la asesora por plantilla WhatsApp]${R}`);
  console.log(`${D}   └─ flowNode=${DB_CONV.flowNode} · colegio=${DB_LEAD.schoolCode ?? '—'} · asesora=${DB_LEAD.assignedAdvisor ?? '—'} · status=${DB_LEAD.status}${R}`);
}

console.log(`${B}\n══════ Conversación completa: bienvenida → datos → colegio → menú → E4L → precio → handoff ══════${R}`);

await turn('Hola, buenas tardes');
await turn('2');
await turn('Soy Laura Méndez, mi hijo Diego tiene 15 años', { parent_name: 'Laura Méndez', traveler_name: 'Diego Méndez', traveler_age: '15' });
await turn('The Hills', { school_code: 'The Hills' });
await turn('1');
await turn('1');
await turn('1');

console.log(`${B}\n══════ Después de derivar: Miri sigue viva (handoff tibio) ══════${R}`);
await turn('¿el seguro médico cubre hospitalización?');
await turn('Menú');

console.log('');
