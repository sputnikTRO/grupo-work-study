/**
 * Flujo determinístico — extractor estructurado con LLM (compartido)
 *
 * Pide al modelo que saque campos puntuales de un texto libre y devuelve un
 * objeto plano { campo: valor }. NO es la persona del bot: es un extractor que
 * solo responde JSON. Extraído de src/units/oxford-education/flow-engine.js sin
 * cambiar el prompt ni el parseo, para no alterar el comportamiento de Ori.
 */

import { chat } from '../ai/claude.js';

/**
 * @param {string} freeText - Mensaje del usuario
 * @param {Array<{key: string, label: string}>} fields - Campos a extraer
 * @param {Object} log - Logger child
 * @returns {Promise<Object>} { campo: valor } — {} si el LLM falla o no parsea
 */
export async function extractStructuredFields(freeText, fields, log) {
  const fieldList = fields.map((f) => `  - ${f.key}: ${f.label}`).join('\n');
  const systemPrompt =
    `Eres un extractor de datos, NO un asistente conversacional. A partir del mensaje del usuario, ` +
    `identifica estos campos si están CLARAMENTE presentes:\n${fieldList}\n\n` +
    `Responde ÚNICAMENTE con un objeto JSON plano (sin markdown, sin texto adicional, sin explicación) ` +
    `con exactamente esas llaves. Usa null en cualquier campo que no esté presente. No inventes valores.`;

  try {
    const raw = await chat(systemPrompt, [], freeText);
    return parseJsonLoose(raw, fields.map((f) => f.key));
  } catch (error) {
    log?.error?.({ err: error }, 'Error extrayendo datos estructurados — se continúa sin datos (no rompe el flujo)');
    return {};
  }
}

/** Extrae el primer bloque {...} de la respuesta (tolera texto/markdown alrededor) y lo valida. */
export function parseJsonLoose(raw, keys) {
  if (!raw) return {};
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};

  try {
    const obj = JSON.parse(match[0]);
    const out = {};
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null') out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}
