#!/usr/bin/env bash
# Sets Folevi's production secrets in Vercel and Convex. Run it yourself, once, from the repository root:
#
#   export CONVEX_DEPLOY_KEY='prod:…'     # Convex dashboard → your project → Settings → Deploy keys (Production)
#   bash scripts/setup-production-env.sh
#
# The random secrets (server secret, Better Auth secret, hash salt, file-URL secret) are generated here and
# go straight into Vercel and Convex. They are never printed, logged or written to a file. The script asks
# for your Loops API key, with hidden input. Keys you already have are left alone unless you pass --rotate.
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
command -v vercel >/dev/null || { echo "Install the Vercel CLI first: npm i -g vercel" >&2; exit 1; }

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

convex_has() { npx convex env get "$1" >/dev/null 2>&1; }
convex_set() { # name value
  if convex_has "$1" && [[ "$ROTATE" != "--rotate" ]]; then echo "Convex $1 already set — kept."; return; fi
  npx convex env set "$1" "$2" >/dev/null
  echo "Convex $1 set."
}

echo "Vercel project $SCOPE/$PROJECT, Convex production deployment from CONVEX_DEPLOY_KEY."

# Plain settings.
npx convex env set FOLEVI_ENV production >/dev/null && echo "Convex FOLEVI_ENV set."
npx convex env set FOLEVI_APP_URL "$APP_URL" >/dev/null && echo "Convex FOLEVI_APP_URL set."
npx convex env set SITE_URL "$APP_URL" >/dev/null && echo "Convex SITE_URL set."

# Shared between Vercel and Convex: one value, set on both.
if vercel_has FOLEVI_SERVER_SECRET && convex_has FOLEVI_SERVER_SECRET && [[ "$ROTATE" != "--rotate" ]]; then
  echo "FOLEVI_SERVER_SECRET already set on both — kept."
else
  shared="$(random)"
  ROTATE="--rotate" vercel_set FOLEVI_SERVER_SECRET "$shared"
  npx convex env set FOLEVI_SERVER_SECRET "$shared" >/dev/null && echo "Convex FOLEVI_SERVER_SECRET set."
  unset shared
fi

# Convex-only secrets.
convex_set BETTER_AUTH_SECRET "$(random)"
convex_set FOLEVI_HASH_SALT "$(random)"
convex_set FOLEVI_FILE_URL_SECRET "$(random)"

# The deploy key itself, for Vercel's build (it runs `npx convex deploy`).
vercel_set CONVEX_DEPLOY_KEY "$CONVEX_DEPLOY_KEY"

# Loops (transactional email). Hidden input; skip with Enter and add it later.
if ! convex_has LOOPS_API_KEY || [[ "$ROTATE" == "--rotate" ]]; then
  read -r -s -p "Loops API key (hidden; Enter to skip): " loops; echo
  if [[ -n "$loops" ]]; then npx convex env set LOOPS_API_KEY "$loops" >/dev/null && echo "Convex LOOPS_API_KEY set."; fi
  unset loops
fi

echo
echo "Done. Still yours to add when ready (Convex, with: npx convex env set NAME value):"
echo "  GEMINI_API_KEY (AI), STRIPE_* (payments), LOOPS_TRANSACTIONAL_*_ID (email templates)."
echo "Then redeploy: vercel redeploy --prod --scope $SCOPE, or push a commit."
