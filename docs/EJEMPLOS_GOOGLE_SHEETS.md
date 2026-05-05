# 📝 EJEMPLOS PRÁCTICOS - Cómo Llenar Cada Hoja del Google Sheets

## 🏫 EJEMPLO: Hoja "Colegios"

### ✅ CORRECTO:
```
codigo | nombre                      | zona      | contacto
-------|----------------------------|-----------|---------------------------
WC     | Winston Churchill          | Norte     | contacto@wc.edu.mx
AM     | Colegio Americano          | Sur       | info@americano.mx
CB     | Colegio Británico          | Poniente  | admisiones@britanico.mx
TH     | Thomas Jefferson           | Oriente   | info@thomasjefferson.mx
```

### ❌ INCORRECTO:
```
codigo | nombre                      | zona      | contacto
-------|----------------------------|-----------|---------------------------
W.C.   | Winston Churchill School   | Norte     | (NO uses puntos en codigo)
       | Colegio Americano          | Sur       | (codigo vacío = ERROR)
CB-2   | Colegio Británico          | Poniente  | (NO uses guiones si no es necesario)
```

---

## ✈️ EJEMPLO: Hoja "Viajes"

### ✅ CORRECTO:
```
codigo    | destino           | fechas_salida      | precio | status   | descripcion
----------|-------------------|-------------------|--------|----------|----------------------------------
LON2026   | Londres 2026      | Mayo 22-31, 2026  | 75990  | activo   | Viaje cultural a Londres
PAR2026   | París 2026        | Julio 10-18, 2026 | 42990  | activo   | Extensión a París
NYC2026   | Nueva York 2026   | Agosto 1-10, 2026 | 85000  | inactivo | Experiencia en Nueva York
```

### ❌ INCORRECTO:
```
codigo      | destino           | fechas_salida      | precio    | status   | descripcion
------------|-------------------|-------------------|-----------|----------|------------------
Londres 26  | Londres 2026      | Mayo 22-31, 2026  | $75,990   | Activo   | (NO uses $ ni comas en precio)
LON-2026    | Londres 2026      | Mayo 22-31, 2026  | 75990.00  | si       | (status debe ser "activo" o "inactivo")
            | París 2026        | Julio 10-18, 2026 | 42990     | activo   | (codigo vacío = ERROR)
```

**Notas:**
- `precio`: Solo números, sin símbolos ni comas (75990, no $75,990)
- `status`: Debe ser exactamente "activo" o "inactivo" (minúsculas)
- `codigo`: Sin espacios, sin caracteres especiales

---

## 🎭 EJEMPLO: Hoja "Actividades"

### ✅ CORRECTO:
```
viaje_codigo | nombre                              | costo | descripcion
-------------|-------------------------------------|-------|---------------------------------------
LON2026      | London Eye + Musical + Estadio      | 5300  | London Eye, Musical West End, Estadio
LON2026      | Harry Potter Studio Tour            | 4500  | Tour completo por Warner Bros Studios
LON2026      | Museo Británico                     | 0     | Visita al museo (incluido en precio)
PAR2026      | Disneyland París - Día Extra        | 3500  | Día adicional en Disneyland
```

### ❌ INCORRECTO:
```
viaje_codigo | nombre                              | costo      | descripcion
-------------|-------------------------------------|------------|------------------
Londres      | London Eye + Musical                | $5,300 MXN | (viaje_codigo debe ser LON2026, no "Londres")
LON2026      | Harry Potter                        | 4500 pesos | (costo debe ser solo número)
LON2026      | Museo Británico                     | Gratis     | (debe ser 0, no "Gratis")
```

---

## 📄 EJEMPLO: Hoja "Materiales"

### ✅ CORRECTO:
```
id                          | nombre                      | tipo   | url                                                  | viaje_codigo | descripcion
----------------------------|----------------------------|--------|------------------------------------------------------|--------------|------------------------
BROCHURE_LON_CEWIN_V2      | Brochure Londres 2026      | pdf    | https://drive.google.com/file/d/1ABC123xyz/view     | LON2026      | Presentación completa
ACT_EXTRA_LONDON_EYE       | Actividad London Eye       | imagen | https://drive.google.com/file/d/1XYZ789abc/view     | LON2026      | Imagen con detalles
FLYER_PARIS_2026           | Flyer París                | pdf    | https://drive.google.com/file/d/1DEF456ghi/view     | PAR2026      | Información de París
IMG_HARRY_POTTER           | Tour Harry Potter          | imagen | https://drive.google.com/file/d/1GHI012jkl/view     | LON2026      | Foto del tour
```

### ❌ INCORRECTO:
```
id                          | nombre                      | tipo        | url                                    | viaje_codigo
----------------------------|----------------------------|-------------|----------------------------------------|-------------
Brochure Londres           | Brochure Londres 2026      | PDF         | www.oxford.com/brochure.pdf           | LON2026
(NO uses espacios en ID)   |                            | (minúsculas)| (debe ser link de Google Drive)       |
BROCHURE LON 2026          | Brochure Londres 2026      | pdf         | drive.google.com/1ABC123              | LON2026
(NO uses espacios en ID)   |                            |             | (falta https:// y /file/d/)           |
```

**Notas importantes sobre Materiales:**

1. **El ID debe ser único y sin espacios**
   - ✅ Correcto: `BROCHURE_LON_CEWIN_V2`
   - ❌ Incorrecto: `Brochure Londres 2026`

2. **El tipo debe ser exactamente**
   - `pdf` (minúsculas) para PDFs
   - `imagen` (minúsculas) para imágenes JPG/PNG

3. **El URL debe ser de Google Drive compartido**
   - Formato: `https://drive.google.com/file/d/[ID_DEL_ARCHIVO]/view`
   - **IMPORTANTE:** El archivo DEBE estar compartido con:
     ```
     grupo-w-s@travel-bot-490001.iam.gserviceaccount.com
     ```

---

## 👩‍💼 EJEMPLO: Hoja "Asesoras"

### ✅ CORRECTO:
```
school_code | nombre              | whatsapp       | email
------------|---------------------|----------------|--------------------------------
WC          | María González      | 5215512345678  | maria@grupoworkystudy.com
AM          | Laura Martínez      | 5215587654321  | laura@grupoworkystudy.com
CB          | Sofía Ramírez       | 5215598765432  | sofia@grupoworkystudy.com
TH          | Ana Torres          | 5215534567890  | ana@grupoworkystudy.com
```

### ❌ INCORRECTO:
```
school_code | nombre              | whatsapp           | email
------------|---------------------|--------------------|-----------------------
WC          | María González      | +52 1 55 1234 5678 | maria@gmail.com
(NO uses +, espacios ni guiones)                      |
AM          | Laura Martínez      | (55) 5876-5432     | laura@grupoworkystudy.com
(NO uses paréntesis ni guiones)                       |
CB          | Sofía Ramírez       | 55 9876 5432       | (falta código de país 521)
```

**Formato correcto de WhatsApp:**
- Código país: 52 (México)
- 1 (número nacional)
- 10 dígitos del número
- **Todo junto, sin espacios:** `5215512345678`

---

## 💳 EJEMPLO: Hoja "Esquemas de Pago"

### ✅ CORRECTO:
```
viaje_codigo | modalidad           | detalles                              | monto_inicial
-------------|---------------------|---------------------------------------|---------------
LON2026      | Mensualidades       | 12 meses sin intereses                | 5000
LON2026      | Contado             | Pago único con 10% descuento          | 68391
PAR2026      | Mensualidades       | 10 meses sin intereses                | 5000
PAR2026      | Contado             | Pago único                            | 42990
```

### ❌ INCORRECTO:
```
viaje_codigo | modalidad           | detalles                              | monto_inicial
-------------|---------------------|---------------------------------------|---------------
LON2026      | 12 Meses            | 12 meses sin intereses                | $5,000
(modalidad debe ser "Mensualidades" o "Contado")      | (sin símbolos)
LON2026      | Contado             | 10% descuento                         | 68,391.00
                                                                        | (sin comas ni decimales)
```

---

## ❓ EJEMPLO: Hoja "FAQ"

### ✅ CORRECTO:
```
pregunta                                          | respuesta                                                              | categoria
--------------------------------------------------|------------------------------------------------------------------------|----------
¿De qué trata el programa English 4 Life?         | English 4 Life es un programa inmersivo donde los estudiantes...      | Programa
¿Cuál es el objetivo del programa?                | El objetivo es que los estudiantes mejoren su inglés...               | Programa
¿A qué países se viaja?                           | El programa 2026 se realiza en Londres con extensión opcional a París | Destinos
¿Qué incluye el precio del viaje?                 | El precio incluye vuelo, hospedaje, 3 comidas diarias, clases...      | Precios
```

---

## 📖 EJEMPLO: Hoja "Info_Viajes"

### ✅ CORRECTO:
```
viaje_codigo | categoria  | titulo                              | contenido
-------------|------------|-------------------------------------|----------------------------------------------------
LON2026      | Trámites   | ETA (Electronic Travel Authorization) | Requisito obligatorio para entrar al Reino Unido. Aplicar en app UK ETA. Costo: 16 libras. Vigencia: 2 años.
LON2026      | Trámites   | Formato SAM (Salida de Menores)     | Autorización de salida de la Secretaría de Gobernación. Costo: $294 MXN. Tramitar en aeropuerto.
LON2026      | Clima      | Clima en Londres (Mayo)             | Temperatura: 10°C - 18°C. Clima templado. Llevar ropa en capas, chamarra impermeable, paraguas.
LON2026      | Equipaje   | Lista de Equipaje Recomendada       | Ropa: pantalones, playeras, sudadera, chamarra, zapatos cómodos. Documentos: pasaporte, ETA, SAM.
```

**Categorías comunes:**
- `Trámites` - Documentos necesarios, procesos
- `Clima` - Información meteorológica
- `Equipaje` - Qué llevar
- `Conectividad` - Internet, SIM cards
- `Extensión` - Información de extensiones del viaje
- `Actividades Extra` - Detalles de actividades opcionales
- `Incluido` - Qué incluye el programa base
- `Seguridad` - Medidas de seguridad del viaje

---

## 🎯 CHECKLIST ANTES DE GUARDAR

Antes de guardar cambios en Google Sheets, verifica:

- [ ] ✅ Todos los códigos son únicos (no repetidos)
- [ ] ✅ No hay celdas vacías en columnas obligatorias
- [ ] ✅ Los precios son solo números (sin $, sin comas)
- [ ] ✅ Los WhatsApp están en formato: 5215512345678
- [ ] ✅ Los status son exactamente "activo" o "inactivo"
- [ ] ✅ Los archivos de Drive están compartidos al service account
- [ ] ✅ No cambié nombres de columnas
- [ ] ✅ No borré columnas

---

## ⏱️ DESPUÉS DE GUARDAR

1. ✅ Guardar cambios (automático en Google Sheets)
2. ⏱️ **Esperar 5 minutos**
3. ✅ Probar enviando un mensaje al bot
4. ✅ Verificar que el bot da la información actualizada

---

¿Dudas? Revisa el documento principal: `CAPACITACION_TRAVEL_TEAM.md`
