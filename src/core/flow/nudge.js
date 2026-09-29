/**
 * Flujo determinístico — recordatorio de "Menú" (compartido por Ori y Miri)
 *
 * El recordatorio "Escribe *Menú*…" puede salir de CINCO lugares en un mismo
 * turno: el handler (tras una respuesta del LLM a media navegación), el copy del
 * "no gracias" de un CTA, el texto de error de un nodo roto, la propia respuesta
 * del LLM (el prompt le pide invitar a escribir *Menú*) y el texto de cualquier
 * nodo del Sheet (util_menu, o lo que el cliente edite). Cada uno por separado
 * era razonable; juntos, el prospecto veía el mismo recordatorio dos veces.
 *
 * Por eso el dedupe NO se hace comparando textos exactos (el cliente edita los
 * nodos en Sheets): se reconoce la INTENCIÓN con un regex de variantes, y un
 * guardia por turno decide cuál sale. Reglas:
 *   - máximo UN recordatorio por turno, venga de donde venga;
 *   - si en el nodo actual ya se recordó (conversation.metadata.nudgedNode),
 *     ni el LLM ni el handler lo repiten mientras la conversación siga ahí.
 * El texto de un nodo al que se NAVEGA solo respeta la regla por turno: al
 * cambiar de nodo es un recordatorio nuevo (igual que el nudgedNode del handler).
 */

// Verbo de "escribir/mandar" seguido, a ≤4 palabras, de la palabra Menú:
//   "Escribe *Menú*" · "puedes escribir la palabra 'Menú'" · "escríbeme el nombre o *Menú*"
//   · "solo escribe \"Menú\"" · "mándame Menú" · "responde MENÚ".
// OJO: nada de \b después de "ú" — en JS \b es ASCII y ahí nunca hay límite.
const VERB = '(?:escr[ií]b|m[aá]nd|env[ií]|respond|teclea|pon)[a-záéíóúñ]*';
const MENU_WORD = `[*_"'“‘«]*men[uú](?![a-záéíóúñ])`;
export const MENU_NUDGE_RE = new RegExp(`(?<![a-záéíóúñ])${VERB}(?:\\s+[^\\s.!?]+){0,4}?\\s+${MENU_WORD}`, 'i');

/** ¿El texto invita a escribir "Menú"? */
export function hasMenuNudge(text) {
  return MENU_NUDGE_RE.test(String(text ?? ''));
}

/**
 * Quita las ORACIONES que traen el recordatorio y conserva el resto del
 * mensaje. Si no queda nada (el mensaje era solo el recordatorio), devuelve ''.
 */
export function stripMenuNudge(text) {
  const lines = String(text ?? '').split('\n').map((line) => {
    if (!hasMenuNudge(line)) return line;
    return line
      .split(/(?<=[.!?…])\s+/)
      .filter((sentence) => !hasMenuNudge(sentence))
      .join(' ')
      .trim();
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Guardia de UN turno.
 *
 * @param {Object} opts
 * @param {boolean} opts.nudgedHere - ¿ya se recordó en el nodo donde arranca el turno?
 */
export function createNudgeGuard({ nudgedHere = false } = {}) {
  let nudged = false;

  return {
    /** ¿Salió un recordatorio en este turno? (para persistir nudgedNode al final) */
    get nudged() { return nudged; },

    /**
     * Texto de un NODO del flujo (navegación): solo aplica la regla por turno.
     * @returns {string} el texto tal cual, o sin el recordatorio si ya salió uno ('' si no queda nada)
     */
    forNode(text) {
      if (!hasMenuNudge(text)) return text;
      if (nudged) return stripMenuNudge(text);
      nudged = true;
      return text;
    },

    /**
     * Respuesta conversacional (LLM) sin cambiar de nodo: regla por turno Y por nodo.
     * @returns {string} '' si la respuesta era SOLO un recordatorio repetido —
     *   el llamador muestra el menú en su lugar (es lo que el prospecto pidió).
     */
    forReply(text) {
      if (!hasMenuNudge(text)) return text;
      if (nudged || nudgedHere) return stripMenuNudge(text);
      nudged = true;
      return text;
    },

    /** ¿Puede el handler agregar SU recordatorio? Lo marca como enviado si sí. */
    claimReminder() {
      if (nudged || nudgedHere) return false;
      nudged = true;
      return true;
    },
  };
}
