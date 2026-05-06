#!/bin/bash

# Script para arreglar GOOGLE_PRIVATE_KEY
# Elimina saltos de línea reales y deja solo \n literales

set -e

echo "🔧 Arreglando GOOGLE_PRIVATE_KEY..."
echo ""

# Buscar el archivo de credenciales JSON de Google
echo "📁 Buscando archivo de credenciales de Google..."
CRED_FILE=""

# Buscar en ubicaciones comunes
if [ -f "/Users/osx/grupo-work-study/credentials.json" ]; then
    CRED_FILE="/Users/osx/grupo-work-study/credentials.json"
elif [ -f "/Users/osx/grupo-work-study/service-account.json" ]; then
    CRED_FILE="/Users/osx/grupo-work-study/service-account.json"
elif [ -f "/Users/osx/Downloads/travel-bot-*.json" ]; then
    CRED_FILE=$(ls -t /Users/osx/Downloads/travel-bot-*.json | head -1)
fi

if [ -z "$CRED_FILE" ]; then
    echo "❌ No se encontró el archivo JSON de credenciales de Google"
    echo ""
    echo "Por favor descarga el archivo JSON de credenciales desde:"
    echo "  https://console.cloud.google.com/iam-admin/serviceaccounts"
    echo ""
    echo "Y guárdalo como: /Users/osx/grupo-work-study/credentials.json"
    echo ""
    exit 1
fi

echo "✅ Encontrado: $CRED_FILE"
echo ""

# Extraer private_key del JSON y formatearla correctamente
echo "🔑 Extrayendo private_key del archivo JSON..."
PRIVATE_KEY=$(cat "$CRED_FILE" | jq -r '.private_key')

if [ -z "$PRIVATE_KEY" ] || [ "$PRIVATE_KEY" == "null" ]; then
    echo "❌ No se pudo extraer private_key del archivo JSON"
    exit 1
fi

echo "✅ Private key extraída correctamente"
echo ""

# Convertir saltos de línea reales a \n literales
PRIVATE_KEY_ESCAPED=$(echo "$PRIVATE_KEY" | sed 's/$/\\n/' | tr -d '\n' | sed 's/\\n$//')

echo "📏 Longitud de la clave: ${#PRIVATE_KEY_ESCAPED} caracteres"
echo ""

# Mostrar preview
echo "📝 Preview (primeros 100 caracteres):"
echo "${PRIVATE_KEY_ESCAPED:0:100}..."
echo ""

# Actualizar .env local
echo "💾 Actualizando .env local..."
ENV_FILE="/Users/osx/grupo-work-study/.env"

# Backup del .env actual
cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%s)"
echo "✅ Backup creado: ${ENV_FILE}.backup.$(date +%s)"

# Reemplazar GOOGLE_PRIVATE_KEY en .env
# Primero eliminar la línea actual (puede estar en múltiples líneas)
sed -i '' '/^GOOGLE_PRIVATE_KEY=/,/^[A-Z_]*=/{ /^GOOGLE_PRIVATE_KEY=/!{ /^[A-Z_]*=/!d; }; }' "$ENV_FILE"
sed -i '' '/^GOOGLE_PRIVATE_KEY=/d' "$ENV_FILE"

# Agregar la nueva clave correctamente formateada
echo "GOOGLE_PRIVATE_KEY=\"$PRIVATE_KEY_ESCAPED\"" >> "$ENV_FILE"

echo "✅ .env local actualizado"
echo ""

# Actualizar Railway
echo "🚂 Actualizando Railway..."
if ! railway whoami &>/dev/null; then
    echo "⚠️  No estás autenticado en Railway"
    echo ""
    echo "Para actualizar Railway manualmente:"
    echo "  1. railway login"
    echo "  2. railway variables set GOOGLE_PRIVATE_KEY=\"$PRIVATE_KEY_ESCAPED\""
    echo ""
else
    railway variables set GOOGLE_PRIVATE_KEY="$PRIVATE_KEY_ESCAPED"
    echo "✅ Railway actualizado"
    echo ""
    echo "⏳ Railway redeployará automáticamente en 1-2 minutos"
fi

echo ""
echo "=========================================="
echo "✅ GOOGLE_PRIVATE_KEY ARREGLADA"
echo "=========================================="
echo ""
echo "📋 Próximos pasos:"
echo "  1. Espera 1-2 minutos a que Railway redeploy"
echo "  2. Envía un mensaje de WhatsApp de prueba"
echo "  3. Verifica logs con: railway logs --tail"
echo ""
