# Repository, CI and how pull requests land

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- **One session manages pull requests, merging and CI** (the owner, 2026-11-26): "Folevi PR, merge and CI manager", `local_c35f3572-0bc6-4217-9c6d-dcf1ccd0c73c`. Other sessions message it for conflicts, CI trouble outside their change, and releases; they don't merge `main` into each other's branches (`docs/claude-context/memory/pr-merge-ci-manager-2026-11-26.md`).
- `main` is protected: 12 required checks (lint and tests, clipper, secret scan, e2e 1/8 to 8/8, production e2e); no reviews; a merge to `main` deploys production. Sessions may merge their own green pull requests (GitHub auto-merge, merge commits; never `--admin`).
- The handoff is the `handoff/` folder since 2026-11-26. `HANDOFF.md` is frozen: on a pull request CI's first step fails when the file differs from main's (`node scripts/handoff.mjs check --base HEAD^1`). It still holds the old text; the only change the check allows is replacing it with the pointer in `scripts/handoff.mjs`.
- When several pull requests are open and conflict, land them through one integration branch (merge each head, resolve once, one CI run); `gh pr merge <n> --disable-auto` keeps them from landing piecemeal. PRs 109, 132 and 136 were done that way. A pull request that edits a file every session edits loses the race while its CI runs (PR 142's first version passed every check and then conflicted): make such a change so it leaves the shared file alone.
- A branch that is a copy of another (not a git descendant) merges file by file from the commit it was copied from; check files where one side went back to main's content.
- Secret scan: gitleaks over the history `HEAD` reaches; false positives go in `.gitleaksignore` by fingerprint, new fake values carry `gitleaks:allow`; `handoff/archive/` is skipped (text already scanned in `HANDOFF.md`).
- The app's Auto-fix switch for a pull request was refused by the permission check on 2026-11-25; sessions wait on CI with `gh pr checks <n> --watch --required`.

## Next steps

- Replace `HANDOFF.md` with the pointer (`POINTER` in `scripts/handoff.mjs`) and refresh `handoff/archive/` from its final text, once no open pull request still adds to it and none that started CI before 2026-11-26's handoff change is still running.
- Dependabot pull requests 19 and 110 (GitHub Actions bumps) are open.
- Other shared files that every session appends to can conflict the same way: `docs/claude-context/memory/MEMORY.md` (an index) and `.gitleaksignore`. Keep additions to one line each.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
