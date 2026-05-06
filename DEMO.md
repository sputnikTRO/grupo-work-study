# 🎭 Demo del Bot - English 4 Life

Guía para ejecutar una demo interactiva del bot sin necesidad de WhatsApp conectado.

## 📋 Requisitos Previos

1. **Node.js 20+** instalado
2. **Variables de entorno configuradas** en el archivo `.env`

## ⚙️ Configuración

### Paso 1: Actualizar Variables de Entorno

Edita el archivo `.env` y actualiza estas variables con tus valores reales de Railway:

```bash
# Claude API (REQUERIDO)
ANTHROPIC_API_KEY=sk-ant-api03-...tu-key-real...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Google Sheets (REQUERIDO para conocimiento completo)
GOOGLE_SHEETS_ID=tu-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-servicio@proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\ntu-private-key-aqui\n-----END PRIVATE KEY-----\n"
```

**⚠️ Importante:**
- Si NO configuras Google Sheets, el bot usará conocimiento base limitado (hardcodeado)
- Si NO configuras `ANTHROPIC_API_KEY`, el script no funcionará

### Paso 2: Verificar Dependencias

Si no lo has hecho, instala las dependencias:

```bash
npm install
```

## 🚀 Ejecutar la Demo

### Opción 1: Demo Interactiva (Recomendada)

Conversación en tiempo real donde TÚ escribes los mensajes:

```bash
npm run demo
```

**Cómo usar:**
- Escribe mensajes como si fueras un padre interesado
- El bot responde usando Claude AI + Google Sheets
- Comandos especiales:
  - `salir` o `exit` → Terminar la demo
  - `limpiar` o `clear` → Reiniciar la conversación
  - `Ctrl+C` → Salir inmediatamente

**Ejemplo de conversación:**

```
👤 Tú: Hola, quiero información sobre los viajes de English 4 Life

🤖 Bot: ¡Hola! 👋 Claro que sí, con gusto te ayudo...

👤 Tú: ¿Cuánto cuesta el programa a Londres?

🤖 Bot: El programa English 4 Life a Londres tiene un costo de $65,000 MXN...
```

### Opción 2: Demo Automatizada

Conversación predefinida que se ejecuta automáticamente:

```bash
npm run demo:auto
```

Esta opción ejecuta una conversación completa con mensajes preprogramados, ideal para:
- Mostrar capacidades del bot rápidamente
- Presentaciones o demos a clientes
- Verificar que todo funciona correctamente

## 🎯 Qué Muestra la Demo

La demo demuestra las capacidades clave del bot:

1. **✅ Respuestas naturales con Claude AI**
   - Conversación fluida en español
   - Contexto mantenido a lo largo de la conversación
   - Respuestas personalizadas

2. **✅ Base de conocimiento desde Google Sheets**
   - Información actualizada de programas
   - Precios y detalles de viajes
   - FAQs y respuestas comunes
   - Colegios afiliados

3. **✅ Personalidad del bot**
   - Tono cálido y profesional
   - Uso apropiado de emojis
   - Respuestas concisas pero completas

4. **✅ Manejo inteligente de consultas**
   - Responde preguntas sobre precios
   - Ofrece información relevante
   - Deriva a asesor cuando es apropiado
   - Admite cuando no tiene información

## 🔍 Detalles Técnicos

### Lo que NO necesitas:
- ❌ WhatsApp conectado
- ❌ PostgreSQL corriendo
- ❌ Redis corriendo
- ❌ Servidor web activo

### Lo que SÍ usa:
- ✅ Claude AI API (Anthropic)
- ✅ Google Sheets API
- ✅ Conversación en memoria (temporal)

### Flujo de la Demo:

```
[Usuario escribe] → [Claude AI procesa] → [Bot responde]
                           ↓
                [Conocimiento de Google Sheets]
```

## 🐛 Solución de Problemas

### Error: "ANTHROPIC_API_KEY no está configurada"

**Solución:** Actualiza el archivo `.env` con tu API key real de Anthropic:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...tu-key-real...
```

### Error: "Error cargando Google Sheets"

**Causa:** Credenciales de Google inválidas o mal configuradas.

**Solución:**
1. Verifica que `GOOGLE_PRIVATE_KEY` tenga el formato correcto con `\n` para saltos de línea
2. El bot continuará funcionando con conocimiento base limitado

### El bot responde pero sin información específica

**Causa:** Google Sheets no está cargando correctamente.

**Solución:**
1. Verifica que el `GOOGLE_SHEETS_ID` sea correcto
2. Asegúrate de que la cuenta de servicio tenga acceso al spreadsheet
3. El script mostrará mensajes de debug indicando qué hojas se cargaron

## 💡 Tips para una Buena Demo

1. **Prepara preguntas representativas:**
   - "¿Cuánto cuesta el programa?"
   - "¿Qué incluye?"
   - "¿Tienen esquemas de pago?"
   - "Me interesa, ¿cómo continúo?"

2. **Muestra la fluidez:**
   - Haz varias preguntas seguidas
   - Muestra cómo mantiene contexto
   - Demuestra que no repite información

3. **Destaca la personalidad:**
   - El tono amigable pero profesional
   - Las respuestas concisas
   - El uso inteligente de emojis

## 📝 Notas

- La conversación se mantiene **solo durante la sesión actual**
- No se guarda en base de datos (es solo para demo)
- Cada vez que ejecutas el script, empieza desde cero
- El historial se limita a los últimos 10 mensajes (5 intercambios)

---

**¿Listo para la demo?** 🚀

```bash
npm run demo
```

¡Disfruta mostrando tu bot de English 4 Life! 🎉
