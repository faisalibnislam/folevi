# Folevi

> **Handoff:** the handoff is the [`handoff/`](handoff/README.md) folder. Before work: read `handoff/guide.md` and run
> `node scripts/handoff.mjs show` (or `--area <area>`). After every change, in the same pull request: add a log entry
> with `node scripts/handoff.mjs log "<what changed>" --area <area>` and fill it in, and update
> `handoff/state/<area>.md` when the area's state or next steps changed. **Never edit `HANDOFF.md`** (it is
> frozen, and CI fails a pull request that changes it) and never edit another session's log entry.

Notes app: web (Next.js 16, `apps/web`), Convex backend (`convex/`), native Mac app (`apps/mac`), iPhone/iPad
app (`apps/ios`), Folevi Server (`services/`), shared packages in `packages/`. **Paused since 2026-11-28 (owner):** the
Android app (Capacitor, PR 69; the native Compose app in `apps/android`) and the Windows and Linux app (`apps/desktop`,
Tauri, `docs/DESKTOP_APP.md`). Their code stays, but the site and apps show them as "Coming soon", and nothing new ships
for them until the owner resumes them (`docs/claude-context/memory/platforms-paused-2026-11-28.md`).

Start here when resuming work:
1. `handoff/guide.md`, then `node scripts/handoff.mjs show`: setup, build, release, rules; each area's current state and next steps; the newest changes. (`docs/HANDOFF.md` is the October handoff, history only.)
2. `docs/claude-context/memory/`: the owner's standing decisions and rules (index: `MEMORY.md`).
3. `docs/claude-context/APPLE_DEVELOPMENT.md`: Apple team, signing and release rules.

Pull requests, merging and CI have one manager session (the owner, 2026-11-26): for a conflict with `main` or
another pull request, CI that is red for a reason outside your change, or a release, message
`local_c35f3572-0bc6-4217-9c6d-dcf1ccd0c73c` ("Folevi PR, merge and CI manager") instead of merging `main` into
other sessions' branches (`docs/claude-context/memory/pr-merge-ci-manager-2026-11-26.md`).

Hard rules (details in `handoff/guide.md` section 8): pushing `main` deploys production, so never push it, deploy, notarize
or upload to TestFlight without the owner's OK; never use `--prod` with the Convex CLI; never print secrets;
never touch the owner's real library or app data; no em dashes; the assistant is "Foli AI"; commit with
`git commit <paths>`.

Feature parity with the Windows and Linux app is on hold while that app is paused (2026-11-28). Don't port web or Mac
features to `apps/desktop` unless the owner asks; `docs/DESKTOP_PARITY.md` is kept for when it resumes.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
