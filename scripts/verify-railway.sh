#!/bin/bash

# Script de verificación rápida para Railway
# Autor: Claude
# Uso: ./scripts/verify-railway.sh

set -e

echo "🔍 Verificando configuración de Railway..."
echo ""

# Verificar Railway CLI
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI no está instalado"
    echo "   Instala con: npm i -g @railway/cli"
    exit 1
fi

echo "✅ Railway CLI instalado"
echo ""

# Login check
echo "🔐 Verificando autenticación..."
if ! railway whoami &> /dev/null; then
    echo "❌ No estás autenticado en Railway"
    echo "   Ejecuta: railway login"
    exit 1
fi

echo "✅ Autenticado en Railway"
echo ""

# Get project info
echo "📦 Información del proyecto:"
railway status
echo ""

# Get URL
echo "🌐 Obteniendo URL del proyecto..."
URL=$(railway domain)
if [ -z "$URL" ]; then
    echo "❌ No se pudo obtener la URL del proyecto"
    echo "   Verifica que el proyecto tenga un dominio asignado en Railway Dashboard"
    exit 1
fi

echo "✅ URL del proyecto: $URL"
echo ""

# Test /ready endpoint
echo "🏥 Verificando endpoint /ready..."
if curl -s -f "https://$URL/ready" > /dev/null; then
    echo "✅ Servidor está respondiendo"
    curl -s "https://$URL/ready" | jq
else
    echo "❌ Servidor no responde"
    echo "   Verifica los logs con: railway logs"
    exit 1
fi
echo ""

# Test /health endpoint
echo "🏥 Verificando endpoint /health..."
if curl -s -f "https://$URL/health" > /dev/null; then
    echo "✅ Health check pasó"
    curl -s "https://$URL/health" | jq
else
    echo "⚠️  Health check falló (esto puede ser normal si DB/Redis no están listos)"
    curl -s "https://$URL/health" | jq
fi
echo ""

# Check GOOGLE_PRIVATE_KEY format
echo "🔑 Verificando formato de GOOGLE_PRIVATE_KEY..."
PRIVATE_KEY=$(railway variables get GOOGLE_PRIVATE_KEY 2>/dev/null || echo "")

if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ GOOGLE_PRIVATE_KEY no está configurada"
    exit 1
fi

if [[ "$PRIVATE_KEY" == *"\\n"* ]]; then
    echo "✅ GOOGLE_PRIVATE_KEY tiene formato correcto (con \\n literales)"
elif [[ "$PRIVATE_KEY" == *$'\n'* ]]; then
    echo "❌ GOOGLE_PRIVATE_KEY tiene saltos de línea reales en lugar de \\n"
    echo "   Necesitas reconfigurarla con \\n como string literal"
    echo ""
    echo "   Ejemplo correcto:"
    echo '   railway variables set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"'
    exit 1
else
    echo "⚠️  No se pudo verificar el formato de GOOGLE_PRIVATE_KEY"
fi
echo ""

# Webhook verification URL
echo "🪝 URL del Webhook para Meta:"
echo "   https://$URL/webhook"
echo ""
echo "   Configura en: https://developers.facebook.com/apps"
echo "   → WhatsApp → Configuration → Webhook"
echo ""

# Get verify token
VERIFY_TOKEN=$(railway variables get WA_VERIFY_TOKEN 2>/dev/null || echo "")
if [ -n "$VERIFY_TOKEN" ]; then
    echo "🔐 Token de verificación configurado: $VERIFY_TOKEN"
    echo ""

    # Test webhook verification
    echo "🧪 Probando verificación del webhook..."
    CHALLENGE=$(curl -s "https://$URL/webhook?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=test123")

    if [ "$CHALLENGE" == "test123" ]; then
        echo "✅ Webhook verificado correctamente"
    else
        echo "❌ Webhook no se verificó"
        echo "   Respuesta: $CHALLENGE"
    fi
else
    echo "⚠️  WA_VERIFY_TOKEN no está configurada"
fi
echo ""

echo "✅ Verificación completada"
echo ""
echo "📋 Próximos pasos:"
echo "   1. Copia la URL del webhook: https://$URL/webhook"
echo "   2. Configúrala en Meta Developer Console"
echo "   3. Verifica con Meta usando el token: $VERIFY_TOKEN"
echo "   4. Envía un mensaje de prueba al número de WhatsApp"
echo "   5. Verifica logs con: railway logs --tail"
