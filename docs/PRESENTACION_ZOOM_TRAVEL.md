# 🎯 PRESENTACIÓN ZOOM - Gestión del Bot Miri

## 📌 AGENDA (45 minutos)

1. **¿Cómo funciona Miri?** (5 min)
2. **Google Sheets: Tu panel de control** (10 min)
3. **Cómo compartir archivos en Google Drive** (10 min)
4. **Gestión de asesoras y derivaciones** (10 min)
5. **Casos prácticos** (10 min)

---

## 1️⃣ ¿CÓMO FUNCIONA MIRI? (5 min)

### El Flujo Completo

```
Papá escribe por WhatsApp
         ↓
WhatsApp Cloud API
         ↓
Servidor (Railway)
         ↓
    ┌────┴────┐
    ↓         ↓
Claude AI   Google Sheets (ustedes actualizan aquí)
    ↓         ↓
    └────┬────┘
         ↓
Miri responde por WhatsApp
```

### 🔑 Punto Clave

**Google Sheets es el cerebro de Miri**
- Si está en Sheets → Miri lo sabe
- Si NO está en Sheets → Miri deriva a humano

---

## 2️⃣ GOOGLE SHEETS: TU PANEL DE CONTROL (10 min)

### 📊 8 Hojas = 8 Funciones

| # | Hoja | ¿Qué hace? | ¿Cuándo actualizar? |
|---|------|------------|---------------------|
| 1 | **Colegios** | Lista de colegios | Al agregar nuevo colegio |
| 2 | **Viajes** | Destinos, precios, fechas | Al cambiar precios/fechas |
| 3 | **Actividades** | Extras opcionales | Al agregar/quitar actividades |
| 4 | **Materiales** | PDFs e imágenes | Al actualizar brochures |
| 5 | **Asesoras** ⭐ | Quién atiende cada colegio | Al cambiar asesoras |
| 6 | **Esquemas de Pago** | Modalidades de pago | Al cambiar esquemas |
| 7 | **FAQ** | Preguntas frecuentes | Al agregar nuevas preguntas |
| 8 | **Info_Viajes** | Detalles del viaje | Al actualizar info |

### ⏱️ ¿Cuánto tarda en actualizarse?

**5 MINUTOS MÁXIMO**

El bot lee Google Sheets automáticamente cada 5 minutos.

---

## 3️⃣ GOOGLE DRIVE: CÓMO COMPARTIR ARCHIVOS (10 min)

### 🎯 Objetivo
Que Miri pueda enviar PDFs e imágenes actualizadas a los papás.

### 📝 Proceso (3 pasos)

#### PASO 1: Subir archivo a Google Drive
- Arrastra tu PDF/imagen a Google Drive
- Ubicación: carpeta que ustedes prefieran

#### PASO 2: Compartir con el robot ⭐ CRÍTICO
1. Clic derecho en el archivo → **Compartir**
2. Agregar: `grupo-w-s@travel-bot-490001.iam.gserviceaccount.com`
3. Permiso: **Lector**
4. Clic **Enviar**

**⚠️ Si olvidan este paso, el bot NO puede descargar el archivo**

#### PASO 3: Copiar link y pegar en Sheets
1. Clic derecho → **Obtener enlace**
2. Copiar el link completo
3. Google Sheets → Hoja "Materiales"
4. Pegar en columna `url`
5. Guardar

### 🎬 DEMOSTRACIÓN EN VIVO
(Aquí haces una demo compartiendo un archivo de prueba)

---

## 4️⃣ ASESORAS Y DERIVACIONES (10 min)

### ¿Cuándo deriva Miri?

El bot deriva automáticamente cuando:
1. ✅ El papá pide link de pago
2. ✅ Quiere enviar documentos oficiales
3. ✅ Tiene una queja o problema
4. ✅ Pide hablar con una persona
5. ✅ El nivel de interés es muy alto (score ≥ 8)

### 📱 ¿Qué recibe la asesora?

Mensaje automático por WhatsApp con:
- Nombre del padre
- Nombre y edad del estudiante
- Colegio
- Score de interés (1-10)
- Razón de derivación
- Resumen de la conversación
- WhatsApp del prospecto

### ⚙️ Cómo configurarlo

**Google Sheets → Hoja "Asesoras"**

```
school_code | nombre          | whatsapp       | email
WC          | María González  | 5215512345678  | maria@email.com
```

**⚠️ Formato de WhatsApp CRÍTICO:**
- ✅ Correcto: `5215512345678`
- ❌ Incorrecto: `+52 1 55 1234 5678`
- ❌ Incorrecto: `(55) 1234-5678`

### 🎬 DEMOSTRACIÓN
(Aquí muestras un ejemplo de derivación y el mensaje que llega)

---

## 5️⃣ CASOS PRÁCTICOS (10 min)

### Caso 1: Actualizar precio de Londres

**Escenario:** El precio cambió de $75,990 a $79,990

**Solución:**
1. Google Sheets → Hoja "Viajes"
2. Buscar fila con código `LON2026`
3. Cambiar columna `precio` a `79990`
4. Guardar (automático)
5. Esperar 5 minutos
6. ✅ El bot ya da el nuevo precio

---

### Caso 2: Nuevo brochure de Londres

**Escenario:** Diseño actualizó el brochure

**Solución:**
1. Subir nuevo PDF a Drive
2. Compartir con: `grupo-w-s@travel-bot-490001.iam.gserviceaccount.com`
3. Copiar link del archivo
4. Google Sheets → Hoja "Materiales"
5. Buscar `BROCHURE_LON_CEWIN_V2`
6. Pegar nuevo link en columna `url`
7. Esperar 5 minutos
8. ✅ El bot envía el brochure nuevo

---

### Caso 3: Camila se va, llega Sofía

**Escenario:** Winston Churchill ahora lo atiende Sofía

**Solución:**
1. Google Sheets → Hoja "Asesoras"
2. Buscar fila con `school_code = WC`
3. Cambiar:
   - `nombre` → "Sofía Ramírez"
   - `whatsapp` → `5215598765432`
   - `email` → `sofia@email.com`
4. Guardar
5. Esperar 5 minutos
6. ✅ Derivaciones llegan a Sofía

---

### Caso 4: Agregar actividad nueva

**Escenario:** Ahora ofrecen tour por Buckingham Palace

**Solución:**
1. Google Sheets → Hoja "Actividades"
2. Agregar fila nueva:
   - `viaje_codigo`: `LON2026`
   - `nombre`: `Tour Buckingham Palace`
   - `costo`: `3500`
   - `descripcion`: `Tour guiado por Buckingham Palace`
3. Subir imagen de la actividad a Drive
4. Compartir con service account
5. Agregar a hoja "Materiales"
6. Guardar
7. Esperar 5 minutos
8. ✅ El bot puede ofrecer esta actividad

---

## 🚨 REGLAS DE ORO (NUNCA HACER)

### ❌ NO HACER:

1. **NUNCA cambiar nombre de columnas**
   - Ejemplo: NO cambiar "school_code" a "codigo_escuela"

2. **NUNCA borrar columnas**
   - Aunque no las uses, déjalas vacías

3. **NUNCA cambiar nombre de las hojas**
   - Debe decir exactamente "Colegios", no "Escuelas"

4. **NUNCA usar símbolos en precios**
   - ✅ Correcto: `75990`
   - ❌ Incorrecto: `$75,990`

5. **NUNCA borrar el archivo completo**
   - Si lo hacen, el bot deja de funcionar

### ✅ SÍ PUEDEN:

1. ✅ Agregar filas nuevas
2. ✅ Modificar contenido de celdas
3. ✅ Actualizar precios y fechas
4. ✅ Agregar/quitar asesoras
5. ✅ Subir nuevos materiales

---

## 🎯 VERIFICACIÓN FINAL

### Después de esta sesión, pueden:

- [ ] Actualizar precios en Sheets
- [ ] Subir archivos a Drive
- [ ] Compartir archivos al service account
- [ ] Configurar asesoras y derivaciones
- [ ] Agregar actividades nuevas
- [ ] Saber qué NO deben tocar

---

## 📞 SOPORTE

**Si algo no funciona:**

1. ✅ Verificar que pasaron 5 minutos
2. ✅ Verificar formato de datos (WhatsApp, precios, etc.)
3. ✅ Verificar permisos de Drive
4. ✅ Revisar que NO cambiaron nombres de columnas

Si persiste → Contactar IT

---

## 📚 DOCUMENTOS DE APOYO

**Después del Zoom recibirán:**

1. `CAPACITACION_TRAVEL_TEAM.md` - Guía completa detallada
2. `REFERENCIA_RAPIDA_TRAVEL.md` - Hoja de referencia rápida
3. `EJEMPLOS_GOOGLE_SHEETS.md` - Ejemplos visuales de cada hoja

**Link de Google Sheets:**
https://docs.google.com/spreadsheets/d/18a2zVagPSu5iJf8GBdM_WcEnDC3vnZ2SHn7s_ftPmnk/edit

**Service Account (guarden este email):**
```
grupo-w-s@travel-bot-490001.iam.gserviceaccount.com
```

---

## ❓ PREGUNTAS Y RESPUESTAS

(Deja 5-10 minutos al final para preguntas)

### Preguntas frecuentes esperadas:

**P: ¿Puedo editar el Sheets desde mi celular?**
R: Sí, con la app de Google Sheets. Pero es más fácil desde computadora.

**P: ¿Qué pasa si borro algo por error?**
R: Google Sheets tiene historial de versiones. Podemos restaurar.

**P: ¿El bot funciona 24/7?**
R: Sí, está activo las 24 horas, todos los días.

**P: ¿Cuántos leads puede manejar?**
R: Técnicamente ilimitados. El límite es 250 contactos únicos por día (límite de Meta).

**P: ¿Puedo ver las conversaciones del bot?**
R: Sí, se guardan en la base de datos. Podemos crear un dashboard.

---

## ✅ PRÓXIMOS PASOS

1. **Hoy:** Practicar actualizando precios de prueba
2. **Esta semana:** Subir sus brochures actuales a Drive
3. **Próxima semana:** Revisar primeras derivaciones reales

---

¡Gracias por su atención! 🎉

**Recuerden:** Si está en Google Sheets, Miri lo sabe. Si no está, Miri deriva.

---

## 🎬 SCRIPT SUGERIDO PARA EL ZOOM

### Introducción (2 min)
"Buen día a todos. Hoy vamos a aprender a gestionar a Miri, nuestro nuevo bot de WhatsApp para Travel. Al final de esta sesión, ustedes podrán actualizar precios, cambiar información y gestionar las derivaciones a asesoras sin necesidad de contactar a IT."

### Demostración (durante cada sección)
- Comparte pantalla mostrando Google Sheets
- Haz cambios en vivo
- Muestra cómo se refleja en el bot
- Comparte un archivo de Drive en vivo

### Cierre (3 min)
"Lo más importante: Google Sheets es su panel de control. Cualquier cambio ahí se refleja en 5 minutos. No tengan miedo de experimentar, tienen historial de versiones para revertir. ¿Alguna pregunta?"

---

**Duración total:** ~45 minutos + preguntas
