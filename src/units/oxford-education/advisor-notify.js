import { env } from '../../config/env.js';
import { normalizePhone } from '../../utils/phone.js';
import { sendTextMessage, sendTemplateMessage } from './whatsapp.js';

/**
 * Oxford Education — Notificación de lead al asesor
 *
 * Extraído de actions.js (feature/ori-advisor-sla) — MISMO código, sin cambios de
 * comportamiento — para romper una dependencia circular: actions.js necesita
 * advisor-sla.js (para inicializar el SLA al derivar) y advisor-sla.js necesita
 * notifyAdvisor (para re-notificar al reasignar). Vive en su propio módulo hoja
 * (solo depende de whatsapp.js/env.js/phone.js) para que ambos lo importen sin
 * ciclos.
 *
 * feature/ori-advisor-sla:
 *   - La instrucción ATIENDO se agregó al mensaje de TEXTO LIBRE (fallback).
 *   - Plantilla nueva `nuevo_lead_oxford_sla` (misma categoría/idioma/8 variables
 *     que la aprobada `nuevo_lead_oxford`, más la instrucción ATIENDO en el
 *     copy) creada vía Graph API y enviada a revisión de Meta — NO se editó la
 *     plantilla existente (editarla la re-manda a revisión y tumba las
 *     notificaciones actuales mientras tanto). Su nombre es configurable vía
 *     `OXED_ADVISOR_SLA_TEMPLATE`: si está seteada (Meta ya la aprobó), se usa
 *     en vez de `OXED_ADVISOR_TEMPLATE_NAME`; si no, el comportamiento es
 *     IDÉNTICO al de siempre (usa la plantilla base). El fallback a texto libre
 *     si el envío por plantilla falla se conserva sin cambios en ambos casos.
 */

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
 * Notifica al asesor del nuevo lead (o de una reasignación — mismo formato,
 * mismo ticket). Usa una PLANTILLA aprobada (se entrega fuera de la ventana de
 * 24h de WhatsApp); si el envío por plantilla falla (p.ej. aún no aprobada), cae
 * a texto libre como respaldo (solo entrega dentro de la ventana).
 *
 * @param {Object} advisor - { nombre, whatsapp, ... } de advisor-zones.ADVISORS
 * @param {Object} lead - OxfordLead
 * @param {Object|null} conv - Conversation (no usado; se conserva por firma/compat)
 * @param {Object} contact - Contact (nombre/teléfono del prospecto)
 * @param {string} reason - Motivo/nota para el asesor
 * @param {'A'|'B'|'C'|'D'} duplaKey
 * @param {Object} log - Logger child ya scopeado
 */
export async function notifyAdvisor(advisor, lead, conv, contact, reason, duplaKey, log) {
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
  // feature/ori-advisor-sla: usa OXED_ADVISOR_SLA_TEMPLATE (nuevo_lead_oxford_sla,
  // con la instrucción ATIENDO en su copy) si ya está configurada — es decir, si
  // Meta la aprobó y el cliente seteó la env. Si no está seteada, cae al MISMO
  // template de siempre (OXED_ADVISOR_TEMPLATE_NAME) — cero cambio de
  // comportamiento mientras la nueva sigue PENDING en Meta.
  const templateName = env.OXED_ADVISOR_SLA_TEMPLATE || env.OXED_ADVISOR_TEMPLATE_NAME;
  try {
    await sendTemplateMessage(
      advisorPhone,
      templateName,
      env.OXED_ADVISOR_TEMPLATE_LANG,
      [ticket, nombre, tipo, lead.institutionName || '—', producto, zonaDupla, phoneFormatted, motivo],
    );
    log.info({ advisor: advisor.nombre, advisorPhone, via: 'template', template: templateName }, 'Advisor notification sent');
    return;
  } catch (tplErr) {
    log.warn({ err: tplErr, advisor: advisor.nombre, template: templateName },
      'Template notification failed, falling back to free-form text');
  }

  // 2) Respaldo: texto libre (solo entrega dentro de la ventana de 24h).
  try {
    const slaMinutes = env.OXED_ADVISOR_SLA_MINUTES;
    const notification = `🔔 *Nuevo lead Oxford #${ticket}*

👤 ${nombre} (${tipo})
🏫 ${lead.institutionName || '—'}
📚 Producto: ${producto}
📍 Zona: ${zonaDupla}
📱 ${phoneFormatted}

📌 Motivo: ${motivo}

ℹ️ El prospecto sigue conversando con Ori para dudas generales; tú tomas precio y cierre.

⏱️ Responde *ATIENDO* para confirmar que ya lo estás atendiendo. Si no confirmas en ${slaMinutes} minutos, se reasignará a otra asesora.

---
✅ *LISTO ${ticket}* → cuando cierres/atiendas el lead (solo tracking; Ori nunca se silencia)`;
    await sendTextMessage(advisorPhone, notification);
    log.info({ advisor: advisor.nombre, advisorPhone, via: 'text' }, 'Advisor notification sent (fallback text)');
  } catch (error) {
    log.error({ err: error, advisor: advisor?.nombre }, 'Error notifying advisor (handoff continues)');
  }
}
