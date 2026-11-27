import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordProblem } from '../../src/panel/password.js';
import { createSession, resolveSession, hashToken, parseCookies, sessionCookie, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../../src/panel/sessions.js';
import { makeRateLimiter, MAX_FAILS } from '../../src/panel/rate-limit.js';
import { fakeDb } from './fake-db.js';


test('contraseñas: scrypt, verificación y política', async () => {
  const h = await hashPassword('una-clave-larga-123');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('una-clave-larga-123', h), true);
  assert.equal(await verifyPassword('otra-clave-larga-123', h), false);
  assert.equal(await verifyPassword('x', 'basura'), false);
  assert.notEqual(await hashPassword('una-clave-larga-123'), h, 'sal distinta cada vez');
  assert.match(passwordProblem('corta'), /12 caracteres/);
  assert.match(passwordProblem('rafael-1234567', { email: 'rafael@x.com' }), /correo/);
  assert.equal(passwordProblem('una-clave-larga-123', { email: 'rafael@x.com' }), null);
});

test('sesiones: token solo en la cookie, expiración absoluta e inactividad', async () => {
  const db = fakeDb();
  db.users.set('u1', { id: 'u1', email: 'a@b.c', active: true });
  const t0 = new Date('2026-11-26T12:00:00Z');
  const token = await createSession(db, { id: 'u1' }, { now: t0 });
  const stored = [...db.sessions.values()][0];
  assert.equal(stored.tokenHash, hashToken(token));
  assert.ok(!JSON.stringify(stored).includes(token), 'la base no guarda el token en claro');
  assert.ok(await resolveSession(db, token, { now: new Date(t0.getTime() + 60 * 60 * 1000) }), 'a la hora sigue viva');
  assert.equal(await resolveSession(db, 'otro', { now: t0 }), null);

  const t2 = await createSession(db, { id: 'u1' }, { now: t0 });
  assert.equal(await resolveSession(db, t2, { now: new Date(t0.getTime() + SESSION_IDLE_MS + 1000) }), null, '2 h sin actividad → fuera');

  const t3 = await createSession(db, { id: 'u1' }, { now: t0 });
  for (let h = 1; h <= 11; h++) assert.ok(await resolveSession(db, t3, { now: new Date(t0.getTime() + h * 60 * 60 * 1000) }), `activa a la hora ${h}`);
  assert.equal(await resolveSession(db, t3, { now: new Date(t0.getTime() + SESSION_ABSOLUTE_MS + 1) }), null, '12 h → fuera aunque esté activa');

  const t4 = await createSession(db, { id: 'u1' }, { now: t0 });
  db.users.get('u1').active = false;
  assert.equal(await resolveSession(db, t4, { now: t0 }), null, 'usuario desactivado → fuera');
});

test('cookie: banderas seguras y lectura', () => {
  const c = sessionCookie('abc');
  for (const flag of ['__Host-panel_sid=abc', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200']) assert.ok(c.includes(flag), flag);
  assert.equal(c.includes('Domain='), false, '__Host- exige que no haya Domain');
  assert.deepEqual(parseCookies('a=1; __Host-panel_sid=x%2By; b=%E0'), { a: '1', '__Host-panel_sid': 'x+y', b: '' });
});

test('límite de intentos: 5 fallos bloquean; si Redis falla, cuenta en memoria', async () => {
  const lim = makeRateLimiter(null);
  const keys = ['email:a@b.c', 'ip:1.1.1.1'];
  for (let i = 0; i < MAX_FAILS; i++) { assert.equal(await lim.isBlocked(keys), false); await lim.fail(keys); }
  assert.equal(await lim.isBlocked(keys), true);
  assert.equal(await lim.isBlocked(['email:otra@b.c', 'ip:1.1.1.1']), true, 'la IP queda bloqueada para cualquier correo');
  await lim.reset(keys);
  assert.equal(await lim.isBlocked(keys), false);

  const broken = { get: async () => { throw new Error('redis caído'); }, incr: async () => { throw new Error('redis caído'); }, expire: async () => {}, del: async () => {} };
  const lim2 = makeRateLimiter(broken);
  for (let i = 0; i < MAX_FAILS; i++) await lim2.fail(['email:x']);
  assert.equal(await lim2.isBlocked(['email:x']), true, 'Redis caído no deja la puerta abierta');
});
