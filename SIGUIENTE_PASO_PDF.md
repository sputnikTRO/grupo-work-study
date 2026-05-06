# 📋 Siguiente Paso: Configurar Envío de PDF por WhatsApp

## ✅ Lo que YA está LISTO:

1. ✅ **Código de WhatsApp funcionando** - El bot ya puede enviar PDFs reales
2. ✅ **Script automático creado** - `/scripts/upload-pdf-to-drive.js`
3. ✅ **Scripts alternativos creados** - Por si prefieres subir manualmente
4. ✅ **Hoja "Materiales" verificada** - Estructura correcta y lista
5. ✅ **PDF encontrado** - En `/Users/osx/Downloads/...`

---

## 🚀 ELIGE TU OPCIÓN:

### **OPCIÓN A: Script Automático (Recomendado)** ⭐

**Ventaja:** Todo automatizado en un solo comando

**Pasos:**

1. **Habilitar Google Drive API** (solo una vez):
   - Abre: https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=333703971236
   - Click en **"ENABLE"**
   - Espera 1-2 minutos

2. **Ejecutar el script:**
   ```bash
   cd /Users/osx/grupo-work-study

   node scripts/upload-pdf-to-drive.js \
     "/Users/osx/Downloads/Chat de WhatsApp con Giselle Reyes - Dashell WC/_Pre-Travel Experience The Opening E4L.pdf" \
     "BROCHURE_LON_CEWIN" \
     "Brochure English 4 Life Londres 2026 - CEWIN" \
     "LON2026" \
     "Información completa del viaje a Londres 2026 para CEWIN"
   ```

3. **¡Listo!** El script:
   - ✅ Sube el PDF a Google Drive
   - ✅ Lo hace público
   - ✅ Agrega la fila a la hoja "Materiales"
   - ✅ Te da la URL pública

---

### **OPCIÓN B: Subida Manual**

**Ventaja:** No necesitas habilitar Google Drive API

**Pasos:**

1. **Sube el PDF a Google Drive:**
   - Ve a: https://drive.google.com/
   - Click en "Nuevo" → "Subir archivo"
   - Selecciona: `/Users/osx/Downloads/Chat de WhatsApp con Giselle Reyes - Dashell WC/_Pre-Travel Experience The Opening E4L.pdf`

2. **Haz el PDF público:**
   - Click derecho en el PDF → "Compartir"
   - Acceso general: "Cualquier usuario con el enlace" → "Lector"
   - Click derecho → "Obtener enlace"
   - Copia el ID (la parte entre `/d/` y `/view`)
   - Genera URL: `https://drive.google.com/uc?id=TU_ID&export=download`

3. **Ejecuta el script para agregar al Sheet:**
   ```bash
   cd /Users/osx/grupo-work-study

   node scripts/add-material-to-sheet.js \
     "https://drive.google.com/uc?id=TU_ID&export=download" \
     "BROCHURE_LON_CEWIN" \
     "Brochure English 4 Life Londres 2026 - CEWIN" \
     "LON2026" \
     "Información completa del viaje a Londres 2026 para CEWIN"
   ```

**Documentación completa:** `docs/SUBIR_PDF_MANUAL.md`

---

## 🧪 Probar que Funciona

Una vez agregado el material, prueba el envío:

### Opción 1: Script de Demo

```bash
node scripts/demo-bot.js
```

Cuando el bot pregunte, escribe:
```
Envíame el brochure de Londres
```

### Opción 2: WhatsApp Real

Envía un mensaje al bot desde tu WhatsApp:
```
Hola, me interesa el viaje a Londres. ¿Me puedes enviar más información?
```

El bot debería responder y **adjuntar el PDF real**.

---

## 🔍 Verificar que el Material se Agregó

```bash
node scripts/verify-materiales-sheet.js
```

Deberías ver:
```
3. Brochure English 4 Life Londres 2026 - CEWIN
   ID: BROCHURE_LON_CEWIN
   Tipo: pdf
   URL: https://drive.google.com/uc?id=...
   Viaje: LON2026
```

---

## 📊 Estado Actual de Materiales

Ya tienes 2 materiales de ejemplo:
1. `BROCHURE_LON` - Brochure Londres
2. `PRECIOS` - Lista de Precios

Después de ejecutar el script, tendrás:
3. `BROCHURE_LON_CEWIN` - **Tu nuevo PDF** ✨

---

## 🤖 Cómo el Bot Usará el PDF

Cuando Claude detecte que debe enviar este material, incluirá en su respuesta:

```
[ENVIAR_MATERIAL:BROCHURE_LON_CEWIN]
```

El sistema automáticamente:
1. Lee el material de la hoja "Materiales"
2. Descarga la URL pública
3. Envía el PDF real al prospecto por WhatsApp
4. Registra que el material fue enviado

---

## 📝 Archivos Creados

```
scripts/
  ├── upload-pdf-to-drive.js         ← Script automático (Opción A)
  ├── add-material-to-sheet.js       ← Solo agregar al Sheet (Opción B)
  └── verify-materiales-sheet.js     ← Verificar materiales actuales

docs/
  ├── HABILITAR_GOOGLE_DRIVE_API.md  ← Guía para habilitar API
  ├── SUBIR_PDF_MANUAL.md            ← Guía paso a paso manual
  └── SIGUIENTE_PASO_PDF.md          ← Este archivo (resumen)
```

---

## ❓ ¿Cuál Opción Recomiendo?

**OPCIÓN A (Script Automático)** si:
- ✅ Tienes acceso a Google Cloud Console
- ✅ Puedes habilitar APIs (toma 30 segundos)
- ✅ Quieres automatizar futuros PDFs

**OPCIÓN B (Manual)** si:
- ✅ No tienes acceso a Google Cloud Console
- ✅ Prefieres no tocar configuraciones de APIs
- ✅ Es solo un PDF y no planeas subir más

---

## 🚨 Problemas Comunes

### "API not enabled"
→ Ve a la URL que te di y habilita Google Drive API

### "Permission denied"
→ Asegúrate de que el service account tenga acceso al Sheet

### "Sheet not found"
→ Verifica que la hoja se llame exactamente "Materiales"

### "Invalid URL"
→ Verifica que el PDF sea público y la URL tenga formato correcto

---

## 🎉 ¿Listo para Empezar?

**Elige tu opción y ejecuta los comandos correspondientes arriba.**

Si tienes dudas, avísame y te ayudo. 🚀
