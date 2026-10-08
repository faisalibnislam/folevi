# Product

Folevi is a calm writing and notes workspace: block documents that grow into nested pages, tasks and a
calendar drawn from those documents, offline editing that syncs honestly, and a native Mac app that
shares one account and one data model with the web.

This page describes what exists in this repository today, what has been verified, and what has not.

## Surfaces

| Surface | Status |
| --- | --- |
| Marketing site (`folevi.com`) | **Live.** Home, Mac, Security, Pricing, Changelog, Docs, Status, Privacy, Terms. |
| Web app (`app.folevi.com`) | **Live.** Covered by unit and end-to-end tests. Installable PWA with an offline app shell. |
| Admin console (`app.folevi.com/admin`) | **Live.** Server-enforced platform roles (two-step verification required), append-only audit log, no content viewer (`docs/ADMIN.md`). The first super admin was bootstrapped on production on 2026-09-29. |
| Backend (Convex) | **Live** (production deployment `fastidious-clownfish-123`, deployed by the Vercel build). Integration tests run against `convex-test`, end-to-end tests against a local backend. |
| Identity (built-in accounts) | **Live.** Better Auth inside Convex: email + password, confirmed email, optional authenticator-app two-step verification, backup codes, sessions with instant revocation (`docs/AUTH_DECISION.md`). |
| Email (Mailtrap) | **Live.** All eleven templates (confirmation, password reset, new device, deletion, invites, mentions, comments, digest, shares, access changes) are rendered in the repository with the app's look and sent through Mailtrap, the only provider (`docs/EMAIL_OPERATIONS.md`). |
| AI Assistant (Gemini) | **Live.** Server-side only (`convex/ai.ts`); the key is a Convex environment variable. |
| Payments (Polar) | **Not configured.** Personal and Team plans, the trial, AI credits, seats and limits work; paid plans and credit packs can't be bought until the Polar variables are set and the plan migration has run (`docs/BILLING.md`). |
| Native Mac app (`apps/macos`) | Built and unit-tested against the local backend, brought up to the web's current design on 2026-09-28; signs in through the browser (Authorization Code + PKCE). **Not distributed** (ad-hoc signed, not notarized); the marketing page says “Coming soon”. Work is paused while the web is finished (`docs/MACOS.md`). |

iOS, iPadOS, Android and Windows apps are out of scope (`docs/FUTURE_IOS.md`).

## Features

### Writing
- Block editor with paragraphs, three heading levels, bulleted/numbered/to-do lists, toggles, quotes,
  callouts, code, dividers, images (including Unsplash, when configured), files, bookmarks, tables, cards,
  page links, collections, mentions, TeX formulas, Mermaid diagrams, whiteboards and flowcharts (a canvas of
  shapes and connectors with auto-layout, AI create/update and Mermaid conversion; web only for now, and the
  Mac keeps them intact). Unknown future block types are preserved, never dropped.
- Markdown shortcuts, a `/` menu, `[[` page links, `@` mentions, nesting with Tab, block moves with
  ⌥⇧↑/↓ and drag handles, undo/redo, paste normalization (HTML and Markdown).
- Per-page styling: 57 note styles (artwork that also colours text, highlights and blocks) or your own
  image, serif/sans/mono font, width, background, card style.
- A tool bar at the bottom of each note (AI, Insert, Format, Style, Info), a page sidebar (contents,
  tasks, files, search) and browser-style tabs.
- Nested pages, backlinks.
- Version history, as in Google Docs: versions saved as you edit (after a pause, on leaving a page, and at
  least every 10 minutes of continuous editing, server-side), grouped by day with who edited in each. A
  version shows what changed since the one before (added, removed and reworded lines, word by word) in the
  colour of whoever changed it. Name a version (named ones are kept for good), restore one (undoable: the
  page as it was is saved first) or make a copy. "Show editors" marks each line of the live page with who
  last changed it. History is for people who can edit the page.

### Organizing
- Home dashboard, folders (shown with the notes inside them), starred pages, tags, Drafts (pages not in
  a folder), Archive and Trash (30-day restore).
- Search with highlighted matches and a ⌘K command palette.
- Templates: 26 built-in, plus your own.

### AI Assistant
- Ask questions of your notes (with links to the notes used), write, rewrite, summarize, continue,
  translate and find action items (from the slash menu, the selection toolbar or ⌘J), and “Catch me
  up”, a brief of the week on Home. Answers stream in. Anyone can turn it off in Settings. Sent to
  Google Gemini. Metered in AI credits (1 credit = $0.01 of Gemini cost): Free 25 a month, Pro 180, Pro AI
  550, the trial 100, plus credit packs on Pro and Pro AI. In a paid workspace each member has that plan's
  credits there; in free workspaces and as a guest, people use their own personal credits. Core has no AI
  at all: the server refuses every request in a Core Personal or workspace and the app hides AI there.
  An hourly abuse limit still applies. Details in `docs/BILLING.md`.

### Personal and workspaces
- **Personal** is each person's own space, not a workspace: nobody can join it; pages in it can be shared
  with people as guests. **Workspaces** are shared team spaces with their own plan, storage and billing;
  their content belongs to the workspace. The switcher lists Personal first, then your workspaces with your
  role. The model and its migration are in `docs/ACCOUNT_MODEL_PLAN.md`.

### Plans
- **Four plans, for Personal and for Team** (`docs/BILLING.md`): Free ($0: 1 GB shared by your Personal
  and the free workspaces you own, 25 AI credits a month, 2 devices), Core ($1.99 a month or $19 a year:
  20 GB, no AI), Pro ($4.99 or $49: 20 GB, 180 credits) and Pro AI ($12.99 or $149: 50 GB, 550 credits,
  "unlimited AI, fair use"). Team plans cost the same per member seat (owner, admins and members; guests
  and pending invitations are free) and give each member that storage and those credits in the workspace.
  Every new account gets a 7-day Pro AI trial with 100 credits and no card. Credit packs (500 for $7.99,
  1,000 for $14.99) last 12 months. Settings → Plan & billing, Settings → Workspace billing, Settings →
  Devices. Payments go through Polar (the merchant of record) once it's configured; admins can set plans by
  hand and grant credits.
- Personal and workspace plans, storage and AI never mix. Over a limit (e.g. after a downgrade) nothing is
  deleted; uploads wait until there's room. Everything is enforced by the server
  (`convex/lib/entitlements.ts`, `convex/lib/seats.ts`).

### Tasks and calendar
- Every to-do in every page is a task. Due dates, Today / Upcoming / Anytime / Completed views, a
  calendar, Quick Add into your Inbox page (one per person per Personal or workspace, deterministic id so
  offline devices agree), optional reminders and a daily digest email.
- Daily Notes were retired: existing daily notes remain as ordinary pages and old `/daily` links open Home.

### Working with others
- Workspace roles (Owner, Admin, Member, each optionally comment or view only) and guests (single pages,
  not billed; invited by email even without an account; a Guests list with member ↔ guest conversion),
  restricted pages with explicit grants, invitations bound to the invited address, comments with threads
  and resolution, presence, notifications.
- Ownership transfer; the only owner can't leave without transferring or deleting the workspace;
  deleting a workspace takes effect after 7 days (the owner can cancel), and removing a member never
  touches their Personal or their plan.
- Public links: off by default, optional expiry and password, `noindex`, revocable at once.

### Sync and offline
- Every edit is written to a durable local queue first (IndexedDB on the web, SQLite on the Mac) and
  sent as idempotent operations. The status says **Saved** only after the server has acknowledged every
  change, including edits still being typed (`docs/SYNC_PROTOCOL.md`).
- Offline editing on both clients; queued edits survive reloads and restarts. On the web, opening
  Folevi with no connection shows the last-known folio from this device (after one online visit).
- Two devices editing the same block produce a visible conflict with Keep mine / Keep theirs /
  Keep both. Nothing is lost silently.

### Import and export
- Markdown import with a report of anything that couldn't be mapped; Markdown, HTML and ZIP export on
  the web; Markdown, HTML and PDF export on the Mac.

### Account and security
- Built-in accounts: email and password only, confirmed email, and optional authenticator-app two-step
  verification (turned on or off in Settings → Security, with 10 single-use backup codes and an optional
  30-day “trust this device”; required for the admin console), password reset by email, password
  change, new backup codes and moving to a new authenticator in Settings → Security, session list with instant revocation, account deletion
  with a 7-day grace period. It is refused while you own a workspace other people use (transfer or delete it
  first) (`docs/SECURITY.md`, `docs/AUTH_DECISION.md`).
- No third-party analytics or trackers.

## Verified

Commands and suites are listed in `docs/TESTING.md`. As of 2026-09-29:

- **On production** (`app.folevi.com`), by the account owner: security headers (HSTS, CSP), no
  development mailbox, real sign-up → confirmation email → sign-in, password reset by email, turning on
  two-step verification, the admin console, and the AI Assistant.
- **CI** (every push to `main`): lint, typecheck, unit and integration tests, the web build, a secret
  scan of the full history, dependency audit, the Mac build and tests, and two Playwright suites (local
  backend, and a production build for the service worker and headers).
- Convex integration: 107 tests (tenant isolation, sync protocol, sharing, deletion cascades, admin RBAC,
  optional two-step verification, session revocation, static invariants). Web unit: 64 tests.
- Playwright: about 80 tests, including axe WCAG 2.2 AA checks in light and dark, offline and
  durable-queue behaviour, the two-device conflict flow, and the account flows.
- Mac: 68 unit tests (including the shared golden fixtures for ranks, documents and sync scenarios).

## Not verified / known limitations

- **Still to check on production:** signing out another session from Settings → Security, creating and
  revoking a public link, and export (`docs/DEPLOYMENT.md`, first-release checklist).
- **Email:** Mailtrap sends everything, with its signed webhook reporting deliveries and bounces to the
  admin email log (verified in production 2026-09-29). The Convex `LOOPS_*` variables are removed; the
  Loops DNS records and sending domain are removed by the owner per `docs/EMAIL_OPERATIONS.md` §9.
- **Payments:** Polar isn't configured on production yet, and the plan migration hasn't run there
  (`docs/BILLING.md`, owner checklist).
- **Account model:** production runs the new model (Personal is not a workspace, workspace plans, members
  vs guests; migrated and verified 2026-09-29). A few clean-up migrations are left to run and the
  `workspaces.kind` field to delete afterwards (`docs/ACCOUNT_MODEL_PLAN.md` §3b). The Mac app still
  expects the old model until its catch-up (paused).
- **Accounts:** no breached-password check yet and no passkeys; no social sign-in by design
  (`docs/AUTH_DECISION.md`). Account email changes are handled by support, not self-service.
- **Collaboration is block-granular**, not character-level: concurrent edits to the same block become a
  conflict the person resolves, rather than merging automatically.
- **Mac app**: arm64 only, ad-hoc signed and not notarized. Collections are read-only; no `@mention`
  picker, image resizing, code highlighting or sharing UI; several library actions need a connection.
  Changes to the web after 2026-09-28 (such as optional two-step verification) haven't reached it yet.
  Details in `docs/MACOS.md`.
- **Browser coverage**: automated tests run in Chromium; Safari and Firefox are on the manual checklist.
- **No public status dashboard** yet (the Status page says so).

## Next

1. Run the account-model migration on production (`docs/ACCOUNT_MODEL_PLAN.md` §3a).
2. Finish the first-release checklist on production and remove the Loops leftovers
   (`docs/EMAIL_OPERATIONS.md` §9).
3. Polar on production (sandbox first), then run the plan migration, so plans and credit packs can be
   bought (`docs/BILLING.md`).
4. Mac: catch up with the web (Personal as its own scope, workspace plans, guests), then distribution (Developer ID signing, notarization, universal build
   once the Convex Swift client ships an x86_64 slice, testing on macOS 15).
5. Character-level merging for concurrent edits to the same block.
6. Mac parity: collection editing, mention picker, sharing UI, code highlighting.
7. iOS client from the shared Swift layers (`docs/FUTURE_IOS.md`).
