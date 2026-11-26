# Flaky tests and the Vercel skip rule written into the repo state

- Date: 2026-11-26 10:06 UTC
- Area: repo
- Branch: claude/flaky-tests-record

`handoff/state/repo.md` now lists the tests that failed on 2026-11-25 and 2026-11-26 on changes that did not touch them and passed on a second run (`tab-switch`, `places-move`, `vault-team`, `e2ee-approve`, `folder-drag`, `stickies` on the iPhone project, and vitest's teardown error in the Convex test step), with the rule the manager session uses: run the failed shard again once, and treat a second failure on the same change as real. It also says what Vercel's Ignored Build Step watches (PR 152 added `version.json`) and that PR 145 added 72 lines to the frozen `HANDOFF.md` before the freeze check existed.

Checked: `node scripts/handoff.mjs check`. Words only, no code.

Left: nobody has looked into why these tests are flaky.

Made by the PR, merge and CI manager session.
