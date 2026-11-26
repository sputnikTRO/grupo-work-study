/**
 * W&S OTCC — un turno dentro del modo W&S (nodo ws_otcc) y la captura de datos
 * del caso (nodo ws_datos).
 *
 * El LLM recibe SOLO el prompt W&S (prompt.js) y la base W&S; nunca el prompt
 * comercial. Toda respuesta pasa por los guardarraíles de código antes de salir.
 */
import prisma from '../../../core/database/client.js';
import * as conversationService from '../../../services/conversation.service.js';
import * as messageService from '../../../services/message.service.js';
import * as wa from '../whatsapp.js';
import * as store from '../store.js';
import { chat } from '../../../core/ai/claude.js';
import { extractStructuredFields } from '../../../core/flow/extract.js';
import { renameLegacyPersona } from '../../../core/ai/persona-name.js';
import { wsConfig } from './config.js';
import { WS_NODE_IDS as N, WS_TEXTS, CASE_FIELD_LABELS } from './texts.js';
import { saysNotWorkAndStudy, asksForHuman } from './intent.js';
import { buildWsPrompt, stripWsTags, TAG_CANALIZAR, TAG_NO_ES_WS } from './prompt.js';
import { sanitizeWsReply } from './guardrails.js';
import { loadWsKb } from './kb.js';
import { canalizadoMessage } from './hours.js';
import { createCase, deliverNewAttachment } from './cases.js';

const FREEFORM = 'llm_freeform';
export { CASE_FIELDS, normalizeStage, mergeDraft, missingFields } from './draft.js';
import { CASE_FIELDS, mergeDraft, missingFields } from './draft.js';

export function askMissingText(missing) {
  const labels = missing.map((k) => CASE_FIELD_LABELS[k]);
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
  return `Para canalizar tu caso me falta ${list} 🙏`;
}

async function say(ctx, text) {
  if (!text) return;
  await wa.sendTextMessage(ctx.phone, text);
  await messageService.createOutbound(ctx.conv.id, text);
  await store.addMessage(ctx.conv.id, 'assistant', text);
}

/** Empieza a pedir los datos del caso (nodo ws_datos). */
export async function startCapture(ctx, { motivo, seed = null, despues = N.MODO, send = true }) {
  const wsCaso = { motivo, despues, ...(seed && seed.length >= 8 ? { description: seed } : {}) };
  ctx.conv.metadata = await conversationService.mergeMetadata(ctx.conv.id, { wsCaso });
  await conversationService.update(ctx.conv.id, { flowNode: N.DATOS });
  ctx.conv.flowNode = N.DATOS;
  if (send) await say(ctx, WS_TEXTS.pedir_datos);
  ctx.log.info({ motivo }, 'Caso W&S: se piden los datos para canalizar');
}

/** Guarda una captura que mandó el participante (y la reenvía si ya hay quien atiende). */
export async function storeAttachment(ctx, content) {
  if (content.type !== 'image' || !content.mediaUrl) return null;
  try {
    const { buffer, mimeType } = await wa.downloadMedia(content.mediaUrl);
    const open = await prisma.supportCase.findFirst({ where: { conversationId: ctx.conv.id, status: { not: 'resuelto' } }, orderBy: { createdAt: 'desc' } });
    const att = await prisma.caseAttachment.create({
      data: { caseId: open?.id || null, conversationId: ctx.conv.id, waMediaId: content.mediaUrl, mimeType, sizeBytes: buffer.length, data: buffer },
    });
    // Si el caso ya tiene responsable (Karen o Jorge), la captura le llega por
    // WhatsApp, no solo se guarda (así lo pidió el cliente).
    if (open && ['asignado', 'atendiendo'].includes(open.status)) {
      const how = await deliverNewAttachment(open, att);
      ctx.log.info({ caseNumber: open.caseNumber, how }, 'Captura nueva de un caso W&S con responsable');
    }
    return att;
  } catch (err) {
    ctx.log.error({ err }, 'No se pudo guardar la captura del participante W&S');
    return null;
  }
}

async function handleCapture(ctx, text, content) {
  const meta = ctx.conv.metadata || {};
  const isBareImage = content.type === 'image' && (!text || text === '[Imagen]');
  let draft = meta.wsCaso || {};
  if (!isBareImage) draft = mergeDraft(draft, await extractStructuredFields(text, CASE_FIELDS, ctx.log));
  ctx.conv.metadata = await conversationService.mergeMetadata(ctx.conv.id, { wsCaso: draft });

  const missing = missingFields(draft);
  if (missing.length) {
    await say(ctx, `${isBareImage ? `${WS_TEXTS.captura_recibida} ` : ''}${askMissingText(missing)}`);
    return { handoffOccurred: false };
  }
  const c = await createCase({ conv: ctx.conv, contact: ctx.contact, phone: ctx.phone, draft, motivo: draft.motivo || null });
  await say(ctx, canalizadoMessage(new Date(), wsConfig().slaHours));
  const next = draft.despues || N.MODO;
  ctx.conv.metadata = await conversationService.mergeMetadata(ctx.conv.id, { wsCaso: null, wsUltimoCaso: c?.caseNumber ?? null });
  await conversationService.update(ctx.conv.id, { flowNode: next });
  ctx.conv.flowNode = next;
  return { handoffOccurred: true, caseNumber: c?.caseNumber };
}

/**
 * Un turno del modo W&S.
 * @returns {Promise<{ fallbackCommercial?: boolean, handoffOccurred?: boolean }>}
 *   fallbackCommercial → la persona dijo que no es de W&S: el handler contesta con el camino comercial.
 */
export async function processWsTurn({ phone, content, text, conv, lead, contact, log }) {
  const ctx = { phone, conv, lead, contact, log: log.child({ ws: true }) };
  if (content.type === 'image') await storeAttachment(ctx, content);
  await store.addMessage(conv.id, 'user', text);

  if (conv.flowNode === N.DATOS) return await handleCapture(ctx, text, content);

  if (saysNotWorkAndStudy(text)) {
    const { exitMode } = await import('./flow.js');
    await exitMode(ctx, FREEFORM);
    ctx.log.info('Dijo que no es de W&S → sale del modo, sigue el comercial');
    return { fallbackCommercial: true };
  }
  if (asksForHuman(text)) {
    await startCapture(ctx, { motivo: 'pide hablar con una persona', seed: null });
    return { handoffOccurred: false };
  }

  const cfg = wsConfig();
  const { rows, source } = await loadWsKb(ctx.log);
  const system = buildWsPrompt(rows, { now: new Date(), slaHours: cfg.slaHours });
  const history = renameLegacyPersona(await store.getHistory(conv.id), 'oxford_education')
    .map((m) => ({ role: m.role, content: m.content }));
  // El turno actual ya se guardó arriba; no se manda dos veces.
  const last = history[history.length - 1];
  if (last && last.role === 'user' && last.content === text) history.pop();
  const llmText = content.type === 'image' && (!text || text === '[Imagen]') ? '[El participante envió una captura de pantalla]' : text;

  ctx.log.info({ kbSource: source, kbRows: rows.length }, 'Turno W&S → LLM con prompt aislado');
  const raw = await chat(system, history, llmText);

  if (TAG_NO_ES_WS.test(raw || '')) {
    const { exitMode } = await import('./flow.js');
    await exitMode(ctx, FREEFORM);
    return { fallbackCommercial: true };
  }
  const canalizar = TAG_CANALIZAR.exec(raw || '');
  const { text: reply, changed } = sanitizeWsReply(stripWsTags(raw), cfg.contacts);
  if (changed.length) ctx.log.warn({ changed }, 'Guardarraíl W&S: se quitó información del equipo o montos de la respuesta');

  if (canalizar) {
    await say(ctx, reply);
    if (!/correo/i.test(reply)) await say(ctx, WS_TEXTS.pedir_datos);
    await startCapture(ctx, { motivo: (canalizar[1] || '').trim() || 'el asistente no pudo resolverlo', seed: text, send: false });
    return { handoffOccurred: false };
  }
  await say(ctx, reply || 'Con gusto te ayudo con tu certificación. ¿Me cuentas tu duda? 😊');
  return { handoffOccurred: false };
}
