# 📱 Guía de Uso del Bot Travel

## 🚀 Inicio Rápido

### Pre-requisitos
- ✅ PostgreSQL corriendo con database creada
- ✅ Redis corriendo (`redis-server`)
- ✅ `.env` configurado con credenciales reales
- ✅ Migraciones aplicadas: `npm run db:migrate`
- ✅ Prisma client generado: `npm run db:generate`

### Iniciar el Bot

```bash
# Modo desarrollo (con hot-reload y logs pretty)
npm run dev

# Modo producción
npm start
```

El servidor iniciará en `http://localhost:3000` (o el puerto configurado en `.env`).

---

## 🔍 Verificar que Todo Funciona

### 1. Health Check

```bash
curl http://localhost:3000/health
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-09T...",
  "uptime": 123.45,
  "database": "connected",
  "redis": "connected"
}
```

### 2. Verificar Root Endpoint

```bash
curl http://localhost:3000/
```

**Respuesta esperada:**
```json
{
  "name": "Grupo Work & Study - WhatsApp Automation System",
  "version": "1.0.0",
  "phase": "Fase 1 - Travel",
  "status": "running"
}
```

---

## 📞 Configurar WhatsApp Webhook

### En Meta for Developers:

1. Ve a tu app de WhatsApp Business
2. Ve a Configuration → Webhooks
3. Click "Edit"
4. **Callback URL**: `https://tu-dominio.com/webhook` (usa ngrok para desarrollo)
5. **Verify Token**: El valor de `WA_VERIFY_TOKEN` en tu `.env`
6. Suscríbete a eventos: **messages**

### Exponer tu servidor local con ngrok:

```bash
ngrok http 3000
```

Copia la URL HTTPS (ej: `https://abc123.ngrok.io`) y úsala como Callback URL.

---

## 💬 Ejemplo de Conversación

### Usuario escribe:
```
Hola, me interesa el viaje a Londres
```

### Bot responde:
```
¡Bienvenido/a a Oxford Education & Travel! ✈️

Somos especialistas en viajes educativos a Londres
a través del programa English 4 Life.

¿En qué puedo ayudarle? Si viene de parte de algún
colegio, con gusto le doy información del programa específico.

[ACTUALIZAR_SCORE:2]
```

*(El tag [ACTUALIZAR_SCORE:2] se remueve antes de enviar al usuario)*

### Usuario escribe:
```
Sí, vengo del colegio Winston Churchill.
¿Cuándo es el viaje?
```

### Bot responde:
```
¡Perfecto! El viaje para Winston Churchill es del
22 al 31 de mayo de 2026 📅

Son 9 días / 10 noches en Londres. ¿Le gustaría
que le envíe el flyer con toda la información?

[CAPTURAR_DATO:school_code:WC]
[ACTUALIZAR_SCORE:4]
```

---

## 🔧 Monitoreo y Debugging

### Ver Logs en Tiempo Real

Los logs son estructurados (Pino) y en desarrollo se muestran en formato pretty:

```bash
npm run dev
```

**Ejemplo de log:**
```
[12:34:56] INFO (travel): Lock acquired, processing message
    phone: "+5215512345678"
    waMessageId: "wamid.XXX"
    unit: "travel"

[12:34:57] INFO (claude.chat): Sending request to Claude
    systemPromptLength: 3456
    historyLength: 4
    userMessageLength: 45

[12:34:58] INFO (travel): Response sent to WhatsApp
    conversationId: "uuid-123"
    leadId: "uuid-456"
```

### Verificar Circuit Breaker de Claude

Si Claude falla 3 veces seguidas, el circuit breaker se abre:

```
[12:35:00] ERROR: Circuit breaker OPENED - entering fallback mode
```

El bot responderá automáticamente con:
```
Gracias por escribirnos. Estamos teniendo un problema
técnico momentáneo. Una asesora le contactará en breve. 😊
```

Después de 1 minuto, el circuit breaker intenta cerrarse automáticamente.

### Verificar Redis

```bash
# Conectar a Redis
redis-cli

# Ver todas las keys
KEYS *

# Ver conversación específica
GET conversation:history:uuid-123

# Ver lock de contacto
GET lock:contact:+5215512345678
```

### Verificar Base de Datos

```bash
# Abrir Prisma Studio (GUI)
npm run db:studio
```

Se abrirá en `http://localhost:5555` donde puedes ver:
- Contacts
- Conversations
- Messages
- Travel Leads

---

## 🐛 Problemas Comunes

### "Failed to acquire lock"

**Causa:** El mismo contacto envió múltiples mensajes muy rápido.

**Solución:** Esto es normal. El lock previene race conditions. El segundo mensaje se ignora automáticamente.

### "Circuit breaker is OPEN"

**Causa:** Claude API falló 3 veces seguidas.

**Solución:**
1. Verifica tu `ANTHROPIC_API_KEY` en `.env`
2. Verifica que tienes créditos en Anthropic
3. Espera 1 minuto para que el circuit breaker se cierre automáticamente

### "Unable to extract message content"

**Causa:** El mensaje de WhatsApp tiene un tipo no soportado (ej: sticker, ubicación).

**Solución:** El bot ignora estos mensajes. Puedes implementar handlers en `src/core/whatsapp/parser.js`.

### "Error loading history from Redis"

**Causa:** Redis no está corriendo o la conexión falló.

**Solución:**
```bash
# Verificar si Redis está corriendo
redis-cli ping
# Debe responder: PONG

# Si no está corriendo
redis-server
```

### "Error creating message" / "Error updating lead"

**Causa:** PostgreSQL no está corriendo o las migraciones no se aplicaron.

**Solución:**
```bash
# Verificar conexión a PostgreSQL
psql $DATABASE_URL -c "SELECT 1"

# Aplicar migraciones
npm run db:migrate
```

---

## 📊 Action Tags Disponibles

El bot puede detectar estos action tags en las respuestas de Claude:

### 1. ENVIAR_MATERIAL
```
[ENVIAR_MATERIAL:flyer_winston_churchill]
```
**Estado:** Parsea ✅ | Ejecuta ⏳ (próxima fase)

### 2. DERIVAR_ASESOR
```
[DERIVAR_ASESOR:solicita link de pago]
```
**Estado:** Parsea ✅ | Ejecuta ⏳ (próxima fase)

### 3. CAPTURAR_DATO
```
[CAPTURAR_DATO:parent_name:María López]
[CAPTURAR_DATO:traveler_name:Juan López]
[CAPTURAR_DATO:traveler_age:15]
[CAPTURAR_DATO:school_code:WC]
```
**Estado:** Parsea ✅ | Ejecuta ⏳ (próxima fase)

### 4. ACTUALIZAR_SCORE
```
[ACTUALIZAR_SCORE:7]
```
**Estado:** Parsea ✅ | Ejecuta ⏳ (próxima fase)

### 5. PROGRAMAR_SEGUIMIENTO
```
[PROGRAMAR_SEGUIMIENTO:24h]
[PROGRAMAR_SEGUIMIENTO:3d]
```
**Estado:** Parsea ✅ | Ejecuta ⏳ (próxima fase)

**Actualmente todos los actions se loguean pero no se ejecutan. La implementación real viene en la siguiente fase.**

---

## 🧪 Testing sin WhatsApp

Puedes probar el flujo completo sin configurar WhatsApp:

```javascript
// test-flow.js
import { handleMessage } from './src/units/travel/handler.js';

const mockMessage = {
  from: '5215512345678',
  id: 'test_' + Date.now(),
  type: 'text',
  text: { body: 'Hola, me interesa el viaje a Londres' },
};

// Simula recepción de mensaje
await handleMessage(mockMessage, 'test_phone_number_id');
```

Ejecuta:
```bash
node test-flow.js
```

Verás en los logs:
1. Lock adquirido
2. Contacto creado/encontrado
3. Conversación creada/encontrada
4. Lead creado/encontrado
5. Mensaje guardado en BD
6. Historial cargado de Redis
7. System prompt construido
8. Request enviado a Claude
9. Respuesta recibida
10. Action tags parseados
11. **ERROR al enviar a WhatsApp** (porque no hay webhook real)

Esto te permite probar todo el flujo hasta Claude sin necesitar WhatsApp configurado.

---

## 📈 Métricas a Monitorear

### En Logs

- **Tasa de éxito de Claude API**: Busca "Claude API success" vs "Claude API failed"
- **Circuit breaker abierto**: Busca "Circuit breaker OPENED"
- **Locks fallidos**: Busca "Failed to acquire lock"
- **Errores de parsing**: Busca "Unable to extract message content"

### En Base de Datos

- **Contactos creados por día**: `SELECT COUNT(*) FROM contacts WHERE DATE(created_at) = CURRENT_DATE`
- **Conversaciones activas**: `SELECT COUNT(*) FROM conversations WHERE status = 'active'`
- **Mensajes por conversación**: `SELECT AVG(msg_count) FROM (SELECT COUNT(*) as msg_count FROM messages GROUP BY conversation_id)`

### En Redis

- **Conversaciones en cache**: `redis-cli KEYS "conversation:history:*" | wc -l`
- **Locks activos**: `redis-cli KEYS "lock:contact:*" | wc -l`

---

## 🎯 Próximos Pasos

1. **Prueba el bot con mensajes reales de WhatsApp**
2. **Monitorea los logs para detectar errores**
3. **Verifica que Claude responde con la personalidad correcta**
4. **Confirma que los action tags se parsean correctamente**
5. **Implementa la ejecución real de actions** (siguiente fase)

---

## 💡 Tips

- **Usa LOG_LEVEL=debug** en `.env` para ver más detalles durante desarrollo
- **Revisa Prisma Studio** regularmente para ver cómo se almacenan los datos
- **Monitorea el circuit breaker** en el endpoint `/health`
- **Prueba el fallback** desconectando temporalmente tu API key de Claude

---

**¡El bot está listo para recibir mensajes! 🎉**
