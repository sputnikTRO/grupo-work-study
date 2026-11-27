/**
 * Panel de prospectos (/panel) — rutas, sesión y seguridad.
 *
 * - Todo /panel exige sesión, salvo el login y los archivos estáticos.
 *   Sin sesión: las páginas redirigen al login y la API responde 401.
 * - Encabezados: noindex, no-store, sin referrer, CSP estricta (sin scripts ni
 *   estilos en línea), sin iframes.
 * - POST (login, logout, contraseña) exige Origin del propio panel.
 * - Solo lectura: la fuente de datos corre en transacciones READ ONLY.
 *
 * Las dependencias se inyectan (db, redis, dataSource) para probar sin base.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, passwordProblem } from './password.js';
import { COOKIE_NAME, parseCookies, sessionCookie, clearCookie, createSession, resolveSession, destroySession, destroyUserSessions, hashToken } from './sessions.js';
import { makeRateLimiter } from './rate-limit.js';
import { logAccess } from './access-log.js';
import { loginPage, homePage, detailPage, passwordPage } from './html.js';

const ASSETS = {
  'panel.js': { file: new URL('./assets/panel.js', import.meta.url), type: 'text/javascript; charset=utf-8' },
  'panel.css': { file: new URL('./assets/panel.css', import.meta.url), type: 'text/css; charset=utf-8' },
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
// Hash de relleno: cuando el correo no existe se verifica igual, para no revelar por tiempo si existe.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const isPublic = (method, path) => (path === '/panel/login' && (method === 'GET' || method === 'POST')) || path.startsWith('/panel/assets/');
const isApi = (path) => path.startsWith('/panel/api/');

function parseFilters(q = {}) {
  const date = (s, end = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
    return new Date(`${s}T${end ? '23:59:59.999' : '00:00:00'}-06:00`);
  };
  const since = q.since && !Number.isNaN(Date.parse(q.since)) ? new Date(q.since) : null;
  return {
    bot: ['ox', 'ed'].includes(q.bot) ? q.bot : null,
    advisor: q.advisor ? String(q.advisor).slice(0, 80) : null,
    stage: q.stage ? String(q.stage).slice(0, 30) : null,
    status: q.status ? String(q.status).slice(0, 40) : null,
    q: q.q ? String(q.q).slice(0, 80) : null,
    from: date(q.from), to: date(q.to, true),
    includeTest: q.includeTest === '1',
    page: Math.max(1, parseInt(q.page, 10) || 1),
    since,
  };
}

function sendJsonWithEtag(request, reply, payload) {
  const body = JSON.stringify(payload);
  const etag = `"${crypto.createHash('sha1').update(body.replace(/"at":"[^"]*"/g, '')).digest('hex')}"`;
  reply.header('ETag', etag);
  if (request.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.type('application/json; charset=utf-8').send(body);
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {Object} deps - { db, redis, dataSource, now }
 */
export async function registerPanel(fastify, { db, redis = null, dataSource, now = () => new Date() }) {
  const limiter = makeRateLimiter(redis);
  const assets = Object.fromEntries(Object.entries(ASSETS).map(([k, v]) => [k, { body: fs.readFileSync(fileURLToPath(v.file)), type: v.type }]));

  fastify.get('/robots.txt', async (req, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));

  await fastify.register(async (scope) => {
    scope.addHook('onSend', async (request, reply, payload) => {
      reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
      reply.header('Cache-Control', 'no-store');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Content-Security-Policy', CSP);
      return payload;
    });

    scope.addHook('onRequest', async (request, reply) => {
      const path = String(request.url).split('?')[0];
      if (request.method === 'POST') {
        const expected = `${request.protocol}://${request.headers.host}`;
        if (request.headers.origin !== expected) return reply.code(403).send({ error: 'Origen no permitido.' });
      }
      if (isPublic(request.method, path)) return;
      const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
      const auth = await resolveSession(db, token, { now: now() });
      if (!auth) {
        if (token) reply.header('Set-Cookie', clearCookie());
        return isApi(path) ? reply.code(401).send({ error: 'Tu sesión terminó. Vuelve a entrar.' }) : reply.redirect('/panel/login');
      }
      request.panelUser = auth.user;
      request.panelToken = token;
      const allowedWhileForced = path === '/panel/password' || path === '/panel/logout';
      if (auth.user.mustChangePassword && !allowedWhileForced) {
        return isApi(path) ? reply.code(403).send({ error: 'Cambia tu contraseña para continuar.' }) : reply.redirect('/panel/password');
      }
    });

    const meta = (request) => ({ ip: request.ip, userAgent: request.headers['user-agent'] });

    // ── Archivos estáticos ────────────────────────────────────────────────
    scope.get('/assets/:name', async (request, reply) => {
      const a = assets[request.params.name];
      if (!a) return reply.code(404).send();
      return reply.type(a.type).send(a.body);
    });

    // ── Login / logout / contraseña ───────────────────────────────────────
    scope.get('/login', async (request, reply) => reply.type('text/html; charset=utf-8').send(loginPage()));

    scope.post('/login', async (request, reply) => {
      const email = String(request.body?.email || '').trim().toLowerCase().slice(0, 200);
      const password = String(request.body?.password || '');
      const keys = [`email:${email}`, `ip:${request.ip}`];
      if (await limiter.isBlocked(keys)) {
        await logAccess(db, { email, action: 'login_blocked', ...meta(request) });
        return reply.code(429).send({ error: 'Demasiados intentos. Vuelve a intentar en 15 minutos.' });
      }
      const user = email ? await db.panelUser.findUnique({ where: { email } }) : null;
      const ok = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
      if (!user || !user.active || !ok) {
        await limiter.fail(keys);
        await logAccess(db, { email, action: 'login_fail', ...meta(request) });
        return reply.code(401).send({ error: 'Correo o contraseña incorrectos.' });
      }
      await limiter.reset(keys);
      const token = await createSession(db, user, { ...meta(request), now: now() });
      await db.panelUser.update({ where: { id: user.id }, data: { lastLoginAt: now() } }).catch(() => {});
      await logAccess(db, { user, action: 'login_ok', ...meta(request) });
      reply.header('Set-Cookie', sessionCookie(token));
      return { ok: true, next: user.mustChangePassword ? '/panel/password' : '/panel' };
    });

    scope.post('/logout', async (request, reply) => {
      await destroySession(db, request.panelToken);
      await logAccess(db, { user: request.panelUser, action: 'logout', ...meta(request) });
      reply.header('Set-Cookie', clearCookie());
      return { ok: true, next: '/panel/login' };
    });

    scope.get('/password', async (request, reply) => reply.type('text/html; charset=utf-8').send(passwordPage(request.panelUser)));

    scope.post('/password', async (request, reply) => {
      const user = request.panelUser;
      const current = String(request.body?.current || '');
      const next = String(request.body?.next || '');
      if (!(await verifyPassword(current, user.passwordHash))) return reply.code(400).send({ error: 'La contraseña actual no es correcta.' });
      const problem = passwordProblem(next, { email: user.email });
      if (problem) return reply.code(400).send({ error: problem });
      if (next === current) return reply.code(400).send({ error: 'La contraseña nueva debe ser distinta de la actual.' });
      await db.panelUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
      await destroyUserSessions(db, user.id, { exceptTokenHash: hashToken(request.panelToken) });
      await logAccess(db, { user, action: 'password_change', ...meta(request) });
      return { ok: true, next: '/panel' };
    });

    // ── Páginas ───────────────────────────────────────────────────────────
    scope.get('/', async (request, reply) => reply.type('text/html; charset=utf-8').send(homePage(request.panelUser)));
    scope.get('/lead/:bot/:ticket', async (request, reply) => {
      const { bot, ticket } = request.params;
      if (!['ox', 'ed'].includes(bot) || !/^\d+$/.test(ticket)) return reply.code(404).send('No encontrado');
      return reply.type('text/html; charset=utf-8').send(detailPage(request.panelUser, bot, Number(ticket)));
    });

    // ── API (JSON) ────────────────────────────────────────────────────────
    scope.get('/api/summary', async (request, reply) => sendJsonWithEtag(request, reply, await dataSource.summary(request.panelUser, now())));

    scope.get('/api/leads', async (request, reply) => {
      const filters = parseFilters(request.query);
      if (filters.q && !filters.since && filters.page === 1) {
        await logAccess(db, { user: request.panelUser, action: 'search', detail: filters.q, ...meta(request) });
      }
      const data = await dataSource.list(filters, request.panelUser, now());
      return sendJsonWithEtag(request, reply, { ...data, me: { name: request.panelUser.name, role: request.panelUser.role } });
    });

    scope.get('/api/lead/:bot/:ticket', async (request, reply) => {
      const { bot, ticket } = request.params;
      if (!['ox', 'ed'].includes(bot) || !/^\d+$/.test(ticket)) return reply.code(404).send({ error: 'No encontrado.' });
      const before = request.query.before && !Number.isNaN(Date.parse(request.query.before)) ? new Date(request.query.before) : null;
      const data = await dataSource.detail(bot, Number(ticket), request.panelUser, { before, now: now() });
      if (!data) return reply.code(404).send({ error: 'No encontrado.' });
      if (!request.query.poll) await logAccess(db, { user: request.panelUser, action: 'view_lead', detail: `${bot} #${ticket}`, ...meta(request) });
      return sendJsonWithEtag(request, reply, data);
    });
  }, { prefix: '/panel' });
}
