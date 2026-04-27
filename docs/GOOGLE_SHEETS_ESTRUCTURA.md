# Estructura Completa de Google Sheets para el Bot

Este documento define la estructura de **todas las hojas** que el bot necesita para funcionar correctamente.

---

## 📊 Hojas Requeridas

1. **Colegios** - Catálogo de colegios con convenio
2. **Viajes** - Viajes disponibles con precios y fechas
3. **Actividades** - Actividades extras opcionales
4. **Materiales** - PDFs, imágenes y documentos para enviar
5. **Asesoras** - Asesoras asignadas por colegio
6. **Esquemas de Pago** - Modalidades de pago
7. **FAQ** - Preguntas frecuentes
8. **Info_Viajes** ⭐ NUEVA - Información detallada de cada viaje
9. **Configuración** - Parámetros del sistema
10. **Leads_Log** - Log de leads (auto-generada por bot)

---

## 1. Hoja: Colegios

**Headers:**
```
codigo | nombre | zona | contacto
```

**Ejemplos:**
```
WC     | Winston Churchill              | Norte     | contacto@wc.edu.mx
AM     | Colegio Americano              | Sur       | info@americano.mx
CB     | Colegio Británico              | Poniente  | admisiones@britanico.mx
```

---

## 2. Hoja: Viajes

**Headers:**
```
codigo    | destino           | fechas_salida | precio | status  | descripcion
```

**Ejemplos:**
```
LON2026   | Londres 2026      | julio 2026    | 45000  | activo  | Viaje cultural a Londres con clases de inglés
NYC2026   | Nueva York 2026   | agosto 2026   | 52000  | activo  | Experiencia en Nueva York con homestay
```

**⚠️ Importante:**
- `codigo` se usa para vincular viajes con actividades, materiales y esquemas de pago
- `precio` es el precio BASE de referencia en MXN (sin comas ni símbolos)
- `status` debe ser "activo" para que aparezca en el bot

---

## 3. Hoja: Actividades

**Headers:**
```
viaje_codigo | nombre                              | costo | descripcion                                    | incluido
```

**Ejemplos:**
```
LON2026      | London Eye + Musical + Estadio      | 5300  | London Eye, Musical West End, Estadio Chelsea  | no
LON2026      | Harry Potter Studio Tour            | 4500  | Tour completo por Warner Bros Studios          | no
LON2026      | Museo Británico                     | 0     | Visita al museo más importante de Londres      | sí
```

**⚠️ Importante:**
- `costo` en MXN (sin comas ni símbolos)
- Si `costo` es 0, el bot dirá "Incluido en el precio base"

---

## 4. Hoja: Materiales ⭐ **ACTUALIZAR CON URLs REALES**

**Headers:**
```
id                  | nombre                    | tipo   | url                                           | viaje_codigo | descripcion
```

**Ejemplos:**
```
BROCHURE_LON        | Brochure Londres 2026     | pdf    | https://drive.google.com/uc?id=FILE_ID       | LON2026      | Información completa del viaje
PRECIOS_LON         | Lista de Precios Londres  | pdf    | https://drive.google.com/uc?id=FILE_ID       | LON2026      | Precios y esquemas de pago
IMG_HARRY_POTTER    | Imagen Harry Potter Tour  | imagen | https://drive.google.com/uc?id=FILE_ID       | LON2026      | Fotografía del tour
PRESENTACION_LON    | Presentación Londres      | pdf    | https://drive.google.com/uc?id=FILE_ID       | LON2026      | Presentación completa del programa
EXTENSIO_PARIS      | Extensión París           | pdf    | https://drive.google.com/uc?id=FILE_ID       | LON2026      | Información sobre la extensión a París
```

**⚠️ Cómo obtener URLs de Google Drive:**

### Opción 1: URL directa (recomendada)
1. Sube el archivo a Google Drive
2. Click derecho → "Obtener enlace"
3. Cambiar a "Cualquier persona con el enlace"
4. Copiar el ID del archivo (entre `/d/` y `/view`)
5. Usar formato: `https://drive.google.com/uc?id=FILE_ID&export=download`

Ejemplo:
- Link original: `https://drive.google.com/file/d/1ABC123xyz/view?usp=sharing`
- FILE_ID: `1ABC123xyz`
- URL para bot: `https://drive.google.com/uc?id=1ABC123xyz&export=download`

### Opción 2: Dropbox
1. Sube archivo a Dropbox
2. Obtén link público
3. Cambia `?dl=0` por `?dl=1` al final

### Opción 3: Servidor propio
- Cualquier URL pública (https://tudominio.com/archivo.pdf)

---

## 5. Hoja: Asesoras

**Headers:**
```
school_code | nombre          | whatsapp       | email
```

**Ejemplos:**
```
WC          | María González  | 5215512345678  | maria@grupoworkystudy.com
AM          | Laura Martínez  | 5215587654321  | laura@grupoworkystudy.com
```

---

## 6. Hoja: Esquemas de Pago

**Headers:**
```
viaje_codigo | modalidad      | detalles                                | monto_inicial
```

**Ejemplos:**
```
LON2026      | Mensualidades  | 12 meses sin intereses                  | 5000
LON2026      | Contado        | Pago único con 10% descuento            | 40500
NYC2026      | Mensualidades  | 10 meses sin intereses                  | 6000
```

---

## 7. Hoja: FAQ

**Headers:**
```
pregunta                                          | respuesta                                                                           | categoria
```

**Ejemplos:**
```
¿De qué trata el programa English 4 Life?         | English 4 Life es un programa inmersivo de inglés...                                | Programa
¿Cuál es el objetivo del programa?                | El objetivo es que los estudiantes mejoren su inglés...                             | Programa
¿A qué países se viaja?                           | El programa 2027 se realiza en Londres y Dublín                                     | Destinos
```

---

## 8. Hoja: Info_Viajes ⭐ **NUEVA - MUY IMPORTANTE**

Esta hoja contiene TODA la información que viene en las presentaciones de cada viaje.

**Headers:**
```
viaje_codigo | categoria       | titulo                  | contenido
```

**Ejemplos completos basados en las imágenes que compartiste:**

```csv
LON2026,Trámites,ETA (Electronic Travel Authorization),"Requisito obligatorio para entrar al Reino Unido. Aplicar en app 'UK ETA'. Costo: 16 libras esterlinas. Vigencia: 2 años. Tramitar con 1 mes de anticipación mínimo."

LON2026,Trámites,Formato SAM (Salida de Menores),"Autorización de salida de menores de la Secretaría de Gobernación. Costo: $294 MXN. Documentos necesarios: pasaporte original del menor, identificación oficial del padre/madre/tutor, acta de nacimiento original del menor. Tramitar en el aeropuerto con 30 días de anticipación."

LON2026,Clima,Clima en Londres (Mayo),"Temperatura: 10°C - 18°C. Clima templado y variable. Se recomienda llevar ropa en capas, chamarra ligera impermeable, paraguas compacto."

LON2026,Equipaje,Lista de Equipaje Recomendada,"Ropa: pantalones, playeras, sudadera, chamarra impermeable, zapatos cómodos para caminar, tenis, calcetines. Documentos: pasaporte, ETA, Formato SAM, seguro médico. Electrónicos: celular, cargador, adaptador UK (tipo G), power bank. Higiene personal: cepillo de dientes, pasta, shampoo (tamaño viaje), bloqueador solar. Medicamentos personales en empaque original."

LON2026,Conectividad,Opciones de Conectividad,"Opción 1: SIM card local (comprar en aeropuerto o tiendas). Opción 2: eSIM (apps recomendadas: Airalo, Holafly). Opción 3: Plan de roaming internacional con tu operador actual. WiFi gratuito disponible en hotel, museos y algunos lugares públicos."

LON2026,Extensión,Extensión a París,"Precio: $42,990 MXN. Duración: 5 días. Incluye: Traslado Londres-París en Eurostar, hotel ejecutivo tipo Ibis, desayunos diarios, entrada a Disneyland París (1 día), entrada a Palacio de Versalles, tours por puntos de interés, seguro de gastos médicos mayores, seguro de viaje, transfer al hotel, staff 24/7."

LON2026,Actividades Extra,Opción 1 - London Eye West End Musical Estadio,"Precio: $5,300 MXN. Incluye: Ingreso al London Eye (30 minutos dentro de la cápsula), entradas a un Musical de West End, visita por un Football Stadium (Wembley o Chelsea, sujeto a disponibilidad, 75 minutos de recorrido)."

LON2026,Actividades Extra,Opción 2 - Harry Potter Studio Tour,"Precio: $4,500 MXN. Incluye: Visitas por los sets de grabación, conoce la creación de los efectos visuales, animales mágicos, vestuarios originales de las películas, actividades interactivas como volar en escoba y probar butter beer (bebida icónica de la saga). Tiempo de visita aprox. 3.5 horas sin límite de tiempo."

LON2026,Incluido,Qué incluye el programa base,"Vuelo redondo Ciudad de México - Londres, hospedaje en residencia estudiantil o familia anfitriona, 3 comidas diarias, clases de inglés (15-20 horas semanales), actividades culturales (museos, tours, excursiones), transporte local durante actividades, seguro médico internacional, seguro de viaje, staff 24/7 bilingüe, sesiones pre-viaje informativas."

LON2026,Seguridad,Medidas de Seguridad,"Staff bilingüe 24/7 durante todo el viaje. Seguro médico internacional con cobertura amplia. Seguro de viaje. Familias anfitrionas certificadas (si aplica). Protocolo de emergencias establecido. Supervisión constante de estudiantes. Contacto permanente con padres vía WhatsApp."
```

**⚠️ Importante:**
- Esta hoja permite que el bot responda preguntas específicas SIN inventar información
- Cada vez que agreguen un viaje nuevo, copian esta estructura
- El bot buscará automáticamente en esta hoja cuando le pregunten sobre trámites, clima, etc.

---

## 9. Hoja: Configuración

**Headers:**
```
parametro                | valor
```

**Ejemplos:**
```
handoff_score_threshold  | 7
max_follow_ups           | 3
```

---

## 10. Hoja: Leads_Log (Auto-generada por el bot)

**Headers:**
```
timestamp | nombre_padre | nombre_estudiante | telefono | colegio | programa | destino | edad_estudiante | score | estatus | asesor_asignado | materiales_enviados | ultimo_contacto | notas
```

⚠️ Esta hoja la crea y actualiza automáticamente el bot. **NO editar manualmente**.

---

## 📝 Checklist de Actualización

Cuando agregues un nuevo viaje:

- [ ] Agregar fila en **Viajes** con código único
- [ ] Agregar actividades en **Actividades** vinculadas con `viaje_codigo`
- [ ] Subir PDFs/imágenes a Google Drive con permisos públicos
- [ ] Agregar materiales en **Materiales** con URLs reales
- [ ] Agregar toda la info del viaje en **Info_Viajes** (trámites, clima, equipaje, etc.)
- [ ] Agregar esquemas de pago en **Esquemas de Pago**
- [ ] Actualizar **FAQ** si hay preguntas nuevas

---

## 🚀 El bot automáticamente:

✅ Leerá toda esta información cada 5 minutos
✅ Responderá preguntas usando **Info_Viajes**
✅ Enviará PDFs/imágenes reales desde **Materiales**
✅ Dará precios actualizados de **Viajes**, **Actividades** y **Esquemas de Pago**
✅ **NUNCA inventará información** que no esté en las hojas

---

## ⚠️ Recordatorio Crítico

**Google Sheets es la ÚNICA fuente de verdad.**

Si un dato NO está en Sheets → El bot dirá: "Déjeme confirmar ese dato con una asesora" y derivará.
