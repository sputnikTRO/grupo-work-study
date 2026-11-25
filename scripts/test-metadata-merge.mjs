/**
 * conversationService.mergeMetadata: mezcla atómica en la base (jsonb ||) con
 * SOLO las llaves del patch.
 * Run: node --experimental-test-module-mocks scripts/test-metadata-merge.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const CALLS = [];
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop };
logger.child = () => logger;
mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/core/database/client.js', {
  defaultExport: { $queryRaw: async (strings, ...values) => { CALLS.push({ sql: strings.join('?'), values }); return [{ metadata: { a: 1, nudgedNode: 'cat_1' } }]; } },
});
const { mergeMetadata } = await import('../src/services/conversation.service.js');

test('usa jsonb || con solo el patch y devuelve la metadata completa', async () => {
  const out = await mergeMetadata('conv-1', { nudgedNode: 'cat_1' });
  assert.equal(CALLS.length, 1);
  assert.match(CALLS[0].sql, /SET metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| \?::jsonb/);
  assert.deepEqual(JSON.parse(CALLS[0].values[0]), { nudgedNode: 'cat_1' }, 'solo la llave nueva, no la metadata vieja');
  assert.equal(CALLS[0].values[1], 'conv-1');
  assert.deepEqual(out, { a: 1, nudgedNode: 'cat_1' });
});
