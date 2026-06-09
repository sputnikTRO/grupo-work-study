import logger from '../../utils/logger.js';
import * as oxfordLeadService from './lead.service.js';

/**
 * Oxford Education action tags
 *
 * The model embeds tags in its reply; we parse them, run side effects, and strip
 * them from the text the prospect sees.
 *   [DERIVAR_ASESOR:motivo]        → soft handoff: mark the lead + signal the
 *                                    handler to append the Calendly link (the
 *                                    conversation stays ACTIVE so Ori keeps replying)
 *   [CAPTURAR_DATO:campo:valor]    → persist a captured field on the OxfordLead
 */

const ACTION_PATTERNS = {
  DERIVAR_ASESOR: /\[DERIVAR_ASESOR:([^\]]+)\]/g,
  CAPTURAR_DATO: /\[CAPTURAR_DATO:([^:\]]+):([^\]]+)\]/g,
};

// Lead columns the model is allowed to write, mapped from snake_case tag fields.
const CAPTURE_FIELD_MAP = {
  full_name: 'fullName',
  role: 'role',
  lead_type: 'leadType',
  primary_product: 'primaryProduct',
  institution_name: 'institutionName',
  institution_type: 'institutionType',
  estimated_students: 'estimatedStudents',
  school_cycle: 'schoolCycle',
};

const VALID_LEAD_TYPES = ['b2b_institutional', 'b2c_individual'];
const VALID_PRODUCTS = [
  'oxford_tcc',
  'oxford_tcc_kids',
  'english_teaching_certificate',
  'alphable',
  'oxford_life',
  'rising_stars',
  'work_study_spain',
];

/**
 * Parses action tags from the model response.
 * @param {string} response - Raw Claude response
 * @returns {Array<Object>} Parsed actions
 */
export function parseActions(response) {
  const actions = [];

  for (const match of response.matchAll(ACTION_PATTERNS.DERIVAR_ASESOR)) {
    actions.push({ type: 'DERIVAR_ASESOR', reason: match[1].trim() });
  }

  for (const match of response.matchAll(ACTION_PATTERNS.CAPTURAR_DATO)) {
    actions.push({ type: 'CAPTURAR_DATO', field: match[1].trim(), value: match[2].trim() });
  }

  return actions;
}

/**
 * Removes all action tags from the response so they never reach the prospect.
 * @param {string} response - Raw Claude response
 * @returns {string} Clean text
 */
export function cleanResponse(response) {
  return response
    .replace(ACTION_PATTERNS.DERIVAR_ASESOR, '')
    .replace(ACTION_PATTERNS.CAPTURAR_DATO, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Maps a captured tag field/value to a validated Prisma update fragment.
 * @returns {Object|null} e.g. { primaryProduct: 'oxford_tcc' } or null if invalid
 */
function buildLeadUpdate(field, value) {
  const column = CAPTURE_FIELD_MAP[field];
  if (!column) return null;

  if (column === 'leadType') {
    return VALID_LEAD_TYPES.includes(value) ? { leadType: value } : null;
  }
  if (column === 'primaryProduct') {
    if (!VALID_PRODUCTS.includes(value)) return null;
    // Mirror into products_interest so the array stays useful for reporting.
    return { primaryProduct: value, productsInterest: [value] };
  }
  if (column === 'estimatedStudents') {
    const n = parseInt(value.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? { estimatedStudents: n } : null;
  }
  return { [column]: value };
}

/**
 * Executes parsed actions: captures data and marks the soft Calendly handoff.
 *
 * The handoff does NOT send a message or park the conversation here — it only
 * updates the lead and signals the handler (via `handoffOccurred`) to append the
 * Calendly link to Ori's reply. The conversation stays active so Ori keeps
 * responding to follow-up questions (e.g. pricing) after the link is shared.
 *
 * @param {Array<Object>} actions - From parseActions
 * @param {Object} lead - OxfordLead
 * @returns {Promise<{handoffOccurred: boolean}>}
 */
export async function executeActions(actions, lead) {
  let handoffOccurred = false;

  for (const action of actions) {
    try {
      if (action.type === 'CAPTURAR_DATO') {
        const update = buildLeadUpdate(action.field, action.value);
        if (update) {
          await oxfordLeadService.updateOxfordLead(lead.id, update);
          Object.assign(lead, update);
          logger.info({ unit: 'oxford_education', leadId: lead.id, update }, 'Oxford lead data captured');
        } else {
          logger.warn({ unit: 'oxford_education', field: action.field, value: action.value }, 'Ignored invalid CAPTURAR_DATO');
        }
      }

      if (action.type === 'DERIVAR_ASESOR') {
        handoffOccurred = true;
        await markHandoff(lead, action.reason);
      }
    } catch (error) {
      logger.error({ err: error, unit: 'oxford_education', action }, 'Error executing Oxford action');
    }
  }

  return { handoffOccurred };
}

/**
 * Records the soft handoff on the lead. Keeps the conversation active so Ori
 * continues replying; the handler appends the Calendly link to her message.
 */
async function markHandoff(lead, reason) {
  const update = {
    status: 'interesado',
    notes: reason ? `Derivación: ${reason}` : 'Compartió agenda Calendly',
  };
  await oxfordLeadService.updateOxfordLead(lead.id, update);
  Object.assign(lead, update); // keep in-memory lead in sync (temperature/sheet logging)

  logger.info({ unit: 'oxford_education', leadId: lead.id, reason }, 'Oxford soft handoff: lead marked, conversation stays active');
}
