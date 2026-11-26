/**
 * Panel — contraseñas con scrypt (incluido en Node, sin dependencias).
 * Formato guardado: scrypt$N$r$p$salt(base64)$hash(base64).
 */
import crypto from 'node:crypto';

const N = 16384; const R = 8; const P = 1; const KEYLEN = 64;
export const MIN_PASSWORD_LENGTH = 12;

const scrypt = (pw, salt, n, r, p) => new Promise((resolve, reject) => {
  crypto.scrypt(String(pw), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
});

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** @returns {string|null} motivo si no cumple la política, o null */
export function passwordProblem(password, { email = '' } = {}) {
  const pw = String(password || '');
  if (pw.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 3 && pw.toLowerCase().includes(local)) return 'La contraseña no puede contener tu correo.';
  return null;
}

/** Contraseña temporal (la imprime el script de usuarios una sola vez). */
export function temporaryPassword() {
  return crypto.randomBytes(12).toString('base64url');
}
