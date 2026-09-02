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

/**
 * Normalización para comparar OPCIONES de menú: además de quitar acentos y
 * minusculizar (lo que hace normalize), quita puntuación y colapsa espacios.
 *
 * Va aparte de normalize() a propósito: normalize() la comparte Ori y cambiarla
 * alteraría su clasificación de CTAs. Aquí hace falta el paso extra porque las
 * etiquetas traen comas — "1.- Sí, por favor" — y el usuario escribe sin ellas.
 */
function normalizeOption(s) {
  return normalize(s).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * ¿El mensaje es SOLO un número (con o sin puntuación, o precedido de "opción")?
 * "2" · "2." · "2)" · "opción 2" → '2'.  "José tiene 14 años" → null.
 *
 * Se usa para distinguir dos casos que merecen respuestas distintas: elegir mal
 * una opción del menú (hay que volver a mostrarlo) y escribir una frase que
 * casualmente lleva un número (eso es conversación, va al respaldo LLM).
 *
 * @param {string} text
 * @returns {string|null}
 */
export function standaloneNumber(text) {
  const m = normalize(text).match(/^(?:la\s+)?(?:opcion\s*)?(\d{1,2})\s*[.)\-]?$/);
  return m ? m[1] : null;
}

/**
 * Extrae las etiquetas de un menú numerado a partir del texto del nodo:
 *   "1.- Ya estoy inscrito" → { '1': 'ya estoy inscrito' }
 * Solo se consultan las claves que el nodo declara como opciones, así que las
 * líneas que casualmente empiezan con un número no estorban.
 */
export function parseMenuLabels(texto) {
  const out = {};
  for (const line of String(texto ?? '').split('\n')) {
    const m = line.match(/^\s*(\d{1,2})\s*[.\-)]*\s*(.+?)\s*$/);
    if (m) out[m[1]] = normalizeOption(m[2]);
  }
  return out;
}

/**
 * Resuelve qué opción eligió el usuario en un nodo de menú.
 *
 * Acepta tres formas, en este orden:
 *   1. El número SOLO o al inicio: "2", "2.", "2)", "opción 2".
 *   2. El TEXTO de la etiqueta, en palabras completas: "Busco información" →
 *      opción 2; "winter break" → la opción cuya etiqueta empieza así.
 *   3. Nada más.
 *
 * Deliberadamente NO acepta un número suelto en medio de una frase: "José
 * tiene 14 años" no es elegir la opción 14 (ni la 1, ni la 4). Ese caso cae a
 * null y lo atiende el respaldo LLM.
 *
 * @param {string} userText
 * @param {{texto: string, opciones: Object}} node
 * @returns {string|null} clave de la opción ('1', '2', …) o null si no es inequívoco
 */
export function matchMenuChoice(userText, node) {
  const n = normalizeOption(userText);
  if (!n) return null;

  const valid = Object.keys(node?.opciones || {});
  if (valid.length === 0) return null;

  // 1) Número solo (con o sin puntuación / la palabra "opción" delante).
  const num = standaloneNumber(userText);
  if (num && valid.includes(num)) return num;

  // 2) Texto de la etiqueta. Debe ser ÚNICO y coincidir de una de tres formas:
  //      · exacta                              "winter break" = "winter break"
  //      · el usuario escribió DE MÁS           "sí, por favor quiero" ⊃ "sí, por favor"
  //      · el usuario escribió parte de ella, PERO en palabras completas
  //                                             "winter break" ⊂ "winter break (windsor…)"
  //
  // El límite de palabra en ese tercer caso no es un lujo: sin él, "sí" casaba
  // con "ri(si)ng stars" y mandaba al prospecto a Rising Stars por escribir que sí.
  const labels = parseMenuLabels(node.texto);
  const asWords = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const hits = valid.filter((k) => {
    const l = labels[k];
    return l && (n === l || n.includes(l) || asWords.test(l));
  });
  if (hits.length === 1) return hits[0];

  return null;
}
