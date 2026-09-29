# Product

Folevi is a calm writing and notes workspace: block documents that grow into nested pages, tasks and a
calendar drawn from those documents, offline editing that syncs honestly, and a native Mac app that
shares one account and one data model with the web.

This page describes what exists in this repository today, what has been verified, and what has not.

## Surfaces

| Surface | Status |
| --- | --- |
| Marketing site (`folevi.com`) | Built: home, Mac, Security, Pricing (free during the preview), Changelog, Docs, Status, Privacy, Terms. Uses real product screenshots (`apps/web/public/marketing/screenshots`). |
| Web app (`app.folevi.com`) | Built and covered by unit and end-to-end tests. Installable PWA with an offline app shell. |
| Admin console (`app.folevi.com/admin`) | Built: server-enforced platform roles, append-only audit log, no content viewer (`docs/ADMIN.md`). |
| Native Mac app (`apps/macos`) | Built, unit- and UI-tested against the local backend (`docs/MACOS.md`). **Sign-in does not work at the moment:** the app still contains code for the previous identity provider (Auth0) and will move to Authorization Code + PKCE against Folevi's own accounts after the web app is finalized. |
| Backend (Convex) | Built; integration tests run against `convex-test`, end-to-end tests against a local backend. |
| Identity (built-in accounts) | Better Auth running inside Convex: email + password, confirmed email, optional authenticator-app two-step verification, backup codes, sessions with instant revocation (`docs/AUTH_DECISION.md`). Works locally and in the end-to-end suite, with identity emails captured in the development mailbox. **Not yet run on a production deployment.** |
| Email (Loops) | Manifest, 11 templates (including confirmation and password reset for built-in accounts), sender, webhook verification and tests are written. **No real email has been sent.** |
| Production deployment | **Not deployed.** `docs/DEPLOYMENT.md` lists the account steps. |

iOS, iPadOS, Android and Windows apps are out of scope (`docs/FUTURE_IOS.md`).

## Features

### Writing
- Block editor with paragraphs, three heading levels, bulleted/numbered/to-do lists, toggles, quotes,
  callouts, code, dividers, images, files, bookmarks, tables, page links, collections and mentions.
  Unknown future block types are preserved, never dropped.
- Markdown shortcuts, a `/` menu, `[[` page links, `@` mentions, nesting with Tab, block moves with
  ⌥⇧↑/↓ and drag handles, undo/redo, paste normalization (HTML and Markdown).
- Per-page styling: icon, cover (accent color, accent gradient, or one of 20 abstract artworks), accent,
  serif/sans/mono font, width, background, card style.
- Nested pages, backlinks, an outline on wide screens, version history (snapshots) with restore.

### Organizing
- Home (all your pages), folders, starred pages, tags, Drafts (pages not in a folder), Archive and Trash (30-day restore).
- Search with highlighted matches and a ⌘K command palette.
- Templates (built-in and your own).

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

Commands and suites are listed in `docs/TESTING.md`. At the time of writing:

- Schema, email and Convex integration suites pass (Convex: 27 tests, including tenant isolation,
  sync protocol, sharing, deletion cascades, admin RBAC and static invariants).
- Web unit tests pass (8). Playwright end-to-end suite passes (24 tests, including axe WCAG 2.2 AA
  checks in light and dark, offline and durable-queue behavior, and the two-device conflict flow).
- Mac: 53 unit tests (including the shared golden fixtures for ranks, documents and all 9 sync
  scenarios) and 6 UI tests pass; the app has been built, launched, and exercised against the local
  backend (offline edits, remote changes, conflicts, export).
- Web and Mac render the same seeded documents from the same backend (screenshots in the marketing
  site were taken from both clients on the same account, before the switch to built-in accounts).
- The counts above predate the switch from Auth0 to built-in accounts. The account flows are now
  covered by `apps/web/e2e/account.spec.ts` and the session tests in `tests/convex/backend.test.ts`
  (`docs/TESTING.md`); re-run the suites for current numbers.

## Not verified / known limitations

- **No production deployment or Loops team was used.** Built-in accounts have only run locally and in
  tests; real email delivery (including confirmation and reset emails) is untested.
- **Mac sign-in** is not working until the app moves to Authorization Code + PKCE against Folevi's own
  accounts.
- **Accounts:** no breached-password check yet and no passkeys; no social sign-in by design
  (`docs/AUTH_DECISION.md`).
- **Collaboration is block-granular**, not character-level: concurrent edits to the same block become a
  conflict the person resolves, rather than merging automatically.
- **Mac app**: arm64 only, ad-hoc signed and not notarized, run only on macOS 27. Collections are
  read-only; no `@mention` picker, image resizing, code highlighting or sharing UI; several library
  actions need a connection. Details in `docs/MACOS.md`.
- **Account email changes** are handled by support, not self-service.
- **Loops** has no documented plain-text part; text versions are kept in the repository for review.
- **Browser coverage**: automated tests run in Chromium; Safari and Firefox are on the manual checklist.
- **No public status dashboard** yet (the Status page says so).

## Next

1. Configure Loops, Convex and Vercel accounts and deploy (`docs/DEPLOYMENT.md`), then run the
   first-release checklist, including real sign-up, confirmation email and authenticator setup.
2. Mac sign-in with Authorization Code + PKCE against Folevi's own accounts.
3. Mac distribution: Developer ID signing, notarization, universal build once the Convex Swift client
   ships an x86_64 slice, testing on macOS 15.
4. Character-level merging for concurrent edits to the same block.
5. Mac parity: collection editing, mention picker, sharing UI, code highlighting.
6. iOS client from the shared Swift layers (`docs/FUTURE_IOS.md`).
