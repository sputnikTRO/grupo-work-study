/**
 * Juez LLM (claude-sonnet-5) — SOLO REPORTA, nunca decide pass/fail.
 *
 * Califica la conversación con una rúbrica breve. Su prompt vive aquí y es
 * independiente del de los bots a propósito: si compartiera reglas con el
 * system prompt de Ori/Miri, heredaría sus mismos puntos ciegos.
 */
import Anthropic from '@anthropic-ai/sdk';

export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || 'claude-sonnet-5';

let client;
const anthropic = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

export const RUBRIC = {
  relevancia: 'Responde lo que el prospecto preguntó en cada turno, sin ignorar preguntas ni contestar otra cosa.',
  veracidad: 'No inventa datos, plazos, precios ni estatus; no niega productos que el propio bot ofreció; no confirma inscripciones o pagos que no verificó.',
  fluidez: 'Mensajes cortos y naturales de WhatsApp; sin repetir el mismo texto o recordatorio (p.ej. "Escribe Menú") de forma redundante.',
  avance: 'Lleva la conversación al siguiente paso útil (resolver la duda, ofrecer asesora cuando corresponde) sin presionar ni derivar cuando el prospecto dijo que no.',
};

const SYSTEM = `Eres un evaluador de calidad de conversaciones de WhatsApp entre un prospecto y un asistente virtual de ventas educativas (México). Evalúas con criterio de un supervisor humano exigente pero justo.

Califica cada criterio de 1 (muy mal) a 5 (excelente):
${Object.entries(RUBRIC).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Responde ÚNICAMENTE con JSON válido, sin markdown:
{"relevancia": n, "veracidad": n, "fluidez": n, "avance": n, "resumen": "una frase", "problemas": ["turno N: problema concreto", ...]}
"problemas" puede ir vacío. Cita el número de turno.`;

/**
 * @param {Object} sc - escenario (usa title, unit, persona)
 * @param {Array} turns - transcripción de run.mjs
 * @returns {Promise<Object|null>} calificación o { error }
 */
export async function judge(sc, turns) {
  const botName = sc.unit === 'ori' ? 'Ori' : 'Miri';
  const transcript = turns.map((t) => [
    `[t${t.i}] Prospecto: ${t.user}`,
    ...t.bot.map((m) => `[t${t.i}] ${botName}: ${m}`),
    ...(t.advisor.length ? [`[t${t.i}] (sistema: se notificó a una asesora)`] : []),
  ].join('\n')).join('\n');

  try {
    const res = await anthropic().messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Escenario: ${sc.title}\nAsistente: ${botName}\nPersona del prospecto: ${sc.persona}\n\nConversación:\n${transcript}`,
      }],
    });
    const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || 'null');
    if (!json) return { error: 'el juez no devolvió JSON' };
    const scores = Object.keys(RUBRIC).map((k) => Number(json[k])).filter(Number.isFinite);
    json.promedio = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
    return json;
  } catch (err) {
    return { error: err.message };
  }
}
