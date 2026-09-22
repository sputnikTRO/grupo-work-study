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
  // NORTE
  enrique:  { key: 'enrique',  nombre: 'Enrique Ruiz',     apodo: 'Enrique',  whatsapp: '5532676181', rol: 'coord' },
  mayra:    { key: 'mayra',    nombre: 'Mayra Villareal',  apodo: 'Mayra',    whatsapp: '5551020712', rol: 'front' },
  silvana:  { key: 'silvana',  nombre: 'Silvana Meza',     apodo: 'Silvana',  whatsapp: '8441222124', rol: 'front' },
  oriana:   { key: 'oriana',   nombre: 'Oriana Pullas',    apodo: 'Oriana',   whatsapp: '+17866332282', international: true, rol: 'back' },
  // CENTRO-OCCIDENTE
  rosaura:  { key: 'rosaura',  nombre: 'Rosaura Pinto',    apodo: 'Rosaura',  whatsapp: '5528996738', rol: 'front' },
  diana:    { key: 'diana',    nombre: 'Diana Castillo',   apodo: 'Diana',    whatsapp: '5554794875', rol: 'back' },
  // SUR + LATAM
  balam:    { key: 'balam',    nombre: 'Balam Hernández',  apodo: 'Balam',    whatsapp: '5541947449', rol: 'front' },
  paola:    { key: 'paola',    nombre: 'Paola Torres',     apodo: 'Paola',    whatsapp: '5534599531', rol: 'back' },
};

// ── Zonas (round-robin por carga DENTRO de la zona, en actions.js) ───────────
//
// Sustituye a las 4 "duplas" A/B/C/D: ahora son 3 equipos de tamaño distinto
// (NORTE 4 · CENTRO 2 · SUR 2), así que el picker ya no puede asumir parejas.
//
// `rol` (coord/front/back) es informativo: HOY no altera el ruteo — el
// round-robin mira solo la carga de leads. Si el equipo quiere que la primera
// asignación caiga siempre en un FRONT y el BACK entre como respaldo, ese es un
// cambio aparte en pickAdvisorRoundRobin y en el SLA.
export const ZONAS = {
  NORTE:  { key: 'NORTE',  advisors: ['enrique', 'mayra', 'silvana', 'oriana'] },
  CENTRO: { key: 'CENTRO', advisors: ['rosaura', 'diana'] },
  SUR:    { key: 'SUR',    advisors: ['balam', 'paola'] },
};

// Orden fijo para la cadena de reasignación del SLA (advisor-sla.js).
export const ZONA_ORDER = ['NORTE', 'CENTRO', 'SUR'];

// CDMX no pertenece a una sola zona: el organigrama la reparte entre NORTE (11
// colegios) y CENTRO-OCCIDENTE (14). Como el bot necesita una regla
// determinista por lead, resolveZona devuelve este centinela y actions.js
// ALTERNA entre los dos equipos según quién lleve menos leads de CDMX.
export const CDMX_SENTINEL = 'CDMX';
export const CDMX_ZONAS = ['NORTE', 'CENTRO'];
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

// ── Estados de la República → zona ──────────────────────────────────────────
// Los 31 estados + CDMX, tal como los reparte el organigrama de equipos.
// CDMX NO está aquí: se resuelve aparte (ver CDMX_SENTINEL).
const STATE_TO_ZONA = {
  // NORTE
  'baja california': 'NORTE', 'baja california sur': 'NORTE', 'sonora': 'NORTE',
  'chihuahua': 'NORTE', 'sinaloa': 'NORTE', 'coahuila': 'NORTE', 'nuevo leon': 'NORTE',
  'tamaulipas': 'NORTE', 'durango': 'NORTE', 'zacatecas': 'NORTE', 'san luis potosi': 'NORTE',
  // CENTRO-OCCIDENTE  (Edo. de México entra aquí: 34 colegios, el bloque más grande)
  'hidalgo': 'CENTRO', 'queretaro': 'CENTRO', 'guanajuato': 'CENTRO', 'jalisco': 'CENTRO',
  'aguascalientes': 'CENTRO', 'nayarit': 'CENTRO', 'colima': 'CENTRO', 'michoacan': 'CENTRO',
  'tlaxcala': 'CENTRO', 'edomex': 'CENTRO', 'puebla': 'CENTRO', 'morelos': 'CENTRO',
  // SUR
  'guerrero': 'SUR', 'oaxaca': 'SUR', 'veracruz': 'SUR', 'tabasco': 'SUR', 'chiapas': 'SUR',
  'campeche': 'SUR', 'yucatan': 'SUR', 'quintana roo': 'SUR',
};

// ── Países de LATAM → zona ──────────────────────────────────────────────────
// El equipo SUR atiende además la cartera internacional ("SUR + LATAM"). Antes
// TODO lead extranjero caía en handleForeignFallback y solo recibía el link de
// agenda, sin asignarse a nadie. Estos países ya se rutean como cualquier lead
// nacional; el resto del mundo sigue con el fallback.
const CDMX_ALCALDIAS = new Set([
  'alvaro obregon', 'benito juarez', 'iztacalco', 'coyoacan', 'tlalpan', 'cuajimalpa',
  'magdalena contreras', 'milpa alta', 'tlahuac', 'iztapalapa', 'xochimilco',
  'miguel hidalgo', 'cuauhtemoc', 'venustiano carranza', 'azcapotzalco', 'gustavo a madero',
]);

const COUNTRY_TO_ZONA = {
  'venezuela': 'SUR', 'costa rica': 'SUR', 'colombia': 'SUR',
  'chile': 'SUR', 'ecuador': 'SUR', 'brasil': 'SUR',
};

/**
 * Resuelve la ZONA a partir de estado/país + municipio.
 *
 * Reglas:
 *  - CDMX → devuelve el centinela 'CDMX': la reparte actions.js alternando
 *    entre NORTE y CENTRO. Ya NO depende de la alcaldía, así que un lead de
 *    CDMX que no la dijo también se rutea (antes caía al fallback extranjero).
 *  - Edo. de México → CENTRO (cualquier municipio, listado o no).
 *  - Estado de la República reconocido → su zona.
 *  - País de LATAM reconocido → SUR.
 *
 * @returns {'NORTE'|'CENTRO'|'SUR'|'CDMX'|null} null = sin match (lead de otro
 *   país o sin ubicación). El caller aplica handleForeignFallback.
 */
export function resolveZona(state, municipality) {
  const s = canon(state);
  const m = canon(municipality);

  if (s === 'cdmx') return CDMX_SENTINEL;
  if (s === 'edomex') return 'CENTRO';
  if (s && STATE_TO_ZONA[s]) return STATE_TO_ZONA[s];
  if (s && COUNTRY_TO_ZONA[s]) return COUNTRY_TO_ZONA[s];

  // Solo municipio: si es una alcaldía de CDMX, se infiere CDMX. La lista de
  // alcaldías sobrevive SOLO para esto — ya no decide zona por sí misma.
  if (!s && m && CDMX_ALCALDIAS.has(m)) return CDMX_SENTINEL;

  // Algunos capturan el país en el campo de municipio ("ciudad: Caracas").
  if (!s && m && COUNTRY_TO_ZONA[m]) return COUNTRY_TO_ZONA[m];

  return null;
}

/**
 * @param {'NORTE'|'CENTRO'|'SUR'} zonaKey
 * @returns {Array<Object>} los asesores de la zona, en orden (2 o 4).
 */
export function zonaAdvisors(zonaKey) {
  const zona = ZONAS[zonaKey];
  if (!zona) return [];
  return zona.advisors.map((k) => ADVISORS[k]);
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
