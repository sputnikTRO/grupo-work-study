#!/usr/bin/env node

/**
 * Test Miri - Automated conversation as a teacher
 *
 * Simulates a full conversation flow with Miri as a teacher interested in the program
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { buildFullPrompt } from '../src/units/travel/prompts.js';
import { readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

// Colors for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Initialize Claude AI client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Conversation history
const conversationHistory = [];

// Mock lead data
const mockLead = {
  parentName: null,
  travelerName: null,
  travelerAge: null,
  schoolCode: null,
  programInterest: null,
  status: 'new',
  materialsSent: [],
  notes: null,
};

/**
 * Build dynamic knowledge base from Google Sheets
 */
async function buildDynamicKnowledge() {
  const spreadsheetId = env.GOOGLE_SHEETS_ID;

  const viajes = await readSheet(spreadsheetId, 'Viajes');
  const precios = await readSheet(spreadsheetId, 'Precios');
  const infoGeneral = await readSheet(spreadsheetId, 'Info General');
  const colegios = await readSheet(spreadsheetId, 'Colegios');

  let knowledge = '## VIAJES DISPONIBLES 2027\n\n';

  viajes.forEach(viaje => {
    if (viaje['Estado'] === 'activo') {
      knowledge += `**${viaje['Código']}** - ${viaje['Destino']}\n`;
      knowledge += `- Descripción: ${viaje['Descripción']}\n`;
      knowledge += `- Fechas: ${viaje['Fecha Salida']} al ${viaje['Fecha Regreso']}\n\n`;
    }
  });

  knowledge += '\n## PRECIOS\n\n';

  precios.forEach(precio => {
    knowledge += `**${precio['Código Viaje']}** (${precio['Colegio']})\n`;
    knowledge += `- Destino: ${precio['Destino']}\n`;
    knowledge += `- Modalidad: ${precio['Modalidad']}\n`;
    if (precio['Precio Programa'] !== 'Por definir') {
      knowledge += `- Precio Programa: $${precio['Precio Programa']} MXN\n`;
      knowledge += `- Precio Vuelo: $${precio['Precio Vuelo']} MXN\n`;
      knowledge += `- Apartado: $${precio['Apartado']} MXN\n`;
    } else {
      knowledge += `- Precios: Por definir\n`;
    }
    if (precio['Notas']) knowledge += `- Notas: ${precio['Notas']}\n`;
    knowledge += '\n';
  });

  knowledge += '\n## PREGUNTAS FRECUENTES\n\n';

  infoGeneral.forEach(info => {
    knowledge += `**[${info['Categoría']}] ${info['Título']}**\n`;
    knowledge += `${info['Contenido']}\n\n`;
  });

  knowledge += '\n## COLEGIOS REGISTRADOS\n\n';

  colegios.forEach(colegio => {
    knowledge += `- ${colegio['Nombre Colegio']} (${colegio['Código']})\n`;
    knowledge += `  Asesora: ${colegio['Asesora']}\n`;
    if (colegio['Destino']) knowledge += `  Destino asignado: ${colegio['Destino']}\n`;
    knowledge += '\n';
  });

  return knowledge;
}

/**
 * Send message to Miri
 */
async function sendMessage(userMessage, dynamicKnowledge) {
  const messages = [
    ...conversationHistory,
    {
      role: 'user',
      content: userMessage,
    }
  ];

  const systemPrompt = buildFullPrompt(mockLead, dynamicKnowledge);

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages,
  });

  const botResponse = response.content[0].text;

  conversationHistory.push({
    role: 'user',
    content: userMessage,
  });
  conversationHistory.push({
    role: 'assistant',
    content: botResponse,
  });

  // Extract action tags
  const actionTagRegex = /\[([A-Z_]+)(?::([^\]]+))?\]/g;
  let match;
  const actions = [];

  while ((match = actionTagRegex.exec(botResponse)) !== null) {
    actions.push({ tag: match[1], params: match[2] });
    const [field, value] = match[2] ? match[2].split(':') : [];

    if (match[1] === 'CAPTURAR_DATO') {
      if (field === 'school_code') mockLead.schoolCode = value;
      else if (field === 'contact_type') log(`      ✓ Tipo de contacto: ${value}`, 'dim');
      else if (field === 'program_interest') mockLead.programInterest = value;
    } else if (match[1] === 'DERIVAR_ASESOR') {
      log(`      🔔 DERIVACIÓN A ASESOR: ${match[2]}`, 'yellow');
    }
  }

  // Clean response
  return botResponse.replace(actionTagRegex, '').trim();
}

/**
 * Run automated test conversation
 */
async function runTest(dynamicKnowledge) {
  console.log('\n' + '='.repeat(80));
  log('  🎭 TEST AUTOMÁTICO - Miri como Docente', 'bright');
  console.log('='.repeat(80) + '\n');

  const conversation = [
    'Hola, buenos días',
    'Soy del Colegio Columbia',
    'Soy docente de la escuela',
    'Me interesa Rising Stars',
    '¿Qué incluye el programa Rising Stars?',
    '¿Cuánto cuesta?',
  ];

  for (const message of conversation) {
    log(`\n👤 Docente: ${message}`, 'cyan');
    log('   🔄 Procesando...', 'dim');

    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      const response = await sendMessage(message, dynamicKnowledge);
      log(`\n🤖 Miri: ${response}`, 'green');
    } catch (error) {
      log(`\n❌ Error: ${error.message}`, 'yellow');
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  log('  ✅ Test completado', 'green');
  console.log('='.repeat(80) + '\n');

  log('📊 Datos capturados:', 'yellow');
  console.log({
    colegio: mockLead.schoolCode,
    programaInteres: mockLead.programInterest,
  });
  console.log('');
}

/**
 * Main
 */
async function main() {
  try {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'sk-ant-test123') {
      log('\n❌ Error: ANTHROPIC_API_KEY no está configurada', 'yellow');
      process.exit(1);
    }

    log('\n📊 Cargando base de conocimiento...', 'dim');
    const dynamicKnowledge = await buildDynamicKnowledge();
    log('   ✅ Listo\n', 'dim');

    await runTest(dynamicKnowledge);

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'yellow');
    console.error(error);
    process.exit(1);
  }
}

main();
