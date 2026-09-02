/**
 * Flujo determinístico — clasificadores de texto (puros, sin dependencias)
 *
 * Compartidos por el motor de flujo de Oxford (Ori) y el de Travel (Miri).
 * Extraídos de src/units/oxford-education/flow-engine.js SIN cambiar su
 * comportamiento: mismas normalizaciones y mismos regex, para que Ori siga
 * clasificando exactamente igual que en producción.
 */

/** Quita diacríticos, pasa a minúsculas y recorta (mismo enfoque que advisor-zones.js). */
export function normalize(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim();
}

/**
 * "Menú"/"menu"/"MENÚ!" → true. Solo dispara con el keyword SOLO, para evitar
 * falsos positivos dentro de frases ("quiero ver el menu de opciones").
 */
export function isMenuKeyword(text) {
  const lettersOnly = normalize(text).replace(/[^a-z]/g, '');
  return lettersOnly === 'menu';
}

const DECLINE_RE = /\b(no|nel|nop|negativo|ahorita no|ahora no|despues|mas tarde|luego|paso|todavia no)\b/;
const ACCEPT_RE = /\b(si|claro|va|dale|ok|okay|vale|simon|yes|adelante|porfa|por favor)\b|hablar.*asesor|me interesa|conectame|conectenme|de acuerdo|esta bien/;

/**
 * Clasifica una respuesta a un CTA ("¿hablar con un asesor?") en
 * 'accept' | 'decline' | 'ambiguous'. Deliberadamente conservador: lo que no
 * matchea claro cae en 'ambiguous' → respaldo LLM (nunca deriva por accidente).
 */
export function classifyCta(text) {
  const n = normalize(text);
  if (!n) return 'ambiguous';
  if (DECLINE_RE.test(n)) return 'decline';
  if (ACCEPT_RE.test(n)) return 'accept';
  return 'ambiguous';
}
