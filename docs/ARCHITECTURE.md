# Architecture

## Overview

```
 Browser (folevi.com, app.folevi.com)            Mac (Folevi.app)
 ┌───────────────────────────────┐               ┌──────────────────────────────┐
 │ Next.js 16 on Vercel           │               │ SwiftUI + AppKit             │
 │  • marketing (static)          │               │  • NSTextView block editor   │
 │  • product shell (1 catch-all) │               │  • SQLite store (actor)      │
 │  • admin console               │               │  • Sync reducer (Swift port) │
 │  • /api/auth/* → Convex proxy  │               │  • sign-in: pending (PKCE)   │
 │ IndexedDB: op log + cache      │               │  • Convex Swift client       │
 └──────────────┬────────────────┘               └──────────────┬───────────────┘
                │ WebSocket (queries, mutations)                 │
                ▼                                                 ▼
          ┌──────────────────────────── Convex ─────────────────────────────┐
          │ auth.ts: Better Auth (component) · auth.config: own issuer only  │
          │ lib/auth.ts — every read/write authorized server-side            │
          │ sync.ts — push (idempotent ops), pull (by workspace seq), head   │
          │ documents/blocks/tasks/comments/sharing/collections/search/files │
          │ admin.ts + adminAuditLogs (append-only)                          │
          │ email.ts / authEmails.ts → @folevi/email → Loops · identity.ts   │
          │ crons: deletion jobs, reminders, retention, digest, metrics      │
          └──────────────────────────────────────────────────────────────────┘
```

## Hosts and routing

One Next.js app serves three surfaces. `src/proxy.ts` (Next 16's middleware; it must sit next to `src/app`) routes by host: marketing
paths redirect to `folevi.com`, product/admin paths redirect to `app.folevi.com`, and `www` redirects to
the apex. Locally the hosts are `localhost:3000` and `app.localhost:3000`.

The product is a single catch-all route (`src/app/(app)/[...path]`) that renders a client shell. Inside
it, navigation uses `history.pushState` (kept in sync with `usePathname`), so moving between views never
round-trips to the server and keeps working offline. Every document, nested page, folder, tag, task view
and settings section has a stable, shareable URL (`/d/:id`, `/folders/:id`, `/tasks/today`, …). The
server part of that route only checks for a session and renders no private data, which is what makes it
safe for the service worker to keep a copy for offline boot.

## Identity

- **Built-in accounts** on Better Auth 1.6, running inside Convex as a local component
  (`@convex-dev/better-auth`; configuration in `convex/auth.ts`, component schema in `convex/betterAuth/`).
  Why this replaced Auth0, and the security properties and known gaps: `docs/AUTH_DECISION.md`.
- Methods: email + password only (10–128 characters), a confirmed email address (links valid 24 h; the
  person is signed in after confirming), password reset by email (link valid 1 h; resetting ends every
  other session) and a **required** authenticator-app second step (TOTP, 10 single-use backup codes,
  optional “trust this device” for 30 days). There is no social sign-in, passkey or passwordless sign-in.
- Routes: `convex/http.ts` registers the Better Auth routes on the Convex site URL; the Next.js route
  `apps/web/src/app/api/auth/[...all]/route.ts` proxies `/api/auth/*` to it, so the session cookie
  (prefix `folevi`, HTTP-only) is first-party on `app.folevi.com`. Pages: `/signin`, `/signup`,
  `/verify-email`, `/forgot-password`, `/reset-password`, `/two-factor`, `/two-factor/setup`.
- Tokens: the Convex plugin issues short-lived (15 min) RS256 JWTs from `/api/auth/convex/token`
  (`lib/convex/provider.tsx` fetches them for the Convex client). Besides `sub` they carry `sessionId`,
  `https://folevi.com/email_verified` and `https://folevi.com/mfa`. `convex/auth.config.ts` trusts
  only this issuer (issuer, audience `convex`, expiry and signature against the published JWKS).
- `lib/auth.ts` (`requireProfile`) requires the verified-email and MFA claims, then checks that the
  **Better Auth session behind the token still exists** (`requireActiveSession`), and rejects
  suspended/deleted profiles. Because live queries read the session row, signing out, revoking a
  session, changing or resetting the password and admin suspension take effect on the very next call
  and end open subscriptions at once, without waiting for the token to expire.
- Sessions: rolling 14 days (refreshed at most daily). Settings → Security lists them
  (`users.listSessions`) and can end one or all others (`users.revokeSession`,
  `users.revokeOtherSessions`); `sessionsMirror` only adds device labels.
- Admin identity actions (`convex/identity.ts`) work on Folevi's own store: end sessions, resend the
  confirmation email, send a password reset, block (suspend + end sessions) and delete the credentials,
  each with an audit row.
- `users.bootstrap` re-links a profile created under the previous provider (Auth0, or the old local
  development sign-in) to the new account by **verified** email.
- Development: there is no separate development identity any more; local runs use the same accounts.
  Identity emails are captured in the development mailbox (`devMailbox` table, `/dev/mailbox`,
  `/api/dev/mailbox`, guarded by `FOLEVI_DEV_MAILBOX_SECRET`) and refused when `FOLEVI_ENV=production`;
  `scripts/check-prod-env.mjs` fails a production build if the secret is set.
- Mac: the native app still contains code for the previous provider and **cannot sign in right now**.
  It will move to Authorization Code + PKCE against Folevi's own accounts after the web app is
  finalized (`docs/MACOS.md`).

## Data model (convex/schema.ts)

Content tables all carry `workspaceId` and a `seq` stamped from the workspace change counter:

- `profiles`, `workspaces`, `workspaceMembers`, `workspaceInvites`
- `folders` (one level of nesting), `tags`, `documentTags`, `stars`, `recents`
- `documents` — title, icon, cover, style, kind (`document | daily | template | collectionRow`; `daily` is a retired kind shown as an ordinary page), parent,
  folder, access mode, revision/titleRev, derived search text and counts
- `blocks` — the canonical block rows (`blockId`, `parentId`, `rank`, `type`, `schemaVersion`, `text`,
  `props`, `revision`, `contentRev`, `positionRev`, `deletedAt`)
- `documentSnapshots` (+ `snapshotChunks` for large pages) — version history
- `tasks` — a projection of `todo` blocks (the block is canonical)
- `documentLinks` — backlink index
- `collections`, `collectionProperties`, `collectionRows` (each row is a page), `collectionValues`,
  `collectionViews`
- `commentThreads`, `comments`, `readStates`, `notifications`
- `documentPermissions`, `publicLinks` (token hashes only)
- `files`, `uploadIntents`
- `syncOperations` (idempotency log), `sessionsMirror` (device labels), `presence`
- `devMailbox` (non-production only: captured identity emails)
- Better Auth component tables (`convex/betterAuth/schema.ts`): users, sessions, credential accounts,
  verification tokens, two-factor secrets and backup codes, JWKS, rate limits
- `emailSendAttempts`, `emailProviderEvents` (signed Loops webhooks only)
- `featureFlags`, `systemSettings`, `builtInTemplates`, `rateLimits`, `rateLimitEvents`
- `adminAuditLogs` (append-only), `deletionJobs`, `metrics`, `metricsDaily`, `deployments`

Authorization is centralized in `convex/lib/auth.ts` (`requireProfile`, `requireWorkspace`,
`documentAccess`, `requireDocument`, `requirePlatformRole`). Client-supplied user ids, roles, workspace
ownership and storage ids are never trusted; `tests/convex/static/invariants.test.ts` fails CI if a public
function lacks an authorization call.

## Editing and sync

Both clients edit a local copy and send idempotent operations (`docs/SYNC_PROTOCOL.md`):

- **Web:** Tiptap/ProseMirror with a custom flat schema (one node per block type with `id` + `depth`).
  `components/editor/convert.ts` maps editor ⇄ canonical blocks (keeping ranks stable via
  `assignTreePositions`), and `diffBlocks` turns edits into `block.upsert`/`block.delete` ops. The web
  sync engine (`lib/sync/engine.ts`) wraps the shared reducer from `@folevi/editor-schema`, persists every
  change to IndexedDB before sending, and reconciles subscriptions.
- **Mac:** a native NSTextView-per-block editor feeding a Swift port of the same reducer and a durable
  SQLite op log; it pulls by workspace sequence (`sync.pullJson`) and pushes with `sync.pushJson`.
- The server (`convex/lib/syncEngine.ts`) enforces the protocol: idempotency by `opId`, content
  conflicts by `contentRev` vs `baseRevision`, last-writer-wins positions, tombstones, parent
  normalization, and post-batch bookkeeping (search text, task projection, backlinks, mentions).

## Files

Two-phase upload: `files.generateUploadUrl` (authorized, size/type/quota checked) → direct upload to
Convex storage → `files.finalize` action (re-reads the bytes, verifies size and SHA-256, sniffs the real
type, rejects active content, strips JPEG/PNG/GIF/WebP metadata, records the file). A daily sweep
deletes stored blobs no table references (uploads never finalized) after a 24-hour grace period, and
export ZIPs after a day; any new table that stores `Id<"_storage">` must be added to
`isStorageReferenced` in `convex/files.ts`. Files are served only through
`/files/:id` on the Convex HTTP router with short-lived HMAC-signed URLs, `nosniff`, a sandboxing CSP and
`Content-Disposition: attachment` for anything but images/PDF.

## Email

`packages/email` defines every template (manifest, MJML, plain text, variable schema). Convex actions send
through the Loops transactional API with idempotency keys, bounded retries and a local attempt log.
Identity emails (email confirmation, password reset) are created by Better Auth in `convex/auth.ts` and
sent by `convex/authEmails.ts` through the same Loops pipeline; outside production they are also written
to the development mailbox. Details: `docs/EMAIL_DECISION.md`, `docs/EMAIL_OPERATIONS.md`.

## Background jobs (convex/crons.ts)

Deletion cascades (bounded, self-rescheduling), task reminders, presence cleanup, Trash retention (30
days), tombstone retention, housekeeping (idempotency log, rate-limit windows, upload intents, expired
invites, old notifications), snapshot retention, daily digest, orphaned-upload sweep and export
retention, daily aggregate metrics.

## Offline and PWA

- Durable op log and last-known documents in IndexedDB (per account; cleared on sign-out).
- Service worker (`public/sw.js`): cache-first for hashed static assets, network-first for product
  navigations with the last good shell kept for offline boot; never caches `/api`, `/auth`, `/admin`,
  share pages or cross-origin requests.
- Offline cold start: while online, the app keeps a snapshot of the profile and workspace list in the
  account's IndexedDB (`lib/app/offlineSnapshot.ts`; localStorage only remembers which account database
  to open). If Folevi is opened when neither the auth server nor Convex can be reached, it opens that
  folio from the snapshot and cached documents instead of a dead end, and switches to live data on
  reconnect. Sign-out deletes the snapshot with the rest of the local data.
- Visible status (Saved / Saving / Offline + pending count / Syncing / Conflict / Error) that only says
  Saved after server acknowledgement; its details popover lists the pages with changes still waiting
  on this device (`lib/hooks/usePendingDocs.ts`, also used for unsynced markers on document cards).

## Localization

UI strings move into an ICU-style catalog (`apps/web/src/i18n`); dates and numbers go through Intl
helpers, never a hard-coded locale. See `docs/LOCALIZATION.md`.
