/**
 * Al reconstruir el historial desde PostgreSQL (Redis vacío) se deben tomar los
 * ÚLTIMOS N mensajes en orden cronológico, no los primeros.
 * Run: node --experimental-test-module-mocks scripts/test-history-order.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const ALL = Array.from({ length: 30 }, (_, i) => ({
  senderType: i % 2 ? 'bot' : 'user', content: `m${i}`, createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
}));
const QUERIES = [];
const findMany = async (q) => {
  QUERIES.push(q);
  const sorted = [...ALL].sort((a, b) => (q.orderBy.createdAt === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  return sorted.slice(0, q.take);
};
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop };
logger.child = () => logger;
const fakeRedisClient = { get: async () => null, setex: async () => 'OK' };

mock.module('../src/core/database/client.js', { defaultExport: { message: { findMany } } });
mock.module('../src/core/database/redis.js', {
  defaultExport: { getClient: () => fakeRedisClient, getConversationHistory: async () => null, setConversationHistory: async () => {} },
});
mock.module('../src/utils/logger.js', { defaultExport: logger });
mock.module('../src/config/env.js', { namedExports: { env: { MAX_CONVERSATION_HISTORY: 20, CONVERSATION_CONTEXT_TTL_SECONDS: 3600 } } });

const expected = ALL.slice(10).map((m) => m.content);

test('Ox (store.js): los últimos 20 en orden cronológico', async () => {
  const { getHistory } = await import('../src/units/oxford-education/store.js');
  const h = await getHistory('conv-ox');
  assert.deepEqual(h.map((m) => m.content), expected);
});

test('Ed (core/ai/conversation.js): los últimos 20 en orden cronológico', async () => {
  const { getHistory } = await import('../src/core/ai/conversation.js');
  const h = await getHistory('conv-ed');
  assert.deepEqual(h.map((m) => m.content), expected);
});
