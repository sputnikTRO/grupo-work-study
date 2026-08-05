/**
 * Local smoke test for the Oxford Education unit (no external infra needed).
 * Verifies: webhook handshake via fastify.inject, action-tag parsing/cleaning,
 * and that the system prompt enforces the no-prices rule.
 */
import assert from 'node:assert';
import Fastify from 'fastify';
import oxfordWebhookRoutes from '../src/routes/oxford-webhook.js';
import { parseActions, cleanResponse } from '../src/units/oxford-education/actions.js';
import { buildFullPrompt, HANDOFF_MEETING_URL } from '../src/units/oxford-education/prompts.js';
import { env } from '../src/config/env.js';

let passed = 0;
const ok = (name) => { console.log(`  ✓ ${name}`); passed++; };

// ── 1. Webhook verification handshake (real route via inject) ────────────────
const app = Fastify({ logger: false });
await app.register(oxfordWebhookRoutes);

const good = await app.inject({
  method: 'GET',
  url: `/webhook/oxford?hub.mode=subscribe&hub.verify_token=${env.OXED_VERIFY_TOKEN}&hub.challenge=CHALLENGE_123`,
});
assert.strictEqual(good.statusCode, 200);
assert.strictEqual(good.body, 'CHALLENGE_123');
ok('GET /webhook/oxford with correct token echoes the challenge');

const bad = await app.inject({
  method: 'GET',
  url: '/webhook/oxford?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=NOPE',
});
assert.strictEqual(bad.statusCode, 403);
ok('GET /webhook/oxford with wrong token is rejected (403)');

await app.close();

// ── 2. Action tag parsing + cleaning ─────────────────────────────────────────
const raw = 'Claro, te ayudo con eso. [CAPTURAR_DATO:primary_product:oxford_tcc] [DERIVAR_ASESOR:pidio precio]';
const actions = parseActions(raw);
assert.ok(actions.some((a) => a.type === 'CAPTURAR_DATO' && a.field === 'primary_product' && a.value === 'oxford_tcc'));
assert.ok(actions.some((a) => a.type === 'DERIVAR_ASESOR' && a.reason === 'pidio precio'));
ok('parseActions extracts CAPTURAR_DATO and DERIVAR_ASESOR');

const clean = cleanResponse(raw);
assert.ok(!clean.includes('[CAPTURAR_DATO') && !clean.includes('[DERIVAR_ASESOR'));
assert.ok(clean.includes('te ayudo'));
ok('cleanResponse strips all action tags from visible text');

// ── 3. System prompt enforces no prices + lists programs + handoff link ───────
const prompt = buildFullPrompt({ fullName: 'Ana', primaryProduct: 'oxford_tcc' });
for (const program of ['Oxford TCC', 'Alphable', 'Oxford LIFE', 'Rising Stars', 'Work & Study Spain', 'English Teaching Certificate']) {
  assert.ok(prompt.includes(program), `prompt should mention ${program}`);
}
ok('System prompt lists all 7 programs');
assert.ok(/NUNCA compartas precios/i.test(prompt));
ok('System prompt forbids sharing prices');
assert.strictEqual(HANDOFF_MEETING_URL, 'https://meetings.hubspot.com/camila-serafin-jimenez/');
ok('Handoff meeting link matches spec');

console.log(`\nAll ${passed} checks passed ✅`);
process.exit(0);
