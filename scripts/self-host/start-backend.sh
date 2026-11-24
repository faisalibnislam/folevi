#!/usr/bin/env bash
# Phase 0 spike: run Convex's ready-made backend program on its own, the way a NAS service would
# (no Docker, no `convex dev`). Secrets are generated once into $DATA/secrets and never printed.
#
#   DATA=/path/to/folevi-data BACKEND=/path/to/convex-local-backend scripts/self-host/start-backend.sh
#
# Optional: PORT (3510), SITE_PORT (3511), BIND (127.0.0.1), CLOUD_ORIGIN, SITE_ORIGIN, INSTANCE_NAME.
set -euo pipefail
: "${DATA:?set DATA to the data folder}"
: "${BACKEND:?set BACKEND to the convex-local-backend program}"
PORT="${PORT:-3510}"
SITE_PORT="${SITE_PORT:-3511}"
BIND="${BIND:-127.0.0.1}"
INSTANCE_NAME="${INSTANCE_NAME:-folevi-server}"
CLOUD_ORIGIN="${CLOUD_ORIGIN:-http://127.0.0.1:$PORT}"
SITE_ORIGIN="${SITE_ORIGIN:-http://127.0.0.1:$SITE_PORT}"

mkdir -p "$DATA/storage" "$DATA/secrets"
chmod 700 "$DATA/secrets"
if [ ! -s "$DATA/secrets/instance_secret" ]; then
  # 32 random bytes as 64 hex characters, the format the backend expects.
  (umask 077; openssl rand -hex 32 > "$DATA/secrets/instance_secret")
fi
SECRET="$(cat "$DATA/secrets/instance_secret")"
if [ ! -s "$DATA/secrets/admin_key" ]; then
  (umask 077; "$BACKEND" keygen admin-key --instance-name "$INSTANCE_NAME" --instance-secret "$SECRET" > "$DATA/secrets/admin_key")
fi

# Node actions ("use node", and the analyze step of every deploy) run in a `node` child process that the
# backend reaches over a Unix socket in $TMPDIR. Socket paths are limited to about 104 bytes, so a long
# TMPDIR makes every deploy fail ("listen EINVAL ... .executor.sock"). Keep it short. `node` must be on PATH.
export TMPDIR="${BACKEND_TMPDIR:-$DATA/tmp}"
mkdir -p "$TMPDIR"
if [ "${#TMPDIR}" -gt 80 ]; then
  echo "TMPDIR is ${#TMPDIR} characters; set BACKEND_TMPDIR to a shorter folder (node actions need a short socket path)." >&2
  exit 1
fi
command -v node > /dev/null || { echo "node is not on PATH (the backend runs node actions with it)." >&2; exit 1; }

cd "$DATA"
exec "$BACKEND" "$DATA/convex.sqlite3" \
  --db sqlite \
  --interface "$BIND" \
  --port "$PORT" \
  --site-proxy-port "$SITE_PORT" \
  --convex-origin "$CLOUD_ORIGIN" \
  --convex-site "$SITE_ORIGIN" \
  --instance-name "$INSTANCE_NAME" \
  --instance-secret "$SECRET" \
  --local-storage "$DATA/storage" \
  --disable-beacon \
  --redact-logs-to-client
