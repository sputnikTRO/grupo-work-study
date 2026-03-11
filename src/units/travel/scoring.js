import logger from '../../utils/logger.js';

/**
 * Lead Scoring System
 *
 * Analyzes conversation signals and calculates interest score (1-10)
 * Based on docs/Base_Conocimiento_Bot_Travel.md Section 5
 */

/**
 * Analyzes a message for positive/negative signals
 *
 * @param {string} messageText - User message text
 * @param {Object} lead - TravelLead object
 * @returns {Object} Signals found: {positive: [...], negative: [...]}
 */
export function analyzeSignals(messageText, lead) {
  if (!messageText) {
    return { positive: [], negative: [] };
  }

  const normalized = messageText.toLowerCase().trim();

  const signals = {
    positive: [],
    negative: [],
  };

  // POSITIVE SIGNALS

  if (containsAny(normalized, ['cuánto cuesta', 'precio', 'cuál es el costo', 'inversión', 'cuánto es'])) {
    signals.positive.push({ signal: 'pregunta_precio', points: 1 });
  }

  if (containsAny(normalized, ['cuándo', 'qué fecha', 'fecha de salida', 'cuándo es el viaje'])) {
    signals.positive.push({ signal: 'pregunta_fechas', points: 1 });
  }

  if (containsAny(normalized, ['cómo pagar', 'forma de pago', 'mensualidades', 'cuotas', 'apartado'])) {
    signals.positive.push({ signal: 'pregunta_pago', points: 2 });
  }

  if (containsAny(normalized, ['sí quiero', 'me interesa', 'quiero inscribir', 'cómo me inscribo', 'quiero participar'])) {
    signals.positive.push({ signal: 'intencion_inscripcion', points: 2 });
  }

  if (containsAny(normalized, ['actividades', 'extras', 'harry potter', 'london eye', 'parís'])) {
    signals.positive.push({ signal: 'pregunta_actividades', points: 1 });
  }

  if (containsAny(normalized, ['trámites', 'eta', 'sam', 'pasaporte', 'documentos'])) {
    signals.positive.push({ signal: 'pregunta_tramites', points: 1 });
  }

  if (containsAny(normalized, ['aerolínea', 'vuelo', 'qué incluye', 'hospedaje'])) {
    signals.positive.push({ signal: 'pregunta_detalles_logisticos', points: 1 });
  }

  // NEGATIVE SIGNALS

  if (containsAny(normalized, ['lo voy a pensar', 'déjame pensarlo', 'voy a consultar', 'lo platico'])) {
    signals.negative.push({ signal: 'indecision', points: -1 });
  }

  if (containsAny(normalized, ['no me interesa', 'no gracias', 'no por ahora', 'mejor no'])) {
    signals.negative.push({ signal: 'rechazo_explicito', points: -3 });
  }

  if (containsAny(normalized, ['muy caro', 'está caro', 'no puedo pagar', 'no tengo presupuesto'])) {
    signals.negative.push({ signal: 'objecion_precio', points: -2 });
  }

  return signals;
}

/**
 * Calculates new score based on current score and signals
 *
 * @param {number} currentScore - Current score (1-10)
 * @param {Object} signals - Signals from analyzeSignals()
 * @returns {number} New score (1-10)
 */
export function calculateNewScore(currentScore, signals) {
  let delta = 0;

  // Add points from positive signals
  for (const signal of signals.positive) {
    delta += signal.points;
  }

  // Subtract points from negative signals
  for (const signal of signals.negative) {
    delta += signal.points; // Already negative
  }

  // Calculate new score
  let newScore = currentScore + delta;

  // Clamp to 1-10 range
  newScore = Math.max(1, Math.min(10, newScore));

  return newScore;
}

/**
 * Updates lead score based on message analysis
 *
 * @param {string} messageText - User message text
 * @param {Object} lead - TravelLead object
 * @param {number} currentScore - Current interest score
 * @returns {Object} {newScore, signals, delta}
 */
export function updateScore(messageText, lead, currentScore) {
  const scoringLogger = logger.child({ leadId: lead.id, currentScore });

  const signals = analyzeSignals(messageText, lead);

  if (signals.positive.length === 0 && signals.negative.length === 0) {
    scoringLogger.debug('No signals detected, score unchanged');
    return { newScore: currentScore, signals, delta: 0 };
  }

  const newScore = calculateNewScore(currentScore, signals);
  const delta = newScore - currentScore;

  scoringLogger.info({
    positiveSignals: signals.positive.length,
    negativeSignals: signals.negative.length,
    newScore,
    delta,
  }, 'Score updated');

  return { newScore, signals, delta };
}

/**
 * Gets score classification (cold, warm, hot)
 *
 * @param {number} score - Interest score (1-10)
 * @returns {string} 'cold', 'warm', or 'hot'
 */
export function getScoreClassification(score) {
  if (score <= 3) return 'cold';
  if (score <= 7) return 'warm';
  return 'hot';
}

/**
 * Helper: checks if text contains any of the phrases
 */
function containsAny(text, phrases) {
  return phrases.some(phrase => text.includes(phrase));
}
