import { PHONE } from '../config/constants.js';
import logger from './logger.js';

/**
 * Phone Number Utilities
 *
 * Handles normalization and validation of phone numbers to E.164 format
 * E.164 format: +[country code][subscriber number]
 * Example: +521234567890 (Mexico)
 */

/**
 * Normalizes a phone number to E.164 format
 * @param {string} phone - Raw phone number
 * @returns {string} Normalized E.164 phone number
 *
 * @example
 * normalizePhone('5512345678') → '+5215512345678'
 * normalizePhone('15512345678') → '+5215512345678'
 * normalizePhone('+5215512345678') → '+5215512345678'
 */
export function normalizePhone(phone) {
  if (!phone) {
    throw new Error('Phone number is required');
  }

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If already starts with +521, return as-is
  if (cleaned.startsWith('+521')) {
    return cleaned;
  }

  // If starts with +52 (without 1), add the 1
  if (cleaned.startsWith('+52')) {
    return cleaned.replace('+52', '+521');
  }

  // If starts with 52 (without +), add +521
  if (cleaned.startsWith('52') && cleaned.length >= 12) {
    return '+521' + cleaned.slice(2);
  }

  // If it's a 10-digit Mexican number (no country code)
  if (cleaned.length === 10 && !cleaned.startsWith('+')) {
    return `${PHONE.MEXICO_COUNTRY_CODE}${cleaned}`;
  }

  // International passthrough: ≥11 digits without a Mexican prefix already carry
  // their own country code (e.g. +1 US/CA, +58 VE, +44 UK). Adding +521 here
  // would corrupt the number and cause Meta to reject the outbound message.
  if (cleaned.length >= 11) {
    logger.info({ phone: cleaned, prefix: cleaned.slice(0, 2) }, 'Non-Mexican phone detected — preserving country code');
    return `+${cleaned}`;
  }

  // Short number with no country code — assume Mexican mobile
  return `${PHONE.MEXICO_COUNTRY_CODE}${cleaned}`;
}

/**
 * Validates if a phone number is in valid E.164 format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid E.164 format
 *
 * @example
 * isValidE164('+5215512345678') → true
 * isValidE164('5512345678') → false
 */
export function isValidE164(phone) {
  if (!phone) {
    return false;
  }

  return PHONE.E164_REGEX.test(phone);
}

/**
 * Extracts the country code from an E.164 phone number
 * @param {string} phone - E.164 formatted phone number
 * @returns {string} Country code (e.g., '+52')
 *
 * @example
 * getCountryCode('+5215512345678') → '+52'
 */
export function getCountryCode(phone) {
  if (!isValidE164(phone)) {
    throw new Error('Invalid E.164 phone number');
  }

  // Extract country code (1-3 digits after +)
  const match = phone.match(/^\+(\d{1,3})/);
  return match ? `+${match[1]}` : '';
}

/**
 * Formats a phone number for display (removes country code for Mexican numbers)
 * @param {string} phone - E.164 formatted phone number
 * @returns {string} Display-friendly format
 *
 * @example
 * formatForDisplay('+5215512345678') → '55 1234 5678'
 */
export function formatForDisplay(phone) {
  if (!isValidE164(phone)) {
    return phone;
  }

  // For Mexican numbers, remove +521 and format nicely
  if (phone.startsWith('+521')) {
    const number = phone.slice(4); // Remove +521
    return `${number.slice(0, 2)} ${number.slice(2, 6)} ${number.slice(6)}`;
  }

  return phone;
}
