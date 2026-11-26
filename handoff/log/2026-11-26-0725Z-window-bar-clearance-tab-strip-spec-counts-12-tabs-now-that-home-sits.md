# Tab strip spec counts 12 tabs now that Home sits outside the strip

- Date: 2026-11-26 07:25 UTC
- Area: web
- Branch: claude/window-bar-clearance

PR 137 moved the Home button out of the scrolling tab strip (the "Open pages" navigation), so the strip holds 12 links at its cap, not 13. `apps/web/e2e/tab-strip-overflow.spec.ts` still waited for 13 on line 77 and failed in CI shard 7/8 (run 45763585632). The line now expects 12. The other count in the same file was already updated by the pull request, and the rest of the test reads tabs by `[data-tab]`, which Home never had.

Checked: by reading the spec and `TabStrip.tsx`; not run on this Mac (ports 3000 and 3210 were in use by another session), so CI on this push is the check.

Also seen in that run: `folder-drag.spec.ts` failed in shard 4/8, at a different step on its retry (a moved note not listed on the folder page within 10 s). Nothing in this pull request touches dragging or folder pages and the spec passes on main, so it is treated as flaky; if it fails again on this branch it needs a real look.

Made by the PR, merge and CI manager session.
