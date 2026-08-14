import dotenv from 'dotenv';

dotenv.config();

/**
 * Validates that a required environment variable is set
 * @param {string} name - Name of the environment variable
 * @returns {string} The value of the environment variable
 * @throws {Error} If the environment variable is not set
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Gets an optional environment variable with a default value
 * @param {string} name - Name of the environment variable
 * @param {string} defaultValue - Default value if not set
 * @returns {string} The value or default
 */
function optionalEnv(name, defaultValue) {
  return process.env[name] || defaultValue;
}

// Export validated environment variables
export const env = {
  // Server
  PORT: parseInt(optionalEnv('PORT', '3000'), 10),
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),

  // Database
  DATABASE_URL: requireEnv('DATABASE_URL'),

  // Redis
  REDIS_URL: requireEnv('REDIS_URL'),

  // WhatsApp Meta Cloud API
  WA_VERIFY_TOKEN: requireEnv('WA_VERIFY_TOKEN'),
  WA_ACCESS_TOKEN: requireEnv('WA_ACCESS_TOKEN'),
  WA_PHONE_NUMBER_ID_TRAVEL: requireEnv('WA_PHONE_NUMBER_ID_TRAVEL'),
  WA_API_VERSION: optionalEnv('WA_API_VERSION', 'v21.0'),

  // WhatsApp - Fase 2 y 3 (optional)
  WA_PHONE_NUMBER_ID_WORK_STUDY: process.env.WA_PHONE_NUMBER_ID_WORK_STUDY,
  WA_PHONE_NUMBER_ID_OXFORD: process.env.WA_PHONE_NUMBER_ID_OXFORD,

  // ── Oxford Education (Fase 3) — número y credenciales propias, aisladas de Miri/Travel
  // Estas variables habilitan la unidad Oxford. Si OXED_PHONE_NUMBER_ID no está
  // presente, la unidad queda inactiva (el router no enruta mensajes hacia ella y
  // el webhook /webhook/oxford rechaza la verificación).
  OXED_PHONE_NUMBER_ID: process.env.OXED_PHONE_NUMBER_ID,
  OXED_WABA_ID: process.env.OXED_WABA_ID,
  OXED_ACCESS_TOKEN: process.env.OXED_ACCESS_TOKEN,
  OXED_VERIFY_TOKEN: process.env.OXED_VERIFY_TOKEN,

  // Oxford lead logging to Google Sheets (separate from Travel data).
  // OXED_SHEETS_ID defaults to the shared spreadsheet but the Oxford rows live in
  // their own dedicated tab (OXED_LEADS_SHEET_NAME), so data is never mixed with
  // Travel's "Leads" tab. Point OXED_SHEETS_ID at a different spreadsheet to fully
  // separate the file (must be shared with the service account).
  OXED_SHEETS_ID: optionalEnv('OXED_SHEETS_ID', requireEnv('GOOGLE_SHEETS_ID')),
  OXED_LEADS_SHEET_NAME: optionalEnv('OXED_LEADS_SHEET_NAME', 'Leads Oxford'),
  OXED_HANDOFF_MEETING_URL: optionalEnv('OXED_HANDOFF_MEETING_URL', 'https://meetings.hubspot.com/camila-serafin-jimenez/'),
  // Notificación al asesor por PLANTILLA aprobada (se entrega fuera de la ventana
  // de 24h, a diferencia del texto libre). Si el envío por plantilla falla
  // (p.ej. aún no aprobada), notifyAdvisor cae a texto libre como respaldo.
  OXED_ADVISOR_TEMPLATE_NAME: optionalEnv('OXED_ADVISOR_TEMPLATE_NAME', 'nuevo_lead_oxford'),
  OXED_ADVISOR_TEMPLATE_LANG: optionalEnv('OXED_ADVISOR_TEMPLATE_LANG', 'es_MX'),
  // feature/ori-advisor-sla: plantilla nueva 'nuevo_lead_oxford_sla' (mismas 8
  // variables que OXED_ADVISOR_TEMPLATE_NAME + instrucción ATIENDO), creada vía
  // Graph API y enviada a revisión de Meta (status PENDING al momento de crearla).
  // SIN DEFAULT a propósito: mientras esté vacía, notifyAdvisor sigue usando
  // OXED_ADVISOR_TEMPLATE_NAME exactamente como hoy (cero cambio de
  // comportamiento). Cuando Meta la apruebe, setear:
  //   OXED_ADVISOR_SLA_TEMPLATE=nuevo_lead_oxford_sla
  // El fallback a texto libre (que YA incluye la instrucción ATIENDO) se
  // conserva sin cambios si el envío por cualquiera de las dos plantillas falla.
  OXED_ADVISOR_SLA_TEMPLATE: optionalEnv('OXED_ADVISOR_SLA_TEMPLATE', ''),
  // TODO(cliente): manejo definitivo de leads internacionales (fuera de México).
  // 'A'|'B'|'C'|'D' → deriva a esa dupla default (handoff activo).
  // 'meeting_link' (default) → comparte el link de agenda y deja la conversación activa (pasivo).
  OXED_FOREIGN_LEAD_FALLBACK: optionalEnv('OXED_FOREIGN_LEAD_FALLBACK', 'meeting_link'),
  // SLA de confirmación del asesor (feature/ori-advisor-sla): minutos que tiene el
  // asesor asignado para responder ATIENDO antes de que advisor-sla.job.js lo
  // reasigne automáticamente a la siguiente asesora. Ver src/units/oxford-education/advisor-sla.js.
  OXED_ADVISOR_SLA_MINUTES: parseInt(optionalEnv('OXED_ADVISOR_SLA_MINUTES', '10'), 10),

  // Claude API
  ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),
  ANTHROPIC_MODEL: optionalEnv('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),

  // Google Sheets
  GOOGLE_SHEETS_ID: requireEnv('GOOGLE_SHEETS_ID'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
  GOOGLE_PRIVATE_KEY: requireEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),

  // Bot Configuration
  SHEETS_CACHE_TTL_SECONDS: parseInt(optionalEnv('SHEETS_CACHE_TTL_SECONDS', '300'), 10),
  CONVERSATION_CONTEXT_TTL_SECONDS: parseInt(optionalEnv('CONVERSATION_CONTEXT_TTL_SECONDS', '86400'), 10),
  MAX_CONVERSATION_HISTORY: parseInt(optionalEnv('MAX_CONVERSATION_HISTORY', '40'), 10),
  CONTACT_LOCK_TTL_SECONDS: parseInt(optionalEnv('CONTACT_LOCK_TTL_SECONDS', '30'), 10),

  // Travel Bot Configuration (moved from Google Sheets "Configuración" tab)
  HANDOFF_SCORE_THRESHOLD: parseInt(optionalEnv('HANDOFF_SCORE_THRESHOLD', '8'), 10),
  MAX_FOLLOW_UPS: parseInt(optionalEnv('MAX_FOLLOW_UPS', '3'), 10),
  // Notificación al asesor de Travel por PLANTILLA aprobada (entrega fuera de la
  // ventana de 24h). Debe existir/aprobarse en la WABA de Travel. Si falla, cae a texto.
  TRAVEL_ADVISOR_TEMPLATE_NAME: optionalEnv('TRAVEL_ADVISOR_TEMPLATE_NAME', 'nuevo_lead_travel'),
  TRAVEL_ADVISOR_TEMPLATE_LANG: optionalEnv('TRAVEL_ADVISOR_TEMPLATE_LANG', 'es_MX'),

  // Zoho CRM (optional - Fase 2 y 3)
  ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  ZOHO_REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  ZOHO_API_DOMAIN: process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com',
  ZOHO_ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com',
  ZOHO_WEBHOOK_SECRET: process.env.ZOHO_WEBHOOK_SECRET,
  ZOHO_SYNC_INTERVAL_MS: parseInt(process.env.ZOHO_SYNC_INTERVAL_MS || '900000', 10),
  ZOHO_NOTE_SYNC_EVERY_N_MESSAGES: parseInt(process.env.ZOHO_NOTE_SYNC_EVERY_N_MESSAGES || '5', 10),
  ZOHO_RATE_LIMIT_PER_10S: parseInt(process.env.ZOHO_RATE_LIMIT_PER_10S || '25', 10),
};

// Validate critical configuration
if (env.NODE_ENV === 'production') {
  // Additional production checks
  if (!env.DATABASE_URL.includes('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  }
}

export default env;
