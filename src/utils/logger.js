import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Application-wide logger using Pino
 *
 * Provides structured logging with different levels:
 * - trace: Very detailed debugging information
 * - debug: Debugging information
 * - info: General information about application flow
 * - warn: Warning messages for potentially harmful situations
 * - error: Error messages for serious problems
 * - fatal: Critical errors that cause application termination
 */

const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Creates a child logger with additional context
 * @param {Object} bindings - Additional context to include in all logs
 * @returns {pino.Logger} Child logger instance
 *
 * @example
 * const phoneLogger = logger.child({ phone: '+521234567890' });
 * phoneLogger.info('Processing message');
 * // Output: {"level":"info","phone":"+521234567890","msg":"Processing message"}
 */
logger.createChild = (bindings) => {
  return logger.child(bindings);
};

export default logger;
