# 📋 Guía de Migración - Google Sheets Simplificado

## ⚠️ PASO 1: CREAR BACKUP

**ANTES de hacer CUALQUIER cambio:**

1. Abre el Google Sheets actual:
   ```
   https://docs.google.com/spreadsheets/d/18a2zVagPSu5iJf8GBdM_WcEnDC3vnZ2SHn7s_ftPmnk/edit
   ```

2. Ve a: **Archivo → Hacer una copia**

3. Nombre de la copia: `Base Conocimiento Travel Bot - BACKUP YYYY-MM-DD`

4. **Guarda el enlace del backup** en un lugar seguro

---

## 🎯 PASO 2: ELIMINAR HOJAS ANTIGUAS

En el Google Sheets ORIGINAL, elimina estas hojas:
- ❌ Asesoras (la vamos a fusionar con Colegios)
- ❌ Esquemas de Pago (la vamos a fusionar con Precios)
- ❌ Info_Viajes (la vamos a renombrar a Info General)
- ❌ Configuración (moveremos esto a variables de entorno)

---

## 📝 PASO 3: CREAR NUEVA ESTRUCTURA

### Hoja 1: **Viajes** (RENOMBRAR la hoja "Viajes" existente)

**Headers (fila 1):**
```
Código | Destino | Descripción | Fecha Salida | Fecha Regreso | Estado
```

**Ejemplo de datos:**
```
LON2026 | Londres | Viaje educativo English 4 Life a Londres para estudiantes | 01/07/2026 | 15/07/2026 | activo
```

**Migración desde hoja antigua "Viajes":**
- `codigo` → `Código` (sin cambios)
- `destino` → `Destino` (sin cambios)
- `descripcion` → `Descripción` (sin cambios)
- `fechas_salida` → `Fecha Salida` (sin cambios)
- NUEVO: `Fecha Regreso` (agrega columna nueva)
- `status` → `Estado` (sin cambios)
- ❌ ELIMINAR: columna `precio` (ahora va en hoja Precios)

---

### Hoja 2: **Precios** (CREAR NUEVA)

**Headers (fila 1):**
```
Colegio | Código Viaje | Precio Total | Apartado | Mensualidades | Meses | Fecha Límite Pago | Notas
```

**Ejemplo de datos:**
```
TODOS      | LON2026 | 75990 | 15000 | 6 | 6 | 15/06/2026 | Precio general para todos los colegios
WC         | LON2026 | 72000 | 12000 | 6 | 6 | 15/06/2026 | Precio especial Winston Churchill
AMERICANO  | LON2026 | 75990 | 15000 | 6 | 6 | 15/06/2026 | Precio Colegio Americano
```

**Migración:**
1. Para cada colegio, crea una fila con:
   - `Colegio` = código del colegio (ej: WC, TH, AMERICANO)
   - `Código Viaje` = LON2026
   - `Precio Total` = precio del viaje para ESE colegio
   - `Apartado`, `Mensualidades`, `Meses` = datos de "Esquemas de Pago"
   - `Fecha Límite Pago` = fecha límite para completar pago
   - `Notas` = notas adicionales

2. **IMPORTANTE:** Siempre crea una fila con `Colegio = TODOS` como fallback

**Lógica del bot:**
- Si busca precio para colegio "WC", encuentra la fila con `Colegio=WC`
- Si busca precio para colegio que NO tiene fila específica, usa la fila `Colegio=TODOS`

---

### Hoja 3: **Colegios** (MODIFICAR existente)

**Headers (fila 1):**
```
Código | Nombre Colegio | Asesora | WhatsApp Asesora | Email Asesora | Zona
```

**Ejemplo de datos:**
```
WC | Winston Churchill | Camila Hernández | 5215535305000 | camila@oxford.com | CDMX Norte
TH | Thomas Jefferson  | Camila Hernández | 5215535305000 | camila@oxford.com | CDMX Sur
```

**Migración desde "Colegios" + "Asesoras":**
1. Mantén las columnas: `codigo` → `Código`, `nombre` → `Nombre Colegio`, `zona` → `Zona`
2. AGREGA 3 columnas nuevas: `Asesora`, `WhatsApp Asesora`, `Email Asesora`
3. Para cada colegio, busca en la hoja "Asesoras" antigua quién está asignado
4. Copia: nombre, whatsapp, email de la asesora en las nuevas columnas

---

### Hoja 4: **Actividades Extra** (RENOMBRAR "Actividades")

**Headers (fila 1):**
```
Código Viaje | Nombre | Precio | Descripción | Incluido | Fecha Límite
```

**Ejemplo de datos:**
```
LON2026 | Harry Potter Studios | 850 | Tour por los estudios de Harry Potter | No | 15/05/2026
LON2026 | Cambridge Day Trip    | 0   | Excursión de un día a Cambridge | Sí en paquete base |
```

**Migración desde "Actividades":**
- `viaje_codigo` → `Código Viaje`
- `nombre` → `Nombre`
- `costo` → `Precio`
- `descripcion` → `Descripción`
- `incluido` → `Incluido`
- NUEVO: `Fecha Límite` (agregar columna)

---

### Hoja 5: **Info General** (RENOMBRAR "Info_Viajes" + "FAQ")

**Headers (fila 1):**
```
Código Viaje | Categoría | Título | Contenido | Orden
```

**Ejemplo de datos:**
```
LON2026 | Trámites     | Pasaporte | Se requiere pasaporte vigente con 6 meses de validez | 1
LON2026 | Clima        | Temperatura | Temperatura promedio en julio: 15-25°C | 2
LON2026 | Equipaje     | Maleta | Se permite 1 maleta de 23kg + 1 equipaje de mano | 3
TODOS   | FAQ          | ¿Incluye seguro? | Sí, incluye seguro médico internacional | 1
TODOS   | FAQ          | ¿Pueden ir los papás? | Los papás no pueden acompañar en este viaje | 2
```

**Migración desde "Info_Viajes" + "FAQ":**

1. **De Info_Viajes:**
   - `viaje_codigo` → `Código Viaje`
   - `categoria` → `Categoría`
   - `titulo` → `Título`
   - `contenido` → `Contenido`
   - NUEVO: `Orden` (agrega números 1, 2, 3... para ordenar)

2. **De FAQ (agregar filas):**
   - `Código Viaje` = `TODOS` (las FAQ aplican a todos los viajes)
   - `Categoría` = `FAQ`
   - `Título` = la pregunta
   - `Contenido` = la respuesta
   - `Orden` = número secuencial

---

### Hoja 6: **Materiales** (MODIFICAR existente)

**Headers (fila 1):**
```
ID | Nombre | Tipo | URL | Código Viaje | Código Colegio | Descripción
```

**Ejemplo de datos:**
```
presentacion_general | Presentación General | PDF | https://drive.google.com/... | TODOS | TODOS | Presentación general del programa
presentacion_wc | Presentación WC | PDF | https://drive.google.com/... | LON2026 | WC | Presentación específica Winston Churchill
itinerario_lon | Itinerario Londres | PDF | https://drive.google.com/... | LON2026 | TODOS | Itinerario detallado Londres
```

**Migración desde "Materiales":**
- `id` → `ID`
- `nombre` → `Nombre`
- `tipo` → `Tipo`
- `url` o `contenido` → `URL`
- NUEVO: `Código Viaje` = código del viaje (o "TODOS" si aplica a todos)
- NUEVO: `Código Colegio` = código del colegio (o "TODOS" si es general)
- `descripcion` → `Descripción`

**Lógica del bot:**
- Si busca material para colegio "WC" y viaje "LON2026", busca: `Código Colegio=WC AND Código Viaje=LON2026`
- Si NO encuentra específico, busca: `Código Colegio=TODOS AND Código Viaje=LON2026`
- Si NO encuentra, busca: `Código Colegio=TODOS AND Código Viaje=TODOS`

---

### Hoja 7: **Leads** (CREAR NUEVA - se llena automáticamente)

**Headers (fila 1):**
```
ID | Fecha | Nombre Padre | Nombre Viajero | Edad | Colegio | WhatsApp | Interés | Estado | Materiales Enviados | Asesor Asignado | Última Actualización | Canal | Notas
```

**NO LLENAR DATOS MANUALMENTE** - Esta hoja la llena el bot automáticamente cuando captura leads.

---

## ✅ PASO 4: VERIFICAR CONFIGURACIÓN

Después de hacer todos los cambios, verifica:

- [ ] Todas las hojas tienen los headers EXACTOS (mayúsculas, acentos, espacios)
- [ ] La hoja "Precios" tiene una fila con `Colegio = TODOS` para cada viaje
- [ ] La hoja "Materiales" tiene `Código Viaje = TODOS` y `Código Colegio = TODOS` para materiales generales
- [ ] La hoja "Info General" tiene `Código Viaje = TODOS` para las FAQ
- [ ] La hoja "Colegios" tiene los datos de asesoras copiados correctamente

---

## 🔧 PASO 5: CÓDIGO ACTUALIZADO

Una vez que termines la migración manual del Google Sheets, el código del bot se actualizará automáticamente para leer la nueva estructura.

**Cambios en el código:**
- `src/core/sheets/cache.js` - Lee nuevos nombres de hojas/columnas
- `src/units/travel/knowledge.js` - Construye conocimiento con nueva estructura
- `src/units/travel/actions.js` - Envía materiales con lógica por colegio
- Variables de entorno - Movimos configuración del Sheet a `.env`

---

## 📊 RESUMEN DE CAMBIOS

### ✅ MEJORAS IMPLEMENTADAS:

1. **Precios por colegio** - Ahora cada colegio puede tener precio diferente
2. **Materiales por colegio** - Presentaciones personalizadas por colegio
3. **Headers en español** - Más fácil de entender
4. **Consolidación** - Menos hojas, más simple
5. **Fallback inteligente** - Si no hay dato específico, usa "TODOS"

### 📉 REDUCCIÓN DE COMPLEJIDAD:

- **ANTES:** 8 hojas con headers en inglés
- **DESPUÉS:** 6 hojas + Leads (auto) con headers en español

---

## ⚠️ NOTAS IMPORTANTES

1. **NO modifiques** los headers después de migrar - el código espera nombres exactos
2. **Siempre usa "TODOS"** como valor de fallback en Precios, Materiales, Info General
3. **El bot lee cada 5 minutos** - Los cambios tardan máximo 5 min en reflejarse
4. **Backup es crítico** - Si algo sale mal, restaura desde el backup

---

Fecha de creación: Mayo 2026
Para: Equipo IT - Oxford Education & Travel
