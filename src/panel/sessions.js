/**
 * Panel — sesiones guardadas en Postgres. La cookie lleva un token aleatorio;
 * la base solo guarda su sha256. Expiran a las 12 h o tras 2 h sin actividad.
 */
import crypto from 'node:crypto';

export const COOKIE_NAME = '__Host-panel_sid';
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = ''; }
  }
  return out;
}

export function sessionCookie(token, maxAgeMs = SESSION_ABSOLUTE_MS) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * @param {Object} db - cliente con panelSession (Prisma o un doble de prueba)
 * @returns {Promise<string>} token en claro (solo va en la cookie)
 */
export async function createSession(db, user, { ip = null, userAgent = null, now = new Date() } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.panelSession.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      ip,
      userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
    },
  });
  return token;
}

/**
 * @returns {Promise<{session: Object, user: Object}|null>} null si no existe,
 *   venció, lleva 2 h sin actividad o el usuario está desactivado
 */
export async function resolveSession(db, token, { now = new Date() } = {}) {
  if (!token) return null;
  const session = await db.panelSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  const vencida = session.expiresAt <= now
    || now.getTime() - new Date(session.lastSeenAt).getTime() > SESSION_IDLE_MS
    || !session.user?.active;
  if (vencida) {
    await db.panelSession.deleteMany({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (now.getTime() - new Date(session.lastSeenAt).getTime() > TOUCH_EVERY_MS) {
    await db.panelSession.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
  }
  return { session, user: session.user };
}

export async function destroySession(db, token) {
  if (!token) return;
  await db.panelSession.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
}

/** Cierra todas las sesiones de un usuario (al cambiar contraseña o desactivarlo). */
export async function destroyUserSessions(db, userId, { exceptTokenHash = null } = {}) {
  const where = exceptTokenHash ? { userId, NOT: { tokenHash: exceptTokenHash } } : { userId };
  await db.panelSession.deleteMany({ where }).catch(() => {});
}
