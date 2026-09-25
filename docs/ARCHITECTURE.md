# Architecture

## Overview

```
 Browser (folevi.com, app.folevi.com)            Mac (Folevi.app)
 ┌───────────────────────────────┐               ┌──────────────────────────────┐
 │ Next.js 16 on Vercel           │               │ SwiftUI + AppKit             │
 │  • marketing (static)          │               │  • NSTextView block editor   │
 │  • product shell (1 catch-all) │               │  • SQLite store (actor)      │
 │  • admin console               │               │  • Sync reducer (Swift port) │
 │  • /api/auth/token → ID token  │               │  • Auth0.swift + Keychain    │
 │ IndexedDB: op log + cache      │               │  • Convex Swift client       │
 └──────────────┬────────────────┘               └──────────────┬───────────────┘
                │ WebSocket (queries, mutations)                 │
                ▼                                                 ▼
          ┌──────────────────────────── Convex ─────────────────────────────┐
          │ auth.config: Auth0 (web + native client ids), dev issuer (local) │
          │ lib/auth.ts — every read/write authorized server-side            │
          │ sync.ts — push (idempotent ops), pull (by workspace seq), head   │
          │ documents/blocks/tasks/comments/sharing/collections/search/files │
          │ admin.ts + adminAuditLogs (append-only)                          │
          │ email.ts → @folevi/email → Loops · identity.ts → Auth0 Mgmt API  │
          │ crons: deletion jobs, reminders, retention, digest, metrics      │
          └──────────────────────────────────────────────────────────────────┘
```

## Hosts and routing

One Next.js app serves three surfaces. `proxy.ts` (Next 16's middleware) routes by host: marketing
paths redirect to `folevi.com`, product/admin paths redirect to `app.folevi.com`, and `www` redirects to
the apex. Locally the hosts are `localhost:3000` and `app.localhost:3000`.

The product is a single catch-all route (`src/app/(app)/[...path]`) that renders a client shell. Inside
it, navigation uses `history.pushState` (kept in sync with `usePathname`), so moving between views never
round-trips to the server and keeps working offline. Every document, nested page, folder, tag, task view
and settings section has a stable, shareable URL (`/d/:id`, `/folders/:id`, `/tasks/today`, …). The
server part of that route only checks for a session and renders no private data, which is what makes it
safe for the service worker to keep a copy for offline boot.

## Identity

- **Auth0** is the identity provider for both clients (decision and alternatives: `docs/EMAIL_DECISION.md`
  covers the email side; Auth0 was chosen because it supports Next.js server sessions, native Authorization
  Code + PKCE via Auth0.swift, email/password, verified email, authenticator TOTP with recovery codes,
  attack protection, and works with Convex's JWT validation).
- Web: `@auth0/nextjs-auth0` v4 — encrypted HTTP-only SameSite cookies, rolling sessions. The browser
  never sees refresh tokens; it fetches a short-lived **ID token** from `/api/auth/token` (same-origin
  only) and hands it to the Convex client.
- Mac: Auth0.swift (Universal Login in `ASWebAuthenticationSession`, PKCE), credentials in the Keychain.
- Convex validates issuer, audience (one entry per Auth0 client id), expiry and signature.
  `lib/auth.ts` additionally requires the `email_verified` and `https://folevi.com/mfa` claims set by the
  Post-Login Action (`infra/auth0/actions/post-login.js`), rejects suspended/deleted accounts, and rejects
  sessions revoked in the product's session mirror.
- **Development identity** (local only): `scripts/setup-local.mjs` creates an RSA key; the web app mints
  tokens for a dev session cookie, and the local Convex deployment trusts that issuer via a data-URI JWKS.
  Guards: `FOLEVI_DEV_AUTH=1` required, disabled when `VERCEL_ENV=production`, Convex ignores it when
  `FOLEVI_ENV=production`, and `scripts/check-prod-env.mjs` fails production builds if any dev variable
  is present.

## Data model (convex/schema.ts)

Content tables all carry `workspaceId` and a `seq` stamped from the workspace change counter:

- `profiles`, `workspaces`, `workspaceMembers`, `workspaceInvites`
- `folders` (one level of nesting), `tags`, `documentTags`, `stars`, `recents`
- `documents` — title, icon, cover, style, kind (`document | daily | template | collectionRow`), parent,
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
- `syncOperations` (idempotency log), `sessionsMirror`, `presence`
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
type, rejects active content, strips JPEG/PNG metadata, records the file). Files are served only through
`/files/:id` on the Convex HTTP router with short-lived HMAC-signed URLs, `nosniff`, a sandboxing CSP and
`Content-Disposition: attachment` for anything but images/PDF.

## Email

`packages/email` defines every template (manifest, MJML, plain text, variable schema). Convex actions send
through the Loops transactional API with idempotency keys, bounded retries and a local attempt log.
Identity emails (verification, reset…) are produced by Auth0 and delivered through the Custom Email
Provider Action → Loops. Details: `docs/EMAIL_DECISION.md`, `docs/EMAIL_OPERATIONS.md`.

## Background jobs (convex/crons.ts)

Deletion cascades (bounded, self-rescheduling), task reminders, presence cleanup, Trash retention (30
days), tombstone retention, housekeeping (idempotency log, rate-limit windows, upload intents, expired
invites, old notifications), snapshot retention, daily digest, daily aggregate metrics.

## Offline and PWA

- Durable op log and last-known documents in IndexedDB (per account; cleared on sign-out).
- Service worker (`public/sw.js`): cache-first for hashed static assets, network-first for product
  navigations with the last good shell kept for offline boot; never caches `/api`, `/auth`, `/admin`,
  share pages or cross-origin requests.
- Visible status (Saved / Saving / Offline + pending count / Syncing / Conflict / Error) that only says
  Saved after server acknowledgement.
