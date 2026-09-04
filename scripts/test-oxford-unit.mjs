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
ok('System prompt lists all 7 detailed programs');
assert.ok(/NUNCA compartas precios/i.test(prompt));
ok('System prompt forbids sharing prices');
assert.strictEqual(HANDOFF_MEETING_URL, 'https://meetings.hubspot.com/camila-serafin-jimenez/');
ok('Handoff meeting link matches spec');

// ── 4. El catálogo del prompt cubre TODO el menú (Flujo Ori) ─────────────────
// Regresión del bug real: Ori contestó "no tengo información sobre AINARA en
// nuestro catálogo" a una prospecta, cuando AINARA y Visual Camp SÍ están en el
// menú (cat_3). El prompt solo listaba 7 programas de los 16 que ofrece el menú,
// y de las 5 plataformas de aula solo Smile and Learn tenía filas en "FAQ Oxford".
const MENU_PRODUCTS = [
  'Oxford TCC', 'Oxford TCC Kids', 'Oxford ETC',
  'Oxford LIFE', 'Alphable',
  'Smile and Learn', 'Visual Camp', 'AINARA', 'KNOW BY STEAM TREKS', // iEduca se retiró: ya no se distribuye
  'English Life', 'Rising STARS', 'Global Insights', 'Wish and Go', 'Work & Study Spain',
  'Oxford Checkpoint', 'Oxford Checkpoint Kids',
];
for (const product of MENU_PRODUCTS) {
  assert.ok(prompt.includes(product), `el catálogo del prompt debe incluir ${product} (está en el menú)`);
}
ok(`System prompt incluye los ${MENU_PRODUCTS.length} productos del menú (Flujo Ori), no solo los 7 con detalle`);
assert.strictEqual(MENU_PRODUCTS.length, 16, 'el menú son 16 productos desde que se retiró iEduca');
assert.ok(!/iEduca/i.test(prompt), 'iEduca ya no se distribuye: no debe aparecer en el prompt');
ok('iEduca fuera del catálogo del prompt');

// El catálogo por sí solo no basta: si el cliente agrega un producto al Sheet, el
// prompt no se entera. La regla es la que cubre ese caso.
assert.ok(/NUNCA NIEGUES UN PRODUCTO/.test(prompt), 'debe existir la regla explícita de no negar productos');
assert.ok(/no tengo información sobre X en nuestro catálogo/.test(prompt), 'debe prohibir la frase exacta que usó Ori en prod');
assert.ok(/RECONÓCELO como nuestro y ofrece conectar con la asesora/.test(prompt), 'debe indicar qué hacer en su lugar: reconocer + derivar');
ok('System prompt prohíbe negar un producto y ordena reconocerlo + derivar');

// ── 5. Guardarraíl de inscripción y pagos ────────────────────────────────────
// Ori no consulta ningún sistema de inscripciones ni de pagos: el ya_inscrito_stub
// solo capta datos. Nunca debe confirmar, negar ni inventar ese estatus.
assert.ok(/ESTATUS DE INSCRIPCIÓN Y PAGOS/.test(prompt), 'debe existir la sección de estatus de inscripción y pagos');
assert.ok(/NUNCA confirmes, niegues ni des por hecho que alguien está inscrito/.test(prompt));
assert.ok(/NO tienes acceso al sistema de inscripciones ni al de pagos/.test(prompt));
assert.ok(/PROHIBIDO mencionar el nombre de un alumno, colegio o institución que el prospecto NO te haya escrito él mismo/.test(prompt));
ok('System prompt prohíbe confirmar/negar/inventar estatus de inscripción o pagos');

// Contrapeso: repetir un dato que el prospecto acaba de dar NO es confirmarlo,
// para que el guardarraíl no vuelva mudo a Ori con los datos que ella misma capta.
assert.ok(/repetir un dato que el prospecto acaba de darte NO es confirmarlo/.test(prompt));
ok('El guardarraíl aclara que repetir un dato del prospecto sí está permitido');

console.log(`\nAll ${passed} checks passed ✅`);
process.exit(0);
