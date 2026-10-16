#!/usr/bin/env bash
# Vercel's Ignored Build Step for apps/web (apps/web/vercel.json runs this from apps/web). Exit 0 skips the
# build, 1 builds, and any other answer fails the deployment, so every error means build. Previews are
# always skipped; a production push builds when something the web app or Convex depends on changed since
# the last production deploy (or when that commit isn't in Vercel's shallow clone).
[ "$VERCEL_ENV" != "production" ] && exit 0
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- . ../../packages ../../convex ../../scripts ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../turbo.json ../../tsconfig.base.json 2>/dev/null && exit 0
exit 1
