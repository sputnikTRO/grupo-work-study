#!/usr/bin/env node
/**
 * Resets a conversation status from 'waiting_human' back to 'active'
 * Use when testing or when a new prospect contacts from same phone number
 *
 * Run: node scripts/reset-conversation.js +5215531122119
 */

import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../src/utils/phone.js';
import logger from '../src/utils/logger.js';

const prisma = new PrismaClient();

async function resetConversation() {
  const phone = process.argv[2];

  if (!phone) {
    console.error('\n❌ Error: Debes proporcionar un número de teléfono');
    console.log('\nUso: node scripts/reset-conversation.js +5215531122119\n');
    process.exit(1);
  }

  const normalizedPhone = normalizePhone(phone);
  const scriptLogger = logger.child({ script: 'reset-conversation', phone: normalizedPhone });

  try {
    scriptLogger.info('Searching for contact and conversations');

    // Find contact
    const contact = await prisma.contact.findUnique({
      where: { phone: normalizedPhone },
    });

    if (!contact) {
      console.log(`\n⚠️  No se encontró contacto con teléfono: ${normalizedPhone}\n`);
      process.exit(0);
    }

    console.log(`\n✅ Contacto encontrado: ${contact.name || 'Sin nombre'}`);

    // Find active conversations
    const conversations = await prisma.conversation.findMany({
      where: {
        contactId: contact.id,
        status: 'waiting_human',
      },
    });

    if (conversations.length === 0) {
      console.log(`\n✅ No hay conversaciones en estado 'waiting_human'\n`);
      process.exit(0);
    }

    console.log(`\n📋 Encontradas ${conversations.length} conversación(es) en 'waiting_human':`);
    conversations.forEach((conv, index) => {
      console.log(`  ${index + 1}. Unit: ${conv.unit}, Status: ${conv.status}`);
    });

    // Reset all to 'active'
    const result = await prisma.conversation.updateMany({
      where: {
        contactId: contact.id,
        status: 'waiting_human',
      },
      data: {
        status: 'active',
        assignedAgent: null,
      },
    });

    console.log(`\n✅ ${result.count} conversación(es) reseteadas a estado 'active'`);
    console.log(`\n✨ El bot ahora responderá nuevamente a mensajes de ${normalizedPhone}\n`);

    scriptLogger.info({ count: result.count }, 'Conversations reset successfully');

  } catch (error) {
    scriptLogger.error({ err: error }, 'Error resetting conversation');
    console.error('\n❌ Error:', error.message, '\n');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
resetConversation();
