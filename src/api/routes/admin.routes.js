import express from 'express';
import redis from '../../core/database/redis.js';
import * as sheetsCache from '../../core/sheets/cache.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * ADMIN ROUTES - Temporary endpoints for debugging
 * Remove these in production
 */

/**
 * POST /api/admin/clear-cache
 * Clears all WhatsApp media cache from Redis
 */
router.post('/clear-cache', async (req, res) => {
  const adminLogger = logger.child({ endpoint: '/admin/clear-cache' });

  try {
    adminLogger.info('Clearing WhatsApp media cache');

    const client = redis.getClient();

    // Find all WhatsApp media keys
    const keys = await client.keys('whatsapp:media:*');

    adminLogger.info({ keyCount: keys.length }, 'Found cached media items');

    if (keys.length === 0) {
      return res.json({
        success: true,
        message: 'Cache is already empty',
        deletedCount: 0,
      });
    }

    // Delete all keys
    const result = await client.del(...keys);

    adminLogger.info({ deletedCount: result }, 'Cache cleared successfully');

    res.json({
      success: true,
      message: 'Cache cleared successfully',
      deletedCount: result,
      keys: keys,
    });

  } catch (error) {
    adminLogger.error({ err: error }, 'Error clearing cache');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/cache-status
 * Shows current cache status
 */
router.get('/cache-status', async (req, res) => {
  const adminLogger = logger.child({ endpoint: '/admin/cache-status' });

  try {
    const client = redis.getClient();

    // Find all WhatsApp media keys
    const keys = await client.keys('whatsapp:media:*');

    const cacheItems = [];
    for (const key of keys) {
      const mediaId = await client.get(key);
      const ttl = await client.ttl(key);
      cacheItems.push({
        key,
        mediaId,
        ttlSeconds: ttl,
        ttlDays: (ttl / 86400).toFixed(1),
      });
    }

    res.json({
      success: true,
      totalCached: keys.length,
      items: cacheItems,
    });

  } catch (error) {
    adminLogger.error({ err: error }, 'Error getting cache status');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/refresh-sheets-cache
 * Force refresh of Google Sheets cache
 */
router.post('/refresh-sheets-cache', async (req, res) => {
  const adminLogger = logger.child({ endpoint: '/admin/refresh-sheets-cache' });

  try {
    adminLogger.info('Forcing Google Sheets cache refresh');

    const success = await sheetsCache.refreshCache();

    if (success) {
      const status = await sheetsCache.getCacheStatus();

      adminLogger.info({ sheetCount: Object.keys(status.sheets).length }, 'Cache refreshed successfully');

      res.json({
        success: true,
        message: 'Google Sheets cache refreshed successfully',
        timestamp: new Date().toISOString(),
        status,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to refresh cache',
      });
    }

  } catch (error) {
    adminLogger.error({ err: error }, 'Error refreshing cache');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
