import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerPanel } from '../../src/panel/routes.js';
import { hashPassword } from '../../src/panel/password.js';
import { fakeDb } from './fake-db.js';

const ORIGIN = 'http://localhost:80';
const PASS = 'clave-de-prueba-larga-1';

async function setup({ mustChange = false, role = 'admin', advisorName = null } = {}) {
  const db = fakeDb();
  db.users.set('u1', { id: 'u1', email: 'steph@ejemplo.com', name: 'Steph', role, advisorName, active: true, mustChangePassword: mustChange, passwordHash: await hashPassword(PASS) });
  const calls = [];
  const dataSource = {
    list: async (filters, user) => { calls.push({ fn: 'list', filters, user }); return { rows: [{ key: 'ox-1', ticket: 1 }], page: 1, pages: 1, total: 1, changed: null, at: new Date().toISOString() }; },
    summary: async (user) => { calls.push({ fn: 'summary', user }); return { hoy: {}, semana: {}, at: '2026-11-26T00:00:00Z' }; },
    detail: async (bot, ticket, user) => { calls.push({ fn: 'detail', bot, ticket, user }); return ticket === 404 ? null : { bot, row: {}, messages: [] }; },
  };
  const app = Fastify();
  await registerPanel(app, { db, dataSource });
  await app.ready();
  return { app, db, calls };
}

async function login(app, password = PASS) {
  return app.inject({ method: 'POST', url: '/panel/login', headers: { origin: ORIGIN, host: 'localhost:80' }, payload: { email: 'Steph@Ejemplo.com ', password } });
}
const cookieOf = (res) => String(res.headers['set-cookie']).split(';')[0];

test('sin sesión: la página redirige al login y la API responde 401', async () => {
  const { app } = await setup();
  const page = await app.inject({ method: 'GET', url: '/panel' });
  assert.equal(page.statusCode, 302); assert.equal(page.headers.location, '/panel/login');
  for (const url of ['/panel/api/leads', '/panel/api/summary', '/panel/api/lead/ox/1']) assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
  assert.equal((await app.inject({ method: 'GET', url: '/panel/login' })).statusCode, 200);
});

test('login: correo o contraseña mala → mismo mensaje y queda registrado', async () => {
  const { app, db } = await setup();
  const bad = await login(app, 'incorrecta-1234567');
  assert.equal(bad.statusCode, 401);
  const noUser = await app.inject({ method: 'POST', url: '/panel/login', headers: { origin: ORIGIN, host: 'localhost:80' }, payload: { email: 'nadie@x.com', password: 'loquesea12345' } });
  assert.equal(noUser.statusCode, 401);
  assert.equal(bad.json().error, noUser.json().error, 'no revela si el correo existe');
  assert.deepEqual(db.log.map((l) => l.action), ['login_fail', 'login_fail']);
});

test('login: el 6.º intento queda bloqueado aunque la contraseña sea correcta', async () => {
  const { app, db } = await setup();
  for (let i = 0; i < 5; i++) await login(app, 'incorrecta-1234567');
  const r = await login(app);
  assert.equal(r.statusCode, 429);
  assert.match(r.json().error, /15 minutos/);
  assert.equal(db.log.at(-1).action, 'login_blocked');
});

test('login correcto: cookie segura, acceso a la API y registro', async () => {
  const { app, db, calls } = await setup();
  const r = await login(app);
  assert.equal(r.statusCode, 200);
  const sc = String(r.headers['set-cookie']);
  for (const f of ['HttpOnly', 'Secure', 'SameSite=Strict', '__Host-panel_sid=']) assert.ok(sc.includes(f), f);
  const api = await app.inject({ method: 'GET', url: '/panel/api/leads?bot=ox&q=laura', headers: { cookie: cookieOf(r) } });
  assert.equal(api.statusCode, 200);
  assert.equal(calls.at(-1).filters.bot, 'ox');
  assert.equal(calls.at(-1).user.email, 'steph@ejemplo.com');
  assert.deepEqual(db.log.map((l) => l.action), ['login_ok', 'search']);
});

test('POST sin el Origin del panel → 403 (CSRF)', async () => {
  const { app } = await setup();
  const r = await app.inject({ method: 'POST', url: '/panel/login', headers: { host: 'localhost:80' }, payload: { email: 'steph@ejemplo.com', password: PASS } });
  assert.equal(r.statusCode, 403);
  const r2 = await app.inject({ method: 'POST', url: '/panel/login', headers: { origin: 'https://malo.com', host: 'localhost:80' }, payload: { email: 'steph@ejemplo.com', password: PASS } });
  assert.equal(r2.statusCode, 403);
});

test('encabezados: noindex, no-store, CSP estricta, sin iframes; robots.txt', async () => {
  const { app } = await setup();
  const r = await app.inject({ method: 'GET', url: '/panel/login' });
  assert.match(r.headers['x-robots-tag'], /noindex/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.match(r.headers['content-security-policy'], /script-src 'self'; style-src 'self'/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.doesNotMatch(r.body, /<script>(?!<\/script>)|style="/, 'sin scripts ni estilos en línea');
  const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
  assert.match(robots.body, /Disallow: \//);
});

test('primer ingreso: obliga a cambiar la contraseña antes de ver datos', async () => {
  const { app, db } = await setup({ mustChange: true });
  const r = await login(app);
  assert.equal(r.json().next, '/panel/password');
  const cookie = cookieOf(r);
  assert.equal((await app.inject({ method: 'GET', url: '/panel', headers: { cookie } })).headers.location, '/panel/password');
  assert.equal((await app.inject({ method: 'GET', url: '/panel/api/leads', headers: { cookie } })).statusCode, 403);
  const weak = await app.inject({ method: 'POST', url: '/panel/password', headers: { cookie, origin: ORIGIN, host: 'localhost:80' }, payload: { current: PASS, next: 'corta' } });
  assert.equal(weak.statusCode, 400);
  const ok = await app.inject({ method: 'POST', url: '/panel/password', headers: { cookie, origin: ORIGIN, host: 'localhost:80' }, payload: { current: PASS, next: 'otra-clave-muy-larga-99' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(db.users.get('u1').mustChangePassword, false);
  assert.equal((await app.inject({ method: 'GET', url: '/panel/api/leads', headers: { cookie } })).statusCode, 200, 'la sesión actual sigue viva');
});

test('logout: borra la sesión y la cookie', async () => {
  const { app } = await setup();
  const cookie = cookieOf(await login(app));
  const out = await app.inject({ method: 'POST', url: '/panel/logout', headers: { cookie, origin: ORIGIN, host: 'localhost:80' } });
  assert.match(String(out.headers['set-cookie']), /Max-Age=0/);
  assert.equal((await app.inject({ method: 'GET', url: '/panel/api/leads', headers: { cookie } })).statusCode, 401);
});

test('detalle: registra la vista, 404 si no existe o no es suyo, sin registrar el polling', async () => {
  const { app, db } = await setup();
  const cookie = cookieOf(await login(app));
  assert.equal((await app.inject({ method: 'GET', url: '/panel/api/lead/ox/7', headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/panel/api/lead/ox/7?poll=1', headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/panel/api/lead/ox/404', headers: { cookie } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/panel/api/lead/zz/7', headers: { cookie } })).statusCode, 404);
  assert.deepEqual(db.log.filter((l) => l.action === 'view_lead').map((l) => l.detail), ['ox #7']);
});

test('polling: mismo contenido → 304', async () => {
  const { app } = await setup();
  const cookie = cookieOf(await login(app));
  const a = await app.inject({ method: 'GET', url: '/panel/api/summary', headers: { cookie } });
  const b = await app.inject({ method: 'GET', url: '/panel/api/summary', headers: { cookie, 'if-none-match': a.headers.etag } });
  assert.equal(b.statusCode, 304);
});

test('rol asesora: la fuente de datos recibe su rol para filtrar en la consulta', async () => {
  const { app, calls } = await setup({ role: 'asesora', advisorName: 'Alma Sotelo' });
  const cookie = cookieOf(await login(app));
  await app.inject({ method: 'GET', url: '/panel/api/leads', headers: { cookie } });
  await app.inject({ method: 'GET', url: '/panel/api/lead/ed/3', headers: { cookie } });
  assert.ok(calls.every((c) => c.user.role === 'asesora' && c.user.advisorName === 'Alma Sotelo'));
});
