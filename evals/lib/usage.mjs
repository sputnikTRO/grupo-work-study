/**
 * Contabilidad de tokens y costo de una corrida de evals.
 *
 * Intercepta Messages.prototype.create del SDK de Anthropic, que comparten el
 * bot (core/ai/claude.js), el extractor, el prospecto simulado y el juez, así
 * que cada llamada queda sumada por modelo. Sirve para respetar un tope de
 * gasto: el reporte muestra el costo estimado de la corrida.
 */
import Anthropic from '@anthropic-ai/sdk';

// USD por millón de tokens (input, output). Lecturas de caché no se usan hoy.
export const PRICES = {
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5': [2, 10],
};

export const USAGE = {};

export function installUsageTracking() {
  const proto = Anthropic.Messages.prototype;
  const create = proto.create;
  proto.create = function patchedCreate(params, options) {
    const res = create.call(this, params, options);
    // create() devuelve un APIPromise; se suma al resolver sin alterar lo que recibe el llamador.
    Promise.resolve(res).then((msg) => {
      const u = msg?.usage;
      if (!u) return;
      const m = (USAGE[params.model] ||= { calls: 0, input: 0, output: 0 });
      m.calls += 1;
      m.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      m.output += u.output_tokens || 0;
    }, () => {});
    return res;
  };
}

/** { total, byModel: { model: { calls, input, output, usd } } } */
export function costSummary(usage = USAGE) {
  let total = 0;
  const byModel = {};
  for (const [model, u] of Object.entries(usage)) {
    const [pin, pout] = PRICES[model] || [NaN, NaN];
    const usd = (u.input * pin + u.output * pout) / 1e6;
    byModel[model] = { ...u, usd: Math.round(usd * 1000) / 1000 };
    if (Number.isFinite(usd)) total += usd;
  }
  return { total: Math.round(total * 1000) / 1000, byModel };
}
