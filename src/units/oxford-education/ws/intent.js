/**
 * W&S OTCC — detección de intención y lectura de respuestas del filtro.
 *
 * Módulo PURO (sin env, sin base): todo es texto → resultado, para que la regla
 * sea predecible y se pueda probar con una tabla de frases.
 *
 * Regla de activación (aprobada nov-2026):
 *   ACTIVA  → "OTCC", "Oxford TCC", "TCC" (excepto TCC Kids), o
 *             "certificación/certificado" JUNTO CON "Oxford", "inglés" o
 *             "Work and Study". Solos, "certificación"/"certificado" NO activan:
 *             Ox vende varias certificaciones y la mayoría de quienes escriben
 *             son prospectos comerciales.
 *   BLOQUEA → TCC Kids, ETC / docentes, Checkpoint (son otras certificaciones).
 *   W&S explícito ("Work and Study", "W&S") + intención → entra sin preguntar.
 */

/** minúsculas, sin acentos, espacios simples. `&` se conserva (W&S). */
export function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const TCC_KIDS = /\b(oxford\s*)?t\.?\s?c\.?\s?c\.?\s*kids\b/g;
const STRONG = [
  /\bo\.?\s?tcc\b/,                       // otcc, o tcc, o.tcc
  /\boxford\s*t\.?\s?c\.?\s?c\b/,         // oxford tcc, oxford t.c.c
  /\btcc\b/,                              // tcc (TCC Kids ya se quitó antes)
];
const CERT = /\bcertifica(cion|ciones|do|dos|da|das|r|rme|rse|rte)\b/;
const CERT_CONTEXT = /\b(oxford|ingles|english)\b|work\s*(and|&|y|n)?\s*study|\bw\s?&\s?s\b/;
const OTHER_CERT = /\betc\b|teaching certificate|docente|maestr[oa]s?\b|profesor|checkpoint/;
export const EXPLICIT_WS = /work\s*(and|&|y|n|an)?\s*study|\bw\s?&\s?s\b|\bwys\b/;

/**
 * @param {string} text
 * @returns {{ otcc: boolean, ws: boolean }} otcc = activa el filtro; ws = además
 *   menciona Work and Study (entra directo sin preguntar)
 */
export function detectOtccIntent(text) {
  const n = normalize(text);
  if (!n) return { otcc: false, ws: false };
  const sinKids = n.replace(TCC_KIDS, ' ');
  const strong = STRONG.some((re) => re.test(sinKids));
  const cert = CERT.test(n) && CERT_CONTEXT.test(n) && !OTHER_CERT.test(n);
  const otcc = strong || cert;
  return { otcc, ws: otcc && EXPLICIT_WS.test(n) };
}

/** ¿La persona dice explícitamente que es de Work and Study? */
export function mentionsWorkAndStudy(text) {
  return EXPLICIT_WS.test(normalize(text));
}

const NUM = (n) => new RegExp(`^\\s*(opcion\\s*)?${n}\\s*([.)-].*)?$`);
const NO_SEGURO = /\b(no (lo )?se|no estoy segur[oa]|ni idea|no tengo idea|no recuerdo|creo que|tal vez|quiza)\b/;
const SIGO_SIN = /\bsigo (sin|con dudas)|aun (no|tengo dudas)|todavia no se\b/;
const YES = /^(si|sip|claro|correcto|asi es|afirmativo|yes|exacto|efectivamente|aja)\b/;
const NO = /^(no|nop|nel|negativo|nope)\b|\botro programa\b|\bninguno\b|\bno formo parte\b|\bno soy (de|parte)\b/;

/**
 * Respuesta a ws_filtro / ws_filtro_programa.
 * @returns {'ws'|'no'|'no_seguro'|null} null = no se entiende
 */
export function parseFiltroAnswer(text) {
  const n = normalize(text);
  if (!n) return null;
  if (NUM(1).test(n)) return 'ws';
  if (NUM(2).test(n)) return 'no';
  if (NUM(3).test(n)) return 'no_seguro';
  if (NO_SEGURO.test(n)) return 'no_seguro';
  if (EXPLICIT_WS.test(n) && !/^no\b/.test(n)) return 'ws';
  if (YES.test(n)) return 'ws';
  if (NO.test(n)) return 'no';
  return null;
}

/** Respuesta a ws_no_seguro. @returns {'ws'|'no'|'canalizar'|null} */
export function parseNoSeguroAnswer(text) {
  const n = normalize(text);
  if (!n) return null;
  if (NUM(1).test(n)) return 'ws';
  if (NUM(2).test(n)) return 'no';
  if (NUM(3).test(n)) return 'canalizar';
  if (SIGO_SIN.test(n) || NO_SEGURO.test(n)) return 'canalizar';
  if (YES.test(n) || (EXPLICIT_WS.test(n) && !/^no\b/.test(n))) return 'ws';
  if (NO.test(n)) return 'no';
  return null;
}

/** Respuesta a ws_tema. @returns {'otcc'|'otro'|null} */
export function parseTemaAnswer(text) {
  const n = normalize(text);
  if (!n) return null;
  if (NUM(1).test(n)) return 'otcc';
  if (NUM(2).test(n)) return 'otro';
  if (/\botro\b|\blife\b|\bvisa\b|\bno\b/.test(n)) return 'otro';
  if (YES.test(n) || detectOtccIntent(n).otcc || /\bcertifica/.test(n)) return 'otcc';
  return null;
}

/** "No soy de W&S" dicho dentro del modo W&S. */
export function saysNotWorkAndStudy(text) {
  const n = normalize(text);
  return /\bno (soy|formo parte|estoy|pertenezco)( (de|en|a))?( (el|al))?( programa( de)?)? (work\s*(and|&|y)?\s*study|w\s?&\s?s)\b/.test(n)
    || /\bno (soy|formo parte|estoy inscrit[oa]) (de|en) (ningun|ese) programa\b/.test(n);
}

/** Pide hablar con una persona (siempre se canaliza). */
export function asksForHuman(text) {
  const n = normalize(text);
  return /\b(hablar|comunicarme|contactar|platicar) con (una persona|alguien|un humano|un asesor|una asesora|el equipo|personal)\b|\bquiero (una persona|un humano|un asesor|una asesora)\b/.test(n);
}
