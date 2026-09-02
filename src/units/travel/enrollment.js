/**
 * Travel (Miri) — Consulta de inscritos y estatus de pago
 *
 * Fuente: spreadsheet "English 4 Life 2027 - INSCRITOS" (TRAVEL_ENROLLMENT_SHEETS_ID),
 * que el equipo mantiene al día. Los datos viven en DOS mitades separadas:
 *
 *   1. "REGISTRO GENERAL " — volcado del formulario de registro (839 filas). Es la
 *      ÚNICA pestaña con el WhatsApp del papá (columna "Celular / Whatsapp:"), más
 *      nombre del alumno, nombre del papá y colegio. NO tiene datos de pago.
 *   2. "INSCRITOS <destino> <colegio> <precio>" (17 pestañas) — el estatus de pago
 *      por alumno: TOTAL A PAGAR, LLEVAN PAGADO, FALTA POR PAGAR. NO tienen
 *      teléfono ni nombre del papá; el único puente es el NOMBRE DEL ALUMNO.
 *
 * De ahí el diseño: teléfono → alumno(s) en el registro → fila de pago por nombre.
 *
 * SEGURIDAD (son datos financieros de familias, con menores de por medio):
 *   - El match de teléfono es por los ÚLTIMOS 10 DÍGITOS en AMBOS lados. WhatsApp
 *     entrega 521XXXXXXXXXX y la hoja guarda 10 dígitos (806 de 838), a veces con
 *     +52, espacios o guiones; normalizar los dos lados es obligatorio.
 *   - El estatus SOLO se devuelve cuando el match alumno→fila de pago es
 *     INEQUÍVOCO (exactamente una fila). Cero filas → 'sin_pagos'. Dos o más →
 *     'ambiguo', y el llamador NO debe mostrar nada financiero: deriva a asesora.
 *   - Nunca se devuelven datos de un teléfono distinto al que escribe.
 *
 * Las posiciones de columna cambian entre pestañas (ALUMNO está en C o D, LLEVAN
 * PAGADO va de la X a la AH), así que TODO se mapea por NOMBRE de encabezado.
 */

import { readRange, getSpreadsheetMetadata } from '../../core/sheets/client.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

const REGISTRO_TAB_HINT = 'registro general';
const PAYMENT_TAB_RE = /^\s*inscritos/i;
const TTL_MS = (env.SHEETS_CACHE_TTL_SECONDS || 3600) * 1000;

// Encabezados del registro, buscados por PREFIJO normalizado (los del formulario
// son larguísimos: "Nombre completo del estudiante (Nombre, segundo nombre, …)").
const REG_COLS = {
  alumno: 'nombre completo del estudiante',
  colegio: 'nombre del colegio',
  papa: 'nombre completo (nombre',
  telefono: 'celular / whatsapp',
};

// Encabezados de las pestañas de pago, por nombre exacto normalizado.
const PAY_COLS = {
  alumno: 'alumno',
  institucion: 'institucion',
  total: 'total a pagar',
  pagado: 'llevan pagado',
  falta: 'falta por pagar',
};

let cache = { at: 0, data: null };

/** Normaliza texto: sin acentos, minúsculas, espacios colapsados. */
export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Últimos 10 dígitos de un teléfono, que es la forma en que ambos lados coinciden:
 * WhatsApp manda 521XXXXXXXXXX y la hoja guarda XXXXXXXXXX (o +52 XX XXXX XXXX).
 * Devuelve null si no hay 10 dígitos utilizables.
 */
export function phoneKey(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Índice de encabezados → posición, por prefijo normalizado. */
function indexHeaders(headerRow, spec, byPrefix) {
  const norm = (headerRow || []).map((h) => normalizeName(h));
  const out = {};
  for (const [key, needle] of Object.entries(spec)) {
    const i = byPrefix
      ? norm.findIndex((h) => h.startsWith(normalizeName(needle)))
      : norm.indexOf(normalizeName(needle));
    if (i >= 0) out[key] = i;
  }
  return out;
}

/**
 * Carga (y cachea) las dos mitades del spreadsheet.
 * @returns {Promise<{registro: Array, pagos: Array}>} vacío si la hoja no carga
 */
async function loadIndex() {
  const log = logger.child({ unit: 'travel', fn: 'enrollment.loadIndex' });
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    const id = env.TRAVEL_ENROLLMENT_SHEETS_ID;
    const meta = await getSpreadsheetMetadata(id);
    const titles = meta.sheets.map((s) => s.title);

    // El nombre real trae un espacio al final ("REGISTRO GENERAL "), así que se
    // busca por prefijo normalizado en vez de por igualdad exacta.
    const regTab = titles.find((t) => normalizeName(t).startsWith(REGISTRO_TAB_HINT));
    const payTabs = titles.filter((t) => PAYMENT_TAB_RE.test(t));

    const registro = [];
    if (regTab) {
      const rows = await readRange(id, `'${regTab}'`);
      const idx = indexHeaders(rows[0], REG_COLS, true);
      if (idx.telefono === undefined || idx.alumno === undefined) {
        log.error({ regTab, idx }, 'REGISTRO GENERAL sin columnas de teléfono/alumno — consulta deshabilitada');
      } else {
        for (const r of rows.slice(1)) {
          const key = phoneKey(r[idx.telefono]);
          const alumno = String(r[idx.alumno] ?? '').trim();
          if (!key || !alumno) continue;
          registro.push({
            phoneKey: key,
            alumno,
            alumnoNorm: normalizeName(alumno),
            papa: String(r[idx.papa] ?? '').trim(),
            colegio: String(r[idx.colegio] ?? '').trim(),
          });
        }
      }
    } else {
      log.error({ titles: titles.length }, 'No se encontró la pestaña de registro');
    }

    const pagos = [];
    for (const tab of payTabs) {
      const rows = await readRange(id, `'${tab}'`);
      if (!rows.length) continue;
      const idx = indexHeaders(rows[0], PAY_COLS, false);
      if (idx.alumno === undefined) continue; // pestaña sin la columna puente
      for (const r of rows.slice(1)) {
        const alumno = String(r[idx.alumno] ?? '').trim();
        if (!alumno) continue;
        pagos.push({
          tab,
          alumno,
          alumnoNorm: normalizeName(alumno),
          institucion: idx.institucion !== undefined ? String(r[idx.institucion] ?? '').trim() : '',
          total: idx.total !== undefined ? String(r[idx.total] ?? '').trim() : '',
          pagado: idx.pagado !== undefined ? String(r[idx.pagado] ?? '').trim() : '',
          falta: idx.falta !== undefined ? String(r[idx.falta] ?? '').trim() : '',
        });
      }
    }

    cache = { at: Date.now(), data: { registro, pagos } };
    log.info({ registro: registro.length, pagos: pagos.length, payTabs: payTabs.length }, 'Índice de inscritos cargado');
    return cache.data;
  } catch (error) {
    log.error({ err: error }, 'Error leyendo la hoja de inscritos — se responde como "no encontrado"');
    return cache.data || { registro: [], pagos: [] };
  }
}

/**
 * Alumnos registrados con ESE teléfono. Un mismo papá puede tener varios hijos
 * (67 teléfonos del registro tienen 2+; uno llega a 4).
 *
 * @param {string} phone - Teléfono del que escribe (E.164, con o sin +)
 * @returns {Promise<Array<{alumno, papa, colegio}>>} en el orden de la hoja
 */
export async function findStudentsByPhone(phone) {
  const key = phoneKey(phone);
  if (!key) return [];
  const { registro } = await loadIndex();

  // De-duplica por nombre de alumno: el formulario a veces tiene reenvíos.
  const seen = new Set();
  return registro.filter((r) => {
    if (r.phoneKey !== key || seen.has(r.alumnoNorm)) return false;
    seen.add(r.alumnoNorm);
    return true;
  });
}

/**
 * Estatus de pago de UN alumno, por nombre.
 *
 * @param {string} studentName
 * @returns {Promise<{estado:'ok'|'sin_pagos'|'ambiguo', pago?:Object}>}
 *   'ok'        → exactamente una fila de pago (única forma de mostrar montos)
 *   'sin_pagos' → registrado pero sin fila en ninguna pestaña de pagos
 *   'ambiguo'   → 2+ filas coinciden; NUNCA mostrar montos, derivar
 */
export async function findPaymentByStudent(studentName) {
  const needle = normalizeName(studentName);
  if (!needle) return { estado: 'ambiguo' };

  const { pagos } = await loadIndex();
  const matches = pagos.filter((p) => p.alumnoNorm === needle);

  if (matches.length === 0) return { estado: 'sin_pagos' };
  if (matches.length > 1) return { estado: 'ambiguo' };
  return { estado: 'ok', pago: matches[0] };
}

/**
 * Resuelve el caso completo para el teléfono que escribe.
 *
 * @param {string} phone
 * @returns {Promise<{caso:string, alumnos?:Array, alumno?:Object, pago?:Object}>}
 *   'no_registrado' → el teléfono no está en el registro
 *   'elegir_hijo'   → 2+ alumnos con ese teléfono; hay que preguntar cuál
 *   'sin_pagos'     → registrado, sin fila de pagos (o match ambiguo → mismo trato seguro)
 *   'con_pagos'     → un alumno, una fila de pago inequívoca
 */
export async function resolveEnrollment(phone) {
  const alumnos = await findStudentsByPhone(phone);
  if (alumnos.length === 0) return { caso: 'no_registrado' };
  if (alumnos.length > 1) return { caso: 'elegir_hijo', alumnos };

  return await resolveForStudent(alumnos[0]);
}

/**
 * Estatus para un alumno ya elegido. Un match ambiguo se trata IGUAL que "sin
 * pagos" de cara al prospecto (no se muestra nada financiero), pero se marca
 * aparte para que la asesora sepa que hay filas duplicadas que revisar.
 */
export async function resolveForStudent(alumno) {
  const res = await findPaymentByStudent(alumno.alumno);
  if (res.estado === 'ok') return { caso: 'con_pagos', alumno, pago: res.pago };
  return { caso: 'sin_pagos', alumno, ambiguo: res.estado === 'ambiguo' };
}

/** Formatea un monto de la hoja ("64,990.00" / "64990") como "$64,990". */
export function formatMoney(raw) {
  const digits = String(raw ?? '').replace(/[^\d.]/g, '');
  if (!digits) return null;
  const n = Math.round(parseFloat(digits));
  return Number.isFinite(n) ? `$${n.toLocaleString('es-MX')}` : null;
}

/** Solo para tests: limpia el cache en memoria. */
export function __resetCache() {
  cache = { at: 0, data: null };
}
