# ✅ Deploy a Railway - Completo

**Fecha:** 2026-04-28
**Commit:** d9a83dc
**Estado:** ✅ PUSH EXITOSO → Railway está deployando

---

## 🚀 Qué se Deployó

### **Cambios Principales:**

1. **Fix envío de PDFs** - `src/units/travel/prompts.js`
   - Instrucciones explícitas sobre cuándo enviar materiales
   - Claude ahora sabe exactamente cuándo usar `[ENVIAR_MATERIAL:BROCHURE_LON_CEWIN]`

2. **Fix derivación temprana** - `src/units/travel/prompts.js`
   - Eliminadas todas las reglas de "colegio sin convenio"
   - Ahora trata a TODOS los colegios por igual

3. **Fix case-sensitivity** - `src/units/travel/actions.js`
   - Detección de PDFs ahora funciona con `PDF`, `pdf`, `Pdf`, etc.

### **Archivos Deployados:**
```
✅ src/units/travel/actions.js      - Fix detección PDFs
✅ src/units/travel/prompts.js      - Reglas actualizadas
✅ FIXES_APLICADOS.md               - Documentación técnica
✅ MATERIALES_CONFIGURADOS.md       - Info de materiales
✅ scripts/verify-materiales-sheet.js
✅ scripts/test-material-sending.js
✅ scripts/add-material-to-sheet.js
✅ scripts/upload-pdf-to-drive.js
```

---

## 🔍 Verificar el Deploy en Railway

### **Paso 1: Ir a Railway Dashboard**

1. Abre: https://railway.app/
2. Inicia sesión
3. Selecciona el proyecto "grupo-work-study" (o el nombre que le hayas dado)

### **Paso 2: Ver el Deploy en Progreso**

Deberías ver:

```
🔄 Deploying...
   Commit: d9a83dc
   Message: "Fix: Bot ahora envía PDFs reales y no deriva por colegio desconocido"
   Status: Building...
```

**Tiempo estimado:** 2-4 minutos

### **Paso 3: Monitorear Logs de Build**

Click en el deployment en progreso → "View Logs"

Logs esperados:
```bash
[build] Cloning repository...
[build] Installing dependencies...
[build] npm install
[build] Running: npx prisma generate && npx prisma migrate deploy
[build] Build successful!
[deploy] Starting application...
[deploy] Server listening on port 3000
[deploy] All background jobs started successfully
```

### **Paso 4: Verificar que el Deploy Terminó**

Espera hasta ver:
```
✅ Deployed
   Status: Active
   Deployed X minutes ago
```

---

## 🧪 Probar que los Fixes Funcionan

### **Test 1: Envío de PDF**

**Envía por WhatsApp al bot:**
```
Hola, me interesa el viaje a Londres. ¿Me envías información completa?
```

**Resultado esperado:**
1. ✅ Bot responde: "¡Por supuesto! Le envío nuestra presentación completa..."
2. ✅ **Recibes el PDF adjunto** (27.96 MB)
3. ✅ El PDF se descarga/abre correctamente

**Si NO funciona:**
- Ve a Railway → Logs
- Busca: "Sending PDF document via WhatsApp"
- Busca: "PDF document sent successfully"
- Si NO aparecen estos logs, Claude no está generando el tag

---

### **Test 2: Colegio No en Lista**

**Envía por WhatsApp:**
```
Hola, soy papá del Colegio Alemán y me interesa el programa
```

**Resultado esperado:**
1. ✅ Bot responde: "¡Bienvenido! ¿Cómo se llama usted?"
2. ✅ Bot pregunta por nombre del estudiante, edad
3. ✅ Bot da información general de precios, fechas
4. ✅ Bot NO deriva inmediatamente

**Si deriva inmediatamente:**
- Ve a Railway → Logs
- Busca: "DERIVAR_ASESOR"
- Verifica que NO aparezca "colegio sin convenio"

---

## 📊 Ver Logs en Railway

### **Logs en Tiempo Real:**

1. Ve a Railway Dashboard
2. Click en tu servicio
3. Click en "Deployments" → Deployment actual
4. Click en "View Logs"

### **Filtrar Logs Importantes:**

**Para ver si envía PDFs:**
```
Buscar: "Sending PDF document"
Buscar: "Material added to lead"
```

**Para ver si deriva correctamente:**
```
Buscar: "Handing off to advisor"
Buscar: "DERIVAR_ASESOR"
```

**Para ver errores:**
```
Buscar: "ERROR"
Buscar: "Error sending material"
```

---

## 🔧 Si Algo No Funciona

### **Problema: PDF no se envía**

**Debug en Railway Logs:**

1. Busca: `"Action tags parsed"`
   - Si NO aparece `[ENVIAR_MATERIAL:...]`, Claude no generó el tag
   - Revisa que el prompt se esté cargando correctamente

2. Busca: `"Material not found in cache"`
   - Verifica que los materiales estén en Google Sheets
   - Espera 5 minutos para que el cache se actualice
   - O reinicia el servicio en Railway

3. Busca: `"Error sending material"`
   - Revisa la URL del material en Google Sheets
   - Verifica que el link sea público

**Solución rápida:**
```bash
# Reiniciar servicio en Railway:
1. Ve a Settings → Service
2. Click "Restart"
3. Espera 1-2 minutos
4. Prueba de nuevo
```

---

### **Problema: Bot deriva inmediatamente**

**Debug en Railway Logs:**

1. Busca: `"Handing off to advisor"`
   - Lee la razón: `{ reason: "..." }`
   - Si dice "colegio sin convenio", el deploy no se aplicó

2. Busca: `"School detected"`
   - Verifica qué colegio detectó
   - Verifica que el código esté correcto

**Solución:**
```bash
# Verificar que el deploy correcto está activo:
1. Ve a Deployments en Railway
2. Verifica que el commit sea: d9a83dc
3. Si no, fuerza un nuevo deploy:
   - Settings → Service
   - "Redeploy"
```

---

## 📱 Comandos Útiles Post-Deploy

### **Ver estado de Google Sheets:**
```bash
# En Railway, abre Console y ejecuta:
node scripts/verify-materiales-sheet.js
```

### **Forzar refresh del cache:**
```bash
# Hacer request a tu API:
curl -X POST https://tu-app.up.railway.app/admin/refresh-cache
```

### **Ver logs específicos:**
```bash
# En Railway Console:
cat logs/app.log | grep "ENVIAR_MATERIAL"
cat logs/app.log | grep "DERIVAR_ASESOR"
```

---

## 📋 Checklist de Verificación

Después del deploy, verifica:

- [ ] Deploy completado exitosamente en Railway
- [ ] Logs muestran: "Server listening on port 3000"
- [ ] Logs muestran: "All background jobs started successfully"
- [ ] Health check responde OK: `curl https://tu-app.up.railway.app/health`
- [ ] Test WhatsApp: Bot responde a mensajes
- [ ] Test WhatsApp: Bot envía PDF cuando se solicita
- [ ] Test WhatsApp: Bot NO deriva inmediatamente con colegio desconocido
- [ ] Logs NO muestran: "colegio sin convenio establecido"

---

## 🎯 Resultado Esperado

**ANTES del fix:**
```
Usuario: "Envíame info de Londres"
Bot: "Le envío el brochure" → Solo texto, sin archivo

Usuario: "Soy del Colegio Alemán"
Bot: "Le conecto con una asesora" → Derivación inmediata
```

**DESPUÉS del fix:**
```
Usuario: "Envíame info de Londres"
Bot: "Le envío el brochure" → Texto + PDF adjunto real ✅

Usuario: "Soy del Colegio Alemán"
Bot: "¿Cómo se llama usted?" → Continúa conversación ✅
```

---

## 🚨 Problemas Comunes

### **"Cannot find module" en Railway**
```bash
# Asegúrate de que package.json está actualizado
# Revisa que las dependencias estén instaladas:
npm install
```

### **"Redis connection refused"**
```bash
# Verifica que REDIS_URL esté configurado en Railway:
1. Settings → Variables
2. REDIS_URL debe estar presente
3. Si no, agrégalo con el valor de tu Redis de Railway
```

### **"Google Sheets API error"**
```bash
# Verifica variables de entorno en Railway:
1. GOOGLE_SHEETS_ID
2. GOOGLE_SERVICE_ACCOUNT_EMAIL
3. GOOGLE_PRIVATE_KEY (debe tener \n literales)
```

---

## ✅ Estado Final

```
✅ Código pushed a GitHub
✅ Railway detectó el push automáticamente
✅ Railway está deployando los cambios
✅ Tiempo estimado: 2-4 minutos
✅ Listo para pruebas con WhatsApp real
```

---

## 📞 Siguiente Paso

**¡Prueba el bot ahora mismo!**

1. Abre WhatsApp
2. Envía: "Hola, me interesa Londres. Envíame información"
3. Verifica que recibes el PDF adjunto
4. Prueba con un colegio que no esté en la lista
5. Verifica que el bot NO deriva inmediatamente

---

**Deploy completado:** ✅
**Listo para producción:** ✅
**Última actualización:** 2026-04-28
