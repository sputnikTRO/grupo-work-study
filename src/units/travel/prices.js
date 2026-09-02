/**
 * Travel (Miri) — Lector de la hoja viva de precios por colegio
 *
 * Fuente: spreadsheet "Colegios Inscritos English 4 Life 2027"
 * (TRAVEL_PRICES_SHEETS_ID), pestaña "CONDICIONES POLÍTICAS". Es la hoja que
 * mantiene el equipo comercial; NO es la pestaña `Precios` del spreadsheet
 * principal (esa trae un solo tier y quedó atrás).
 *
 * Layout real de la hoja (verificado en vivo):
 *   fila 1: título de tramos — "CON PAGO COMPLETO ... 31 DE MARZO 2027" (col A)
 *           y "ABRIL - JUNIO (CON APARTADO DE 15K)" (col F)
 *   fila 2: encabezados — INSTITUTO | DESTINO | MODALIDAD | PRECIO PROGRAMA |
 *           PRECIO VUELO | PRECIO PROGRAMA | PRECIO VUELO
 *   filas 3+: un colegio por fila
 *
 * Columnas:
 *   A INSTITUTO · B DESTINO · C MODALIDAD
 *   D/E → tier "pago completo"  (progCompleto / vueloCompleto)
 *   F/G → tier "apartado 15K"   (progApartado / vueloApartado)
 *   H   → tier ÚNICO "AGOSTO – SEPTIEMBRE 2027", precio con VUELO INCLUIDO
 *         (precioUnico) — un solo número, no el par programa+vuelo.
 *
 * La hoja trae un SEGUNDO bloque, con su propio encabezado, para los colegios que
 * cotizan con ese tier único (Instituto Internacional y UMIN): sus columnas D–G
 * están vacías y el precio vive en H.
 *
 * Cache: en memoria con TTL (SHEETS_CACHE_TTL_SECONDS) + último resultado bueno
 * como respaldo. No usa Redis a propósito: son ~20 filas que cambian poco y así
 * el módulo no agrega dependencias nuevas al camino del mensaje.
 */

import { readRange } from '../../core/sheets/client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

const TAB = 'CONDICIONES POLÍTICAS';
const RANGE = `'${TAB}'!A:H`;
const TTL_MS = (env.SHEETS_CACHE_TTL_SECONDS || 3600) * 1000;

let cache = { rows: null, at: 0 };
let lastGood = null; // respaldo si la hoja falla después de haber cargado bien

/** "34990" → 34990 · "-" / "" / null → null. Nunca lanza. */
function parseMoney(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/** Quita acentos/puntuación y colapsa espacios, para comparar nombres de colegio. */
export function normalizeSchool(name) {
  return (name || '')
    .toString()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Esta fila es un encabezado o un título de tramo, en vez de un colegio? */
function isHeaderRow(row) {
  const a = normalizeSchool(row[0]);
  return !a || a === 'instituto' || a.startsWith('con pago completo') || a.startsWith('abril');
}

function parseRow(row) {
  const colegio = String(row[0] || '').trim();
  return {
    colegio,
    colegioNorm: normalizeSchool(colegio),
    destino: String(row[1] || '').trim(),
    modalidad: String(row[2] || '').trim(),
    progCompleto: parseMoney(row[3]),
    vueloCompleto: parseMoney(row[4]),
    progApartado: parseMoney(row[5]),
    vueloApartado: parseMoney(row[6]),
    precioUnico: parseMoney(row[7]),
  };
}

/**
 * ¿La fila tiene al menos un tier con precio de programa? Solo entonces el
 * colegio se considera REGISTRADO y Miri puede cotizar.
 */
export function isQuotable(entry) {
  return Boolean(entry && (entry.progCompleto !== null || entry.progApartado !== null || entry.precioUnico !== null));
}

/**
 * ¿Este colegio cotiza con el tier ÚNICO (un solo precio, vuelo incluido)?
 * Se distingue de Columbia, que también es un precio único pero en modalidad
 * hotel y con su propio nodo.
 */
export function isSinglePrice(entry) {
  return Boolean(entry && entry.precioUnico !== null && entry.progCompleto === null && entry.progApartado === null);
}

/** Modalidad hotel (Columbia): precio plano con vuelo incluido, sin dos tiers. */
export function isAllInclusiveHotel(entry) {
  return Boolean(entry && entry.modalidad.toLowerCase() === 'hotel');
}

/**
 * Carga y cachea todas las filas de la hoja.
 * @returns {Promise<Array<Object>>} entradas parseadas ([] si la hoja no carga y no hay respaldo)
 */
export async function getAllPrices() {
  const log = logger.child({ unit: 'travel', fn: 'prices.getAllPrices' });

  if (cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;

  try {
    const values = await readRange(env.TRAVEL_PRICES_SHEETS_ID, RANGE);
    const entries = values.filter((r) => r && r.length && !isHeaderRow(r)).map(parseRow);

    cache = { rows: entries, at: Date.now() };
    lastGood = entries;
    log.debug({ count: entries.length }, 'Hoja de precios cargada');
    return entries;
  } catch (error) {
    log.error({ err: error }, 'Error leyendo la hoja de precios — se usa el último resultado bueno si existe');
    return lastGood || [];
  }
}

/** ¿La modalidad de esta fila corresponde a Winter Break? */
export function isWinterBreakRow(entry) {
  return normalizeSchool(entry.modalidad).includes('winter break');
}

/**
 * Busca la fila de precios de un colegio.
 *
 * Un mismo colegio puede tener VARIAS filas, una por producto/destino (UMIN
 * aparece como Dublín/Homestay y como Londres/Winter Break). Por eso el match no
 * puede ser solo por nombre: se desambigua con el producto que el prospecto ya
 * eligió en el menú (lead.programInterest) y, si hace falta, con el destino.
 *
 * Si tras filtrar sigue habiendo más de una fila candidata, devuelve null a
 * propósito: mejor caer al nodo que deriva que cotizarle el viaje equivocado.
 *
 * @param {string} schoolName - Nombre capturado del colegio
 * @param {{producto?: string, destino?: string}} [hints]
 * @returns {Promise<Object|null>}
 */
export async function findSchoolPrices(schoolName, hints = {}) {
  const needle = normalizeSchool(schoolName);
  if (!needle || needle === 'otro') return null;

  const entries = await getAllPrices();

  // 1) Candidatas por nombre: exacto primero, luego contención en ambos sentidos
  //    (el papá escribe "The Hills" y la hoja dice "Colegio The Hills Institute").
  let candidatas = entries.filter((e) => e.colegioNorm === needle);
  if (candidatas.length === 0) {
    candidatas = entries.filter((e) => e.colegioNorm.includes(needle) || needle.includes(e.colegioNorm));
  }
  if (candidatas.length <= 1) return candidatas[0] || null;

  // 2) Desambiguar por producto: Winter Break vs el resto.
  const producto = normalizeSchool(hints.producto);
  if (producto.includes('winter break')) {
    const wb = candidatas.filter(isWinterBreakRow);
    if (wb.length) candidatas = wb;
  } else if (producto) {
    const noWb = candidatas.filter((e) => !isWinterBreakRow(e));
    if (noWb.length) candidatas = noWb;
  }
  if (candidatas.length === 1) return candidatas[0];

  // 3) Desambiguar por destino (Londres / Dublín).
  const destino = normalizeSchool(hints.destino);
  if (destino) {
    const porDestino = candidatas.filter((e) => normalizeSchool(e.destino).includes(destino) || destino.includes(normalizeSchool(e.destino)));
    if (porDestino.length === 1) return porDestino[0];
    if (porDestino.length) candidatas = porDestino;
  }

  // 4) Sigue ambiguo → no se cotiza; el motor deriva.
  return candidatas.length === 1 ? candidatas[0] : null;
}

/** Solo para tests: limpia el cache en memoria. */
export function __resetCache() {
  cache = { rows: null, at: 0 };
  lastGood = null;
}
