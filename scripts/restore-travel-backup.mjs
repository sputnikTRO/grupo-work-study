/**
 * restore-travel-backup.mjs — utilidad MANUAL (NO se importa en la app).
 *
 * Deshace reset-travel-all.mjs a partir de su respaldo
 * (backup-travel-<fecha>.json): vuelve a insertar TravelLead, Conversaciones y
 * Mensajes con sus IDs, ticketNumber y fechas originales, en UNA transacción.
 * Opcionalmente repone las llaves Redis (--redis) y las filas de la pestaña
 * "Leads" (--sheet, las agrega al final).
 *
 * Idempotente: usa skipDuplicates, así que correrlo dos veces no duplica nada.
 * Los Contact no se tocan (reset-travel-all nunca los borra); si alguno ya no
 * existe, aborta antes de insertar.
 *
 * Uso:
 *   node scripts/restore-travel-backup.mjs <archivo>                 # DRY-RUN
 *   node scripts/restore-travel-backup.mjs <archivo> --confirm [--redis] [--sheet]
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function restore({ prisma, redis, sheet, backup, log = console.log }) {
  const contactIds = [...new Set([
    ...backup.conversaciones.map((c) => c.contactId),
    ...backup.travelLeads.map((l) => l.contactId),
  ])];
  const existing = await prisma.contact.count({ where: { id: { in: contactIds } } });
  if (existing !== contactIds.length) {
    throw new Error(`Faltan ${contactIds.length - existing} Contact referenciados por el respaldo. No se restauró nada.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const r = { travelLeads: 0, conversations: 0, messages: 0 };
    for (const rows of chunk(backup.travelLeads, 500)) {
      r.travelLeads += (await tx.travelLead.createMany({ data: rows, skipDuplicates: true })).count;
    }
    for (const rows of chunk(backup.conversaciones, 500)) {
      r.conversations += (await tx.conversation.createMany({ data: rows, skipDuplicates: true })).count;
    }
    for (const rows of chunk(backup.mensajes, 1000)) {
      r.messages += (await tx.message.createMany({ data: rows, skipDuplicates: true })).count;
    }
    return r;
  }, { timeout: 120_000, maxWait: 10_000 });
  log(`✅ Postgres: travelLeads=${result.travelLeads} conversaciones=${result.conversations} mensajes=${result.messages} (los ya existentes se saltan)`);

  result.redisKeys = 0;
  if (redis) {
    for (const [key, { type, ttl, value }] of Object.entries(backup.redis || {})) {
      if (key.startsWith('oxed:') || value == null) continue;
      if (await redis.exists(key)) continue;
      if (type === 'string') await redis.set(key, value);
      else if (type === 'list' && value.length) await redis.rpush(key, ...value);
      else if (type === 'hash' && Object.keys(value).length) await redis.hset(key, value);
      else if (type === 'set' && value.length) await redis.sadd(key, ...value);
      else if (type === 'zset' && value.length) {
        const args = [];
        for (let i = 0; i < value.length; i += 2) args.push(value[i + 1], value[i]);
        await redis.zadd(key, ...args);
      } else continue;
      if (ttl > 0) await redis.pexpire(key, ttl);
      result.redisKeys++;
    }
    log(`✅ Redis: ${result.redisKeys} llave(s) repuestas`);
  }

  result.sheetRows = 0;
  if (sheet && backup.sheet?.rows.length) {
    await sheet.append(backup.sheet.rows.map((r) => r.values));
    result.sheetRows = backup.sheet.rows.length;
    log(`✅ Sheet "${backup.sheet.tab}": ${result.sheetRows} fila(s) agregadas al final`);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Uso: node scripts/restore-travel-backup.mjs <backup-travel-*.json> [--confirm] [--redis] [--sheet]');
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`\n=== restore-travel-backup — ${args.includes('--confirm') ? 'CONFIRM' : 'DRY-RUN'} ===`);
  console.log(`Respaldo del ${backup.respaldadoEl} (${backup.baseDeDatos})`);
  console.log(`  travelLeads=${backup.travelLeads.length} conversaciones=${backup.conversaciones.length} mensajes=${backup.mensajes.length} redis=${Object.keys(backup.redis || {}).length} filasSheet=${backup.sheet?.rows.length ?? 0}`);
  if (!args.includes('--confirm')) {
    console.log('\n(DRY-RUN) Nada restaurado. Agrega --confirm (y --redis / --sheet si aplica).\n');
    process.exit(0);
  }

  const { default: prisma } = await import('../src/core/database/client.js');
  let redis = null;
  try {
    if (args.includes('--redis')) {
      const Redis = (await import('ioredis')).default;
      redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
      await redis.connect();
    }
    let sheet = null;
    if (args.includes('--sheet')) {
      const { appendRows } = await import('../src/core/sheets/client.js');
      const { env } = await import('../src/config/env.js');
      sheet = { append: (rows) => appendRows(env.GOOGLE_SHEETS_ID, backup.sheet.tab, rows) };
    }
    await restore({ prisma, redis, sheet, backup });
    await redis?.quit().catch(() => {});
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    await redis?.quit().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
