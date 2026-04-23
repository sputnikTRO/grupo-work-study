import { readMultipleSheets } from './client.js';
import redis from '../database/redis.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Google Sheets Cache Manager
 *
 * Caches all sheet data in Redis with TTL
 * Provides accessor functions that read from cache (not directly from Sheets)
 * If Google Sheets fails, uses last cached data
 */

const SHEET_NAMES = [
  'Colegios',
  'Viajes',
  'Actividades',
  'Materiales',
  'Asesoras',
  'Esquemas de Pago',
  'FAQ',
  'Configuración',
];

let lastSuccessfulCache = {}; // Backup in-memory cache

/**
 * Loads all sheets into Redis cache
 * Called on server startup and periodically by the sync job
 *
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function loadCache() {
  const cacheLogger = logger.child({ function: 'sheets.loadCache' });

  try {
    cacheLogger.info('Loading Google Sheets data into cache');

    const sheetsData = await readMultipleSheets(env.GOOGLE_SHEETS_ID, SHEET_NAMES);

    // Store each sheet in Redis
    for (const [sheetName, data] of Object.entries(sheetsData)) {
      await redis.setSheetsCache(sheetName, data);
    }

    // Update in-memory backup
    lastSuccessfulCache = { ...sheetsData, timestamp: new Date().toISOString() };

    cacheLogger.info({
      sheetCount: Object.keys(sheetsData).length,
      totalRows: Object.values(sheetsData).reduce((sum, arr) => sum + arr.length, 0),
    }, 'Cache loaded successfully');

    return true;

  } catch (error) {
    cacheLogger.error({ err: error }, 'Error loading cache from Google Sheets');

    // If we have a backup cache, log warning but don't fail
    if (Object.keys(lastSuccessfulCache).length > 0) {
      cacheLogger.warn('Using last successful cache from ' + lastSuccessfulCache.timestamp);
    }

    return false;
  }
}

/**
 * Force refresh of cache
 *
 * @returns {Promise<boolean>} True if successful
 */
export async function refreshCache() {
  logger.info('Force refreshing cache');
  return await loadCache();
}

/**
 * Gets data from cache (or backup if cache fails)
 *
 * @param {string} sheetName - Sheet name
 * @returns {Promise<Array>} Array of objects
 */
async function getCachedSheet(sheetName) {
  try {
    const data = await redis.getSheetsCache(sheetName);

    if (data) {
      return data;
    }

    // Fallback to in-memory backup
    logger.warn({ sheetName }, 'Cache miss, using backup');
    return lastSuccessfulCache[sheetName] || [];

  } catch (error) {
    logger.error({ err: error, sheetName }, 'Error getting cached sheet');
    return lastSuccessfulCache[sheetName] || [];
  }
}

/**
 * Gets all active trips
 *
 * @returns {Promise<Array>} Array of trip objects with status="activo"
 */
export async function getActiveTrips() {
  const trips = await getCachedSheet('Viajes');
  return trips.filter(trip => trip.status?.toLowerCase() === 'activo');
}

/**
 * Gets school by code
 *
 * @param {string} code - School code (e.g., 'WC', 'TH', 'CW')
 * @returns {Promise<Object|null>} School object or null
 */
export async function getSchool(code) {
  if (!code) return null;

  const schools = await getCachedSheet('Colegios');
  return schools.find(school =>
    school.codigo?.toUpperCase() === code.toUpperCase()
  ) || null;
}

/**
 * Gets school by name (partial match, case-insensitive)
 *
 * @param {string} name - School name or partial name
 * @returns {Promise<Object|null>} School object or null
 */
export async function getSchoolByName(name) {
  if (!name) return null;

  const schools = await getCachedSheet('Colegios');
  const normalized = name.toLowerCase().trim();

  return schools.find(school =>
    school.nombre?.toLowerCase().includes(normalized)
  ) || null;
}

/**
 * Gets all schools
 *
 * @returns {Promise<Array>} Array of school objects
 */
export async function getAllSchools() {
  return await getCachedSheet('Colegios');
}

/**
 * Gets materials filtered by trip and/or school
 * Note: Current Google Sheets structure doesn't have trip_id or school_code fields
 * Returns all materials for now
 *
 * @param {string} tripId - Trip ID (optional, not used in current sheet structure)
 * @param {string} schoolCode - School code (optional, not used in current sheet structure)
 * @returns {Promise<Array>} Array of material objects
 */
export async function getMaterials(tripId = null, schoolCode = null) {
  const materials = await getCachedSheet('Materiales');

  // Current Sheets structure doesn't have trip_id or school_code fields
  // Return all materials
  // TODO: If client adds these fields to Sheets, uncomment filtering logic below
  /*
  return materials.filter(material => {
    if (tripId && material.trip_id !== tripId) {
      return false;
    }
    if (schoolCode && material.school_code && material.school_code !== schoolCode) {
      return false;
    }
    return true;
  });
  */

  return materials;
}

/**
 * Gets a specific material by ID
 *
 * @param {string} materialId - Material ID
 * @returns {Promise<Object|null>} Material object or null
 */
export async function getMaterial(materialId) {
  if (!materialId) return null;

  const materials = await getCachedSheet('Materiales');
  return materials.find(material => material.id === materialId) || null;
}

/**
 * Gets payment schemes for a trip
 * Note: Google Sheets uses 'viaje_codigo' field (not 'trip_id')
 * School-specific pricing not available in current sheet structure
 *
 * @param {string} tripId - Trip ID (matches 'viaje_codigo' in Sheets)
 * @param {string} schoolCode - School code (not used, kept for backwards compatibility)
 * @returns {Promise<Array>} Array of payment scheme objects for this trip
 */
export async function getPaymentScheme(tripId, schoolCode) {
  if (!tripId) return null;

  const schemes = await getCachedSheet('Esquemas de Pago');

  // Filter by viaje_codigo (the actual field name in Google Sheets)
  const matchingSchemes = schemes.filter(scheme =>
    scheme.viaje_codigo === tripId
  );

  // Return first matching scheme, or null if none found
  // Note: Since school_code doesn't exist in current Sheets structure,
  // we return the first scheme for this trip regardless of school
  return matchingSchemes.length > 0 ? matchingSchemes[0] : null;
}

/**
 * Gets activities for a trip
 * Note: Google Sheets uses 'viaje_codigo' field (not 'trip_id')
 *
 * @param {string} tripId - Trip ID (optional, if not provided returns all)
 * @returns {Promise<Array>} Array of activity objects
 */
export async function getActivities(tripId = null) {
  const activities = await getCachedSheet('Actividades');

  if (!tripId) {
    return activities;
  }

  // Filter by viaje_codigo (the actual field name in Google Sheets)
  return activities.filter(activity => activity.viaje_codigo === tripId);
}

/**
 * Gets advisor assigned to a school
 *
 * @param {string} schoolCode - School code
 * @returns {Promise<Object|null>} Advisor object or null
 */
export async function getAdvisor(schoolCode) {
  if (!schoolCode) return null;

  const advisors = await getCachedSheet('Asesoras');
  return advisors.find(advisor =>
    advisor.school_code?.toUpperCase() === schoolCode.toUpperCase()
  ) || null;
}

/**
 * Gets all FAQs
 *
 * @returns {Promise<Array>} Array of FAQ objects
 */
export async function getFAQ() {
  return await getCachedSheet('FAQ');
}

/**
 * Gets a configuration parameter
 *
 * @param {string} param - Parameter name
 * @returns {Promise<string|null>} Parameter value or null
 */
export async function getConfig(param) {
  if (!param) return null;

  const config = await getCachedSheet('Configuración');
  const item = config.find(c => c.parametro?.toLowerCase() === param.toLowerCase());
  return item ? item.valor : null;
}

/**
 * Gets cache status for monitoring
 *
 * @returns {Promise<Object>} Cache status information
 */
export async function getCacheStatus() {
  const status = {
    hasBackup: Object.keys(lastSuccessfulCache).length > 0,
    backupTimestamp: lastSuccessfulCache.timestamp || null,
    sheets: {},
  };

  for (const sheetName of SHEET_NAMES) {
    const data = await getCachedSheet(sheetName);
    status.sheets[sheetName] = {
      rowCount: data.length,
      cached: !!data,
    };
  }

  return status;
}
