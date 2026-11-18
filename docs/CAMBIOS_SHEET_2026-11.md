# Cambios en el Sheet de leads — noviembre 2026

Para avisar al equipo (Steph y asesoras) antes de desplegar `fix/sheets-sync`.

**Ninguna columna existente se mueve, se renombra ni se borra. No se borra ninguna
fila.** Todo lo nuevo va al final de cada pestaña.

## Qué van a notar

### Pestaña "Leads Oxford" (Ori)

| Columna | Cambio |
|---|---|
| S · **Asesora original** (nueva) | A quién se le asignó el lead primero. |
| T · **Asesora actual** (nueva) | Quién lo tiene hoy. Es lo mismo que la columna M, que se conserva. |
| U · **Estado del ticket** (nueva) | En palabras: "Esperando confirmación de X", "En atención — X confirmó", "Atendido — X lo cerró" o **"SIN CONFIRMAR — nadie respondió (última avisada: X)"**. |
| V · **Actualizado (CDMX)** (nueva) | Cuándo se escribió la fila por última vez. |
| B, N, O · fechas | Ahora en hora de la Ciudad de México, formato `2026-11-10 22:11`. Antes iban en UTC (`2026-11-11T04:11:23.000Z`), seis horas adelante. |
| J · Derivación | Ya dice "Sí" en todo lead que se derivó. Antes volvía a "No" cuando el prospecto escribía otra vez. |

**Importante sobre la columna M ("Asesor asignado"):** cuando nadie confirma un lead,
esa columna muestra a la última asesora a la que se le avisó. No significa que ella
lo esté atendiendo. Para saber qué pasó hay que mirar la columna U.

La fila ahora se actualiza sola en cada paso — cuando el lead se deriva desde el
menú, en cada reasignación, cuando una asesora responde ATIENDO y cuando responde
LISTO. Antes solo se actualizaba cuando el prospecto volvía a escribir.

### Pestaña "Tiempos asesores" (Ori)

| Columna | Cambio |
|---|---|
| K · **Lead ID** (nueva) | Identificador interno. Evita que un ticket con número repetido pise la fila de otro lead. |
| L · **ATIENDO rechazados** (nueva) | Quién respondió ATIENDO y no se le aceptó, con hora y motivo. |
| M · **Actualizado (CDMX)** (nueva) | Última escritura de la fila. |
| J · Estado final | Nuevo valor posible: "Esperando confirmación de X". La fila aparece desde la primera reasignación, no solo al final. |
| B · Fecha/hora del lead | En hora de la Ciudad de México. |

### Pestaña "Resumen asesoras"

Sin cambios de columnas. Una asesora cuyo lead tomó otra compañera ya no suma en
"# Reasignado por no confirmar".

### Pestaña "Leads" (Miri)

| Columna | Cambio |
|---|---|
| K · Asesor Asignado | Ya aparece desde el momento de la derivación. Antes quedaba vacío hasta que el prospecto escribía otra vez. |
| H · Interés | Deja de ser 0 para todos. Escala: 1 solo escribió · 3 dejó sus datos · 5 eligió programa · 6 pidió precio o recibió material · 8 se derivó a asesora. |
| B, L · fechas | En hora de la Ciudad de México. |

## Filas que ya existen

- Las columnas nuevas quedan vacías en las filas viejas hasta que ese lead tenga
  un movimiento (mensaje del prospecto, reasignación, ATIENDO o LISTO).
- Las **fechas viejas** se convierten aparte, con un script que solo toca las
  celdas de fecha y guarda respaldo:

  ```bash
  node scripts/fix-sheet-dates-cdmx.mjs            # muestra qué cambiaría, no escribe
  node scripts/fix-sheet-dates-cdmx.mjs --confirm  # respalda y convierte
  ```

  Dry-run del 12-nov-2026: 93 celdas (Leads Oxford 51, Tiempos asesores 12, Leads 30).
  Se puede deshacer con `--restore <archivo de respaldo>`.

## Si alguien tiene filtros, fórmulas o vistas

- Un filtro o fórmula que compare fechas como texto con "T" y "Z" hay que
  ajustarlo al formato nuevo.
- Las fechas quedan como **texto** (`2026-11-10 22:11`), no como fecha de Sheets:
  se ordenan bien de la A a la Z, pero para restarlas hay que convertirlas con
  `=VALOR(…)`/`=DATEVALUE(…)`.
- Si alguien agrega columnas propias, que lo haga a la derecha de las nuevas
  (después de la V en "Leads Oxford" y de la M en "Tiempos asesores").
