import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { isAuthorized, registerProtectedAdminRoutes, MIN_TOKEN_LENGTH } from '../../src/api/admin-auth.js';

const TOKEN = 'a'.repeat(40) + 'Z9';

async function app(token = TOKEN) {
  const f = Fastify();
  f.get('/health', async () => ({ ok: true }));
  f.post('/webhook/oxford', async () => ({ status: 'received' }));
  await registerProtectedAdminRoutes(f, async (scope) => {
    scope.get('/admin/lead-status/:phone', async (req) => ({ phone: req.params.phone, secreto: true }));
    scope.post('/admin/update-info-general', async () => ({ wrote: true }));
  }, () => token);
  await f.ready();
  return f;
}

test('sin token → 404 como ruta inexistente, sin revelar datos', async () => {
  const f = await app();
  for (const [method, url] of [['GET', '/admin/lead-status/5215511112222'], ['POST', '/admin/update-info-general']]) {
    const r = await f.inject({ method, url });
    assert.equal(r.statusCode, 404, url);
    assert.doesNotMatch(r.body, /secreto|wrote/);
    assert.match(r.body, /not found/);
  }
});

test('token incorrecto o mal formado → 404', async () => {
  const f = await app();
  for (const h of [`Bearer ${TOKEN}x`, TOKEN, `Basic ${TOKEN}`, 'Bearer ', `Bearer ${TOKEN.slice(0, -1)}`]) {
    const r = await f.inject({ method: 'GET', url: '/admin/lead-status/1', headers: { authorization: h } });
    assert.equal(r.statusCode, 404, h.slice(0, 12));
  }
});

test('token correcto → la ruta responde', async () => {
  const f = await app();
  const r = await f.inject({ method: 'GET', url: '/admin/lead-status/1', headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().phone, '1');
});

test('sin ADMIN_API_TOKEN configurado (o corto) → todo cerrado, aunque manden algo', async () => {
  for (const cfg of ['', 'corto', ' '.repeat(50)]) {
    const f = await app(cfg);
    const r = await f.inject({ method: 'GET', url: '/admin/lead-status/1', headers: { authorization: `Bearer ${cfg || 'x'}` } });
    assert.equal(r.statusCode, 404, JSON.stringify(cfg));
  }
  assert.equal(isAuthorized('Bearer ' + 'b'.repeat(MIN_TOKEN_LENGTH - 1), 'b'.repeat(MIN_TOKEN_LENGTH - 1)), false);
});

test('el candado no toca webhooks ni health', async () => {
  const f = await app();
  assert.equal((await f.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  assert.equal((await f.inject({ method: 'POST', url: '/webhook/oxford', payload: {} })).statusCode, 200);
});
