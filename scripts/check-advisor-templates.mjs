#!/usr/bin/env node
/**
 * check-advisor-templates.mjs — revisa en Meta (solo lectura) que las plantillas
 * de aviso a asesoras que usa la app sigan siendo UTILITY y APPROVED.
 *
 *   node scripts/check-advisor-templates.mjs
 *
 * Sale con código 1 si alguna está mal (útil para un cron). Para revisar con la
 * configuración de prod, exporta las mismas variables que Railway
 * (OXED_ADVISOR_SLA_TEMPLATE, TRAVEL_ADVISOR_TEMPLATE_V2, WA_WABA_ID…).
 */
import 'dotenv/config';
import { checkAdvisorTemplates } from '../src/services/template-health.service.js';

const findings = await checkAdvisorTemplates();
for (const f of findings) {
  const mark = f.ok === true ? '✔' : f.ok === false ? '✖' : '?';
  const detail = f.ok === true ? `${f.category} · ${f.status}` : f.problem;
  const prev = f.previousCategory ? ` (antes: ${f.previousCategory})` : '';
  console.log(`${mark} ${f.unit.padEnd(16)} ${f.name.padEnd(26)} ${detail}${prev}`);
}
process.exit(findings.some((f) => f.ok === false) ? 1 : 0);
