#!/usr/bin/env bash
#
# Sets the Oxford Education (Fase 3) environment variables in Railway.
#
# Prerequisites:
#   1. railway login
#   2. railway link            # select the grupo-work-study project + service
#   3. Put the REAL values in your local .env first (this script reads them from there),
#      especially a NON-EXPIRED OXED_ACCESS_TOKEN (permanent / system-user token).
#
# Usage:
#   bash scripts/set-oxford-railway-env.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Create it with the OXED_* values first." >&2
  exit 1
fi

# Load OXED_* values from .env
set -a
# shellcheck disable=SC1091
source .env
set +a

for var in OXED_PHONE_NUMBER_ID OXED_WABA_ID OXED_ACCESS_TOKEN OXED_VERIFY_TOKEN; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is empty in .env" >&2
    exit 1
  fi
done

echo "Setting Oxford Education variables in Railway..."
railway variables \
  --set "OXED_PHONE_NUMBER_ID=${OXED_PHONE_NUMBER_ID}" \
  --set "OXED_WABA_ID=${OXED_WABA_ID}" \
  --set "OXED_ACCESS_TOKEN=${OXED_ACCESS_TOKEN}" \
  --set "OXED_VERIFY_TOKEN=${OXED_VERIFY_TOKEN}"

echo "Done. Trigger a redeploy so the new variables take effect:"
echo "  railway up        # or push to the connected GitHub branch"
