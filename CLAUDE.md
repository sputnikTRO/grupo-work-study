# CLAUDE.md

Monolito Node.js/Fastify que corre bots de WhatsApp conversacionales (Claude AI) para
Grupo Work & Study. Multi-unidad: cada unidad de negocio es un bot independiente que
comparte infraestructura (Fastify, Postgres/Prisma, Redis, Google Sheets, WhatsApp
Cloud API) pero tiene su propio número, prompt y lógica.

## Unidades activas

- **`travel`** ("Miri") — `src/units/travel/` — English 4 Life / viajes educativos.
- **`oxford-education`** ("Ori") — `src/units/oxford-education/` — Oxford Education Lit
  (certificaciones, plataformas EdTech, experiencias internacionales). Webhook propio en
  `/webhook/oxford` (`src/routes/oxford-webhook.js`), credenciales `OXED_*` en `.env`.

No mezclar datos ni credenciales entre unidades — Oxford tiene su propio tab de Sheets
(`Leads Oxford`) y sus propias credenciales de WhatsApp (`OXED_PHONE_NUMBER_ID`, etc.),
aisladas de Travel a propósito.

## Oxford Education (Ori) — piezas clave

- `handler.js` — orquesta el turno: primero intenta la capa determinística
  (`flow-engine.js`); si no aplica, cae al camino LLM de siempre (`processWithAI`:
  arma prompt, llama a Claude, ejecuta acciones, sincroniza a Sheets).
- `flow-engine.js` (feature/ori-flow-redesign) — máquina de estados determinística que
  recorre el grafo de `flow-content.js` con textos **verbatim** de Sheets. Guarda el
  nodo actual en `conversation.flowNode` (Prisma, aditivo/nullable). Reutiliza —nunca
  reimplementa— `executeHandoffToAdvisor`/`buildLeadUpdate` de `actions.js` para el
  handoff/captura, así el ruteo geográfico y el handoff tibio quedan intactos sin
  importar si el dato lo capturó el LLM o el flujo. Si el Sheet no carga o el mensaje
  no es número/"Menú"/CTA claro, cede el turno COMPLETO a `processWithAI` (fallback
  seguro — nunca tumba el bot).
- `flow-content.js` — parsea las filas de la tab **"Flujo Ori"** (cache de Sheets) a un
  grafo `{id: {texto, opciones}}`. Devuelve `null` si faltan nodos requeridos
  (`bienvenida`, `filtro_previo`) — señal para que `flow-engine.js` ceda al LLM.
- `office-hours.js` — `isWithinOfficeHours()` (lun–vie 9–18 America/Mexico_City), puro,
  solo decide si se agrega el aviso de horario al derivar fuera de ese rango. Ori sigue
  atendiendo 24/7 siempre; esto nunca silencia nada.
- `prompts.js` — system prompt de Ori (identidad + catálogo hardcodeado + reglas). Es el
  RESPALDO del flujo determinístico (extracción estructurada, CTAs ambiguos, y
  cualquier mensaje fuera de guion) — ya no es el único camino, pero sigue siendo la
  fuente de verdad conversacional.
- `knowledge.js` + `src/core/sheets/cache.js` — conocimiento dinámico: lee la tab
  **"FAQ Oxford"** de Sheets (con fallback triple: Redis → backup en memoria → prompt
  hardcodeado si todo falla) y lo inyecta al prompt.
- `actions.js` — procesa las etiquetas `[CAPTURAR_DATO:...]` y `[DERIVAR_ASESOR:...]`
  que emite el LLM. `buildLeadUpdate` y `executeHandoffToAdvisor` están **exportadas**
  (antes privadas) específicamente para que `flow-engine.js` las reutilice.
- `advisor-zones.js` — **ya en prod**: registro de asesores + ruteo geográfico
  (estado/alcaldía → dupla A/B/C/D) + handoff tibio (derivar NO silencia al bot; sigue
  atendiendo después). No rehacer esto — es la fuente de verdad para asesores Oxford.
- `sheets-sync.js` — upsert de leads a la tab `Leads Oxford` (una fila por lead, keyed
  por ID en columna A). Patrón de referencia para escritura **aditiva/idempotente** a
  Sheets: nunca borra ni reordena, solo agrega columnas/filas faltantes al final.

### Grafo del flujo ("Flujo Ori")

Sembrado por `scripts/seed-ori-flow.js` (ver sección siguiente). Nodos especiales que
`flow-engine.js` trata distinto de un menú numerado genérico:
- `ya_inscrito_stub` — capta nombre/colegio, marca `status: 'primer_contacto'` +
  tags `ya_inscrito`/`seguimiento_pendiente`. **TODO(cliente):** cablear la consulta al
  Sheet de "por cobrar" para dar el link de pago o la etapa. NO dispara handoff
  geográfico (no hay ciudad/estado en ese camino).
- `solicitud_datos` — extrae nombre/puesto/colegio/state/municipality vía LLM
  (extractor estructurado, no la persona de Ori) y captura con `buildLeadUpdate` — el
  MISMO mapeo que usa `[CAPTURAR_DATO]`, así llega igual a `advisor-zones.js`.
- Nodos hoja de producto (`n_*_*`, terminan en "¿hablar con un asesor?") — CTA sí/no
  clasificado de forma determinista (regex conservador); ambiguo → respaldo LLM.
- `"Menú"` (insensible a mayúsculas/acentos) — override global a `menu_principal`
  desde cualquier nodo, incluido modo libre.

## Contenido/KB en Google Sheets

El contenido de Ori se siembra vía scripts idempotentes en `scripts/`, usando una
cuenta de servicio de Google (`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`).

- `scripts/seed-oxford-faq.js` — siembra la tab **"FAQ Oxford"** (Programa | Categoría |
  Pregunta | Respuesta | Orden) desde `docs/oxford/faq-productos.md`. Soporta
  `--dry-run`. **Nota:** este script es idempotente en el sentido de "mismo resultado
  en cada corrida" porque hace `clear` + rewrite completo — apto para una tab que solo
  edita el script, NO para una tab editable por el cliente (perdería sus ediciones).
- `scripts/verify-oxford-sheet.mjs` — valida la tab tras sembrar.
- `scripts/seed-ori-flow.js` — siembra la tab **"Flujo Ori"** (ID | Estado | Texto |
  Destino opción 1..5 | Notas | Orden), el guion por nodos que recorre `flow-engine.js`.
  Editable por el cliente: **aditivo de verdad** (no solo "mismo resultado por
  corrida") — si el ID ya existe en el Sheet, NO lo toca (respeta ediciones del
  cliente); solo hace `append` de los nodos nuevos. Soporta `--dry-run` (compara
  contra el Sheet real y marca cada nodo NUEVO/YA EXISTE).
- Para tabs pensadas para que el cliente edite a mano en Sheets, seguir el patrón
  **aditivo** de `sheets-sync.js`/`seed-ori-flow.js` (upsert o insert-if-missing por
  clave, nunca clear+rewrite).

Spreadsheet: `OXED_SHEETS_ID` (default: `GOOGLE_SHEETS_ID`, mismo spreadsheet que
Travel pero en tabs dedicadas).

## Convenciones

- Vars de entorno de Oxford: prefijo `OXED_*` (ver `.env.example`).
- Nombres de tabs de Sheets van hardcodeados como constante en cada script/módulo
  (p. ej. `SHEET_NAME = 'FAQ Oxford'`), no en `env.js`, salvo que ya exista un override
  (p. ej. `OXED_LEADS_SHEET_NAME`).
- Scripts de siembra/verificación se corren directo con `node scripts/<archivo>.js`
  (no están registrados en `package.json`).
- Commits en español, formato `tipo(unidad): descripción` (p. ej.
  `feat(oxford): ruteo geográfico de asesor + handoff tibio para Ori`).

## Testing (Oxford)

Dos convenciones conviven en el repo:
- `tests/**/*.test.js` — suite estándar (`npm test` = `node --test tests/**/*.test.js`).
  **Ojo:** ese glob NO es recursivo bajo `sh` (el shell que usa npm) — solo matchea un
  nivel de subcarpeta (`tests/*/*.test.js`), así que archivos a 2+ niveles (como
  `tests/units/oxford-education/*.test.js`) nunca se ejecutan con `npm test` tal cual
  está hoy. Para correrlos de verdad: `node --test $(find tests -name "*.test.js")`.
- `scripts/test-oxford-*.mjs` — regresiones que necesitan `mock.module` (requiere
  `node --experimental-test-module-mocks`) para correr el **handler real**
  (`handleMessage`) con DB/Redis/WhatsApp/Claude mockeados pero `actions.js` +
  `advisor-zones.js` reales, así se prueba el ruteo geográfico/handoff de verdad.
  Se corren uno por uno, no están en `package.json`.
- Sin Redis real disponible (p. ej. este sandbox), `node --test` sobre archivos que
  tocan `core/sheets/cache.js`/`core/database/redis.js` sin mockear se queda colgado
  (ioredis reintenta infinito) — usar `--test-force-exit`.
- `scripts/demo-oxford-flow.mjs` — imprime un recorrido de conversación legible
  (mismos mocks, sin WhatsApp/DB/Claude real) para revisión humana, no hace asserts.

## Qué NO tocar sin coordinar

- `advisor-zones.js` (ruteo geográfico + handoff tibio) — ya en prod, no rehacer.
  `flow-engine.js` lo reutiliza vía `executeHandoffToAdvisor`, nunca lo reimplementa.
- Cambios de **contenido** de Ori (textos del flujo) van en la tab "Flujo Ori" de
  Sheets vía `scripts/seed-ori-flow.js`, no hardcodeados en `flow-engine.js`.
