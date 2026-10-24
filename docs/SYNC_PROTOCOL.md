# Folevi sync protocol (v1)

This document is normative. The TypeScript implementation lives in
`packages/editor-schema/src/sync.ts` (client reducer) and `convex/sync.ts` (server). The reducer runs the
golden scenarios in `packages/editor-schema/fixtures/sync-scenarios.json`. Folevi for Mac runs the web client
built in (`docs/DESKTOP.md`), so the web client is the only one; the retired native Swift client is archived
on the tag `native-mac-archive`.

## Goals and non-goals

- Writing never blocks on the network. Every edit is applied locally first and recorded durably.
- The server is the only authority on revisions. A client never shows "Saved" before the server has
  acknowledged the operation that produced the visible state.
- Concurrent edits to **different blocks** always merge. Concurrent edits to the **same block's
  content** produce an explicit, typed conflict. Both versions are preserved until a person decides.
- Folevi v1 is **not** a character-level CRDT. Two people typing in the same paragraph at the same
  time will see a conflict banner, never silently interleaved or lost text.

## Identity

| Thing | Format | Created by |
| --- | --- | --- |
| Device ID | 26-char ULID, stored once per install (IndexedDB `meta.deviceId`; it is not a secret) | client |
| Operation ID (`opId`) | ULID, unique per operation, doubles as the idempotency key | client |
| Block ID | ULID, stable for the life of the block (survives moves, edits, restore) | client |
| Document ID | ULID ("public id"), stable across clients; Convex `_id` is never exposed as identity | client or server |

## Entities and revisions

Every block row on the server has:

- `revision`: increments on every accepted change.
- `contentRev`: the `revision` at which `type`, `text` or `props` last changed.
- `positionRev`: the `revision` at which `parentId` or `rank` last changed.
- `seq`: the change sequence number of the row's **scope** at which it last changed (see *Pull*).
- `deletedAt`: tombstone timestamp or absent.

Documents carry the same fields; `titleRev` plays the role of `contentRev` for the title, and style/icon/
cover changes are last-writer-wins (they are small, visible, and captured by version snapshots).

## Ordering

Siblings are ordered by `(rank, id)`. Ranks are base-62 fractional index strings
(`packages/editor-schema/src/rank.ts`). Clients never use array
offsets as identity. Inserting between two siblings uses `rankBetween(prev, next)`. When a rank exceeds
`LIMITS.maxRankLength`, the server rebalances the sibling list inside a single mutation
(`blocks.rebalance`) and bumps `positionRev` for every rewritten block.

## Operations

```ts
type SyncOp =
  | { opId; kind: "block.upsert"; documentId; block: WireBlock; baseRevision: number | null; fields: ("content" | "position" | "collapsed")[] }
  | { opId; kind: "block.delete"; documentId; blockId; baseRevision: number | null }
  | { opId; kind: "block.restore"; documentId; blockId }
  | { opId; kind: "document.create"; document: WireDocumentCreate }
  | { opId; kind: "document.update"; documentId; patch: WireDocumentPatch; baseRevision: number | null };
```

`fields` states what the client changed relative to `baseRevision`. `baseRevision: null` means "create".
`WireDocumentCreate` may carry an optional `scope` (or, from older clients, `workspaceId`); see *Routing*.

## Scopes

Content lives in exactly one **scope**: a person's **Personal** (rows carry `ownerProfileId`) or a team
**workspace** (rows carry `workspaceId`). Personal is not a workspace. Clients name a scope as
`{ kind: "personal" }` (always the caller's own Personal; a profile id is never accepted) or
`{ kind: "workspace", workspaceId }` (the workspace's public id; membership required). Each scope has its
own change counter, a row in `scopeCounters` keyed by scope (`convex/lib/seq.ts`). It lives apart from the
profile and workspace rows, which nearly every query reads, so an edit doesn't re-run them all. A scope
without a counter row yet continues from the older `profiles.personalChangeSeq` / `workspaces.changeSeq`.

## Routing

A batch is sent as `sync.push({ scope, deviceId, ops })`. The `scope` is only the batch's **routing
scope**; it does not scope the batch:

- `block.*` and `document.update` ops are authorized against **the document they touch** (its owner,
  its workspace role, or an explicit grant; see `documentAccess`). One batch may mix documents from
  several scopes, so a person editing a page shared with them from someone's Personal or another
  workspace ("Can edit" grant, no membership) or opened from a deep link while another scope is selected
  uses the same queue. Every accepted change stamps the **document's** scope counter.
- `document.create` goes, in order of precedence: under `parentDocumentId` (a nested page always lives
  in its parent's scope; the caller needs write access to the parent), else into `document.scope` (or
  the older `document.workspaceId`), else into the routing scope. Personal takes new pages from its owner
  only; a workspace from **members** who can edit (owner, admin, or member with edit access). A grant on one page never lets a guest add pages
  to someone else's Personal or workspace (`forbidden`). An unknown workspace or one the caller doesn't
  belong to → `not_found` (existence isn't revealed); a malformed `scope` → `invalid_argument`.
- `document.update` may only re-parent a page under a page of the same scope, and only move it into a
  folder of the same scope. Pages never move between Personal and a workspace this way. A guest (grant,
  no membership) may only re-parent a page under another page they can edit (never to the top level or
  into a folder), and taking a page out from under a restricted page needs manage access (`forbidden`).
- A resent op id is answered from the first delivery only when it names the same entity and kind; an op
  id reused for anything else is `rejected` (`invalid_op`), and a replay never returns a page or block the
  caller can no longer open.
- If the caller isn't a member of the routing workspace (e.g. removed since the ops were queued), the
  batch still runs: each op succeeds or is rejected on its own merits. Nothing is thrown for the batch.

Clients keep **one durable queue per account**, not per scope. The web client stamps each queued
`document.create` without a parent with the scope selected when it was queued, so switching between
Personal and workspaces before the op syncs can't change where the page lands. (Older web builds kept one queue per
workspace id; on first open they are folded into the account queue in a single IndexedDB transaction,
preserving per-queue order and stamping their creates with their workspace.) Creates queued by builds from
before Personal stopped being a workspace name a `workspaceId`; when the engine opens, each is re-stamped
with a `scope`. A workspace the person still belongs to keeps it, and anything else (the old personal
workspace, or one they've left) becomes their Personal, so nothing is sent naming a workspace that no
longer exists. The web's local database (v3) keys its document cache by scope key (`scopeIdKey`) and never
drops the queue or waiting uploads on upgrade.

## Server rules (`convex/sync.ts#applyOperations`)

For each operation, in order, inside one mutation per batch (max 100 ops):

1. **Authorize** the caller for write access on the document the op touches (derived server-side from
   the JWT subject and the document's own scope/grants; client-supplied user/workspace ids are never
   trusted; see *Routing*).
2. **Idempotency**: if `syncOperations` already contains `opId` for this user, return the stored result
   with status `duplicate` and the current entity state. No other effect.
3. **Validate** the block against the canonical schema (known types) and the limits. Unknown types from
   newer clients are stored verbatim. Invalid payloads → `rejected` with a stable error code.
4. **Create** (`baseRevision === null`): if the id is new, insert with `revision = 1`. If the id exists
   with identical content, return `applied` (it is a replay from another path). Otherwise `conflict`.
5. **Update**:
   - `fields` includes `content` and `server.contentRev > baseRevision` and the server content differs
     from the client content → `conflict` (content is not written; position changes in the same op
     are still applied).
   - `position` changes are last-writer-wins. If the new parent is missing or deleted, the block is
     re-parented to the root at the end of the document and the result carries `normalized: true`.
   - `collapsed` (a toggle opened or closed, and nothing else) writes only `props.collapsed`,
     last-writer-wins, without bumping `contentRev`: it never conflicts with an edit of the text.
   - Otherwise apply, bump `revision`, and bump `contentRev` / `positionRev` as appropriate.
   - Updating a tombstoned block → `conflict` with `reason: "deleted"`.
6. **Delete** sets `deletedAt` (tombstone) on the block and its descendants, unless the block's
   `contentRev > baseRevision`, or (for a delete with a `baseRevision`) a live descendant is not deleted
   by the same batch with a base no older than its `contentRev`: then `conflict` (`reason: "content"`, `client: null`) and nothing is
   deleted. Clients delete every block they remove, deepest first. The content of a deleted block stays
   recoverable from Trash/version history until the retention job removes it.
7. Every accepted change increments its scope's counter, stamps rows with `seq`, updates the task
   projection for `todo` blocks, updates the document search text, and records the op result in
   `syncOperations` (retained 30 days).

Result shape:

```ts
type OpResult = {
  opId: string;
  status: "applied" | "duplicate" | "conflict" | "rejected";
  revision?: number;          // authoritative revision after the op
  block?: WireBlock;          // normalized server state (applied/duplicate/conflict)
  document?: WireDocument;
  conflict?: { reason: "content" | "deleted" | "exists"; server: WireBlock; client: WireBlock };
  error?: { code: string; message: string };
  normalized?: boolean;
};
```

Errors that apply to the whole batch (unauthenticated, suspended account, maintenance mode) are thrown
as `ConvexError({ code })` and the client keeps every op pending. Workspace-level problems (not a
member, workspace suspended, template disabled by an admin) are per-op `rejected` results.

### Synced blocks

Synced content (`docs/SYNCED_BLOCKS.md`) is a document of kind `synced`, created with `document.create` (no
parent, folder or template) and edited with block ops like any note. A `block.upsert` of a `synced` block that
starts showing a piece of content needs read access to it (`not_found` otherwise), and one inside synced content
is `invalid_block`. Access to synced content comes from the notes in its place that show it, so it can change
when those notes change.

### Derived label caches

Pages that link to a document cache its title: page blocks in `props.titleCache`/`props.iconCache`,
inline links in the `pageLink` node's `label` (including table cells). When a `document.update`
changes the title or icon, the server rewrites those caches in every linking block (found through the
backlink index) in the same mutation. The rewrite bumps the block's `revision` and `seq` (clients
receive it like any remote change) but **not** `contentRev`, because it is derived data: it never
turns someone's concurrent edit of that block into a conflict.

## Client rules (`packages/editor-schema/src/sync.ts`)

The client state is `{ entities, pending, inflight, conflicts, status }`, persisted after every change
(IndexedDB). Pure reducer functions:

- `localUpsert / localDelete / localRestore`: apply optimistically, append an op to `pending`. An op
  that was never sent is **coalesced** with a later op on the same block (create+update → create,
  update+update → one update with the union of `fields`, create+delete → both dropped). An op that was
  sent (`sent: true`, kept when a failed batch is queued again) never changes: a resend is answered as a
  replay of its first copy.
- `takeBatch`: moves up to 100 ops, in order, to `inflight`, marking them `sent`. A second upsert or
  delete of a block already upserted in the batch waits for the next batch (it is rebased on the answer).
- `applyResults`: `applied`/`duplicate` → record `revision` as the new base, drop the op;
  `conflict` → adopt the server version locally, store the client version in `conflicts`;
  `rejected` → drop the op, revert to the last acknowledged server state and surface the error.
- `batchFailed(kind)`: network error or `unauthenticated`: move `inflight` back to the front of
  `pending` unchanged (same `opId`s, so replays are safe).
- `remoteUpdate`: a subscribed/pulled server row replaces the local entity only when there is no
  pending or in-flight op for it; otherwise it only advances the known server revision for display.

### Status shown to people

| Status | Meaning |
| --- | --- |
| Saved | no pending/inflight ops, connected, last batch acknowledged |
| Saving | ops in flight or queued while connected |
| Offline | not connected; edits are stored on this device (count shown) |
| Syncing | reconnect pipeline running |
| Conflict | at least one unresolved conflict |
| Error | a rejected op or repeated batch failure; the details popover explains and offers retry |

## Reconnect pipeline

1. Refresh credentials (`/api/auth/token`). On failure → status
   `Error` with a sign-in prompt; ops stay pending.
2. Re-establish subscriptions (Convex client does this automatically; web re-subscribes on its own).
3. Pull changes since the stored cursor (`sync.pull`, paginated by `seq`) and feed each row through
   `remoteUpdate`.
4. Upload pending ops in order with `takeBatch` → `sync.applyOperations` → `applyResults`.
5. Surface conflicts; mark `Saved` only when `pending` and `inflight` are empty.

## Pull

`sync.pull({ scope, cursor, limit })` is per scope (your own Personal, or a workspace you're a member of)
and returns the rows you can read (documents and blocks, including tombstones) with `seq > cursor`
ordered by `seq`, plus `nextCursor`, `hasMore` and `head`. Because each accepted mutation reads and
writes its scope's counter, Convex's serializable transactions guarantee sequence numbers are assigned in
commit order; a cursor can never skip a committed change. Pages shared with you from someone else's
Personal aren't in your Personal feed (they're in theirs); open them by id. `sync.head({ scope })` returns just the scope's counter,
for a client that wants to pull only when it advances.

## Device copy (R1, docs/NATIVE_APP_PLAN.md §11)

Every note of each place an account works in (its Personal and each team workspace) is kept on the device,
so any note opens from there at once and reads offline, then reconciles with the server. The website, the PWA
and today's iPhone, iPad and Mac apps all get it from the web data layer. Built 2026-10-24.

**Server** (`convex/sync.ts`), all permission-checked like `pull`, bounded, and on the existing `by_*_seq`
indexes (no schema change, no migration):

- `sync.manifest({ scope, after, limit ≤ 500 })`: the scope's notes in seq order, each with its summary and its
  content head (the highest seq among its block rows, deleted ones included: one indexed read). The first
  page's `head` is where keeping the copy fresh starts. Reads no blocks.
- `sync.pullDocs({ ids ≤ 50 })`: whole notes as `blocks.list` returns them, any scope the caller can open;
  `status` ok, missing, sealed or later (one call reads at most about 3,000 blocks).
- `sync.pullAll({ scope, cursor, limit ≤ 500 })` (pull v2): `pull` plus each block row's `seq`, the scope's
  folders and tags, and `removed` (notes, folders and tags deleted for good). Pages never split a change.
- Tombstones (`e2eeTombstones`) are now written for every space, not only encrypted ones, so a note purged
  from Trash in a Standard space reaches devices. `e2ee.pull` still returns nothing for a space that never set
  encryption up.
- Notes sealed by end-to-end encryption, or locked, never travel with content through these: ids only. Their
  space's replica keeps them.

A note's `contentSeq` settles only every 30 seconds while someone types (`lib/editSettle.ts`), so it can't
say whether a copy is whole; the content head can, and a delta page carries the seq of each block it brings.

**Client** (`apps/web/src/lib/sync/deviceCopy.ts`, run by `components/app/DeviceCopyRunner.tsx`): no new
IndexedDB version. It fills the stores the app already reads offline in the account's database
(`folevi-<account>`): `documents` (list rows, by scope, now with `copyGen` and `head`) and `blocks` (a note's
whole content, with `head`, `by` and `scopeKey`); progress per scope is `meta` `copy:<scope key>`. The engine's
queue and the outbox stay where they were and stay on top. Per scope it lists (resumable), fills the notes
whose blocks entry is missing or older than the manifest's head (20 at a time, notes on screen and recently
changed first, in idle time, never while someone types or has just opened a note), then keeps fresh with
`pullAll` when the current scope's `sync.head` moves (while the page is visible; a second of quiet, at most
every 3 seconds), on coming back to the app, on reconnecting and every 5 minutes. Kept blocks are replaced
only by a revision at least as new. Weekly, or when the last pull is older than a week (block tombstones go
after 30 days), it lists again and drops rows the listing didn't see (access taken away). A note with
changes still on the device is never dropped. Failures back off from 2 seconds to a minute.

- Opening a note (`DocumentView`) reads the copy at once (it used to wait 1.5 s online for the server) and
  shows its title and look from the copy's row until `documents.get` answers.
- Lists (`DocumentBrowser`): All notes, folders and Drafts show the copy's rows before the server's first page
  (sorted by updated or created) and offline; Trash, Archive and the rest offline only. Offline search also
  reads the words of every kept note.
- Prefetch on intent: pointer down or touch start on any link to a note, or the mouse resting on one for
  120 ms (fine pointers, not with Data Saver), asks the copy for that note first and starts its
  `documents.get` and `blocks.list` subscriptions for 20 seconds.
- Attachments (`deviceFiles.ts`, Cache Storage `folevi-files-<account>`, index in `meta` `copyFile:<id>`):
  files up to 1 MB always; larger images (to 10 MB, with a 640 px thumbnail made on the device) and files (to
  25 MB) only when large downloads are allowed: Wi-Fi or Ethernet where the browser says (Network Information
  API), or a desktop browser that doesn't; never on cellular, with Data Saver, or in the iPhone and iPad app
  (its bridge doesn't tell the page the network type yet: R2). Budget for large files: 2 GB or 10% of the free
  space (`navigator.storage.estimate`), least recently used first; thumbnails and small files stay. The editor
  shows a kept file when the server's signed link isn't there. Sealed files never come.
- Settings > Offline & sync: "Keep all notes on this device" (per account, on by default, also on the website),
  progress per place, storage used and free, "Download now" and "Remove downloaded copy" (removes only what
  the copy downloaded; never anything waiting to sync, nor notes opened before). Off: no filling; notes opened
  or prefetched are still kept. Not in local mode, and not on a public computer (memory-only database).
- Sign-out removes the copy with the account's database and its attachment cache (`clearAccountData`,
  `clearAllLocalData`); the service worker no longer deletes `folevi-files-*` on update. Each account has its
  own database and each scope its own rows.

**End-to-end encrypted spaces stay encrypted at rest** (owner decision 2026-10-24): the replica's database
(`folevi-e2ee-<scope>`) is wrapped by `lib/e2ee/replica/sealedReplicaDb.ts`, which seals every row, note and
bookkeeping value (the search index too) with AES-256-GCM under a non-extractable device key kept in that
database, and opens them only when the replica loads into memory. Replicas written readable before are sealed
on their first load. `DocumentView` no longer writes a sealed note's blocks to the `blocks` store. The device
copy skips spaces whose level isn't Standard and every sealed or locked note. Honest limit: the key lives
next to the data (as the plan accepts on the web); it protects against reading the files or dumping
IndexedDB, not against code running in the app.

**Cost per active user per month** (Convex Professional list prices assumed: about $2 per million function
calls and $0.20 per GB of database bandwidth beyond what's included; verify before release):

| Item | Heavy user (1,500 notes × 60 blocks, 3 devices, about 3,000 block changes a day) | Typical (200 notes, 2 devices, light editing) |
| --- | --- | --- |
| First fill, once per device | about 80 calls and 95 MB per device (manifest 5, pullDocs 75); 3 devices: about 290 MB, $0.06 once | about 12 calls, 12 MB per device |
| Weekly re-listing | about 60 calls, 70 MB: $0.02 | under 10 MB |
| `sync.head` re-runs on the foreground device (every accepted batch re-runs it) | about 45,000 calls, under 0.1 GB: $0.10 | about 3,000 calls |
| `pullAll` after the head moves (at most every 3 s, mostly the device's own changes) | about 30,000 calls, 0.3 GB: $0.12 | about 2,000 calls, 20 MB |
| **Total added** | **about $0.25 worst case** | **about $0.01 to $0.02** |

Attachments are served by the files HTTP route (Convex file bandwidth and one HTTP action call per file, until
the Cloudflare plan moves files to R2 with signed links): small files of every note once per device, large
ones on Wi-Fi only. For an attachment-heavy account (500 images of 500 KB) that is about 250 MB per device,
once. The plan's saving (server list subscriptions no longer re-running once the copy answers lists) is not
taken yet: lists still subscribe to the server and only show the copy first. So against the 30% margin rule
(Core at $1.99 leaves about $0.74 a month for all costs) the heavy-user worst case fits but uses a third of
it, and the typical user is negligible. Levers ready if usage shows otherwise: skip the pull when the head
moved only for this device's own accepted batches, subscribe to `sync.head` only on the focused tab, limit
"always" attachments to recent and starred notes, and answer lists from the copy (the plan's saving).

Not in R1 (R2, with the native app): silent pushes and background pulls on iOS, the native network and Low
Power signals (`device.conditions`), the sealed space index of §11.6 (R1 seals the whole replica instead),
the database v4 `replicaRows` layout (R1 reuses the existing stores, so no version bump that waits for old
tabs), and Shared with me pages refreshed by `pullDocs` (they're kept when opened or prefetched).

## Attachments

Uploads are two-phase: `files.generateUploadUrl` (authorized, short-lived) → direct upload →
`files.finalize` (server verifies size, sniffed type, checksum and records the file). The image/file
block is created locally with `props.fileId` absent and a local reference; the block op is held back
until the upload finalizes. An interrupted upload stays in the upload queue with exponential backoff
and never blocks unrelated ops.

## Snapshots

Version snapshots are created by `documents.createSnapshot` on idle (2 minutes after the last
acknowledged edit), on window/tab close, and automatically before a restore. The server skips a
snapshot when the document `contentSeq` has not changed since the previous one.

## Golden scenarios

`fixtures/sync-scenarios.json` covers: create offline, edit offline, reorder offline, delete/restore
offline, duplicate delivery, reconnect after token expiry, server rejection, same-block conflict, and
attachment upload interruption. Each scenario is a list of steps with scripted server results and the
expected client state; the reducer must produce identical canonical JSON.

## Logging

Sync logs contain op ids, kinds, entity ids, revisions and status codes only, never block text,
titles, attachment names or contents, tokens, or email addresses.
