# Folevi

> **Handoff:** read [HANDOFF.md](HANDOFF.md) first. After every change, update its Current state, Next steps and Change log, and commit it.

Notes app: web (Next.js 16, `apps/web`), Convex backend (`convex/`), native Mac app (`apps/mac`), iPhone/iPad
app (`apps/ios`), Android as the Capacitor app (PR 69, Play internal testing; the separate native Compose app in `apps/android` is paused), Windows and Linux (`apps/desktop`, Tauri, `docs/DESKTOP_APP.md`), shared packages in `packages/`.

Start here when resuming work:
1. `docs/HANDOFF.md`: current state, branches, unfinished work, how to release, what the owner is waiting on.
2. `docs/claude-context/memory/`: the owner's standing decisions and rules (index: `MEMORY.md`).
3. `docs/claude-context/APPLE_DEVELOPMENT.md`: Apple team, signing and release rules.

Hard rules (details in the handoff): pushing `main` deploys production, so never push it, deploy, notarize
or upload to TestFlight without the owner's OK; never use `--prod` with the Convex CLI; never print secrets;
never touch the owner's real library or app data; no em dashes; the assistant is "Foli AI"; commit with
`git commit <paths>`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
