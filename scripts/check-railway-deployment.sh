#!/bin/bash

echo ""
echo "🚂 Verificando Deployment de Railway..."
echo "=========================================="
echo ""

# Check if the server is running
echo "1️⃣ Verificando que el servidor esté corriendo..."
health_status=$(curl -s https://grupo-work-study-production.up.railway.app/health | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

if [ "$health_status" = "ok" ]; then
    echo "   ✅ Servidor corriendo correctamente"
else
    echo "   ❌ Error: Servidor no responde correctamente"
    exit 1
fi

echo ""
echo "2️⃣ Verificando último commit en GitHub..."
latest_commit=$(git log -1 --format="%h - %s")
echo "   📝 Último commit local: $latest_commit"

echo ""
echo "3️⃣ Verificando si Info_Viajes está en el código..."
if grep -q "Info_Viajes" src/core/sheets/cache.js; then
    echo "   ✅ Info_Viajes encontrado en cache.js"
else
    echo "   ❌ Info_Viajes NO encontrado en cache.js"
    exit 1
fi

echo ""
echo "4️⃣ Recomendación:"
echo "   🔄 Para asegurar que Railway tenga el código más reciente:"
echo "   "
echo "   Opción 1 (Automático):"
echo "   - Railway debería auto-desplegar desde GitHub"
echo "   - Espera 2-3 minutos después del push"
echo "   "
echo "   Opción 2 (Manual):"
echo "   - Ve a Railway dashboard"
echo "   - Selecciona el servicio 'grupo-work-study'"
echo "   - Click en 'Deploy' → 'Redeploy'"
echo "   "
echo "   Opción 3 (Forzar):"
echo "   - Haz un cambio mínimo y push para forzar deploy"
echo ""

echo "5️⃣ Una vez desplegado, el bot sincronizará Info_Viajes automáticamente cada 5 minutos"
echo "   O reinicia el servicio para sincronización inmediata"
echo ""
