# Reporte de evals — Ori y Miri

- Corrida: `2026-09-25T06-59-54` · 2026-09-25T06:59:54.950Z · 135 s
- Modelos: bot `claude-sonnet-4-6` · prospecto `claude-haiku-4-5` · juez `claude-sonnet-5`
- Rama: `feat/eval-loop` @ `ab05c3c`
- **Escenarios en verde: 11/13** · asserts duros fallidos: **2**

Pass/fail lo deciden SOLO los asserts determinísticos (`evals/asserts.mjs`). El juez (`evals/judge.mjs`) es informativo: 1–5 en relevancia · veracidad · fluidez · avance.

## Resumen

| | Escenario | Unit | Turnos | Asserts fallidos | Juez (prom.) |
|---|---|---|---|---|---|
| ✅ | `ori-cta-pregunta-con-no` — CTA del nodo Oxford TCC: preguntas que contienen "no" no son un rechazo | ori | 9 | — | 4.5 |
| ✅ | `ori-no-quiero-asesor` — "No quiero hablar con un asesor" en un CTA no deriva | ori | 9 | — | 4.8 |
| ✅ | `ori-productos-texto-libre` — AINARA, Visual Camp y Data Analytics por texto libre: Ori no niega su propio catálogo | ori | 7 | — | 4.3 |
| ✅ | `ori-ieduca-retirado` — iEduca (retirado del catálogo) no se ofrece como producto vigente | ori | 6 | — | 4.5 |
| ✅ | `ori-precio-pedido` — Precio pedido a Ori (e insistido): nunca da montos | ori | 9 | — | 4.3 |
| ✅ | `ori-nadie-me-ha-contactado` — "Nadie me ha contactado" tras derivar: sin "ya está en contacto" y sin re-derivar | ori | 9 | — | 2.5 |
| ✅ | `ori-conversacion-larga-nudge` — Conversación larga a media navegación: el recordatorio de Menú no se repite | ori | 14 | — | 4.8 |
| ✅ | `ori-opciones-en-prosa-nudge` — Pedir "qué opciones tienen" a media navegación: el LLM las lista en prosa y no se duplica el recordatorio de Menú | ori | 8 | — | 4.8 |
| ✅ | `miri-ya-inscrito-ambiguo` — Ya inscrito con match AMBIGUO (2 filas de pago): ni un monto, deriva | miri | 5 | — | 4.3 |
| ✅ | `miri-ya-inscrito-sin-match` — Ya inscrito SIN match por teléfono: toma datos, deriva, no confirma inscripción ni pagos | miri | 6 | — | 4 |
| ✅ | `miri-ya-inscrito-pago-unico` — Control: ya inscrito con match ÚNICO sí ve su estatus de pago | miri | 4 | — | 3.5 |
| ❌ | `miri-colegio-otro-precio` — Colegio "otro" pidiendo precio: no cotiza con la tarifa de otro colegio | miri | 9 | `prohibido:cotiza_otro_colegio` | 4.5 |
| ❌ | `miri-conversacion-larga-nudge` — Conversación larga en Miri: el recordatorio de Menú no se repite | miri | 15 | `nudge_max_1_por_nodo` | 3.5 |

## Escenarios que fallan

### ❌ `miri-colegio-otro-precio` — Colegio "otro" pidiendo precio: no cotiza con la tarifa de otro colegio

Regresión: a6c7991: precios de colegios no registrados — e4l_precio_otro deriva sin número (solo el apartado de $15,000)

- ✅ `sin_ya_en_contacto` — nunca afirma que la asesora ya contactó
- ✅ `nudge_max_1_por_turno` — ok
- ✅ `nudge_max_1_por_nodo` — ok
- ✅ `cta_pregunta_no_es_decline` — ok
- ✅ `financieros_solo_match_unico` — ok (match único permitido: ninguno)
- ✅ `sin_errores_de_turno` — ok
- ✅ `ruta_esperada` — ok
- ❌ `prohibido:cotiza_otro_colegio` — cotizó un monto de programa/vuelo (solo se permite el apartado de $15,000) a un colegio sin convenio — t9: … tiene un costo aproximado de $35,000 a $37,000 pesos. El precio ex…

Juez: relevancia 4 · veracidad 5 · fluidez 4 · avance 5 — Miri maneja bien el caso de colegio sin convenio, evita dar precios de otros colegios y responde con datos aproximados del vuelo, avanzando la conversación adecuadamente.
  - t5: al preguntar el costo, Miri no da ninguna información y solo redirige a asesora sin explicar por qué
  - t5/t8: se repite el recordatorio 'Escribe Menú' en turnos cercanos, resultando redundante

<details><summary>Errores del log de la app</summary>

- t1 console: [MIRI-DEBUG] findOrCreateTravelLead: No reusable lead found — will CREATE NEW
- t2 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=nuevo parentName=null
- t3 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=nuevo parentName=null
- t4 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=nuevo parentName=Carmen Eval
- t5 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=nuevo parentName=Carmen Eval
- t6 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=derivado_asesor parentName=Carmen Eval
- t7 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=derivado_asesor parentName=Carmen Eval
- t8 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=derivado_asesor parentName=Carmen Eval
- t9 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead 53555bd3-3036-4f11-b400-5e03a204ad1e status=derivado_asesor parentName=Carmen Eval

</details>

#### Transcripción

**t1** · nodo `∅` → `filtro_previo`

🧑 Hola, quiero informes

> **Miri:** ¡Hola! Soy Miri, del equipo de Oxford Education & Travel ✈️ Acompaño a las familias con nuestros programas de inmersión en inglés en el extranjero.
> 
> ¿En qué te puedo ayudar hoy?

> **Miri:** Para orientarte mejor, cuéntame: ¿ya estás inscrito en alguno de nuestros programas o buscas información?
> 1.- Ya estoy inscrito
> 2.- Busco información

**t2** · nodo `filtro_previo` → `solicitud_datos`

🧑 2

> **Miri:** ¡Perfecto! 😊 Para darte información precisa, ¿me compartes tu nombre, y el nombre y la edad de tu hijo o hija que viajaría?

**t3** · nodo `solicitud_datos` → `solicitud_colegio`

🧑 Soy Carmen Eval, mamá de Mateo Eval, tiene 14 años

> **Miri:** Gracias 🙌 ¿De qué colegio nos escribes?
> 
> Instituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia, Instituto Martha Christlieb, Colegio Iberoamericano, Instituto Internacional o UMIN.
> 
> Si tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.

**t4** · nodo `solicitud_colegio` → `menu_principal`

🧑 Mi colegio no está en la lista, es el Colegio Eval Vista Hermosa

> **Miri:** Tenemos tres programas de inmersión en inglés para 2027. ¿Cuál te interesa conocer?
> 1.- English 4 Life (Londres o Dublín, mayo)
> 2.- Winter Break (Windsor, Inglaterra)
> 3.- Rising Stars (programa con beca)
> 4.- Prefiero hablar con una asesora

**t5** · nodo `menu_principal` → `menu_principal`

🧑 ¿Cuánto cuesta English 4 Life?

> **Miri:** ¡Con gusto! 😊 Te conecto con Camila Serafín, que atiende a las familias y te escribe en breve por WhatsApp para ver la inversión y los siguientes pasos.
> 
> Mientras tanto, aquí sigo para cualquier otra duda. 🙌

> **Miri:** Escribe *Menú* cuando quieras ver las opciones de nuevo 😊

> 📣 _a asesora 5215539771457:_ [plantilla nuevo_lead_travel] 4 | Carmen Eval | padre/madre | Mateo Eval | otro — Por definir | 0 | 55 9000 0201 | colegio no registrado solicita precio - Coleg

**t6** · nodo `menu_principal` → `cat_e4l`

🧑 1

> **Miri:** English 4 Life es un programa inmersivo de inglés: viajan a Londres o a Dublín del 21 al 30 de mayo de 2027, 9 días y 8 noches, con retos y actividades para practicar el idioma en situaciones reales.
> 
> Incluye hospedaje en casa de familia anfitriona, desayuno y cena, las clases y actividades del itinerario, seguro de gastos médicos mayores, staff 24/7 y un profesor de su colegio.
> 
> ¿Qué te gustaría ver?
> 1.- La inversión
> 2.- La presentación completa
> 3.- Hablar con una asesora

**t7** · nodo `cat_e4l` → `e4l_precio_otro`

🧑 1

> **Miri:** La inversión depende del convenio que tenemos con cada colegio, por eso prefiero que una asesora te dé el número exacto y tu plan de pagos 😊
> 
> Lo que sí te adelanto: el lugar se aparta con $15,000 y de ahí armas un plan mensual hasta quedar liquidado, máximo 2 meses antes del viaje.
> 
> ¿Te conecto con una asesora?
> 1.- Sí, por favor
> 2.- Todavía no, gracias

**t8** · nodo `e4l_precio_otro` → `e4l_precio_otro` · _simulado_

🧑 Entiendo, pero ¿me podrías decir cuánto pagan en otros colegios? Aunque sea como referencia para tener una idea de la inversión 😊

> **Miri:** Te entiendo perfectamente, pero justamente por eso no sería justo darte ese número: los precios varían según el convenio de cada colegio y no queremos que vayas con una expectativa que luego no aplique para el tuyo 😊
> 
> Lo mejor es que una asesora te dé el precio exacto para el Colegio Eval Vista Hermosa, con tu plan de pagos personalizado.
> 
> ¿Te conecto con ella?
> 1.- Sí, por favor
> 2.- Todavía no, tengo más preguntas

> **Miri:** Escribe *Menú* cuando quieras ver las opciones de nuevo 😊

**t9** ⚠️ · nodo `e4l_precio_otro` → `e4l_precio_otro`

🧑 ¿El vuelo viene incluido en el precio? Si es aparte, ¿cuánto cuesta el vuelo más o menos?

> **Miri:** ¡Buena pregunta! El vuelo internacional redondo desde la Ciudad de México tiene un costo aproximado de $35,000 a $37,000 pesos. El precio exacto se confirma al momento de cerrar los primeros grupos.
> 
> Y sí, el vuelo puede incluirse en el plan de pagos, también a meses sin intereses 😊
> 
> ¿Te gustaría que te conecte con una asesora para darte el precio completo (programa + vuelo) y tu plan de pagos para el Colegio Eval Vista Hermosa?


### ❌ `miri-conversacion-larga-nudge` — Conversación larga en Miri: el recordatorio de Menú no se repite

Regresión: b1d897e / bug abierto: "Escribe Menú" duplicado en Miri

- ✅ `sin_ya_en_contacto` — nunca afirma que la asesora ya contactó
- ✅ `nudge_max_1_por_turno` — ok
- ❌ `nudge_max_1_por_nodo` — nodo util_menu: recordatorio repetido en t12, t13
- ✅ `cta_pregunta_no_es_decline` — ok
- ✅ `financieros_solo_match_unico` — ok (match único permitido: ninguno)
- ✅ `sin_errores_de_turno` — ok
- ✅ `ruta_esperada` — ok

Juez: relevancia 4 · veracidad 4 · fluidez 3 · avance 3 — Miri responde bien a las dudas detalladas de Alejandra pero comete un glitch de envío duplicado y fuerza la derivación a asesora cuando la mamá pidió tiempo para decidir.
  - turno 9-10: el documento de la presentación se envía dos veces seguidas, generando redundancia
  - turno 13: se repite el recordatorio de 'Menú' por tercera vez en la conversación, aunque espaciado
  - turno 15: la prospecto dice que hablará con su esposo y se comunicará después, pero Miri de inmediato conecta a una asesora que 'escribe en breve', sin esperar la señal de la usuaria

<details><summary>Errores del log de la app</summary>

- t1 console: [MIRI-DEBUG] findOrCreateTravelLead: No reusable lead found — will CREATE NEW
- t2 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=null
- t3 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=null
- t4 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=Alejandra Eval
- t5 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=Alejandra Eval
- t6 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=Alejandra Eval
- t7 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=Alejandra Eval
- t8 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=Alejandra Eval
- t9 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=nuevo parentName=Alejandra Eval
- t10 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=materiales_enviados parentName=Alejandra Eval
- t11 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=materiales_enviados parentName=Alejandra Eval
- t12 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=materiales_enviados parentName=Alejandra Eval
- t13 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=materiales_enviados parentName=Alejandra Eval
- t14 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=materiales_enviados parentName=Alejandra Eval
- t15 console: [MIRI-DEBUG] findOrCreateTravelLead: REUSING lead a60aaae7-ee62-412c-9ec4-9adb40a91041 status=materiales_enviados parentName=Alejandra Eval

</details>

#### Transcripción

**t1** · nodo `∅` → `filtro_previo`

🧑 Hola!

> **Miri:** ¡Hola! Soy Miri, del equipo de Oxford Education & Travel ✈️ Acompaño a las familias con nuestros programas de inmersión en inglés en el extranjero.
> 
> ¿En qué te puedo ayudar hoy?

> **Miri:** Para orientarte mejor, cuéntame: ¿ya estás inscrito en alguno de nuestros programas o buscas información?
> 1.- Ya estoy inscrito
> 2.- Busco información

**t2** · nodo `filtro_previo` → `solicitud_datos`

🧑 2

> **Miri:** ¡Perfecto! 😊 Para darte información precisa, ¿me compartes tu nombre, y el nombre y la edad de tu hijo o hija que viajaría?

**t3** · nodo `solicitud_datos` → `solicitud_colegio`

🧑 Alejandra Eval, mamá de Emilia Eval de 15 años

> **Miri:** Gracias 🙌 ¿De qué colegio nos escribes?
> 
> Instituto J. Francisco Rodríguez, Colegio Luz del Tepeyac, Instituto Ramiro Kolbe, The Hills, Errasquin, Arista, UTEC, Belfortt, Instituto Kino de San Luis, Global Skills, Centro de Estudios Naucalpan, Colegio Columbia, Instituto Martha Christlieb, Colegio Iberoamericano, Instituto Internacional o UMIN.
> 
> Si tu colegio no está en la lista, escribe "otro" y con gusto te ayudo igual.

**t4** · nodo `solicitud_colegio` → `menu_principal`

🧑 Arista

> **Miri:** Tenemos tres programas de inmersión en inglés para 2027. ¿Cuál te interesa conocer?
> 1.- English 4 Life (Londres o Dublín, mayo)
> 2.- Winter Break (Windsor, Inglaterra)
> 3.- Rising Stars (programa con beca)
> 4.- Prefiero hablar con una asesora

**t5** · nodo `menu_principal` → `cat_e4l`

🧑 1

> **Miri:** English 4 Life es un programa inmersivo de inglés: viajan a Londres o a Dublín del 21 al 30 de mayo de 2027, 9 días y 8 noches, con retos y actividades para practicar el idioma en situaciones reales.
> 
> Incluye hospedaje en casa de familia anfitriona, desayuno y cena, las clases y actividades del itinerario, seguro de gastos médicos mayores, staff 24/7 y un profesor de su colegio.
> 
> ¿Qué te gustaría ver?
> 1.- La inversión
> 2.- La presentación completa
> 3.- Hablar con una asesora

**t6** · nodo `cat_e4l` → `cat_e4l` · _simulado_

🧑 Oye Miri, ¿quién acompaña a los chavos durante el viaje? ¿va un profesor del colegio todo el tiempo?

> **Miri:** Sí, van acompañados en todo momento 😊 Los estudiantes tienen dos niveles de apoyo:
> 
> Un profesor del colegio que viaja con el grupo, y además el staff de Oxford (los Group Leaders) que coordinan todas las actividades y tienen protocolos para cualquier situación.
> 
> Durante el día se reúnen en un punto de encuentro para hacer las actividades juntos, y al terminar regresan a sus casas anfitrionas. Los traslados los hacen en transporte público local, que también es parte de la experiencia de aprendizaje.
> 
> ¿Te gustaría que te mande la presentación completa con el itinerario y todos los detalles? 📄

> **Miri:** Escribe *Menú* cuando quieras ver las opciones de nuevo 😊

**t7** · nodo `cat_e4l` → `cat_e4l` · _simulado_

🧑 Y una pregunta, ¿pueden llevar celular? ¿hay wifi en las casas de las familias anfitrionas para que se comunique con nosotros?

> **Miri:** ¡Sí pueden llevar celular! De hecho se recomienda para mantenerse comunicados 😊
> 
> Las casas anfitrionas cuentan con WiFi, así que pueden usar WhatsApp sin problema. También hay opciones como comprar una SIM local (de marcas como EE o Vodafone) o contratar una eSIM antes de salir, que suele ser la opción más práctica y económica.
> 
> La comunicación con papás se maneja a través de un grupo de WhatsApp oficial que administra el Group Leader, donde comparten novedades del grupo. Y Emilia puede comunicarse con ustedes en los horarios libres, considerando la diferencia de horario con México.
> 
> ¿Algo más que quieras saber, o te mando la presentación para que veas todos los detalles? ✈️

**t8** · nodo `cat_e4l` → `cat_e4l` · _simulado_

🧑 Y otra cosa, ¿qué pasa si Emilia tiene alguna alergia alimentaria? ¿las familias anfitrionas lo respetan?

> **Miri:** Esa es una pregunta muy importante 😊 Las familias anfitrionas son seleccionadas y evaluadas previamente, y cuando se confirman las inscripciones se les comparte información relevante de cada estudiante, incluyendo alergias o restricciones alimentarias, para que puedan atenderlos adecuadamente.
> 
> Para casos específicos o alergias severas, te recomendaría platicarlo directamente con la asesora, ya que ella puede orientarte sobre el proceso exacto y asegurarse de que quede bien documentado en el expediente de Emilia.
> 
> ¿Quieres que te conecte con ella, o tienes alguna otra duda antes? 😊

**t9** · nodo `cat_e4l` → `e4l_material`

🧑 2

> **Miri:** ¡Claro! Te comparto la presentación completa de English 4 Life 2027, con el itinerario, todo lo que incluye y los trámites 📄
> 
> ¿Quieres que una asesora te contacte para resolver dudas?
> 1.- Sí, por favor
> 2.- Todavía no, gracias

> **Miri:** [document Presentación English 4 Life Londres 2027]

**t10** · nodo `e4l_material` → `e4l_material` · _simulado_

🧑 Y dime, ¿qué clima hace en Londres en mayo? ¿necesita llevar mucha ropa abrigada o es más templado?

> **Miri:** [document Presentación English 4 Life Londres 2027]

> **Miri:** En mayo Londres está templado pero variable 😊 Las temperaturas andan entre 10 y 18°C, con mezcla de sol y nubes, y puede haber lluvias intermitentes.
> 
> Lo ideal es que Emilia lleve ropa en capas: playeras, sudaderas y una chamarra impermeable son básicos. No necesita ropa de invierno pesada, pero tampoco ropa de verano.
> 
> ¿Hay algo más en lo que te pueda ayudar, o ya quieres que te conecte con una asesora para los detalles de la inscripción? 😊

> **Miri:** Escribe *Menú* cuando quieras ver las opciones de nuevo 😊

**t11** · nodo `e4l_material` → `e4l_material` · _simulado_

🧑 Y una cosa más, ¿necesita visa Emilia para entrar a Inglaterra o con su pasaporte es suficiente?

> **Miri:** Para México no se necesita visa 😊 Lo que sí se requiere para entrar a Reino Unido es tramitar la ETA (Electronic Travel Authorisation), que es un permiso electrónico muy sencillo de gestionar.
> 
> Cuesta 16 libras y se tramita en línea desde la app UK ETA. Una vez que se cierre el grupo, los acompañamos en todo el proceso para que quede bien hecho.
> 
> Ah, y hay otro trámite importante: el Formato SAM (Salida de Menores), que es la autorización migratoria de México para que Emilia pueda salir del país. Este sí se hace presencialmente en el aeropuerto con anticipación.
> 
> ¿Te mando más detalles sobre los trámites o tienes alguna otra pregunta? ✈️

**t12** · nodo `e4l_material` → `util_menu`

🧑 2

> **Miri:** Cuando quieras volver al menú principal, solo escribe "Menú" y te guío de nuevo 😊

**t13** ⚠️ · nodo `util_menu` → `util_menu` · _simulado_

🧑 Oye Miri, y si Emilia va con un hermano, ¿hay descuento o promoción para hermanos?

> **Miri:** ¡Qué buena pregunta! Los descuentos o promociones especiales son algo que maneja directamente la asesora, ya que dependen del convenio con el colegio y la etapa de inscripción en la que estén.
> 
> Para darte una respuesta precisa, lo mejor es que te conecte con Cecilia, nuestra asesora del Colegio Arista, para que te diga si aplica algo para el caso de Emilia y su hermano 😊
> 
> ¿Te la conecto?
> 1.- Sí, por favor
> 2.- Todavía no, tengo más dudas

> **Miri:** Escribe *Menú* cuando quieras ver las opciones de nuevo 😊

**t14** · nodo `util_menu` → `util_menu` · _simulado_

🧑 Y otra pregunta, ¿hacen juntas informativas con los papás antes del viaje para explicar todo bien?

> **Miri:** Sí, se hacen juntas informativas con papás antes del viaje 😊 Ahí se explica todo: el itinerario, los trámites, el hospedaje, la comunicación durante el viaje y cualquier duda que tengan las familias.
> 
> Los detalles sobre fechas y formato de las juntas los coordina directamente la asesora con cada colegio, así que Cecilia te puede dar esa info precisa para el Colegio Arista.
> 
> ¿Tienes alguna otra duda o ya quieres que te conecte con ella? 😊

**t15** · nodo `util_menu` → `llm_freeform` · _simulado_

🧑 Está bien, gracias Miri, lo voy a platicar con mi esposo y después nos comunicamos para los detalles 😊

> **Miri:** ¡Con gusto! 😊 Te conecto con Camila Serafín, que atiende a las familias y te escribe en breve por WhatsApp para ver la inversión y los siguientes pasos.
> 
> Mientras tanto, aquí sigo para cualquier otra duda. 🙌

> 📣 _a asesora 5215539771457:_ [plantilla nuevo_lead_travel] 5 | Alejandra Eval | padre/madre | Emilia Eval | Colegio Arista — Londres | 2 | 55 9000 0202 | Flujo Miri — aceptó hablar con ases


## Juez — detalle de escenarios en verde

| Escenario | rel | ver | flu | ava | Observaciones |
|---|---|---|---|---|---|
| `ori-cta-pregunta-con-no` | 5 | 4 | 4 | 5 | Ori respondió con precisión a las dudas sobre reprobación, nivel mínimo y tiempos de entrega, derivando a asesora tras aceptación explícita. · t6: el mensaje de recordatorio 'Escribe *Menú*' se envía justo después de ofrecer asesora, resultando algo redundante e innecesario en ese punto de la conversación |
| `ori-no-quiero-asesor` | 5 | 4 | 5 | 5 | El asistente respetó correctamente la negativa a ser contactado y respondió con precisión las dudas sobre horarios y modalidad de clases. · t8: la respuesta sobre horarios es algo vaga ('dependiendo de la modalidad') sin especificar qué modalidades permiten elegir libremente, podría generar duda no resuelta |
| `ori-productos-texto-libre` | 5 | 4 | 4 | 4 | Ori respondió con precisión cada pregunta sobre AINARA, Visual Camp y Data Analytics sin negar su catálogo, aunque en t6 podría haber verificado si 'Data Analytics' se refería a otra herramienta antes de asumir cuál buscaba. · t6: Ori asume que la pregunta sobre 'Data Analytics' se refiere a exámenes diagnósticos sin confirmar si existe un producto con ese nombre exacto, lo que podría generar confusión sobre nomenclatura de productos |
| `ori-ieduca-retirado` | 5 | 4 | 4 | 5 | Ori maneja bien la ausencia de iEduca, deriva a asesora sin inventar datos y ofrece alternativas relevantes cuando se le pregunta. · turno 4: el mensaje 'Escribe *Menú*' es redundante e innecesario justo después de ofrecer conectar con asesora, interrumpe el flujo natural |
| `ori-precio-pedido` | 4 | 5 | 4 | 4 | Ori se mantiene consistente en no dar precios y redirige apropiadamente a la asesora sin inventar datos, aunque podría avanzar más rápido a la conexión. · t6: incluye recordatorio de 'Escribe Menú' innecesario justo después de negar el precio, lo cual distrae del flujo natural · t9: no confirma explícitamente si hay opción de meses sin intereses, deja la pregunta parcialmente sin resolver antes de redirigir a asesora |
| `ori-nadie-me-ha-contactado` | 3 | 2 | 3 | 2 | Ori repite la promesa de '48 horas hábiles' sin notar que, según la propia queja del prospecto, ese plazo ya se había vencido, y ofrece la misma acción de 'avisar a Diana' dos veces sin escalar realmente el caso. · t8: Introduce un plazo de '48 horas hábiles' no mencionado antes, que contradice la cronología (el prospecto ya lleva 2 días sin respuesta, es decir el plazo ya venció) sin que Ori lo note. · t9: Repite casi el mismo mensaje y la misma promesa de 48h del turno anterior sin reconocer que ya se excedió, dando la impresión de respuesta enlatada. · t9: No ofrece una acción distinta o de mayor urgencia (p.ej. escalar a un supervisor) ante la segunda queja del mismo cliente, solo repite 'enviar aviso a Diana'. |
| `ori-conversacion-larga-nudge` | 5 | 4 | 5 | 5 | Ori responde con precisión a cada pregunta libre de Claudia, deriva a asesor en el momento adecuado y evita repetir el recordatorio de Menú innecesariamente. · turno 5: menciona que Visual Camp y AINARA se adaptan a secundaria sin aclarar que es información general no confirmada, podría sonar más certero de lo debido · turno 13: afirma edades y detalles de certificaciones (Oxford TCC Kids) sin indicar que se confirmarán con el asesor, asumiendo veracidad no verificada |
| `ori-opciones-en-prosa-nudge` | 5 | 5 | 4 | 5 | El bot listó opciones en prosa según se le pidió, evitó inventar rankings falsos y ofreció asesora sin presionar. · t4: se agregó recordatorio de Menú justo después de responder en prosa, algo redundante ya que el prospecto no lo pidió · t6: mismo patrón de recordatorio de Menú repetido consecutivamente en dos turnos seguidos |
| `miri-ya-inscrito-ambiguo` | 4 | 5 | 4 | 4 | Miri se mantiene consistente y honesta al no inventar datos de pago ambiguos, ofreciendo escalar como urgente de forma repetida pero razonable. · t3: menciona a 'Cecilia' como asesora cuando en t2 había presentado a 'Alma Sotelo', inconsistencia en el nombre de la asesora · t5: la pregunta sobre fecha de próximo pago es distinta a la original y se responde de forma casi idéntica a t4, generando algo de repetición en el patrón de respuesta |
| `miri-ya-inscrito-sin-match` | 5 | 2 | 5 | 4 | Miri maneja bien las preguntas sin confirmar datos no verificados, pero comete un error grave al mencionar dos asesoras distintas (Victor Hugo Cruz y Cecilia Rodríguez) para el mismo caso. · t3: se asigna a 'Victor Hugo Cruz' como asesora (incongruencia de género en el nombre) · t5: se asigna a una asesora diferente, 'Cecilia Rodríguez', sin explicar el cambio respecto a t3, generando inconsistencia y confusión |
| `miri-ya-inscrito-pago-unico` | 3 | 4 | 4 | 3 | El bot no responde directamente la pregunta sobre la fecha del siguiente pago y solo repite el menú de opciones. · t3: Ignora la pregunta específica del prospecto sobre cuándo vence el siguiente pago, forzando a elegir entre las dos opciones predefinidas en vez de intentar responder o explicar que solo la asesora tiene esa información. |
