---
name: other-sessions-share-this-repo
description: "Other Claude sessions work in sibling worktrees of the same Folevi .git and can move local main, push it, and fast-forward my branch mid-release"
metadata:
  node_type: memory
  type: project
  originSessionId: 35e89241-b894-4220-9018-80cdbd58c6de
  modified: 2026-11-19T05:27:37.432Z
---

Seen on 2026-11-19 while releasing Mac 1.4.50 from the `mac-ui-audit` worktree: another session (the web copy pass, worktree `web-copy-humanize`) reset the local `main` branch to my branch tip, which held my unpushed "Release 1.4.50" commit, merged its own work on top, pushed `main` and my `v1.4.50` tag to GitHub, then fast-forwarded my branch inside my worktree, all while my `publish.mjs` run was still building. The published build was not affected only because its web export, archive and DMG were finished a few minutes before my working tree changed.

**Why:** all sessions' worktrees share one `.git` under `/Volumes/Corsair/Github External/Airly Studio External/folevi`, so branches, tags and the stash are common, and a local commit on my branch is visible to them at once.

**How to apply:** during a release, record `git rev-parse HEAD` before starting `publish.mjs`, and when it finishes compare HEAD, `git reflog -5`, `git ls-remote origin refs/heads/main` and the tag before pushing anything or telling the owner who pushed. Check the build's file times against any HEAD move. Say plainly in the report when another session did the push. Related: [[forward-mac-ui-improvements-to-web-session]].
