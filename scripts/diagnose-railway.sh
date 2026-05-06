#!/bin/bash

# Script de diagnóstico completo para Railway
# Ejecuta esto para identificar el problema

set -e

echo "=========================================="
echo "🔍 DIAGNÓSTICO DE RAILWAY"
echo "=========================================="
echo ""

# Login check
echo "🔑 Verificando autenticación en Railway..."
if ! railway whoami &>/dev/null; then
    echo "❌ No estás autenticado en Railway"
    echo ""
    echo "Por favor ejecuta:"
    echo "  railway login"
    echo ""
    exit 1
fi

echo "✅ Autenticado como: $(railway whoami)"
echo ""

# Project info
echo "📦 Información del proyecto:"
railway status
echo ""

# Check critical environment variables
echo "=========================================="
echo "🔐 VERIFICANDO VARIABLES CRÍTICAS"
echo "=========================================="
echo ""

# WA_PHONE_NUMBER_ID_TRAVEL
echo "1️⃣ WA_PHONE_NUMBER_ID_TRAVEL:"
WA_PHONE=$(railway variables get WA_PHONE_NUMBER_ID_TRAVEL 2>/dev/null || echo "ERROR")
if [ "$WA_PHONE" == "1167666496420298" ]; then
    echo "   ✅ Correcto: $WA_PHONE"
else
    echo "   ❌ INCORRECTO: $WA_PHONE"
    echo "   Debería ser: 1167666496420298"
    echo ""
    echo "   ARREGLAR CON:"
    echo '   railway variables set WA_PHONE_NUMBER_ID_TRAVEL="1167666496420298"'
    echo ""
fi
echo ""

# WA_VERIFY_TOKEN
echo "2️⃣ WA_VERIFY_TOKEN:"
VERIFY_TOKEN=$(railway variables get WA_VERIFY_TOKEN 2>/dev/null || echo "ERROR")
if [ -n "$VERIFY_TOKEN" ] && [ "$VERIFY_TOKEN" != "ERROR" ]; then
    echo "   ✅ Configurado: ${VERIFY_TOKEN:0:20}..."
else
    echo "   ❌ NO CONFIGURADO"
fi
echo ""

# WA_ACCESS_TOKEN
echo "3️⃣ WA_ACCESS_TOKEN:"
ACCESS_TOKEN=$(railway variables get WA_ACCESS_TOKEN 2>/dev/null || echo "ERROR")
if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "ERROR" ]; then
    echo "   ✅ Configurado: ${ACCESS_TOKEN:0:20}..."
else
    echo "   ❌ NO CONFIGURADO"
fi
echo ""

# ANTHROPIC_API_KEY
echo "4️⃣ ANTHROPIC_API_KEY:"
ANTHROPIC=$(railway variables get ANTHROPIC_API_KEY 2>/dev/null || echo "ERROR")
if [ -n "$ANTHROPIC" ] && [ "$ANTHROPIC" != "ERROR" ]; then
    echo "   ✅ Configurado: ${ANTHROPIC:0:20}..."
else
    echo "   ❌ NO CONFIGURADO"
fi
echo ""

# GOOGLE_PRIVATE_KEY - El más problemático
echo "5️⃣ GOOGLE_PRIVATE_KEY:"
PRIVATE_KEY=$(railway variables get GOOGLE_PRIVATE_KEY 2>/dev/null || echo "ERROR")

if [ "$PRIVATE_KEY" == "ERROR" ]; then
    echo "   ❌ NO CONFIGURADO"
    echo ""
elif [[ ! "$PRIVATE_KEY" =~ "BEGIN PRIVATE KEY" ]]; then
    echo "   ❌ FORMATO INVÁLIDO (no contiene BEGIN PRIVATE KEY)"
    echo ""
elif [[ "$PRIVATE_KEY" =~ $'\n' ]]; then
    echo "   ❌ TIENE SALTOS DE LÍNEA REALES (debe tener \\n literales)"
    echo ""
    echo "   PROBLEMA DETECTADO:"
    echo "   La private key tiene saltos de línea reales en lugar de \\n como string"
    echo ""
    echo "   SOLUCIÓN:"
    echo "   1. Ve a Railway Dashboard → Variables"
    echo "   2. Edita GOOGLE_PRIVATE_KEY"
    echo "   3. Pega el valor EN UNA SOLA LÍNEA con \\n literales"
    echo ""
    echo "   O ejecuta:"
    echo '   railway variables set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nTU_KEY_AQUI\n-----END PRIVATE KEY-----\n"'
    echo ""
elif [[ "$PRIVATE_KEY" =~ "\\n" ]]; then
    echo "   ✅ Formato correcto (con \\n literales)"
    echo "   📏 Longitud: ${#PRIVATE_KEY} caracteres"
else
    echo "   ⚠️  No se pudo validar completamente"
    echo "   📏 Longitud: ${#PRIVATE_KEY} caracteres"
fi
echo ""

# GOOGLE_SERVICE_ACCOUNT_EMAIL
echo "6️⃣ GOOGLE_SERVICE_ACCOUNT_EMAIL:"
GOOGLE_EMAIL=$(railway variables get GOOGLE_SERVICE_ACCOUNT_EMAIL 2>/dev/null || echo "ERROR")
if [[ "$GOOGLE_EMAIL" =~ "@" ]] && [[ "$GOOGLE_EMAIL" =~ "gserviceaccount.com" ]]; then
    echo "   ✅ Configurado: $GOOGLE_EMAIL"
else
    echo "   ❌ INVÁLIDO O NO CONFIGURADO"
fi
echo ""

# GOOGLE_SHEETS_ID
echo "7️⃣ GOOGLE_SHEETS_ID:"
SHEETS_ID=$(railway variables get GOOGLE_SHEETS_ID 2>/dev/null || echo "ERROR")
if [ -n "$SHEETS_ID" ] && [ "$SHEETS_ID" != "ERROR" ]; then
    echo "   ✅ Configurado: $SHEETS_ID"
else
    echo "   ❌ NO CONFIGURADO"
fi
echo ""

# DATABASE_URL
echo "8️⃣ DATABASE_URL:"
DATABASE_URL=$(railway variables get DATABASE_URL 2>/dev/null || echo "ERROR")
if [[ "$DATABASE_URL" =~ "postgresql://" ]]; then
    echo "   ✅ Configurado (PostgreSQL)"
else
    echo "   ❌ NO CONFIGURADO O INVÁLIDO"
fi
echo ""

# REDIS_URL
echo "9️⃣ REDIS_URL:"
REDIS_URL=$(railway variables get REDIS_URL 2>/dev/null || echo "ERROR")
if [[ "$REDIS_URL" =~ "redis://" ]]; then
    echo "   ✅ Configurado"
else
    echo "   ❌ NO CONFIGURADO O INVÁLIDO"
fi
echo ""

echo "=========================================="
echo "🌐 VERIFICANDO ENDPOINTS"
echo "=========================================="
echo ""

# Get domain
DOMAIN=$(railway domain 2>/dev/null || echo "")
if [ -z "$DOMAIN" ]; then
    echo "❌ No se pudo obtener el dominio"
    exit 1
fi

echo "🌍 Dominio: $DOMAIN"
echo ""

# Test /ready
echo "🏥 Testeando /ready..."
if curl -s -f "https://$DOMAIN/ready" > /dev/null; then
    echo "   ✅ Servidor respondiendo"
else
    echo "   ❌ Servidor NO responde"
fi
echo ""

# Test /health
echo "🏥 Testeando /health..."
HEALTH=$(curl -s "https://$DOMAIN/health")
echo "$HEALTH" | jq '.' 2>/dev/null || echo "   ⚠️  No se pudo parsear respuesta"
echo ""

# Test webhook verification
echo "🪝 Testeando webhook verification..."
if [ -n "$VERIFY_TOKEN" ] && [ "$VERIFY_TOKEN" != "ERROR" ]; then
    CHALLENGE=$(curl -s "https://$DOMAIN/webhook?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=test123")
    if [ "$CHALLENGE" == "test123" ]; then
        echo "   ✅ Webhook verificado correctamente"
    else
        echo "   ❌ Webhook falló verificación"
        echo "   Respuesta: $CHALLENGE"
    fi
else
    echo "   ⚠️  No se puede testear (WA_VERIFY_TOKEN no configurado)"
fi
echo ""

echo "=========================================="
echo "📋 LOGS RECIENTES (últimas 20 líneas)"
echo "=========================================="
echo ""
railway logs | tail -20
echo ""

echo "=========================================="
echo "✅ DIAGNÓSTICO COMPLETADO"
echo "=========================================="
echo ""
echo "📊 RESUMEN:"
echo "  - URL del proyecto: https://$DOMAIN"
echo "  - Webhook URL: https://$DOMAIN/webhook"
echo "  - Verify token: $VERIFY_TOKEN"
echo ""
echo "🔍 Para ver logs en tiempo real:"
echo "  railway logs --tail"
echo ""
