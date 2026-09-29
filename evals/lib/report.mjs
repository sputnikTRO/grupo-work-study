/**
 * Arma evals/report.md a partir del resultado de una corrida.
 * Pass/fail = solo asserts duros. El juez aparece como columna informativa.
 */

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const quote = (s) => String(s ?? '').split('\n').map((l) => `> ${l}`).join('\n');

function transcript(sc) {
  const bot = sc.unit === 'ori' ? 'Ori' : 'Miri';
  const bad = new Set(sc.checks.filter((c) => !c.pass).flatMap((c) => c.turns));
  return sc.turns.map((t) => {
    const head = `**t${t.i}**${bad.has(t.i) ? ' ⚠️' : ''} · nodo \`${t.nodeBefore ?? '∅'}\` → \`${t.nodeAfter ?? '∅'}\`${t.source === 'sim' ? ' · _simulado_' : ''}`;
    const lines = [
      head,
      '',
      `🧑 ${t.user}`,
      '',
      ...t.bot.map((m) => `${quote(`**${bot}:** ${m}`)}\n`),
      ...t.advisor.map((a) => `${quote(`📣 _a asesora ${a.to}:_ ${a.text.slice(0, 160)}`)}\n`),
      ...(t.error ? [`❌ ${t.error}\n`] : []),
    ];
    return lines.join('\n');
  }).join('\n');
}

export function buildReport(run, previous) {
  const scs = run.scenarios;
  const passed = scs.filter((s) => s.pass).length;
  const failedChecks = scs.reduce((n, s) => n + s.checks.filter((c) => !c.pass).length, 0);

  const out = [];
  out.push(`# Reporte de evals — Ori y Miri`);
  out.push('');
  out.push(`- Corrida: \`${run.runId}\` · ${run.startedAt} · ${Math.round(run.durationMs / 1000)} s`);
  out.push(`- Modelos: bot \`${run.models.bot}\` · prospecto \`${run.models.prospect}\` · juez \`${run.models.judge}\``);
  out.push(`- Rama: \`${run.git.branch}\` @ \`${run.git.sha}\`${run.git.dirty ? ' (con cambios sin commitear)' : ''}`);
  out.push(`- **Escenarios en verde: ${passed}/${scs.length}** · asserts duros fallidos: **${failedChecks}**`);
  if (run.cost) out.push(`- Costo estimado de la corrida: **$${run.cost.total} USD** (${Object.entries(run.cost.byModel).map(([m, u]) => `${m}: ${u.calls} llamadas, $${u.usd}`).join(' · ')})`);
  if (previous) {
    const prevFailed = previous.scenarios.reduce((n, s) => n + s.checks.filter((c) => !c.pass).length, 0);
    const prevPassed = previous.scenarios.filter((s) => s.pass).length;
    const delta = prevFailed - failedChecks;
    out.push(`- Vs corrida anterior (\`${previous.runId}\`): ${prevPassed}/${previous.scenarios.length} en verde, ${prevFailed} asserts fallidos → ${delta > 0 ? `mejoró (−${delta})` : delta < 0 ? `empeoró (+${-delta})` : 'sin cambio'}`);
  }
  out.push('');
  out.push('Pass/fail lo deciden SOLO los asserts determinísticos (`evals/asserts.mjs`). El juez (`evals/judge.mjs`) es informativo: 1–5 en relevancia · veracidad · fluidez · avance.');
  out.push('');

  out.push('## Resumen');
  out.push('');
  out.push('| | Escenario | Unit | Turnos | Asserts fallidos | Juez (prom.) |');
  out.push('|---|---|---|---|---|---|');
  for (const s of scs) {
    const failed = s.checks.filter((c) => !c.pass).map((c) => `\`${c.id}\``).join(', ') || '—';
    const j = s.judge ? (s.judge.error ? `error: ${esc(s.judge.error).slice(0, 40)}` : s.judge.promedio) : 'omitido';
    out.push(`| ${s.pass ? '✅' : '❌'} | \`${s.id}\` — ${esc(s.title)} | ${s.unit} | ${s.turns.length} | ${failed} | ${j} |`);
  }
  out.push('');

  const failing = scs.filter((s) => !s.pass);
  if (failing.length) {
    out.push('## Escenarios que fallan');
    for (const s of failing) {
      out.push('');
      out.push(`### ❌ \`${s.id}\` — ${s.title}`);
      out.push('');
      if (s.regression) out.push(`Regresión: ${s.regression}`);
      out.push('');
      for (const c of s.checks) out.push(`- ${c.pass ? '✅' : '❌'} \`${c.id}\` — ${esc(c.detail)}`);
      if (s.judge && !s.judge.error) {
        out.push('');
        out.push(`Juez: ${['relevancia', 'veracidad', 'fluidez', 'avance'].map((k) => `${k} ${s.judge[k]}`).join(' · ')} — ${esc(s.judge.resumen)}`);
        for (const p of s.judge.problemas || []) out.push(`  - ${esc(p)}`);
      }
      const errs = (s.logs || []).filter((l) => l.level !== 'warn');
      if (errs.length) {
        out.push('');
        out.push('<details><summary>Errores del log de la app</summary>');
        out.push('');
        for (const l of errs.slice(0, 15)) out.push(`- t${l.turn ?? '?'} ${l.level}: ${esc(l.msg)}${l.err ? ` — ${esc(l.err)}` : ''}`);
        out.push('');
        out.push('</details>');
      }
      out.push('');
      out.push('#### Transcripción');
      out.push('');
      out.push(transcript(s));
    }
  }

  out.push('');
  out.push('## Juez — detalle de escenarios en verde');
  out.push('');
  out.push('| Escenario | rel | ver | flu | ava | Observaciones |');
  out.push('|---|---|---|---|---|---|');
  for (const s of scs.filter((x) => x.pass)) {
    const j = s.judge;
    if (!j || j.error) { out.push(`| \`${s.id}\` | | | | | ${j ? esc(j.error) : 'omitido'} |`); continue; }
    out.push(`| \`${s.id}\` | ${j.relevancia} | ${j.veracidad} | ${j.fluidez} | ${j.avance} | ${esc([j.resumen, ...(j.problemas || [])].join(' · '))} |`);
  }
  out.push('');
  return out.join('\n');
}
