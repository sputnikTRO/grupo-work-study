import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { CLAUDE } from '../../config/constants.js';
import logger from '../../utils/logger.js';

/**
 * Claude AI Client with Circuit Breaker
 *
 * Features:
 * - Exponential backoff retry (3 attempts)
 * - 30-second timeout
 * - Circuit breaker: after 3 consecutive failures, enters fallback mode
 * - Fallback response when Claude is unavailable
 */

// Circuit breaker state
let circuitBreakerState = {
  failureCount: 0,
  lastFailureTime: null,
  isOpen: false,
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

// Anthropic client singleton
const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

/**
 * Main chat function with Claude
 *
 * @param {string} systemPrompt - System prompt with personality and instructions
 * @param {Array} conversationHistory - Array of {role, content} messages
 * @param {string} userMessage - Current user message
 * @returns {Promise<string>} Claude's response text
 */
export async function chat(systemPrompt, conversationHistory, userMessage) {
  const chatLogger = logger.child({ function: 'claude.chat' });

  // Check circuit breaker
  if (isCircuitBreakerOpen()) {
    chatLogger.warn('Circuit breaker is OPEN, returning fallback response');
    return getFallbackResponse();
  }

  // Build messages array for Claude
  const messages = [
    ...conversationHistory,
    {
      role: 'user',
      content: userMessage,
    },
  ];

  chatLogger.info({
    systemPromptLength: systemPrompt.length,
    historyLength: conversationHistory.length,
    userMessageLength: userMessage.length,
  }, 'Sending request to Claude');

  try {
    const response = await chatWithRetry(systemPrompt, messages);

    // Reset circuit breaker on success
    resetCircuitBreaker();

    return response;
  } catch (error) {
    chatLogger.error({ err: error }, 'Claude API failed after all retries');

    // Increment circuit breaker failure count
    recordFailure();

    // Return fallback
    return getFallbackResponse();
  }
}

/**
 * Sends request to Claude with exponential backoff retry
 *
 * @param {string} systemPrompt - System prompt
 * @param {Array} messages - Messages array
 * @returns {Promise<string>} Response text
 */
async function chatWithRetry(systemPrompt, messages) {
  let lastError;

  for (let attempt = 1; attempt <= CLAUDE.MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: CLAUDE.MAX_TOKENS,
        system: systemPrompt,
        messages: messages,
        timeout: CLAUDE.TIMEOUT_MS,
      });

      logger.debug({
        attempt,
        usage: response.usage,
        stopReason: response.stop_reason,
      }, 'Claude API success');

      // Extract text from response
      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      return textContent;

    } catch (error) {
      lastError = error;

      logger.warn({
        attempt,
        maxRetries: CLAUDE.MAX_RETRIES,
        error: error.message,
        errorType: error.constructor.name,
      }, 'Claude API attempt failed');

      // Don't retry on certain errors
      if (isNonRetryableError(error)) {
        logger.error({ err: error }, 'Non-retryable error, aborting');
        throw error;
      }

      // If not last attempt, wait with exponential backoff
      if (attempt < CLAUDE.MAX_RETRIES) {
        const delayMs = CLAUDE.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.info({ delayMs, nextAttempt: attempt + 1 }, 'Retrying after delay');
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Checks if error is non-retryable (don't retry on these)
 *
 * @param {Error} error - Error from Claude API
 * @returns {boolean} True if error should not be retried
 */
function isNonRetryableError(error) {
  // Authentication errors
  if (error.status === 401) return true;

  // Invalid request errors
  if (error.status === 400) return true;

  // Rate limit with no retry-after
  if (error.status === 429 && !error.headers?.['retry-after']) return false;

  return false;
}

/**
 * Checks if circuit breaker is open
 *
 * @returns {boolean} True if circuit breaker is open (should use fallback)
 */
function isCircuitBreakerOpen() {
  // If circuit breaker was opened, check if timeout has passed
  if (circuitBreakerState.isOpen) {
    const timeSinceLastFailure = Date.now() - circuitBreakerState.lastFailureTime;

    if (timeSinceLastFailure > CIRCUIT_BREAKER_TIMEOUT) {
      logger.info('Circuit breaker timeout passed, attempting to close');
      circuitBreakerState.isOpen = false;
      circuitBreakerState.failureCount = 0;
      return false;
    }

    return true;
  }

  return false;
}

/**
 * Records a failure and potentially opens the circuit breaker
 */
function recordFailure() {
  circuitBreakerState.failureCount++;
  circuitBreakerState.lastFailureTime = Date.now();

  logger.warn({
    failureCount: circuitBreakerState.failureCount,
    threshold: CIRCUIT_BREAKER_THRESHOLD,
  }, 'Claude API failure recorded');

  if (circuitBreakerState.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerState.isOpen = true;
    logger.error('Circuit breaker OPENED - entering fallback mode');
  }
}

/**
 * Resets circuit breaker on successful request
 */
function resetCircuitBreaker() {
  if (circuitBreakerState.failureCount > 0 || circuitBreakerState.isOpen) {
    logger.info('Circuit breaker reset - Claude API healthy');
  }

  circuitBreakerState.failureCount = 0;
  circuitBreakerState.lastFailureTime = null;
  circuitBreakerState.isOpen = false;
}

/**
 * Returns fallback response when Claude is unavailable
 *
 * @returns {string} Fallback message
 */
function getFallbackResponse() {
  return 'Gracias por escribirnos. Estamos teniendo un problema técnico momentáneo. Una asesora le contactará en breve. 😊';
}

/**
 * Gets circuit breaker status (for monitoring/debugging)
 *
 * @returns {Object} Circuit breaker state
 */
export function getCircuitBreakerStatus() {
  return {
    ...circuitBreakerState,
    isHealthy: !circuitBreakerState.isOpen && circuitBreakerState.failureCount === 0,
  };
}

/**
 * Manually resets circuit breaker (for admin commands)
 */
export function forceResetCircuitBreaker() {
  logger.warn('Circuit breaker manually reset by admin');
  resetCircuitBreaker();
}

/**
 * Helper: sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
