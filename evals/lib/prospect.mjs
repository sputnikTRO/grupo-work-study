/**
 * Prospecto simulado. Genera el siguiente mensaje del prospecto siguiendo la
 * persona del escenario y la "guía" del turno. Un turno con `say` se manda
 * literal (para reproducir regresiones exactas); uno con `intent` lo redacta el
 * simulador. Nunca ve el system prompt del bot: solo lo que le llegó por WhatsApp.
 */
import Anthropic from '@anthropic-ai/sdk';

export const PROSPECT_MODEL = process.env.EVAL_PROSPECT_MODEL || 'claude-haiku-4-5';

let client;
const anthropic = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

const SYSTEM = (persona, botName) => `Eres un PROSPECTO que escribe por WhatsApp a ${botName}, el asistente virtual de una empresa educativa mexicana. NO eres un asistente: eres la persona que pregunta.

Tu persona:
${persona}

Reglas:
- Escribe SOLO el texto del siguiente mensaje, como lo teclearía esa persona en WhatsApp: corto (1-2 frases), español de México, informal, sin comillas, sin explicar lo que haces, sin prefijos como "Prospecto:".
- Sigue la GUÍA del turno al pie de la letra en intención, con tus propias palabras. No agregues temas que la guía no pide.
- No inventes que eres un bot, ni cierres la conversación por tu cuenta.`;

/**
 * @param {Object} p
 * @param {string} p.persona
 * @param {string} p.intent - guía de este turno
 * @param {Array<{from:'prospecto'|'bot', text:string}>} p.transcript - lo visto hasta ahora
 * @param {string} p.botName - "Ori" | "Miri"
 * @returns {Promise<string>}
 */
export async function nextProspectMessage({ persona, intent, transcript, botName }) {
  const convo = transcript.length
    ? transcript.map((m) => `${m.from === 'bot' ? botName : 'Tú'}: ${m.text}`).join('\n')
    : '(todavía no hay mensajes)';

  const res = await anthropic().messages.create({
    model: PROSPECT_MODEL,
    max_tokens: 200,
    temperature: 0.7,
    system: SYSTEM(persona, botName),
    messages: [{
      role: 'user',
      content: `Conversación hasta ahora:\n${convo}\n\nGUÍA para tu siguiente mensaje: ${intent}\n\nEscribe tu siguiente mensaje.`,
    }],
  });

  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
    .trim()
    .replace(/^["“']|["”']$/g, '')
    .replace(/^(t[uú]|prospecto)\s*:\s*/i, '');
}
