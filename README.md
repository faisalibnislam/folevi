# Folevi

A quieter place for ideas that keep growing. Folevi is a calm writing and notes workspace with block
documents, nested pages, tasks, calendar, collections, comments, offline editing and sync. It runs on the web
and on the Mac (Folevi for Mac: a native app showing the same interface in the system's web view). Each person has their own Personal; teams share
workspaces with their own plans, seats and billing (`docs/ACCOUNT_MODEL_PLAN.md`).

| Surface | Where | Stack |
| --- | --- | --- |
| Marketing site | `folevi.com` → `apps/web/src/app/(marketing)` | Next.js 16 (App Router) |
| Product web app (PWA) | `app.folevi.com` → `apps/web/src/app/(app)` | Next.js, React 19, Tiptap/ProseMirror |
| Admin console | `app.folevi.com/admin` → `apps/web/src/app/admin` | Next.js |
| Folevi for Mac | `apps/mac` (the built-in interface on `app://folevi`) | AppKit + WKWebView, Sparkle updates: Quick Add, menu bar icon, notifications |
| Backend | `convex/` | Convex (queries, mutations, actions, crons, HTTP) |
| Identity | Built-in accounts: Better Auth inside Convex (email + password, verified email, optional authenticator-app 2FA) | `convex/auth.ts`, `convex/betterAuth` |
| Transactional email | Resend: sending, plus the support inbox (templates rendered in the repo) | `packages/email` |

Shared packages: `packages/editor-schema` (canonical block schema → TypeScript, JSON Schema;
fractional ranks; tree/Markdown/HTML/search/task helpers; the sync reducer), `packages/design-tokens`
(tokens → CSS + TypeScript), `packages/email` (email manifest, compiled HTML + text templates, rendering, validation, Resend sender,
webhook verification, received-mail parsing), `packages/config` (lint config).

## Quick start (local, no third-party accounts needed)

Requirements: Node 24 (`.nvmrc`), pnpm 10 (`corepack enable`).

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

Accounts are built in (Better Auth running inside Convex; see `docs/AUTH_DECISION.md`), so there is no
external identity service to set up. Create an account at http://app.localhost:3000/signup. Locally,
identity emails (email confirmation, password reset) are not sent: they are captured in the
**development mailbox** at http://app.localhost:3000/dev/mailbox, which `scripts/setup-local.mjs`
enables with a random `FOLEVI_DEV_MAILBOX_SECRET`. The mailbox never exists in production (the Convex
query refuses when `FOLEVI_ENV=production`, and the production build fails if the secret is set).
Two-step verification (TOTP) is optional for accounts, but the admin console requires it.

Make yourself a platform super admin (local): create an account and sign in once, then

```bash
npx convex run admin:bootstrapSuperAdmin '{"email":"you@example.com"}'
```

### Folevi for Mac

```bash
node apps/web/scripts/build-shell.mjs && node apps/mac/scripts/build.mjs && node apps/mac/scripts/mac.mjs launch
```

Builds the built-in interface into `apps/mac/web`, then the Debug app ("Folevi Dev", its own data and
`folevi-dev://` links, never installed), and opens it. Releases, signing and downloads are in
`docs/MAC_RELEASE.md`; the app itself in `docs/DESKTOP.md`.

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
See `docs/TESTING.md` for what each suite covers, and `docs/DESKTOP.md` for the Mac app's.

## Documentation

- `docs/PRODUCT.md`: scope, principles, what is and isn't built
- `docs/ACCOUNT_MODEL_PLAN.md`: Personal vs workspaces, plans, seats, guests, billing; the production migration runbook
- `docs/ARCHITECTURE.md`: system design, data model, auth, hosts, offline
- `docs/AUTH_DECISION.md`: why accounts are built in (Better Auth on Convex), security properties, known gaps
- `docs/EDITOR_SCHEMA.md`: canonical block schema, versioning, migrations
- `docs/SYNC_PROTOCOL.md`: normative sync and offline contract
- `docs/DESIGN_SYSTEM.md`: “The Living Folio” (tokens, type, motion, accessibility)
- `docs/SECURITY.md`: threat model, controls, data handling, retention, subprocessors
- `docs/ADMIN.md`: admin roles, actions, audit log
- `docs/EMAIL_DECISION.md`, `docs/EMAIL_OPERATIONS.md`: email via Resend (identity, security, product, support inbox), templates and operations
- `docs/DEPLOYMENT.md`: Vercel, Convex (including accounts), Resend, DNS, environments, backups, incidents
- `docs/TESTING.md`: test suites and manual QA checklists
- `docs/DESKTOP.md`: Folevi for Mac (apps/mac), its bridge to the web app, building it; `docs/MAC_RELEASE.md`: signing, updates, downloads and releases
- `docs/IOS.md`: Folevi for iPhone and iPad (`apps/ios`, the web app in a Capacitor shell), App Review notes
- `docs/FUTURE_IOS.md`: how an iOS client would be added (superseded by docs/IOS.md)
