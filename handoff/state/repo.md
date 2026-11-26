# Repository, CI and how pull requests land

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- `main` is protected: 12 required checks (lint and tests, clipper, secret scan, e2e 1/8 to 8/8, production e2e); no reviews; a merge to `main` deploys production. Sessions may merge their own green pull requests (GitHub auto-merge, merge commits; never `--admin`).
- The handoff is the `handoff/` folder since 2026-11-26; `HANDOFF.md` is a pointer and CI's first step fails a pull request that changes it (`node scripts/handoff.mjs check`).
- When several pull requests are open and conflict, land them through one integration branch (merge each head, resolve once, one CI run); `gh pr merge <n> --disable-auto` keeps them from landing piecemeal. PRs 109, 132 and 136 were done that way.
- A branch that is a copy of another (not a git descendant) merges file by file from the commit it was copied from; check files where one side went back to main's content.
- Secret scan: gitleaks over the history `HEAD` reaches; false positives go in `.gitleaksignore` by fingerprint, new fake values carry `gitleaks:allow`; `handoff/archive/` is skipped (text already scanned in `HANDOFF.md`).
- The app's Auto-fix switch for a pull request was refused by the permission check on 2026-11-25; sessions wait on CI with `gh pr checks <n> --watch --required`.

## Next steps

- Dependabot pull requests 19 and 110 (GitHub Actions bumps) are open.
- Other shared files that every session appends to can conflict the same way: `docs/claude-context/memory/MEMORY.md` (an index) and `.gitleaksignore`. Keep additions to one line each.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
