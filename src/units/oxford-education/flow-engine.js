import logger from '../../utils/logger.js';
import * as conversationService from '../../services/conversation.service.js';
import * as messageService from '../../services/message.service.js';
import * as store from './store.js';
import * as oxfordLeadService from './lead.service.js';
import { sendTextMessage } from './whatsapp.js';
import { buildLeadUpdate, executeHandoffToAdvisor } from './actions.js';
import { loadFlowGraph, getNode, isMenuNode } from './flow-content.js';
import { isMenuKeyword, classifyCta } from '../../core/flow/text.js';
import { extractStructuredFields } from '../../core/flow/extract.js';
import { isWithinOfficeHours, OUT_OF_HOURS_NOTICE } from './office-hours.js';

/**
 * Oxford Education — Motor determinístico del "Flujo Ori"
 *
 * Recorre el grafo sembrado en la pestaña "Flujo Ori" (flow-content.js) turno a
 * turno, guardando el nodo actual en `conversation.flowNode`. El LLM (Ori de
 * siempre: prompts.js + knowledge.js + actions.js) queda de RESPALDO para:
 *   - extracción estructurada de datos libres (solicitud_datos, ya_inscrito_stub),
 *   - interpretar una respuesta ambigua a un CTA "¿hablar con un asesor?",
 *   - cualquier mensaje que no sea número de menú, "Menú", ni respuesta clara a
 *     un CTA (punto 7 del spec).
 *
 * Contrato con handler.js: tryDeterministicFlow() devuelve
 *   { handled: true }                        → este turno ya se atendió, NO llamar a processWithAI
 *   { handled: false }                        → LLM normal (processWithAI), sin nudge
 *   { handled: false, midFlowFallback: true } → LLM normal, PERO el flujo seguía activo:
 *                                                después de la respuesta del LLM, handler.js
 *                                                agrega un recordatorio corto de 'Menú'.
 * El flowNode NUNCA se toca en un resultado handled:false — así "el respaldo no
 * rompe el estado del flujo" (se puede seguir exactamente donde se dejó).
 *
 * Todo lo geográfico/handoff se REUTILIZA sin cambios desde actions.js
 * (executeHandoffToAdvisor, con su guard anti-redisparo y ruteo por dupla) y
 * advisor-zones.js (indirectamente, vía executeHandoffToAdvisor). Este archivo
 * NUNCA reimplementa esa lógica.
 */

// Sentinel: el flujo determinístico ya terminó su parte (handoff hecho, stub
// completado, o el usuario declinó un CTA) y quedamos en modo libre con el LLM.
// Distinto de `null` (conversación que AÚN no entró al flujo) para no
// re-disparar bienvenida en cada mensaje una vez que el flujo ya se recorrió.
export const FREEFORM = 'llm_freeform';

const SOLICITUD_DATOS_FIELDS = [
  { key: 'full_name', label: 'nombre completo de la persona' },
  { key: 'role', label: 'puesto o cargo, solo si pertenece a una institución (p.ej. director, coordinador)' },
  { key: 'institution_name', label: 'nombre del colegio o institución' },
  { key: 'state', label: 'estado de la república mexicana' },
  { key: 'municipality', label: 'ciudad, alcaldía o municipio' },
];

const YA_INSCRITO_FIELDS = [
  { key: 'full_name', label: 'nombre completo de la persona' },
  { key: 'institution_name', label: 'nombre del colegio o institución' },
];

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string} params.phone - Teléfono E.164 del prospecto
 * @param {{text:string}} params.content - Contenido del mensaje entrante
 * @param {Object} params.conv - Conversation (Prisma row; se mutará conv.flowNode al persistir)
 * @param {Object} params.lead - OxfordLead (se mutará in-place al capturar datos)
 * @param {Object} params.contact - Contact row
 * @param {Object} params.log - Logger child ya scopeado (de handler.js)
 * @returns {Promise<{handled: boolean, midFlowFallback?: boolean, handoffOccurred?: boolean}>}
 */
export async function tryDeterministicFlow({ phone, content, conv, lead, contact, log }) {
  const text = (content.text || '').trim();
  const ctx = { phone, conv, lead, contact, log };

  const graph = await loadFlowGraph();
  if (!graph) return { handled: false }; // Sheet no disponible → camino LLM de siempre, intacto

  const currentFlowNode = conv.flowNode || null;
  const menuKeyword = isMenuKeyword(text);

  // Modo libre (flujo ya concluyó) y no piden el menú → LLM normal, sin nudge.
  if (currentFlowNode === FREEFORM && !menuKeyword) {
    return { handled: false };
  }

  // "Menú" en CUALQUIER momento (incluso modo libre o conversación nueva) → menu_principal.
  if (menuKeyword) {
    await store.addMessage(conv.id, 'user', text);
    return await jumpToNode(graph, 'menu_principal', ctx);
  }

  // Conversación nueva: nunca entró al flujo → bienvenida + filtro_previo.
  if (!currentFlowNode) {
    await store.addMessage(conv.id, 'user', text);
    return await startFlow(graph, ctx);
  }

  const node = getNode(graph, currentFlowNode);
  if (!node) {
    // El cliente editó/borró ese nodo en el Sheet — no romper: salir a modo libre.
    log.warn({ flowNode: currentFlowNode }, 'flowNode ya no existe en el grafo — saliendo a modo libre');
    await persistFlowNode(conv, FREEFORM);
    return { handled: false };
  }

  // ── Pasos especiales de extracción (no son menús numerados) ────────────────
  if (currentFlowNode === 'solicitud_datos') {
    await store.addMessage(conv.id, 'user', text);
    return await handleSolicitudDatos(graph, text, ctx);
  }

  if (currentFlowNode === 'ya_inscrito_stub') {
    await store.addMessage(conv.id, 'user', text);
    return await handleYaInscrito(text, ctx);
  }

  // ── Nodo de menú (opciones numeradas): filtro_previo, menu_principal, cat_1..5 ──
  if (isMenuNode(node)) {
    const digitMatch = text.match(/(\d+)/);
    if (!digitMatch) return { handled: false, midFlowFallback: true }; // texto libre → respaldo LLM, flowNode intacto
    await store.addMessage(conv.id, 'user', text);
    return await handleMenuChoice(graph, node, digitMatch[1], ctx);
  }

  // ── Nodo hoja de producto (n_1_1..n_5_2): CTA "¿hablar con un asesor?" ──────
  const verdict = classifyCta(text);
  if (verdict === 'ambiguous') return { handled: false, midFlowFallback: true }; // respaldo LLM, flowNode intacto
  await store.addMessage(conv.id, 'user', text);
  return await handleCtaLeaf(node, verdict, ctx);
}

// ── Helpers de envío/persistencia ───────────────────────────────────────────

/** Envía un texto de Ori y lo persiste igual que el camino LLM (Postgres + Redis). */
async function sendNodeText(text, ctx) {
  await sendTextMessage(ctx.phone, text);
  await messageService.createOutbound(ctx.conv.id, text);
  await store.addMessage(ctx.conv.id, 'assistant', text);
}

/** Persiste el nodo actual del flujo (columna flow_node) y sincroniza el objeto en memoria. */
async function persistFlowNode(conv, nodeId) {
  await conversationService.update(conv.id, { flowNode: nodeId });
  conv.flowNode = nodeId;
}

/** Salta a un nodo, envía su texto VERBATIM y persiste flowNode. Nunca revienta si el Sheet quedó inconsistente. */
async function jumpToNode(graph, nodeId, ctx) {
  const node = getNode(graph, nodeId);
  if (!node) {
    ctx.log.error({ nodeId }, 'Nodo destino no existe en el grafo (Sheet inconsistente) — no se rompe el bot');
    await sendNodeText("Tuvimos un detalle técnico con esa opción 🙏 Escribe 'Menú' para ver las opciones disponibles.", ctx);
    return { handled: true };
  }
  await sendNodeText(node.texto, ctx);
  await persistFlowNode(ctx.conv, node.id);
  return { handled: true };
}

// ── Pasos del flujo ──────────────────────────────────────────────────────────

/** Conversación nueva: bienvenida (siempre, sin versión fuera de horario) + filtro_previo. */
async function startFlow(graph, ctx) {
  const bienvenida = getNode(graph, 'bienvenida');
  const filtro = getNode(graph, 'filtro_previo');
  await sendNodeText(bienvenida.texto, ctx);
  await sendNodeText(filtro.texto, ctx);
  await persistFlowNode(ctx.conv, 'filtro_previo');
  return { handled: true };
}

/** Nodo de menú: número válido → salta; número inválido → re-muestra las opciones. */
async function handleMenuChoice(graph, node, choiceDigit, ctx) {
  const destId = node.opciones[choiceDigit];
  if (!destId) {
    const msg = `Esa opción no es válida 🙏 Por favor responde con un número de la lista:\n\n${node.texto}`;
    await sendNodeText(msg, ctx);
    return { handled: true }; // flowNode NO cambia — seguimos en el mismo nodo
  }
  return await jumpToNode(graph, destId, ctx);
}

/**
 * solicitud_datos: el mensaje trae nombre/puesto, colegio, ciudad y estado en
 * texto libre. Se extrae con el LLM (extractor estructurado, NO la persona de
 * Ori) y se captura con la MISMA validación que [CAPTURAR_DATO] (buildLeadUpdate
 * de actions.js), así state/municipality llegan idénticos a como los usa
 * advisor-zones.js. Si no se extrajo nada útil, se reintenta sin romper el estado.
 */
async function handleSolicitudDatos(graph, text, ctx) {
  const extracted = await extractStructuredFields(text, SOLICITUD_DATOS_FIELDS, ctx.log);
  const applied = await applyExtractedFields(ctx.lead, extracted, ctx.log);

  if (applied.length === 0) {
    const node = getNode(graph, 'solicitud_datos');
    const retry = `No logré identificar esos datos 🙏 ¿Me los compartes de nuevo, por favor?\n\n${node.texto}`;
    await sendNodeText(retry, ctx);
    return { handled: true }; // seguimos en solicitud_datos
  }

  const menu = getNode(graph, 'menu_principal');
  await sendNodeText(menu.texto, ctx);
  await persistFlowNode(ctx.conv, 'menu_principal');
  return { handled: true };
}

/**
 * ya_inscrito_stub: capta nombre + colegio, marca el lead como
 * inscrito/seguimiento-pendiente (visible para el equipo vía log + tags/notes).
 * TODO(cliente): aquí se cableará después la consulta al Sheet de "por cobrar"
 * para dar el link de pago o la etapa. NO dispara handoff geográfico (no hay
 * ciudad/estado en este camino).
 */
async function handleYaInscrito(text, ctx) {
  const extracted = await extractStructuredFields(text, YA_INSCRITO_FIELDS, ctx.log);
  await applyExtractedFields(ctx.lead, extracted, ctx.log);

  const statusUpdate = {
    status: 'primer_contacto',
    tags: Array.from(new Set([...(ctx.lead.tags || []), 'ya_inscrito', 'seguimiento_pendiente'])),
    notes: [ctx.lead.notes, `[ya_inscrito_stub] ${new Date().toISOString()} — TODO: cablear consulta al Sheet "por cobrar" (link de pago / etapa)`]
      .filter(Boolean)
      .join('\n'),
  };
  await oxfordLeadService.updateOxfordLead(ctx.lead.id, statusUpdate);
  Object.assign(ctx.lead, statusUpdate);

  ctx.log.info(
    { leadId: ctx.lead.id, fullName: ctx.lead.fullName, institutionName: ctx.lead.institutionName },
    'Lead marcado ya_inscrito/seguimiento_pendiente (ya_inscrito_stub) — visible para el equipo',
  );

  const nombre = ctx.lead.fullName ? `, ${ctx.lead.fullName}` : '';
  const institucion = ctx.lead.institutionName ? ` con ${ctx.lead.institutionName}` : '';
  const ack = `¡Gracias${nombre}! 🙌 Ya quedó registrado tu caso${institucion}. Una asesora te dará seguimiento pronto.`;
  await sendNodeText(ack, ctx);
  await persistFlowNode(ctx.conv, FREEFORM);
  return { handled: true };
}

/**
 * Nodo hoja de producto (CTA "¿hablar con un asesor?"): acepta → handoff tibio
 * YA EXISTENTE (executeHandoffToAdvisor, guard anti-redisparo incluido) +
 * aviso de horario si aplica; declina → invita a volver al menú.
 */
async function handleCtaLeaf(node, verdict, ctx) {
  if (verdict === 'decline') {
    await sendNodeText("Sin problema 😊 Escribe *Menú* cuando quieras ver las demás opciones, o cuéntame si tienes otra duda.", ctx);
    await persistFlowNode(ctx.conv, FREEFORM);
    return { handled: true };
  }

  // accept → reutiliza el handoff tibio + ruteo geográfico tal cual están en prod.
  const { handedOff } = await executeHandoffToAdvisor(
    ctx.lead,
    ctx.conv,
    ctx.contact,
    `Flujo Ori — aceptó hablar con asesor (nodo ${node.id})`,
  );

  if (!handedOff) {
    // Guard anti-redisparo: ya había asesor asignado. executeHandoffToAdvisor no
    // manda mensaje en este caso — Ori sí responde (igual que el camino LLM).
    const msg = ctx.lead.assignedAdvisor
      ? `Ese detalle lo verá directamente ${ctx.lead.assignedAdvisor}, que ya está en contacto contigo 😊 ¿Te ayudo con algo más mientras tanto?`
      : 'Con gusto te ayudo. ¿Sobre qué programa te gustaría saber más? 😊';
    await sendNodeText(msg, ctx);
  } else if (!isWithinOfficeHours()) {
    // El mensaje tibio de conexión ya lo mandó executeHandoffToAdvisor; esto es
    // un mensaje APARTE — no se toca su texto (handoff tibio intacto).
    await sendNodeText(`Una nota: ${OUT_OF_HOURS_NOTICE}.`, ctx);
  }

  await persistFlowNode(ctx.conv, FREEFORM);
  return { handled: true, handoffOccurred: handedOff };
}

// ── Captura de campos extraídos (misma validación que [CAPTURAR_DATO]) ──────

/**
 * Aplica cada campo extraído vía buildLeadUpdate (actions.js) — el MISMO mapeo
 * y validación que usa el LLM cuando emite [CAPTURAR_DATO:campo:valor].
 * @returns {Promise<Array<string>>} campos realmente aplicados (para saber si se extrajo algo)
 */
async function applyExtractedFields(lead, extracted, log) {
  const applied = [];
  for (const [field, value] of Object.entries(extracted)) {
    if (!value) continue;
    const update = buildLeadUpdate(field, value);
    if (update) {
      await oxfordLeadService.updateOxfordLead(lead.id, update);
      Object.assign(lead, update);
      applied.push(field);
    } else {
      log.warn({ field, value }, 'Campo extraído inválido, ignorado (misma validación que CAPTURAR_DATO)');
    }
  }
  return applied;
}
