# Habilitar Google Drive API

Tu service account necesita acceso a Google Drive API para subir archivos.

## 🚀 Pasos Rápidos

1. **Abre este link en tu navegador:**

   https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=333703971236

2. **Click en "ENABLE" (Habilitar)**

3. **Espera 1-2 minutos** para que se propague el cambio

4. **Vuelve a ejecutar el script:**
   ```bash
   node scripts/upload-pdf-to-drive.js \
     "/Users/osx/Downloads/Chat de WhatsApp con Giselle Reyes - Dashell WC/_Pre-Travel Experience The Opening E4L.pdf" \
     "BROCHURE_LON_CEWIN" \
     "Brochure English 4 Life Londres 2026 - CEWIN" \
     "LON2026" \
     "Información completa del viaje a Londres 2026 para CEWIN"
   ```

## 🔧 Si el link no funciona

1. Ve a: https://console.cloud.google.com/
2. Selecciona tu proyecto (el que usas para las Sheets)
3. En el menú lateral: **APIs & Services** → **Library**
4. Busca: "Google Drive API"
5. Click en "Google Drive API"
6. Click en **"ENABLE"**

## ✅ Verificar que está habilitada

Una vez habilitada, verás:
- Estado: "API enabled"
- Podrás ver métricas y cuotas

---

**Nota:** Solo necesitas hacer esto una vez. Después el script funcionará siempre.
