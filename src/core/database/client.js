import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';

/**
 * Prisma Client Singleton
 *
 * Ensures a single database connection instance is shared across the application.
 * In development, prevents connection pool exhaustion from hot-reloading.
 */

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
    errorFormat: 'pretty',
  });
};

// Prevent multiple instances during hot-reload in development
const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
