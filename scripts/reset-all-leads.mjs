/**
 * reset-all-leads.mjs — utilidad MANUAL (NO se importa en la app).
 *
 * Versión MASIVA de reset-travel-lead.mjs / reset-oxford-lead.mjs: deja en
 * blanco las DOS unidades de WhatsApp (travel/Miri y oxford_education/Ori) para
 * arrancar limpio, p. ej. antes de publicar el botón de WhatsApp del sitio.
 *
 * Borra, de AMBAS units:
 *   - TravelLead + OxfordLead (TODOS, incluidos los tickets de asesor abiertos)
 *   - Conversaciones de esas dos units y sus Mensajes
 *   - Llaves Redis de los dos namespaces (historial de conversación + locks)
 *
 * Lo que NUNCA toca:
 *   - La tabla Contact (es COMPARTIDA entre unidades).
 *   - La unit work_study: existe en el enum Unit y sus conversaciones quedan
 *     intactas. El borrado va filtrado por unit, nunca es un "borra todo".
 *   - Redis fuera de los dos namespaces: sheets:cache (contenido) y
 *     zoho:access_token (credencial viva) NO se tocan. Por eso se borra por
 *     PATRÓN explícito y jamás con FLUSHDB.
 *   - Google Sheets: las pestañas Leads / Leads Oxford conservan sus filas.
 *     Los leads nuevos se escriben con IDs distintos; si quieres la hoja
 *     limpia, hay que vaciarla a mano.
 *
 * SALVAGUARDAS
 *   1. DRY-RUN por default: sin --confirm solo cuenta e imprime. No borra nada.
 *   2. RESPALDO PRIMERO: con --confirm vuelca todo lo que va a borrar a
 *      scratchpad/reset-all-backup-<timestamp>.json ANTES de tocar la base. Si
 *      el respaldo falla —o se relee y no cuadra— ABORTA sin borrar nada.
 *   3. Verificación final: recuenta y avisa si algo quedó vivo.
 *
 * OJO: apunta a la base que digan DATABASE_URL / REDIS_URL. Para producción hay
 * que correrlo con las de Railway, no con las locales:
 *   DATABASE_URL='...' REDIS_URL='...' node scripts/reset-all-leads.mjs
 *
 * Uso:
 *   node scripts/reset-all-leads.mjs                 # DRY-RUN (no borra)
 *   node scripts/reset-all-leads.mjs --confirm       # respalda y borra
 *   node scripts/reset-all-leads.mjs --out <dir>     # carpeta del respaldo
 */
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../src/core/database/client.js';
import { REDIS_KEYS, OXED_REDIS_KEYS } from '../src/config/constants.js';

// Las DOS units que se reinician. work_study NO está aquí a propósito.
const UNITS = ['travel', 'oxford_education'];

// Patrones de Redis a limpiar, por namespace. Explícitos y acotados: nada de
// FLUSHDB ni de comodines amplios que puedan llevarse el cache o los tokens.
const REDIS_PATTERNS = [
  `${REDIS_KEYS.CONVERSATION_HISTORY}:*`,      // travel  → conversation:history:*
  `${REDIS_KEYS.CONTACT_LOCK}:*`,              // travel  → lock:contact:*
  `${OXED_REDIS_KEYS.CONVERSATION_HISTORY}:*`, // oxford  → oxed:conversation:history:*
  `${OXED_REDIS_KEYS.CONTACT_LOCK}:*`,         // oxford  → oxed:lock:contact:*
];

// "Ticket abierto" = derivado y todavía sin cerrar. Cada unit tiene su enum:
// travel no tiene 'en_atencion' (eso es del SLA de Oxford), así que las listas
// van por separado — un valor inexistente en el enum reventaría la query.
const OPEN_TICKET_STATUS = {
  travel: ['derivado_asesor'],
  oxford_education: ['derivado_asesor', 'en_atencion', 'sin_confirmar'],
};

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'scratchpad';

const mask = (url) => String(url || '').replace(/(:\/\/[^:]*):[^@]*@/, '$1:***@');
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Abre Redis solo si hay REDIS_URL. Devuelve null si no. */
async function openRedis() {
  if (!process.env.REDIS_URL) return null;
  const Redis = (await import('ioredis')).default;
  const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
  await r.connect();
  return r;
}

/** Llaves que matchean un patrón, vía SCAN (nunca KEYS: no bloquea el servidor). */
async function scanKeys(redis, pattern) {
  const found = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

/** Valor de una llave, sea cual sea su tipo (para que el respaldo sirva de verdad). */
async function readKey(redis, key) {
  const type = await redis.type(key);
  switch (type) {
    case 'string': return { type, value: await redis.get(key) };
    case 'list': return { type, value: await redis.lrange(key, 0, -1) };
    case 'hash': return { type, value: await redis.hgetall(key) };
    case 'set': return { type, value: await redis.smembers(key) };
    case 'zset': return { type, value: await redis.zrange(key, 0, -1, 'WITHSCORES') };
    default: return { type, value: null };
  }
}

const log = console.log;

try {
  log(`\n=== reset-all-leads — ${confirm ? 'CONFIRM (BORRARÁ)' : 'DRY-RUN (no borra)'} ===`);
  log(`Base de datos: ${mask(process.env.DATABASE_URL) || '(DATABASE_URL no definida)'}`);
  log(`Redis:         ${mask(process.env.REDIS_URL) || '(REDIS_URL no definida — no se limpiará Redis)'}`);
  log(`Units:         ${UNITS.join(', ')}   (work_study NO se toca)`);

  // ── Inventario ────────────────────────────────────────────────────────────
  const convs = await prisma.conversation.findMany({
    where: { unit: { in: UNITS } },
    select: { id: true, unit: true },
  });
  const convIds = convs.map((c) => c.id);
  const messageCount = convIds.length
    ? await prisma.message.count({ where: { conversationId: { in: convIds } } })
    : 0;

  const travelLeads = await prisma.travelLead.findMany({ select: { id: true, status: true } });
  const oxfordLeads = await prisma.oxfordLead.findMany({ select: { id: true, status: true } });

  const porUnit = (u) => convs.filter((c) => c.unit === u).length;
  const cuenta = (leads) => leads.reduce((acc, l) => ({ ...acc, [l.status]: (acc[l.status] || 0) + 1 }), {});
  const abiertos = (leads, u) => leads.filter((l) => OPEN_TICKET_STATUS[u].includes(l.status)).length;

  const otrasUnits = await prisma.conversation.count({ where: { unit: { notIn: UNITS } } });

  log('\nSe borraría:');
  log(`  • Conversaciones:  ${convIds.length}   (travel ${porUnit('travel')} · oxford_education ${porUnit('oxford_education')})`);
  log(`  • Mensajes:        ${messageCount}`);
  log(`  • TravelLead:      ${travelLeads.length}`);
  log(`  • OxfordLead:      ${oxfordLeads.length}`);
  log(`\n  Tickets de asesor ABIERTOS que se pierden:`);
  log(`    - travel (${OPEN_TICKET_STATUS.travel.join('/')}):            ${abiertos(travelLeads, 'travel')}`);
  log(`    - oxford (${OPEN_TICKET_STATUS.oxford_education.join('/')}):  ${abiertos(oxfordLeads, 'oxford_education')}`);
  log(`\n  Desglose por estatus:`);
  log(`    travel: ${JSON.stringify(cuenta(travelLeads))}`);
  log(`    oxford: ${JSON.stringify(cuenta(oxfordLeads))}`);

  // ── Redis ─────────────────────────────────────────────────────────────────
  let redis = null;
  let redisKeys = [];
  try {
    redis = await openRedis();
    if (redis) {
      for (const p of REDIS_PATTERNS) {
        const ks = await scanKeys(redis, p);
        redisKeys.push(...ks);
        log(`  • Redis ${p.padEnd(34)} ${ks.length} llave(s)`);
      }
    } else {
      log('  • Redis: REDIS_URL no definida — NO se limpiará (bórralo a mano si aplica).');
    }
  } catch (e) {
    log(`  ⚠️  Redis inaccesible (${e.message}) — se seguirá solo con Postgres.`);
    redis = null;
  }

  log(`\n  NO se borra: Contact (compartida) · conversaciones de work_study (${otrasUnits}) · Sheets · sheets:cache · zoho:access_token`);

  // ── DRY-RUN ───────────────────────────────────────────────────────────────
  if (!confirm) {
    // Se comprueba desde ya que el respaldo podrá escribirse, para que la
    // corrida con --confirm no falle tarde y a medias.
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const probe = path.join(outDir, '.reset-all-probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      log(`\n  Respaldo: se escribiría en ${path.resolve(outDir)}/reset-all-backup-<timestamp>.json  ✅ carpeta escribible`);
    } catch (e) {
      log(`\n  ⚠️  OJO: no se puede escribir en "${outDir}" (${e.message}). Con --confirm abortaría.`);
    }
    log('\n(DRY-RUN) No se borró nada. Vuelve a correr con --confirm para ejecutar.\n');
    await redis?.quit().catch(() => {});
    await prisma.$disconnect();
    process.exit(0);
  }

  if (convIds.length === 0 && travelLeads.length === 0 && oxfordLeads.length === 0 && redisKeys.length === 0) {
    log('\nNada que borrar: ya está todo en blanco.\n');
    await redis?.quit().catch(() => {});
    await prisma.$disconnect();
    process.exit(0);
  }

  // ── 1. RESPALDO (antes de tocar nada) ─────────────────────────────────────
  log('\n── Respaldo ──');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(outDir, `reset-all-backup-${stamp}.json`);

  const backup = {
    respaldadoEl: new Date().toISOString(),
    baseDeDatos: mask(process.env.DATABASE_URL),
    units: UNITS,
    travelLeads: await prisma.travelLead.findMany(),
    oxfordLeads: await prisma.oxfordLead.findMany(),
    conversaciones: await prisma.conversation.findMany({ where: { unit: { in: UNITS } } }),
    mensajes: convIds.length
      ? (await Promise.all(chunk(convIds, 200).map((ids) =>
          prisma.message.findMany({ where: { conversationId: { in: ids } }, orderBy: { createdAt: 'asc' } }))))
        .flat()
      : [],
    redis: {},
  };
  if (redis) {
    for (const k of redisKeys) backup.redis[k] = await readKey(redis, k);
  }

  fs.mkdirSync(outDir, { recursive: true });
  // BigInt no es serializable por JSON.stringify; Date sí (ISO).
  fs.writeFileSync(backupFile, JSON.stringify(backup, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2));

  // Se RELEE el archivo y se comprueba que cuadra. Un respaldo que no se puede
  // volver a leer no es un respaldo.
  const releido = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  const ok =
    releido.travelLeads.length === travelLeads.length &&
    releido.oxfordLeads.length === oxfordLeads.length &&
    releido.conversaciones.length === convIds.length &&
    releido.mensajes.length === messageCount &&
    Object.keys(releido.redis).length === redisKeys.length;

  if (!ok) {
    console.error('\n❌ ABORTA: el respaldo releído no cuadra con lo que hay en la base. NO se borró nada.');
    console.error(`   esperado: leads ${travelLeads.length}/${oxfordLeads.length} · conv ${convIds.length} · msgs ${messageCount} · redis ${redisKeys.length}`);
    console.error(`   releído:  leads ${releido.travelLeads.length}/${releido.oxfordLeads.length} · conv ${releido.conversaciones.length} · msgs ${releido.mensajes.length} · redis ${Object.keys(releido.redis).length}`);
    await redis?.quit().catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  }

  const kb = Math.round(fs.statSync(backupFile).size / 1024);
  log(`✅ Respaldo verificado: ${path.resolve(backupFile)}  (${kb} KB)`);
  log(`   ${releido.travelLeads.length} travelLeads · ${releido.oxfordLeads.length} oxfordLeads · ${releido.conversaciones.length} conversaciones · ${releido.mensajes.length} mensajes · ${Object.keys(releido.redis).length} llaves Redis`);

  // ── 2. Borrado (orden FK-safe: mensajes → conversaciones → leads) ─────────
  log('\n── Borrado ──');
  let delMessages = 0;
  for (const ids of chunk(convIds, 200)) {
    const r = await prisma.message.deleteMany({ where: { conversationId: { in: ids } } });
    delMessages += r.count;
  }
  const delConvs = await prisma.conversation.deleteMany({ where: { unit: { in: UNITS } } });
  const delTravel = await prisma.travelLead.deleteMany({});
  const delOxford = await prisma.oxfordLead.deleteMany({});

  let redisDeleted = 0;
  if (redis && redisKeys.length) {
    for (const ks of chunk(redisKeys, 500)) redisDeleted += await redis.del(...ks);
  }

  // ── 3. Verificación final ─────────────────────────────────────────────────
  const quedan = {
    conversaciones: await prisma.conversation.count({ where: { unit: { in: UNITS } } }),
    travelLeads: await prisma.travelLead.count(),
    oxfordLeads: await prisma.oxfordLead.count(),
    workStudy: await prisma.conversation.count({ where: { unit: { notIn: UNITS } } }),
    contacts: await prisma.contact.count(),
  };

  log('\n✅ Borrado completado:');
  log(`   mensajes=${delMessages}  conversaciones=${delConvs.count}  travelLeads=${delTravel.count}  oxfordLeads=${delOxford.count}  redisKeys=${redisDeleted}`);
  log(`\n   Quedan (debería ser 0 en las tres primeras):`);
  log(`     conversaciones de travel/oxford: ${quedan.conversaciones}${quedan.conversaciones ? '  ⚠️' : ''}`);
  log(`     travelLeads: ${quedan.travelLeads}${quedan.travelLeads ? '  ⚠️' : ''}   oxfordLeads: ${quedan.oxfordLeads}${quedan.oxfordLeads ? '  ⚠️' : ''}`);
  log(`   Intactos: contactos=${quedan.contacts} · conversaciones de work_study=${quedan.workStudy}`);
  log(`\n   Respaldo: ${path.resolve(backupFile)}`);
  log('   Escríbele a cualquiera de los dos bots y debe arrancar desde el saludo.\n');

  await redis?.quit().catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  console.error('   Si falló ANTES del respaldo, no se borró nada.');
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}
