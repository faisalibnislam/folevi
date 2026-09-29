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
| Email (Loops) | **Partly live.** Sending domain `mail.folevi.com` verified; the two identity templates (confirmation, password reset) are published and working. The other nine (new device, deletion, invites, mentions, comments, digest, shares, access changes) are written but not yet created in Loops, so those emails are skipped. |
| AI Assistant (Gemini) | **Live.** Server-side only (`convex/ai.ts`); the key is a Convex environment variable. |
| Payments (Stripe) | **Not configured.** Plans, trial and limits work; paid plans can't be bought until the Stripe variables are set (`.env.example`). |
| Native Mac app (`apps/macos`) | Built and unit-tested against the local backend, brought up to the web's current design on 2026-09-28; signs in through the browser (Authorization Code + PKCE). **Not distributed** (ad-hoc signed, not notarized); the marketing page says “Coming soon”. Work is paused while the web is finished (`docs/MACOS.md`). |

iOS, iPadOS, Android and Windows apps are out of scope (`docs/FUTURE_IOS.md`).

## Features

### Writing
- Block editor with paragraphs, three heading levels, bulleted/numbered/to-do lists, toggles, quotes,
  callouts, code, dividers, images (including Unsplash, when configured), files, bookmarks, tables, cards,
  page links, collections, mentions, TeX formulas, Mermaid diagrams, whiteboards and flowcharts (a canvas of
  shapes and connectors with auto-layout, AI create/update and Mermaid conversion; web only for now — the
  Mac keeps them intact). Unknown future block types are preserved, never dropped.
- Markdown shortcuts, a `/` menu, `[[` page links, `@` mentions, nesting with Tab, block moves with
  ⌥⇧↑/↓ and drag handles, undo/redo, paste normalization (HTML and Markdown).
- Per-page styling: 57 note styles (artwork that also colours text, highlights and blocks) or your own
  image, serif/sans/mono font, width, background, card style.
- A tool bar at the bottom of each note (AI, Insert, Format, Style, Info), a page sidebar (contents,
  tasks, files, search) and browser-style tabs.
- Nested pages, backlinks, version history (snapshots) with restore.

### Organizing
- Home dashboard, folders (shown with the notes inside them), starred pages, tags, Drafts (pages not in
  a folder), Archive and Trash (30-day restore).
- Search with highlighted matches and a ⌘K command palette.
- Templates: 26 built-in, plus your own.

### AI Assistant
- Ask questions of your notes (with links to the notes used), write, rewrite, summarize, continue,
  translate and find action items — from the slash menu, the selection toolbar or ⌘J — and “Catch me
  up”, a brief of the week on Home. Answers stream in. Anyone can turn it off in Settings. Sent to
  Google Gemini; included in Pro and the Pro trial.

### Plans
- Free (1 GB, 2 devices), Basic (20 GB, unlimited devices) and Pro (100 GB, unlimited devices, AI), with
  a 7-day Pro trial for every new account and no card. Settings → Plan & billing and Settings → Devices.
  Limits are enforced by the server.

### Tasks and calendar
- Every to-do in every page is a task. Due dates, Today / Upcoming / Anytime / Completed views, a
  calendar, Quick Add into your Inbox page (one per person per workspace, deterministic id so offline
  devices agree), optional reminders and a daily digest email.
- Daily Notes were retired: existing daily notes remain as ordinary pages and old `/daily` links open Home.

### Working with others
- Workspace roles (Owner, Admin, Editor, Commenter, Viewer), restricted pages with explicit grants,
  invitations bound to the invited address, comments with threads and resolution, presence,
  notifications.
- Public links: off by default, optional expiry and password, `noindex`, revocable at once.

### Sync and offline
- Every edit is written to a durable local queue first (IndexedDB on the web, SQLite on the Mac) and
  sent as idempotent operations. The status says **Saved** only after the server has acknowledged every
  change — including edits still being typed (`docs/SYNC_PROTOCOL.md`).
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
  with a 7-day grace period (`docs/SECURITY.md`, `docs/AUTH_DECISION.md`).
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
- **Email:** nine of eleven Loops templates aren't created yet, and the Loops webhook isn't configured,
  so delivered/bounced events don't reach the admin email log. One early password-reset email was
  accepted by Loops but never delivered, with no bounce.
- **Payments:** Stripe isn't configured on production.
- **Accounts:** no breached-password check yet and no passkeys; no social sign-in by design
  (`docs/AUTH_DECISION.md`). Account email changes are handled by support, not self-service.
- **Collaboration is block-granular**, not character-level: concurrent edits to the same block become a
  conflict the person resolves, rather than merging automatically.
- **Mac app**: arm64 only, ad-hoc signed and not notarized. Collections are read-only; no `@mention`
  picker, image resizing, code highlighting or sharing UI; several library actions need a connection.
  Changes to the web after 2026-09-28 (such as optional two-step verification) haven't reached it yet.
  Details in `docs/MACOS.md`.
- **Loops** has no documented plain-text part; text versions are kept in the repository for review.
- **Browser coverage**: automated tests run in Chromium; Safari and Firefox are on the manual checklist.
- **No public status dashboard** yet (the Status page says so).

## Next

1. Finish the first-release checklist on production, create Loops templates 03–11, and set up the Loops
   webhook.
2. Stripe on production, so paid plans can be bought.
3. Mac: catch up with the web, then distribution (Developer ID signing, notarization, universal build
   once the Convex Swift client ships an x86_64 slice, testing on macOS 15).
4. Character-level merging for concurrent edits to the same block.
5. Mac parity: collection editing, mention picker, sharing UI, code highlighting.
6. iOS client from the shared Swift layers (`docs/FUTURE_IOS.md`).
