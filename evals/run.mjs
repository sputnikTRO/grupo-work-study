#!/usr/bin/env node
/**
 * Harness de evals de Ori y Miri.
 *
 *   docker compose -f evals/docker-compose.yml up -d   # Postgres + Redis de eval
 *   node evals/run.mjs [--only id1,id2] [--unit ori|miri] [--no-judge] [--concurrency 3]
 *
 * Por escenario (evals/scenarios/<unit>/*.json): siembra el estado inicial,
 * recorre los turnos llamando al handleMessage REAL en proceso, simula al
 * prospecto con claude-haiku-4-5 en los turnos con `intent`, corre los asserts
 * duros y (opcional) el juez. Escribe evals/report.md y evals/results/*.json.
 *
 * AISLAMIENTO (no negociable):
 *   - DATABASE_URL / REDIS_URL salen de EVAL_DATABASE_URL / EVAL_REDIS_URL y
 *     deben ser localhost; si no, aborta. Nunca se leen de .env.
 *   - Todas las credenciales de .env (Meta, Google, Railway…) se pisan con
 *     placeholders; solo ANTHROPIC_API_KEY pasa. WhatsApp y Sheets están
 *     mockeados y un guard de red bloquea cualquier fetch fuera de Anthropic.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

// --rescore [archivo]: recalcula SOLO los asserts duros sobre transcripciones ya
// guardadas (sin LLM, sin DB) y reescribe el reporte. Para corregir el harness
// sin meter la variabilidad de una corrida nueva. Conserva el juez original.
if (process.argv.includes('--rescore')) {
  const i = process.argv.indexOf('--rescore');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const file = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : `${here}/results/latest.json`;
  const { runAsserts } = await import('./asserts.mjs');
  const { buildReport } = await import('./lib/report.mjs');
  const { readdirSync: ls } = await import('node:fs');
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const scs = new Map();
  for (const unit of ['ori', 'miri']) {
    for (const f of ls(`${here}/scenarios/${unit}`).filter((x) => x.endsWith('.json'))) {
      const sc = JSON.parse(readFileSync(`${here}/scenarios/${unit}/${f}`, 'utf8'));
      scs.set(sc.id, sc);
    }
  }
  for (const r of run.scenarios) {
    const sc = scs.get(r.id);
    // La ruta esperada se relee del escenario ACTUAL, no de la guardada.
    for (const t of r.turns) t.expectNode = sc.turns[t.i - 1]?.node;
    r.checks = runAsserts(sc, r.turns);
    r.pass = r.checks.every((c) => c.pass);
    console.log(`${r.pass ? '✅' : '❌'} ${r.id}${r.pass ? '' : ` — ${r.checks.filter((c) => !c.pass).map((c) => c.id).join(', ')}`}`);
  }
  run.rescoredAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(run, null, 1));
  writeFileSync(`${here}/report.md`, buildReport(run, null));
  process.exit(0);
}

// mock.module necesita este flag: si no vino, se relanza el proceso con él.
if (!process.execArgv.includes('--experimental-test-module-mocks')) {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EVALS = fileURLToPath(new URL('.', import.meta.url));

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const ONLY = opt('only', '')?.split(',').filter(Boolean) || [];
const UNIT = opt('unit', '');
const NO_JUDGE = flag('no-judge');
const CONCURRENCY = Number(opt('concurrency', '3'));

// ── Entorno aislado (ANTES de importar nada de src/) ─────────────────────────
const dotfile = existsSync(`${ROOT}/.env`) ? dotenv.parse(readFileSync(`${ROOT}/.env`)) : {};
// ANTHROPIC_MODEL NO pasa: el de .env local puede estar retirado (pasó con
// claude-sonnet-4-20250514 → 404 y el extractor fallaba en silencio). El bot usa
// el default de env.js, o EVAL_BOT_MODEL para probar otro.
const PASS_THROUGH = ['ANTHROPIC_API_KEY'];
const EVAL_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.EVAL_DATABASE_URL || 'postgresql://eval:eval@localhost:5440/gws_eval',
  REDIS_URL: process.env.EVAL_REDIS_URL || 'redis://localhost:6390',
  WA_VERIFY_TOKEN: 'eval', WA_ACCESS_TOKEN: 'eval-no-send', WA_PHONE_NUMBER_ID_TRAVEL: 'eval-pnid-travel',
  OXED_PHONE_NUMBER_ID: 'eval-pnid-oxed', OXED_ACCESS_TOKEN: 'eval-no-send', OXED_VERIFY_TOKEN: 'eval', OXED_WABA_ID: 'eval-waba',
  GOOGLE_SHEETS_ID: 'eval-main', OXED_SHEETS_ID: 'eval-main',
  TRAVEL_PRICES_SHEETS_ID: 'eval-prices', TRAVEL_ENROLLMENT_SHEETS_ID: 'eval-enrollment',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'eval@eval.invalid', GOOGLE_PRIVATE_KEY: 'eval-no-google',
  SHEETS_CACHE_TTL_SECONDS: '86400',
};
// Todo lo que traiga .env y no esté en la lista blanca se pisa: dotenv.config()
// de env.js no sobrescribe variables ya presentes, así que nada real se cuela.
for (const k of Object.keys(dotfile)) if (!PASS_THROUGH.includes(k) && !(k in EVAL_ENV)) process.env[k] = '';
for (const k of Object.keys(process.env)) if (/^RAILWAY_/.test(k)) delete process.env[k];
Object.assign(process.env, EVAL_ENV);
for (const k of PASS_THROUGH) if (!process.env[k] && dotfile[k]) process.env[k] = dotfile[k];
if (process.env.EVAL_BOT_MODEL) process.env.ANTHROPIC_MODEL = process.env.EVAL_BOT_MODEL;

for (const k of ['DATABASE_URL', 'REDIS_URL']) {
  const host = new URL(process.env[k]).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`✋ ${k} apunta a ${host}: los evals solo corren contra infraestructura local.`);
    process.exit(2);
  }
}
if (!process.env.ANTHROPIC_API_KEY) { console.error('✋ Falta ANTHROPIC_API_KEY'); process.exit(2); }

// ── Mocks + imports reales ───────────────────────────────────────────────────
const { installMocks, installNetworkGuard, captureConsole, OUTBOX, LOGS, CTX } = await import('./lib/mocks.mjs');
installMocks();
installNetworkGuard();
captureConsole();
const { installUsageTracking, costSummary } = await import('./lib/usage.mjs');
installUsageTracking();

const { resetSheets } = await import('./lib/fake-sheets.mjs');
const { nextProspectMessage, PROSPECT_MODEL } = await import('./lib/prospect.mjs');
const { runAsserts } = await import('./asserts.mjs');
const { judge, JUDGE_MODEL } = await import('./judge.mjs');
const { buildReport } = await import('./lib/report.mjs');

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { default: prisma } = await import(src('core/database/client.js'));
const { default: redis } = await import(src('core/database/redis.js'));
const { loadCache } = await import(src('core/sheets/cache.js'));
const { normalizePhone } = await import(src('utils/phone.js'));
const { env } = await import(src('config/env.js'));
const contactService = await import(src('services/contact.service.js'));
const conversationService = await import(src('services/conversation.service.js'));
const travelLeadService = await import(src('services/lead.service.js'));
const oxfordLeadService = await import(src('units/oxford-education/lead.service.js'));
const oriStore = await import(src('units/oxford-education/store.js'));
const miriHistory = await import(src('core/ai/conversation.js'));
const ori = await import(src('units/oxford-education/handler.js'));
const miri = await import(src('units/travel/handler.js'));

const UNITS = {
  ori: { enum: 'oxford_education', bot: 'Ori', handle: ori.handleMessage, pnid: env.OXED_PHONE_NUMBER_ID },
  miri: { enum: 'travel', bot: 'Miri', handle: miri.handleMessage, pnid: env.WA_PHONE_NUMBER_ID_TRAVEL },
};

// Textos de fallo técnico: si aparecen, el turno no se evaluó de verdad.
const TECH_FALLBACK_RE = /problema t[eé]cnico moment[aá]neo|experimentando problemas t[eé]cnicos/i;

// ── Escenarios ───────────────────────────────────────────────────────────────
function loadScenarios() {
  const out = [];
  for (const unit of ['ori', 'miri']) {
    const dir = `${EVALS}/scenarios/${unit}`;
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const sc = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
      if (sc.unit !== unit) throw new Error(`${f}: unit "${sc.unit}" no coincide con la carpeta ${unit}`);
      out.push(sc);
    }
  }
  const phones = new Map();
  for (const sc of out) {
    if (phones.has(sc.phone)) throw new Error(`Teléfono repetido: ${sc.id} y ${phones.get(sc.phone)}`);
    phones.set(sc.phone, sc.id);
  }
  return out.filter((sc) => (!ONLY.length || ONLY.includes(sc.id)) && (!UNIT || sc.unit === UNIT));
}

// ── Estado ───────────────────────────────────────────────────────────────────
async function resetInfra() {
  const tables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await redis.getClient().flushdb();
  resetSheets();
  await loadCache();
}

async function currentState(sc) {
  const u = UNITS[sc.unit];
  const contact = await prisma.contact.findUnique({ where: { phone: normalizePhone(sc.phone) } });
  if (!contact) return { flowNode: null, assignedAdvisor: null };
  const conv = await prisma.conversation.findFirst({ where: { contactId: contact.id, unit: u.enum }, orderBy: { startedAt: 'desc' } });
  const lead = sc.unit === 'ori'
    ? await prisma.oxfordLead.findFirst({ where: { contactId: contact.id } })
    : await prisma.travelLead.findFirst({ where: { contactId: contact.id } });
  return { flowNode: conv?.flowNode ?? null, assignedAdvisor: lead?.assignedAdvisor ?? null };
}

/** Estado inicial opcional: nodo del flujo, campos del lead e historial previo. */
async function seedStart(sc) {
  const s = sc.start;
  if (!s) return;
  const u = UNITS[sc.unit];
  const phone = normalizePhone(sc.phone);
  const contact = await contactService.findOrCreate(phone, u.enum);
  const conv = await conversationService.findActiveOrCreate(contact.id, u.enum);
  const convUpdate = {};
  if (s.flowNode !== undefined) convUpdate.flowNode = s.flowNode;
  if (s.metadata) convUpdate.metadata = s.metadata;
  if (Object.keys(convUpdate).length) await conversationService.update(conv.id, convUpdate);
  if (s.lead) {
    if (sc.unit === 'ori') {
      const lead = await oxfordLeadService.findOrCreateOxfordLead(contact.id);
      await oxfordLeadService.updateOxfordLead(lead.id, s.lead);
    } else {
      const lead = await travelLeadService.findOrCreateTravelLead(contact.id);
      await travelLeadService.updateTravelLead(lead.id, s.lead);
    }
  }
  for (const m of s.history || []) {
    if (sc.unit === 'ori') await oriStore.addMessage(conv.id, m.role, m.content);
    else await miriHistory.addMessage(conv.id, m.role, m.content);
  }
}

// ── Un escenario ─────────────────────────────────────────────────────────────
async function runScenario(sc) {
  const u = UNITS[sc.unit];
  const phoneNorm = normalizePhone(sc.phone);
  const turns = [];
  const seen = []; // lo que el prospecto simulado ve
  const t0 = Date.now();

  await seedStart(sc);

  for (let i = 0; i < sc.turns.length; i++) {
    const spec = sc.turns[i];
    const before = await currentState(sc);

    let user = spec.say;
    let source = 'literal';
    if (user === undefined) {
      source = 'sim';
      try {
        user = await nextProspectMessage({ persona: sc.persona, intent: spec.intent, transcript: seen, botName: u.bot });
      } catch (err) {
        turns.push({ i: i + 1, user: `(simulador falló: ${err.message})`, source, nodeBefore: before.flowNode, nodeAfter: before.flowNode, bot: [], advisor: [], error: `simulador: ${err.message}` });
        break;
      }
    }

    const mark = OUTBOX.all().length;
    let error;
    try {
      await CTX.run({ scenario: sc.id, turn: i + 1 }, () => u.handle(
        { from: sc.phone, id: `wamid.in.${sc.id}.${i + 1}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: user } },
        u.pnid,
      ));
    } catch (err) {
      error = `excepción: ${err.message}`;
    }

    const sent = OUTBOX.all().slice(mark).filter((m) => m.scenario === sc.id && m.turn === i + 1);
    const bot = sent.filter((m) => m.to === phoneNorm).map((m) => m.text);
    const advisor = sent.filter((m) => m.to !== phoneNorm).map((m) => ({ to: m.to, text: m.text, template: m.template }));
    if (!error && bot.some((b) => TECH_FALLBACK_RE.test(b))) error = 'el bot respondió con el fallback de error técnico';
    // El extractor y el camino LLM tragan los errores de Claude y siguen con un
    // texto genérico: sin esto, un 404 de modelo produce un "verde" falso.
    const llmDown = LOGS.find((l) => l.scenario === sc.id && l.turn === i + 1 && l.level === 'error' && /Claude API failed|Circuit breaker|extrayendo datos/i.test(l.msg || ''));
    if (!error && llmDown) error = `LLM del bot no disponible: ${llmDown.err || llmDown.msg}`;
    if (!error && bot.length === 0) error = 'el bot no respondió nada';

    const after = await currentState(sc);
    turns.push({ i: i + 1, user, source, intent: spec.intent, expectNode: spec.node, nodeBefore: before.flowNode, nodeAfter: after.flowNode, assignedAdvisor: after.assignedAdvisor, bot, advisor, error });

    seen.push({ from: 'prospecto', text: user });
    for (const b of bot) seen.push({ from: 'bot', text: b });
  }

  const checks = runAsserts(sc, turns);
  const pass = checks.every((c) => c.pass);
  const judgement = NO_JUDGE ? null : await judge(sc, turns);
  const logs = LOGS.filter((l) => l.scenario === sc.id);

  const icon = pass ? '✅' : '❌';
  const failed = checks.filter((c) => !c.pass).map((c) => c.id).join(', ');
  console.log(`${icon} ${sc.id} (${turns.length} turnos, ${Math.round((Date.now() - t0) / 1000)} s)${failed ? ` — ${failed}` : ''}`);

  return { id: sc.id, unit: sc.unit, title: sc.title, regression: sc.regression, persona: sc.persona, pass, checks, judge: judgement, turns, logs };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const scenarios = loadScenarios();
if (!scenarios.length) { console.error('Sin escenarios que correr.'); process.exit(2); }

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const git = (() => {
  try {
    return {
      branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim(),
      sha: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
      dirty: execSync('git status --porcelain -- src', { cwd: ROOT }).toString().trim().length > 0,
    };
  } catch { return { branch: '?', sha: '?', dirty: false }; }
})();

console.log(`Evals ${runId} — ${scenarios.length} escenarios · bot ${env.ANTHROPIC_MODEL} · prospecto ${PROSPECT_MODEL} · juez ${NO_JUDGE ? '(omitido)' : JUDGE_MODEL}`);
await resetInfra();

const results = await pool(scenarios, CONCURRENCY, runScenario);

const run = {
  runId,
  startedAt: startedAt.toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  models: { bot: env.ANTHROPIC_MODEL, prospect: PROSPECT_MODEL, judge: NO_JUDGE ? '(omitido)' : JUDGE_MODEL },
  git,
  filter: { only: ONLY, unit: UNIT || null },
  cost: costSummary(),
  scenarios: results,
};

const RESULTS = `${EVALS}/results`;
mkdirSync(RESULTS, { recursive: true });
const prevPath = `${RESULTS}/latest.json`;
const previous = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
// Solo se compara contra una corrida del MISMO conjunto de escenarios.
const comparable = previous && JSON.stringify(previous.filter) === JSON.stringify(run.filter) ? previous : null;

writeFileSync(`${RESULTS}/run-${runId}.json`, JSON.stringify(run, null, 1));
writeFileSync(prevPath, JSON.stringify(run, null, 1));
writeFileSync(`${EVALS}/report.md`, buildReport(run, comparable));

const green = results.filter((r) => r.pass).length;
console.log(`\n${green}/${results.length} escenarios en verde → evals/report.md`);
console.log(`Costo estimado: $${run.cost.total} USD — ${Object.entries(run.cost.byModel).map(([m, u]) => `${m} ${u.calls} llamadas $${u.usd}`).join(' · ')}`);

await prisma.$disconnect().catch(() => {});
await redis.disconnect?.().catch?.(() => {});
process.exit(green === results.length ? 0 : 1);
