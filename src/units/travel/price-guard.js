/**
 * Travel (Miri) — qué conocimiento con MONTOS ve el LLM
 *
 * Regla de negocio: Miri solo cotiza a colegios REGISTRADOS. Con colegio "otro"
 * o sin colegio siempre deriva a asesora, incluido el precio del vuelo.
 *
 * La sección de precios por viaje ya se omitía para esos prospectos
 * (knowledge.js → buildTripsSection), pero Info General y la FAQ se inyectaban
 * completas, y ahí vive "¿Cuánto cuesta el vuelo?" ("$35,000 a $37,000"): el LLM
 * lo citaba aunque el prompt lo prohibiera. Si el dato no está en el prompt, no
 * hay forma de que lo diga.
 *
 * Se filtra por el CONTENIDO, no por el título de la fila: la FAQ la edita el
 * cliente en Sheets y una pregunta nueva con precio tiene que quedar fuera
 * igual. Puro, sin dependencias, para poder probarlo contra filas reales
 * (tests/units/travel/price-guard.test.js).
 *
 * Qué cuenta como dinero (y solo eso):
 *   - "$", "£" o "€" seguido de cifra ........... "$35,000", "$ 294", "£20"
 *   - cifra + moneda ............................ "1500 pesos", "20 mil MXN", "16 libras", "50 euros"
 *   - cifra + "mil" ............................. "20 mil"
 *   - cifra con separador de miles .............. "64,990", "15,000.00"
 *   - cifra justo después de una palabra de precio  "precio: 42990", "apartado de 15000"
 * Qué NO, aunque tenga números: fechas y años, edades, duraciones ("48 horas",
 * "3 semanas"), horarios, teléfonos, noches, viajeros/alumnos, porcentajes.
 */

// Lo que viene DESPUÉS de una cifra y la vuelve un conteo o una medida, no dinero.
const NOT_MONEY_UNIT = String.raw`(?!\s*(?:%|a[ñn]os?|mes(?:es)?|semanas?|d[ií]as?|noches?|horas?|hrs?\b|minutos?|min\b|segundos?|km\b|kil[oó]metros?|metros?|alumn[oa]s?|estudiantes?|viajer[oa]s?|personas?|familias?|ni[ñn][oa]s?|j[oó]venes|participantes?|lugares|plazas|recursos|actividades|p[aá]ginas?|:\d))`;

const RULES = [
  { id: 'signo_moneda', re: /[$£€]\s?\d/ },
  { id: 'moneda', re: /\d[\d.,]*\s*(?:mil\s+)?(?:pesos|mxn|usd|d[oó]lares|euros?|libras(?:\s+esterlinas)?)(?![a-záéíóúñ])/i },
  { id: 'mil', re: new RegExp(String.raw`(?<![\d.,])\d{1,3}\s+mil(?![a-záéíóúñ])${NOT_MONEY_UNIT}`, 'i') },
  { id: 'separador_miles', re: new RegExp(String.raw`(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?![\d,])${NOT_MONEY_UNIT}`) },
  {
    id: 'palabra_de_precio',
    // La PRIMERA cifra tras la palabra de precio (sin otro número en medio),
    // que no sea un año (19xx/20xx) ni vaya seguida de una unidad de tiempo o conteo.
    re: new RegExp(String.raw`(?:precios?|costos?|cuestan?|tarifas?|inversi[oó]n|apartados?|anticipos?|pagos?\s+(?:inicial|m[ií]nimo))(?![a-záéíóúñ])[^\d.\n]{0,25}(?<![\d.,])(?!(?:19|20)\d{2}(?!\d))\d[\d.,]*${NOT_MONEY_UNIT}`, 'i'),
  },
];

/**
 * ¿El texto menciona un monto de dinero? Devuelve el id de la regla que casó
 * (útil para revisar por qué se filtró una fila) o null.
 * @param {string} text
 * @returns {string|null}
 */
export function moneyRule(text) {
  const t = String(text ?? '');
  return RULES.find((r) => r.re.test(t))?.id ?? null;
}

/**
 * EXENCIÓN — costos de TERCEROS que no son una cotización nuestra: se le
 * muestran completos también a un prospecto sin colegio registrado, porque son
 * información de trámite/viaje, no el precio del programa.
 *
 * Va por PREGUNTA (columna "Título"), no por monto: una fila exenta conserva
 * todas sus cifras, y cualquier fila nueva con dinero se sigue filtrando.
 * Si el cliente renombra una de estas preguntas en el Sheet, deja de estar
 * exenta y se filtra (el lado seguro) — hay que actualizar esta lista.
 *
 * Se siguen filtrando: programa, apartado, pago inicial, cancelación, vuelo,
 * los extras 2026 (London Eye, Harry Potter, París) y el formato SAM.
 */
const THIRD_PARTY_COST_TITLES = [
  '¿Cómo funciona la ETA?',                          // TODOS — permiso de viaje UK, 16 libras
  'ETA (Electronic Travel Authorization)',           // LON2027 — ídem
  '¿Se necesita visa para Rising Stars?',            // WIN2027-PS / WIN2027-PH — ETA, 16 libras
  '¿Cuánto deben considerar para gastos adicionales?', // TODOS — gasto personal, £20 por día
  'Información financiera recomendada',              // LON2027 / DUB2027 — efectivo, 50 libras / 50 euros
];

const titleKey = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const EXEMPT = new Set(THIRD_PARTY_COST_TITLES.map(titleKey));

/** ¿La fila es un costo de terceros exento del filtro? */
export function isThirdPartyCost(row) {
  return EXEMPT.has(titleKey(row?.['Título']));
}

/**
 * Filas de Info General / FAQ aptas para un prospecto SIN colegio registrado:
 * las que no mencionan ningún monto, más las exentas de arriba.
 *
 * @param {Array<Object>} rows - filas con 'Título' y 'Contenido'
 * @returns {Array<Object>}
 */
export function withoutAmounts(rows) {
  return (rows || []).filter((r) => isThirdPartyCost(r) || !moneyRule(`${r['Título'] ?? ''} ${r['Contenido'] ?? ''}`));
}
