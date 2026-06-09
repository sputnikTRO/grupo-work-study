/**
 * One-off cleanup: delete specific test contacts and all their dependent rows
 * (messages, conversations, oxford_leads, travel_leads) in FK-safe order.
 *
 * Usage: DATABASE_URL=... node scripts/delete-test-leads.mjs <phone1> <phone2> ...
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const phones = process.argv.slice(2);

if (phones.length === 0) {
  console.error('No phones provided.');
  process.exit(1);
}

try {
  for (const phone of phones) {
    const contact = await prisma.contact.findUnique({ where: { phone } });
    if (!contact) {
      console.log(`SKIP  ${phone} — no contact found`);
      continue;
    }

    const convs = await prisma.conversation.findMany({ where: { contactId: contact.id }, select: { id: true } });
    const convIds = convs.map((c) => c.id);

    const msgs = convIds.length
      ? await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
      : { count: 0 };
    const oxLeads = await prisma.oxfordLead.deleteMany({ where: { contactId: contact.id } });
    const tvLeads = await prisma.travelLead.deleteMany({ where: { contactId: contact.id } });
    const delConvs = await prisma.conversation.deleteMany({ where: { contactId: contact.id } });
    await prisma.contact.delete({ where: { id: contact.id } });

    console.log(`DELETED ${phone} (contact ${contact.id}) — messages=${msgs.count} oxfordLeads=${oxLeads.count} travelLeads=${tvLeads.count} conversations=${delConvs.count}`);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
