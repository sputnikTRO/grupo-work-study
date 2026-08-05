/**
 * Oxford Education — Registro de asesores y ruteo geográfico
 *
 * ÚNICA FUENTE DE VERDAD para asesores de Oxford (a diferencia de Travel, que los
 * duplica entre actions.js y advisor-commands.js). Tanto el handoff activo
 * (actions.js) como los comandos de asesor (advisor-commands.js) leen de aquí.
 *
 * Teléfonos: formato LOCAL de 10 dígitos para México (normalizePhone agrega +521).
 * EXCEPCIÓN: Oriana es internacional (EEUU, +1). Se guarda con su E.164 completo y
 * la bandera `international: true`; el passthrough internacional de normalizePhone
 * (src/utils/phone.js) la respeta y NO le fuerza +52.
 */

// ── Registro de asesores (clave estable interna) ─────────────────────────────
export const ADVISORS = {
  enrique:  { key: 'enrique',  nombre: 'Enrique Ruiz',        apodo: 'Enrique',  whatsapp: '5532676181' },
  oriana:   { key: 'oriana',   nombre: 'Oriana Pullas',       apodo: 'Oriana',   whatsapp: '+17866332282', international: true },
  rosaura:  { key: 'rosaura',  nombre: 'Rosaura Pinto',       apodo: 'Rosaura',  whatsapp: '5528996738' },
  diana:    { key: 'diana',    nombre: 'Diana Castillo',      apodo: 'Diana',    whatsapp: '5554794875' },
  alfredo:  { key: 'alfredo',  nombre: 'Alfredo Grados',      apodo: 'Alfredo',  whatsapp: '5551064383' },
  paola:    { key: 'paola',    nombre: 'Paola Torres',        apodo: 'Paola',    whatsapp: '5534599531' },
  gilberto: { key: 'gilberto', nombre: 'Gilberto Osnaya',     apodo: 'Gilberto', whatsapp: '5560703259' },
  anamaria: { key: 'anamaria', nombre: 'Anamaría Manzanares', apodo: 'Anamaría', whatsapp: '5541947449' },
};

// ── Duplas por zona (round-robin dentro de la dupla, en actions.js) ──────────
export const DUPLAS = {
  A: { key: 'A', advisors: ['enrique', 'oriana'] },
  B: { key: 'B', advisors: ['rosaura', 'diana'] },
  C: { key: 'C', advisors: ['alfredo', 'paola'] },
  D: { key: 'D', advisors: ['gilberto', 'anamaria'] },
};

/**
 * Normaliza texto geográfico: sin acentos, minúsculas, sin puntos, espacios
 * colapsados. "Gustavo A. Madero" → "gustavo a madero"; "Edo. de México" →
 * "edo de mexico"; "CDMX " → "cdmx".
 */
export function normGeo(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita diacríticos
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Alias → forma canónica (ya normalizada) ──────────────────────────────────
const ALIASES = {
  // CDMX
  'ciudad de mexico': 'cdmx', 'cd de mexico': 'cdmx', 'cd mexico': 'cdmx',
  'df': 'cdmx', 'd f': 'cdmx', 'distrito federal': 'cdmx', 'mexico city': 'cdmx', 'cdmx': 'cdmx',
  // Estado de México (default de sus municipios → dupla B)
  'estado de mexico': 'edomex', 'edo de mexico': 'edomex', 'edo mexico': 'edomex',
  'edo mex': 'edomex', 'edomex': 'edomex', 'mexico': 'edomex', 'mex': 'edomex',
  // Estados con abreviatura/forma larga
  'nl': 'nuevo leon', 'n l': 'nuevo leon',
  'bc': 'baja california', 'bcs': 'baja california sur',
  'slp': 'san luis potosi', 'qro': 'queretaro', 'qroo': 'quintana roo', 'q roo': 'quintana roo',
  'coahuila de zaragoza': 'coahuila', 'michoacan de ocampo': 'michoacan',
  'veracruz de ignacio de la llave': 'veracruz',
  // Alcaldías CDMX con abreviatura/forma larga
  'gam': 'gustavo a madero', 'ao': 'alvaro obregon', 'bj': 'benito juarez',
  'mh': 'miguel hidalgo', 'vc': 'venustiano carranza',
  'la magdalena contreras': 'magdalena contreras', 'cuajimalpa de morelos': 'cuajimalpa',
};

function canon(token) {
  const n = normGeo(token);
  return ALIASES[n] || n;
}

// ── Alcaldías de CDMX → dupla (las 16) ───────────────────────────────────────
// NOTA: Cuajimalpa es alcaldía de CDMX pero va INTENCIONALMENTE en la dupla B.
const CDMX_ALCALDIA_TO_DUPLA = {
  // Dupla A
  'alvaro obregon': 'A', 'benito juarez': 'A', 'iztacalco': 'A', 'coyoacan': 'A', 'tlalpan': 'A',
  // Dupla B (excepción)
  'cuajimalpa': 'B',
  // Dupla C
  'magdalena contreras': 'C', 'milpa alta': 'C', 'tlahuac': 'C', 'iztapalapa': 'C', 'xochimilco': 'C',
  // Dupla D
  'miguel hidalgo': 'D', 'cuauhtemoc': 'D', 'venustiano carranza': 'D', 'azcapotzalco': 'D', 'gustavo a madero': 'D',
};

// ── Estados de la República → dupla (CDMX se resuelve por alcaldía) ───────────
const STATE_TO_DUPLA = {
  // Dupla A
  'sonora': 'A', 'chihuahua': 'A', 'coahuila': 'A', 'nuevo leon': 'A', 'sinaloa': 'A',
  'baja california': 'A', 'baja california sur': 'A',
  // Dupla B (incluye Edo. de México por default)
  'edomex': 'B', 'puebla': 'B', 'morelos': 'B', 'michoacan': 'B', 'colima': 'B',
  'jalisco': 'B', 'nayarit': 'B', 'aguascalientes': 'B',
  // Dupla C
  'guerrero': 'C', 'oaxaca': 'C', 'veracruz': 'C', 'tabasco': 'C', 'chiapas': 'C',
  'campeche': 'C', 'yucatan': 'C', 'quintana roo': 'C',
  // Dupla D
  'tlaxcala': 'D', 'hidalgo': 'D', 'queretaro': 'D', 'guanajuato': 'D',
  'san luis potosi': 'D', 'zacatecas': 'D', 'tamaulipas': 'D', 'durango': 'D',
};

/**
 * Resuelve la dupla (A/B/C/D) a partir de estado + municipio/alcaldía.
 *
 * Reglas:
 *  - CDMX → por alcaldía (requiere municipio). Cuajimalpa → B (excepción).
 *  - Edo. de México → SIEMPRE dupla B (cualquier municipio, listado o no).
 *  - Otros estados → por estado.
 *  - Si sólo hay municipio y coincide con una alcaldía CDMX → se infiere CDMX.
 *
 * @returns {'A'|'B'|'C'|'D'|null} null = sin match (p. ej. lead internacional o
 *   CDMX sin alcaldía). El caller aplica el fallback correspondiente.
 */
export function resolveDupla(state, municipality) {
  const s = canon(state);
  const m = canon(municipality);

  // Edo. de México: default dupla B para cualquier municipio.
  if (s === 'edomex') return 'B';

  // CDMX: depende de la alcaldía.
  if (s === 'cdmx') {
    if (m && CDMX_ALCALDIA_TO_DUPLA[m]) return CDMX_ALCALDIA_TO_DUPLA[m];
    return null; // CDMX sin alcaldía reconocida → pedir/aclarar
  }

  // Otro estado reconocido.
  if (s && STATE_TO_DUPLA[s]) return STATE_TO_DUPLA[s];

  // Sólo municipio: inferir CDMX si es una alcaldía conocida.
  if (!s && m && CDMX_ALCALDIA_TO_DUPLA[m]) return CDMX_ALCALDIA_TO_DUPLA[m];

  return null;
}

/**
 * @param {'A'|'B'|'C'|'D'} duplaKey
 * @returns {Array<Object>} los 2 objetos advisor de la dupla, en orden.
 */
export function duplaAdvisors(duplaKey) {
  const dupla = DUPLAS[duplaKey];
  if (!dupla) return [];
  return dupla.advisors.map((k) => ADVISORS[k]);
}

/**
 * Busca un asesor por su número entrante (para el whitelist de comandos).
 * Compara por últimos 10 dígitos (México) o por E.164 completo (internacional).
 * @param {string} normalizedPhoneNoPlus - número ya normalizado, sin '+'
 * @returns {Object|null}
 */
export function advisorByPhone(normalizedPhoneNoPlus) {
  const digits = (normalizedPhoneNoPlus || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return (
    Object.values(ADVISORS).find((a) => {
      const adv = a.whatsapp.replace(/\D/g, '');
      return a.international ? adv === digits : adv.slice(-10) === last10;
    }) || null
  );
}
