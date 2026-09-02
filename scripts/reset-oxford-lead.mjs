/**
 * reset-oxford-lead.mjs — utilidad MANUAL (NO se importa en la app).
 *
 * Borra el rastro de UN contacto SOLO en la unit oxford-education:
 *   - OxfordLead(s) del contacto
 *   - Conversaciones de la unit oxford_education y sus Mensajes
 *   - Llaves Redis del namespace oxed: (historial por conversación + lock del número)
 *
 * NUNCA borra el Contact (es compartido con otras units) ni toca travel.
 * NUNCA es masivo: opera sobre un único contactId resuelto por teléfono.
 *
 * Uso:
 *   node scripts/reset-oxford-lead.mjs <telefono>            # DRY-RUN (no borra)
 *   node scripts/reset-oxford-lead.mjs <telefono> --confirm  # borra de verdad
 *
 * Requiere DATABASE_URL (y REDIS_URL para limpiar Redis con --confirm).
 */
import prisma from '../src/core/database/client.js';
import { normalizePhone } from '../src/utils/phone.js';
import { OXED_REDIS_KEYS } from '../src/config/constants.js';

const UNIT = 'oxford_education';

function usageAndExit(msg) {
  if (msg) console.error(`\n❌ ${msg}`);
  console.error(`
Uso:
  node scripts/reset-oxford-lead.mjs <telefono>            # DRY-RUN (no borra)
  node scripts/reset-oxford-lead.mjs <telefono> --confirm  # borra de verdad

Ejemplo:
  node scripts/reset-oxford-lead.mjs 5215512345678
`);
  process.exit(1);
}

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const phoneArg = args.find((a) => !a.startsWith('--'));

if (!phoneArg) usageAndExit('Falta el teléfono (argumento obligatorio).');

let phone;
try {
  phone = normalizePhone(phoneArg);
} catch (e) {
  usageAndExit(`Teléfono inválido: ${e.message}`);
}

const mode = confirm ? 'CONFIRM (borrará)' : 'DRY-RUN (no borra)';
console.log(`\n=== reset-oxford-lead — ${mode} ===`);
console.log(`Teléfono normalizado: ${phone}`);

try {
  const contact = await prisma.contact.findUnique({ where: { phone } });
  if (!contact) {
    console.log('ℹ️  No existe ningún contacto con ese teléfono. Nada que hacer.');
    await prisma.$disconnect();
    process.exit(0);
  }
  console.log(`Contacto: ${contact.id}  (sourceUnit=${contact.sourceUnit})`);

  // Conversaciones SOLO de la unit oxford_education de este contacto.
  const convs = await prisma.conversation.findMany({
    where: { contactId: contact.id, unit: UNIT },
    select: { id: true, status: true },
  });
  const convIds = convs.map((c) => c.id);

  const messageCount = convIds.length
    ? await prisma.message.count({ where: { conversationId: { in: convIds } } })
    : 0;

  const oxfordLeads = await prisma.oxfordLead.findMany({
    where: { contactId: contact.id },
    select: { id: true, ticketNumber: true, status: true, assignedAdvisor: true },
  });

  // Llaves Redis del namespace oxed: historial por conversación + lock del número.
  const redisKeys = [
    ...convIds.map((id) => `${OXED_REDIS_KEYS.CONVERSATION_HISTORY}:${id}`),
    `${OXED_REDIS_KEYS.CONTACT_LOCK}:${phone}`,
  ];

  // ── Plan ──────────────────────────────────────────────────────────────────
  console.log('\nSe borraría (scope: SOLO oxford-education de este contacto):');
  console.log(`  • OxfordLead(s):        ${oxfordLeads.length}  ${oxfordLeads.map((l) => `#${l.ticketNumber ?? '?'}(${l.status})`).join(' ')}`);
  console.log(`  • Conversaciones (${UNIT}): ${convIds.length}`);
  console.log(`  • Mensajes (de esas conv): ${messageCount}`);
  console.log(`  • Llaves Redis (${redisKeys.length}):`);
  redisKeys.forEach((k) => console.log(`      - ${k}`));
  console.log('  • Contact: NO se borra (compartido).  • Travel: NO se toca.');

  if (!confirm) {
    console.log('\n(DRY-RUN) No se borró nada. Vuelve a correr con --confirm para ejecutar.\n');
    await prisma.$disconnect();
    process.exit(0);
  }

  // ── Borrado real (orden FK-safe; Contact NO se borra) ───────────────────────
  let delMessages = { count: 0 };
  let delConvs = { count: 0 };
  if (convIds.length) {
    delMessages = await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    delConvs = await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  }
  const delLeads = await prisma.oxfordLead.deleteMany({ where: { contactId: contact.id } });

  // Redis (best-effort). Solo si hay REDIS_URL.
  let redisDeleted = 0;
  if (process.env.REDIS_URL && redisKeys.length) {
    const Redis = (await import('ioredis')).default;
    const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
    try {
      await r.connect();
      redisDeleted = await r.del(...redisKeys);
    } catch (e) {
      console.warn(`⚠️  No se pudieron limpiar llaves Redis: ${e.message}`);
    } finally {
      await r.quit().catch(() => {});
    }
  } else if (redisKeys.length) {
    console.warn('⚠️  REDIS_URL no definido: NO se limpiaron llaves Redis (bórralas manualmente si aplica).');
  }

  console.log('\n✅ Borrado completado:');
  console.log(`   messages=${delMessages.count}  conversations=${delConvs.count}  oxfordLeads=${delLeads.count}  redisKeys=${redisDeleted}`);
  console.log('   Contact intacto. Travel intacto.\n');

  await prisma.$disconnect();
  process.exit(0);
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}
