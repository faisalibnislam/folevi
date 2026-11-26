# One session manages pull requests, merging and CI

- Date: 2026-11-26 05:54 UTC
- Area: repo
- Branch: claude/pr-manager-rule

The owner made the session "Folevi PR, merge and CI manager" (local_c35f3572-0bc6-4217-9c6d-dcf1ccd0c73c) the manager for pull requests, merging and CI: other sessions message it for conflicts, CI trouble outside their change, and releases, instead of merging main into each other's branches.

What changed: docs/claude-context/memory/pr-merge-ci-manager-2026-11-26.md (the rule and how to message the session), a paragraph in CLAUDE.md, and the first line of handoff/state/repo.md.

Checked: node scripts/handoff.mjs check --base origin/main.

Left: Folevi Main passes the rule to the sessions that are already running (they read CLAUDE.md only when they start).
