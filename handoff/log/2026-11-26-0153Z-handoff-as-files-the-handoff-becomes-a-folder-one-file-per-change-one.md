# The handoff becomes a folder: one file per change, one state file per area

- Date: 2026-11-26 01:53 UTC
- Area: repo
- Branch: claude/handoff-as-files

HANDOFF.md was one file every session appended to, so each merged pull request made every other open one conflict there and run CI again (20 were stuck on 2026-11-25; PRs 109, 132 and 136 each had to combine several to get them in). The owner asked for a setup that stops it.

What changed:
- HANDOFF.md is a pointer. Its sections 1 to 8 and 11 are handoff/guide.md (numbers kept); sections 9, 10 and 12 are frozen in handoff/archive/ as they stood.
- handoff/state/<area>.md: ten short files (release, web, backend, mac, ios, android, windows, linux, server, repo), seeded from the newest entries of the old file. Each area's session should check and rewrite its own.
- handoff/log/: one file per change, made by scripts/handoff.mjs log.
- scripts/handoff.mjs: show, log, areas, check. CI's first step runs check, which fails when HANDOFF.md is not exactly the pointer, or a state or log file is malformed.
- CLAUDE.md, the guide's section 8 and docs/claude-context/memory tell sessions the new rule. .gitleaks.toml skips handoff/archive/ (moved text, scanned before).

Checked: node scripts/handoff.mjs check, show, log and areas by hand; apps/web/test/handoff.test.ts (5 tests).

Left: each area's session reviews its state file. A branch older than this that added to HANDOFF.md will conflict there once: take main's HANDOFF.md and move the additions into a log entry (handoff/README.md).
