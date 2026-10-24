# Folevi

Notes app: web (Next.js 16, `apps/web`), Convex backend (`convex/`), native Mac app (`apps/mac`), iPhone/iPad
app (`apps/ios`), Android paused (`apps/android`), shared packages in `packages/`.

Start here when resuming work:
1. `docs/HANDOFF.md`: current state, branches, unfinished work, how to release, what the owner is waiting on.
2. `docs/claude-context/memory/`: the owner's standing decisions and rules (index: `MEMORY.md`).
3. `docs/claude-context/APPLE_DEVELOPMENT.md`: Apple team, signing and release rules.

Hard rules (details in the handoff): pushing `main` deploys production, so never push it, deploy, notarize
or upload to TestFlight without the owner's OK; never use `--prod` with the Convex CLI; never print secrets;
never touch the owner's real library or app data; no em dashes; the assistant is "Foli AI"; commit with
`git commit <paths>`.
