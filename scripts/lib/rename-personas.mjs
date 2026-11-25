/**
 * Lógica pura del cambio de nombre en el Sheet (Ori → Ox, Miri → Ed).
 * La usa scripts/rename-sheet-personas.mjs; separada para poder probarla sin Google.
 */

// Pestañas de CONTENIDO (las del cache, sin 'Leads'). Nunca se leen pestañas con
// datos de personas (Leads, INSCRITOS, Leads Oxford): no están en esta lista.
export const TAB_RULES = {
  'Flujo Ori': ['ox'],
  'FAQ Oxford': ['ox'],
  'Flujo Miri': ['ed'],
  Viajes: ['ed'],
  Precios: ['ed'],
  Colegios: ['ed'],
  'Actividades Extra': ['ed'],
  Materiales: ['ed'],
  'Info General': ['ox', 'ed'],
};

const RULES = {
  ox: { re: /\bOri\b/g, to: 'Ox' },
  ed: { re: /\bMiri\b/g, to: 'Ed' },
};

// Autorreferencias en femenino que en Ed hay que revisar a mano (no se cambian
// solas: "lista" o "atenta" también pueden hablar de otra cosa).
const ED_GENDER_FLAGS = /\b(encantada|lista para|atenta|contenta|segura de|dispuesta|preparada|la asistente|tu asistente virtual,? la)\b/i;

const isNotesHeader = (h) => /^notas?$/i.test(String(h || '').trim());

export function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * @param {Record<string, string[][]>} tabs - valores de cada pestaña (fila 0 = encabezado)
 * @param {{includeNotes?: boolean}} [opts]
 * @returns {{changes: Array<{tab,cell,before,after}>, flags: Array<{tab,cell,text}>}}
 */
export function planRenames(tabs, { includeNotes = false } = {}) {
  const changes = [];
  const flags = [];
  for (const [tab, rows] of Object.entries(tabs)) {
    const rules = TAB_RULES[tab];
    if (!rules || !rows?.length) continue;
    const header = rows[0] || [];
    rows.forEach((row, r) => {
      if (r === 0) return;
      row.forEach((val, c) => {
        if (typeof val !== 'string' || !val) return;
        if (isNotesHeader(header[c]) && !includeNotes) return;
        let after = val;
        for (const k of rules) after = after.replace(RULES[k].re, RULES[k].to);
        const cell = `${colLetter(c)}${r + 1}`;
        if (after !== val) changes.push({ tab, cell, before: val, after });
        if (rules.includes('ed') && !isNotesHeader(header[c]) && ED_GENDER_FLAGS.test(after)) flags.push({ tab, cell, text: after });
      });
    });
  }
  return { changes, flags };
}

/**
 * Restaurar: solo regresa las celdas que siguen exactamente como las dejó el
 * script. Si alguien las editó después, se reportan y no se pisan.
 */
export function planRestore(backupChanges, currentValueOf) {
  const restore = [];
  const skipped = [];
  for (const ch of backupChanges) {
    const now = currentValueOf(ch.tab, ch.cell);
    if (now === ch.after) restore.push(ch);
    else skipped.push({ ...ch, now });
  }
  return { restore, skipped };
}
