#!/usr/bin/env bash
# Phase 0 spike: deploy Folevi's Convex functions (and the Better Auth component) to a self-hosted backend
# started by start-backend.sh, and set the backend's environment. Never uses --prod; nothing here reaches
# Convex Cloud. Secrets are generated once into $DATA/secrets/folevi.env (mode 600) and never printed.
#
#   DATA=/path/to/folevi-data APP_URL=http://localhost:3500 scripts/self-host/deploy.sh
#
# Optional: CONVEX_URL (http://127.0.0.1:3510), SKIP_ENV=1 (deploy only).
set -euo pipefail
: "${DATA:?set DATA to the data folder used by start-backend.sh}"
: "${APP_URL:?set APP_URL to the web app origin the browser uses}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export CONVEX_SELF_HOSTED_URL="${CONVEX_URL:-http://127.0.0.1:3510}"
CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat "$DATA/secrets/admin_key")"
export CONVEX_SELF_HOSTED_ADMIN_KEY
# A stray CONVEX_DEPLOYMENT (cloud) would make the CLI refuse or pick the wrong target.
unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY

ENV_FILE="$DATA/secrets/folevi.env"
if [ ! -s "$ENV_FILE" ]; then
  (
    umask 077
    {
      echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
      echo "FOLEVI_HASH_SALT=$(openssl rand -hex 16)"
      echo "FOLEVI_FILE_URL_SECRET=$(openssl rand -hex 32)"
      echo "FOLEVI_SERVER_SECRET=$(openssl rand -hex 32)"
    } > "$ENV_FILE"
  )
fi

cd "$ROOT"
if [ "${SKIP_ENV:-}" != "1" ]; then
  set_env() { npx convex env set "$1" "$2" > /dev/null; echo "set $1"; }
  set_env FOLEVI_ENV production
  set_env SITE_URL "$APP_URL"
  set_env FOLEVI_APP_URL "$APP_URL"
  # No email provider on this server: let people sign in without confirming their address.
  set_env FOLEVI_REQUIRE_VERIFIED_EMAIL false
  while IFS= read -r line; do
    [ -n "$line" ] && set_env "${line%%=*}" "${line#*=}"
  done < "$ENV_FILE"
fi

npx convex deploy --yes --typecheck=disable
