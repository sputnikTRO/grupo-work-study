# Oxford Education LIT — Nuevo agente de WhatsApp (Fase 3)

Agente conversacional de WhatsApp para **Oxford Education LIT**, construido sobre la
misma base que Miri (Travel) pero **completamente aislado**.

## Qué se implementó (código, ya listo)

| Pieza | Ubicación | Aislamiento |
|------|-----------|-------------|
| Unidad Oxford | `src/units/oxford-education/` | Módulo propio (handler, prompts, actions, lead service, store, whatsapp) |
| Cliente WhatsApp | `src/units/oxford-education/whatsapp.js` | Usa `OXED_ACCESS_TOKEN` + `OXED_PHONE_NUMBER_ID`, bucket de rate-limit propio |
| Webhook | `src/routes/oxford-webhook.js` → `POST/GET /webhook/oxford` | **Ruta separada** con verify token propio (`OXED_VERIFY_TOKEN`) |
| Memoria Redis | `src/units/oxford-education/store.js` | **Namespace `oxed:*`** (locks + historial) |
| Base de datos | tabla `oxford_leads` + enums Oxford | **Tabla propia**; las conversaciones/mensajes compartidos se etiquetan con `unit = oxford_education` |
| Migración | `prisma/migrations/20260608000000_add_oxford_leads/` | — |

El router por `phone_number_id` también enruta `oxford_education` en el webhook
compartido (`src/core/whatsapp/webhook.js`) como respaldo.

## Comportamiento del agente (system prompt)

`src/units/oxford-education/prompts.js`:

1. Saluda e identifica el **programa** de interés: Oxford TCC, Oxford TCC Kids,
   English Teaching Certificate (ETC), Alphable, Oxford LIFE, Rising Stars,
   Work & Study Spain.
2. **Califica** el lead (quién es, rol, edad del alumno si aplica, objetivo;
   distingue institución B2B vs. persona B2C).
3. Da **información general** de cada programa pero **NUNCA precios**. Si preguntan
   por precio → responde que una asesora preparará una cotización personalizada y
   ofrece agendar.
4. **Handoff** vía Calendly: al emitir `[DERIVAR_ASESOR:motivo]` el sistema envía
   automáticamente `https://meetings.hubspot.com/camila-serafin-jimenez/` y deja la
   conversación en `waiting_human`.

Datos que captura con `[CAPTURAR_DATO:campo:valor]`: `full_name`, `role`,
`lead_type`, `primary_product`, `institution_name`, `estimated_students`,
`school_cycle`.

## Variables de entorno (Fase 3)

```
OXED_PHONE_NUMBER_ID=1089738584230472
OXED_WABA_ID=1011897584591353
OXED_ACCESS_TOKEN=<TOKEN PERMANENTE>     # ⚠️ el token entregado estaba EXPIRADO
OXED_VERIFY_TOKEN=oxed_verify_151af5296c8280733003306198666b17
```

> ⚠️ **El access token entregado ya estaba expirado** (sesión vencida el 2026-06-05).
> Genera un **token permanente de usuario de sistema** en Meta Business para producción.

## Pasos para terminar el despliegue (requieren tus credenciales)

### 1. Railway — variables + deploy
```bash
railway login
railway link                  # selecciona el proyecto/servicio de grupo-work-study
# Actualiza OXED_ACCESS_TOKEN en .env con el token permanente, luego:
bash scripts/set-oxford-railway-env.sh
railway up                    # o push al branch conectado en GitHub
```
La migración `oxford_leads` se aplica sola en el arranque (`prisma migrate deploy`).

### 2. Meta — configurar el webhook del número Oxford ⬅️ ÚNICO PASO PENDIENTE
App "Asistente Oxford Education" (app_id `1696865108128054`).
En Meta App Dashboard → WhatsApp → Configuration → Webhook:
- **Callback URL:** `https://grupo-work-study-production.up.railway.app/webhook/oxford`
- **Verify token:** `oxed_verify_151af5296c8280733003306198666b17`
- Click **Verify and Save**, luego suscribe el campo **messages**.

> El override vía Graph API (`POST /{waba-id}/subscribed_apps` con
> `override_callback_uri`) **falla** hasta que la app tenga un callback base
> configurado en el dashboard (requiere el app secret). Por eso este paso es manual.

### 3. Verificar que recibe mensajes
```bash
# a) Handshake (debe responder "VERIFY_OK"):
curl "https://grupo-work-study-production.up.railway.app/webhook/oxford?hub.mode=subscribe&hub.verify_token=oxed_verify_151af5296c8280733003306198666b17&hub.challenge=VERIFY_OK"

# b) Envía un WhatsApp real al número Oxford y revisa los logs:
railway logs           # busca  "unit":"oxford_education"
```
Un mensaje entrante debe loguear `Sending Oxford request to Claude` y el agente
debe responder. Validación de credenciales (token nuevo):
```bash
curl "https://graph.facebook.com/v21.0/1089738584230472?fields=display_phone_number,verified_name" \
  -H "Authorization: Bearer <TOKEN_NUEVO>"
```

## Test local
```bash
node scripts/test-oxford-unit.mjs   # handshake + parsing + regla de no-precios
```
