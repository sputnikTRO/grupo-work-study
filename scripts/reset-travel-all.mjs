/**
 * reset-travel-all.mjs — utilidad MANUAL (NO se importa en la app).
 *
 * Reinicia las conversaciones de MIRI (unit travel) a petición del cliente.
 * Versión masiva de reset-travel-lead.mjs, acotada a travel (reset-all-leads.mjs
 * hace las dos units; este NO toca Ori).
 *
 * Borra, SOLO de travel:
 *   - Conversaciones de la unit travel y sus Mensajes (con eso se van flowNode y
 *     metadata — nudgedNode, etc. —, que viven en la conversación)
 *   - TravelLead de esos contactos (incluidos tickets de asesor abiertos)
 *   - Llaves Redis de travel: conversation:history:<convId> y lock:contact:<tel>
 *
 * Lo que NUNCA toca:
 *   - Contact (compartido entre units).
 *   - Nada de oxford_education: ni conversaciones, ni OxfordLead, ni llaves oxed:*.
 *   - Los TravelLead que creó ORI (travel-handoff.js, notas con "[Vía Ori]") de
 *     contactos que nunca hablaron con Miri: son tickets de viajes que salieron de
 *     Ori y su OxfordLead los referencia por número. Se conservan salvo
 *     --include-ori-handoffs.
 *   - Redis fuera de esas llaves (sheets:cache, zoho:access_token, rate limits).
 *   - Sheets, salvo --sheet, y aun así SOLO la pestaña "Leads" (nunca "Leads
 *     Oxford", "Tiempos asesores" ni "Resumen asesoras"), conservando encabezados.
 *
 * SALVAGUARDAS
 *   1. DRY-RUN por default: cuenta e imprime, con teléfonos enmascarados y fecha
 *      del último mensaje para distinguir números del equipo de prospectos reales.
 *   2. RESPALDO PRIMERO: con --confirm vuelca todo a
 *      <out>/backup-travel-<fecha>.json y lo RELEE; si falla o no cuadra, aborta
 *      sin borrar nada.
 *   3. Borrado de Postgres en UNA transacción: si cualquier conteo no cuadra o
 *      algo truena, rollback completo. Redis y Sheets van después del commit
 *      (no son transaccionales); si fallan, la base ya quedó y el respaldo tiene
 *      lo necesario para reponerlos.
 *
 * Restaurar: node scripts/restore-travel-backup.mjs <archivo> [--confirm]
 *
 * OJO: apunta a la base que digan DATABASE_URL / REDIS_URL. Para producción:
 *   DATABASE_URL='...' REDIS_URL='...' node scripts/reset-travel-all.mjs
 *
 * Uso:
 *   node scripts/reset-travel-all.mjs                          # DRY-RUN
 *   node scripts/reset-travel-all.mjs --confirm                # respalda y borra
 *   node scripts/reset-travel-all.mjs --only-phones=5512345678,5587654321
 *   node scripts/reset-travel-all.mjs --sheet                  # + pestaña "Leads"
 *   node scripts/reset-travel-all.mjs --out=<dir>              # default: scratchpad
 *   node scripts/reset-travel-all.mjs --include-ori-handoffs   # ver arriba
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const UNIT = 'travel';
export const SHEET_NAME = 'Leads'; // la de travel; "Leads Oxford" es otra pestaña
export const HISTORY_PREFIX = 'conversation:history'; // REDIS_KEYS.CONVERSATION_HISTORY
export const LOCK_PREFIX = 'lock:contact'; // REDIS_KEYS.CONTACT_LOCK
export const ORI_MARK = '[Vía Ori]'; // lo escribe oxford-education/travel-handoff.js
const OPEN_TICKET_STATUS = ['derivado_asesor'];

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const maskUrl = (url) => String(url || '').replace(/(:\/\/[^:]*):[^@]*@/, '$1:***@');
const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/** '+5215512341234' → '55****1234' */
export function maskPhone(phone) {
  const d = last10(phone);
  return d.length < 6 ? '****' : `${d.slice(0, 2)}****${d.slice(-4)}`;
}

export function parseArgs(argv) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
  };
  const only = get('only-phones');
  const onlyPhones = only == null ? null : only.split(',').map((p) => p.trim()).filter(Boolean);
  if (onlyPhones && onlyPhones.some((p) => last10(p).length !== 10)) {
    throw new Error(`--only-phones: cada número necesita al menos 10 dígitos (${only})`);
  }
  if (onlyPhones && !onlyPhones.length) throw new Error('--only-phones vacío');
  return {
    confirm: argv.includes('--confirm'),
    sheet: argv.includes('--sheet'),
    includeOriHandoffs: argv.includes('--include-ori-handoffs'),
    onlyPhones,
    outDir: get('out') || 'scratchpad',
  };
}

/** Llaves que matchean un patrón, vía SCAN (nunca KEYS). */
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

async function readKey(redis, key) {
  const type = await redis.type(key);
  const ttl = await redis.pttl(key);
  switch (type) {
    case 'string': return { type, ttl, value: await redis.get(key) };
    case 'list': return { type, ttl, value: await redis.lrange(key, 0, -1) };
    case 'hash': return { type, ttl, value: await redis.hgetall(key) };
    case 'set': return { type, ttl, value: await redis.smembers(key) };
    case 'zset': return { type, ttl, value: await redis.zrange(key, 0, -1, 'WITHSCORES') };
    default: return { type, ttl, value: null };
  }
}

/**
 * Arma el plan sin tocar nada.
 * @returns {Promise<Object>} inventario de lo que se borraría
 */
export async function buildPlan({ prisma, redis, sheet, opts }) {
  // ── Alcance de contactos ────────────────────────────────────────────────
  // Con --only-phones se compara por los últimos 10 dígitos: normalizePhone
  // agrega un '1' de más a '521…' y el Contact puede estar guardado de
  // cualquiera de las dos formas.
  let contactScope = null;
  let notFound = [];
  if (opts.onlyPhones) {
    const wanted = opts.onlyPhones.map(last10);
    const contacts = await prisma.contact.findMany({
      where: { OR: wanted.map((d) => ({ phone: { endsWith: d } })) },
      select: { id: true, phone: true },
    });
    contactScope = contacts.map((c) => c.id);
    notFound = opts.onlyPhones.filter((p) => !contacts.some((c) => last10(c.phone) === last10(p)));
  }
  const byContact = contactScope ? { contactId: { in: contactScope } } : {};

  const convs = await prisma.conversation.findMany({
    where: { unit: UNIT, ...byContact },
    select: { id: true, contactId: true, status: true, flowNode: true, lastMessageAt: true },
  });
  const convIds = convs.map((c) => c.id);
  const withMiri = new Set(convs.map((c) => c.contactId));

  let messageCount = 0;
  for (const ids of chunk(convIds, 500)) {
    messageCount += await prisma.message.count({ where: { conversationId: { in: ids } } });
  }

  const allLeads = await prisma.travelLead.findMany({
    where: byContact,
    select: { id: true, contactId: true, ticketNumber: true, status: true, assignedAdvisor: true, notes: true },
  });
  // Lead "de Ori": lo creó el handoff de Ori y el contacto nunca habló con Miri.
  const isOriOnly = (l) => String(l.notes || '').includes(ORI_MARK) && !withMiri.has(l.contactId);
  const leads = allLeads.filter((l) => opts.includeOriHandoffs || !isOriOnly(l));
  const keptOriLeads = allLeads.filter((l) => !leads.includes(l));
  const leadIds = leads.map((l) => l.id);
  const openTickets = leads.filter((l) => OPEN_TICKET_STATUS.includes(l.status));

  const contactIds = [...new Set([...convs.map((c) => c.contactId), ...leads.map((l) => l.contactId)])];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } } })
    : [];

  // Último mensaje REAL por contacto (lastMessageAt de la conversación).
  const people = contacts.map((c) => {
    const cs = convs.filter((x) => x.contactId === c.id);
    const ls = leads.filter((x) => x.contactId === c.id);
    const last = cs.reduce((m, x) => (!m || x.lastMessageAt > m ? x.lastMessageAt : m), null);
    return {
      contactId: c.id,
      phone: c.phone,
      masked: maskPhone(c.phone),
      conversations: cs.length,
      lastMessageAt: last,
      leads: ls.map((l) => `#${l.ticketNumber}(${l.status}${l.assignedAdvisor ? ` → ${l.assignedAdvisor}` : ''})`),
    };
  }).sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));

  // ── Redis ───────────────────────────────────────────────────────────────
  let redisKeys = [];
  if (redis) {
    const candidates = new Set([
      ...convIds.map((id) => `${HISTORY_PREFIX}:${id}`),
      ...contacts.map((c) => `${LOCK_PREFIX}:${c.phone}`),
    ]);
    if (!contactScope) {
      // Reset total: también historiales huérfanos (de conversaciones que ya no
      // existen), pero nunca el de una conversación viva de otra unit.
      // SCAN MATCH ancla al inicio, así que 'conversation:history:*' no casa
      // con 'oxed:conversation:history:*'.
      const scanned = await scanKeys(redis, `${HISTORY_PREFIX}:*`);
      const suffixes = scanned.map((k) => k.slice(HISTORY_PREFIX.length + 1));
      const alive = new Set();
      for (const ids of chunk(suffixes, 500)) {
        const rows = await prisma.conversation.findMany({
          where: { id: { in: ids }, unit: { not: UNIT } },
          select: { id: true },
        });
        rows.forEach((r) => alive.add(r.id));
      }
      scanned.forEach((k, i) => { if (!alive.has(suffixes[i])) candidates.add(k); });
    }
    for (const k of candidates) {
      if (k.startsWith('oxed:')) continue; // cinturón y tirantes
      if (await redis.exists(k)) redisKeys.push(k);
    }
  }

  // ── Sheet ("Leads") ─────────────────────────────────────────────────────
  let sheetRows = null;
  if (sheet) {
    const values = await sheet.read(); // [[header...], [row...], ...]
    const ids = new Set(leadIds);
    sheetRows = {
      header: values[0] || [],
      // rowNumber 1-based (fila 1 = encabezados).
      rows: values.slice(1)
        .map((row, i) => ({ rowNumber: i + 2, values: row }))
        .filter((r) => r.values.some((v) => String(v ?? '').trim() !== ''))
        .filter((r) => !contactScope || ids.has(String(r.values[0] ?? '').trim())),
    };
  }

  return {
    scoped: Boolean(contactScope),
    notFound,
    convIds,
    convs,
    messageCount,
    leads,
    leadIds,
    keptOriLeads,
    openTickets,
    people,
    redisKeys,
    sheetRows,
  };
}

export function printPlan(plan, opts, log = console.log) {
  log(`\nAlcance: ${plan.scoped ? `SOLO ${opts.onlyPhones.length} teléfono(s) de --only-phones` : 'TODA la unit travel'}`);
  if (plan.notFound.length) log(`  ⚠️  Sin contacto: ${plan.notFound.map(maskPhone).join(', ')}`);
  log('\nSe borraría:');
  log(`  • Conversaciones (travel): ${plan.convIds.length}`);
  log(`  • Mensajes:                ${plan.messageCount}`);
  log(`  • TravelLead:              ${plan.leads.length}`);
  log(`  • Tickets ABIERTOS:        ${plan.openTickets.length}  ${plan.openTickets.map((l) => `#${l.ticketNumber}${l.assignedAdvisor ? `→${l.assignedAdvisor}` : ''}`).join(' ')}`);
  log(`  • Llaves Redis:            ${plan.redisKeys.length}${plan.redisKeys.length ? `  (history ${plan.redisKeys.filter((k) => k.startsWith(HISTORY_PREFIX)).length} · lock ${plan.redisKeys.filter((k) => k.startsWith(LOCK_PREFIX)).length})` : ''}`);
  if (plan.sheetRows) log(`  • Filas pestaña "${SHEET_NAME}": ${plan.sheetRows.rows.length}  (encabezados se conservan)`);
  else log(`  • Sheet: no se toca (usa --sheet para limpiar la pestaña "${SHEET_NAME}")`);
  if (plan.keptOriLeads.length) {
    log(`\n  Se CONSERVAN ${plan.keptOriLeads.length} TravelLead creados por Ori (contactos que nunca hablaron con Miri): ${plan.keptOriLeads.map((l) => `#${l.ticketNumber}`).join(' ')}`);
    log('  (agrega --include-ori-handoffs para borrarlos también)');
  }
  log('  • Contact: NO se borra.  • Oxford / oxed:*: NO se toca.');

  log(`\nContactos afectados (${plan.people.length}), más reciente primero:`);
  log('  teléfono      conv  último mensaje         leads');
  for (const p of plan.people) {
    const when = p.lastMessageAt ? p.lastMessageAt.toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '(sin conversación)';
    log(`  ${p.masked.padEnd(12)}  ${String(p.conversations).padStart(4)}  ${when.padEnd(21)}  ${p.leads.join(' ') || '-'}`);
  }
}

/**
 * Respalda, verifica el respaldo y borra. Devuelve {backupFile, deleted}.
 * Lanza si el respaldo no cuadra (sin haber borrado nada) o si la transacción
 * falla (rollback).
 */
export async function execute({ prisma, redis, sheet, plan, opts, log = console.log, now = new Date() }) {
  // ── 1. Respaldo ─────────────────────────────────────────────────────────
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const backupFile = path.join(opts.outDir, `backup-travel-${stamp}.json`);

  const messages = [];
  for (const ids of chunk(plan.convIds, 500)) {
    messages.push(...await prisma.message.findMany({ where: { conversationId: { in: ids } }, orderBy: { createdAt: 'asc' } }));
  }
  const backup = {
    respaldadoEl: now.toISOString(),
    baseDeDatos: maskUrl(process.env.DATABASE_URL),
    unit: UNIT,
    opciones: { onlyPhones: opts.onlyPhones, sheet: opts.sheet, includeOriHandoffs: opts.includeOriHandoffs },
    // Contactos solo como referencia (NO se borran); el restore los necesita vivos.
    contactos: plan.people.map((p) => ({ id: p.contactId, phone: p.phone })),
    conversaciones: plan.convIds.length
      ? (await Promise.all(chunk(plan.convIds, 500).map((ids) => prisma.conversation.findMany({ where: { id: { in: ids } } })))).flat()
      : [],
    mensajes: messages,
    travelLeads: plan.leadIds.length
      ? (await Promise.all(chunk(plan.leadIds, 500).map((ids) => prisma.travelLead.findMany({ where: { id: { in: ids } } })))).flat()
      : [],
    redis: {},
    sheet: plan.sheetRows ? { tab: SHEET_NAME, header: plan.sheetRows.header, rows: plan.sheetRows.rows } : null,
  };
  if (redis) for (const k of plan.redisKeys) backup.redis[k] = await readKey(redis, k);

  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(backupFile, JSON.stringify(backup, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2));

  // Un respaldo que no se puede releer no es respaldo.
  const re = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  const expected = [plan.convIds.length, plan.messageCount, plan.leadIds.length, plan.redisKeys.length, plan.sheetRows?.rows.length ?? 0];
  const got = [re.conversaciones.length, re.mensajes.length, re.travelLeads.length, Object.keys(re.redis).length, re.sheet?.rows.length ?? 0];
  if (expected.join() !== got.join()) {
    throw new Error(`El respaldo releído no cuadra (esperado conv/msg/leads/redis/sheet ${expected.join('/')}, releído ${got.join('/')}). NO se borró nada.`);
  }
  log(`\n✅ Respaldo verificado: ${path.resolve(backupFile)}  (${Math.round(fs.statSync(backupFile).size / 1024)} KB)`);

  // ── 2. Postgres, todo o nada ────────────────────────────────────────────
  const deleted = await prisma.$transaction(async (tx) => {
    let msgs = 0;
    for (const ids of chunk(plan.convIds, 500)) {
      msgs += (await tx.message.deleteMany({ where: { conversationId: { in: ids } } })).count;
    }
    let convs = 0;
    for (const ids of chunk(plan.convIds, 500)) {
      convs += (await tx.conversation.deleteMany({ where: { id: { in: ids }, unit: UNIT } })).count;
    }
    let leads = 0;
    for (const ids of chunk(plan.leadIds, 500)) {
      leads += (await tx.travelLead.deleteMany({ where: { id: { in: ids } } })).count;
    }
    // Si entre el dry-run interno y aquí llegó un mensaje nuevo, los conteos no
    // cuadran: mejor abortar que borrar algo que no quedó en el respaldo.
    if (msgs !== plan.messageCount || convs !== plan.convIds.length || leads !== plan.leadIds.length) {
      throw new Error(`Conteos no cuadran (msg ${msgs}/${plan.messageCount}, conv ${convs}/${plan.convIds.length}, leads ${leads}/${plan.leadIds.length}) — rollback.`);
    }
    return { messages: msgs, conversations: convs, travelLeads: leads };
  }, { timeout: 120_000, maxWait: 10_000 });
  log(`✅ Postgres (commit): mensajes=${deleted.messages} conversaciones=${deleted.conversations} travelLeads=${deleted.travelLeads}`);

  // ── 3. Redis (después del commit) ───────────────────────────────────────
  deleted.redisKeys = 0;
  if (redis && plan.redisKeys.length) {
    try {
      for (const ks of chunk(plan.redisKeys, 500)) deleted.redisKeys += await redis.del(...ks);
      log(`✅ Redis: ${deleted.redisKeys} llave(s) borradas`);
    } catch (e) {
      log(`⚠️  Redis falló (${e.message}). Postgres ya quedó; las llaves listadas en el respaldo siguen vivas.`);
    }
  }

  // ── 4. Sheet (después del commit) ───────────────────────────────────────
  deleted.sheetRows = 0;
  if (sheet && plan.sheetRows?.rows.length) {
    try {
      if (plan.scoped) await sheet.deleteRows(plan.sheetRows.rows.map((r) => r.rowNumber));
      else await sheet.clearData();
      deleted.sheetRows = plan.sheetRows.rows.length;
      log(`✅ Sheet "${SHEET_NAME}": ${deleted.sheetRows} fila(s) quitadas, encabezados intactos`);
    } catch (e) {
      log(`⚠️  Sheet falló (${e.message}). Postgres ya quedó; las filas están en el respaldo.`);
    }
  }

  return { backupFile, deleted };
}

/** Adaptador mínimo a la pestaña "Leads" del Sheet principal (GOOGLE_SHEETS_ID). */
async function openSheet() {
  const { google } = await import('googleapis');
  const { env } = await import('../src/config/env.js');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_PRIVATE_KEY },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const api = google.sheets({ version: 'v4', auth });
  const spreadsheetId = env.GOOGLE_SHEETS_ID;
  const range = `'${SHEET_NAME}'!A:Z`;
  return {
    async read() {
      const r = await api.spreadsheets.values.get({ spreadsheetId, range });
      return r.data.values || [];
    },
    async clearData() {
      // Desde la fila 2: la 1 son los encabezados.
      await api.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAME}'!A2:Z` });
    },
    async deleteRows(rowNumbers) {
      const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
      const tab = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
      if (!tab) throw new Error(`No existe la pestaña "${SHEET_NAME}"`);
      // De abajo hacia arriba para que los índices no se recorran.
      const requests = [...rowNumbers].sort((a, b) => b - a).map((n) => ({
        deleteDimension: { range: { sheetId: tab.properties.sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
      }));
      await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    },
  };
}

async function main() {
  const log = console.log;
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const { default: prisma } = await import('../src/core/database/client.js');
  let redis = null;
  try {
    log(`\n=== reset-travel-all — ${opts.confirm ? 'CONFIRM (BORRARÁ)' : 'DRY-RUN (no borra)'} ===`);
    log(`Base de datos: ${maskUrl(process.env.DATABASE_URL) || '(DATABASE_URL no definida)'}`);
    log(`Redis:         ${maskUrl(process.env.REDIS_URL) || '(REDIS_URL no definida — no se limpiará Redis)'}`);

    if (process.env.REDIS_URL) {
      const Redis = (await import('ioredis')).default;
      redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
      await redis.connect();
    }
    const sheet = opts.sheet ? await openSheet() : null;

    const plan = await buildPlan({ prisma, redis, sheet, opts });
    printPlan(plan, opts, log);

    const nothing = !plan.convIds.length && !plan.leadIds.length && !plan.redisKeys.length && !(plan.sheetRows?.rows.length);
    if (nothing) log('\nNada que borrar.');
    else if (!opts.confirm) log('\n(DRY-RUN) No se borró nada. Vuelve a correr con --confirm para ejecutar.');
    else {
      const { backupFile } = await execute({ prisma, redis, sheet, plan, opts, log });
      log(`\nRespaldo: ${path.resolve(backupFile)}`);
      log(`Restaurar: node scripts/restore-travel-backup.mjs ${backupFile} --confirm`);
      log('Escríbele a Miri y debe arrancar desde "bienvenida".');
    }
    log('');
    await redis?.quit().catch(() => {});
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error('   Si falló antes o durante la transacción, Postgres quedó intacto.');
    await redis?.quit().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
