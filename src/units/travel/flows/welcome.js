import * as sheetsCache from '../../../core/sheets/cache.js';
import logger from '../../../utils/logger.js';

/**
 * Welcome Flow - School Detection
 *
 * Detects school name in user messages and assigns school code to lead
 */

/**
 * Detects school from message text
 * Compares message against school names in Google Sheets (partial match, case-insensitive)
 *
 * @param {string} messageText - User message text
 * @returns {Promise<Object|null>} School object if detected, null otherwise
 */
export async function detectSchool(messageText) {
  const detectLogger = logger.child({ function: 'welcome.detectSchool' });

  if (!messageText) {
    return null;
  }

  try {
    // Get all schools from cache
    const schools = await sheetsCache.getAllSchools();

    if (schools.length === 0) {
      detectLogger.warn('No schools found in cache');
      return null;
    }

    // Normalize message for comparison
    const normalized = messageText.toLowerCase().trim();

    // Try to find a school match
    for (const school of schools) {
      if (!school.nombre) continue;

      const schoolName = school.nombre.toLowerCase();

      // Check for exact match or partial match
      if (normalized.includes(schoolName) || schoolName.includes(normalized)) {
        detectLogger.info({
          schoolCode: school.codigo,
          schoolName: school.nombre,
          messageText: messageText.substring(0, 50) + '...',
        }, 'School detected');

        return school;
      }

      // Also check against codigo
      if (school.codigo && normalized.includes(school.codigo.toLowerCase())) {
        detectLogger.info({
          schoolCode: school.codigo,
          schoolName: school.nombre,
        }, 'School detected by code');

        return school;
      }
    }

    detectLogger.debug('No school detected in message');
    return null;

  } catch (error) {
    detectLogger.error({ err: error }, 'Error detecting school');
    return null;
  }
}

/**
 * Checks if this is likely a first message from a new prospect
 * (heuristic: contains greeting words)
 *
 * @param {string} messageText - User message text
 * @returns {boolean} True if likely first message
 */
export function isLikelyFirstMessage(messageText) {
  if (!messageText) return false;

  const greetings = [
    'hola',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'buen día',
    'saludos',
    'qué tal',
    'me interesa',
    'información',
    'quisiera saber',
  ];

  const normalized = messageText.toLowerCase().trim();

  return greetings.some(greeting => normalized.includes(greeting));
}
