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
 *
 * NUEVA ESTRUCTURA SIMPLIFICADA (Mayo 2026):
 * - Headers en español para facilitar gestión
 * - Soporte de precios por colegio
 * - Soporte de materiales por colegio
 * - Consolidación de Asesoras en Colegios
 * - Consolidación de FAQ en Info General
 */

const SHEET_NAMES = [
  'Viajes',
  'Precios',
  'Colegios',
  'Actividades Extra',
  'Info General',
  'Materiales',
  'Leads',
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
 * New structure uses "Estado" column instead of "status"
 *
 * @returns {Promise<Array>} Array of trip objects with Estado="activo"
 */
export async function getActiveTrips() {
  const trips = await getCachedSheet('Viajes');
  return trips.filter(trip => trip['Estado']?.toLowerCase() === 'activo');
}

/**
 * Gets school by code
 * New structure uses "Código" column instead of "codigo"
 *
 * @param {string} code - School code (e.g., 'WC', 'TH', 'CW')
 * @returns {Promise<Object|null>} School object or null
 */
export async function getSchool(code) {
  if (!code) return null;

  const schools = await getCachedSheet('Colegios');
  return schools.find(school =>
    school['Código']?.toUpperCase() === code.toUpperCase()
  ) || null;
}

/**
 * Gets school by name (partial match, case-insensitive)
 * New structure uses "Nombre Colegio" column
 *
 * @param {string} name - School name or partial name
 * @returns {Promise<Object|null>} School object or null
 */
export async function getSchoolByName(name) {
  if (!name) return null;

  const schools = await getCachedSheet('Colegios');
  const normalized = name.toLowerCase().trim();

  return schools.find(school =>
    school['Nombre Colegio']?.toLowerCase().includes(normalized)
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
 * Gets materials filtered by trip and/or school with FALLBACK logic
 *
 * Fallback order:
 * 1. Specific school + specific trip
 * 2. TODOS school + specific trip
 * 3. TODOS school + TODOS trip (general materials)
 *
 * @param {string} tripCode - Trip code (e.g., 'LON2026')
 * @param {string} schoolCode - School code (e.g., 'WC', 'TH')
 * @returns {Promise<Array>} Array of material objects
 */
export async function getMaterials(tripCode = null, schoolCode = null) {
  const allMaterials = await getCachedSheet('Materiales');

  // If no filters, return all
  if (!tripCode && !schoolCode) {
    return allMaterials;
  }

  // Build filter function with fallback logic
  const filterMaterials = (materials, tripFilter, schoolFilter) => {
    return materials.filter(material => {
      const materialTrip = material['Código Viaje'];
      const materialSchool = material['Código Colegio'];

      // Check trip match (specific or TODOS)
      const tripMatch = !tripFilter ||
                        materialTrip === tripFilter ||
                        materialTrip === 'TODOS';

      // Check school match (specific or TODOS)
      const schoolMatch = !schoolFilter ||
                          materialSchool === schoolFilter ||
                          materialSchool === 'TODOS';

      return tripMatch && schoolMatch;
    });
  };

  // Apply filters
  let filtered = filterMaterials(allMaterials, tripCode, schoolCode);

  // Sort by specificity (specific school/trip first, TODOS last)
  filtered.sort((a, b) => {
    const aSpecific = (a['Código Colegio'] !== 'TODOS' ? 1 : 0) + (a['Código Viaje'] !== 'TODOS' ? 1 : 0);
    const bSpecific = (b['Código Colegio'] !== 'TODOS' ? 1 : 0) + (b['Código Viaje'] !== 'TODOS' ? 1 : 0);
    return bSpecific - aSpecific; // Most specific first
  });

  return filtered;
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
  return materials.find(material => material['ID'] === materialId) || null;
}

/**
 * Gets price for a specific school and trip with FALLBACK to "TODOS"
 *
 * Fallback logic:
 * 1. Search for specific school + trip combination
 * 2. If not found, search for Colegio="TODOS" + same trip
 * 3. Return null if neither found
 *
 * @param {string} tripCode - Trip code (e.g., 'LON2026')
 * @param {string} schoolCode - School code (e.g., 'WC', 'TH') - optional
 * @returns {Promise<Object|null>} Price object or null
 */
export async function getPrice(tripCode, schoolCode = null) {
  if (!tripCode) return null;

  const prices = await getCachedSheet('Precios');

  // First try: specific school + trip
  if (schoolCode) {
    const specificPrice = prices.find(price =>
      price['Código Viaje'] === tripCode &&
      price['Colegio']?.toUpperCase() === schoolCode.toUpperCase()
    );

    if (specificPrice) {
      return specificPrice;
    }
  }

  // Fallback: TODOS + trip
  const fallbackPrice = prices.find(price =>
    price['Código Viaje'] === tripCode &&
    price['Colegio']?.toUpperCase() === 'TODOS'
  );

  return fallbackPrice || null;
}

/**
 * Gets activities for a trip
 * New structure uses "Código Viaje" column
 *
 * @param {string} tripCode - Trip code (e.g., 'LON2026')
 * @returns {Promise<Array>} Array of activity objects
 */
export async function getActivities(tripCode = null) {
  const activities = await getCachedSheet('Actividades Extra');

  if (!tripCode) {
    return activities;
  }

  return activities.filter(activity => activity['Código Viaje'] === tripCode);
}

/**
 * Gets advisor assigned to a school
 * New structure: advisor info is now IN Colegios sheet (columns: Asesora, WhatsApp Asesora, Email Asesora)
 *
 * @param {string} schoolCode - School code
 * @returns {Promise<Object|null>} Advisor object {nombre, whatsapp, email} or null
 */
export async function getAdvisor(schoolCode) {
  if (!schoolCode) return null;

  const school = await getSchool(schoolCode);

  if (!school) return null;

  // Extract advisor data from school row
  const advisor = {
    nombre: school['Asesora'],
    whatsapp: school['WhatsApp Asesora'],
    email: school['Email Asesora'],
  };

  // Only return if at least name exists
  return advisor.nombre ? advisor : null;
}

/**
 * Gets general information for a trip or FAQ
 * New structure: Info General replaces both Info_Viajes and FAQ
 *
 * Use Código Viaje = "TODOS" for general FAQ
 * Use Código Viaje = specific code for trip-specific info
 *
 * @param {string} tripCode - Trip code (e.g., 'LON2026') or null for all
 * @param {string} category - Filter by category (e.g., 'FAQ', 'Trámites', 'Clima') - optional
 * @returns {Promise<Array>} Array of info objects sorted by Orden
 */
export async function getInfoGeneral(tripCode = null, category = null) {
  const infoGeneral = await getCachedSheet('Info General');

  let filtered = infoGeneral;

  // Filter by trip code if provided
  if (tripCode) {
    filtered = filtered.filter(info =>
      info['Código Viaje'] === tripCode ||
      info['Código Viaje'] === 'TODOS'
    );
  }

  // Filter by category if provided
  if (category) {
    filtered = filtered.filter(info =>
      info['Categoría']?.toLowerCase() === category.toLowerCase()
    );
  }

  // Sort by Orden column (if exists)
  filtered.sort((a, b) => {
    const orderA = parseInt(a['Orden']) || 999;
    const orderB = parseInt(b['Orden']) || 999;
    return orderA - orderB;
  });

  return filtered;
}

/**
 * Gets FAQ (shortcut for getInfoGeneral with category='FAQ')
 *
 * @returns {Promise<Array>} Array of FAQ objects
 */
export async function getFAQ() {
  return await getInfoGeneral('TODOS', 'FAQ');
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
