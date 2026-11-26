#!/usr/bin/env bash
# Vercel's Ignored Build Step for apps/web (apps/web/vercel.json runs this from apps/web). Exit 0 skips the
# build, 1 builds, and any other answer fails the deployment, so every error means build. Previews are
# always skipped; a production push builds when something the web app or Convex depends on changed since
# the last production deploy (or when that commit isn't in Vercel's shallow clone).
# version.json is one of those: the web app shows the version (apps/web/src/lib/version.ts imports it), and a release
# commit changes little else, so without it the site kept the old number until the next web change.
[ "$VERCEL_ENV" != "production" ] && exit 0
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- . ../../packages ../../convex ../../scripts ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../turbo.json ../../tsconfig.base.json ../../version.json 2>/dev/null && exit 0
exit 1
