import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import logger from './utils/logger.js';
import prisma from './core/database/client.js';
import redis from './core/database/redis.js';
import webhookRoutes from './routes/webhook.js';
import * as sheetsSyncJob from './jobs/sheets-sync.job.js';
import * as followUpJob from './jobs/followup.job.js';

/**
 * Main application entry point
 *
 * Initializes Fastify server with:
 * - CORS support
 * - Health check endpoint
 * - WhatsApp webhook routes (to be implemented)
 * - Graceful shutdown handling
 */

// Create Fastify instance
const fastify = Fastify({
  logger: logger,
  disableRequestLogging: env.NODE_ENV === 'production',
  requestIdLogLabel: 'reqId',
  requestIdHeader: 'x-request-id',
});

// Register CORS
await fastify.register(cors, {
  origin: true, // Allow all origins for webhooks
  methods: ['GET', 'POST'],
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis connection
    await redis.getClient().ping();

    // Get job statuses
    const syncJobStatus = sheetsSyncJob.getSyncJobStatus();
    const followUpJobStatus = followUpJob.getFollowUpJobStatus();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected',
      redis: 'connected',
      jobs: {
        sheetsSync: syncJobStatus,
        followUp: followUpJobStatus,
      },
    };
  } catch (error) {
    reply.status(503);
    return {
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    };
  }
});

// Root endpoint
fastify.get('/', async (request, reply) => {
  return {
    name: 'Grupo Work & Study - WhatsApp Automation System',
    version: '1.0.0',
    phase: 'Fase 2 - Travel with Google Sheets Integration',
    status: 'running',
    features: [
      'Claude AI conversational bot',
      'Google Sheets dynamic backend',
      'School detection',
      'Lead scoring',
      'Automatic follow-ups',
      'Material sending',
      'Advisor handoff',
    ],
  };
});

// Register WhatsApp webhook routes
await fastify.register(webhookRoutes);

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Stop background jobs
    sheetsSyncJob.stopSyncJob();
    logger.info('Sheets sync job stopped');

    followUpJob.stopFollowUpJob();
    logger.info('Follow-up job stopped');

    // Stop accepting new requests
    await fastify.close();
    logger.info('Fastify server closed');

    // Disconnect from database
    await prisma.$disconnect();
    logger.info('Database disconnected');

    // Disconnect from Redis
    await redis.disconnect();
    logger.info('Redis disconnected');

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
};

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
  shutdown('unhandledRejection');
});

// Start server
const start = async () => {
  try {
    await fastify.listen({
      port: env.PORT,
      host: '0.0.0.0',
    });

    logger.info(`Server listening on port ${env.PORT}`);
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info(`Log level: ${env.LOG_LEVEL}`);

    // Start background jobs after server is running
    logger.info('Starting background jobs...');

    // Start Google Sheets sync job (every 5 minutes)
    await sheetsSyncJob.startSyncJob();
    logger.info('Sheets sync job started');

    // Start follow-up job (every hour)
    followUpJob.startFollowUpJob();
    logger.info('Follow-up job started');

    logger.info('All background jobs started successfully');

  } catch (error) {
    logger.error({ err: error }, 'Error starting server');
    process.exit(1);
  }
};

start();
