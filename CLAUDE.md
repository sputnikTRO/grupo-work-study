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

**Única excepción, deliberada y acotada:** `oxford-education/travel-handoff.js`. Las
experiencias internacionales del menú de Ori (English Life, Rising STARS, Global
Insights, Wish and Go) las atiende el equipo de VIAJES, así que ese módulo crea el
`TravelLead`, elige asesora del carrusel de Miri y la notifica con la plantilla y el
`phone_number_id` de Travel. Al prospecto le responde ORI, por su propio chat y su
propio número — si se reusara el handoff de Miri tal cual, el "te conecto con…" le
llegaría desde un número que él nunca escribió. El lead de Oxford queda marcado con la
etiqueta `derivado_travel` pero NO se deriva a una asesora de Oxford: notificar a dos
equipos por el mismo prospecto es peor que no notificar a ninguno.

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
  (estado/país → zona **NORTE/CENTRO/SUR**) + handoff tibio (derivar NO silencia al
  bot; sigue atendiendo después). No rehacer esto — es la fuente de verdad para
  asesores Oxford. Sustituyó a las 4 duplas A/B/C/D: ahora son 3 equipos de tamaño
  distinto (NORTE 4 · CENTRO 2 · SUR 2), así que **nada puede asumir parejas**.
  Detalles que no son obvios leyendo el mapa:
  - **CDMX no es de un solo equipo**: el organigrama la reparte entre NORTE y
    CENTRO, así que `resolveZona` devuelve el centinela `CDMX` y `actions.js`
    alterna por carga. La alcaldía ya NO decide zona (solo sirve para inferir que
    un municipio suelto es de CDMX), y un lead de CDMX sin alcaldía ya se rutea
    en vez de caer al fallback extranjero.
  - **SUR atiende LATAM**: Venezuela, Costa Rica, Colombia, Chile, Ecuador y
    Brasil se rutean como cualquier lead nacional. El resto del mundo sigue con
    `OXED_FOREIGN_LEAD_FALLBACK`.
  - `rol` (coord/front/back) es **informativo**: hoy no altera el ruteo, el
    round-robin mira solo la carga de leads.
- `sheets-sync.js` — upsert de leads a la tab `Leads Oxford` (una fila por lead, keyed
  por ID en columna A). Patrón de referencia para escritura **aditiva/idempotente** a
  Sheets: nunca borra ni reordena, solo agrega columnas/filas faltantes al final.
  Columnas N–R (feature/ori-advisor-sla): tiempos de asignación/confirmación por asesora.
- `advisor-notify.js` (feature/ori-advisor-sla) — `notifyAdvisor` (extraído de
  actions.js, mismo comportamiento) para romper un ciclo de imports con
  `advisor-sla.js`. Notifica al asesor por plantilla aprobada de Meta, con
  fallback a texto libre — el texto libre incluye la instrucción ATIENDO.
  Plantillas de Oxford en la WABA (`OXED_WABA_ID`): `nuevo_lead_oxford_util`
  (**UTILITY**, la que se usa), y `nuevo_lead_oxford` / `nuevo_lead_oxford_sla`
  (MARKETING: Meta no las entrega, **no usarlas**). Ver "Plantillas de aviso a
  asesoras: SIEMPRE UTILITY". Las tres tienen las mismas 8 variables. El
  fallback a texto libre solo entrega dentro de la ventana de 24h.
- `advisor-sla.js` (feature/ori-advisor-sla) — SLA de confirmación de asesor: el
  asesor asignado tiene `OXED_ADVISOR_SLA_MINUTES` (default 10) para responder
  `ATIENDO`; si no, se reasigna automáticamente (recorre el equipo completo y
  luego NORTE→CENTRO→SUR saltando intentados → terminal `sin_confirmar` tras
  agotar los 8). Reutiliza
  `ADVISORS`/`ZONAS`/`ZONA_ORDER` de advisor-zones.js y `notifyAdvisor` de advisor-notify.js
  SIN reimplementarlos. Usa `updateMany` condicional (`currentAttempt`/
  `confirmedAt`) como guard de concurrencia — nunca doble-reasigna ni pisa una
  confirmación real. **BullMQ NO está en el stack** (verificado, no instalado):
  el "job diferido" se traduce a polling con `setInterval` (mismo patrón que
  followup.job.js), leyendo `slaDueAt`/`currentAttempt` guardados en el propio
  lead en vez de un payload de cola externa.
- `sla-hours.js` (feat/ori-sla-horario) — el reloj del SLA solo corre en horario
  laboral, configurable con `OXED_ADVISOR_SLA_HOURS` (default L–V 9–19, S 9–14,
  America/Mexico_City; `off` = siempre). Módulo puro: `buildAssignmentFields` le
  pide el `slaDueAt`. Asignado fuera de horario → vence a la apertura + minutos;
  si el plazo cruza el cierre, se pausa y el resto corre al abrir. La
  notificación a la asesora NO se retrasa y `assignedAt` sigue siendo la hora
  real, así que `responseSeconds` de un lead nocturno incluye la noche. Un
  horario ilegible usa el default y loguea un warn (nunca desactiva la pausa en
  silencio). Los mocks de `env.js` sin esa variable dejan el reloj 24/7.
- `advisor-commands.js` — comandos de asesor por WhatsApp: `PENDIENTES` ·
  `ATIENDO [#]` (feature/ori-advisor-sla, confirma el lead) · `LISTO #` (cierra,
  sin cambios) · `AYUDA`. `REGRESA` es no-op documentado.
- `advisor-sla-sheet.js` (feature/ori-advisor-sla) — visibilidad de tiempos en 2
  pestañas dedicadas del mismo spreadsheet (`OXED_SHEETS_ID`): **"Tiempos
  asesores"** (detalle, una fila por lead derivado, upsert por Ticket) y
  **"Resumen asesoras"** (una fila por asesora de las 8 de `advisor-zones.ADVISORS`,
  RECALCULADA completa desde el detalle en cada escritura y aplicada con el MISMO
  upsert por clave — nunca clear+rewrite masivo). Se escribe en 2 momentos nada
  más: al confirmar (`ATIENDO`, en `advisor-commands.js`) y al llegar al terminal
  `sin_confirmar` (en `advisor-sla.js`) — nunca en cada reasignación intermedia.
  Trae su propia copia de `colLetter`/`PRODUCT_LABELS` (mismo patrón que
  sheets-sync.js/advisor-notify.js) para no tocar esos archivos. Fallback
  seguro: cualquier error de Sheets se loguea y nunca rompe el flujo.
  **Ojo con el truco del apóstrofo** (`'${ticketNumber}` para forzar texto):
  Sheets lo QUITA al guardar — el upsert debe buscar SIN el apóstrofo
  (`findRowByColumn(..., String(ticketNumber))`), y cualquier mock de Sheets en
  tests debe replicar ese stripping o el upsert por ticket numérico se rompe en
  silencio (duplica filas en vez de actualizar) — ver el comentario en
  `scripts/test-oxford-advisor-sla.mjs`.

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
- `scripts/demo-oxford-flow.mjs` / `scripts/demo-oxford-advisor-sla.mjs` — imprimen un
  recorrido legible (mismos mocks, sin WhatsApp/DB/Claude real) para revisión humana,
  no hacen asserts.
- Los mocks de `mock.module` para `actions.js` deben incluir TODOS sus exports
  usados transitivamente (`buildLeadUpdate`, `executeHandoffToAdvisor`) o el
  import estático de `handler.js`/`flow-engine.js` no resuelve — ver el mock de
  `test-oxford-handler.mjs` como referencia. Lo mismo aplica a mocks de
  `advisor-sla.js`/`advisor-notify.js` si se agregan más consumidores.

## Evals (`evals/`)

Harness de conversaciones completas contra el `handleMessage` real de Ori y Miri — ver
`evals/README.md`. Infra propia (`evals/docker-compose.yml`, Postgres :5440 / Redis
:6390); nunca apuntarlo a prod ni a Railway. Lo que no es obvio:
- **No modificar escenarios, asserts ni la rúbrica para que un fix "pase".** Si uno
  parece mal, se discute primero. Correcciones del harness se validan con
  `node --test evals/asserts.test.mjs` y se aplican a corridas viejas con `--rescore`.
- **Regex con acentos: nada de `\b` después de una vocal acentuada.** En JS `\b` es
  ASCII: `/men[uú]\b/` no casa con `*Menú*` y el assert del nudge pasó en verde sin
  contar nada. Usar un lookahead `(?![a-záéíóúñ])`.
- Un assert necesita un caso que lo haga FALLAR en `asserts.test.mjs`; si no, puede
  estar pasando por vacuidad. Igual con los escenarios: `"node"` en los turnos de
  setup evita un verde cuando el flujo ni siquiera llegó al nodo a probar.
- Los errores de Claude se tragan en la app (el extractor devuelve `{}`, el chat
  responde un fallback) — el runner los detecta en el log y marca el turno como
  error. El `ANTHROPIC_MODEL` de un `.env` viejo puede estar retirado (404): el
  harness usa el default de `env.js` o `EVAL_BOT_MODEL`.
- Teléfonos de escenario: `52` + 10 dígitos. `normalizePhone('521…')` agrega un `1`
  de más (`+5211…`).

## Rastro de notificaciones a asesoras (Ori y Miri)

- `src/services/advisor-notification.service.js` + tabla `advisor_notifications`:
  cada notificación de lead a una asesora guarda vía (plantilla/texto libre/no
  salió), plantilla, wamid y el status de entrega que llega por webhook
  (`sent/delivered/read/failed` + código de error). Lo llaman `advisor-notify.js`
  (Ori), `sendAdvisorNotification` (Miri) y los dos webhooks.
- **"Meta aceptó" no es "se entregó"**: la API responde 200 y el rechazo (131049
  límite de marketing, 131047 fuera de 24h) llega después por status. Un `failed`
  se loguea a nivel ERROR con "ALERTA: la notificación a la asesora NO se entregó".
- El servicio **nunca lanza**: si la tabla no existe o la base falla, el handoff y
  el webhook siguen igual. Los mocks de Prisma de los tests no necesitan el modelo.
- `scripts/audit-leads.mjs` (solo lectura) cruza leads, handoffs, SLA y este rastro.

## Diagnóstico de entrega: "aceptado" no es "entregado"

- 18-nov-2026: la causa real de que ningún aviso a asesoras de Ori llegara fue
  **131042 "Business eligibility payment issue"**: la WABA de Oxford no tenía
  método de pago. Meta acepta la plantilla (200 + wamid) y luego la marca
  `failed` por webhook. Los mensajes a prospectos (SERVICE, gratis) sí llegaban,
  y `health_status` de la API decía AVAILABLE: ninguna de las dos cosas descarta
  un problema de pago.
- Los dos webhooks registran cada status a nivel info con `errors[]`
  ("Oxford/Travel message status FAILED"), y cada plantilla aceptada con su
  "to", wamid y wa_id. Ante "no le llegó", buscar primero esas líneas.
- Prueba de control: mandar la plantilla por el mismo código (`notifyAdvisor` /
  `sendAdvisorNotification`) a un número del equipo con datos "PRUEBA" y leer
  el status.

## Plantillas de aviso a asesoras: SIEMPRE UTILITY

- Desde el 5-oct-2026 Meta aceptaba (HTTP 200) los avisos de Ori a las asesoras y
  **no los entregaba**: `nuevo_lead_oxford` fue recategorizada de UTILITY a
  MARKETING y `_sla` nació MARKETING. 0 de ~64 avisos entregados en 5 semanas, sin
  un solo error en logs. Se descubrió con `pricing_analytics` de la WABA (Meta
  solo cobra MARKETING entregado). Prod usa `nuevo_lead_oxford_util` (UTILITY)
  vía `OXED_ADVISOR_SLA_TEMPLATE`; el default de `OXED_ADVISOR_TEMPLATE_NAME`
  también es la `_util`.
- `services/template-health.service.js` + `jobs/template-health.job.js`: al
  arrancar y cada 6 h revisa en Meta que la plantilla que la app usa HOY siga
  UTILITY + APPROVED; si no, log ERROR "ALERTA PLANTILLA". Manual:
  `node scripts/check-advisor-templates.mjs` (exit 1 si hay alerta).
- Nunca editar una plantilla aprobada (vuelve a revisión). Plantilla nueva →
  someter como UTILITY con `allow_category_change: false` (borrador en
  `docs/oxford/plantilla-nuevo-lead-oxford-utility.json`).

## ATIENDO, avisos y reparto de Ori (fix/ori-atiendo-y-avisos)

- **Gana la primera que confirme.** `ATIENDO #` lo puede mandar la asignada actual
  o cualquiera a la que ya se le avisó de ese lead (`triedAdvisorKeys`), también si
  el lead quedó en `sin_confirmar`. El update es condicional a `confirmedAt: null`;
  a quien llega después se le contesta "El lead #N ya lo atiende X". No volver a
  exigir `assignedAdvisor === asesora`: así se rechazó un ATIENDO real en prod.
- **LISTO de una asesora avisada también vale** (fix/listo-tardio, caso real 19-nov:
  Enrique mandó "Listo 6" a un lead en `sin_confirmar` asignado a Paola y se le
  rechazó). Si no es la asignada pero se le avisó y nadie ha confirmado, LISTO toma
  y cierra el lead en un paso, con el mismo guard condicional. "Se le avisó" =
  asignada, en `triedAdvisorKeys`, o con un aviso registrado en
  `advisor_notifications` (p. ej. un reenvío manual).
- El intento de quien tenía el lead en espera queda `cedido` ("lo tomó otra
  asesora"), no `no_confirmo`: no cuenta en "# reasignado por no confirmar".
- **Bitácora** `advisor_commands` (`services/advisor-command.service.js`): todo
  mensaje de una asesora, en ambos bots, con el resultado (aceptado/rechazado +
  motivo). De ahí sale `isAdvisorWindowOpen` (¿escribió en las últimas 24h?).
- **Avisos informativos = texto libre y solo con ventana abierta** ("también se
  ofreció a X", "ya lo atiende X"). Nunca una plantilla por eso: sería un mensaje
  de pago por eslabón. Con la ventana cerrada no se manda nada.
- El aviso de reasignación lleva la **zona del prospecto** (`lead.zoneKey`), no la
  del equipo de la asesora de apoyo; si es de otro equipo, el motivo lo aclara.
- `pickAdvisorRoundRobin` reparte por **primera asignación** (`advisorAttempts[0]`).
  Contar `assignedAdvisor` no sirve: la cadena lo sobreescribe y siempre ganaba la
  primera de la lista.
- `OXED_ADVISOR_DISPATCH_MODE=chain|team` (default `chain`). `team` avisa a todo el
  equipo de la zona a la vez; pendiente de decisión del cliente. En `team`,
  `assignedAdvisor` es solo la etiqueta visible hasta que alguien confirma.
- `message.service.storableContentType`: sticker/video/ubicación/desconocido se
  guardan como `text`; el enum `ContentType` no los acepta y el turno se caía.

## Recordatorio de "Menú" (Ori y Miri)

- Todo lo que se le envía al prospecto en un turno pasa por el guardia de
  `core/flow/nudge.js` (`sendNodeText` → `forNode`, respuesta del LLM →
  `forReply`, recordatorio del handler → `claimReminder`). **No mandar un
  "escribe Menú" por fuera del guardia**: el recordatorio salía de 5 lugares
  (handler, copy del decline, error de nodo, el LLM y el texto de nodos como
  `util_menu`) y cada uno por separado parecía inofensivo.
- El dedupe reconoce la INTENCIÓN por regex de variantes, nunca el texto exacto:
  los nodos los edita el cliente en Sheets.
- Si la respuesta del LLM era SOLO repetir la instrucción, se muestra el menú
  principal (`showMainMenu`) en vez de mandarla otra vez.

## Precios en Miri

- Miri solo cotiza a colegios REGISTRADOS; "otro" o sin colegio siempre deriva,
  incluido el vuelo. **Una regla del prompt no basta si el dato está en el
  prompt**: la FAQ "¿Cuánto cuesta el vuelo?" entraba al conocimiento y el LLM la
  citaba igual. `units/travel/price-guard.js` quita toda fila con montos del
  conocimiento cuando el colegio no está registrado.
- No hardcodear montos de negocio en `prompts.js`: se desfasan del Sheet (el
  prompt decía apartado \$10,000 y la hoja viva \$15,000).

## Qué NO tocar sin coordinar

- `advisor-zones.js` (ruteo geográfico + handoff tibio) — ya en prod, no rehacer.
  `flow-engine.js`/`advisor-sla.js` lo reutilizan vía `executeHandoffToAdvisor`/
  `ADVISORS`/`DUPLAS`, nunca lo reimplementan.
- `advisor-commands.js` (`LISTO`/`PENDIENTES`/comandos existentes) y el guard
  anti-redisparo de `executeHandoffToAdvisor` — la reasignación por SLA es un
  camino aparte (updateMany condicional), nunca un nuevo `[DERIVAR_ASESOR]`.
- Cambios de **contenido** de Ori (textos del flujo) van en la tab "Flujo Ori" de
  Sheets vía `scripts/seed-ori-flow.js`, no hardcodeados en `flow-engine.js`.
- El copy de la plantilla aprobada de WhatsApp (`OXED_ADVISOR_TEMPLATE_NAME`) vive
  en Meta Business Manager, fuera del repo — no se puede inyectar texto libre ahí
  desde código (ver TODO en `advisor-notify.js`).

## Nombres de los asistentes: Ox y Ed (antes Ori y Miri)

- Desde nov-2026 lo que ven prospectos y asesoras dice **Ox** (Oxford Education,
  femenina: "la asistente") y **Ed** (Travel, masculino: "el asistente"). Los
  nombres internos (unidades, archivos, pestañas "Flujo Ori"/"Flujo Miri", tablas,
  carpetas de evals) NO cambian.
- `src/core/ai/persona-name.js` reemplaza el nombre viejo en los turnos del
  asistente del historial que recibe el LLM (los mensajes guardados no se tocan).
  Usa `\b`, así que "Miriana" (asesora) queda intacta.
- Textos del Sheet: `scripts/rename-sheet-personas.mjs` (dry-run por defecto,
  `--confirm` guarda respaldo en `scratchpad/`, `--restore <archivo>`).
- Plantillas: `nuevo_lead_oxford_util` dice "Ori" → la nueva es `nuevo_lead_ox`
  (`docs/templates/`, se somete con `scripts/submit-template.mjs`, dry-run por
  defecto). Ed usa `nuevo_lead_travel_v2`, que no menciona nombre
  (`TRAVEL_ADVISOR_TEMPLATE_V2`).
- El historial reconstruido desde Postgres toma los ÚLTIMOS `MAX_HISTORY`
  mensajes (antes tomaba los primeros).

## W&S OTCC dentro de Ox (`src/units/oxford-education/ws/`)

Base de conocimiento para participantes de Work and Study con dudas de su
certificación Oxford TCC (OTCC). Apagada con `OXED_WS_ENABLED=false` (default).
- **Filtro por intención** (`ws/intent.js`, `ws/flow.js`): activan OTCC, Oxford TCC,
  TCC (no TCC Kids), o "certificación/certificado" JUNTO con Oxford / inglés /
  Work and Study. "Certificación" sola NO activa (son prospectos comerciales).
  Se pregunta UNA vez por conversación; la respuesta queda en
  `conv.metadata.wsFiltro`. "Work and Study" explícito + intención entra sin
  preguntar. "Menú" en lugar de contestar = "no". El gancho va al inicio de
  `tryDeterministicFlow`, ANTES de la salida a modo libre, y también en
  `handleMenuChoice` (nodo Oxford TCC por etiqueta, y filtro_previo → 1).
  `solicitud_datos` SÍ se interrumpe: un participante W&S no da su estado de México.
- **Pregunta retenida**: si se pregunta el filtro, el texto original queda en
  `wsFiltro.pendiente` y se contesta al responder (`replayText` en el resultado).
  Con "no" se re-procesa por el motor normal (`skipWs`), igual que antes.
- **Modo W&S** (`ws/mode.js`, nodos `ws_otcc` / `ws_datos`): prompt AISLADO
  (`ws/prompt.js`) solo con la pestaña "FAQ OTCC W&S" (respaldo:
  `docs/kb-ws-otcc.md`). Nunca entra el prompt comercial ni al revés.
  `ws/guardrails.js` quita nombres/teléfonos del equipo y montos de toda
  respuesta; deja el correo karen.mendez@… que la base indica.
- **Casos** (`ws/cases.js`, tablas `support_cases` / `case_attachments`):
  numeración propia; aviso a Karen → Jorge Gil a los 30 min hábiles
  (`OXED_WS_SUPPORT_CONTACTS`, `OXED_WS_SLA_*`); si nadie confirma, `sin_confirmar`
  sin más avisos. Fuera de horario el aviso sale a la apertura. Poller:
  `src/jobs/ws-cases.job.js`. Comandos de Karen/Jorge en `ws/commands.js`
  (enrutados ANTES que los de asesoras; `advisor_commands.scope = 'caso_ws'`).
- **Capturas**: se descargan de Meta y se guardan en la base. Una plantilla NO
  abre la ventana de 24h: con captura, el aviso usa `OXED_WS_TEMPLATE_IMG`
  (imagen en el encabezado); las demás se reenvían al responder ATIENDO.
- **Imports de namespace** (`import * as wa`, `* as cache`) en `ws/`: los tests
  existentes mockean esos módulos sin las funciones nuevas y un import con
  nombre rompería el arranque.
- Sheet: `scripts/seed-ws-otcc.mjs` (dry-run por defecto; crea la pestaña FAQ,
  agrega nodos `ws_*` a "Flujo Ori", cambia el texto de filtro_previo con
  respaldo/`--restore`, crea "Casos W&S"). Plantillas en `docs/templates/`.
- Tests: `scripts/test-ws-otcc-flow.mjs`, `scripts/test-ws-cases.mjs`,
  `tests/units/oxford-education/ws-*.test.js`.
