# Subir PDF Manualmente a Google Drive

Si no puedes usar el script automático, sigue estos pasos para subir el PDF manualmente.

## 📤 Paso 1: Subir a Google Drive

1. **Abre Google Drive:** https://drive.google.com/

2. **Sube el PDF:**
   - Click en "Nuevo" → "Subir archivo"
   - Selecciona: `/Users/osx/Downloads/Chat de WhatsApp con Giselle Reyes - Dashell WC/_Pre-Travel Experience The Opening E4L.pdf`
   - Espera a que termine de subir (27.96 MB)

3. **Renombra el archivo (opcional pero recomendado):**
   - Click derecho en el PDF → "Cambiar nombre"
   - Nuevo nombre: `Brochure English 4 Life Londres 2026 - CEWIN.pdf`

## 🔓 Paso 2: Hacer el PDF Público

1. **Click derecho en el PDF** → **"Compartir"**

2. **En "Acceso general":**
   - Click en "Restringido"
   - Cambia a **"Cualquier usuario con el enlace"**
   - Rol: **"Lector"**
   - Click en **"Listo"**

3. **Obtener el ID del archivo:**
   - Click derecho en el PDF → **"Obtener enlace"**
   - Copia el enlace (se ve así):
     ```
     https://drive.google.com/file/d/1ABC123xyz456789/view?usp=sharing
     ```
   - El ID es la parte entre `/d/` y `/view`:
     ```
     1ABC123xyz456789
     ```

4. **Generar URL pública:**
   - Reemplaza `YOUR_FILE_ID` con el ID que copiaste:
   ```
   https://drive.google.com/uc?id=YOUR_FILE_ID&export=download
   ```

   Ejemplo:
   ```
   https://drive.google.com/uc?id=1ABC123xyz456789&export=download
   ```

## 📝 Paso 3: Agregar a Google Sheets

Ahora usa el script para agregar la fila a la hoja "Materiales":

```bash
node scripts/add-material-to-sheet.js \
  "https://drive.google.com/uc?id=TU_FILE_ID&export=download" \
  "BROCHURE_LON_CEWIN" \
  "Brochure English 4 Life Londres 2026 - CEWIN" \
  "LON2026" \
  "Información completa del viaje a Londres 2026 para CEWIN"
```

**Reemplaza `TU_FILE_ID` con el ID real del archivo.**

## ✅ Verificar

1. Abre tu Google Sheets
2. Ve a la hoja "Materiales"
3. Verifica que la nueva fila aparezca con:
   - ID: `BROCHURE_LON_CEWIN`
   - Nombre: `Brochure English 4 Life Londres 2026 - CEWIN`
   - Tipo: `pdf`
   - URL: La URL pública que creaste
   - Viaje Código: `LON2026`

## 🤖 Probar

Para probar que el bot puede enviar el PDF:

```bash
node scripts/demo-bot.js
```

O envía un mensaje de WhatsApp al bot y usa el comando:
```
Por favor envíame el brochure de Londres
```

El bot debería responder con el PDF adjunto.

---

**Nota:** Este proceso manual es necesario solo si no puedes habilitar Google Drive API. Si habilitas la API, puedes usar el script automático que hace todo esto por ti.
