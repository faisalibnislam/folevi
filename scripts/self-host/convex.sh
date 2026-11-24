#!/usr/bin/env bash
# Runs a Convex CLI command against the self-hosted backend, reading the admin key from $DATA/secrets
# (never printed). Example: DATA=... scripts/self-host/convex.sh env list
# Never pass --prod: there is no cloud deployment involved.
set -euo pipefail
: "${DATA:?set DATA to the data folder used by start-backend.sh}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export CONVEX_SELF_HOSTED_URL="${CONVEX_URL:-http://127.0.0.1:3510}"
CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat "$DATA/secrets/admin_key")"
export CONVEX_SELF_HOSTED_ADMIN_KEY
unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY
for a in "$@"; do [ "$a" = "--prod" ] && { echo "refusing --prod" >&2; exit 1; }; done
cd "$ROOT"
exec npx convex "$@"
