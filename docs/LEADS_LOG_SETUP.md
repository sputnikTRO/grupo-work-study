# Configuración de la Hoja Leads_Log

## Descripción

La hoja **Leads_Log** es un registro automático de todos los leads capturados por el bot. Se actualiza en tiempo real con cada interacción significativa y facilita:

- ✅ Visualización en dashboards (Google Data Studio / Looker)
- ✅ Exportación fácil a CRM externos
- ✅ Análisis y reportes con fórmulas de Google Sheets
- ✅ Backup automático de información de leads
- ✅ Monitoreo del pipeline de ventas

---

## Estructura de la Hoja

### Columnas (en este orden exacto):

| # | Columna | Tipo | Descripción | Ejemplo |
|---|---------|------|-------------|---------|
| A | `timestamp` | Fecha/Hora | Fecha y hora del primer contacto | `2026-03-11T15:30:00.000Z` |
| B | `nombre` | Texto | Nombre del padre/tutor | `Juan Pérez` |
| C | `telefono` | Texto | Número de WhatsApp (con país) | `5215512345678` |
| D | `colegio` | Texto | Código o nombre del colegio | `WC` |
| E | `programa` | Texto | Unidad de negocio | `travel` |
| F | `destino` | Texto | Destino de viaje preferido | `Londres 2026` |
| G | `edad_estudiante` | Número | Edad del viajero | `15` |
| H | `score` | Número | Score de interés (1-10) | `7` |
| I | `estatus` | Texto | Estado del lead | `activo`, `derivado_asesor`, `inscrito`, `no_interesado` |
| J | `asesor_asignado` | Texto | Nombre del asesor asignado | `María González` |
| K | `materiales_enviados` | Texto | Lista de materiales enviados (separados por coma) | `BROCHURE_LONDRES, PRECIOS` |
| L | `ultimo_contacto` | Fecha/Hora | Fecha/hora de la última interacción | `2026-03-11T16:45:00.000Z` |
| M | `notas` | Texto | Notas automáticas generadas | `Seguimiento: 15/03/2026 \| Intentos: 2` |

---

## Paso a Paso para Crear la Hoja

### 1. Abrir tu Google Sheets

Abre la hoja de cálculo configurada en `GOOGLE_SHEETS_ID` (la misma que tiene Viajes, Colegios, etc.)

### 2. Crear Nueva Pestaña

1. Haz clic en el botón **"+"** en la parte inferior para crear una nueva pestaña
2. Nómbrala exactamente: **`Leads_Log`** (respeta mayúsculas/minúsculas)

### 3. Agregar Encabezados

En la **fila 1**, copia y pega estos encabezados exactamente como aparecen:

```
timestamp	nombre	telefono	colegio	programa	destino	edad_estudiante	score	estatus	asesor_asignado	materiales_enviados	ultimo_contacto	notas
```

**IMPORTANTE:** Usa TAB para separar las columnas, no espacios.

**Alternativa:** Copia cada valor en su celda:

- A1: `timestamp`
- B1: `nombre`
- C1: `telefono`
- D1: `colegio`
- E1: `programa`
- F1: `destino`
- G1: `edad_estudiante`
- H1: `score`
- I1: `estatus`
- J1: `asesor_asignado`
- K1: `materiales_enviados`
- L1: `ultimo_contacto`
- M1: `notas`

### 4. Formato Recomendado (Opcional)

Para facilitar la lectura, puedes aplicar formato:

1. **Fila 1 (encabezados):**
   - Negrita
   - Color de fondo: gris claro
   - Texto centrado
   - Congelar fila (View → Freeze → 1 row)

2. **Columnas de fecha (A y L):**
   - Formato: `dd/mm/yyyy hh:mm`

3. **Columna score (H):**
   - Formato: Número
   - Opcional: Formato condicional
     - 1-3: Rojo (cold)
     - 4-6: Amarillo (warm)
     - 7-10: Verde (hot)

4. **Columna estatus (I):**
   - Formato condicional:
     - `activo`: Azul
     - `derivado_asesor`: Naranja
     - `inscrito`: Verde
     - `no_interesado`: Gris

### 5. Verificar Permisos

Asegúrate de que el service account tiene permisos de **Editor** en esta hoja.

---

## Comportamiento del Bot

### Cuándo se Sincroniza

El bot sincroniza el lead a Google Sheets:

- ✅ **Después de cada interacción** con el usuario
- ✅ **Después de detectar el colegio** en el primer mensaje
- ✅ **Después de capturar datos** (nombre, edad, etc.)
- ✅ **Después de actualizar el score** de interés
- ✅ **Después de enviar materiales**
- ✅ **Después de derivar a asesor**

### Upsert Logic

- Si el teléfono **ya existe** en la hoja → **Actualiza** la fila existente
- Si el teléfono **no existe** → **Agrega** una nueva fila

Esto garantiza que siempre tengas la información más reciente sin duplicados.

### Manejo de Errores

Si la sincronización falla (ej: permisos, Sheet no existe):
- ❌ Se loguea el error
- ✅ El bot continúa funcionando normalmente
- ✅ Los datos siguen guardándose en PostgreSQL

La sincronización a Sheets es **no-bloqueante** - nunca rompe el flujo principal del bot.

---

## Ejemplos de Uso

### 1. Dashboard en Tiempo Real

Conecta la hoja a **Google Data Studio** y crea gráficas:

- Leads por día
- Distribución de scores
- Tasa de conversión (derivados vs inscritos)
- Colegios con más leads
- Materiales más enviados

### 2. Exportar a CRM

Usa Google Sheets API o Zapier/Make para sincronizar automáticamente a:

- HubSpot
- Salesforce
- Zoho CRM
- Pipedrive

### 3. Análisis con Fórmulas

Calcula métricas directamente en Sheets:

```
// Leads activos hoy
=COUNTIFS(I:I, "activo", A:A, ">="&TODAY())

// Score promedio
=AVERAGE(H:H)

// Tasa de conversión
=COUNTIF(I:I, "inscrito") / COUNTA(C:C)

// Leads calientes (score >= 7)
=COUNTIFS(H:H, ">=7", I:I, "activo")
```

### 4. Triggers Automáticos

Con Google Apps Script, puedes crear triggers cuando:

- Nuevo lead llega (score >= 1)
- Lead se vuelve caliente (score >= 7)
- Lead lleva X días sin contacto

---

## Troubleshooting

### Error: "Permission denied"

**Causa:** El service account no tiene acceso.

**Solución:**
1. Abre Google Sheets
2. Click en "Compartir"
3. Agrega el email del service account (está en tu `.env` como `GOOGLE_SERVICE_ACCOUNT_EMAIL`)
4. Dale permisos de "Editor"

### Error: "Sheet not found"

**Causa:** La pestaña no se llama exactamente `Leads_Log`.

**Solución:**
1. Verifica que la pestaña se llame **`Leads_Log`** (exacto, case-sensitive)
2. No debe tener espacios al inicio o final

### No se actualiza la hoja

**Checklist:**
1. ✅ Service account tiene permisos de Editor
2. ✅ La pestaña existe y se llama `Leads_Log`
3. ✅ La fila 1 tiene los encabezados correctos
4. ✅ Verifica los logs del bot: `npm run dev`

---

## Notas de Implementación

### Campos Calculados

Algunos campos se generan automáticamente:

- **timestamp:** Se toma de `lead.createdAt` o fecha actual
- **ultimo_contacto:** Se actualiza con `lead.updatedAt`
- **notas:** Se generan a partir de `followUpDate`, `followUpCount`, y `conversation.status`

### Expansión Futura

Esta hoja solo maneja **Travel** actualmente. Para las Fases 3 y 4:

- Se creará **`Leads_Log_WorkStudy`** para Work & Study
- Se creará **`Leads_Log_Oxford`** para Oxford Education

O bien, se puede unificar en una sola hoja y usar la columna `programa` para filtrar.

---

## Ejemplo de Fila Completa

| timestamp | nombre | telefono | colegio | programa | destino | edad_estudiante | score | estatus | asesor_asignado | materiales_enviados | ultimo_contacto | notas |
|-----------|--------|----------|---------|----------|---------|-----------------|-------|---------|-----------------|---------------------|-----------------|-------|
| 2026-03-11T15:30:00.000Z | Juan Pérez | 5215512345678 | WC | travel | Londres 2026 | 15 | 7 | derivado_asesor | María González | BROCHURE_LONDRES, PRECIOS | 2026-03-11T16:45:00.000Z | Seguimiento: 15/03/2026 |

---

## Conclusión

La hoja **Leads_Log** es una pieza clave para convertir el bot de WhatsApp en un **sistema CRM completo**. Facilita el análisis, seguimiento y gestión de leads sin necesidad de herramientas externas costosas.

Una vez configurada, la sincronización es **100% automática** y no requiere intervención manual.

**¿Necesitas ayuda?** Revisa los logs del bot o contacta al equipo de desarrollo.
