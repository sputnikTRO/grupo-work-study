/**
 * Demo legible de la rama "ya inscrito" de Miri (feature/miri-flow).
 *
 * Corre el handler REAL turno a turno con la infraestructura mockeada, contra una
 * hoja de inscritos FICTICIA que espeja la estructura de la real (registro con el
 * WhatsApp del papá + pestañas de pago con encabezados en posiciones distintas).
 *
 * Ningún dato real: los nombres, teléfonos y montos son inventados.
 *
 * Uso: node --experimental-test-module-mocks scripts/demo-miri-ya-inscrito.mjs
 */
import { mock } from 'node:test';

const SENT = [];
const TEMPLATES_SENT = [];
let DB_CONV, DB_LEAD, EXTRACT_RESULT = {}, FROM = '5215500000000';

function resetState() {
  SENT.length = 0;
  TEMPLATES_SENT.length = 0;
  DB_CONV = { id: 'conv1', contactId: 'c1', status: 'active', flowNode: null, interestScore: 0 };
  DB_LEAD = {
    id: 'lead1', contactId: 'c1', status: 'nuevo', ticketNumber: 91,
    parentName: null, travelerName: null, travelerAge: null, schoolCode: null,
    destination: null, programInterest: null, leadType: null, assignedAdvisor: null,
    materialsSent: [], notes: null,
  };
  EXTRACT_RESULT = {};
}
resetState();

const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
logger.child = () => logger;

mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/utils/phone.js', {
  namedExports: {
    normalizePhone: (p) => {
      const d = String(p).replace(/\D/g, '');
      if (d.startsWith('52')) return `+${d}`;
      if (d.length === 10) return `+521${d}`;
      return `+${d}`;
    },
  },
});
mock.module('../src/core/whatsapp/parser.js', { namedExports: { extractMessageContent: (m) => ({ text: m.text?.body ?? '', type: 'text', mediaUrl: null }) } });
mock.module('../src/core/ai/claude.js', { namedExports: { chat: async (sp) => (sp.includes('extractor de datos') ? JSON.stringify(EXTRACT_RESULT) : 'Con gusto 😊') } });
mock.module('../src/core/ai/conversation.js', { namedExports: { getHistory: async () => [], formatForClaude: (h) => h, addMessage: async () => {} } });
mock.module('../src/core/database/redis.js', { defaultExport: { acquireContactLock: async () => true, releaseContactLock: async () => {} } });
mock.module('../src/core/database/client.js', { defaultExport: { travelLead: { groupBy: async () => [] } } });
mock.module('../src/core/whatsapp/client.js', {
  namedExports: {
    sendTextMessage: async (to, text) => { SENT.push(text); },
    sendTemplateMessage: async (to, name, lang, c) => { TEMPLATES_SENT.push({ name, params: c[0].parameters.map((p) => p.text) }); },
    sendMediaMessage: async () => {}, sendMediaMessageByUrl: async () => {},
  },
});
mock.module('../src/core/whatsapp/media-uploader.js', { namedExports: { getOrUploadMedia: async (id) => `media-${id}`, getMimeType: () => 'application/pdf' } });
mock.module('../src/services/contact.service.js', { namedExports: { findOrCreate: async () => ({ id: 'c1', name: null, phone: '+5215500000000' }), update: async () => ({}) } });
mock.module('../src/services/conversation.service.js', {
  namedExports: {
    findActiveOrCreate: async () => ({ ...DB_CONV }),
    update: async (_i, d) => { Object.assign(DB_CONV, d); return { ...DB_CONV }; },
    updateInterestScore: async (_i, s) => { DB_CONV.interestScore = s; },
  },
});
mock.module('../src/services/message.service.js', { namedExports: { createInbound: async () => ({}), createOutbound: async () => ({}) } });
mock.module('../src/services/lead.service.js', {
  namedExports: {
    findOrCreateTravelLead: async () => ({ ...DB_LEAD }),
    updateTravelLead: async (_i, d) => { Object.assign(DB_LEAD, d); return { ...DB_LEAD }; },
    updateTravelLeadStatus: async (_i, s) => { DB_LEAD.status = s; return { ...DB_LEAD }; },
    getTravelLeadById: async () => ({ ...DB_LEAD }),
    addMaterialSent: async () => {},
  },
});
mock.module('../src/core/sheets/leads-sync.js', { namedExports: { syncLeadToSheet: async () => {} } });
mock.module('../src/units/travel/prompts.js', { namedExports: { buildFullPrompt: () => 'mock' } });
mock.module('../src/units/travel/knowledge.js', { namedExports: { buildDynamicKnowledge: async () => '' } });
mock.module('../src/core/flow/office-hours.js', { namedExports: { isWithinOfficeHours: () => true, OUT_OF_HOURS_NOTICE: '' } });
mock.module('../src/config/env.js', {
  namedExports: {
    env: {
      TRAVEL_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_travel', TRAVEL_ADVISOR_TEMPLATE_LANG: 'es_MX',
      TRAVEL_ADVISOR_TEMPLATE_V2: '', TRAVEL_PRICES_SHEETS_ID: 'sheet-precios',
      TRAVEL_ENROLLMENT_SHEETS_ID: 'sheet-inscritos', SHEETS_CACHE_TTL_SECONDS: 3600,
    },
  },
});

// ── Hoja de inscritos FICTICIA (misma forma que la real) ────────────────────
const REGISTRO = [
  ['Marca temporal', 'Nombre completo del estudiante (Nombre, segundo nombre, primer apellido, segundo apellido):', 'Edad:', 'Nombre del Colegio:', 'Nombre completo (Nombre, segundo nombre, primer apellido, segundo apellido):', 'Correo electrónico del Padre/Madre o Tutor:', 'Celular / Whatsapp:'],
  ['x', 'Diego Méndez Ruiz', '15', 'Colegio The Hills Institute', 'Laura Méndez Soto', 'l@x.com', '5533445566'],
  ['x', 'Sofía Ramos Lara', '14', 'Colegio Arista', 'Ana Ramos Díaz', 'a@x.com', '+52 55 7788 9900'],
  ['x', 'Mateo Cruz Vega', '13', 'UTEC', 'Jorge Cruz Ríos', 'j@x.com', '55 1122 3344'],
  ['x', 'Emilia Cruz Vega', '16', 'UTEC', 'Jorge Cruz Ríos', 'j@x.com', '5511223344'],
];
const PAGOS_A = [
  ['', 'CONTRATO', 'INSTITUCIÓN', 'ALUMNO', 'NIVEL', 'EDAD', 'GÉNERO', 'SEGURO', 'TOTAL A PAGAR', 'ABRIL', 'FECHA', 'LLEVAN PAGADO', 'FALTA POR PAGAR'],
  ['1', 'TRUE', 'The Hills', 'Diego Méndez Ruiz', '3', '15', 'M', 'SI', '64990', '15000', '01/04/2026', '15000', '49990'],
];
const PAGOS_B = [
  ['', 'INSTITUCIÓN', 'ALUMNO', 'EDAD', 'TOTAL A PAGAR', 'MARZO', 'FECHA', 'LLEVAN PAGADO', 'FALTA POR PAGAR'],
  ['1', 'UTEC', 'Emilia Cruz Vega', '16', '64990', '30000', '01/03/2026', '30000', '34990'],
];
const ENROLL = {
  'REGISTRO GENERAL ': REGISTRO,
  'INSCRITOS LONDRES THE HILLS 64,990': PAGOS_A,
  'INSCRITOS DUBLIN UTEC 64,990': PAGOS_B,
};
mock.module('../src/core/sheets/client.js', {
  namedExports: {
    readRange: async (id, range) => (id === 'sheet-precios' ? [] : ENROLL[String(range).replace(/^'|'$/g, '')] || []),
    getSpreadsheetMetadata: async () => ({ sheets: Object.keys(ENROLL).map((title) => ({ title })) }),
  },
});

function row(id, texto, opciones = {}, orden = 1) {
  const d = [1, 2, 3, 4, 5].map((n) => opciones[n] || '');
  return { ID: id, Estado: 'Vigente', Texto: texto, 'Destino opción 1': d[0], 'Destino opción 2': d[1], 'Destino opción 3': d[2], 'Destino opción 4': d[3], 'Destino opción 5': d[4], Notas: '', Orden: String(orden), Material: '' };
}
const FLOW = [
  row('bienvenida', '¡Hola! Soy Miri, del equipo de Oxford Education & Travel ✈️', {}, 1),
  row('filtro_previo', 'Para orientarte mejor, cuéntame: ¿ya estás inscrito o buscas información?\n1.- Ya estoy inscrito\n2.- Busco información', { 1: 'ya_inscrito', 2: 'solicitud_datos' }, 2),
  row('ya_inscrito', '¡Con gusto te apoyamos con tu proceso! ¿Me compartes tu nombre y el colegio de tu hijo o hija?', {}, 3),
  row('solicitud_datos', '¿Me compartes tu nombre y la edad de tu hijo?', {}, 4),
  row('menu_principal', 'Menú principal\n1.- English 4 Life', { 1: 'cat_e4l' }, 5),
  row('ya_inscrito_sin_pago', '¡Gracias{{nombre}}! 🙌 Ya te tengo en el registro de English 4 Life.\n\nPara el siguiente paso de tu proceso te conecto con tu asesora, que revisa tu caso y te escribe en breve.', {}, 6),
  row('ya_inscrito_estatus', 'Esto es lo que tengo de {{alumno}} 📋\n\nTotal del programa: {{total_a_pagar}}\nLlevas pagado: {{llevan_pagado}}\nFalta por pagar: {{falta_por_pagar}}\n\n¿Te conecto con tu asesora para ver las fechas de tus siguientes pagos?\n1.- Sí, por favor\n2.- Todavía no, gracias', { 1: 'handoff_colegio', 2: 'util_menu' }, 7),
  row('handoff_colegio', 'Te conecto con {{asesora}}.', {}, 8),
  row('util_menu', 'Escribe "Menú" cuando quieras.', {}, 9),
];
mock.module('../src/core/sheets/cache.js', {
  namedExports: {
    getTravelFlowRows: async () => FLOW,
    getMaterial: async () => null, getSchool: async (n) => ({ 'Nombre Colegio': n }),
    getAllSchools: async () => [], getConfig: async () => null, getActiveTrips: async () => [],
    getMaterials: async () => [], getActivities: async () => [], getInfoGeneral: async () => [],
    getFAQ: async () => [], getAdvisor: async () => null, getSchoolByName: async () => null, getPrice: async () => null,
  },
});

const { handleMessage } = await import('../src/units/travel/handler.js');
const { __resetCache } = await import('../src/units/travel/enrollment.js');

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', C = '\x1b[36m', R = '\x1b[0m';

async function turn(text, extract = {}) {
  EXTRACT_RESULT = extract;
  SENT.length = 0;
  const before = TEMPLATES_SENT.length;
  console.log(`\n${C}👤 Papá (${FROM}):${R} ${text}`);
  await handleMessage({ from: FROM, id: `wamid.${Math.random()}`, type: 'text', text: { body: text } }, 'pnid');
  for (const t of SENT) console.log(`${G}🤖 Miri:${R} ${t.split('\n').join('\n         ')}`);
  if (TEMPLATES_SENT.length > before) {
    const p = TEMPLATES_SENT[TEMPLATES_SENT.length - 1].params;
    console.log(`${D}   📨 ticket a la asesora → motivo: "${p[7]}"${R}`);
  }
  console.log(`${D}   └─ flowNode=${DB_CONV.flowNode} · alumno=${DB_LEAD.travelerName ?? '—'} · asesora=${DB_LEAD.assignedAdvisor ?? '—'} · status=${DB_LEAD.status}${R}`);
}

async function escenario(titulo, from, pasos) {
  resetState(); __resetCache(); FROM = from;
  console.log(`${B}\n══════ ${titulo} ══════${R}`);
  for (const [text, extract] of pasos) await turn(text, extract);
}

await escenario('Desenlace 3 — inscrito CON pagos', '5215533445566', [['Hola'], ['1'], ['1']]);
await escenario('Desenlace 2 — registrado SIN fila de pagos', '5215577889900', [['Hola'], ['1']]);
await escenario('Varios hijos — pregunta cuál antes de mostrar', '5215511223344', [['Hola'], ['1'], ['2']]);
await escenario('Desenlace 1 — teléfono NO registrado', '5219999999999', [['Hola'], ['1'], ['Ana Ruiz, Colegio Arista', { parent_name: 'Ana Ruiz', school_code: 'Colegio Arista' }]]);

console.log('');
