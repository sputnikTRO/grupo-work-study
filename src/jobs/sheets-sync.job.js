import { loadCache } from '../core/sheets/cache.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Google Sheets Sync Job
 *
 * Refreshes the cache of Google Sheets data periodically
 * Runs every N minutes (configurable via SHEETS_CACHE_TTL_SECONDS)
 */

const REFRESH_INTERVAL_MS = env.SHEETS_CACHE_TTL_SECONDS * 1000; // Convert to milliseconds
let syncInterval = null;

/**
 * Starts the sync job
 * Loads cache immediately, then sets up periodic refresh
 */
export async function startSyncJob() {
  logger.info({ intervalSeconds: env.SHEETS_CACHE_TTL_SECONDS }, 'Starting Google Sheets sync job');

  // Load cache immediately on startup
  try {
    await loadCache();
    logger.info('Initial cache load completed');
  } catch (error) {
    logger.error({ err: error }, 'Error in initial cache load');
    // Don't throw - let the app continue with empty cache
  }

  // Set up periodic refresh
  syncInterval = setInterval(async () => {
    const syncLogger = logger.child({ job: 'sheets-sync' });

    syncLogger.info('Starting scheduled cache refresh');

    try {
      const success = await loadCache();

      if (success) {
        syncLogger.info({ timestamp: new Date().toISOString() }, 'Cache refresh completed successfully');
      } else {
        syncLogger.warn('Cache refresh failed, using previous cache');
      }

    } catch (error) {
      syncLogger.error({ err: error }, 'Error during scheduled cache refresh');
    }

  }, REFRESH_INTERVAL_MS);

  logger.info('Sync job started successfully');
}

/**
 * Stops the sync job
 * Used for graceful shutdown
 */
export function stopSyncJob() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.info('Google Sheets sync job stopped');
  }
}

/**
 * Gets sync job status
 *
 * @returns {Object} Status information
 */
export function getSyncJobStatus() {
  return {
    running: syncInterval !== null,
    intervalMs: REFRESH_INTERVAL_MS,
    intervalSeconds: env.SHEETS_CACHE_TTL_SECONDS,
  };
}
