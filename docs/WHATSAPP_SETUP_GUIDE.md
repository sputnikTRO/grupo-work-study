# Guía de Configuración de WhatsApp Business API

## Objetivo

Obtener las 3 credenciales necesarias para conectar el bot con WhatsApp:

1. `WA_VERIFY_TOKEN` - Token de verificación (tú lo eliges)
2. `WA_ACCESS_TOKEN` - Token de acceso de Meta
3. `WA_PHONE_NUMBER_ID_TRAVEL` - ID del número de WhatsApp

---

## Paso 1: Acceder a Meta for Developers

1. Ve a https://developers.facebook.com/
2. Inicia sesión con tu cuenta de Facebook/Meta
3. Ya debes tener una cuenta creada

---

## Paso 2: Crear una App de Negocio

1. Click en **"My Apps"** (arriba a la derecha)
2. Click en **"Create App"**
3. Selecciona tipo: **"Business"**
4. Click en **"Next"**

**Detalles de la App:**
- **Display name:** `Grupo Work & Study Bot`
- **App contact email:** Tu email de contacto
- **Business Portfolio:** Selecciona tu negocio o crea uno nuevo

5. Click en **"Create App"**
6. Completa la verificación de seguridad si te la pide

---

## Paso 3: Agregar WhatsApp al App

1. En el dashboard de tu app, busca **"WhatsApp"** en la lista de productos
2. Click en **"Set Up"** en la tarjeta de WhatsApp
3. Sigue el wizard de configuración

---

## Paso 4: Configurar Número de WhatsApp

### Opción A: Usar Número de Prueba (Para Testing)

Meta te da un número de prueba gratis:

1. En la sección **"API Setup"**, verás un número de prueba
2. Copia el **"Phone number ID"** - Este es tu `WA_PHONE_NUMBER_ID_TRAVEL`
3. Agrega números de prueba:
   - Click en **"Add phone number"**
   - Ingresa tu número personal de WhatsApp
   - Recibirás un código de verificación por WhatsApp
   - Ingrésalo para confirmar

**Limitaciones del número de prueba:**
- Solo puedes enviar mensajes a números que agregues manualmente
- Máximo 5 números
- Ideal para desarrollo y testing

### Opción B: Usar tu Propio Número de WhatsApp Business (Producción)

Para usar tu número real de WhatsApp Business:

1. Ve a **"WhatsApp"** → **"Getting Started"**
2. Click en **"Add phone number"**
3. Ingresa tu número de WhatsApp Business
4. Sigue el proceso de verificación
5. **IMPORTANTE:** Este número ya no podrá usarse en WhatsApp normal

---

## Paso 5: Obtener el Access Token

### Token Temporal (24 horas - Para Testing):

1. En **"API Setup"**, verás **"Temporary access token"**
2. Click en **copiar**
3. Este es tu `WA_ACCESS_TOKEN` (válido por 24 horas)

### Token Permanente (Producción):

1. Ve a **"WhatsApp"** → **"Configuration"**
2. Scroll hasta **"Permanent tokens"**
3. Click en **"Create permanent token"**
4. Selecciona permisos:
   - ✅ `whatsapp_business_messaging`
   - ✅ `whatsapp_business_management`
5. Click en **"Generate Token"**
6. **COPIA Y GUARDA EL TOKEN** - No podrás verlo de nuevo
7. Este es tu `WA_ACCESS_TOKEN` permanente

---

## Paso 6: Elegir un Verify Token

El `WA_VERIFY_TOKEN` es un token que **tú eliges**. Puede ser cualquier cadena alfanumérica segura.

**Ejemplo:**
```
travel_bot_verify_2027_xyz789
```

**Requisitos:**
- Mínimo 8 caracteres
- Solo letras, números y guiones bajos
- Sin espacios ni caracteres especiales

**Guárdalo**, lo necesitarás en el siguiente paso.

---

## Paso 7: Configurar el Webhook

Una vez que tu servidor esté desplegado en Railway:

1. Ve a **"WhatsApp"** → **"Configuration"**
2. En la sección **"Webhook"**, click en **"Edit"**
3. Completa:

   **Callback URL:**
   ```
   https://tu-app.up.railway.app/webhook
   ```

   **Verify token:**
   ```
   El token que elegiste en el Paso 6
   ```

4. Click en **"Verify and Save"**

Railway verificará que el webhook esté funcionando.

---

## Paso 8: Suscribirse a Eventos

1. En la misma sección de Webhook, click en **"Manage"**
2. Busca el campo **"messages"**
3. Marca la casilla ✅ **"messages"**
4. Click en **"Save"**

Ahora WhatsApp enviará los mensajes a tu bot.

---

## Paso 9: Actualizar Variables en Railway

1. Ve a tu proyecto en Railway: https://railway.app/
2. Click en tu servicio **"grupo-work-study"**
3. Ve a la pestaña **"Variables"**
4. Actualiza estas tres variables:

```env
WA_VERIFY_TOKEN=tu_token_que_elegiste
WA_ACCESS_TOKEN=EAAxxxxxxxxxx (el token de Meta)
WA_PHONE_NUMBER_ID_TRAVEL=123456789012345 (el Phone Number ID)
```

5. Click en **"Deploy"**

---

## Paso 10: Probar el Bot

### Si usas número de prueba:

1. Desde tu WhatsApp personal (que agregaste en el Paso 4A)
2. Envía un mensaje al número de prueba que te dio Meta
3. El bot debería responder automáticamente

### Si usas tu número real:

1. Cualquier persona puede escribirte
2. El bot responderá automáticamente

---

## 🔍 Verificar que Todo Funciona

### 1. Health Check

Abre en tu navegador:
```
https://tu-app.up.railway.app/health
```

Deberías ver:
```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "jobs": { ... }
}
```

### 2. Ver Logs en Railway

1. En Railway, click en **"Deployments"**
2. Click en el deployment activo
3. Click en **"View Logs"**
4. Envía un mensaje de prueba por WhatsApp
5. Deberías ver logs como:
   ```
   [INFO] Received webhook POST
   [INFO] Lock acquired, processing message
   [INFO] Sending request to Claude AI
   [INFO] Response sent to WhatsApp
   ```

---

## 📊 Resumen de Credenciales

Al final de este proceso tendrás:

| Variable | Valor | Dónde se obtiene |
|----------|-------|------------------|
| `WA_VERIFY_TOKEN` | `travel_bot_verify_2027_xyz789` | Tú lo eliges |
| `WA_ACCESS_TOKEN` | `EAAxxxxxxxxxxxxx` | Meta for Developers → API Setup |
| `WA_PHONE_NUMBER_ID_TRAVEL` | `123456789012345` | Meta for Developers → API Setup |

---

## ⚠️ Troubleshooting

### Error: "Webhook verification failed"

**Causa:** El `WA_VERIFY_TOKEN` en Railway no coincide con el que pusiste en Meta.

**Solución:** Verifica que sean exactamente iguales.

---

### Error: "Invalid access token"

**Causa:** El token expiró (si usaste el temporal) o es inválido.

**Solución:**
- Si usaste token temporal: Genera uno nuevo cada 24h
- Si usaste token permanente: Verifica que lo copiaste completo

---

### El bot no responde

**Checklist:**
1. ✅ Servidor corriendo en Railway
2. ✅ Webhook configurado correctamente
3. ✅ Eventos "messages" suscritos
4. ✅ Número agregado como número de prueba (si usas número de prueba)
5. ✅ Variables de entorno correctas en Railway

**Debug:**
- Ve a los logs de Railway
- Envía un mensaje de prueba
- Deberías ver `[INFO] Received webhook POST`
- Si no ves nada, el webhook no está llegando

---

### Error 403: Permission Denied

**Causa:** Tu Access Token no tiene los permisos necesarios.

**Solución:** Genera un nuevo token con los permisos correctos:
- `whatsapp_business_messaging`
- `whatsapp_business_management`

---

## 🎉 ¡Listo!

Una vez completados estos pasos, tu bot estará:

- ✅ Recibiendo mensajes de WhatsApp
- ✅ Respondiendo automáticamente con Claude AI
- ✅ Detectando colegios
- ✅ Sincronizando leads a Google Sheets
- ✅ Enviando materiales
- ✅ Derivando a asesores cuando sea necesario

---

## 📞 Soporte

Si tienes problemas:

1. Revisa los logs en Railway
2. Verifica que todas las variables estén configuradas
3. Consulta la documentación oficial: https://developers.facebook.com/docs/whatsapp

---

**Última actualización:** 2026-03-11
