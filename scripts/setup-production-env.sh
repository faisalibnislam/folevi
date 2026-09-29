#!/usr/bin/env bash
# Sets Folevi's production secrets in Vercel and Convex. Run it yourself, once, from the repository root:
#
#   export CONVEX_DEPLOY_KEY='prod:…'     # Convex dashboard → your project → Settings → Deploy keys (Production)
#   bash scripts/setup-production-env.sh
#
# The random secrets (server secret, Better Auth secret, hash salt, file-URL secret) are generated here and
# go straight into Vercel and Convex. They are never printed, logged or written to a file. The script asks
# for your Mailtrap sending token and webhook signing secret, with hidden input. Keys you already have are left alone unless you pass --rotate.
# Rotating BETTER_AUTH_SECRET signs everyone out (see docs/AUTH_DECISION.md).
set -euo pipefail

APP_URL="https://app.folevi.com"
SCOPE="faisalibnislam"
PROJECT="folevi"
ROTATE="${1:-}"

if [[ -z "${CONVEX_DEPLOY_KEY:-}" || "${CONVEX_DEPLOY_KEY}" != prod:* ]]; then
  echo "Set CONVEX_DEPLOY_KEY to your Convex *production* deploy key first (it starts with 'prod:')." >&2
  exit 1
fi
if [[ "${CONVEX_DEPLOY_KEY}" == *"…"* || "${CONVEX_DEPLOY_KEY}" == *"your key"* || ${#CONVEX_DEPLOY_KEY} -lt 20 ]]; then
  echo "CONVEX_DEPLOY_KEY looks like the example placeholder. Paste your real production deploy key." >&2
  exit 1
fi
command -v vercel >/dev/null || { echo "Install the Vercel CLI first: npm i -g vercel" >&2; exit 1; }

# Check the key with Convex before changing anything anywhere.
if ! npx convex env list >/dev/null 2>&1; then
  echo "Convex didn't accept CONVEX_DEPLOY_KEY. In the Convex dashboard open your project → Settings →" >&2
  echo "URL & Deploy Key, generate a new *Production* deploy key, export it, and run this again." >&2
  exit 1
fi

random() { openssl rand -base64 32 | tr -d '\n'; }

vercel_has() { vercel env ls production --scope "$SCOPE" --project "$PROJECT" 2>/dev/null | grep -q "^ *$1 "; }
vercel_set() { # name value — Production only, value on stdin (never on the command line)
  if vercel_has "$1"; then
    [[ "$ROTATE" == "--rotate" ]] || { echo "Vercel $1 already set — kept."; return; }
    vercel env rm "$1" production --yes --scope "$SCOPE" --project "$PROJECT" >/dev/null
  fi
  printf '%s' "$2" | vercel env add "$1" production --sensitive --scope "$SCOPE" --project "$PROJECT" >/dev/null
  echo "Vercel $1 set."
}

# `convex env get` exits 0 even when a variable is missing (it prints "not found" to stderr), so "has" means
# it printed a value on stdout. The value itself is discarded.
convex_has() { [[ -n "$(npx convex env get "$1" 2>/dev/null)" ]]; }
convex_put() { # name value — always writes; stops the script if Convex refuses
  if ! npx convex env set "$1" "$2" >/dev/null 2>&1; then echo "Convex refused to set $1 — stopping." >&2; exit 1; fi
  echo "Convex $1 set."
}
convex_set() { # name value — keeps an existing value unless --rotate
  if convex_has "$1" && [[ "$ROTATE" != "--rotate" ]]; then echo "Convex $1 already set — kept."; return; fi
  convex_put "$1" "$2"
}

echo "Vercel project $SCOPE/$PROJECT, Convex production deployment from CONVEX_DEPLOY_KEY."

# Plain settings.
convex_put FOLEVI_ENV production
convex_put FOLEVI_APP_URL "$APP_URL"
convex_put SITE_URL "$APP_URL"

# Shared between Vercel and Convex: one value, set on both.
if vercel_has FOLEVI_SERVER_SECRET && convex_has FOLEVI_SERVER_SECRET && [[ "$ROTATE" != "--rotate" ]]; then
  echo "FOLEVI_SERVER_SECRET already set on both — kept."
else
  shared="$(random)"
  convex_put FOLEVI_SERVER_SECRET "$shared"
  ROTATE="--rotate" vercel_set FOLEVI_SERVER_SECRET "$shared"
  unset shared
fi

# Convex-only secrets.
convex_set BETTER_AUTH_SECRET "$(random)"
convex_set FOLEVI_HASH_SALT "$(random)"
convex_set FOLEVI_FILE_URL_SECRET "$(random)"

# The deploy key itself, for Vercel's build (it runs `npx convex deploy`).
vercel_set CONVEX_DEPLOY_KEY "$CONVEX_DEPLOY_KEY"

# Mailtrap (transactional email; docs/EMAIL_OPERATIONS.md). Hidden input; skip with Enter and add it later.
if ! convex_has MAILTRAP_API_TOKEN || [[ "$ROTATE" == "--rotate" ]]; then
  read -r -s -p "Mailtrap sending API token (hidden; Enter to skip): " mailtrap; echo
  if [[ -n "$mailtrap" ]]; then convex_put MAILTRAP_API_TOKEN "$mailtrap"; fi
  unset mailtrap
fi
if ! convex_has MAILTRAP_WEBHOOK_SECRET || [[ "$ROTATE" == "--rotate" ]]; then
  read -r -s -p "Mailtrap webhook signing secret (hidden; Enter to skip): " mtsecret; echo
  if [[ -n "$mtsecret" ]]; then convex_put MAILTRAP_WEBHOOK_SECRET "$mtsecret"; fi
  unset mtsecret
fi

echo
echo "Done. Still yours to add when ready (Convex, with: npx convex env set NAME value):"
echo "  GEMINI_API_KEY (AI), STRIPE_* (payments), EMAIL_REPLY_TO (optional monitored Reply-To)."
echo "Then redeploy: vercel redeploy --prod --scope $SCOPE, or push a commit."
