#!/usr/bin/env node
/**
 * Somete a Meta una plantilla preparada en docs/templates/<nombre>.json.
 * DRY-RUN por defecto: valida el archivo y muestra lo que se enviaría.
 *
 *   node scripts/submit-template.mjs docs/templates/nuevo_lead_ox.json --waba ox
 *   node scripts/submit-template.mjs docs/templates/nuevo_lead_ox.json --waba ox --confirm
 *
 * --waba ox → OXED_WABA_ID / OXED_ACCESS_TOKEN · --waba ed → WA_WABA_ID / WA_ACCESS_TOKEN
 * Siempre UTILITY con allow_category_change:false (si Meta la quiere recategorizar
 * a MARKETING, la rechaza en vez de cambiarla en silencio: ver CLAUDE.md).
 */
import fs from 'node:fs';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const waba = process.argv[process.argv.indexOf('--waba') + 1];
const CONFIRM = process.argv.includes('--confirm');
if (!file || !['ox', 'ed'].includes(waba)) {
  console.error('Uso: node scripts/submit-template.mjs <archivo.json> --waba ox|ed [--confirm]');
  process.exit(2);
}
const tpl = JSON.parse(fs.readFileSync(file, 'utf8'));
const problems = [];
if (tpl.category !== 'UTILITY') problems.push('category debe ser UTILITY');
if (tpl.allow_category_change !== false) problems.push('allow_category_change debe ser false');
const body = tpl.components?.find((c) => c.type === 'BODY');
if (!body) problems.push('falta BODY');
const vars = new Set([...(body?.text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
if (body?.example?.body_text?.[0]?.length !== vars.size) problems.push(`el ejemplo trae ${body?.example?.body_text?.[0]?.length} valores y el cuerpo ${vars.size} variables`);
if (/\b(Ori|Miri)\b/.test(JSON.stringify(tpl))) problems.push('todavía menciona Ori/Miri');
if (problems.length) { console.error(`❌ ${file}:\n - ${problems.join('\n - ')}`); process.exit(3); }

console.log(`Plantilla ${tpl.name} (${tpl.language}, ${tpl.category}) → WABA ${waba}\n`);
console.log(body.text);
if (!CONFIRM) { console.log('\nDRY-RUN: no se envió a Meta. Agrega --confirm para someterla.'); process.exit(0); }

const id = waba === 'ox' ? process.env.OXED_WABA_ID : process.env.WA_WABA_ID;
const token = waba === 'ox' ? process.env.OXED_ACCESS_TOKEN : process.env.WA_ACCESS_TOKEN;
const res = await fetch(`https://graph.facebook.com/v21.0/${id}/message_templates`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(tpl),
});
const json = await res.json();
console.log(res.ok ? `✅ Sometida: ${JSON.stringify(json)}` : `❌ Meta rechazó: ${JSON.stringify(json.error || json)}`);
process.exit(res.ok ? 0 : 1);
