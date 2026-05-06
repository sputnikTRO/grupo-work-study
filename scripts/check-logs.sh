#!/bin/bash

# Script para revisar logs de Railway
# Ejecuta esto manualmente

echo "🔑 Paso 1: Login en Railway"
echo "Ejecutando: railway login"
railway login

echo ""
echo "🔗 Paso 2: Verificar proyecto vinculado"
railway whoami
railway status

echo ""
echo "📋 Paso 3: Ver logs recientes"
echo "Mostrando últimos 50 logs..."
railway logs

echo ""
echo "🔄 Paso 4: Logs en tiempo real"
echo "Presiona Ctrl+C para salir"
echo ""
railway logs --tail
