#!/usr/bin/env python3
"""
Script para arreglar GOOGLE_PRIVATE_KEY
Extrae la clave del archivo JSON y la formatea correctamente
"""

import json
import os
import sys
from pathlib import Path

# Buscar archivo JSON de credenciales
cred_paths = [
    "/Users/osx/Downloads/travel-bot-490001-87277723ef2f.json",
    "/Users/osx/grupo-work-study/credentials.json",
    "/Users/osx/grupo-work-study/service-account.json",
]

cred_file = None
for path in cred_paths:
    if os.path.exists(path):
        cred_file = path
        break

if not cred_file:
    print("❌ No se encontró el archivo JSON de credenciales")
    print("\nDescárgalo desde:")
    print("  https://console.cloud.google.com/iam-admin/serviceaccounts")
    sys.exit(1)

print(f"✅ Encontrado: {cred_file}\n")

# Leer y parsear JSON
with open(cred_file, 'r') as f:
    creds = json.load(f)

if 'private_key' not in creds:
    print("❌ No se encontró 'private_key' en el archivo JSON")
    sys.exit(1)

# La private key ya tiene saltos de línea reales
# Necesitamos convertirlos a \n literales para .env
private_key = creds['private_key']

# Convertir saltos de línea reales a \n literales (para .env)
private_key_escaped = private_key.replace('\n', '\\n')

print(f"📏 Longitud: {len(private_key_escaped)} caracteres")
print(f"📝 Preview: {private_key_escaped[:100]}...\n")

# Actualizar .env local
env_file = "/Users/osx/grupo-work-study/.env"
backup_file = f"{env_file}.backup"

print(f"💾 Actualizando {env_file}...")

# Leer .env actual
with open(env_file, 'r') as f:
    lines = f.readlines()

# Hacer backup
with open(backup_file, 'w') as f:
    f.writelines(lines)
print(f"✅ Backup creado: {backup_file}")

# Encontrar y reemplazar GOOGLE_PRIVATE_KEY
new_lines = []
skip_until_next_var = False
found = False

for line in lines:
    if line.startswith('GOOGLE_PRIVATE_KEY='):
        # Reemplazar con la nueva clave correcta
        new_lines.append(f'GOOGLE_PRIVATE_KEY="{private_key_escaped}"\n')
        found = True
        skip_until_next_var = True
    elif skip_until_next_var:
        # Si la línea anterior era GOOGLE_PRIVATE_KEY,
        # saltar líneas hasta encontrar otra variable o línea vacía
        if line.strip() and not line.startswith('#') and '=' in line:
            # Nueva variable encontrada
            skip_until_next_var = False
            new_lines.append(line)
        # Si es una línea vacía o comentario, también agregarla
        elif not line.strip() or line.startswith('#'):
            new_lines.append(line)
    else:
        new_lines.append(line)

# Si no se encontró, agregarla al final de la sección de Google Sheets
if not found:
    print("⚠️  GOOGLE_PRIVATE_KEY no encontrada, agregándola...")
    new_lines.append(f'GOOGLE_PRIVATE_KEY="{private_key_escaped}"\n')

# Escribir .env actualizado
with open(env_file, 'w') as f:
    f.writelines(new_lines)

print("✅ .env actualizado correctamente\n")

# Imprimir comando para actualizar Railway
print("=" * 50)
print("🚂 ACTUALIZAR RAILWAY:")
print("=" * 50)
print("\nEjecuta estos comandos:\n")
print("railway login")
print(f'railway variables set GOOGLE_PRIVATE_KEY="{private_key_escaped}"')
print("\n⏳ Railway redeployará automáticamente en 1-2 minutos\n")

# Guardar en archivo temporal para Railway
temp_file = "/tmp/railway_google_key.txt"
with open(temp_file, 'w') as f:
    f.write(private_key_escaped)
print(f"💾 Clave guardada temporalmente en: {temp_file}")
print(f"   Puedes usarla con: railway variables set GOOGLE_PRIVATE_KEY=\"$(cat {temp_file})\"\n")

print("=" * 50)
print("✅ PROCESO COMPLETADO")
print("=" * 50)
