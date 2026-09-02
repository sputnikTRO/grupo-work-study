import logger from '../../utils/logger.js';
import * as conversationService from '../../services/conversation.service.js';
import * as messageService from '../../services/message.service.js';
import * as conversation from '../../core/ai/conversation.js';
import { sendTextMessage } from '../../core/whatsapp/client.js';
import { executeCaptureData, executeHandoffToAdvisor, executeSendMaterial } from './actions.js';
import { loadFlowGraph, getNode, isMenuNode } from './flow-content.js';
import { findSchoolPrices, isQuotable, isAllInclusiveHotel, isSinglePrice, isWinterBreakRow } from './prices.js';
import { resolveEnrollment, resolveForStudent, findStudentsByPhone, formatMoney } from './enrollment.js';
import { isMenuKeyword, classifyCta, normalize, matchMenuChoice, standaloneNumber } from '../../core/flow/text.js';
import { extractStructuredFields } from '../../core/flow/extract.js';
import { isWithinOfficeHours, OUT_OF_HOURS_NOTICE } from '../../core/flow/office-hours.js';

/**
 * Travel (Miri) — Motor determinístico del "Flujo Miri"
 *
 * Copia adaptada del motor de Ori (units/oxford-education/flow-engine.js): mismo
 * contrato con el handler, misma mecánica de navegación, mismos clasificadores
 * (ahora compartidos en core/flow/). Lo que cambia es todo el borde de la unidad
 * — Redis de travel, WhatsApp con phoneNumberId, TravelLead — más tres
 * capacidades que Ori no tiene:
 *
 *   1. PLACEHOLDERS: {{colegio}} {{prog_completo}} {{vuelo_completo}}
 *      {{prog_apartado}} {{vuelo_apartado}} {{asesora}}, sustituidos al vuelo.
 *      Si un placeholder vale null (tier vacío), se ELIMINA la línea entera que
 *      lo contiene — así Martha Christlieb o Iberoamericano, que no tienen tier
 *      de pago completo, ven solo el tier que sí existe.
 *   2. GATE DE PRECIO: el nodo de precio se elige por el colegio capturado —
 *      e4l_precio_columbia (modalidad hotel), e4l_precio_registrado (tiene fila
 *      con precio) o e4l_precio_otro (colegio "otro", sin colegio, o sin tarifa).
 *   3. ENVÍO DE MATERIAL: los nodos de material mandan el PDF real. En English 4
 *      Life el material depende del destino del colegio; si no se conoce, Miri
 *      pregunta el destino ANTES de enviar (nodo virtual, ver VIRTUAL_NODES).
 *
 * Todo lo que ya estaba en prod se REUTILIZA, nunca se reimplementa:
 * executeCaptureData (capturar = validar y persistir igual que [CAPTURAR_DATO]),
 * executeHandoffToAdvisor (handoff tibio + guard anti-redisparo + carrusel de
 * advisors.js) y executeSendMaterial (subida/caché de media a WhatsApp).
 *
 * Contrato con handler.js, idéntico al de Ori:
 *   { handled: true }                        → turno atendido, NO llamar al LLM
 *   { handled: false }                        → LLM normal, sin nudge
 *   { handled: false, midFlowFallback: true } → LLM normal, PERO el flujo seguía
 *                                                activo: el handler agrega un
 *                                                recordatorio corto de 'Menú'.
 * El flowNode NUNCA se toca en un resultado handled:false — el respaldo LLM no
 * rompe el estado del flujo.
 */

// Sentinel: el flujo ya terminó su parte y quedamos en modo libre con el LLM.
// Distinto de `null` (conversación que AÚN no entró al flujo) para no
// re-disparar bienvenida en cada mensaje una vez recorrido el flujo.
export const FREEFORM = 'llm_freeform';

// Nodo virtual: no vive en el Sheet, lo maneja el código. Se usa cuando hay que
// preguntar el destino antes de mandar la presentación de English 4 Life.
const ASK_DESTINATION = 'e4l_material_destino';

// Nodo virtual: el papá tiene 2+ hijos registrados con su teléfono y hay que
// preguntar de cuál quiere el estatus. La lista NO se guarda entre turnos: se
// vuelve a resolver por teléfono (el índice está cacheado) y se indexa por el
// número que responde, así el orden es siempre el de la hoja.
const ASK_CHILD = 'ya_inscrito_hijo';

const DATOS_FIELDS = [
  { key: 'parent_name', label: 'nombre completo del padre, madre o tutor que escribe' },
  { key: 'traveler_name', label: 'nombre completo del hijo o hija que viajaría' },
  { key: 'traveler_age', label: 'edad del hijo o hija, solo el número' },
];

const COLEGIO_FIELDS = [
  { key: 'school_code', label: 'nombre del colegio; si dice que no está en la lista o escribe "otro", devuelve exactamente "otro"' },
];

// Solo se usan cuando el teléfono NO está en el registro de inscritos: ahí sí
// hay que preguntarle los datos, como a cualquier lead.
const YA_INSCRITO_FIELDS = [
  { key: 'parent_name', label: 'nombre completo de la persona que escribe' },
  { key: 'school_code', label: 'nombre del colegio' },
];

// Nodos de handoff → track del carrusel de advisors.js.
const HANDOFF_TRACKS = {
  handoff_colegio: 'colegio',
  handoff_familia: 'familia',
  handoff_rs: 'rising_stars',
};

// Nodos de categoría → producto que se captura en el lead. Alimenta el ticket de
// la asesora (campo "Programa") y la pestaña Leads, sin depender del texto libre.
const CATEGORY_PRODUCTS = {
  cat_e4l: 'English 4 Life',
  cat_wb: 'Winter Break',
  cat_rs: 'Rising Stars',
};

// Motivo del ticket según el nodo DESDE el que se derivó, para que la asesora
// lea algo accionable en vez de "nodo handoff_colegio".
const ORIGIN_REASONS = {
  ya_inscrito_estatus: 'YA INSCRITO — pide las fechas de sus siguientes pagos',
  ya_inscrito_hijo: 'YA INSCRITO — consulta su proceso',
  e4l_precio_registrado: 'Pide plan de pagos de English 4 Life',
  e4l_precio_columbia: 'Pide plan de pagos de English 4 Life (Columbia, hotel)',
  e4l_precio_otro: 'Colegio no registrado: pide precio de English 4 Life',
  wb_precio: 'Pide la propuesta de Winter Break',
  e4l_material: 'Recibió la presentación de English 4 Life y quiere hablar',
  wb_material: 'Recibió la presentación de Winter Break y quiere hablar',
};

// Nodos de material → ID fijo. English 4 Life no aparece aquí porque su material
// se resuelve por destino (ver resolveMaterialId).
const MATERIAL_NODES = new Set(['e4l_material', 'wb_material']);

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string} params.phone - Teléfono E.164 del prospecto
 * @param {{text:string}} params.content - Contenido del mensaje entrante
 * @param {Object} params.conv - Conversation (se muta conv.flowNode al persistir)
 * @param {Object} params.lead - TravelLead (se muta in-place al capturar)
 * @param {Object} params.contact - Contact row
 * @param {string} params.phoneNumberId - WhatsApp phone number ID que recibió el mensaje
 * @param {Object} params.log - Logger child ya scopeado (de handler.js)
 * @returns {Promise<{handled: boolean, midFlowFallback?: boolean, handoffOccurred?: boolean}>}
 */
export async function tryDeterministicFlow({ phone, content, conv, lead, contact, phoneNumberId, log }) {
  const text = (content.text || '').trim();
  // Cualquier derivación que nazca dentro de la rama "ya inscrito" marca el ticket
  // como tal, venga del nodo sembrado en el Sheet o del texto de respaldo.
  const ticketKind = String(conv.flowNode || '').startsWith('ya_inscrito') ? 'ya_inscrito' : undefined;
  const ctx = { phone, conv, lead, contact, phoneNumberId, log, ticketKind };

  const graph = await loadFlowGraph();
  if (!graph) return { handled: false }; // Sheet no disponible → camino LLM de siempre, intacto

  const currentFlowNode = conv.flowNode || null;
  const menuKeyword = isMenuKeyword(text);

  // Modo libre (el flujo ya concluyó) y no piden el menú → LLM normal, sin nudge.
  if (currentFlowNode === FREEFORM && !menuKeyword) {
    return { handled: false };
  }

  // "Menú" en CUALQUIER momento (incluso modo libre o conversación nueva).
  if (menuKeyword) {
    await conversation.addMessage(conv.id, 'user', text);
    return await jumpToNode(graph, 'menu_principal', ctx);
  }

  // Conversación nueva: nunca entró al flujo → bienvenida + filtro_previo.
  if (!currentFlowNode) {
    await conversation.addMessage(conv.id, 'user', text);
    return await startFlow(graph, ctx);
  }

  // Nodos virtuales (no viven en el Sheet): se atienden antes de mirar el grafo.
  if (currentFlowNode === ASK_DESTINATION) {
    await conversation.addMessage(conv.id, 'user', text);
    return await handleDestinationAnswer(graph, text, ctx);
  }

  if (currentFlowNode === ASK_CHILD) {
    await conversation.addMessage(conv.id, 'user', text);
    return await handleChildChoice(text, ctx);
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
    await conversation.addMessage(conv.id, 'user', text);
    return await handleSolicitudDatos(graph, text, ctx);
  }

  if (currentFlowNode === 'solicitud_colegio') {
    await conversation.addMessage(conv.id, 'user', text);
    return await handleSolicitudColegio(graph, text, ctx);
  }

  if (currentFlowNode === 'ya_inscrito') {
    await conversation.addMessage(conv.id, 'user', text);
    return await handleYaInscrito(text, ctx);
  }

  // ── Nodo de menú (opciones numeradas) ─────────────────────────────────────
  if (isMenuNode(node)) {
    // Se acepta el número ("2") Y el texto de la opción ("Busco información"),
    // porque la gente responde con palabras tan seguido como con dígitos. Un
    // número suelto dentro de una frase ("José tiene 14 años") NO cuenta como
    // elección: eso cae al respaldo LLM en vez de dar "opción no válida".
    const choice = matchMenuChoice(text, node);
    // Un número suelto FUERA de rango ("9" en un menú de 4) sí es un intento de
    // elegir: se le vuelve a mostrar la lista. Una frase con un número dentro,
    // no: eso va al respaldo LLM.
    const intento = choice || standaloneNumber(text);
    if (!intento) return { handled: false, midFlowFallback: true };
    await conversation.addMessage(conv.id, 'user', text);
    return await handleMenuChoice(graph, node, intento, ctx);
  }

  // Nodo de estatus sin sembrar en el Sheet: sus opciones 1/2 se resuelven aquí.
  if (currentFlowNode === 'ya_inscrito_estatus' && !isMenuNode(node)) {
    await conversation.addMessage(conv.id, 'user', text);
    // Solo se llega aquí si el cliente borró las opciones del nodo en el Sheet;
    // se reconstruye el menú 1/2 implícito para poder interpretar la respuesta.
    const menuImplicito = { texto: node.texto, opciones: { 1: 'handoff_colegio', 2: 'util_menu' } };
    if (matchMenuChoice(text, menuImplicito) === '1' || classifyCta(text) === 'accept') {
      return await runHandoff('handoff_colegio', ctx, 'YA INSCRITO — pide fechas de sus siguientes pagos', { ticketKind: 'ya_inscrito' });
    }
    await sendNodeText('Sin problema 😊 Escribe *Menú* cuando quieras ver las demás opciones.', ctx);
    await persistFlowNode(conv, FREEFORM);
    return { handled: true };
  }

  // ── Nodo hoja sin opciones (rs_elegible, handoff_*, util_menu) ────────────
  // Los nodos hoja de Miri no son CTA de producto (esos tienen menú numerado),
  // así que cualquier texto aquí es conversación libre → respaldo LLM.
  const verdict = classifyCta(text);
  if (verdict === 'accept') {
    await conversation.addMessage(conv.id, 'user', text);
    return await runHandoff(node.id, ctx, `Flujo Miri — aceptó hablar con asesora (nodo ${node.id})`);
  }
  return { handled: false, midFlowFallback: true };
}

// ── Helpers de envío/persistencia ───────────────────────────────────────────

/** Envía un texto de Miri y lo persiste igual que el camino LLM (Postgres + Redis). */
async function sendNodeText(text, ctx) {
  await sendTextMessage(ctx.phone, text, ctx.phoneNumberId);
  await messageService.createOutbound(ctx.conv.id, text);
  await conversation.addMessage(ctx.conv.id, 'assistant', text);
}

/** Persiste el nodo actual del flujo (columna flow_node) y sincroniza el objeto en memoria. */
async function persistFlowNode(conv, nodeId) {
  await conversationService.update(conv.id, { flowNode: nodeId });
  conv.flowNode = nodeId;
}

/**
 * Sustituye {{placeholders}} en el texto del nodo.
 *
 * REGLA DE TIER VACÍO: si un placeholder tiene valor null/undefined, se elimina
 * la LÍNEA COMPLETA que lo contiene (no se imprime "$null"). Así un colegio sin
 * tier de pago completo muestra solo el tier de apartado, sin tocar el Sheet.
 *
 * @param {string} texto - Texto verbatim del nodo
 * @param {Object} values - { colegio, prog_completo, ... }
 * @returns {string}
 */
export function renderNodeText(texto, values = {}) {
  const lines = String(texto).split('\n');

  const kept = lines.filter((line) => {
    const used = [...line.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
    if (used.length === 0) return true;
    // Se cae la línea si algún placeholder que usa no tiene valor.
    return used.every((k) => values[k] !== null && values[k] !== undefined && values[k] !== '');
  });

  return kept
    .join('\n')
    .replace(/\{\{([a-z_]+)\}\}/g, (full, key) => (values[key] !== undefined && values[key] !== null ? String(values[key]) : full))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Formatea 34990 → "34,990". null pasa tal cual (lo filtra renderNodeText). */
function money(n) {
  return n === null || n === undefined ? null : Number(n).toLocaleString('es-MX');
}

/**
 * Salta a un nodo: resuelve redirecciones (gate de precio), renderiza su texto,
 * envía material si aplica y persiste flowNode. Nunca revienta si el Sheet quedó
 * inconsistente.
 */
async function jumpToNode(graph, nodeId, ctx) {
  // Gate de precio: el nodo real depende del colegio capturado.
  //
  // Winter Break sigue derivando por defecto (su propuesta se arma por colegio),
  // PERO si la hoja de precios ya tiene tarifa para ese colegio+producto, se
  // cotiza igual que English 4 Life: no tiene sentido derivar por un precio que
  // ya está publicado (Instituto Internacional y UMIN).
  let targetId = nodeId;
  if (nodeId === 'e4l_precio_registrado') {
    targetId = await resolvePriceNode(ctx.lead, ctx.log);
  } else if (nodeId === 'wb_precio') {
    // Solo se cotiza si la fila encontrada es DE Winter Break: que el colegio
    // tenga tarifa de English 4 Life no significa que tenga una de Winter Break.
    const entry = await findSchoolPrices(ctx.lead.schoolCode, priceHints(ctx.lead));
    if (entry && isQuotable(entry) && isWinterBreakRow(entry)) {
      targetId = isSinglePrice(entry) ? 'e4l_precio_unico' : 'e4l_precio_registrado';
    }
  }

  const node = getNode(graph, targetId);
  if (!node) {
    ctx.log.error({ nodeId: targetId }, 'Nodo destino no existe en el grafo (Sheet inconsistente) — no se rompe el bot');
    await sendNodeText("Tuvimos un detalle técnico con esa opción 🙏 Escribe 'Menú' para ver las opciones disponibles.", ctx);
    return { handled: true };
  }

  // Los nodos de handoff no muestran su texto: el mensaje de conexión lo genera
  // executeHandoffToAdvisor (misma redacción venga del menú o del LLM).
  if (HANDOFF_TRACKS[node.id]) {
    const origen = ctx.conv.flowNode;
    const reason = ORIGIN_REASONS[origen] || `Flujo Miri — pidió hablar con una asesora (desde ${origen || 'el menú'})`;
    return await runHandoff(node.id, ctx, reason);
  }

  // Rama "ya inscrito": en vez de mostrar el nodo y pedir datos, se resuelve por
  // el teléfono de quien escribe (ver enrollment.js) y se ramifica en 3 casos.
  if (node.id === 'ya_inscrito') {
    return await handleYaInscritoEntry(graph, node, ctx);
  }

  // Material de English 4 Life sin destino conocido → preguntar antes de enviar.
  if (node.id === 'e4l_material' && !(await resolveDestination(ctx.lead))) {
    await sendNodeText('¡Claro! ¿Para cuál destino te la mando, Londres o Dublín?', ctx);
    await persistFlowNode(ctx.conv, ASK_DESTINATION);
    return { handled: true };
  }

  // Entrar a una categoría fija el producto de interés en el lead.
  const producto = CATEGORY_PRODUCTS[node.id];
  if (producto && ctx.lead.programInterest !== producto) {
    await executeCaptureData('program_interest', producto, ctx.lead, ctx.conv, ctx.log);
  }

  await sendNodeText(await buildNodeText(node, ctx), ctx);
  await persistFlowNode(ctx.conv, node.id);

  if (MATERIAL_NODES.has(node.id)) await sendNodeMaterial(node, ctx);

  // rs_elegible cierra con derivación al carrusel de Rising Stars.
  if (node.id === 'rs_elegible') {
    return await runHandoff('handoff_rs', ctx, 'Flujo Miri — Rising Stars, alumno elegible (verificar beca)');
  }

  return { handled: true };
}

/**
 * Pistas para desambiguar la fila de precios cuando un colegio tiene varias
 * (UMIN: Dublín/Homestay y Londres/Winter Break). El producto ya está capturado
 * porque el prospecto pasó por cat_e4l / cat_wb / cat_rs antes de pedir precio.
 */
function priceHints(lead) {
  return { producto: lead?.programInterest, destino: lead?.destination };
}

/** Renderiza el texto del nodo con los placeholders que correspondan. */
async function buildNodeText(node, ctx) {
  if (!node.texto.includes('{{')) return node.texto;

  const values = { asesora: ctx.lead.assignedAdvisor || null };

  if (node.id.startsWith('e4l_precio')) {
    const entry = await findSchoolPrices(ctx.lead.schoolCode, priceHints(ctx.lead));
    if (entry) {
      values.colegio = entry.colegio;
      values.prog_completo = money(entry.progCompleto);
      values.vuelo_completo = money(entry.vueloCompleto);
      values.prog_apartado = money(entry.progApartado);
      values.vuelo_apartado = money(entry.vueloApartado);
      values.precio_unico = money(entry.precioUnico);
    }
  }

  return renderNodeText(node.texto, values);
}

// ── Gate de precio ───────────────────────────────────────────────────────────

/**
 * Elige el nodo de precio según el colegio capturado.
 *   - modalidad hotel (Columbia)            → e4l_precio_columbia
 *   - fila con al menos un tier con precio   → e4l_precio_registrado
 *   - "otro", sin colegio, o sin tarifa      → e4l_precio_otro (deriva, sin número)
 *
 * @returns {Promise<string>} id del nodo de precio
 */
export async function resolvePriceNode(lead, log = logger) {
  const entry = await findSchoolPrices(lead?.schoolCode, priceHints(lead));

  if (!entry || !isQuotable(entry)) {
    log?.info?.({ schoolCode: lead?.schoolCode }, 'Colegio no cotizable → e4l_precio_otro');
    return 'e4l_precio_otro';
  }
  if (isAllInclusiveHotel(entry)) return 'e4l_precio_columbia';
  // Tier único "AGOSTO – SEPTIEMBRE 2027": un solo precio con vuelo incluido, sin
  // el par programa+vuelo (Instituto Internacional, UMIN).
  if (isSinglePrice(entry)) return 'e4l_precio_unico';
  return 'e4l_precio_registrado';
}

// ── Material ─────────────────────────────────────────────────────────────────

/** Destino del viaje: el capturado en el lead, o el del colegio en la hoja de precios. */
async function resolveDestination(lead) {
  const fromLead = normalize(lead?.destination || '');
  if (fromLead.includes('londres')) return 'Londres';
  if (fromLead.includes('dublin')) return 'Dublín';

  const entry = await findSchoolPrices(lead?.schoolCode, priceHints(lead));
  const fromSheet = normalize(entry?.destino || '');
  if (fromSheet.includes('londres')) return 'Londres';
  if (fromSheet.includes('dublin')) return 'Dublín';

  return null;
}

/**
 * ID del material a enviar: la columna `Material` del nodo si la trae; si no
 * (English 4 Life), se resuelve por destino.
 */
async function resolveMaterialId(node, lead) {
  if (node.material) return node.material;
  if (node.id !== 'e4l_material') return null;

  const destino = await resolveDestination(lead);
  if (destino === 'Londres') return 'JDP_LONDRES_2027';
  if (destino === 'Dublín') return 'JDP_DUBLIN_2027';
  return null;
}

/** Envía el PDF del nodo. Cualquier fallo se loguea y NO rompe el turno. */
async function sendNodeMaterial(node, ctx) {
  try {
    const materialId = await resolveMaterialId(node, ctx.lead);
    if (!materialId) {
      ctx.log.warn({ nodeId: node.id }, 'Nodo de material sin ID resoluble — no se envía archivo');
      return;
    }
    await executeSendMaterial(materialId, ctx.lead, ctx.phone, ctx.phoneNumberId, ctx.log);
  } catch (error) {
    ctx.log.error({ err: error, nodeId: node.id }, 'Error enviando material desde el flujo — el turno continúa');
  }
}

/** Respuesta a "¿Londres o Dublín?": captura el destino y manda la presentación. */
async function handleDestinationAnswer(graph, text, ctx) {
  const n = normalize(text);
  const destino = n.includes('dublin') ? 'Dublín' : n.includes('londres') ? 'Londres' : null;

  if (!destino) {
    await sendNodeText('¿Me confirmas si es Londres o Dublín? 😊', ctx);
    return { handled: true }; // seguimos esperando el destino
  }

  await executeCaptureData('destination', destino, ctx.lead, ctx.conv, ctx.log);

  const node = getNode(graph, 'e4l_material');
  if (node) {
    await sendNodeText(await buildNodeText(node, ctx), ctx);
    await persistFlowNode(ctx.conv, node.id);
    await sendNodeMaterial(node, ctx);
  } else {
    await persistFlowNode(ctx.conv, FREEFORM);
  }
  return { handled: true };
}

// ── Pasos del flujo ──────────────────────────────────────────────────────────

/** Conversación nueva: bienvenida + filtro_previo. */
async function startFlow(graph, ctx) {
  const bienvenida = getNode(graph, 'bienvenida');
  const filtro = getNode(graph, 'filtro_previo');
  await sendNodeText(bienvenida.texto, ctx);
  await sendNodeText(filtro.texto, ctx);
  await persistFlowNode(ctx.conv, 'filtro_previo');
  return { handled: true };
}

/** Nodo de menú: número válido → salta; inválido → re-muestra las opciones. */
async function handleMenuChoice(graph, node, choiceDigit, ctx) {
  const destId = node.opciones[choiceDigit];
  if (!destId) {
    const msg = `Esa opción no es válida 🙏 Por favor responde con un número de la lista:\n\n${await buildNodeText(node, ctx)}`;
    await sendNodeText(msg, ctx);
    return { handled: true }; // flowNode NO cambia — seguimos en el mismo nodo
  }
  return await jumpToNode(graph, destId, ctx);
}

/**
 * solicitud_datos: nombre del papá + nombre y edad del alumno en texto libre.
 * Se extrae con el LLM (extractor estructurado) y se captura con la MISMA
 * función que [CAPTURAR_DATO] (executeCaptureData), así el lead queda idéntico
 * sin importar quién capturó.
 */
async function handleSolicitudDatos(graph, text, ctx) {
  const extracted = await extractStructuredFields(text, DATOS_FIELDS, ctx.log);
  const applied = await applyExtractedFields(extracted, ctx);

  if (applied.length === 0) {
    const node = getNode(graph, 'solicitud_datos');
    await sendNodeText(`No logré identificar esos datos 🙏 ¿Me los compartes de nuevo, por favor?\n\n${node.texto}`, ctx);
    return { handled: true }; // seguimos en solicitud_datos
  }

  return await jumpToNode(graph, 'solicitud_colegio', ctx);
}

/** solicitud_colegio: extrae el colegio (o "otro") y pasa al menú principal. */
async function handleSolicitudColegio(graph, text, ctx) {
  const extracted = await extractStructuredFields(text, COLEGIO_FIELDS, ctx.log);
  const applied = await applyExtractedFields(extracted, ctx);

  if (applied.length === 0) {
    const node = getNode(graph, 'solicitud_colegio');
    await sendNodeText(`No alcancé a identificar el colegio 🙏 ¿Me lo escribes de nuevo?\n\n${node.texto}`, ctx);
    return { handled: true };
  }

  return await jumpToNode(graph, 'menu_principal', ctx);
}

// ── Rama "ya inscrito" ───────────────────────────────────────────────────────

/**
 * Textos por defecto de la rama. Si el cliente siembra estos nodos en "Flujo
 * Miri" (scripts/seed-miri-flow.js ya los define), el texto del Sheet gana y
 * estos quedan solo como respaldo — así el contenido sigue siendo editable sin
 * tocar código, pero la rama funciona aunque todavía no se haya sembrado.
 */
const YA_INSCRITO_TEXTS = {
  ya_inscrito_sin_pago:
    '¡Gracias{{nombre}}! 🙌 Ya te tengo en el registro de English 4 Life.\n\n' +
    'Para el siguiente paso de tu proceso te conecto con tu asesora, que revisa tu caso y te escribe en breve.',
  ya_inscrito_estatus:
    'Esto es lo que tengo de {{alumno}} 📋\n\n' +
    'Total del programa: {{total_a_pagar}}\n' +
    'Llevas pagado: {{llevan_pagado}}\n' +
    'Falta por pagar: {{falta_por_pagar}}\n\n' +
    '¿Te conecto con tu asesora para ver las fechas de tus siguientes pagos?\n' +
    '1.- Sí, por favor\n' +
    '2.- Todavía no, gracias',
};

/** Texto del nodo si está sembrado en el Sheet; si no, el de respaldo. */
function yaInscritoText(graph, nodeId) {
  return getNode(graph, nodeId)?.texto || YA_INSCRITO_TEXTS[nodeId];
}

/**
 * Entrada a la rama: se resuelve por el teléfono de quien escribe.
 *
 *   no_registrado → se comporta como un lead nuevo: muestra el nodo del Sheet
 *                   (pide nombre y colegio) y captura en el siguiente turno.
 *   elegir_hijo   → 2+ alumnos con ese teléfono: pregunta cuál ANTES de mostrar.
 *   sin_pagos     → registrado sin fila de pago (o match ambiguo): NO muestra
 *                   nada financiero y deriva con contexto.
 *   con_pagos     → muestra total / pagado / falta y ofrece conectar.
 */
async function handleYaInscritoEntry(graph, node, ctx) {
  let res;
  try {
    res = await resolveEnrollment(ctx.phone);
  } catch (error) {
    // Si la hoja falla, se trata como no registrado: nunca se inventa un estatus.
    ctx.log.error({ err: error }, 'Error resolviendo inscripción — se trata como no registrado');
    res = { caso: 'no_registrado' };
  }

  ctx.log.info({ caso: res.caso, alumnos: res.alumnos?.length ?? (res.alumno ? 1 : 0) }, 'Rama ya_inscrito resuelta');

  if (res.caso === 'no_registrado') {
    await sendNodeText(node.texto, ctx);
    await persistFlowNode(ctx.conv, 'ya_inscrito');
    return { handled: true };
  }

  if (res.caso === 'elegir_hijo') {
    const opciones = res.alumnos.map((a, i) => `${i + 1}.- ${a.alumno}`).join('\n');
    await sendNodeText(`Veo más de un estudiante registrado con este número 😊 ¿De cuál quieres ver el estatus?\n${opciones}`, ctx);
    await persistFlowNode(ctx.conv, ASK_CHILD);
    return { handled: true };
  }

  return await presentEnrollmentResult(graph, res, ctx);
}

/** Respuesta a "¿de cuál hijo?": indexa contra la MISMA lista (orden de la hoja). */
async function handleChildChoice(text, ctx) {
  const alumnos = await findStudentsByPhone(ctx.phone);
  const digit = text.match(/(\d+)/);
  const pick = digit ? alumnos[parseInt(digit[1], 10) - 1] : null;

  if (!pick) {
    const opciones = alumnos.map((a, i) => `${i + 1}.- ${a.alumno}`).join('\n');
    await sendNodeText(`No identifiqué esa opción 🙏 Responde con el número:\n${opciones}`, ctx);
    return { handled: true }; // seguimos esperando la elección
  }

  const graph = await loadFlowGraph();
  return await presentEnrollmentResult(graph, await resolveForStudent(pick), ctx);
}

/**
 * Presenta el desenlace ya resuelto para UN alumno.
 * Regla dura: los montos solo se envían en el caso 'con_pagos' (match único).
 */
async function presentEnrollmentResult(graph, res, ctx) {
  // El alumno y el papá del registro se guardan en el lead: le sirven a la
  // asesora en el ticket y quedan en la pestaña Leads.
  if (res.alumno?.alumno) await executeCaptureData('traveler_name', res.alumno.alumno, ctx.lead, ctx.conv, ctx.log);
  if (res.alumno?.papa) await executeCaptureData('parent_name', res.alumno.papa, ctx.lead, ctx.conv, ctx.log);
  const colegio = res.pago?.institucion || res.alumno?.colegio;
  if (colegio) await executeCaptureData('school_code', colegio, ctx.lead, ctx.conv, ctx.log);

  if (res.caso === 'con_pagos') {
    const texto = renderNodeText(yaInscritoText(graph, 'ya_inscrito_estatus'), {
      alumno: res.alumno.alumno,
      total_a_pagar: formatMoney(res.pago.total),
      llevan_pagado: formatMoney(res.pago.pagado),
      falta_por_pagar: formatMoney(res.pago.falta),
    });
    await sendNodeText(texto, ctx);
    await persistFlowNode(ctx.conv, 'ya_inscrito_estatus');
    return { handled: true };
  }

  // sin_pagos (incluye el match ambiguo): ni un número, derivación con contexto.
  const nombre = res.alumno?.papa ? ` ${res.alumno.papa.split(' ')[0]}` : '';
  await sendNodeText(renderNodeText(yaInscritoText(graph, 'ya_inscrito_sin_pago'), { nombre }), ctx);

  const motivo = res.ambiguo
    ? `YA INSCRITO — ${res.alumno.alumno}: hay filas de pago duplicadas, revisar manualmente`
    : `YA INSCRITO — ${res.alumno.alumno}: registrado sin pagos registrados`;
  return await runHandoff('handoff_colegio', ctx, motivo, { ticketKind: 'ya_inscrito' });
}

/**
 * ya_inscrito con teléfono NO registrado: capta nombre y colegio como cualquier
 * lead y deriva. TODO(cliente): la consulta a PorCobrar para dar link de pago o
 * etapa sigue pendiente; esto solo cubre lo que la hoja de inscritos permite.
 */
async function handleYaInscrito(text, ctx) {
  const extracted = await extractStructuredFields(text, YA_INSCRITO_FIELDS, ctx.log);
  await applyExtractedFields(extracted, ctx);

  ctx.log.info(
    { leadId: ctx.lead.id, parentName: ctx.lead.parentName, schoolCode: ctx.lead.schoolCode },
    'Ya inscrito sin match por teléfono — registrado para seguimiento',
  );

  const nombre = ctx.lead.parentName ? `, ${ctx.lead.parentName}` : '';
  await sendNodeText(`¡Gracias${nombre}! 🙌 Ya quedó registrado tu caso. Una asesora te dará seguimiento pronto.`, ctx);
  return await runHandoff('handoff_colegio', ctx, 'YA INSCRITO — no encontrado por teléfono en el registro', { ticketKind: 'ya_inscrito' });
}

/**
 * Derivación: reutiliza el handoff tibio de actions.js tal cual está en prod
 * (guard anti-redisparo incluido) y le pasa el track del carrusel según el nodo.
 */
async function runHandoff(nodeId, ctx, reason, options = {}) {
  const track = HANDOFF_TRACKS[nodeId] || 'familia';

  const { handedOff } = await executeHandoffToAdvisor(
    reason,
    ctx.lead,
    ctx.conv,
    ctx.phone,
    ctx.phoneNumberId,
    ctx.log,
    { track, ticketKind: options.ticketKind || ctx.ticketKind },
  );

  if (!handedOff) {
    // Guard anti-redisparo: ya había asesora. executeHandoffToAdvisor no manda
    // mensaje en ese caso — Miri sí responde (igual que el camino LLM).
    const msg = ctx.lead.assignedAdvisor
      ? `Ese detalle lo verá directamente ${ctx.lead.assignedAdvisor}, que ya está en contacto contigo 😊 ¿Te ayudo con algo más mientras tanto?`
      : 'Con gusto te ayudo. ¿Sobre qué programa te gustaría saber más? 😊';
    await sendNodeText(msg, ctx);
  } else if (!isWithinOfficeHours()) {
    // El mensaje de conexión ya lo mandó executeHandoffToAdvisor; este es APARTE.
    await sendNodeText(`Una nota: ${OUT_OF_HOURS_NOTICE}.`, ctx);
  }

  await persistFlowNode(ctx.conv, FREEFORM);
  return { handled: true, handoffOccurred: handedOff };
}

// ── Captura (misma validación que [CAPTURAR_DATO]) ──────────────────────────

/**
 * Aplica cada campo extraído con executeCaptureData COMPLETA — el mismo mapeo,
 * validación y efectos que cuando el LLM emite [CAPTURAR_DATO:campo:valor].
 * @returns {Promise<Array<string>>} campos aplicados
 */
async function applyExtractedFields(extracted, ctx) {
  const applied = [];
  for (const [field, value] of Object.entries(extracted)) {
    if (!value) continue;
    await executeCaptureData(field, value, ctx.lead, ctx.conv, ctx.log);
    applied.push(field);
  }
  return applied;
}
