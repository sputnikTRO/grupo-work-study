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
 * Se filtra por el CONTENIDO (cualquier monto en pesos), no por el título de
 * la fila: la FAQ la edita el cliente en Sheets y una pregunta nueva con precio
 * tiene que quedar fuera igual. Puro, sin dependencias, para poder probarlo.
 */

// "$35,000" · "$ 900" · "$10k". Un número sin "$" (edades, fechas, horas) no cuenta.
const MONEY_RE = /\$\s?\d/;

/**
 * Filas de Info General / FAQ aptas para un prospecto SIN colegio registrado:
 * las que no mencionan ningún monto.
 *
 * @param {Array<Object>} rows - filas con 'Título' y 'Contenido'
 * @returns {Array<Object>}
 */
export function withoutAmounts(rows) {
  return (rows || []).filter((r) => !MONEY_RE.test(`${r['Título'] ?? ''} ${r['Contenido'] ?? ''}`));
}
