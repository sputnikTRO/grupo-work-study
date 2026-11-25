/**
 * Cambio de nombre de los asistentes (nov-2026): Ori → Ox, Miri → Ed.
 *
 * Los mensajes ya guardados no se tocan (son el registro de lo que se dijo).
 * Pero el historial que recibe el LLM sí se ajusta: si el asistente ve en sus
 * propios turnos "¡Hola! Soy Miri…", tiende a seguir presentándose así. Solo se
 * reemplaza en turnos del ASISTENTE y con límite de palabra, así que "Miriana"
 * (una asesora) o lo que escribió el usuario quedan intactos.
 */
export const PERSONA_RENAMES = {
  oxford_education: { from: 'Ori', to: 'Ox' },
  travel: { from: 'Miri', to: 'Ed' },
};

/**
 * @param {Array<{role:string, content:string}>} history
 * @param {'oxford_education'|'travel'} unit
 * @returns {Array} copia con el nombre viejo reemplazado en turnos del asistente
 */
export function renameLegacyPersona(history, unit) {
  const rename = PERSONA_RENAMES[unit];
  if (!rename || !Array.isArray(history)) return history;
  const re = new RegExp(`\\b${rename.from}\\b`, 'g');
  return history.map((m) => (m.role === 'assistant' && typeof m.content === 'string' && re.test(m.content)
    ? { ...m, content: m.content.replace(re, rename.to) }
    : m));
}
