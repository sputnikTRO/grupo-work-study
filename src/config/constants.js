/**
 * Application-wide constants
 */

// Business Units
export const UNITS = {
  TRAVEL: 'travel',
  WORK_STUDY: 'work_study',
  OXFORD_EDUCATION: 'oxford_education',
};

// WhatsApp Message Limits
export const WHATSAPP = {
  MAX_MESSAGE_LENGTH: 4096,
  MAX_MESSAGES_PER_MINUTE: 30,
  MEDIA_TYPES: {
    IMAGE: 'image',
    DOCUMENT: 'document',
    AUDIO: 'audio',
    VIDEO: 'video',
  },
};

// Claude AI
export const CLAUDE = {
  MAX_TOKENS: 1024,
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
};

// Redis Keys Prefixes
export const REDIS_KEYS = {
  CONVERSATION_HISTORY: 'conversation:history',
  SHEETS_CACHE: 'sheets:cache',
  CONTACT_LOCK: 'lock:contact',
  ZOHO_ACCESS_TOKEN: 'zoho:access_token',
  RATE_LIMIT: 'rate_limit',
};

// Action Tags (used in Claude responses)
export const ACTION_TAGS = {
  SEND_MATERIAL: 'ENVIAR_MATERIAL',
  HANDOFF_ADVISOR: 'DERIVAR_ASESOR',
  CAPTURE_DATA: 'CAPTURAR_DATO',
  UPDATE_SCORE: 'ACTUALIZAR_SCORE',
  SCHEDULE_FOLLOWUP: 'PROGRAMAR_SEGUIMIENTO',
};

// Lead Scoring
export const SCORING = {
  MIN: 0,
  MAX: 10,
  COLD_MAX: 3,
  WARM_MIN: 4,
  WARM_MAX: 7,
  HOT_MIN: 8,
};

// Follow-up Configuration
export const FOLLOWUP = {
  MAX_ATTEMPTS: 3,
  INTERVALS: {
    FIRST: 24, // hours
    SECOND: 72, // hours
    THIRD: 168, // hours (7 days)
  },
};

// Conversation Status
export const CONVERSATION_STATUS = {
  ACTIVE: 'active',
  WAITING_HUMAN: 'waiting_human',
  CLOSED: 'closed',
  FOLLOW_UP: 'follow_up',
};

// Phone Number Format
export const PHONE = {
  MEXICO_COUNTRY_CODE: '+521',
  E164_REGEX: /^\+[1-9]\d{1,14}$/,
};

// Google Sheets
export const SHEETS = {
  SCOPES: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  RANGES: {
    SCHOOLS: 'Colegios!A:Z',
    TRIPS: 'Viajes!A:Z',
    ACTIVITIES: 'Actividades Extras!A:Z',
    MATERIALS: 'Materiales!A:Z',
    ADVISORS: 'Asesoras!A:Z',
    FAQ: 'FAQ!A:Z',
    CONFIG: 'Configuración!A:Z',
  },
};

export default {
  UNITS,
  WHATSAPP,
  CLAUDE,
  REDIS_KEYS,
  ACTION_TAGS,
  SCORING,
  FOLLOWUP,
  CONVERSATION_STATUS,
  PHONE,
  SHEETS,
};
