# CI is faster: end-to-end starts with lint, and is skipped when nothing it reads changed

- Date: 2026-11-28 06:02 UTC
- Area: repo
- Branch: claude/ci-speedup

The owner asked in the PR manager session why merging takes so long ("It takes forever") and said "Yes, speed up CI" to two changes. Measured on PR 195's run: 36 minutes, 10 for the lint job and up to 25 for the eight end-to-end shards, which waited for lint to finish.

What changed in .github/workflows/ci.yml:
- A new job, "What changed" (scope), runs scripts/ci-scope.mjs on the pull request's changed files (git diff --name-only HEAD^1 HEAD on the merge commit) and gives e2e=true or e2e=false.
- The end-to-end jobs need scope instead of the lint job, so they start at once: about 26 minutes for a pull request instead of 36. When lint fails the shards still run and report, which costs runner time and saves a round trip.
- When scope says false, every step of the nine end-to-end jobs (eight shards and the production build) is skipped and each job reports success in seconds under its usual name, so the twelve required checks and branch protection are untouched. Anything other than an explicit false runs the suite: a failed diff, an empty diff, a push to main.

What skips: handoff/, docs/, apps/mac, apps/ios, apps/native-kit, apps/android, apps/desktop, apps/mobile, a Markdown file at the top of the repository, version.json, CHANGELOG.json and CHANGELOG.md. Checked before choosing them: the suite and the web app import nothing from those folders (the references are comments); apps/web/src/lib/version.ts imports version.json, as text to show, and the web build in the lint job still compiles with it. apps/clipper is not on the list because e2e/web-clipper.spec.ts loads it, and scripts/ and .github/ are not on it either.

Tests: apps/web/test/ci-scope.test.ts, 8 tests, pass; it also fails if a folder on the list stops existing (it caught graphify-out/, which is not in the repository). eslint and tsc clean on it. The workflow file parses and every end-to-end step carries the condition.

Not proven by this pull request: the skip path, because this pull request changes ci.yml and scripts/ and so runs the whole suite. The first pull request after it that touches only listed files shows it (the handoff record for Mac 1.9.81).

A pull request that skips has had no automated test of its Swift, Kotlin or Rust: CI never built those, and that is unchanged.
