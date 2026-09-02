/**
 * reset-travel-lead.mjs — utilidad MANUAL (NO se importa en la app).
 *
 * Gemelo de reset-oxford-lead.mjs, para la unit TRAVEL (Miri). Borra el rastro de
 * UN contacto SOLO en travel, para poder volver a probar el flujo desde cero:
 *   - TravelLead(s) del contacto
 *   - Conversaciones de la unit travel y sus Mensajes (con esto se va también el
 *     flowNode, que es lo que hace que Miri arranque otra vez en "bienvenida")
 *   - Llaves Redis del namespace de travel (historial por conversación + lock)
 *
 * NUNCA borra el Contact (es compartido con otras units) ni toca oxford-education.
 * NUNCA es masivo: opera sobre un único contactId resuelto por teléfono.
 *
 * OJO: apunta a la base que diga DATABASE_URL. Para resetear PRODUCCIÓN hay que
 * correrlo con la DATABASE_URL/REDIS_URL de Railway, no con las locales:
 *   DATABASE_URL='...' REDIS_URL='...' node scripts/reset-travel-lead.mjs <tel> --confirm
 *
 * Uso:
 *   node scripts/reset-travel-lead.mjs <telefono>            # DRY-RUN (no borra)
 *   node scripts/reset-travel-lead.mjs <telefono> --confirm  # borra de verdad
 *
 * Requiere DATABASE_URL (y REDIS_URL para limpiar Redis con --confirm).
 */
import prisma from '../src/core/database/client.js';
import { normalizePhone } from '../src/utils/phone.js';
import { REDIS_KEYS } from '../src/config/constants.js';

const UNIT = 'travel';

function usageAndExit(msg) {
  if (msg) console.error(`\n❌ ${msg}`);
  console.error(`
Uso:
  node scripts/reset-travel-lead.mjs <telefono>            # DRY-RUN (no borra)
  node scripts/reset-travel-lead.mjs <telefono> --confirm  # borra de verdad

Ejemplo:
  node scripts/reset-travel-lead.mjs 5215512345678
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
const dbHost = (process.env.DATABASE_URL || '').replace(/(:\/\/[^:]*):[^@]*@/, '$1:***@');
console.log(`\n=== reset-travel-lead — ${mode} ===`);
console.log(`Base de datos: ${dbHost || '(DATABASE_URL no definida)'}`);
console.log(`Teléfono normalizado: ${phone}`);

try {
  const contact = await prisma.contact.findUnique({ where: { phone } });
  if (!contact) {
    console.log('ℹ️  No existe ningún contacto con ese teléfono. Nada que hacer.');
    await prisma.$disconnect();
    process.exit(0);
  }
  console.log(`Contacto: ${contact.id}  (sourceUnit=${contact.sourceUnit})`);

  // Conversaciones SOLO de la unit travel de este contacto.
  const convs = await prisma.conversation.findMany({
    where: { contactId: contact.id, unit: UNIT },
    select: { id: true, status: true, flowNode: true },
  });
  const convIds = convs.map((c) => c.id);

  const messageCount = convIds.length
    ? await prisma.message.count({ where: { conversationId: { in: convIds } } })
    : 0;

  const travelLeads = await prisma.travelLead.findMany({
    where: { contactId: contact.id },
    select: { id: true, ticketNumber: true, status: true, assignedAdvisor: true, schoolCode: true },
  });

  const redisKeys = [
    ...convIds.map((id) => `${REDIS_KEYS.CONVERSATION_HISTORY}:${id}`),
    `${REDIS_KEYS.CONTACT_LOCK}:${phone}`,
  ];

  // ── Plan ──────────────────────────────────────────────────────────────────
  console.log('\nSe borraría (scope: SOLO travel de este contacto):');
  console.log(`  • TravelLead(s):        ${travelLeads.length}  ${travelLeads.map((l) => `#${l.ticketNumber ?? '?'}(${l.status}${l.assignedAdvisor ? ` → ${l.assignedAdvisor}` : ''})`).join(' ')}`);
  console.log(`  • Conversaciones (${UNIT}): ${convIds.length}  ${convs.map((c) => `${c.status}/flowNode=${c.flowNode ?? 'null'}`).join(' ')}`);
  console.log(`  • Mensajes (de esas conv): ${messageCount}`);
  console.log(`  • Llaves Redis (${redisKeys.length}):`);
  redisKeys.forEach((k) => console.log(`      - ${k}`));
  console.log('  • Contact: NO se borra (compartido).  • Oxford: NO se toca.');
  console.log('\n  Nota: la fila del lead en la pestaña "Leads" del Sheet NO se borra;');
  console.log('  se vuelve a escribir con el lead nuevo (ID distinto) en el próximo mensaje.');

  if (!confirm) {
    console.log('\n(DRY-RUN) No se borró nada. Vuelve a correr con --confirm para ejecutar.\n');
    await prisma.$disconnect();
    process.exit(0);
  }

  // ── Borrado real (orden FK-safe; Contact NO se borra) ──────────────────────
  let delMessages = { count: 0 };
  let delConvs = { count: 0 };
  if (convIds.length) {
    delMessages = await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    delConvs = await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  }
  const delLeads = await prisma.travelLead.deleteMany({ where: { contactId: contact.id } });

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
  console.log(`   messages=${delMessages.count}  conversations=${delConvs.count}  travelLeads=${delLeads.count}  redisKeys=${redisDeleted}`);
  console.log('   Contact intacto. Oxford intacto.');
  console.log('   Escríbele a Miri y debe arrancar en "bienvenida" + "filtro_previo".\n');

  await prisma.$disconnect();
  process.exit(0);
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}
