/**
 * W&S OTCC — guardarraíles en CÓDIGO (no solo en el prompt).
 *
 * Antes de enviar cualquier respuesta del modo W&S:
 *   - se quitan nombres y teléfonos del equipo (aunque el LLM los "adivine");
 *   - se quitan montos de dinero (la base solo dice "tiene costo");
 *   - el correo de la base (karen.mendez@oxfordeducationlit.org) SÍ se conserva:
 *     de ahí llegan códigos y fechas, y la base lo indica.
 */
import { normalize } from './intent.js';

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const MONEY = /(\$|€|£)\s?\d[\d.,]*(\s?(mxn|eur|euros?|usd|pesos|d[oó]lares))?|\b\d[\d.,]*\s?(mxn|eur|euros?|usd|pesos|d[oó]lares)\b/gi;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Regex que acepta la palabra con o sin acentos. */
function accentInsensitive(word) {
  const map = { a: '[aá]', e: '[eé]', i: '[ií]', o: '[oó]', u: '[uúü]', n: '[nñ]' };
  return [...normalize(word)].map((ch) => map[ch] || escapeRe(ch)).join('');
}

/**
 * @param {string} text
 * @param {Array<{nombre:string}>} contacts
 * @returns {{ text: string, changed: string[] }} changed = qué se quitó (para el log)
 */
export function sanitizeWsReply(text, contacts = []) {
  if (!text) return { text, changed: [] };
  const changed = [];
  const emails = [];
  let out = text.replace(EMAIL, (m) => { emails.push(m); return `\u0000${emails.length - 1}\u0000`; });

  for (const c of contacts) {
    const parts = String(c.nombre || '').split(/\s+/).filter((p) => p.length > 2);
    if (!parts.length) continue;
    const full = new RegExp(`\\b${parts.map(accentInsensitive).join('\\s+')}\\b`, 'gi');
    const first = new RegExp(`(?<![\\w@.])${accentInsensitive(parts[0])}(?![\\wáéíóúñ])`, 'gi');
    for (const re of [full, first]) {
      if (re.test(out)) { changed.push(`nombre:${c.nombre}`); out = out.replace(re, 'el equipo responsable'); }
    }
  }
  out = out.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 8 || /^\d{4}-\d{2}-\d{2}$/.test(m.trim())) return m; // fechas y cifras cortas no son teléfonos
    changed.push('telefono');
    return '';
  });
  if (MONEY.test(out)) { changed.push('monto'); out = out.replace(MONEY, 'un costo que te confirma el equipo'); }

  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => emails[Number(i)]);
  out = out.replace(/el equipo responsable(\s+el equipo responsable)+/gi, 'el equipo responsable')
    .replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:])/g, '$1').trim();
  return { text: out, changed };
}
