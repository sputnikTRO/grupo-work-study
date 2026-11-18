import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisorTemplatesInUse, evaluateTemplate, checkAdvisorTemplates } from '../../src/services/template-health.service.js';

const cfg = {
  WA_API_VERSION: 'v21.0',
  OXED_WABA_ID: 'ox', OXED_ACCESS_TOKEN: 't1', OXED_ADVISOR_SLA_TEMPLATE: 'nuevo_lead_oxford_util', OXED_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_oxford',
  WA_WABA_ID: 'tr', WA_ACCESS_TOKEN: 't2', TRAVEL_ADVISOR_TEMPLATE_V2: '', TRAVEL_ADVISOR_TEMPLATE_NAME: 'nuevo_lead_travel',
};

test('resuelve la plantilla que la app usa de verdad (misma regla que advisor-notify / travel)', () => {
  assert.deepEqual(advisorTemplatesInUse(cfg).map((t) => t.name), ['nuevo_lead_oxford_util', 'nuevo_lead_travel']);
  assert.equal(advisorTemplatesInUse({ ...cfg, OXED_ADVISOR_SLA_TEMPLATE: '' })[0].name, 'nuevo_lead_oxford');
  assert.equal(advisorTemplatesInUse({ ...cfg, TRAVEL_ADVISOR_TEMPLATE_V2: ' nuevo_lead_travel_v2 ' })[1].name, 'nuevo_lead_travel_v2');
});

test('MARKETING o no-APPROVED es alerta; UTILITY + APPROVED está bien', () => {
  assert.equal(evaluateTemplate({ status: 'APPROVED', category: 'UTILITY' }).ok, true);
  assert.match(evaluateTemplate({ status: 'APPROVED', category: 'MARKETING' }).problem, /MARKETING/);
  assert.match(evaluateTemplate({ status: 'PAUSED', category: 'UTILITY' }).problem, /PAUSED/);
  assert.match(evaluateTemplate(null).problem, /no existe/);
});

test('el caso real: nuevo_lead_oxford recategorizada a MARKETING se detecta', async () => {
  const meta = {
    ox: [{ name: 'nuevo_lead_oxford', status: 'APPROVED', category: 'MARKETING', previous_category: 'UTILITY' }],
    tr: [{ name: 'nuevo_lead_travel', status: 'APPROVED', category: 'UTILITY' }],
  };
  const http = async (url, { params }) => ({ data: { data: meta[url.split('/')[4]].filter((t) => t.name === params.name) } });
  const f = await checkAdvisorTemplates({ http, config: { ...cfg, OXED_ADVISOR_SLA_TEMPLATE: '' } });
  assert.equal(f[0].ok, false);
  assert.equal(f[0].previousCategory, 'UTILITY');
  assert.equal(f[1].ok, true);
});

test('si Meta no responde, no truena: el hallazgo queda "sin revisar"', async () => {
  const http = async () => { throw new Error('timeout'); };
  const f = await checkAdvisorTemplates({ http, config: cfg });
  assert.deepEqual(f.map((x) => x.ok), [null, null]);
  assert.match(f[0].problem, /timeout/);
});

test('sin WABA de Travel configurada, se omite sin alertar', async () => {
  const http = async () => ({ data: { data: [{ name: 'nuevo_lead_oxford_util', status: 'APPROVED', category: 'UTILITY' }] } });
  const f = await checkAdvisorTemplates({ http, config: { ...cfg, WA_WABA_ID: undefined } });
  assert.deepEqual([f[0].ok, f[1].ok], [true, null]);
});
