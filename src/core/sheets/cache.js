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
 *
 * @param {string} tripId - Trip ID (optional)
 * @param {string} schoolCode - School code (optional)
 * @returns {Promise<Array>} Array of material objects
 */
export async function getMaterials(tripId = null, schoolCode = null) {
  const materials = await getCachedSheet('Materiales');

  return materials.filter(material => {
    // Filter by trip if provided
    if (tripId && material.trip_id !== tripId) {
      return false;
    }

    // Filter by school if provided
    if (schoolCode && material.school_code && material.school_code !== schoolCode) {
      return false;
    }

    return true;
  });
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
 * Gets payment scheme for a trip and school
 *
 * @param {string} tripId - Trip ID
 * @param {string} schoolCode - School code
 * @returns {Promise<Object|null>} Payment scheme object or null
 */
export async function getPaymentScheme(tripId, schoolCode) {
  if (!tripId || !schoolCode) return null;

  const schemes = await getCachedSheet('Esquemas de Pago');
  return schemes.find(scheme =>
    scheme.trip_id === tripId && scheme.school_code?.toUpperCase() === schoolCode.toUpperCase()
  ) || null;
}

/**
 * Gets activities for a trip
 *
 * @param {string} tripId - Trip ID (optional, if not provided returns all)
 * @returns {Promise<Array>} Array of activity objects
 */
export async function getActivities(tripId = null) {
  const activities = await getCachedSheet('Actividades');

  if (!tripId) {
    return activities;
  }

  return activities.filter(activity => activity.trip_id === tripId);
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
