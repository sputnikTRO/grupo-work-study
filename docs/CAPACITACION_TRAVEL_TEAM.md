# 🎓 Capacitación: Cómo Gestionar el Bot Miri de Travel

**Fecha:** Mayo 2026
**Audiencia:** Equipo de Travel (Oxford Education & Travel)
**Objetivo:** Aprender a actualizar información del bot sin necesidad de programar

---

## 📊 1. ESTRUCTURA GENERAL DEL SISTEMA

### ¿Cómo funciona Miri?

```
┌─────────────────┐
│  Papá envía     │
│  mensaje por    │──┐
│  WhatsApp       │  │
└─────────────────┘  │
                     ▼
              ┌──────────────┐
              │  Meta Cloud  │
              │  API recibe  │
              │  el mensaje  │
              └──────────────┘
                     │
                     ▼
              ┌──────────────┐
              │  Railway     │
              │  (servidor)  │
              └──────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌────────┐  ┌─────────┐  ┌─────────┐
   │ Claude │  │ Google  │  │ Google  │
   │   AI   │  │ Sheets  │  │  Drive  │
   │(cerebro)│ │ (datos) │  │(archivos)│
   └────────┘  └─────────┘  └─────────┘
        │            │            │
        └────────────┼────────────┘
                     ▼
              ┌──────────────┐
              │  Miri envía  │
              │  respuesta   │
              │  por WhatsApp│
              └──────────────┘
```

**En palabras simples:**
1. El papá escribe por WhatsApp
2. Meta Cloud API lo envía al servidor (Railway)
3. El servidor consulta Google Sheets para obtener la información actualizada
4. Claude AI (la inteligencia artificial) redacta la respuesta usando esa información
5. Si necesita enviar PDFs/imágenes, los descarga de Google Drive
6. Envía la respuesta al papá por WhatsApp

---

## 📁 2. GOOGLE SHEETS: LA BASE DE CONOCIMIENTO

### ¿Qué es?
Es un archivo de Excel en Google que contiene TODA la información del bot. Es la **única fuente de verdad**.

### ¿Dónde está?
**ID del Sheet:** `18a2zVagPSu5iJf8GBdM_WcEnDC3vnZ2SHn7s_ftPmnk`
**Link directo:** https://docs.google.com/spreadsheets/d/18a2zVagPSu5iJf8GBdM_WcEnDC3vnZ2SHn7s_ftPmnk/edit

### ⚠️ REGLA DE ORO:
**SI NO ESTÁ EN EL GOOGLE SHEET, EL BOT NO LO SABE.**

El bot lee este archivo cada **5 minutos** automáticamente.

---

## 📋 3. HOJAS DEL GOOGLE SHEET (CADA UNA TIENE UN PROPÓSITO)

### 🏫 **Hoja: Colegios**
Catálogo de colegios con los que tienen convenio.

**Columnas obligatorias:**
```
codigo | nombre                  | zona      | contacto
WC     | Winston Churchill       | Norte     | contacto@wc.edu.mx
AM     | Colegio Americano       | Sur       | info@americano.mx
```

**¿Cuándo modificarla?**
- Cuando agreguen un nuevo colegio
- Cuando cambien el contacto de un colegio

**⚠️ Importante:**
- El `codigo` debe ser ÚNICO (ej: WC, AM, CB)
- Úsalo para relacionar colegios con asesoras

---

### ✈️ **Hoja: Viajes**
Viajes disponibles con precios y fechas.

**Columnas obligatorias:**
```
codigo    | destino           | fechas_salida | precio | status  | descripcion
LON2026   | Londres 2026      | julio 2026    | 45000  | activo  | Viaje cultural a Londres
NYC2026   | Nueva York 2026   | agosto 2026   | 52000  | inactivo| Experiencia en Nueva York
```

**¿Cuándo modificarla?**
- Al actualizar precios
- Al cambiar fechas
- Al activar/desactivar un viaje

**⚠️ Importante:**
- Solo viajes con `status = activo` se muestran en el bot
- El `precio` es SIN comas ni símbolos (45000, no $45,000)
- El `codigo` es clave para relacionar con actividades, materiales, etc.

---

### 🎭 **Hoja: Actividades**
Actividades extras opcionales para cada viaje.

**Columnas obligatorias:**
```
viaje_codigo | nombre                              | costo | descripcion
LON2026      | London Eye + Musical + Estadio      | 5300  | London Eye, Musical West End, Estadio
LON2026      | Harry Potter Studio Tour            | 4500  | Tour completo por Warner Bros Studios
```

**¿Cuándo modificarla?**
- Al agregar nuevas actividades
- Al cambiar precios de actividades
- Al quitar actividades que ya no están disponibles

**⚠️ Importante:**
- `viaje_codigo` debe coincidir EXACTAMENTE con el codigo en la hoja "Viajes"
- Costo SIN comas (5300, no 5,300)

---

### 📄 **Hoja: Materiales** ⭐ MUY IMPORTANTE

Aquí definen QUÉ archivos (PDFs, imágenes) puede enviar el bot.

**Columnas obligatorias:**
```
id                          | nombre                    | tipo   | url                                    | viaje_codigo | descripcion
BROCHURE_LON_CEWIN_V2      | Brochure Londres 2026     | pdf    | https://drive.google.com/file/d/1ABC.. | LON2026      | Información completa del viaje
ACT_EXTRA_LONDON_EYE       | Actividad London Eye      | imagen | https://drive.google.com/file/d/1XYZ.. | LON2026      | Imagen con detalles
```

**¿Cuándo modificarla?**
- Al actualizar un brochure
- Al agregar nuevas imágenes promocionales
- Al cambiar PDFs con información

**⚠️ MUY IMPORTANTE - CÓMO SUBIR ARCHIVOS A GOOGLE DRIVE:**

#### Paso 1: Subir el archivo a Google Drive
1. Ve a Google Drive
2. Sube el archivo (PDF, imagen, etc.)
3. **IMPORTANTE:** Haz clic derecho en el archivo → "Compartir"
4. En "Agregar personas y grupos" escribe:
   ```
   grupo-w-s@travel-bot-490001.iam.gserviceaccount.com
   ```
5. Dale permisos de **"Lector"** (solo lectura)
6. Clic en "Enviar"

#### Paso 2: Obtener el link del archivo
1. Haz clic derecho en el archivo → "Obtener enlace"
2. Asegúrate que diga "Restringido" (solo las personas con acceso)
3. Copia el link, se verá así:
   ```
   https://drive.google.com/file/d/1ABC123xyz456/view?usp=sharing
   ```

#### Paso 3: Pegar el link en Google Sheets
1. Abre el Google Sheet
2. Ve a la hoja "Materiales"
3. Pega el link COMPLETO en la columna `url`
4. ✅ ¡Listo! El bot podrá descargar y enviar ese archivo

**¿Por qué compartir al service account?**
- `grupo-w-s@travel-bot-490001.iam.gserviceaccount.com` es la "cuenta robot" del sistema
- Sin este permiso, el bot NO puede descargar el archivo
- Es como dar acceso a un empleado de confianza

**Tipos de archivo soportados:**
- `pdf` - Documentos PDF (brochures, presentaciones)
- `imagen` - Imágenes JPG, PNG (flyers, actividades)

---

### 👩‍💼 **Hoja: Asesoras** ⭐ ESCALAMIENTO A HUMANOS

Define qué asesora atiende a cada colegio cuando el bot deriva la conversación.

**Columnas obligatorias:**
```
school_code | nombre          | whatsapp       | email
WC          | María González  | 5215512345678  | maria@grupoworkystudy.com
AM          | Laura Martínez  | 5215587654321  | laura@grupoworkystudy.com
```

**¿Cuándo modificarla?**
- Al cambiar de asesora para un colegio
- Al agregar nuevos colegios
- Al actualizar números de WhatsApp o emails

**⚠️ IMPORTANTE:**
- `school_code` debe coincidir con el `codigo` de la hoja "Colegios"
- `whatsapp` debe estar en formato internacional: **5215512345678** (sin + ni espacios)
- Cuando el bot deriva una conversación, envía un mensaje automático a este WhatsApp

**Ejemplo de mensaje que recibe la asesora:**
```
🔔 Nuevo lead de alta prioridad

👤 Juan Pérez
👨‍🎓 María Pérez
📅 15 años

🏫 Winston Churchill

📊 Interés: 8/10
📌 Razón: Solicita link de pago

📱 WhatsApp: 5215534567890

📝 Últimos intercambios:
👤 Quiero inscribir a mi hija
🤖 Con gusto, ¿cuál es tu nombre?
---
Este lead fue derivado por Miri. Contáctalo lo antes posible 😊
```

---

### 💳 **Hoja: Esquemas de Pago**

Define las modalidades de pago para cada viaje.

**Columnas obligatorias:**
```
viaje_codigo | modalidad      | detalles                    | monto_inicial
LON2026      | Mensualidades  | 12 meses sin intereses      | 5000
LON2026      | Contado        | Pago único con 10% descuento| 40500
```

**¿Cuándo modificarla?**
- Al cambiar esquemas de pago
- Al actualizar montos de apartado

---

### ❓ **Hoja: FAQ**

Preguntas frecuentes que el bot puede responder.

**Columnas obligatorias:**
```
pregunta                                  | respuesta                           | categoria
¿De qué trata el programa English 4 Life? | English 4 Life es un programa...   | Programa
¿A qué países se viaja?                   | El programa 2027 se realiza en...  | Destinos
```

**¿Cuándo modificarla?**
- Al agregar nuevas preguntas frecuentes
- Al actualizar respuestas existentes

---

### 📖 **Hoja: Info_Viajes** ⭐ INFORMACIÓN DETALLADA

Contiene TODA la información que viene en las presentaciones de cada viaje.

**Columnas obligatorias:**
```
viaje_codigo | categoria       | titulo                          | contenido
LON2026      | Trámites        | ETA (Electronic Travel Auth)    | Requisito obligatorio para entrar al Reino Unido...
LON2026      | Clima           | Clima en Londres (Mayo)         | Temperatura: 10°C - 18°C. Clima templado...
LON2026      | Equipaje        | Lista de Equipaje Recomendada   | Ropa: pantalones, playeras, sudadera...
```

**¿Cuándo modificarla?**
- Al actualizar información de trámites
- Al cambiar recomendaciones de equipaje
- Al actualizar información de clima

**⚠️ Importante:**
- Esta hoja evita que el bot INVENTE información
- Si no está aquí, el bot dirá "Déjame confirmarte con una asesora"

---

## 🔄 4. CÓMO SE ACTUALIZA LA INFORMACIÓN EN EL BOT

### Proceso Automático (cada 5 minutos):

```
1. Bot lee Google Sheets ───┐
                            │
2. Guarda en caché (Redis)  │ ← AUTOMÁTICO
                            │   cada 5 minutos
3. Usa info actualizada ────┘
```

### ¿Qué significa esto para ustedes?

✅ **Hacen un cambio en Google Sheets**
⏱️ **Esperan máximo 5 minutos**
✅ **El bot ya tiene la información actualizada**

**NO necesitan:**
- ❌ Reiniciar el servidor
- ❌ Programar nada
- ❌ Hacer deploy
- ❌ Contactar a IT

---

## 🚨 5. REGLAS DE ORO (NO ROMPER)

### ✅ SÍ pueden hacer:

1. **Agregar filas** a cualquier hoja
2. **Modificar el contenido** de las celdas
3. **Actualizar precios, fechas, textos**
4. **Agregar/quitar asesoras**
5. **Subir nuevos materiales a Drive**
6. **Activar/desactivar viajes** (cambiar status)

### ❌ NO deben hacer:

1. **NUNCA cambiar el nombre de las columnas**
   - Ejemplo: NO cambiar "school_code" a "codigo_escuela"
   - El bot busca nombres EXACTOS

2. **NUNCA borrar columnas**
   - Aunque no las usen, déjenlas vacías

3. **NUNCA cambiar el nombre de las hojas**
   - Ejemplo: NO cambiar "Colegios" a "Escuelas"

4. **NUNCA borrar el archivo completo**
   - Si lo hacen, el bot deja de funcionar

5. **NO usar caracteres especiales raros en IDs**
   - ✅ Correcto: `LON2026`, `WC`, `BROCHURE_LON`
   - ❌ Incorrecto: `Londres 2026!`, `W&C`, `Brochure (nuevo)`

---

## 🎯 6. CASOS DE USO COMUNES

### Caso 1: "Necesito actualizar el precio de Londres"

**Pasos:**
1. Abrir Google Sheets
2. Ir a hoja "Viajes"
3. Buscar la fila con `codigo = LON2026`
4. Cambiar el valor en columna `precio`
5. Guardar (automático)
6. Esperar 5 minutos
7. ✅ El bot ya da el nuevo precio

---

### Caso 2: "Tenemos un brochure nuevo de Londres"

**Pasos:**
1. Subir el PDF nuevo a Google Drive
2. Compartir con: `grupo-w-s@travel-bot-490001.iam.gserviceaccount.com`
3. Copiar el link del archivo
4. Ir a Google Sheets → hoja "Materiales"
5. Buscar la fila `BROCHURE_LON_CEWIN_V2`
6. Pegar el nuevo link en columna `url`
7. Guardar
8. Esperar 5 minutos
9. ✅ El bot envía el brochure nuevo

---

### Caso 3: "Camila ya no es la asesora de Winston Churchill, ahora es Sofía"

**Pasos:**
1. Ir a Google Sheets → hoja "Asesoras"
2. Buscar la fila con `school_code = WC`
3. Cambiar:
   - `nombre` → "Sofía Ramírez"
   - `whatsapp` → número de Sofía (formato: 5215512345678)
   - `email` → email de Sofía
4. Guardar
5. Esperar 5 minutos
6. ✅ Las derivaciones ahora llegan a Sofía

---

### Caso 4: "Agregamos un nuevo viaje a París"

**Pasos:**
1. Ir a hoja "Viajes"
2. Agregar una fila nueva con:
   - `codigo`: PAR2026
   - `destino`: París 2026
   - `fechas_salida`: junio 2026
   - `precio`: 55000
   - `status`: activo
   - `descripcion`: Viaje cultural a París
3. Ir a hoja "Materiales"
4. Agregar materiales para este viaje (brochure, imágenes)
5. Ir a hoja "Actividades"
6. Agregar actividades para este viaje
7. Guardar todo
8. Esperar 5 minutos
9. ✅ El bot puede hablar sobre París

---

## 🛠️ 7. TROUBLESHOOTING (SOLUCIÓN DE PROBLEMAS)

### Problema: "El bot no envía el brochure actualizado"

**Posibles causas:**
1. ❌ El archivo NO fue compartido con `grupo-w-s@travel-bot-490001.iam.gserviceaccount.com`
   - **Solución:** Compartir el archivo de nuevo

2. ❌ El link está mal copiado en Google Sheets
   - **Solución:** Copiar el link completo de nuevo

3. ❌ No han pasado 5 minutos desde el cambio
   - **Solución:** Esperar un poco más

---

### Problema: "El bot no deriva al WhatsApp de la asesora"

**Posibles causas:**
1. ❌ El número está en formato incorrecto
   - **Solución:** Formato correcto: `5215512345678` (sin + ni espacios)

2. ❌ El `school_code` no coincide con el colegio
   - **Solución:** Verificar que el código sea EXACTAMENTE igual

3. ❌ La columna `whatsapp` está vacía
   - **Solución:** Agregar el número

---

### Problema: "El bot da información vieja"

**Causas:**
1. ❌ No han pasado 5 minutos
   - **Solución:** Esperar

2. ❌ Modificaron el nombre de una columna
   - **Solución:** Restaurar el nombre original

---

## 📞 8. CONTACTO DE SOPORTE

**Si algo no funciona después de seguir esta guía:**

1. Verificar que han pasado 5 minutos
2. Verificar que NO cambiaron nombres de columnas
3. Verificar permisos de Google Drive
4. Si persiste el problema: contactar a IT

---

## ✅ CHECKLIST DE CAPACITACIÓN

Después de esta sesión, el equipo debe poder:

- [ ] Actualizar precios de viajes
- [ ] Agregar/modificar asesoras y sus WhatsApp
- [ ] Subir materiales nuevos a Drive
- [ ] Compartir archivos al service account
- [ ] Actualizar información de viajes
- [ ] Agregar nuevas actividades
- [ ] Activar/desactivar viajes

---

**¿Preguntas?**

Recuerden: **Si está en Google Sheets, el bot lo sabe. Si no está, no lo sabe.**

Es así de simple 😊
