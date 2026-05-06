#!/usr/bin/env node

/**
 * Demo Bot Script - Interactive Demo
 *
 * Simulates WhatsApp conversation with Claude AI bot
 * Shows responses in real-time in the terminal
 * No database or Redis required - runs entirely in memory
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import readline from 'readline';

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

function logBot(message) {
  log(`\n🤖 Bot: ${message}`, 'green');
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

/**
 * Load knowledge base from Google Sheets
 */
async function loadKnowledgeBase() {
  try {
    logSystem('📊 Cargando base de conocimiento desde Google Sheets...');

    // Parse the private key from environment
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!privateKey) {
      throw new Error('GOOGLE_PRIVATE_KEY no está configurada');
    }

    // Authenticate with Google
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

    // Load relevant sheets
    const sheetNames = ['Colegios', 'Viajes', 'FAQ', 'Materiales'];
    const knowledgeBase = {};

    for (const sheetName of sheetNames) {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetName}!A1:Z1000`,
        });

        const rows = response.data.values || [];
        if (rows.length > 0) {
          const headers = rows[0];
          const data = rows.slice(1).map(row => {
            const obj = {};
            headers.forEach((header, index) => {
              obj[header] = row[index] || '';
            });
            return obj;
          });
          knowledgeBase[sheetName] = data;
        }
      } catch (error) {
        logSystem(`   ⚠️  No se pudo cargar ${sheetName}: ${error.message}`);
      }
    }

    logSystem(`   ✅ Conocimiento cargado: ${Object.keys(knowledgeBase).length} hojas`);
    return knowledgeBase;

  } catch (error) {
    logSystem(`   ⚠️  Error cargando Google Sheets: ${error.message}`);
    logSystem(`   ℹ️  Continuando con conocimiento base limitado...`);

    // Return mock knowledge if Sheets fails
    return {
      Viajes: [
        {
          destino: 'Londres',
          precio: '65000',
          descripcion: 'Programa English 4 Life - 3 semanas de inmersión en Londres'
        }
      ],
      FAQ: [
        {
          pregunta: '¿Qué incluye el programa?',
          respuesta: 'Incluye vuelo redondo, hospedaje, curso de inglés, materiales, seguro médico y acompañamiento.'
        }
      ]
    };
  }
}

/**
 * Build system prompt with knowledge base
 */
function buildSystemPrompt(knowledgeBase) {
  let prompt = `Eres el bot de atención al cliente de English 4 Life, un programa de viajes educativos de Oxford Education & Travel.

# TU PERSONALIDAD
- Eres cálido, profesional y entusiasta
- Hablas español de México
- Respondes de forma concisa pero completa
- Usas emojis ocasionalmente para ser amigable

# BASE DE CONOCIMIENTO
`;

  // Add knowledge from Sheets
  if (knowledgeBase.Viajes && knowledgeBase.Viajes.length > 0) {
    prompt += `\n## PROGRAMAS DISPONIBLES\n`;
    knowledgeBase.Viajes.forEach(viaje => {
      prompt += `- ${viaje.destino || viaje.nombre}: ${viaje.descripcion || viaje.detalles || ''}\n`;
      if (viaje.precio) prompt += `  Precio: $${viaje.precio} MXN\n`;
    });
  }

  if (knowledgeBase.FAQ && knowledgeBase.FAQ.length > 0) {
    prompt += `\n## PREGUNTAS FRECUENTES\n`;
    knowledgeBase.FAQ.forEach(faq => {
      prompt += `P: ${faq.pregunta}\nR: ${faq.respuesta}\n\n`;
    });
  }

  if (knowledgeBase.Colegios && knowledgeBase.Colegios.length > 0) {
    prompt += `\n## COLEGIOS AFILIADOS\n`;
    knowledgeBase.Colegios.forEach(colegio => {
      prompt += `- ${colegio.nombre} (${colegio.codigo}): ${colegio.zona || ''}\n`;
    });
  }

  prompt += `\n# INSTRUCCIONES
- Responde preguntas sobre los viajes educativos
- Si preguntan por precios, menciona que hay esquemas de pago flexibles
- Si muestran mucho interés, menciona que pueden hablar con un asesor especializado
- Si no tienes la información, dilo honestamente y ofrece conectarlos con un humano
- Mantén respuestas breves (máximo 3-4 líneas)

Responde SOLO como el bot. No incluyas etiquetas, instrucciones internas ni metadatos.`;

  return prompt;
}

/**
 * Send message to Claude and get response
 */
async function sendMessageToClaude(userMessage, systemPrompt) {
  logSystem('   🔄 Enviando a Claude AI...');

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
      max_tokens: 1024,
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

    // Keep only last 10 messages (5 exchanges)
    if (conversationHistory.length > 10) {
      conversationHistory.splice(0, conversationHistory.length - 10);
    }

    return botResponse;

  } catch (error) {
    throw new Error(`Error de Claude AI: ${error.message}`);
  }
}

/**
 * Interactive chat mode
 */
async function startInteractiveDemo(knowledgeBase) {
  logHeader('🎭 DEMO INTERACTIVA - English 4 Life Bot');

  log('\n  Escribe tus mensajes como si fueras un padre interesado en el programa.', 'yellow');
  log('  El bot responderá usando Claude AI y la base de conocimiento de Google Sheets.', 'yellow');
  log('\n  Comandos especiales:', 'dim');
  log('    - escribe "salir" o "exit" para terminar', 'dim');
  log('    - escribe "limpiar" para reiniciar la conversación', 'dim');
  log('    - presiona Ctrl+C para salir\n', 'dim');

  const systemPrompt = buildSystemPrompt(knowledgeBase);

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
        log('\n👋 ¡Gracias por probar el demo! Hasta pronto.\n', 'yellow');
        rl.close();
        return;
      }

      if (message.toLowerCase() === 'limpiar' || message.toLowerCase() === 'clear') {
        conversationHistory.length = 0;
        log('\n🔄 Conversación reiniciada\n', 'yellow');
        askQuestion();
        return;
      }

      try {
        const botResponse = await sendMessageToClaude(message, systemPrompt);
        logBot(botResponse);
      } catch (error) {
        log(`\n❌ Error: ${error.message}`, 'yellow');
      }

      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Automated demo mode with predefined messages
 */
async function startAutomatedDemo(knowledgeBase) {
  logHeader('🎬 DEMO AUTOMATIZADA - English 4 Life Bot');

  log('\n  Esta demo simula una conversación típica con el bot.\n', 'yellow');

  const systemPrompt = buildSystemPrompt(knowledgeBase);

  const demoMessages = [
    'Hola, quiero información sobre los viajes de English 4 Life',
    '¿Cuánto cuesta el programa a Londres?',
    '¿Qué incluye el precio?',
    '¿Tienen esquemas de pago?',
    'Me interesa mucho, quisiera hablar con un asesor',
  ];

  for (const message of demoMessages) {
    logUser(message);

    try {
      const botResponse = await sendMessageToClaude(message, systemPrompt);
      logBot(botResponse);

      // Wait 1 second between messages for readability
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      log(`\n❌ Error: ${error.message}`, 'yellow');
      break;
    }
  }

  log('\n\n✅ Demo automatizada completada', 'green');
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

    // Load knowledge base
    const knowledgeBase = await loadKnowledgeBase();

    // Check for mode argument
    const mode = process.argv[2];

    if (mode === 'auto' || mode === 'automatico') {
      await startAutomatedDemo(knowledgeBase);
    } else {
      await startInteractiveDemo(knowledgeBase);
    }

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
