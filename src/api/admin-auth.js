/**
 * Candado de las rutas /admin/*.
 *
 * Hasta nov-2026 estas rutas estaban abiertas en internet: con un teléfono se
 * podía leer el contacto y sus leads, y había rutas que escriben en el Sheet o
 * cambian el estado del bot. Ahora exigen `Authorization: Bearer <ADMIN_API_TOKEN>`.
 *
 * - Sin token, con uno incorrecto, o si ADMIN_API_TOKEN no está configurado (o
 *   es corto), responden 404 igual que una ruta inexistente: no revelan que existen.
 * - Comparación en tiempo constante.
 * - Cada intento rechazado se registra (IP, método, ruta) sin el token.
 * - El candado vive en un scope de Fastify propio: no toca los webhooks ni /health.
 */
import crypto from 'node:crypto';
import logger from '../utils/logger.js';

export const MIN_TOKEN_LENGTH = 32;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function isAuthorized(authorizationHeader, configuredToken) {
  const token = String(configuredToken || '').trim();
  if (token.length < MIN_TOKEN_LENGTH) return false; // sin token configurado → cerrado
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(authorizationHeader || ''));
  return Boolean(m) && safeEqual(m[1], token);
}

export function makeAdminGuard(getToken) {
  return async function adminGuard(request, reply) {
    if (isAuthorized(request.headers.authorization, getToken())) return;
    logger.warn({
      adminDenied: true, ip: request.ip, method: request.method,
      path: String(request.url || '').split('?')[0], ua: String(request.headers['user-agent'] || '').slice(0, 120),
    }, 'Acceso a /admin rechazado (sin token válido)');
    return reply.code(404).send({ message: `Route ${request.method}:${String(request.url || '').split('?')[0]} not found`, error: 'Not Found', statusCode: 404 });
  };
}

/**
 * Registra las rutas de admin dentro de un scope con el candado.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {(scope) => Promise<void>} registerRoutes - p. ej. registerAdminRoutes
 * @param {() => string} getToken
 */
export async function registerProtectedAdminRoutes(fastify, registerRoutes, getToken) {
  await fastify.register(async (scope) => {
    scope.addHook('onRequest', makeAdminGuard(getToken));
    await registerRoutes(scope);
  });
}
