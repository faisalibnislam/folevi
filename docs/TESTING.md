# Testing

## Automated suites

| Suite | Command | Covers |
| --- | --- | --- |
| Schema & sync reducer | `pnpm --filter @folevi/editor-schema test` | golden round-trip (all block types + unknown future type), validation codes, v0→v1 migration, rank golden cases + property tests, tree invariants (property/generative: random nesting and reorders), Markdown import/export, HTML escaping, search normalization & highlighting, task projection/buckets/time zones, href sanitization, **9 golden sync scenarios** (create/edit/reorder/delete-restore offline, duplicate delivery, token expiry, server rejection, same-block conflict, upload interruption) |
| Email | `pnpm --filter @folevi/email test` | manifest ⇄ template contract (every placeholder declared, required variables used, generated module current), rendering (HTML escaping, URL rules, missing/unknown variables, every template renders), images only from the brand path, text versions, category rules (no unsubscribe on identity/security), Mailtrap sender (request body, retries on 429/5xx, no retry on 4xx or timeouts, provider selection incl. sandbox, non-production recipient policy, no secrets in output or logs), Mailtrap webhook signatures and parsing (JSON + JSON Lines), legacy Loops sender and webhook. `pnpm --filter @folevi/email preview` renders every template to `packages/email/preview/index.html`. |
| Convex integration | `pnpm exec vitest run` | bootstrap + seed, verified-email gate, optional MFA (required only for admin functions), **session revocation** (a revoked Better Auth session stops working on the next call while the others keep working; a token without a live session is rejected), re-linking a profile from the previous identity provider by verified email, **tenant isolation** (reads, writes, pull, search), restricted docs + grants, role changes, invitation binding, **sync protocol** (idempotency, content conflicts, LWW positions, tombstones + restore, invalid blocks, cycles, orphan normalization, pull cursors, title conflicts), task projection, Quick Add Inbox (deterministic id, restored from Trash), **public links** (revocation, expiry, passwords, server secret), **deletion cascades**, file authorization, **admin RBAC + audit**, no content via admin, rate limits, **email** (`tests/convex/email-mailtrap.test.ts`: Mailtrap mocked via fetch — attempt recorded with message id, no double send for the same key or while in flight, sandbox outside production; signed webhook ok/bad/missing, JSON and JSON Lines, dedupe, matching, suppression of product mail after a bounce); plus static invariants (`tests/convex/static/invariants.test.ts`: append-only audit log, every function authorized, only Folevi's own issuer trusted, development mailbox and test helpers refuse production, no hand-rolled credential crypto — password/TOTP cryptography must come from Better Auth, no content in logs) |
| Web unit | `pnpm --filter @folevi/web test` | editor ⇄ canonical conversion on the golden document, content-vs-position diffs, stable ranks on move, id repair, HTML paste normalization, web sync engine (durable IndexedDB queue across restart, ordered flush, re-auth) |
| End-to-end | `cd apps/web && E2E_NO_SERVER=1 npx playwright test` | signup → onboarding → Welcome; editor (Markdown shortcuts, slash menu, persistence, formatting, nesting, move, undo); offline edit + reconnect + second browser; durable queue across reload; folders/star/move/trash/restore; search with highlights; quick-add task → Today → calendar → complete; sharing + comments + notifications + public link (noindex, revoke); Markdown import report + export; accounts (`account.spec.ts`: sign-up needs a confirmed email, mandatory authenticator setup before the app opens, generic sign-in errors, authenticator codes, single-use backup codes, “trust this device”, session list and instant revoke, password reset by email ending other sessions, Settings → Security: change password, new backup codes, move to a new authenticator; onboarding once); axe WCAG 2.2 AA checks on app views in light and dark and the marketing home; keyboard-only flow; admin authorization and audit (`admin.spec.ts`) |
| Mac | see `docs/MACOS.md` | Swift ports against the same golden fixtures (ranks, document round-trip, sync scenarios), SQLite store, Keychain wrapper, auth callback parsing (for the previous provider; Mac sign-in is pending the move to PKCE against Folevi's own accounts), UI tests |
| Design tokens | `node packages/design-tokens/scripts/contrast.mjs` | WCAG contrast for every semantic pair in both themes |

E2E prerequisites: the local Convex backend and web dev server (README Quick start), configured by
`scripts/setup-local.mjs` (which sets `FOLEVI_DEV_MAILBOX_SECRET` on both). Each test signs up a fresh
`@example.com` person through the real sign-up pages, so runs don't interfere with each other. The
helpers in `apps/web/e2e/helpers.ts` read confirmation and reset links from the development mailbox
(`/api/dev/mailbox`), generate authenticator codes with `otpauth` from the key shown during setup, and
keep the backup codes. Non-production rate limits are multiplied by `FOLEVI_AUTH_RATE_LIMIT_SCALE`
(default 200) so many sign-ups from one machine don't trip them.

## Manual QA checklist (per release)

Web (Chrome, Safari, Firefox; 1440, 1024, 768, 375 widths; light and dark):
- Keyboard only: skip link, sidebar, command palette (⌘K), slash menu, block options (⌘.), move blocks
  (⌥⇧↑↓), inspector tabs (arrow keys), dialogs trap focus and return it.
- Screen reader (VoiceOver + Safari): sync status announcements are polite and not chatty; checkboxes
  announce state; menus and comboboxes announce options.
- `prefers-reduced-motion`, `prefers-contrast: more`, 200% zoom.
- Offline: DevTools → Offline, edit, reload (production build with service worker), reconnect.
- Two browsers editing the same block → conflict banner → Keep both.
- Accounts: sign up → confirmation email → straight into the app; Settings → Security → turn on two-step
  verification (scan the QR code with a real app such as 1Password, Google Authenticator or Authy) →
  backup codes; turn it off again; sign in with a code and with a backup code;
  “trust this device”; wrong password shows the generic error; forgot password; revoke a session from a
  second browser and watch it sign out.

Cross-client (same account on web and Mac; blocked until Mac sign-in moves to PKCE against Folevi's own
accounts): create on web → appears on Mac; edit offline on Mac →
reconnect → visible on web; create and complete a task; export a page; switch themes; confirm `/admin`
is denied for non-admins.

## Visual QA

`node apps/web/e2e/visual.mjs <outDir>` captures key screens (set `SHOT_PATHS`, `SHOT_THEMES`,
`SHOT_WIDTHS`) for review.

## Demo data at scale (local only)

To try Folevi with realistic volume, seed an account on the local deployment (refuses to run when
`FOLEVI_ENV=production`):

```bash
npx convex run testSupport:seedDemoContent '{"email":"you@example.com","notes":200,"folders":50,"tags":200}'
```

It creates folders (a fifth nested one level), tags, and notes with varied content (headings, lists,
to-dos with due dates, quotes, callouts, tables, code), covers, page styles, tags, stars, nested pages and
edit dates spread over four months. Notes are created in batches of 25 (the job reschedules itself).
e2e/organize-index.spec.ts uses the same seeder through `seedDemo()` in e2e/helpers.ts.

