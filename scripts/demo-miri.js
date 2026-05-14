#!/usr/bin/env node

/**
 * Demo Miri - Interactive Test of Travel Bot
 *
 * Simulates WhatsApp conversation with Miri using the real prompt system
 * Tests the new conversation flow: school → contact type → program choice
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import readline from 'readline';
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
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logUser(message) {
  log(`\n👤 Usuario: ${message}`, 'cyan');
}

function logMiri(message) {
  log(`\n🤖 Miri: ${message}`, 'green');
}

function logSystem(message) {
  log(`   ${message}`, 'dim');
}

function logHeader(title) {
  console.log('\n' + '='.repeat(80));
  log(`  ${title}`, 'bright');
  console.log('='.repeat(80));
}

// Initialize Claude AI client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Conversation history (in-memory)
const conversationHistory = [];

// Mock lead data (simulates database record)
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
 * Send message to Claude with Miri's real prompt
 */
async function sendMessageToMiri(userMessage, systemPrompt) {
  logSystem('   🔄 Enviando a Claude AI (Miri)...');

  try {
    // Build messages array with conversation history
    const messages = [
      ...conversationHistory,
      {
        role: 'user',
        content: userMessage,
      }
    ];

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages,
    });

    const botResponse = response.content[0].text;

    // Add to conversation history
    conversationHistory.push({
      role: 'user',
      content: userMessage,
    });
    conversationHistory.push({
      role: 'assistant',
      content: botResponse,
    });

    // Keep only last 20 messages (10 exchanges)
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, conversationHistory.length - 20);
    }

    // Extract and process action tags (simulated)
    const actionTagRegex = /\[([A-Z_]+)(?::([^\]]+))?\]/g;
    let match;
    const actions = [];

    while ((match = actionTagRegex.exec(botResponse)) !== null) {
      actions.push({
        tag: match[1],
        params: match[2] ? match[2].split(':') : [],
      });
    }

    // Process actions (simulate)
    if (actions.length > 0) {
      logSystem('\n   📋 Acciones detectadas:');
      actions.forEach(action => {
        switch (action.tag) {
          case 'CAPTURAR_DATO':
            const [field, value] = action.params;
            if (field === 'school_code') mockLead.schoolCode = value;
            else if (field === 'parent_name') mockLead.parentName = value;
            else if (field === 'traveler_name') mockLead.travelerName = value;
            else if (field === 'traveler_age') mockLead.travelerAge = value;
            else if (field === 'program_interest') mockLead.programInterest = value;
            logSystem(`      ✓ Capturado: ${field} = ${value}`);
            break;
          case 'ENVIAR_MATERIAL':
            logSystem(`      ✓ Enviando material: ${action.params[0]}`);
            break;
          case 'DERIVAR_ASESOR':
            logSystem(`      ✓ Derivando a asesor: ${action.params[0]}`);
            break;
          case 'ACTUALIZAR_SCORE':
            logSystem(`      ✓ Score actualizado: ${action.params[0]}/10`);
            break;
          default:
            logSystem(`      ✓ ${action.tag}: ${action.params.join(', ')}`);
        }
      });
    }

    // Remove action tags from display
    const cleanResponse = botResponse.replace(actionTagRegex, '').trim();

    return cleanResponse;

  } catch (error) {
    throw new Error(`Error de Claude AI: ${error.message}`);
  }
}

/**
 * Interactive demo mode
 */
async function startDemo(dynamicKnowledge) {
  logHeader('🌟 DEMO MIRI - Bot de Travel (English 4 Life + Rising Stars)');

  log('\n  Escribe tus mensajes como si fueras un docente o padre interesado.', 'yellow');
  log('  Miri usará el nuevo flujo:', 'yellow');
  log('    1️⃣  Pregunta de qué colegio escribes', 'dim');
  log('    2️⃣  Pregunta si eres padre/madre o docente', 'dim');
  log('    3️⃣  Presenta 3 programas: Londres, Dublín, Rising Stars', 'dim');
  log('\n  Comandos especiales:', 'dim');
  log('    - "salir" o "exit" para terminar', 'dim');
  log('    - "limpiar" para reiniciar conversación', 'dim');
  log('    - "datos" para ver datos capturados', 'dim');
  log('    - Ctrl+C para salir\n', 'dim');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question(colors.cyan + '\n👤 Tú: ' + colors.reset, async (input) => {
      const message = input.trim();

      if (!message) {
        askQuestion();
        return;
      }

      if (message.toLowerCase() === 'salir' || message.toLowerCase() === 'exit') {
        log('\n👋 ¡Gracias por probar Miri! Hasta pronto.\n', 'yellow');
        rl.close();
        return;
      }

      if (message.toLowerCase() === 'limpiar' || message.toLowerCase() === 'clear') {
        conversationHistory.length = 0;
        Object.keys(mockLead).forEach(key => {
          if (Array.isArray(mockLead[key])) mockLead[key] = [];
          else mockLead[key] = null;
        });
        mockLead.status = 'new';
        log('\n🔄 Conversación y datos reiniciados\n', 'yellow');
        askQuestion();
        return;
      }

      if (message.toLowerCase() === 'datos') {
        log('\n📊 Datos capturados:', 'yellow');
        console.log(mockLead);
        askQuestion();
        return;
      }

      try {
        // Rebuild system prompt with current lead data
        const systemPrompt = buildFullPrompt(mockLead, dynamicKnowledge);
        const botResponse = await sendMessageToMiri(message, systemPrompt);
        logMiri(botResponse);
      } catch (error) {
        log(`\n❌ Error: ${error.message}`, 'yellow');
      }

      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Build dynamic knowledge base from Google Sheets (without Redis)
 */
async function buildDynamicKnowledge() {
  const spreadsheetId = env.GOOGLE_SHEETS_ID;

  // Load all relevant sheets
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
 * Main function
 */
async function main() {
  try {
    // Check required environment variables
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'sk-ant-test123') {
      log('\n❌ Error: ANTHROPIC_API_KEY no está configurada o tiene valor de prueba', 'yellow');
      log('\nPor favor actualiza el archivo .env con tu API key real de Anthropic.\n', 'dim');
      process.exit(1);
    }

    // Load knowledge base from Google Sheets (direct, no Redis)
    logSystem('📊 Cargando base de conocimiento desde Google Sheets...');
    const dynamicKnowledge = await buildDynamicKnowledge();
    logSystem('   ✅ Base de conocimiento cargada\n');

    await startDemo(dynamicKnowledge);

  } catch (error) {
    log(`\n❌ Error fatal: ${error.message}`, 'yellow');
    console.error(error);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  log('\n\n👋 ¡Hasta pronto!\n', 'yellow');
  process.exit(0);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
