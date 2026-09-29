# Reporte de evals — Ori y Miri

- Corrida: `2026-09-29T21-38-08` · 2026-09-29T21:38:08.043Z · 109 s
- Modelos: bot `claude-sonnet-4-6` · prospecto `claude-haiku-4-5` · juez `claude-sonnet-5`
- Rama: `fix/miri-precio-otro` @ `74c0559` (con cambios sin commitear)
- **Escenarios en verde: 14/14** · asserts duros fallidos: **0**
- Vs corrida anterior (`2026-09-29T21-36-06`): 14/14 en verde, 0 asserts fallidos → sin cambio

Pass/fail lo deciden SOLO los asserts determinísticos (`evals/asserts.mjs`). El juez (`evals/judge.mjs`) es informativo: 1–5 en relevancia · veracidad · fluidez · avance.

## Resumen

| | Escenario | Unit | Turnos | Asserts fallidos | Juez (prom.) |
|---|---|---|---|---|---|
| ✅ | `ori-cta-pregunta-con-no` — CTA del nodo Oxford TCC: preguntas que contienen "no" no son un rechazo | ori | 9 | — | 4.5 |
| ✅ | `ori-no-quiero-asesor` — "No quiero hablar con un asesor" en un CTA no deriva | ori | 9 | — | 4.8 |
| ✅ | `ori-productos-texto-libre` — AINARA, Visual Camp y Data Analytics por texto libre: Ori no niega su propio catálogo | ori | 7 | — | 4.8 |
| ✅ | `ori-ieduca-retirado` — iEduca (retirado del catálogo) no se ofrece como producto vigente | ori | 6 | — | 4.5 |
| ✅ | `ori-precio-pedido` — Precio pedido a Ori (e insistido): nunca da montos | ori | 9 | — | 4.3 |
| ✅ | `ori-nadie-me-ha-contactado` — "Nadie me ha contactado" tras derivar: sin "ya está en contacto" y sin re-derivar | ori | 9 | — | 3.5 |
| ✅ | `ori-conversacion-larga-nudge` — Conversación larga a media navegación: el recordatorio de Menú no se repite | ori | 14 | — | 3.8 |
| ✅ | `ori-opciones-en-prosa-nudge` — Pedir "qué opciones tienen" a media navegación: el LLM las lista en prosa y no se duplica el recordatorio de Menú | ori | 8 | — | 4.8 |
| ✅ | `ori-menu-nudge-variantes` — Recordatorio de Menú venga del LLM, del copy del flujo o del handler: máximo uno por turno y por nodo | ori | 9 | — | 4.3 |
| ✅ | `miri-ya-inscrito-ambiguo` — Ya inscrito con match AMBIGUO (2 filas de pago): ni un monto, deriva | miri | 5 | — | 3.8 |
| ✅ | `miri-ya-inscrito-sin-match` — Ya inscrito SIN match por teléfono: toma datos, deriva, no confirma inscripción ni pagos | miri | 6 | — | 4 |
| ✅ | `miri-ya-inscrito-pago-unico` — Control: ya inscrito con match ÚNICO sí ve su estatus de pago | miri | 4 | — | 2.5 |
| ✅ | `miri-colegio-otro-precio` — Colegio "otro" pidiendo precio: no cotiza con la tarifa de otro colegio | miri | 9 | — | 4 |
| ✅ | `miri-conversacion-larga-nudge` — Conversación larga en Miri: el recordatorio de Menú no se repite | miri | 15 | — | 4.5 |


## Juez — detalle de escenarios en verde

| Escenario | rel | ver | flu | ava | Observaciones |
|---|---|---|---|---|---|
| `ori-cta-pregunta-con-no` | 5 | 4 | 4 | 5 | El bot respondió con precisión a las preguntas de Laura y avanzó correctamente hacia la asignación de asesora. · turno 6: incluye recordatorio redundante 'Escribe Menú' en mensaje separado tras ya haber preguntado si quiere asesora, lo cual es innecesario · turno 6: afirma categóricamente que no hay reembolso sin matizar que depende de política institucional, dato no verificado en la conversación |
| `ori-no-quiero-asesor` | 5 | 5 | 4 | 5 | Ori respeta correctamente la negativa a ser contactado y responde con información útil sin insistir ni derivar. · t6: se envía un mensaje adicional recordando 'Escribe Menú' que resulta algo redundante e innecesario tras ya haber respondido |
| `ori-productos-texto-libre` | 5 | 5 | 4 | 5 | Ori responde con precisión cada pregunta sobre AINARA, Visual Camp y Data Analytics, sin negar su propio catálogo y ofreciendo avanzar hacia asesora al final. · t4: mensaje redundante de 'Escribe Menú' justo después de ofrecer asesora, interrumpe el flujo natural |
| `ori-ieduca-retirado` | 5 | 4 | 4 | 5 | Ori maneja bien el producto retirado, deriva a asesora y ofrece alternativas relevantes sin inventar datos. · t4: podría explicar brevemente que iEduca ya no está vigente en lugar de solo decir que no está registrado, para mayor transparencia |
| `ori-precio-pedido` | 4 | 5 | 4 | 4 | Ori mantiene consistencia al no inventar precios y ofrece correctamente derivar a asesora, aunque podría avanzar más rápido a la conexión. · t6: incluye recordatorio de 'Escribe Menú' innecesario justo después de pedir confirmación, algo redundante · t9: tercera vez que evade dar cifras sin ofrecer alternativa como rango de precios de mercado, prospecto ya mostró frustración leve |
| `ori-nadie-me-ha-contactado` | 4 | 3 | 4 | 3 | Ori maneja la queja con empatía pero da garantías dudosas (48 horas hábiles, 'tiene tu solicitud asignada') sin poder verificarlas realmente. · turno 8: afirma que Diana 'tiene tu solicitud asignada y está notificada' y da un plazo específico de 48 horas sin poder verificar el estatus real del contacto · turno 8-9: no ofrece alternativa concreta (otro asesor, escalar a supervisor) ante la segunda queja del prospecto, solo promete 'recordatorios' repetidos |
| `ori-conversacion-larga-nudge` | 4 | 3 | 5 | 3 | Ori manejó bien las preguntas técnicas derivando lo incierto a la asesora, pero en el cierre forzó la conexión con un asesor pese a que Claudia solo dijo que lo platicaría con dirección, sin confirmar interés explícito. · turno 14: el prospecto no aceptó explícitamente hablar con una asesora, solo dijo que lo consultaría internamente, y el bot igualmente notificó y afirmó que un asesor 'te escribe en breve' como si fuera un hecho confirmado · turno 6: se ofrece asesora y en turnos posteriores se repite la oferta varias veces seguidas (t7, t9, t10, t11, t12) aunque el prospecto sigue sin aceptar, rozando la insistencia |
| `ori-opciones-en-prosa-nudge` | 5 | 5 | 4 | 5 | Ori respondió con precisión y sin repetir el recordatorio de Menú en el turno donde no correspondía, avanzando bien hacia la asesora. · t4: se agrega el recordatorio 'Escribe Menú' justo después de listar opciones en prosa, algo redundante dado que Sergio pidió todo en un solo mensaje · t6: se repite nuevamente el recordatorio 'Escribe Menú' inmediatamente después de responder, aunque el prospecto no lo solicitó |
| `ori-menu-nudge-variantes` | 4 | 5 | 3 | 5 | Ori responde bien y evita presionar, pero repite el recordatorio de Menú de forma innecesaria y algo redundante. · turno 9: añade un segundo mensaje con 'Escribe Menú' aunque la pregunta no era sobre navegación y el menú ya se había mostrado en el turno 8, resultando redundante |
| `miri-ya-inscrito-ambiguo` | 4 | 5 | 3 | 3 | Miri evita inventar datos financieros y deriva correctamente ante ambigüedad, pero repite la misma justificación varias veces sin ofrecer alternativa concreta (como un botón de contacto directo) y menciona dos nombres de asesora distintos (Alma y Cecilia), generando confusión. · t2: se menciona a la asesora 'Alma Sotelo' y luego en t3 aparece 'Cecilia' sin explicación, inconsistencia de nombres · t3-t5: repite el mismo mensaje de derivación de forma redundante sin variar la fórmula ni dar un paso adicional (como confirmar que se enviará el dato por WhatsApp) · t4: no ofrece ninguna acción concreta (como escalar la urgencia a la asesora) pese a la insistencia explícita de la clienta |
| `miri-ya-inscrito-sin-match` | 4 | 4 | 4 | 4 | Miri maneja bien la falta de match derivando sin confirmar datos sensibles, aunque incurre en inconsistencia al nombrar dos asesores distintos. · turno 3: menciona a Victor Hugo Cruz como 'asesora' (error de concordancia de género) · turno 5: cambia de asesor a Cecilia Rodríguez sin explicar el cambio, generando confusión sobre quién dará seguimiento |
| `miri-ya-inscrito-pago-unico` | 2 | 3 | 3 | 2 | El bot ignoró la pregunta específica sobre la fecha del próximo pago y forzó al usuario a elegir entre dos opciones que no respondían su duda. · t3: no responde la pregunta directa de cuándo vence el siguiente pago, solo repite el menú de opciones · t3: no ofrece alternativa (como conectar con asesora para esa info específica) sino que ignora la consulta |
| `miri-colegio-otro-precio` | 4 | 4 | 4 | 4 | Miri maneja bien la falta de convenio y deriva apropiadamente, aunque en t8 el recordatorio de 'Menú' es redundante e innecesario tras ya haber ofrecido conectar con asesora. · t5: deriva a asesora antes de que el prospecto pidiera explícitamente hablar con una, cuando solo preguntó el precio de un programa que aún no había elegido formalmente · t8: el mensaje adicional 'Escribe Menú' es un recordatorio redundante e innecesario que corta el flujo natural de la conversación |
| `miri-conversacion-larga-nudge` | 5 | 5 | 4 | 4 | Miri responde con precisión y coherencia todas las preguntas de Alejandra, deriva apropiadamente cuando corresponde y cierra bien sin presionar. · turno 13: no ofrece alternativa distinta a derivar a asesora tras el 'no' implícito del turno 12, aunque es apropiado dado el tema de descuentos |
