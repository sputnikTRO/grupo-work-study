#!/usr/bin/env node

/**
 * Test específico: Colegio nuevo (Alexander Bain) pregunta por precio
 * Debe derivar a asesor sin dar precios
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { buildFullPrompt } from '../src/units/travel/prompts.js';
import { readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

  // Detectar derivaciones y precios
  const actionTagRegex = /\[([A-Z_]+)(?::([^\]]+))?\]/g;
  let match;
  let derivado = false;
  let mencionaPrecio = false;

  while ((match = actionTagRegex.exec(botResponse)) !== null) {
    if (match[1] === 'DERIVAR_ASESOR') {
      log(`      ✅ DERIVACIÓN DETECTADA: ${match[2]}`, 'green');
      derivado = true;
    }
  }

  // Buscar si menciona precios específicos
  if (botResponse.match(/\$34,?990|\$35,?000|\$69,?990/)) {
    log(`      ❌ ERROR: Mencionó precios específicos`, 'red');
    mencionaPrecio = true;
  }

  return {
    response: botResponse.replace(actionTagRegex, '').trim(),
    derivado,
    mencionaPrecio
  };
}

async function runTest(dynamicKnowledge) {
  console.log('\n' + '='.repeat(80));
  log('  🧪 TEST - Colegio Alexander Bain (NO en lista)', 'bright');
  console.log('='.repeat(80) + '\n');

  const conversation = [
    'Hola',
    'Soy del colegio Alexander Bain',
    'Soy padre de familia',
    'Me interesa Londres',
  ];

  for (const message of conversation) {
    log(`\n👤 Usuario: ${message}`, 'cyan');
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      const { response } = await sendMessage(message, dynamicKnowledge);
      log(`\n🤖 Miri: ${response}`, 'white');
    } catch (error) {
      log(`\n❌ Error: ${error.message}`, 'yellow');
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Ahora el mensaje crítico: preguntar por precio
  log(`\n${'='.repeat(80)}`, 'yellow');
  log('MOMENTO CRÍTICO: Pregunta por precio de colegio NO en lista', 'yellow');
  log('='.repeat(80), 'yellow');

  const { response, derivado, mencionaPrecio } = await sendMessage(
    '¿Cuánto cuesta?',
    dynamicKnowledge
  );

  log(`\n👤 Usuario: ¿Cuánto cuesta?`, 'cyan');
  log(`\n🤖 Miri: ${response}`, 'white');

  console.log('\n' + '='.repeat(80));
  log('  📊 RESULTADO DEL TEST', 'bright');
  console.log('='.repeat(80));

  if (derivado && !mencionaPrecio) {
    log('\n✅ TEST EXITOSO', 'green');
    log('   ✓ Derivó a asesor correctamente', 'green');
    log('   ✓ NO mencionó precios específicos', 'green');
  } else if (!derivado && mencionaPrecio) {
    log('\n❌ TEST FALLIDO', 'red');
    log('   ✗ NO derivó a asesor', 'red');
    log('   ✗ Mencionó precios específicos', 'red');
  } else if (!derivado) {
    log('\n⚠️  TEST PARCIALMENTE FALLIDO', 'yellow');
    log('   ✗ NO derivó a asesor', 'yellow');
    log('   ✓ No mencionó precios específicos', 'green');
  } else {
    log('\n⚠️  TEST PARCIALMENTE EXITOSO', 'yellow');
    log('   ✓ Derivó a asesor', 'green');
    log('   ✗ Mencionó precios específicos', 'yellow');
  }

  console.log('');
}

async function main() {
  try {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'sk-ant-test123') {
      log('\n❌ Error: ANTHROPIC_API_KEY no está configurada', 'yellow');
      process.exit(1);
    }

    log('\n📊 Cargando base de conocimiento...', 'white');
    const dynamicKnowledge = await buildDynamicKnowledge();
    log('   ✅ Listo\n', 'white');

    await runTest(dynamicKnowledge);

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'yellow');
    console.error(error);
    process.exit(1);
  }
}

main();
