/**
 * Mocks de los BORDES de red para los evals. Todo lo demás corre real: Prisma
 * contra la DB de eval, Redis de eval, cache.js, motores de flujo, actions.js,
 * advisor-zones.js, enrollment.js, prices.js y Claude.
 *
 * Se mockea exactamente lo que sale de la máquina (o lo que no es determinista):
 *   - WhatsApp de Ori (units/oxford-education/whatsapp.js) y de Miri
 *     (core/whatsapp/client.js): capturan cada envío en OUTBOX, nunca llaman a Meta.
 *   - Subida de media a Meta y descarga de Drive.
 *   - Google Sheets (core/sheets/client.js) → fake-sheets.mjs con fixtures.
 *   - Horario de oficina: fijo "dentro de horario" para que dos corridas sean
 *     comparables (el aviso de fuera de horario no depende de la hora del eval).
 *   - Logger: silencioso, pero guarda warn/error para el reporte.
 *
 * Requiere node --experimental-test-module-mocks. Hay que llamar installMocks()
 * ANTES de importar cualquier módulo de src/.
 */
import { mock } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as fakeSheets from './fake-sheets.mjs';

/**
 * Contexto del turno en curso ({ scenario, turn }). run.mjs envuelve cada
 * handleMessage en CTX.run(); así cada envío y cada log queda atribuido a su
 * escenario aunque varios corran en paralelo.
 */
export const CTX = new AsyncLocalStorage();

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;

/** Cada mensaje que "saldría" por WhatsApp: { scenario, turn, unit, kind, to, text, template?, params? }. */
const OUTBOX_RAW = [];
export const OUTBOX = { push: (m) => OUTBOX_RAW.push({ ...CTX.getStore(), ...m }), all: () => OUTBOX_RAW };
/** warn/error del logger de la app, para diagnosticar fallos en el reporte. */
export const LOGS = [];

function makeLogger(bindings = {}) {
  const rec = (level) => (obj, msg) => {
    if (level !== 'warn' && level !== 'error' && level !== 'fatal') return;
    const err = obj?.err;
    LOGS.push({
      ...CTX.getStore(),
      level,
      msg: typeof obj === 'string' ? obj : msg,
      err: err ? `${err.name || 'Error'}: ${err.message}` : undefined,
      bindings,
    });
  };
  const l = {
    trace: rec('trace'), debug: rec('debug'), info: rec('info'),
    warn: rec('warn'), error: rec('error'), fatal: rec('fatal'),
    child: (b) => makeLogger({ ...bindings, ...b }),
    level: 'info',
  };
  return l;
}

let msgSeq = 0;
const fakeWaId = () => `wamid.eval.${++msgSeq}`;

export function installMocks() {
  const logger = makeLogger();
  mock.module(src('utils/logger.js'), { defaultExport: logger, namedExports: { logger } });

  // ── WhatsApp de Ori ────────────────────────────────────────────────────────
  mock.module(src('units/oxford-education/whatsapp.js'), {
    namedExports: {
      sendTextMessage: async (to, text) => {
        OUTBOX.push({ unit: 'ori', kind: 'text', to, text });
        return { messages: [{ id: fakeWaId() }] };
      },
      sendTemplateMessage: async (to, templateName, languageCode, bodyParams = []) => {
        OUTBOX.push({ unit: 'ori', kind: 'template', to, template: templateName, params: bodyParams, text: `[plantilla ${templateName}] ${bodyParams.join(' | ')}` });
        return { messages: [{ id: fakeWaId() }] };
      },
      markMessageAsRead: async () => ({}),
    },
  });

  // ── WhatsApp de Miri (y del handoff cruzado Ori → viajes) ──────────────────
  const templateText = (name, components) => {
    const params = (components || []).flatMap((c) => c.parameters || []).map((p) => p.text ?? p.type);
    return { params, text: `[plantilla ${name}] ${params.join(' | ')}` };
  };
  mock.module(src('core/whatsapp/client.js'), {
    namedExports: {
      sendTextMessage: async (to, text, phoneNumberId) => {
        OUTBOX.push({ unit: 'miri', kind: 'text', to, text, phoneNumberId });
        return { messages: [{ id: fakeWaId() }] };
      },
      sendMediaMessage: async (to, mediaType, mediaId, caption, filename, phoneNumberId) => {
        OUTBOX.push({ unit: 'miri', kind: 'media', to, text: `[${mediaType} ${filename || mediaId}] ${caption || ''}`.trim(), phoneNumberId });
        return { messages: [{ id: fakeWaId() }] };
      },
      sendMediaMessageByUrl: async (to, mediaType, mediaUrl, caption, filename, phoneNumberId) => {
        OUTBOX.push({ unit: 'miri', kind: 'media', to, text: `[${mediaType} ${filename || 'url'}] ${caption || ''}`.trim(), phoneNumberId });
        return { messages: [{ id: fakeWaId() }] };
      },
      sendTemplateMessage: async (to, templateName, languageCode, components, phoneNumberId) => {
        OUTBOX.push({ unit: 'miri', kind: 'template', to, template: templateName, ...templateText(templateName, components), phoneNumberId });
        return { messages: [{ id: fakeWaId() }] };
      },
      markMessageAsRead: async () => ({}),
    },
  });

  mock.module(src('core/whatsapp/media-uploader.js'), {
    namedExports: {
      getOrUploadMedia: async (materialId) => `eval-media-${materialId}`,
      getMimeType: (tipo, url) => (String(url || '').toLowerCase().includes('.png') ? 'image/png' : 'application/pdf'),
    },
  });

  mock.module(src('core/google-drive/client.js'), {
    namedExports: {
      extractFileId: (url) => String(url || '').match(/[-\w]{25,}/)?.[0] || null,
      downloadFile: async () => { throw new Error('Drive deshabilitado en evals'); },
      isGoogleDriveUrl: (url) => /drive\.google\.com/.test(String(url || '')),
    },
  });

  mock.module(src('core/sheets/client.js'), { namedExports: { ...fakeSheets } });

  const OUT_OF_HOURS_NOTICE = 'las asesoras atienden de lunes a viernes de 9:00 a 18:00 (hora del centro de México) y te contactarán en ese horario';
  const officeHours = { isWithinOfficeHours: () => true, OUT_OF_HOURS_NOTICE };
  mock.module(src('core/flow/office-hours.js'), { namedExports: officeHours });
  mock.module(src('units/oxford-education/office-hours.js'), { namedExports: officeHours });
}

/**
 * Red de seguridad adicional a los mocks: cualquier fetch que no vaya a la API
 * de Anthropic revienta. Prisma y ioredis usan sockets propios hacia localhost,
 * no pasan por aquí; Meta y Google sí pasarían, y por eso quedan bloqueados.
 */
export function installNetworkGuard() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const host = new URL(url).hostname;
    if (host !== 'api.anthropic.com') {
      throw new Error(`[eval network guard] salida bloqueada a ${host}`);
    }
    return realFetch(input, init);
  };
}

/**
 * Los console.* que la app emite DENTRO de un turno (p.ej. [MIRI-DEBUG]) van al
 * log del escenario en vez de a la terminal: con varios escenarios en paralelo
 * se intercalan y parecen de otro teléfono. Fuera de un turno se imprimen normal.
 */
export function captureConsole() {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[level].bind(console);
    console[level] = (...a) => {
      const ctx = CTX.getStore();
      if (!ctx) return orig(...a);
      LOGS.push({ ...ctx, level: level === 'error' ? 'error' : 'console', msg: a.map(String).join(' ') });
    };
  }
}
