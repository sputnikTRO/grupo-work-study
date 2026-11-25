import axios from 'axios';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Salud de las plantillas de aviso a asesoras (Ori y Miri) en Meta.
 *
 * Por qué existe: Meta recategorizó 'nuevo_lead_oxford' de UTILITY a MARKETING y,
 * desde el 5-oct-2026, aceptaba los avisos a las asesoras (HTTP 200) pero no los
 * entregaba. Nadie se enteró en 5 semanas. Una plantilla de aviso tiene que ser
 * UTILITY y estar APPROVED; cualquier otra cosa es una alerta.
 *
 * checkAdvisorTemplates() lee de la Graph API (solo GET) las plantillas que la app
 * usa HOY (resueltas desde las mismas variables que advisor-notify.js y
 * travel/actions.js) y devuelve un hallazgo por plantilla. Nunca lanza.
 */

export const EXPECTED_CATEGORY = 'UTILITY';
export const EXPECTED_STATUS = 'APPROVED';

/** Plantillas de aviso que la app usa con la configuración actual, por WABA. */
export function advisorTemplatesInUse(e = env) {
  const oxford = (e.OXED_ADVISOR_SLA_TEMPLATE || e.OXED_ADVISOR_TEMPLATE_NAME || '').trim();
  const travel = ((e.TRAVEL_ADVISOR_TEMPLATE_V2 || '').trim() || e.TRAVEL_ADVISOR_TEMPLATE_NAME || '').trim();
  return [
    { unit: 'oxford_education', wabaId: e.OXED_WABA_ID, token: e.OXED_ACCESS_TOKEN, name: oxford },
    { unit: 'travel', wabaId: e.WA_WABA_ID, token: e.WA_ACCESS_TOKEN, name: travel },
    // Avisos de casos W&S OTCC (Karen/Jorge): se vigilan en cuanto están
    // configurados, aunque el modo siga apagado, para no prenderlo con una
    // plantilla recategorizada o pausada.
    ...[e.OXED_WS_TEMPLATE, e.OXED_WS_TEMPLATE_IMG]
      .map((n) => (n || '').trim())
      .filter(Boolean)
      .map((name) => ({ unit: 'oxford_education', wabaId: e.OXED_WABA_ID, token: e.OXED_ACCESS_TOKEN, name })),
  ];
}

/**
 * Evalúa una plantilla tal como la devuelve Meta (o null si no existe).
 * @returns {{ ok: boolean, problem: string|null }}
 */
export function evaluateTemplate(tpl) {
  if (!tpl) return { ok: false, problem: 'no existe en la WABA' };
  const problems = [];
  if (tpl.status !== EXPECTED_STATUS) problems.push(`estado ${tpl.status} (se espera ${EXPECTED_STATUS})`);
  if (tpl.category !== EXPECTED_CATEGORY) {
    problems.push(`categoría ${tpl.category} (se espera ${EXPECTED_CATEGORY}; Meta puede aceptar el envío y no entregarlo)`);
  }
  return { ok: problems.length === 0, problem: problems.join(' · ') || null };
}

/**
 * @param {Object} [opts]
 * @param {Function} [opts.http] - para tests; por default axios.get
 * @returns {Promise<Array<{unit, name, ok, problem, status?, category?, previousCategory?, quality?}>>}
 */
export async function checkAdvisorTemplates({ http = axios.get, config = env } = {}) {
  const findings = [];
  for (const t of advisorTemplatesInUse(config)) {
    if (!t.name) { findings.push({ unit: t.unit, name: '(ninguna)', ok: false, problem: 'no hay plantilla configurada' }); continue; }
    if (!t.wabaId || !t.token) { findings.push({ unit: t.unit, name: t.name, ok: null, problem: 'sin WABA ID o token: no se pudo revisar' }); continue; }
    try {
      const res = await http(`https://graph.facebook.com/${config.WA_API_VERSION || 'v21.0'}/${t.wabaId}/message_templates`, {
        headers: { Authorization: `Bearer ${t.token}` },
        params: { name: t.name, fields: 'name,status,category,previous_category,quality_score,language' },
        timeout: 15000,
      });
      const tpl = (res.data?.data || []).find((x) => x.name === t.name) || null;
      const { ok, problem } = evaluateTemplate(tpl);
      findings.push({
        unit: t.unit, name: t.name, ok, problem,
        status: tpl?.status, category: tpl?.category, previousCategory: tpl?.previous_category, quality: tpl?.quality_score?.score,
      });
    } catch (error) {
      findings.push({ unit: t.unit, name: t.name, ok: null, problem: `no se pudo consultar Meta: ${error.response?.data?.error?.message || error.message}` });
    }
  }
  return findings;
}

/** Corre el chequeo y lo deja en el log: ERROR si una plantilla está mal. Nunca lanza. */
export async function logAdvisorTemplateHealth(opts) {
  try {
    const findings = await checkAdvisorTemplates(opts);
    for (const f of findings) {
      const ctx = { unit: f.unit, template: f.name, status: f.status, category: f.category, previousCategory: f.previousCategory, quality: f.quality, problem: f.problem };
      if (f.ok === false) logger.error(ctx, 'ALERTA PLANTILLA: el aviso a asesoras puede no estar llegando');
      else if (f.ok === null) logger.warn(ctx, 'No se pudo revisar la plantilla de aviso a asesoras');
      else logger.info(ctx, 'Plantilla de aviso a asesoras OK');
    }
    return findings;
  } catch (error) {
    logger.error({ err: error }, 'Error en el chequeo de plantillas de aviso');
    return [];
  }
}
