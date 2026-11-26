# The handoff becomes a folder: one file per change, one state file per area

- Date: 2026-11-26 01:53 UTC
- Area: repo
- Branch: claude/handoff-as-files

HANDOFF.md was one file every session appended to, so each merged pull request made every other open one conflict there and run CI again (20 were stuck on 2026-11-25; PRs 109, 132 and 136 each had to combine several to get them in). The owner asked for a setup that stops it.

What changed:
- handoff/guide.md: HANDOFF.md's sections 1 to 8 and 11 (numbers kept). handoff/archive/: a copy of its sections 9, 10 and 12 as they stood.
- handoff/state/<area>.md: ten short files (release, web, backend, mac, ios, android, windows, linux, server, repo), seeded from the newest entries of the old file. Each area's session should check and rewrite its own.
- handoff/log/: one file per change, made by scripts/handoff.mjs log.
- scripts/handoff.mjs: show, log, areas, check. On a pull request CI's first step runs check --base HEAD^1, which fails when HANDOFF.md differs from main's, or a state or log file is malformed.
- HANDOFF.md itself is NOT changed here. The first version of this change (PR 142 as first pushed) replaced it with a pointer, passed all 12 checks, and then could not merge because PR 144 had added to the file meanwhile. So the file is frozen in place instead, and becomes the pointer later (handoff/state/repo.md, next steps).
- CLAUDE.md, the guide's section 8 and docs/claude-context/memory tell sessions the new rule. .gitleaks.toml skips handoff/archive/ (moved text, scanned before).

Checked: node scripts/handoff.mjs check with and without --base (it refuses a one-character change to HANDOFF.md), show, log and areas by hand; apps/web/test/handoff.test.ts.

Left: each area's session reviews its state file. A branch that added to HANDOFF.md fails CI's first step from now on: take main's HANDOFF.md and move the additions into a log entry (handoff/README.md). Then the pointer swap.
