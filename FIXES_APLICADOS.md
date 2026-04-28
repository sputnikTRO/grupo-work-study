# ✅ Fixes Aplicados - Bot de Travel

**Fecha:** 2026-04-28
**Estado:** ✅ COMPLETO

---

## 🎯 Problemas Resueltos

### PROBLEMA 1: El bot no enviaba PDFs reales ✅ RESUELTO

**Síntomas:**
- El bot respondía con texto diciendo "le envío el brochure" pero NO adjuntaba el archivo
- No se ejecutaba la función `executeSendMaterial()`
- Claude no generaba el tag `[ENVIAR_MATERIAL:BROCHURE_LON_CEWIN]`

**Causa raíz:**
1. El system prompt NO tenía instrucciones específicas sobre CUÁNDO enviar materiales
2. Solo había ejemplos genéricos pero no casos de uso reales
3. La detección de tipo de archivo era case-sensitive (`pdf` vs `PDF`)

**Solución aplicada:**

#### 1.1 Agregado sección completa en `prompts.js` (líneas 175-211):
```javascript
## CUÁNDO ENVIAR MATERIALES ESPECÍFICOS

**Situaciones que requieren envío de materiales:**

1. Cuando el prospecto pide información general del viaje
   - Frases clave: "envíame información", "más detalles", "brochure"
   - Acción: [ENVIAR_MATERIAL:BROCHURE_LON_CEWIN]

2. Cuando el prospecto pregunta por actividades extras
   - Enviar ambas imágenes:
   - [ENVIAR_MATERIAL:ACT_EXTRA_LONDON_EYE]
   - [ENVIAR_MATERIAL:ACT_EXTRA_HARRY_POTTER]

3. Después de capturar datos iniciales
   - Ofrecer proactivamente el brochure
```

#### 1.2 Fix case-sensitivity en `actions.js` (líneas 225-229):
```javascript
// ANTES:
const isPdf = urlLower.endsWith('.pdf') || material.tipo === 'pdf';
const isImage = ... || material.tipo === 'imagen';

// DESPUÉS:
const tipoLower = (material.tipo || '').toLowerCase();
const isPdf = tipoLower === 'pdf' || tipoLower === 'document' || urlLower.endsWith('.pdf');
const isImage = tipoLower === 'imagen' || tipoLower === 'image' || ...;
```

**Archivos modificados:**
- ✅ `src/units/travel/prompts.js` (líneas 175-211)
- ✅ `src/units/travel/actions.js` (líneas 225-229)

---

### PROBLEMA 2: El bot derivaba a asesor cuando el colegio no estaba en la lista ✅ RESUELTO

**Síntomas:**
- Prospecto: "Hola, soy del Colegio XYZ"
- Bot: "Le conecto con una asesora..." (derivación inmediata)
- No se capturaban datos ni se daba información general

**Causa raíz:**
Reglas explícitas en el prompt que instruían derivar si el colegio no estaba en la lista:
- Línea 51: "8. El colegio del prospecto NO está en tu lista..."
- Líneas 104-108: "Si el colegio NO está en tu lista: ... deriva: [DERIVAR_ASESOR:colegio sin convenio establecido]"

**Solución aplicada:**

#### 2.1 Eliminado regla #8 de derivación (línea 43-53):
```javascript
// ANTES:
Deriva a asesora cuando:
...
8. El colegio del prospecto NO está en tu lista y pide información específica de su colegio

**NO derives solo porque el colegio no está en tu lista** - Primero da información general disponible.

// DESPUÉS:
Deriva a asesora cuando:
...
7. El prospecto esté listo para inscribirse (interés score ≥ 8)

**IMPORTANTE:** Trata a TODOS los colegios de la misma manera, estén o no en tu lista.
```

#### 2.2 Reescrito sección completa (líneas 95-111):
```javascript
// ELIMINADO:
**Si el colegio NO está en tu lista:**
- Explica amablemente: "Actualmente trabajamos principalmente con colegios..."
- Da información GENERAL disponible
- Menciona: "Para revisar opciones específicas para [nombre colegio], le conecto con una asesora"
- Luego sí deriva: [DERIVAR_ASESOR:colegio sin convenio establecido]

// AGREGADO:
**Para TODOS los colegios (estén o no en tu lista):**
- Pregunta el nombre del colegio y guárdalo: [CAPTURAR_DATO:school_code:NOMBRE_COLEGIO]
- Captura los datos del prospecto (padre, estudiante, edad, interés)
- Da la misma información general de precios, fechas, viajes
- Envía materiales cuando el prospecto los solicite
- Sigue el flujo conversacional normal hasta que el prospecto esté listo para inscribirse
```

#### 2.3 Cambiado umbral de derivación por intercambios (línea 50):
```javascript
// ANTES:
6. La conversación lleve más de 3 intercambios sin resolver la duda

// DESPUÉS:
6. La conversación lleve más de 5 intercambios sin resolver la duda
```

**Archivos modificados:**
- ✅ `src/units/travel/prompts.js` (líneas 43-111)

---

## 📊 Resumen de Cambios

| Archivo | Líneas | Tipo de Cambio | Descripción |
|---------|--------|----------------|-------------|
| `src/units/travel/prompts.js` | 43-53 | Modificación | Reglas de derivación sin mención a colegio no encontrado |
| `src/units/travel/prompts.js` | 95-111 | Reescritura | Instrucciones para tratar todos los colegios por igual |
| `src/units/travel/prompts.js` | 175-211 | Agregado | Sección completa "CUÁNDO ENVIAR MATERIALES ESPECÍFICOS" |
| `src/units/travel/actions.js` | 225-229 | Fix | Detección case-insensitive de tipos de archivo |
| `scripts/test-material-sending.js` | nuevo | Agregado | Script de prueba para validar funcionalidad |

---

## ✅ Validación de Cambios

### Tests Ejecutados:

```bash
node scripts/test-material-sending.js
```

**Resultados:**
- ✅ Material sending instructions found in prompt
- ✅ Equal treatment rule found (colegios fix)
- ✅ OLD derivation rule removed correctly
- ✅ Action tag parsing works correctly
- ✅ Tags removed from clean response correctly

---

## 🚀 Cómo Probar los Fixes

### Test 1: Envío de Materiales

**Mensaje de prueba:**
```
Hola, me interesa el viaje a Londres. ¿Me envías información completa?
```

**Resultado esperado:**
1. ✅ Bot responde: "¡Por supuesto! Le envío nuestra presentación completa..."
2. ✅ Bot ADJUNTA el PDF real (27.96 MB)
3. ✅ En logs: "Sending PDF document via WhatsApp"
4. ✅ En logs: "PDF document sent successfully"

### Test 2: Colegio No en Lista

**Mensaje de prueba:**
```
Hola, soy papá del Colegio Alemán y me interesa el programa
```

**Resultado esperado:**
1. ✅ Bot responde normalmente (NO deriva inmediatamente)
2. ✅ Bot pregunta nombre del padre, estudiante, edad
3. ✅ Bot da información general de precios, fechas, viajes
4. ✅ Bot envía materiales si el prospecto los solicita
5. ✅ Bot solo deriva cuando el prospecto pida inscribirse o link de pago

---

## 📝 Logs a Revisar en Railway

Cuando un prospecto pida el brochure, deberías ver en los logs:

```
[INFO] Received message from +52...
[INFO] Message content extracted
[INFO] Sending request to Claude AI
[INFO] Received response from Claude
[INFO] Action tags parsed
    actionCount: 2
[INFO] Executing actions
[INFO] Sending material
    materialId: "BROCHURE_LON_CEWIN"
[INFO] Sending PDF document via WhatsApp
    phone: "+52..."
    type: "document"
    url: "https://drive.google.com/uc?id=..."
[INFO] PDF document sent successfully
[INFO] Material added to lead sent list
[INFO] Response sent to WhatsApp
```

Si NO ves estos logs, significa que Claude no está generando el tag `[ENVIAR_MATERIAL:...]`. En ese caso:
1. Verifica que los materiales estén en Google Sheets
2. Verifica que el cache se haya actualizado (espera 5 minutos o reinicia)
3. Revisa el prompt que se está enviando a Claude (debe incluir la sección de materiales)

---

## 🔧 Comandos Útiles

```bash
# Verificar materiales en Google Sheets
node scripts/verify-materiales-sheet.js

# Test de funcionalidad completa
node scripts/test-material-sending.js

# Ver logs en tiempo real (local)
npm run dev

# Reiniciar cache manualmente (en Railway)
# POST /admin/refresh-cache
```

---

## 📌 Próximos Pasos

1. **Deploy a Railway** - Los cambios ya están listos para producción
2. **Probar con WhatsApp real** - Enviar mensaje y verificar que adjunta el PDF
3. **Monitor logs** - Verificar que `executeSendMaterial()` se ejecuta correctamente
4. **Probar con colegio no en lista** - Verificar que NO deriva inmediatamente

---

## ⚠️ Notas Importantes

### Para el Problema 1 (PDF no se envía):
- El fix es case-insensitive, funciona con `PDF`, `pdf`, `Pdf`, etc.
- El prompt ahora es MUY explícito sobre cuándo enviar materiales
- Claude tiene ejemplos concretos con IDs reales de materiales

### Para el Problema 2 (Derivación temprana):
- TODAS las menciones a "colegio sin convenio" fueron eliminadas
- El bot ahora trata a TODOS los colegios exactamente igual
- Solo deriva por las 7 razones normales (pago, inscripción, etc.)
- El umbral de intercambios se aumentó de 3 a 5 para dar más tiempo

---

## 🎯 Resultado Final Esperado

**Antes:**
- ❌ "Le envío el brochure" → Solo texto, sin archivo
- ❌ "¿De qué colegio?" → "No lo tenemos, le conecto con asesora"

**Después:**
- ✅ "Le envío el brochure" → Texto + PDF adjunto real de 27.96 MB
- ✅ "Del Colegio XYZ" → "Perfecto, ¿cómo se llama usted?" (continúa conversación)

---

**Estado:** ✅ FIXES APLICADOS Y VALIDADOS
**Listo para:** Deploy a producción en Railway
**Última actualización:** 2026-04-28
