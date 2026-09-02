/**
 * Travel (Miri) — Registro de asesoras y carruseles de derivación
 *
 * ÚNICA FUENTE DE VERDAD para asesoras de Travel. Antes estaban duplicadas entre
 * actions.js (catálogo con acentos) y advisor-commands.js (por teléfono), lo que
 * provocaba que un lead asignado con el nombre del Sheet ("Camila Serafin", sin
 * acento) no contara para el balanceo ni apareciera en PENDIENTES. Ahora ambos
 * leen de aquí, igual que oxford-education/advisor-zones.js.
 *
 * Ruteo por PRODUCTO (no por colegio del Sheet, no por zona):
 *   - English 4 Life y Winter Break, contacto vía COLEGIO  → carrusel 'colegio' (3)
 *   - English 4 Life y Winter Break, familia/estudiante     → 'familia' (Camila)
 *   - Rising Stars (colegios y familias)                    → 'rising_stars' (3)
 *
 * No hay rol admin (mismo criterio que oxford-education/advisor-zones.js): en
 * PENDIENTES cada asesora ve solo sus propios leads; la vista total del equipo
 * vive en la pestaña Leads del Sheet.
 *
 * Teléfonos en formato LOCAL de 10 dígitos para México (normalizePhone agrega
 * +521). EXCEPCIÓN: Miriana es internacional (Perú, +51); se guarda con su E.164
 * completo y la bandera `international: true`, que el passthrough internacional
 * de src/utils/phone.js respeta y NO le fuerza +52.
 */

import prisma from '../../core/database/client.js';
import logger from '../../utils/logger.js';
import { normalizePhone } from '../../utils/phone.js';

// ── Registro de asesoras (clave estable interna) ─────────────────────────────
export const ADVISORS = {
  alma: { key: 'alma', nombre: 'Alma Sotelo', apodo: 'Alma', whatsapp: '5651070832' },
  victor: { key: 'victor', nombre: 'Victor Hugo Cruz', apodo: 'Victor', whatsapp: '5529412836' },
  cecilia: { key: 'cecilia', nombre: 'Cecilia Rodríguez', apodo: 'Cecy', whatsapp: '5544884437' },
  camila: { key: 'camila', nombre: 'Camila Serafín', apodo: 'Cami', whatsapp: '5539771457' },
  miriana: { key: 'miriana', nombre: 'Miriana Galdos', apodo: 'Miriana', whatsapp: '+51988847322', international: true },
  alejandra: { key: 'alejandra', nombre: 'Alejandra Najera', apodo: 'Alejandra', whatsapp: '5539552935' },
  ericka: { key: 'ericka', nombre: 'Ericka Arcos', apodo: 'Ericka', whatsapp: '5614618860' },
};

// ── Carruseles por track (round-robin por carga dentro del carrusel) ─────────
export const TRACKS = {
  colegio: ['alma', 'victor', 'cecilia'],
  familia: ['camila'],
  rising_stars: ['miriana', 'alejandra', 'ericka'],
};

/** @returns {Array<Object>} asesoras del track (vacío si el track no existe) */
export function trackAdvisors(track) {
  return (TRACKS[track] || []).map((k) => ADVISORS[k]).filter(Boolean);
}

/**
 * Resuelve el track de derivación cuando el llamador no lo especifica
 * (p. ej. el camino LLM, donde solo hay un `reason` en texto libre).
 *
 * Rising Stars gana sobre todo lo demás: su carrusel es propio y aplica tanto a
 * colegios como a familias.
 *
 * @param {Object} lead - TravelLead
 * @param {string} [reason] - Motivo de la derivación (texto libre del LLM)
 * @returns {'colegio'|'familia'|'rising_stars'}
 */
export function resolveTrack(lead, reason = '') {
  const haystack = `${reason} ${lead?.programInterest || ''} ${lead?.destination || ''}`.toLowerCase();
  if (haystack.includes('rising') || haystack.includes('windsor')) return 'rising_stars';

  const school = (lead?.schoolCode || '').trim().toLowerCase();
  if (!school || school === 'otro') return 'familia';
  return 'colegio';
}

/**
 * Round-robin dentro del track: elige la asesora con menos leads asignados.
 * Espeja pickAdvisorRoundRobin de oxford-education/actions.js pero sobre travel_leads.
 *
 * @param {'colegio'|'familia'|'rising_stars'} track
 * @param {Object} [log] - Logger child
 * @returns {Promise<Object|null>} asesora, o null si el track está vacío
 */
export async function pickAdvisor(track, log = logger) {
  const advisors = trackAdvisors(track);
  if (advisors.length === 0) return null;
  if (advisors.length === 1) return advisors[0];

  try {
    const names = advisors.map((a) => a.nombre);
    const counts = await prisma.travelLead.groupBy({
      by: ['assignedAdvisor'],
      where: { assignedAdvisor: { in: names } },
      _count: { assignedAdvisor: true },
    });
    const countFor = (name) => counts.find((r) => r.assignedAdvisor === name)?._count.assignedAdvisor ?? 0;

    let best = advisors[0];
    let bestCount = countFor(best.nombre);
    for (const a of advisors.slice(1)) {
      const c = countFor(a.nombre);
      if (c < bestCount) {
        best = a;
        bestCount = c;
      }
    }

    log?.info?.({ track, assigned: best.nombre, counts: advisors.map((a) => [a.nombre, countFor(a.nombre)]) }, 'Carrusel asignado');
    return best;
  } catch (error) {
    log?.error?.({ err: error, track }, 'Error en el carrusel, usando la primera asesora del track');
    return advisors[0];
  }
}

/** Busca una asesora por su nombre exacto tal como se guarda en el lead. */
export function advisorByName(nombre) {
  if (!nombre) return null;
  return Object.values(ADVISORS).find((a) => a.nombre === nombre) || null;
}

/**
 * Busca una asesora por teléfono normalizado sin '+'.
 * Compara los últimos 10 dígitos para México; para internacionales compara el
 * E.164 completo (Miriana llega como 51988847322, no como un local de 10).
 */
export function advisorByPhone(normalizedPhoneNoPlus) {
  const digits = String(normalizedPhoneNoPlus || '').replace(/\D/g, '');
  if (!digits) return null;

  return (
    Object.values(ADVISORS).find((a) => {
      const advDigits = normalizePhone(a.whatsapp).replace('+', '').replace(/\D/g, '');
      if (a.international) return advDigits === digits;
      return advDigits.slice(-10) === digits.slice(-10);
    }) || null
  );
}
