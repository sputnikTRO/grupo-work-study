# Evals de Ori y Miri

Harness que corre conversaciones completas contra el `handleMessage` REAL de cada
unidad, con un prospecto simulado, y decide pass/fail con asserts determinísticos.

```bash
docker compose -f evals/docker-compose.yml up -d        # Postgres :5440 + Redis :6390, solo para evals
DATABASE_URL=postgresql://eval:eval@localhost:5440/gws_eval npx prisma migrate deploy   # una vez
node evals/run.mjs                                      # todos los escenarios → evals/report.md
node evals/run.mjs --only ori-precio-pedido --no-judge  # uno, sin juez
node evals/run.mjs --unit miri --concurrency 2
node evals/run.mjs --rescore [results/run-….json]       # recalcula asserts sin LLM (tras corregir el harness)
node --test evals/asserts.test.mjs                      # tests del propio harness
```

## Qué es real y qué no

| Real | Mockeado (`lib/mocks.mjs`) |
|---|---|
| Handlers, motores de flujo, `actions.js`, `advisor-zones.js`, `enrollment.js`, `prices.js`, `cache.js` | WhatsApp de Ori y de Miri → se capturan los envíos (prospecto y asesoras) |
| Prisma contra la DB de eval, Redis de eval | Google Sheets → `fixtures/sheets.json` (snapshot de contenido) + `fixtures/enrollment.json` (sintético) |
| Claude del bot (modelo de `env.js`, o `EVAL_BOT_MODEL`) | Drive, subida de media, horario de oficina (fijo "en horario") |

Aislamiento: `run.mjs` pisa todas las credenciales de `.env` (Meta, Google, Railway…) con
placeholders, exige que DB y Redis sean `localhost`, y un guard de red bloquea cualquier
`fetch` que no vaya a `api.anthropic.com`. Nunca se envía nada a WhatsApp real.

`fixtures/sheets.json` se regenera con `node evals/fixtures/snapshot-sheets.mjs` (solo
lectura; enmascara teléfonos/correos del equipo; no copia Leads ni la hoja de inscritos).

## Escenarios (`scenarios/<unit>/*.json`)

```jsonc
{
  "id": "ori-precio-pedido", "unit": "ori", "phone": "525580000005",   // 52 + 10 dígitos, único
  "title": "…", "regression": "commit/rama que lo originó",
  "persona": "quién es el prospecto (lo lee el simulador)",
  "start": { "flowNode": "…", "lead": {…}, "history": [{ "role": "user", "content": "…" }] },  // opcional
  "turns": [
    { "say": "2", "node": "solicitud_datos" },   // literal; "node" = nodo al que DEBE llegar
    { "intent": "Insiste en un precio aproximado." }  // lo redacta claude-haiku-4-5
  ],
  "expect": { "no_handoff": true, "handoff": true, "max_handoffs": 1, "no_prices": true,
              "forbidden": [{ "id": "…", "pattern": "regex", "why": "…" }],
              "required":  [{ "id": "…", "pattern": "regex", "why": "…" }] }
}
```

Regla de `"node"`: solo en navegación determinística ANTES de la primera respuesta del
LLM. Después, la ruta depende del modelo (derivar cierra el nodo) y no es un assert.

## Asserts duros (`asserts.mjs`)

Siempre: `sin_ya_en_contacto` · `nudge_max_1_por_turno` · `nudge_max_1_por_nodo` ·
`cta_pregunta_no_es_decline` · `sin_errores_de_turno` · `ruta_esperada` (si hay `"node"`).
Ori además `sin_precios`; Miri además `financieros_solo_match_unico`. Más los del bloque `expect`.

El juez (`judge.mjs`, claude-sonnet-5) califica relevancia · veracidad · fluidez · avance
y solo reporta: nunca cambia el pass/fail.
