import { getOxfordFAQ } from '../../core/sheets/cache.js';
import logger from '../../utils/logger.js';

const PROGRAM_LABELS = {
  oxford_tcc: 'Oxford TCC',
  oxford_tcc_kids: 'Oxford TCC Kids',
  english_teaching_certificate: 'Oxford English Teaching Certificate (ETC)',
  alphable: 'Alphable',
  oxford_life: 'Oxford LIFE',
  rising_stars: 'Rising Stars',
  work_study_spain: 'Work & Study Spain',
  smile_and_learn: 'Smile and Learn',
};

/**
 * Formats an array of FAQ sheet rows into a Markdown-style knowledge block
 * for injection into the system prompt.
 *
 * @param {Array<Object>} rows - Rows from 'FAQ Oxford' sheet
 * @returns {string}
 */
function formatFAQBlock(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const prog = row['Programa'] || 'TODOS';
    if (!grouped.has(prog)) grouped.set(prog, []);
    grouped.get(prog).push(row);
  }

  const lines = [
    '### Detalle por programa',
    '',
  ];

  for (const [prog, items] of grouped) {
    const label = PROGRAM_LABELS[prog] || prog;
    lines.push(`### ${label}`);
    for (const item of items) {
      const q = (item['Pregunta'] || '').trim();
      const r = (item['Respuesta'] || '').trim();
      if (q && r) {
        lines.push(`P: ${q}`);
        lines.push(`R: ${r}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Builds the dynamic knowledge block for Ori's system prompt.
 *
 * Triple fallback (handled transparently by cache.js):
 *   1. Redis cache hit → rows from cache
 *   2. Redis miss → lastSuccessfulCache in-memory backup
 *   3. Both fail → empty array
 *
 * Returns:
 *   string  — Sheets data is available; handler injects it, skips hardcoded programs.
 *   null    — All caches empty; handler falls back to OXFORD_BASE_PROMPT unchanged.
 *
 * @param {Object|null} lead - OxfordLead (used for future per-program filtering)
 * @returns {Promise<string|null>}
 */
export async function buildOxfordKnowledge(lead) {
  const log = logger.child({ unit: 'oxford_education', fn: 'buildOxfordKnowledge' });

  try {
    const rows = await getOxfordFAQ();

    if (!rows || rows.length === 0) {
      log.warn('FAQ Oxford cache empty — falling back to hardcoded prompt');
      return null;
    }

    log.info({ rowCount: rows.length }, 'Oxford FAQ loaded from cache');
    return formatFAQBlock(rows);
  } catch (error) {
    log.error({ err: error }, 'Error building Oxford knowledge — falling back to hardcoded prompt');
    return null;
  }
}
