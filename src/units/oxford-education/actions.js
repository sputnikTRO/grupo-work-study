import logger from '../../utils/logger.js';
import prisma from '../../core/database/client.js';
import { env } from '../../config/env.js';
import { normalizePhone } from '../../utils/phone.js';
import * as oxfordLeadService from './lead.service.js';
import * as messageService from '../../services/message.service.js';
import * as store from './store.js';
import { sendTextMessage, sendTemplateMessage } from './whatsapp.js';
import { HANDOFF_MEETING_URL } from './prompts.js';
import { resolveDupla, duplaAdvisors } from './advisor-zones.js';

/**
 * Oxford Education action tags
 *
 * The model embeds tags in its reply; we parse them, run side effects, and strip
 * them from the text the prospect sees.
 *   [DERIVAR_ASESOR:motivo]        → WARM handoff: resolve zone → dupla → advisor
 *                                    (round-robin), assign + notify the advisor by
 *                                    WhatsApp with a ticket, but DO NOT silence Ori
 *                                    — the conversation stays ACTIVE for general
 *                                    questions. Re-derivation is guarded (no
 *                                    duplicate ticket/notify once assigned).
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
  state: 'state',                 // Estado de la república (ruteo de asesor)
  municipality: 'municipality',   // Alcaldía/municipio (si CDMX o Edo. México)
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
 *
 * Exported (además de usarse internamente en executeActions) para que
 * flow-engine.js aplique EXACTAMENTE la misma validación/mapeo cuando el paso
 * `solicitud_datos` del flujo determinístico extrae state/municipality — así el
 * ruteo geográfico (advisor-zones.js) recibe datos con la misma forma sin
 * importar si los capturó el LLM vía [CAPTURAR_DATO] o el flujo determinístico.
 *
 * @returns {Object|null} e.g. { primaryProduct: 'oxford_tcc' } or null if invalid
 */
export function buildLeadUpdate(field, value) {
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
 * Executes parsed actions: captures data and runs the ACTIVE handoff.
 *
 * On [DERIVAR_ASESOR] the handoff resolves the prospect's zone → dupla → advisor,
 * sends the prospect a warm "te conecto" message and notifies the advisor by
 * WhatsApp with a ticket, but keeps the conversation ACTIVE (no waiting_human).
 * When a fresh handoff runs, that message is the reply for the turn, so the
 * handler must NOT send Ori's own text. Returns handoffOccurred=false when the
 * lead was already handed off (guard), so Ori replies normally (defers to advisor).
 *
 * @param {Array<Object>} actions - From parseActions
 * @param {Object} lead - OxfordLead
 * @param {Object} conv - Conversation row
 * @param {Object} contact - Contact row (for the prospect phone)
 * @returns {Promise<{handoffOccurred: boolean}>}
 */
export async function executeActions(actions, lead, conv, contact) {
  let handoffOccurred = false;

  // IMPORTANTE: aplicar TODAS las capturas ANTES de cualquier derivación. Si el
  // modelo captura y deriva en el MISMO mensaje (p.ej. [CAPTURAR_DATO:municipality:
  // Xochimilco] + [DERIVAR_ASESOR:...]), el handoff debe ver el lead ya actualizado
  // para resolver la zona; de lo contrario resolveDupla no encuentra la alcaldía y
  // cae al fallback pasivo (link de agenda) en vez del handoff tibio de zona.
  const captures = actions.filter((a) => a.type === 'CAPTURAR_DATO');
  const handoffs = actions.filter((a) => a.type === 'DERIVAR_ASESOR');

  for (const action of captures) {
    try {
      const update = buildLeadUpdate(action.field, action.value);
      if (update) {
        await oxfordLeadService.updateOxfordLead(lead.id, update);
        Object.assign(lead, update);
        logger.info({ unit: 'oxford_education', leadId: lead.id, update }, 'Oxford lead data captured');
      } else {
        logger.warn({ unit: 'oxford_education', field: action.field, value: action.value }, 'Ignored invalid CAPTURAR_DATO');
      }
    } catch (error) {
      logger.error({ err: error, unit: 'oxford_education', action }, 'Error executing Oxford CAPTURAR_DATO');
    }
  }

  for (const action of handoffs) {
    try {
      const { handedOff } = await executeHandoffToAdvisor(lead, conv, contact, action.reason);
      // Solo cuenta como handoff (y silencia el reply normal de Ori este turno)
      // cuando REALMENTE se derivó. Si el lead ya tenía asesor, handedOff=false
      // y Ori responde con su texto (difiriendo el precio al asesor).
      if (handedOff) handoffOccurred = true;
    } catch (error) {
      logger.error({ err: error, unit: 'oxford_education', action }, 'Error executing Oxford DERIVAR_ASESOR');
    }
  }

  return { handoffOccurred };
}

/**
 * Round-robin dentro de una dupla: elige al asesor con menos leads asignados.
 * Espeja el "carrusel" de Travel (assignFamilyCarousel) pero sobre oxford_leads.
 *
 * @param {'A'|'B'|'C'|'D'} duplaKey
 * @returns {Promise<Object|null>} advisor object o null si la dupla es inválida
 */
async function pickAdvisorRoundRobin(duplaKey) {
  const advisors = duplaAdvisors(duplaKey);
  if (advisors.length !== 2) return advisors[0] || null;

  try {
    const counts = await prisma.oxfordLead.groupBy({
      by: ['assignedAdvisor'],
      where: { assignedAdvisor: { in: advisors.map((a) => a.nombre) } },
      _count: { assignedAdvisor: true },
    });
    const countFor = (name) => counts.find((r) => r.assignedAdvisor === name)?._count.assignedAdvisor ?? 0;
    const c0 = countFor(advisors[0].nombre);
    const c1 = countFor(advisors[1].nombre);
    return c0 <= c1 ? advisors[0] : advisors[1];
  } catch (error) {
    logger.error({ err: error, unit: 'oxford_education', duplaKey }, 'Round-robin failed, defaulting to first advisor');
    return advisors[0];
  }
}

/**
 * [DERIVAR_ASESOR] — Handoff ACTIVO con ruteo geográfico.
 *
 * Orden:
 *  1. Resuelve dupla desde (state, municipality).
 *  2. Si no hay zona (lead internacional o sin ubicación) → fallback provisional
 *     controlado por OXED_FOREIGN_LEAD_FALLBACK (ver handleForeignFallback). TODO cliente.
 *  3. Elige asesor por round-robin dentro de la dupla.
 *  4. Persiste asesor/zona en el lead, avisa al prospecto (mensaje tibio),
 *     notifica al asesor por WhatsApp con ticket y DEJA la conversación ACTIVA.
 *
 * Exportada (antes privada) para que el CTA "¿hablar con un asesor?" del flujo
 * determinístico (flow-engine.js) dispare el MISMO handoff tibio + ruteo
 * geográfico, sin reimplementar ni un guard, en vez de duplicar esta lógica.
 * El comportamiento de la función NO cambió — solo se agregó `export`.
 */
export async function executeHandoffToAdvisor(lead, conv, contact, reason) {
  const log = logger.child({ unit: 'oxford_education', leadId: lead.id, fn: 'oxford.handoff' });

  // Guard anti-redisparo: si el lead YA tiene asesor asignado, no re-derivamos,
  // no re-notificamos ni creamos otro ticket. Ori responde dentro de sus
  // guardrails (difiere precio/cierre al asesor ya asignado; ver prompts.js).
  if (lead.assignedAdvisor) {
    log.info({ assignedAdvisor: lead.assignedAdvisor }, 'Lead already handed off — skip re-notify (Ori defers to advisor)');
    return { handedOff: false };
  }

  const duplaKey = resolveDupla(lead.state, lead.municipality);
  if (!duplaKey) {
    return handleForeignFallback(lead, conv, contact, reason, log);
  }

  const advisor = await pickAdvisorRoundRobin(duplaKey);
  if (!advisor) {
    log.warn({ duplaKey }, 'No advisor resolved for dupla, using foreign fallback');
    return handleForeignFallback(lead, conv, contact, reason, log);
  }

  // Persistir asignación en el lead. Handoff "TIBIO": NO se marca waiting_human;
  // la conversación sigue ACTIVA y Ori sigue atendiendo dudas generales.
  const leadUpdate = {
    status: 'derivado_asesor',
    assignedAdvisor: advisor.nombre,
    zoneKey: duplaKey,
    notes: reason ? `Derivación (${duplaKey}/${advisor.nombre}): ${reason}` : `Derivado a ${advisor.nombre} (${duplaKey})`,
  };
  await oxfordLeadService.updateOxfordLead(lead.id, leadUpdate);
  Object.assign(lead, leadUpdate);

  // Mensaje cálido: se le conecta con el asesor, pero Ori sigue disponible.
  const connect =
    `¡Perfecto! 😊 Te conecto con ${advisor.nombre}, asesor/a de Oxford Education LIT. ` +
    `Te escribe en breve por WhatsApp para ver precio y los siguientes pasos.\n\n` +
    `Mientras tanto, aquí sigo para cualquier otra duda. 🌎`;
  await sendTextMessage(contact.phone, connect);
  await messageService.createOutbound(conv.id, connect);
  await store.addMessage(conv.id, 'assistant', connect);

  // La conversación PERMANECE activa (sin waiting_human). Notificar al asesor.
  await notifyAdvisor(advisor, lead, conv, contact, reason, duplaKey, log);

  log.info({ duplaKey, advisor: advisor.nombre }, 'Oxford warm handoff completed (conversation stays active)');
  return { handedOff: true };
}

/**
 * Fallback provisional para leads SIN zona resoluble (internacionales o sin
 * ubicación capturada). TODO(cliente): definir el manejo definitivo de leads
 * fuera de México — Ori recibe prospectos internacionales por diseño.
 *
 * OXED_FOREIGN_LEAD_FALLBACK:
 *   - 'A'|'B'|'C'|'D' → deriva a esa dupla default (handoff activo).
 *   - cualquier otro / no seteada (default 'meeting_link') → comparte el link de
 *     agenda y MANTIENE la conversación activa (comportamiento previo, pasivo).
 */
async function handleForeignFallback(lead, conv, contact, reason, log) {
  const raw = (env.OXED_FOREIGN_LEAD_FALLBACK || 'meeting_link').trim();
  const asDupla = raw.toUpperCase();

  // Opción configurada: derivar a una dupla default (handoff tibio, sin silenciar).
  if (['A', 'B', 'C', 'D'].includes(asDupla)) {
    const advisor = await pickAdvisorRoundRobin(asDupla);
    if (advisor) {
      log.info({ fallback: asDupla, advisor: advisor.nombre }, 'Foreign fallback → default dupla (warm handoff)');
      const leadUpdate = {
        status: 'derivado_asesor',
        assignedAdvisor: advisor.nombre,
        zoneKey: asDupla,
        notes: reason ? `Derivación FALLBACK ${asDupla}/${advisor.nombre}: ${reason}` : `Fallback → ${advisor.nombre} (${asDupla})`,
      };
      await oxfordLeadService.updateOxfordLead(lead.id, leadUpdate);
      Object.assign(lead, leadUpdate);

      const connect =
        `¡Perfecto! 😊 Te conecto con ${advisor.nombre}, asesor/a de Oxford Education LIT. ` +
        `Te escribe en breve para ver precio y siguientes pasos.\n\nMientras tanto, aquí sigo para cualquier otra duda. 🌎`;
      await sendTextMessage(contact.phone, connect);
      await messageService.createOutbound(conv.id, connect);
      await store.addMessage(conv.id, 'assistant', connect);
      // Sin waiting_human: Ori sigue viva. Notificar al asesor.
      await notifyAdvisor(advisor, lead, conv, contact, reason, asDupla, log);
      return { handedOff: true };
    }
  }

  // Default provisional: link de agenda, conversación SIGUE activa (pasivo).
  // TODO(cliente): reemplazar por ruteo internacional definitivo.
  log.warn({ fallback: 'meeting_link', state: lead.state, municipality: lead.municipality },
    'Foreign/unknown zone → passive meeting-link fallback (TODO: international routing)');
  const leadUpdate = {
    status: 'interesado',
    notes: reason ? `Sin zona (fallback link): ${reason}` : 'Sin zona — compartió agenda',
  };
  await oxfordLeadService.updateOxfordLead(lead.id, leadUpdate);
  Object.assign(lead, leadUpdate);

  const msg = `Con gusto 😊 Una asesora puede darte una cotización personalizada y resolver todas tus dudas.\n\nAgenda aquí 👉 ${HANDOFF_MEETING_URL}\n\nMientras tanto, aquí sigo para lo que necesites.`;
  await sendTextMessage(contact.phone, msg);
  await messageService.createOutbound(conv.id, msg);
  await store.addMessage(conv.id, 'assistant', msg);
  // NOTA: no se marca waiting_human — Ori sigue atendiendo.
  return { handedOff: true };
}

/** Etiquetas legibles del producto para el mensaje al asesor. */
const PRODUCT_LABELS = {
  oxford_tcc: 'Oxford TCC',
  oxford_tcc_kids: 'Oxford TCC Kids',
  english_teaching_certificate: 'English Teaching Certificate',
  alphable: 'Alphable',
  oxford_life: 'Oxford LIFE',
  rising_stars: 'Rising Stars',
  work_study_spain: 'Work & Study Spain',
};

/**
 * Formatea un número mexicano a "55 3530 5000" (últimos 10 dígitos).
 * Para internacionales (no empieza en 52) devuelve el número tal cual.
 */
function formatPhoneReadable(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  const local = digits.slice(-10);
  if (digits.startsWith('52') && local.length === 10) {
    return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  return phone;
}

/**
 * Notifica al asesor del nuevo lead. Usa una PLANTILLA aprobada (se entrega fuera
 * de la ventana de 24h de WhatsApp); si el envío por plantilla falla (p.ej. aún no
 * aprobada), cae a texto libre como respaldo (solo entrega dentro de la ventana).
 */
async function notifyAdvisor(advisor, lead, conv, contact, reason, duplaKey, log) {
  const ticket = lead.ticketNumber || '?';
  const zona = [lead.municipality, lead.state].filter(Boolean).join(', ') || 'no capturada';
  const zonaDupla = `${zona} (dupla ${duplaKey})`;
  const producto = PRODUCT_LABELS[lead.primaryProduct] || lead.primaryProduct || 'no capturado';
  const tipo = lead.leadType === 'b2b_institutional' ? 'institución' : 'individual';
  const nombre = lead.fullName || contact.name || 'No capturado';
  const phoneFormatted = formatPhoneReadable(contact.phone);
  const motivo = (reason || '—').replace(/\s+/g, ' ').trim().slice(0, 300) || '—';

  // normalizePhone respeta el passthrough internacional (Oriana +1); quitamos '+'.
  const advisorPhone = normalizePhone(advisor.whatsapp).replace('+', '');

  // 1) Plantilla aprobada (entrega garantizada fuera de la ventana de 24h).
  try {
    await sendTemplateMessage(
      advisorPhone,
      env.OXED_ADVISOR_TEMPLATE_NAME,
      env.OXED_ADVISOR_TEMPLATE_LANG,
      [ticket, nombre, tipo, lead.institutionName || '—', producto, zonaDupla, phoneFormatted, motivo],
    );
    log.info({ advisor: advisor.nombre, advisorPhone, via: 'template' }, 'Advisor notification sent');
    return;
  } catch (tplErr) {
    log.warn({ err: tplErr, advisor: advisor.nombre, template: env.OXED_ADVISOR_TEMPLATE_NAME },
      'Template notification failed, falling back to free-form text');
  }

  // 2) Respaldo: texto libre (solo entrega dentro de la ventana de 24h).
  try {
    const notification = `🔔 *Nuevo lead Oxford #${ticket}*

👤 ${nombre} (${tipo})
🏫 ${lead.institutionName || '—'}
📚 Producto: ${producto}
📍 Zona: ${zonaDupla}
📱 ${phoneFormatted}

📌 Motivo: ${motivo}

ℹ️ El prospecto sigue conversando con Ori para dudas generales; tú tomas precio y cierre.

---
✅ *LISTO ${ticket}* → cuando cierres/atiendas el lead (solo tracking; Ori nunca se silencia)`;
    await sendTextMessage(advisorPhone, notification);
    log.info({ advisor: advisor.nombre, advisorPhone, via: 'text' }, 'Advisor notification sent (fallback text)');
  } catch (error) {
    log.error({ err: error, advisor: advisor?.nombre }, 'Error notifying advisor (handoff continues)');
  }
}
