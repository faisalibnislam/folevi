# Folevi

A quieter place for ideas that keep growing. Folevi is a calm writing and notes workspace — block
documents, nested pages, tasks, calendar, collections, comments, offline editing and sync — for the web
and as a fully native Mac app.

| Surface | Where | Stack |
| --- | --- | --- |
| Marketing site | `folevi.com` → `apps/web/src/app/(marketing)` | Next.js 16 (App Router) |
| Product web app (PWA) | `app.folevi.com` → `apps/web/src/app/(app)` | Next.js, React 19, Tiptap/ProseMirror |
| Admin console | `app.folevi.com/admin` → `apps/web/src/app/admin` | Next.js |
| Native Mac app | `apps/macos` | Swift 6, SwiftUI + AppKit, Convex Swift client, SQLite |
| Backend | `convex/` | Convex (queries, mutations, actions, crons, HTTP) |
| Identity | Auth0 (email + password, verified email, TOTP) | `infra/auth0` |
| Transactional email | Loops | `packages/email` |

Shared packages: `packages/editor-schema` (canonical block schema → TypeScript, Swift, JSON Schema;
fractional ranks; tree/Markdown/HTML/search/task helpers; the sync reducer), `packages/design-tokens`
(tokens → CSS + Swift), `packages/email` (Loops manifest, MJML + text templates, validation, sender,
webhook verification), `packages/config` (lint config).

## Quick start (local, no accounts needed)

Requirements: Node 24 (`.nvmrc`), pnpm 10 (`corepack enable`), Xcode 26+ for the Mac app.

```bash
pnpm install
```

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev
```

Leave that running (it starts a local Convex backend at http://127.0.0.1:3210). In another terminal:

```bash
node scripts/setup-local.mjs
```

```bash
pnpm --filter @folevi/web dev
```

- Marketing: http://localhost:3000
- App: http://app.localhost:3000 (Chrome/Firefox resolve `*.localhost` to your machine)

Without an Auth0 tenant, sign-in uses a **development-only identity** (a local token issuer trusted
only by the local Convex deployment). It is impossible to enable on a Vercel production deployment and
production Convex rejects it (`FOLEVI_DEV_AUTH_JWKS=none`). With Auth0 configured, the app uses Auth0
Universal Login instead — see `docs/DEPLOYMENT.md`.

Make yourself a platform super admin (local): sign in once, then

```bash
npx convex run admin:bootstrapSuperAdmin '{"email":"you@example.com"}'
```

### Mac app

```bash
script/build_and_run_macos.sh
```

Builds `apps/macos/build/Folevi.app` and launches it. The Debug build talks to the local Convex backend
and offers “Developer sign-in” (Debug only). See `docs/MACOS.md`.

## Tests

```bash
pnpm --filter @folevi/editor-schema test
```

```bash
pnpm --filter @folevi/email test
```

```bash
pnpm exec vitest run
```

```bash
pnpm --filter @folevi/web test
```

```bash
cd apps/web && E2E_NO_SERVER=1 npx playwright test
```

(The Playwright suite expects the local backend and web dev server from Quick start to be running.)
See `docs/TESTING.md` for what each suite covers, and the Mac tests in `docs/MACOS.md`.

## Documentation

- `docs/PRODUCT.md` — scope, principles, what is and isn't built
- `docs/ARCHITECTURE.md` — system design, data model, auth, hosts, offline
- `docs/EDITOR_SCHEMA.md` — canonical block schema, versioning, migrations
- `docs/SYNC_PROTOCOL.md` — normative sync and offline contract
- `docs/DESIGN_SYSTEM.md` — “The Living Folio”: tokens, type, motion, accessibility
- `docs/SECURITY.md` — threat model, controls, data handling, retention, subprocessors
- `docs/ADMIN.md` — admin roles, actions, audit log
- `docs/EMAIL_DECISION.md`, `docs/EMAIL_OPERATIONS.md` — Auth0 → Loops email path and operations
- `docs/DEPLOYMENT.md` — Vercel, Convex, Auth0, Loops, DNS, environments, backups, incidents
- `docs/TESTING.md` — test suites and manual QA checklists
- `docs/MACOS.md` — native app architecture and build
- `docs/FUTURE_IOS.md` — how an iOS client would be added (intentionally not built)
