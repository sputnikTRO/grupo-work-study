/** W&S OTCC — parser PURO de la sección 5 de docs/kb-ws-otcc.md (sin base ni Sheets). */

/**
 * Sección 5 del documento → filas { seccion, pregunta, respuesta, orden }.
 * Cada línea de pregunta es "¿…? [(nueva)] respuesta".
 */
export function parseKbDoc(md) {
  const start = md.indexOf('5. Preguntas frecuentes');
  if (start < 0) return [];
  const rows = [];
  let seccion = '';
  for (const raw of md.slice(start).split('\n').slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = /^Secci[oó]n\s+\d+\.\s*(.+)$/.exec(line);
    if (sec) { seccion = sec[1].trim(); continue; }
    const q = line.indexOf('?');
    if (q < 0) continue;
    const pregunta = line.slice(0, q + 1).trim();
    const respuesta = line.slice(q + 1).replace(/^\s*\(nueva\)\s*/i, '').trim();
    if (pregunta && respuesta) rows.push({ seccion, pregunta, respuesta, orden: rows.length + 1 });
  }
  return rows;
}
