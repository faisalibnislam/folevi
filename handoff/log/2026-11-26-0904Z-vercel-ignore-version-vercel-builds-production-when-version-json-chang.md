# Vercel builds production when version.json changes

- Date: 2026-11-26 09:04 UTC
- Area: release, repo
- Branch: claude/vercel-ignore-version

The 1.8.78 release commit (PR 150, merge 73d949ec) reached main at 08:53 UTC on 2026-11-26 and Vercel answered "Canceled by Ignored Build Step": `scripts/vercel-ignore.sh` only built when `apps/web`, `packages`, `convex`, `scripts` or the root package files changed, and a release commit changes `version.json`, the changelog and the native projects. So production kept the build of ba843571, which has all of 1.8.78's code but shows 1.7.78 as its version (`apps/web/src/lib/version.ts` imports `version.json`). The 1.7.78 release commit (PR 131) had the same shape.

The script now also watches `version.json`. `CHANGELOG.json` is not added: nothing in `apps/web` or `convex` imports it.

Checked: `bash -n`; run from `apps/web` with `VERCEL_ENV=production VERCEL_GIT_PREVIOUS_SHA=ba843571` on main at 73d949ec it exits 1 (build), and with `VERCEL_ENV=preview` it exits 0 (skip). This pull request changes `scripts/`, so its own merge builds production with 1.8.78.

Left: confirm after the merge that Vercel's status on the merge commit is a real deployment, not a skip.

Made by the PR, merge and CI manager session.
