/**
 * W&S OTCC — filtro por intención (dentro del motor del "Flujo Ox").
 *
 * La base W&S es solo para inscritos en Work and Study; la FAQ general de
 * Oxford TCC sigue abierta a cualquiera. El filtro se dispara cuando la persona
 * pregunta por la certificación (texto libre, el nodo Oxford TCC del menú, o la
 * opción 1 de filtro_previo) y se hace UNA vez por conversación. La respuesta
 * queda en conv.metadata.wsFiltro:
 *   { preguntadoAt, via: 'texto'|'inicio'|'menu'|'filtro_previo'|'explicito',
 *     pendiente?: { texto?, nodo?, volverA }, reintentos, respuesta?: 'ws'|'no'|'no_seguro', respondidoAt? }
 *
 * Contrato de resultado (lo consume handler.js):
 *   { handled: true }                          → turno atendido
 *   { handled: false, ws: true, replayText? }  → contesta el modo W&S (con replayText si hay pregunta pendiente)
 *   { handled: false, ..., replayText? }       → camino de siempre, contestando replayText
 *   null                                       → el filtro no aplica: sigue el motor normal
 *
 * Las funciones del motor (enviar nodo, saltar, etc.) llegan como `h` para no
 * crear un import circular con flow-engine.js.
 */
import * as conversationService from '../../../services/conversation.service.js';
import * as store from '../store.js';
import { isWsEnabled } from './config.js';
import { WS_NODE_IDS as N, WS_TEXTS } from './texts.js';
import {
  detectOtccIntent, parseFiltroAnswer, parseNoSeguroAnswer, parseTemaAnswer,
} from './intent.js';
import { startCapture } from './mode.js';

const FILTER_NODES = new Set([N.FILTRO, N.FILTRO_PROGRAMA, N.NO_SEGURO, N.TEMA]);
export const WS_MODE_NODES = new Set([N.MODO, N.DATOS]);
export const isWsNode = (id) => FILTER_NODES.has(id) || WS_MODE_NODES.has(id);
// Pasos de captura que NO se interrumpen con el filtro. solicitud_datos sí se
// interrumpe: un participante W&S que entró por "Quiero información" no debe
// dar su estado de México antes de que se active el filtro.
const NO_INTERRUMPIR = new Set(['ya_inscrito_stub']);

const filtroOf = (conv) => (conv.metadata && conv.metadata.wsFiltro) || {};

async function saveFiltro(ctx, patch) {
  const wsFiltro = { ...filtroOf(ctx.conv), ...patch };
  for (const k of Object.keys(wsFiltro)) if (wsFiltro[k] === undefined) delete wsFiltro[k];
  ctx.conv.metadata = await conversationService.mergeMetadata(ctx.conv.id, { wsFiltro });
}

async function answer(ctx, respuesta) {
  await saveFiltro(ctx, { respuesta, respondidoAt: new Date().toISOString(), pendiente: respuesta === 'no_seguro' ? filtroOf(ctx.conv).pendiente : undefined });
}

export function nodeText(graph, h, id) {
  return (graph && h.getNode(graph, id)?.texto) || WS_TEXTS[id];
}

async function ask(ctx, graph, h, nodeId, { via, pendiente = undefined }) {
  await h.sendNodeText(nodeText(graph, h, nodeId), ctx);
  await h.persistFlowNode(ctx.conv, nodeId);
  await saveFiltro(ctx, { preguntadoAt: new Date().toISOString(), via, pendiente, reintentos: 0 });
  ctx.log.info({ nodeId, via }, 'Filtro W&S: se pregunta si forma parte de Work and Study');
  return { handled: true };
}

/** Entra al modo W&S-OTCC. Sin pregunta pendiente manda el texto de entrada. */
export async function enterMode(ctx, graph, h, { entryText = true } = {}) {
  ctx.conv.metadata = await conversationService.mergeMetadata(ctx.conv.id, { programa: 'ws', tema: 'otcc' });
  await h.persistFlowNode(ctx.conv, N.MODO);
  if (entryText) await h.sendNodeText(nodeText(graph, h, N.MODO), ctx);
  ctx.log.info('Modo W&S-OTCC activado');
}

/** Sale del modo W&S (dijo que no es de W&S): el resto es comercial, como un "No". */
export async function exitMode(ctx, nextNode) {
  ctx.conv.metadata = await conversationService.mergeMetadata(ctx.conv.id, {
    programa: null, tema: null, wsCaso: null,
    wsFiltro: { ...filtroOf(ctx.conv), respuesta: 'no', respondidoAt: new Date().toISOString(), pendiente: undefined },
  });
  await conversationService.update(ctx.conv.id, { flowNode: nextNode });
  ctx.conv.flowNode = nextNode;
}

async function retryOrNull(ctx, graph, h, nodeId) {
  const f = filtroOf(ctx.conv);
  if ((f.reintentos || 0) < 1) {
    await saveFiltro(ctx, { reintentos: (f.reintentos || 0) + 1 });
    await h.sendNodeText(`${WS_TEXTS.reintento}\n\n${nodeText(graph, h, nodeId)}`, ctx);
    return { handled: true };
  }
  ctx.log.info({ nodeId }, 'Filtro W&S: segunda respuesta que no se entiende → cuenta como "no"');
  return null;
}

async function resolve(ctx, graph, h, ans) {
  const { via, pendiente } = filtroOf(ctx.conv);
  if (ans === 'no_seguro') {
    await h.sendNodeText(nodeText(graph, h, N.NO_SEGURO), ctx);
    await h.persistFlowNode(ctx.conv, N.NO_SEGURO);
    return { handled: true };
  }
  await answer(ctx, ans);
  ctx.log.info({ respuesta: ans, via }, 'Filtro W&S respondido');

  if (ans === 'ws') {
    if (via === 'filtro_previo') {
      await h.sendNodeText(nodeText(graph, h, N.TEMA), ctx);
      await h.persistFlowNode(ctx.conv, N.TEMA);
      return { handled: true };
    }
    if (pendiente?.texto) {
      await enterMode(ctx, graph, h, { entryText: false });
      return { handled: false, ws: true, replayText: pendiente.texto };
    }
    await enterMode(ctx, graph, h);
    return { handled: true };
  }

  // ans === 'no' → flujo comercial, exactamente como hoy
  if (via === 'filtro_previo') return await h.jumpToNode(graph, 'ya_inscrito_stub', ctx);
  if (via === 'menu' && pendiente?.nodo) return await h.jumpToNode(graph, pendiente.nodo, ctx);
  if (via === 'inicio') {
    await h.sendNodeText(nodeText(graph, h, 'filtro_previo') || '', ctx);
    await h.persistFlowNode(ctx.conv, 'filtro_previo');
    return { handled: true };
  }
  await h.persistFlowNode(ctx.conv, pendiente?.volverA || h.FREEFORM);
  if (!pendiente?.texto) return { handled: true };
  const res = await h.replay(pendiente.texto);
  return res.handled ? res : { ...res, replayText: pendiente.texto };
}

async function answerNode(ctx, graph, h, nodeId, text) {
  if (nodeId === N.FILTRO || nodeId === N.FILTRO_PROGRAMA) {
    const ans = parseFiltroAnswer(text) || (await retryOrNull(ctx, graph, h, nodeId)) || 'no';
    if (typeof ans === 'object') return ans;
    return await resolve(ctx, graph, h, ans);
  }
  if (nodeId === N.NO_SEGURO) {
    const ans = parseNoSeguroAnswer(text) || (await retryOrNull(ctx, graph, h, nodeId)) || 'no';
    if (typeof ans === 'object') return ans;
    if (ans === 'canalizar') {
      await answer(ctx, 'no_seguro');
      await startCapture(ctx, { motivo: 'no está seguro de formar parte de W&S', seed: null, despues: h.FREEFORM, send: true, sendNodeText: h.sendNodeText });
      return { handled: true };
    }
    return await resolve(ctx, graph, h, ans);
  }
  if (nodeId === N.TEMA) {
    const ans = parseTemaAnswer(text) || (await retryOrNull(ctx, graph, h, nodeId)) || 'otro';
    if (typeof ans === 'object') return ans;
    if (ans === 'otcc') { await enterMode(ctx, graph, h); return { handled: true }; }
    return await h.jumpToNode(graph, 'ya_inscrito_stub', ctx); // Life y otros temas: flujo actual
  }
  return null;
}

/**
 * Gancho al inicio de tryDeterministicFlow (antes de la salida a modo libre,
 * que si no mandaría directo al LLM comercial y el filtro nunca se vería).
 */
export async function handleWsTurn({ text, ctx, graph, currentFlowNode, menuKeyword, h }) {
  if (!isWsEnabled()) return null;
  const f = filtroOf(ctx.conv);

  if (FILTER_NODES.has(currentFlowNode)) {
    if (menuKeyword) { // "Menú" en vez de contestar = "no" (aprobado); el menú lo muestra el motor
      if (!f.respuesta || f.respuesta === 'no_seguro') await answer(ctx, 'no');
      return null;
    }
    await store.addMessage(ctx.conv.id, 'user', text);
    return await answerNode(ctx, graph, h, currentFlowNode, text);
  }
  if (WS_MODE_NODES.has(currentFlowNode)) return menuKeyword ? null : { handled: false, ws: true };
  if (menuKeyword || NO_INTERRUMPIR.has(currentFlowNode)) return null;

  const intent = detectOtccIntent(text);
  if (!intent.otcc) return null;
  if (f.respuesta === 'no' && !intent.ws) return null; // ya respondió "no": comercial, sin volver a preguntar

  if (f.respuesta === 'ws' || intent.ws) {
    if (f.respuesta !== 'ws') {
      await saveFiltro(ctx, { preguntadoAt: f.preguntadoAt || null, via: 'explicito', pendiente: undefined, respuesta: 'ws', respondidoAt: new Date().toISOString() });
      ctx.log.info('Filtro W&S: el mensaje ya dice Work and Study → entra directo sin preguntar');
    }
    if (!currentFlowNode) await h.sendNodeText(nodeText(graph, h, 'bienvenida') || '', ctx);
    await enterMode(ctx, graph, h, { entryText: false });
    return { handled: false, ws: true, replayText: text };
  }

  if (!currentFlowNode) {
    await h.sendNodeText(nodeText(graph, h, 'bienvenida') || '', ctx);
    return await ask(ctx, graph, h, N.FILTRO, { via: 'inicio', pendiente: { texto: text, volverA: null } });
  }
  return await ask(ctx, graph, h, N.FILTRO, { via: 'texto', pendiente: { texto: text, volverA: currentFlowNode } });
}

/**
 * Gancho en handleMenuChoice, antes de saltar al destino elegido:
 *   - filtro_previo → 1 ("Ya formo parte de un programa") → variante del filtro.
 *   - un producto cuya etiqueta es Oxford TCC → filtro antes de mostrar la ficha.
 */
export async function interceptMenuChoice({ graph, fromNode, destId, ctx, h }) {
  if (!isWsEnabled()) return null;
  const f = filtroOf(ctx.conv);

  if (fromNode.id === 'filtro_previo' && destId === 'ya_inscrito_stub') {
    if (f.respuesta === 'no') return null;
    if (f.respuesta === 'ws') {
      await h.sendNodeText(nodeText(graph, h, N.TEMA), ctx);
      await h.persistFlowNode(ctx.conv, N.TEMA);
      return { handled: true };
    }
    return await ask(ctx, graph, h, N.FILTRO_PROGRAMA, { via: 'filtro_previo' });
  }

  if (h.productKeyForNode(graph, destId) === 'oxford_tcc') {
    if (f.respuesta === 'no') return null;
    if (f.respuesta === 'ws') { await enterMode(ctx, graph, h); return { handled: true }; }
    return await ask(ctx, graph, h, N.FILTRO, { via: 'menu', pendiente: { nodo: destId, volverA: fromNode.id } });
  }
  return null;
}
