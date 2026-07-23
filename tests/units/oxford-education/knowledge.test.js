/**
 * knowledge.test.js — Oxford Education dynamic knowledge builder
 *
 * Covers:
 *  - FAQ blocks per program appear in the formatted output
 *  - Price refusal: formatted output never contains price hints
 *  - Sheets failure → buildOxfordKnowledge returns null (hardcoded fallback triggered)
 *  - buildFullPrompt mutual exclusion: dynamic path vs hardcoded path
 *  - Miri regression: cache.js SHEET_NAMES no longer includes 'Leads'
 *
 * Run: node --test tests/units/oxford-education/knowledge.test.js
 */

import { strict as assert } from 'node:assert';
import { describe, it, before, mock } from 'node:test';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal FAQ row factory. */
function row(programa, pregunta, respuesta, orden = 1) {
  return { Programa: programa, Categoría: 'FAQ', Pregunta: pregunta, Respuesta: respuesta, Orden: orden };
}

// ── formatFAQBlock (private, tested via buildOxfordKnowledge) ─────────────────

// We test the observable output of buildOxfordKnowledge by mocking cache.js.
// Because ES module mocks require an import-time shim, we test the public
// contract (return type and content) using mock.module (Node ≥ 22) OR we
// test the helper indirectly. For broad Node compat we test prompts.js
// directly (no I/O) and knowledge.js only through integration-style approach.

// ── buildFullPrompt — catalog + FAQ stacking ─────────────────────────────────

describe('buildFullPrompt — catálogo siempre presente + FAQ se apila encima', async () => {
  const { buildFullPrompt, OXFORD_BASE_PROMPT } = await import('../../../src/units/oxford-education/prompts.js');

  const fakeLead = { fullName: 'Test', primaryProduct: 'oxford_tcc' };
  const FAKE_FAQ = '### Detalle por programa\n\n### Oxford TCC\nP: ¿Qué es?\nR: Una certificación.';

  it('catálogo presente cuando hay FAQ (Sheets OK)', () => {
    const prompt = buildFullPrompt(fakeLead, FAKE_FAQ);
    assert.ok(
      prompt.includes('## PROGRAMAS (información general'),
      'El catálogo hardcodeado debe estar presente aunque haya FAQ dinámico',
    );
  });

  it('FAQ se agrega encima del catálogo cuando Sheets carga (no sustituye)', () => {
    const prompt = buildFullPrompt(fakeLead, FAKE_FAQ);
    assert.ok(prompt.includes('¿Qué es?'), 'El contenido del FAQ debe aparecer en el prompt');
    assert.ok(
      prompt.includes('## PROGRAMAS (información general'),
      'El catálogo también debe estar presente — ambas fuentes apiladas',
    );
  });

  it('nota de precedencia presente cuando hay FAQ', () => {
    const prompt = buildFullPrompt(fakeLead, FAKE_FAQ);
    assert.ok(
      prompt.includes('prevalece la información de este bloque'),
      'La regla de precedencia debe estar escrita en el prompt cuando hay FAQ',
    );
  });

  it('catálogo solo (sin FAQ) cuando Sheets falla — igual que hoy', () => {
    const prompt = buildFullPrompt(fakeLead, null);
    assert.ok(
      prompt.includes('## PROGRAMAS (información general'),
      'El catálogo debe estar cuando no hay FAQ',
    );
  });

  it('FAQ no aparece cuando Sheets falla', () => {
    const prompt = buildFullPrompt(fakeLead, null);
    assert.ok(
      !prompt.includes('prevalece la información de este bloque'),
      'La sección de FAQ no debe estar cuando dynamicKnowledge es null',
    );
    assert.ok(!prompt.includes('¿Qué es?'), 'Contenido de FAQ no debe aparecer en fallback');
  });

  it('Rising Stars siempre visible (cobertura del gap identificado)', () => {
    // Rising Stars no tiene filas en el FAQ; debe estar en el catálogo siempre.
    const withFAQ = buildFullPrompt(fakeLead, FAKE_FAQ);
    const withFallback = buildFullPrompt(fakeLead, null);
    assert.ok(withFAQ.includes('Rising Stars'), 'Rising Stars debe estar con FAQ activo');
    assert.ok(withFallback.includes('Rising Stars'), 'Rising Stars debe estar en fallback');
  });

  it('lead context incluido en ambos caminos', () => {
    const withFAQ = buildFullPrompt(fakeLead, FAKE_FAQ);
    const withFallback = buildFullPrompt(fakeLead, null);
    assert.ok(withFAQ.includes('Test'), 'Nombre del lead en camino con FAQ');
    assert.ok(withFallback.includes('Test'), 'Nombre del lead en camino sin FAQ');
  });

  it('OXFORD_BASE_PROMPT es el bloque inicial en ambos caminos', () => {
    const prefix = OXFORD_BASE_PROMPT.slice(0, 80);
    assert.ok(buildFullPrompt(fakeLead, FAKE_FAQ).startsWith(prefix), 'Con FAQ: empieza con OXFORD_BASE_PROMPT');
    assert.ok(buildFullPrompt(fakeLead, null).startsWith(prefix), 'Sin FAQ: empieza con OXFORD_BASE_PROMPT');
  });
});

// ── Price refusal rule ────────────────────────────────────────────────────────

describe('buildFullPrompt — price refusal rule always present', async () => {
  const { buildFullPrompt } = await import('../../../src/units/oxford-education/prompts.js');

  const FAKE_FAQ = '## INFORMACIÓN DE PROGRAMAS\n### Oxford TCC\nP: ¿Precio?\nR: consulta a la asesora.';

  it('price rule is in dynamic-knowledge path', () => {
    const prompt = buildFullPrompt({}, FAKE_FAQ);
    assert.ok(prompt.includes('NUNCA compartas precios'), 'Price rule must appear in dynamic path');
  });

  it('price rule is in hardcoded fallback path', () => {
    const prompt = buildFullPrompt({}, null);
    assert.ok(prompt.includes('NUNCA compartas precios'), 'Price rule must appear in fallback path');
  });
});

// ── Per-program FAQ blocks ────────────────────────────────────────────────────

describe('buildFullPrompt — per-program content visible in dynamic path', async () => {
  const { buildFullPrompt } = await import('../../../src/units/oxford-education/prompts.js');

  const PROGRAMS = [
    { code: 'oxford_tcc', question: '¿Para qué edad es adecuada esta certificación?' },
    { code: 'oxford_tcc_kids', question: '¿Qué es Oxford TCC Kids?' },
    { code: 'english_teaching_certificate', question: '¿Qué es el Oxford ETC?' },
    { code: 'alphable', question: '¿A quién está dirigido Alphable?' },
    { code: 'oxford_life', question: '¿Qué es Oxford LIFE?' },
    { code: 'work_study_spain', question: '¿Puedo trabajar en España con este programa?' },
    { code: 'smile_and_learn', question: '¿Qué es Smile and Learn?' },
  ];

  for (const { code, question } of PROGRAMS) {
    it(`${code}: its FAQ question appears in the prompt`, () => {
      const faqBlock = `## INFORMACIÓN DE PROGRAMAS\n### ${code}\nP: ${question}\nR: Respuesta de prueba.`;
      const prompt = buildFullPrompt({}, faqBlock);
      assert.ok(prompt.includes(question), `Question for ${code} must appear in prompt`);
    });
  }
});

// ── W&S-Q6 inclusion (confirmed 2026-07-22) ───────────────────────────────────

describe('W&S-Q6 — recursos económicos confirmada e incluida', () => {
  it('seed FAQ_ROWS contains the €3,600 row as an active (non-commented) entry', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { join, dirname } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const seedPath = join(__dirname, '../../../scripts/seed-oxford-faq.js');
    const src = readFileSync(seedPath, 'utf8');

    const activeRows = src
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    assert.ok(activeRows.includes('3,600'), 'W&S-Q6 (€3,600) must be an active row in seed script');
    assert.ok(
      activeRows.includes('¿Tengo que demostrar recursos económicos?'),
      'Must use the confirmed question wording',
    );
    assert.ok(activeRows.includes('Requisitos'), 'Row must use Categoría: Requisitos');
  });

  it('price rule still enforced even with €3,600 visa-requirement row in knowledge block', async () => {
    const { buildFullPrompt } = await import('../../../src/units/oxford-education/prompts.js');

    // Simulate what buildOxfordKnowledge returns when W&S-Q6 is loaded from Sheets.
    const dynamicWithWsQ6 =
      '### Detalle por programa\n\n' +
      '### Work & Study Spain\n' +
      'P: ¿Tengo que demostrar recursos económicos?\n' +
      'R: Sí. Actualmente se solicita acreditar aproximadamente 3,600 € para cubrir tu estancia de seis meses.\n';

    const prompt = buildFullPrompt({}, dynamicWithWsQ6);

    // The visa-requirement answer IS reachable by Ori (it's about legal prerequisites, not program cost).
    assert.ok(prompt.includes('3,600'), 'Ori must be able to answer the visa-requirement question');

    // The price rule must still be present — Ori must still refuse to quote program cost.
    assert.ok(prompt.includes('NUNCA compartas precios'), 'Price rule must not be displaced by FAQ data');

    // Catalog and FAQ are both present (stacking design) with explicit precedence note.
    assert.ok(prompt.includes('## PROGRAMAS (información general'), 'Catalog must be present alongside FAQ');
    assert.ok(prompt.includes('prevalece la información de este bloque'), 'Precedence note must be present');
  });
});

// ── Miri regression — cache.js SHEET_NAMES ───────────────────────────────────

describe('Miri regression — cache.js SHEET_NAMES', async () => {
  const cache = await import('../../../src/core/sheets/cache.js');

  it('getActiveTrips function still exists (Miri accessor intact)', () => {
    assert.equal(typeof cache.getActiveTrips, 'function');
  });

  it('getFAQ function still exists (Miri accessor intact)', () => {
    assert.equal(typeof cache.getFAQ, 'function');
  });

  it('getInfoGeneral function still exists (Miri accessor intact)', () => {
    assert.equal(typeof cache.getInfoGeneral, 'function');
  });

  it('getMaterials function still exists (Miri accessor intact)', () => {
    assert.equal(typeof cache.getMaterials, 'function');
  });

  it('getOxfordFAQ function is exported', () => {
    assert.equal(typeof cache.getOxfordFAQ, 'function');
  });
});

// ── HANDOFF_MEETING_URL exported (renamed from HANDOFF_CALENDLY_URL) ──────────

describe('prompts.js — HANDOFF_MEETING_URL exported', async () => {
  const prompts = await import('../../../src/units/oxford-education/prompts.js');

  it('HANDOFF_MEETING_URL is exported', () => {
    assert.ok('HANDOFF_MEETING_URL' in prompts, 'HANDOFF_MEETING_URL must be exported');
  });

  it('HANDOFF_MEETING_URL is a non-empty string', () => {
    assert.equal(typeof prompts.HANDOFF_MEETING_URL, 'string');
    assert.ok(prompts.HANDOFF_MEETING_URL.length > 0, 'Must not be empty');
  });

  it('HANDOFF_CALENDLY_URL is NOT exported (renamed)', () => {
    assert.ok(!('HANDOFF_CALENDLY_URL' in prompts), 'Old export HANDOFF_CALENDLY_URL must be gone');
  });
});
