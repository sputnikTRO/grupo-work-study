#!/usr/bin/env node

/**
 * Test de Miri - Verificar nuevos cambios
 *
 * Prueba:
 * 1. Fechas "Mayo 2027" sin días específicos
 * 2. Apartado $10,000
 * 3. Edades 12-13 años en adelante
 * 4. Derivación cuando pregunta día exacto
 * 5. Derivación colegio nuevo cuando pregunta precio
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { buildFullPrompt } from '../src/units/travel/prompts.js';
import { readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const conversationHistory = [];
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

  knowledge += '\n## COLEGIOS REGISTRADOS\n\n';
  colegios.forEach(colegio => {
    knowledge += `- ${colegio['Nombre Colegio']} (${colegio['Código']})\n`;
    knowledge += `  Asesora: ${colegio['Asesora']}\n`;
    if (colegio['Destino']) knowledge += `  Destino asignado: ${colegio['Destino']}\n`;
    knowledge += '\n';
  });

  return knowledge;
}

async function sendMessage(userMessage, dynamicKnowledge) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  const systemPrompt = buildFullPrompt(mockLead, dynamicKnowledge);
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages,
  });

  const botResponse = response.content[0].text;

  conversationHistory.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: botResponse }
  );

  // Detectar derivaciones
  const actionTagRegex = /\[([A-Z_]+)(?::([^\]]+))?\]/g;
  let match;

  while ((match = actionTagRegex.exec(botResponse)) !== null) {
    if (match[1] === 'DERIVAR_ASESOR') {
      log(`      🔔 DERIVACIÓN: ${match[2]}`, 'yellow');
    }
  }

  return botResponse.replace(actionTagRegex, '').trim();
}

async function runTest(dynamicKnowledge) {
  console.log('\n' + '='.repeat(80));
  log('  🧪 TEST - Verificar Nuevos Cambios de Miri', 'bright');
  console.log('='.repeat(80) + '\n');

  const tests = [
    {
      name: 'Test 1: Colegio nuevo pregunta por precio',
      messages: [
        'Hola',
        'Soy del Colegio San Patricio', // Colegio NO en lista
        'Soy padre de familia',
        'Me interesa English 4 Life Londres',
        '¿Cuánto cuesta?', // Debe derivar porque es colegio nuevo
      ]
    },
    {
      name: 'Test 2: Pregunta por fechas exactas',
      messages: [
        'Hola',
        'Soy del Colegio Columbia',
        'Soy padre de familia',
        'Me interesa Londres',
        '¿Qué día exacto salen?', // Debe derivar
      ]
    },
    {
      name: 'Test 3: Verificar apartado $10,000',
      messages: [
        'Hola',
        'Soy del Instituto Hills',
        'Soy madre de familia',
        'Me interesa Londres',
        '¿Cuánto es el apartado?', // Debe mencionar $10,000
      ]
    },
  ];

  for (const test of tests) {
    log(`\n📋 ${test.name}`, 'cyan');
    log('─'.repeat(80), 'dim');

    // Reset conversation
    conversationHistory.length = 0;
    Object.keys(mockLead).forEach(key => {
      if (Array.isArray(mockLead[key])) mockLead[key] = [];
      else mockLead[key] = null;
    });
    mockLead.status = 'new';

    for (const message of test.messages) {
      log(`\n👤 Usuario: ${message}`, 'cyan');
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

    log('\n' + '─'.repeat(80), 'dim');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(80));
  log('  ✅ Tests completados', 'green');
  console.log('='.repeat(80) + '\n');
}

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
