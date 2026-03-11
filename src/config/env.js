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

  // Claude API
  ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),
  ANTHROPIC_MODEL: optionalEnv('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514'),

  // Google Sheets
  GOOGLE_SHEETS_ID: requireEnv('GOOGLE_SHEETS_ID'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
  GOOGLE_PRIVATE_KEY: requireEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),

  // Bot Configuration
  SHEETS_CACHE_TTL_SECONDS: parseInt(optionalEnv('SHEETS_CACHE_TTL_SECONDS', '300'), 10),
  CONVERSATION_CONTEXT_TTL_SECONDS: parseInt(optionalEnv('CONVERSATION_CONTEXT_TTL_SECONDS', '3600'), 10),
  MAX_CONVERSATION_HISTORY: parseInt(optionalEnv('MAX_CONVERSATION_HISTORY', '20'), 10),
  CONTACT_LOCK_TTL_SECONDS: parseInt(optionalEnv('CONTACT_LOCK_TTL_SECONDS', '30'), 10),

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
