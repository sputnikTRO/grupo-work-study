# 🚀 CHECKLIST DE DEPLOY A RAILWAY

## Fecha: 2026-03-11

Este documento contiene el **paso a paso EXACTO** para hacer deploy del sistema Grupo Work & Study en Railway.

---

## ⏱️ TIEMPO ESTIMADO: 20-30 minutos

---

## 📋 PRE-REQUISITOS

Antes de comenzar, asegúrate de tener:

- ✅ Cuenta en [GitHub](https://github.com)
- ✅ Cuenta en [Railway](https://railway.app) (Sign up con GitHub)
- ✅ Cuenta en [Meta for Developers](https://developers.facebook.com)
- ✅ Cuenta en [Anthropic](https://console.anthropic.com)
- ✅ Google Cloud con Service Account configurado
- ✅ Google Sheet creado y compartido con el service account

---

## 📝 PASO 1: SUBIR CÓDIGO A GITHUB

### 1.1. Crear repositorio en GitHub

1. Ve a https://github.com/new
2. Repository name: `grupo-work-study-bot`
3. Description: `Sistema WhatsApp Automation para Grupo Work & Study`
4. Visibility: **Private** (recomendado)
5. **NO inicialices** con README, .gitignore ni license
6. Click **"Create repository"**

### 1.2. Conectar repositorio local

```bash
cd grupo-work-study

# Inicializar git (si no está inicializado)
git init

# Agregar remote
git remote add origin https://github.com/TU-USUARIO/grupo-work-study-bot.git

# Verificar que no hay archivos sensibles
cat .gitignore

# Debe incluir:
# .env
# node_modules/
# *.log
```

### 1.3. Hacer commit inicial

```bash
# Agregar todos los archivos
git add .

# Ver qué se va a commitear
git status

# ⚠️ IMPORTANTE: Verifica que .env NO esté en la lista
# Si aparece .env, agrégalo a .gitignore primero

# Hacer commit
git commit -m "Initial commit: Fase 2 completa con Travel unit

- Bot conversacional con Claude AI
- Google Sheets como backend dinámico
- Detección automática de colegios
- Lead scoring en tiempo real
- Envío de materiales por WhatsApp (PDFs e imágenes)
- Notificación a asesores
- Rate limiting (25 msg/10s)
- Follow-ups automáticos
- Derivación a asesor humano"

# Push a GitHub
git push -u origin main
```

✅ **Checkpoint:** Tu código ahora está en GitHub

---

## 🚂 PASO 2: CREAR PROYECTO EN RAILWAY

### 2.1. Login en Railway

1. Ve a https://railway.app
2. Click **"Login"**
3. Autoriza con tu cuenta de GitHub

### 2.2. Crear nuevo proyecto

1. Click **"New Project"**
2. Selecciona **"Deploy from GitHub repo"**
3. Railway te pedirá autorizar acceso a tus repositorios
4. Click **"Configure GitHub App"**
5. Selecciona **"Only select repositories"**
6. Elige `grupo-work-study-bot`
7. Click **"Install & Authorize"**

### 2.3. Seleccionar repositorio

1. De vuelta en Railway, busca tu repositorio
2. Click en `grupo-work-study-bot`
3. Railway detectará automáticamente que es Node.js
4. Click **"Deploy Now"**

⚠️ **El primer deploy FALLARÁ** (es normal, faltan las variables de entorno)

✅ **Checkpoint:** Proyecto creado en Railway

---

## 🗄️ PASO 3: AGREGAR POSTGRESQL

### 3.1. Agregar base de datos

1. En tu proyecto de Railway, click **"New"** (botón morado)
2. Selecciona **"Database"**
3. Selecciona **"Add PostgreSQL"**
4. Railway creará una base de datos automáticamente

### 3.2. Verificar conexión automática

1. Click en el servicio de PostgreSQL (cuadro morado)
2. Ve a la pestaña **"Variables"**
3. Verás que Railway generó automáticamente:
   - `PGHOST`
   - `PGPORT`
   - `PGUSER`
   - `PGPASSWORD`
   - `PGDATABASE`
   - **`DATABASE_URL`** ← Esta es la que usamos

### 3.3. Conectar con el servicio de Node.js

1. Railway conecta automáticamente los servicios
2. Verifica: En tu servicio de Node.js, pestaña **"Variables"**
3. Deberías ver `DATABASE_URL` compartida desde PostgreSQL

✅ **Checkpoint:** PostgreSQL conectado y `DATABASE_URL` disponible

---

## 🔴 PASO 4: AGREGAR REDIS

### 4.1. Agregar Redis

1. En tu proyecto de Railway, click **"New"** otra vez
2. Selecciona **"Database"**
3. Selecciona **"Add Redis"**
4. Railway creará Redis automáticamente

### 4.2. Verificar conexión

1. Click en el servicio de Redis (cuadro rojo)
2. Ve a la pestaña **"Variables"**
3. Verás:
   - `REDIS_PRIVATE_URL`
   - **`REDIS_URL`** ← Esta es la que usamos

### 4.3. Conectar con Node.js

1. Ve a tu servicio de Node.js, pestaña **"Variables"**
2. Verifica que `REDIS_URL` esté compartida desde Redis

✅ **Checkpoint:** Redis conectado y `REDIS_URL` disponible

---

## ⚙️ PASO 5: CONFIGURAR VARIABLES DE ENTORNO

### 5.1. Ir a Variables

1. Click en tu servicio de Node.js (cuadro verde/azul)
2. Ve a la pestaña **"Variables"**
3. Click en **"RAW Editor"** (arriba a la derecha)

### 5.2. Agregar TODAS las variables

Copia y pega el siguiente bloque, **reemplazando los valores con tus credenciales reales**:

```bash
# ==========================================
# SERVIDOR (Railway asigna PORT automáticamente)
# ==========================================
NODE_ENV=production
LOG_LEVEL=info

# ==========================================
# WHATSAPP META CLOUD API
# ==========================================
WA_VERIFY_TOKEN=tu_token_verificacion_personalizado
WA_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxx
WA_PHONE_NUMBER_ID_TRAVEL=123456789012345
WA_API_VERSION=v21.0

# ==========================================
# CLAUDE API (Anthropic)
# ==========================================
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# ==========================================
# GOOGLE SHEETS
# ==========================================
GOOGLE_SHEETS_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t
GOOGLE_SERVICE_ACCOUNT_EMAIL=bot-travel@proyecto-123456.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n"

# ==========================================
# BOT CONFIGURATION
# ==========================================
SHEETS_CACHE_TTL_SECONDS=300
CONVERSATION_CONTEXT_TTL_SECONDS=3600
MAX_CONVERSATION_HISTORY=20
CONTACT_LOCK_TTL_SECONDS=30
```

### 5.3. Dónde obtener cada variable

#### WA_VERIFY_TOKEN
- **Qué es:** Token personalizado que tú eliges
- **Ejemplo:** `mi_token_secreto_grupoworkstudy_2026`
- **Dónde:** Lo eliges tú mismo (cualquier string seguro)

#### WA_ACCESS_TOKEN
- **Qué es:** Token de Meta para acceder a WhatsApp Cloud API
- **Dónde obtenerlo:**
  1. Ve a https://developers.facebook.com/apps
  2. Selecciona tu app
  3. WhatsApp → API Setup
  4. Copia el **"Temporary access token"** (dura 24h)
  5. Para producción: Generate **System User Token** permanente

#### WA_PHONE_NUMBER_ID_TRAVEL
- **Qué es:** ID del número de WhatsApp
- **Dónde obtenerlo:**
  1. En Meta Developers → WhatsApp → API Setup
  2. En la sección **"From"**
  3. Copia el **Phone number ID** (número largo)
  4. Ejemplo: `123456789012345`

#### ANTHROPIC_API_KEY
- **Qué es:** API key de Claude
- **Dónde obtenerlo:**
  1. Ve a https://console.anthropic.com
  2. Sidebar → **"API Keys"**
  3. Click **"Create Key"**
  4. Nombre: `Grupo Work Study Production`
  5. Copia el key (empieza con `sk-ant-`)

#### GOOGLE_SHEETS_ID
- **Qué es:** ID de tu hoja de Google Sheets
- **Dónde obtenerlo:**
  1. Abre tu Google Sheet
  2. Mira la URL: `https://docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/edit`
  3. Copia el ID entre `/d/` y `/edit`

#### GOOGLE_SERVICE_ACCOUNT_EMAIL
- **Qué es:** Email del service account de Google
- **Dónde obtenerlo:**
  1. Google Cloud Console → IAM & Admin → Service Accounts
  2. Copia el email (termina en `@*.iam.gserviceaccount.com`)

#### GOOGLE_PRIVATE_KEY
- **Qué es:** Private key del service account
- **Dónde obtenerlo:**
  1. Descarga el archivo JSON del service account
  2. Abre el JSON, busca el campo `"private_key"`
  3. Copia el valor completo (incluyendo `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`)
  4. **IMPORTANTE:** En Railway, ponlo entre comillas dobles y con `\n` literales

⚠️ **IMPORTANTE:** El `GOOGLE_PRIVATE_KEY` debe tener `\n` literales, NO saltos de línea reales.

**Ejemplo correcto:**
```
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADA...\n-----END PRIVATE KEY-----\n"
```

**Ejemplo incorrecto:**
```
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADA...
-----END PRIVATE KEY-----"
```

### 5.4. Guardar variables

1. Después de pegar todas las variables con tus valores reales
2. Click **"Update Variables"** (botón morado abajo)
3. Railway reiniciará el servicio automáticamente

✅ **Checkpoint:** Variables de entorno configuradas

---

## 🚀 PASO 6: DEPLOY AUTOMÁTICO

### 6.1. Verificar deploy

1. Ve a la pestaña **"Deployments"**
2. Verás un nuevo deploy iniciándose automáticamente
3. Click en el deployment para ver los logs en tiempo real

### 6.2. Logs esperados

Deberías ver algo como:

```
Installing dependencies...
Running: npm install && npx prisma generate && npx prisma migrate deploy

✓ Prisma Client generated
✓ Database migrations applied

Starting application...
Running: npm start

[INFO] Server listening on port 8080
[INFO] Environment: production
[INFO] Starting background jobs...
[INFO] Sheets sync job started
[INFO] Follow-up job started
[INFO] All background jobs started successfully
```

### 6.3. Si hay errores

**Error común 1:** `Missing required environment variable`
- **Solución:** Verifica que agregaste TODAS las variables del Paso 5

**Error común 2:** `Can't reach database server`
- **Solución:** Asegúrate de que PostgreSQL y Redis estén agregados y conectados

**Error común 3:** `Google Sheets: 403 Forbidden`
- **Solución:** Verifica que compartiste la hoja con el service account email

### 6.4. Obtener URL pública

1. Una vez que el deploy esté **"Success"**
2. Ve a la pestaña **"Settings"**
3. Scroll hasta **"Networking"**
4. Click **"Generate Domain"**
5. Railway generará una URL como: `https://grupo-work-study-production.up.railway.app`
6. **Copia esta URL** (la necesitarás en el próximo paso)

✅ **Checkpoint:** Aplicación desplegada y corriendo

---

## 📱 PASO 7: CONFIGURAR WEBHOOK DE WHATSAPP

### 7.1. Ir a Meta Developer Portal

1. Ve a https://developers.facebook.com/apps
2. Selecciona tu app
3. Sidebar → **"WhatsApp"** → **"Configuration"**

### 7.2. Configurar Webhook

1. En la sección **"Webhook"**, click **"Edit"**
2. **Callback URL:** Pega tu URL de Railway + `/webhook`
   ```
   https://grupo-work-study-production.up.railway.app/webhook
   ```
3. **Verify Token:** El mismo que pusiste en `WA_VERIFY_TOKEN`
   ```
   mi_token_secreto_grupoworkstudy_2026
   ```
4. Click **"Verify and Save"**

⏳ Meta verificará tu endpoint (puede tardar 10-20 segundos)

✅ Si todo está correcto, verás: **"Verified"**

❌ Si falla, revisa:
- URL correcta (debe terminar en `/webhook`)
- Verify token coincide exactamente
- Servidor corriendo (ve logs en Railway)

### 7.3. Suscribirse a eventos

1. En la misma página, sección **"Webhook fields"**
2. Click **"Manage"**
3. Busca **"messages"**
4. Click en **"Subscribe"**
5. Click **"Done"**

✅ **Checkpoint:** Webhook configurado y verificado

---

## 🧪 PASO 8: PROBAR EL SISTEMA

### 8.1. Agregar número de prueba

1. En Meta Developers → WhatsApp → **"API Setup"**
2. Sección **"To"**
3. Click **"Add phone number"**
4. Ingresa tu número personal de WhatsApp
5. Recibirás un código por WhatsApp
6. Ingrésalo para confirmar

### 8.2. Enviar mensaje de prueba

Desde tu WhatsApp personal, envía un mensaje al número del bot:

```
Hola soy papá del Colegio Winston Churchill y me interesa English 4 Life
```

### 8.3. Verificar en logs de Railway

1. Ve a Railway → Tu servicio → **"Deployments"**
2. Click en el deployment activo
3. Ve los logs en tiempo real

**Logs esperados:**

```
[INFO] Received webhook POST
[INFO] Lock acquired, processing message
[INFO] School detected: WC (Winston Churchill)
[INFO] Message saved to database
[INFO] Sending request to Claude AI
[INFO] Received response from Claude
[INFO] Response sent to WhatsApp
[INFO] Lock released
```

### 8.4. Verificar respuesta del bot

En 3-5 segundos, deberías recibir una respuesta del bot en WhatsApp:

```
¡Buen día! Vi que es del Colegio Winston Churchill.
Le cuento sobre nuestro programa English 4 Life a Londres...

[Información personalizada del colegio desde Google Sheets]
```

✅ **Si recibes respuesta:** ¡FELICIDADES! El sistema está funcionando perfectamente

❌ **Si NO recibes respuesta:**

**Checklist de debugging:**

1. ¿El mensaje llegó al webhook?
   - Revisa logs de Railway: `[INFO] Received webhook POST`
   - Si NO aparece, revisa configuración del webhook en Meta

2. ¿Claude respondió?
   - Busca en logs: `[INFO] Received response from Claude`
   - Si NO aparece, verifica `ANTHROPIC_API_KEY`

3. ¿Se intentó enviar a WhatsApp?
   - Busca en logs: `[INFO] Response sent to WhatsApp`
   - Si aparece error de WhatsApp, verifica `WA_ACCESS_TOKEN`

4. ¿Google Sheets cargó?
   - Busca en logs: `[INFO] Cache refresh completed`
   - Si aparece error 403, verifica que compartiste la hoja

### 8.5. Probar flujo completo

**Mensaje 2:**
```
Mi hija se llama Sofía, tiene 15 años
```
✅ Verifica que el bot capture los datos

**Mensaje 3:**
```
¿Cuánto cuesta el programa?
```
✅ Verifica que el bot responda con precios desde Sheets

**Mensaje 4:**
```
Me interesa mucho, quiero inscribir a mi hija
```
✅ Verifica que:
- El bot derive al asesor
- Cambie el status
- **Envíe notificación a la asesora** (si tiene WhatsApp en Sheets)

**Mensaje 5:**
```
Gracias
```
✅ Verifica que el bot NO responda (está en modo `waiting_human`)

---

## ✅ CHECKLIST FINAL

Marca cada item cuando esté completado:

### Configuración Inicial
- [ ] Código subido a GitHub
- [ ] Proyecto creado en Railway
- [ ] PostgreSQL agregado
- [ ] Redis agregado
- [ ] Variables de entorno configuradas

### Credenciales
- [ ] `WA_VERIFY_TOKEN` configurado
- [ ] `WA_ACCESS_TOKEN` válido
- [ ] `WA_PHONE_NUMBER_ID_TRAVEL` correcto
- [ ] `ANTHROPIC_API_KEY` válido
- [ ] `GOOGLE_SHEETS_ID` correcto
- [ ] `GOOGLE_SERVICE_ACCOUNT_EMAIL` correcto
- [ ] `GOOGLE_PRIVATE_KEY` con formato correcto

### Deploy
- [ ] Deploy exitoso sin errores
- [ ] URL pública generada
- [ ] Health check responde OK: `https://tu-app.up.railway.app/health`

### Webhook
- [ ] Webhook configurado en Meta
- [ ] Webhook verificado exitosamente
- [ ] Suscrito a eventos `messages`

### Testing
- [ ] Número de prueba agregado
- [ ] Bot responde correctamente
- [ ] Detecta colegio
- [ ] Captura datos
- [ ] Envía materiales
- [ ] Deriva a asesor
- [ ] Se queda en silencio después de derivar

---

## 🔧 COMANDOS ÚTILES

### Ver logs en tiempo real

```bash
# Instalar Railway CLI (opcional)
npm install -g @railway/cli

# Login
railway login

# Link proyecto
railway link

# Ver logs
railway logs
```

### Redeploy manual

1. En Railway, ve a tu servicio
2. Pestaña **"Deployments"**
3. Click **"Redeploy"** (tres puntos)

### Rollback a versión anterior

1. Pestaña **"Deployments"**
2. Encuentra el deployment anterior
3. Click **"Redeploy"**

### Ver variables de entorno

```bash
railway variables
```

---

## 🆘 TROUBLESHOOTING

### El deploy falla con "Cannot find module"

**Causa:** Falta una dependencia

**Solución:**
```bash
# Local
npm install [paquete-faltante] --save

# Commit y push
git add package.json package-lock.json
git commit -m "Add missing dependency"
git push
```

### Error: "ECONNREFUSED" en PostgreSQL

**Causa:** `DATABASE_URL` no está configurada

**Solución:**
1. Verifica que PostgreSQL esté agregado
2. Verifica que `DATABASE_URL` aparezca en Variables
3. Redeploy

### Error: "Google Sheets 403 Forbidden"

**Causa:** Service account no tiene acceso

**Solución:**
1. Abre tu Google Sheet
2. Click "Compartir"
3. Agrega el email del service account
4. Permiso: "Editor"

### Bot no responde pero el webhook llega

**Causa:** Error en Claude o Google Sheets

**Solución:**
1. Revisa logs completos en Railway
2. Busca errores específicos
3. Verifica que todas las API keys sean válidas

### Rate limiting muy agresivo

**Causa:** Muchos mensajes simultáneos

**Solución:**
- El sistema espera automáticamente
- No es un error, es protección
- Si es problema, considera aumentar el límite (requiere contactar a Meta)

---

## 📊 MONITOREO EN PRODUCCIÓN

### Métricas en Railway

Railway provee automáticamente:
- CPU usage
- Memory usage
- Network traffic
- Request count

Para verlas:
1. Click en tu servicio
2. Pestaña **"Metrics"**

### Alertas

Configura alertas para:
- [ ] Deploy failures
- [ ] High memory usage (>80%)
- [ ] High CPU usage (>90%)
- [ ] Error rate alto

### Logs

Los logs se guardan automáticamente en Railway por 7 días.

Para logs más largos, considera usar un servicio externo como:
- Datadog
- Logtail
- Better Stack

---

## 🎯 PRÓXIMOS PASOS DESPUÉS DEL DEPLOY

### 1. Monitoreo

- Configura alertas en Railway
- Revisa logs diariamente la primera semana
- Monitorea costos de Claude API

### 2. Backups

- PostgreSQL: Railway hace backups automáticos
- Google Sheets: Es tu backup principal
- Código: Ya está en GitHub

### 3. Escalar

Si necesitas más capacidad:
1. Railway → Settings → Resources
2. Aumenta Memory o CPU
3. Los costos aumentan proporcionalmente

### 4. Agregar más números

Para agregar más números de WhatsApp:
1. Meta Developers → Agregar más números
2. Obtener nuevos Phone Number IDs
3. Agregar como variables: `WA_PHONE_NUMBER_ID_TRAVEL_2`, etc.

### 5. Testing continuo

- Envía mensajes de prueba semanalmente
- Verifica que Sheets se actualice correctamente
- Revisa que las asesoras reciben notificaciones

---

## 💰 COSTOS ESTIMADOS

### Railway

**Plan Hobby (Gratis):**
- $5 USD en créditos mensuales
- Suficiente para ~100-200 conversaciones/mes

**Plan Pro ($20 USD/mes):**
- $20 USD en créditos incluidos
- Recursos ilimitados
- Priority support

### Claude API (Anthropic)

- Input: ~$3 USD por millón de tokens
- Output: ~$15 USD por millón de tokens
- Conversación promedio: ~2,000 tokens = $0.03 USD
- 1,000 conversaciones ≈ $30 USD

### WhatsApp (Meta)

**Primeras 1,000 conversaciones/mes:** GRATIS

Después:
- Conversación de marketing: ~$0.05 USD
- Conversación de servicio: ~$0.02 USD

### Google Sheets

- GRATIS (Google Workspace no requerido)

### **TOTAL ESTIMADO:**
- **Primeros meses (testing):** ~$5-10 USD/mes
- **Producción (100 leads/mes):** ~$25-40 USD/mes
- **Alto volumen (500 leads/mes):** ~$100-150 USD/mes

---

## 📞 SOPORTE

**Railway:**
- Docs: https://docs.railway.app
- Discord: https://discord.gg/railway
- Email: team@railway.app

**Meta/WhatsApp:**
- Docs: https://developers.facebook.com/docs/whatsapp
- Business Support: https://business.facebook.com/business/help

**Anthropic (Claude):**
- Docs: https://docs.anthropic.com
- Support: https://support.anthropic.com

**Google Cloud:**
- Docs: https://cloud.google.com/docs
- Support: https://cloud.google.com/support

---

## ✅ ¡DEPLOY COMPLETO!

Si llegaste hasta aquí y todos los checks están marcados:

🎉 **¡FELICIDADES! Tu sistema está en producción.**

El bot está ahora:
- ✅ Corriendo 24/7 en Railway
- ✅ Recibiendo mensajes de WhatsApp
- ✅ Respondiendo con Claude AI
- ✅ Leyendo datos de Google Sheets en tiempo real
- ✅ Notificando a asesoras automáticamente
- ✅ Haciendo follow-ups programados

**Sistema listo para recibir leads reales.** 🚀

---

_Última actualización: 2026-03-11_
_Version: 1.0.0 - Fase 2 Travel Complete_
