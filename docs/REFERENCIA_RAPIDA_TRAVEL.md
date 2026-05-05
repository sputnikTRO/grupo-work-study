# 📋 REFERENCIA RÁPIDA - Bot Miri Travel

## 🔗 LINKS IMPORTANTES

**Google Sheets (Base de Conocimiento):**
https://docs.google.com/spreadsheets/d/18a2zVagPSu5iJf8GBdM_WcEnDC3vnZ2SHn7s_ftPmnk/edit

**Service Account (para compartir archivos de Drive):**
```
grupo-w-s@travel-bot-490001.iam.gserviceaccount.com
```

---

## ⚡ ACCIONES RÁPIDAS

### ✏️ Cambiar precio de un viaje
1. Google Sheets → Hoja "Viajes"
2. Modificar columna `precio`
3. Esperar 5 minutos

### 📄 Actualizar brochure
1. Subir PDF a Google Drive
2. Compartir con: `grupo-w-s@travel-bot-490001.iam.gserviceaccount.com`
3. Copiar link
4. Google Sheets → Hoja "Materiales" → Pegar link en columna `url`
5. Esperar 5 minutos

### 👩‍💼 Cambiar asesora de un colegio
1. Google Sheets → Hoja "Asesoras"
2. Buscar fila del `school_code`
3. Actualizar: nombre, whatsapp (5215512345678), email
4. Esperar 5 minutos

### ✈️ Agregar nuevo viaje
1. Google Sheets → Hoja "Viajes" → Agregar fila
2. Llenar: codigo, destino, fechas_salida, precio, status=activo
3. Hoja "Materiales" → Agregar brochures/imágenes
4. Hoja "Actividades" → Agregar actividades opcionales
5. Esperar 5 minutos

---

## 🚨 NUNCA HACER

❌ Cambiar nombre de columnas
❌ Borrar columnas
❌ Cambiar nombre de hojas
❌ Borrar el archivo

---

## ⏱️ TIEMPO DE ACTUALIZACIÓN

**5 MINUTOS** - El bot lee Google Sheets cada 5 minutos automáticamente

---

## 📞 FORMATO DE WHATSAPP CORRECTO

✅ Correcto: `5215512345678`
❌ Incorrecto: `+52 1 55 1234 5678`
❌ Incorrecto: `(55) 1234-5678`

---

## 🔧 SI ALGO NO FUNCIONA

1. ✅ ¿Han pasado 5 minutos?
2. ✅ ¿El archivo está compartido al service account?
3. ✅ ¿Los nombres de columnas están correctos?
4. ✅ ¿El formato de datos es correcto?

Si todo lo anterior está bien → Contactar IT

---

## 📊 HOJAS DEL GOOGLE SHEET

| Hoja | Para qué sirve |
|------|----------------|
| **Colegios** | Catálogo de colegios |
| **Viajes** | Viajes disponibles, precios, fechas |
| **Actividades** | Actividades extras por viaje |
| **Materiales** | PDFs e imágenes que envía el bot |
| **Asesoras** | Quién atiende cada colegio |
| **Esquemas de Pago** | Modalidades de pago |
| **FAQ** | Preguntas frecuentes |
| **Info_Viajes** | Información detallada (trámites, clima, etc.) |

---

**Regla de Oro:** Si está en Google Sheets, el bot lo sabe. Si no está, no lo sabe.
