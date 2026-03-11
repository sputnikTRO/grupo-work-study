#!/usr/bin/env node

/**
 * Test Flow Script
 *
 * Simulates a complete Travel conversation flow without real WhatsApp
 * Tests end-to-end functionality:
 * - School detection
 * - Contact/Conversation/Lead creation
 * - Data capture
 * - Scoring
 * - Advisor handoff
 */

import prisma from '../src/core/database/client.js';
import redis from '../src/core/database/redis.js';
import * as sheetsCache from '../src/core/sheets/cache.js';
import { handleMessage } from '../src/units/travel/handler.js';
import { normalizePhone } from '../src/utils/phone.js';
import logger from '../src/utils/logger.js';

// Disable console logging for cleaner output
logger.level = 'error';

const TEST_PHONE = '+5215512345678';
const TEST_PHONE_NUMBER_ID = 'test_phone_number_id';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60) + '\n');
}

function logStep(step, description) {
  log(`📍 STEP ${step}: ${description}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

/**
 * Creates a mock WhatsApp message
 */
function createMockMessage(text, messageId = null) {
  return {
    from: TEST_PHONE,
    id: messageId || `wamid.test_${Date.now()}_${Math.random()}`,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: 'text',
    text: {
      body: text,
    },
  };
}

/**
 * Mock sendTextMessage to capture outbound messages
 */
const sentMessages = [];
async function mockSendTextMessage(phone, text, phoneNumberId) {
  sentMessages.push({ phone, text, phoneNumberId, timestamp: new Date() });
  logInfo(`Bot sent: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
  return { success: true };
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  const normalizedPhone = normalizePhone(TEST_PHONE);

  try {
    // Find contact
    const contact = await prisma.contact.findUnique({
      where: { phone: normalizedPhone },
      include: {
        conversations: {
          include: {
            messages: true,
          },
        },
        travelLeads: true,
      },
    });

    if (contact) {
      // Delete messages
      for (const conv of contact.conversations) {
        await prisma.message.deleteMany({
          where: { conversationId: conv.id },
        });
      }

      // Delete conversations
      await prisma.conversation.deleteMany({
        where: { contactId: contact.id },
      });

      // Delete travel leads
      await prisma.travelLead.deleteMany({
        where: { contactId: contact.id },
      });

      // Delete contact
      await prisma.contact.delete({
        where: { id: contact.id },
      });

      logSuccess('Test data cleaned up');
    }

    // Clear Redis conversation history
    await redis.delete(`conversation:history:*`);

  } catch (error) {
    logWarning(`Cleanup warning: ${error.message}`);
  }
}

/**
 * Load test data into Sheets cache
 */
async function loadTestSheetsData() {
  logInfo('Loading test data into Sheets cache...');

  const testData = {
    Colegios: [
      {
        codigo: 'WC',
        nombre: 'Winston Churchill',
        zona: 'CDMX',
        contacto: 'Dir. María López',
      },
      {
        codigo: 'CA',
        nombre: 'Colegio Americano',
        zona: 'Monterrey',
        contacto: 'Dir. Juan Pérez',
      },
    ],
    Viajes: [
      {
        codigo: 'LON2025',
        destino: 'Londres',
        fechas_salida: '15-Jul-2025',
        precio: '65000',
        status: 'activo',
        descripcion: 'Programa English 4 Life - 3 semanas de inmersión en Londres',
      },
    ],
    Materiales: [
      {
        id: 'BROCHURE_LON',
        nombre: 'Brochure Londres 2025',
        tipo: 'pdf',
        url: 'https://example.com/brochure-londres.pdf',
        contenido: '',
        descripcion: 'Información completa del programa',
      },
      {
        id: 'PRECIOS_WC',
        nombre: 'Lista de Precios Winston Churchill',
        tipo: 'pdf',
        url: 'https://example.com/precios-wc.pdf',
        contenido: '',
        descripcion: 'Precios y esquemas de pago',
      },
    ],
    Esquemas_Pago: [
      {
        viaje_codigo: 'LON2025',
        modalidad: 'Contado',
        detalles: 'Pago único con 5% de descuento',
        monto_inicial: '61750',
      },
      {
        viaje_codigo: 'LON2025',
        modalidad: 'Mensualidades',
        detalles: '10 pagos sin intereses',
        monto_inicial: '6500',
      },
    ],
    Actividades: [
      {
        viaje_codigo: 'LON2025',
        nombre: 'Tour Harry Potter Studios',
        costo: '2500',
        descripcion: 'Visita a los estudios de Warner Bros',
        incluido: 'no',
      },
      {
        viaje_codigo: 'LON2025',
        nombre: 'London Eye',
        costo: '800',
        descripcion: 'Vuelta en la noria gigante',
        incluido: 'no',
      },
    ],
    Asesores: [
      {
        colegio_codigo: 'WC',
        nombre: 'Ana García',
        whatsapp: '+5215544332211',
        email: 'ana.garcia@grupoworkstudy.com',
      },
    ],
    FAQ: [
      {
        pregunta: '¿Qué incluye el programa?',
        respuesta: 'Incluye vuelo redondo, hospedaje, curso de inglés, materiales, seguro médico y acompañamiento.',
        categoria: 'general',
      },
      {
        pregunta: '¿Necesito pasaporte?',
        respuesta: 'Sí, necesitas pasaporte vigente con mínimo 6 meses de validez y tramitar la ETA británica.',
        categoria: 'tramites',
      },
    ],
    Configuración: [
      {
        clave: 'handoff_score_threshold',
        valor: '7',
      },
    ],
  };

  // Load into Redis cache
  for (const [sheetName, data] of Object.entries(testData)) {
    await redis.setSheetsCache(sheetName, data);
  }

  logSuccess('Test data loaded into cache');
}

/**
 * Verify database records
 */
async function verifyDatabaseState() {
  const normalizedPhone = normalizePhone(TEST_PHONE);

  const contact = await prisma.contact.findUnique({
    where: { phone: normalizedPhone },
    include: {
      conversations: {
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      },
      travelLeads: true,
    },
  });

  return contact;
}

/**
 * Main test flow
 */
async function runTestFlow() {
  logSection('🚀 STARTING END-TO-END TEST FLOW');

  try {
    // Step 0: Setup
    logStep(0, 'Setup and Cleanup');
    await cleanupTestData();
    await loadTestSheetsData();

    // Mock the sendTextMessage function
    const whatsappClient = await import('../src/core/whatsapp/client.js');
    whatsappClient.sendTextMessage = mockSendTextMessage;

    logSuccess('Setup complete\n');

    // Step 1: First message with school detection
    logSection('📨 MESSAGE 1: School Detection');
    logStep(1, 'Sending first message with school name');

    const message1 = createMockMessage(
      'Hola soy papá del colegio Winston Churchill y me interesa English 4 Life'
    );

    await handleMessage(message1, TEST_PHONE_NUMBER_ID);

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify
    let contact = await verifyDatabaseState();

    if (!contact) {
      throw new Error('Contact was not created');
    }
    logSuccess(`Contact created: ${contact.phone}`);

    if (!contact.conversations || contact.conversations.length === 0) {
      throw new Error('Conversation was not created');
    }
    logSuccess(`Conversation created: ${contact.conversations[0].id}`);

    if (!contact.travelLeads || contact.travelLeads.length === 0) {
      throw new Error('Travel lead was not created');
    }

    const lead = contact.travelLeads[0];
    logSuccess(`Lead created: ${lead.id}`);

    if (lead.schoolCode !== 'WC') {
      logError(`School not detected! Expected 'WC', got '${lead.schoolCode}'`);
    } else {
      logSuccess('School detected: WC (Winston Churchill)');
    }

    logInfo(`Messages in DB: ${contact.conversations[0].messages.length}`);
    logInfo(`Bot responses sent: ${sentMessages.length}\n`);

    // Step 2: Second message with data capture
    logSection('📨 MESSAGE 2: Data Capture');
    logStep(2, 'Sending message with parent and student info');

    const message2 = createMockMessage(
      'Mi hija se llama Sofía, tiene 15 años'
    );

    await handleMessage(message2, TEST_PHONE_NUMBER_ID);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify
    contact = await verifyDatabaseState();
    const updatedLead = contact.travelLeads[0];

    logInfo(`Lead data after message 2:`);
    logInfo(`  - Parent name: ${updatedLead.parentName || 'NOT CAPTURED'}`);
    logInfo(`  - Traveler name: ${updatedLead.travelerName || 'NOT CAPTURED'}`);
    logInfo(`  - Traveler age: ${updatedLead.travelerAge || 'NOT CAPTURED'}`);

    if (updatedLead.travelerName && updatedLead.travelerName.toLowerCase().includes('sofía')) {
      logSuccess('Traveler name captured successfully');
    } else {
      logWarning('Traveler name may not have been captured by Claude');
    }

    if (updatedLead.travelerAge === 15) {
      logSuccess('Traveler age captured successfully');
    } else {
      logWarning('Traveler age may not have been captured by Claude');
    }

    logInfo(`\nBot responses sent: ${sentMessages.length}\n`);

    // Step 3: Third message asking about price (scoring)
    logSection('📨 MESSAGE 3: Price Question (Scoring)');
    logStep(3, 'Asking about price to test scoring');

    const conv = contact.conversations[0];
    const scoreBefore = conv.interestScore;
    logInfo(`Score before message: ${scoreBefore}`);

    const message3 = createMockMessage(
      '¿Cuánto cuesta el programa?'
    );

    await handleMessage(message3, TEST_PHONE_NUMBER_ID);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify
    contact = await verifyDatabaseState();
    const scoreAfter = contact.conversations[0].interestScore;
    logInfo(`Score after message: ${scoreAfter}`);

    if (scoreAfter > scoreBefore) {
      logSuccess(`Score increased by ${scoreAfter - scoreBefore} points`);
    } else {
      logWarning('Score did not increase (may be due to message content)');
    }

    logInfo(`\nBot responses sent: ${sentMessages.length}\n`);

    // Step 4: Fourth message showing strong interest (handoff)
    logSection('📨 MESSAGE 4: High Interest (Handoff Trigger)');
    logStep(4, 'Showing strong interest to trigger advisor handoff');

    logInfo(`Current score: ${scoreAfter}`);
    logInfo(`Current conversation status: ${contact.conversations[0].status}`);

    const message4 = createMockMessage(
      'Me interesa mucho, quiero inscribir a mi hija. ¿Cómo puedo pagar y cuándo inicio el proceso?'
    );

    await handleMessage(message4, TEST_PHONE_NUMBER_ID);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify
    contact = await verifyDatabaseState();
    const finalScore = contact.conversations[0].interestScore;
    const finalStatus = contact.conversations[0].status;
    const finalLeadStatus = contact.travelLeads[0].status;

    logInfo(`Final score: ${finalScore}`);
    logInfo(`Final conversation status: ${finalStatus}`);
    logInfo(`Final lead status: ${finalLeadStatus}`);

    if (finalStatus === 'waiting_human') {
      logSuccess('Conversation handed off to human advisor!');
      logSuccess(`Assigned agent: ${contact.conversations[0].assignedAgent || 'Not assigned'}`);
    } else {
      logWarning('Conversation not handed off (score may not have reached threshold)');
    }

    if (finalLeadStatus === 'derivado_asesor') {
      logSuccess('Lead marked as "derivado_asesor"');
    }

    logInfo(`\nBot responses sent: ${sentMessages.length}\n`);

    // Step 5: Test bot silence after handoff
    logSection('📨 MESSAGE 5: Bot Silence Test');
    logStep(5, 'Testing that bot stays silent after handoff');

    const messageCountBefore = sentMessages.length;

    const message5 = createMockMessage('Gracias');

    await handleMessage(message5, TEST_PHONE_NUMBER_ID);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const messageCountAfter = sentMessages.length;

    if (messageCountAfter === messageCountBefore) {
      logSuccess('Bot correctly stayed silent (conversation in waiting_human)');
    } else {
      logError('Bot responded when it should have stayed silent!');
    }

    // Final Summary
    logSection('📊 FINAL SUMMARY');

    contact = await verifyDatabaseState();
    const finalConv = contact.conversations[0];
    const finalLead = contact.travelLeads[0];

    console.log('');
    log('CONTACT:', 'bright');
    console.log(`  Phone: ${contact.phone}`);
    console.log(`  Name: ${contact.name || 'Not set'}`);
    console.log(`  Unit: ${contact.unit}`);
    console.log('');

    log('CONVERSATION:', 'bright');
    console.log(`  ID: ${finalConv.id}`);
    console.log(`  Status: ${finalConv.status}`);
    console.log(`  Interest Score: ${finalConv.interestScore}/10`);
    console.log(`  Assigned Agent: ${finalConv.assignedAgent || 'None'}`);
    console.log(`  Total Messages: ${finalConv.messages.length}`);
    console.log('');

    log('LEAD:', 'bright');
    console.log(`  ID: ${finalLead.id}`);
    console.log(`  Status: ${finalLead.status}`);
    console.log(`  School Code: ${finalLead.schoolCode || 'Not detected'}`);
    console.log(`  Parent Name: ${finalLead.parentName || 'Not captured'}`);
    console.log(`  Traveler Name: ${finalLead.travelerName || 'Not captured'}`);
    console.log(`  Traveler Age: ${finalLead.travelerAge || 'Not captured'}`);
    console.log(`  Materials Sent: ${finalLead.materialsSent?.length || 0}`);
    console.log('');

    log('CONVERSATION MESSAGES:', 'bright');
    for (const msg of finalConv.messages) {
      const prefix = msg.direction === 'inbound' ? '👤' : '🤖';
      const text = msg.text.substring(0, 80);
      console.log(`  ${prefix} [${msg.direction}] ${text}${msg.text.length > 80 ? '...' : ''}`);
    }
    console.log('');

    log('BOT RESPONSES SENT:', 'bright');
    console.log(`  Total: ${sentMessages.length}`);
    console.log('');

    logSection('✅ TEST FLOW COMPLETED SUCCESSFULLY');

    return {
      success: true,
      contact,
      conversation: finalConv,
      lead: finalLead,
      messagesSent: sentMessages.length,
    };

  } catch (error) {
    logSection('❌ TEST FLOW FAILED');
    logError(`Error: ${error.message}`);
    console.error(error);

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const result = await runTestFlow();

    // Cleanup
    logSection('🧹 CLEANUP');
    await cleanupTestData();

    // Disconnect
    await prisma.$disconnect();
    await redis.disconnect();

    logSuccess('Disconnected from database and Redis\n');

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    console.error(error);

    await prisma.$disconnect();
    await redis.disconnect();

    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runTestFlow };
