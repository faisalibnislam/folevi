# Folevi sync protocol (v1)

This document is normative. The TypeScript implementation lives in
`packages/editor-schema/src/sync.ts` (client reducer) and `convex/sync.ts` (server). The Swift
implementation lives in `apps/macos/Folevi/Sync/`. Both clients run the same golden scenarios in
`packages/editor-schema/fixtures/sync-scenarios.json`.

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
| Device ID | 26-char ULID, stored once per install (IndexedDB `meta.deviceId` on web, Keychain-independent `UserDefaults` value on Mac — it is not a secret) | client |
| Operation ID (`opId`) | ULID, unique per operation, doubles as the idempotency key | client |
| Block ID | ULID, stable for the life of the block (survives moves, edits, restore) | client |
| Document ID | ULID ("public id"), stable across clients; Convex `_id` is never exposed as identity | client or server |

## Entities and revisions

Every block row on the server has:

- `revision` — increments on every accepted change.
- `contentRev` — the `revision` at which `type`, `text` or `props` last changed.
- `positionRev` — the `revision` at which `parentId` or `rank` last changed.
- `seq` — the workspace change sequence number at which the row last changed (see *Pull*).
- `deletedAt` — tombstone timestamp or absent.

Documents carry the same fields; `titleRev` plays the role of `contentRev` for the title, and style/icon/
cover changes are last-writer-wins (they are small, visible, and captured by version snapshots).

## Ordering

Siblings are ordered by `(rank, id)`. Ranks are base-62 fractional index strings
(`packages/editor-schema/src/rank.ts`, mirrored in Swift `Domain/Rank.swift`). Clients never use array
offsets as identity. Inserting between two siblings uses `rankBetween(prev, next)`. When a rank exceeds
`LIMITS.maxRankLength`, the server rebalances the sibling list inside a single mutation
(`blocks.rebalance`) and bumps `positionRev` for every rewritten block.

## Operations

```ts
type SyncOp =
  | { opId; kind: "block.upsert"; documentId; block: WireBlock; baseRevision: number | null; fields: ("content" | "position")[] }
  | { opId; kind: "block.delete"; documentId; blockId; baseRevision: number | null }
  | { opId; kind: "block.restore"; documentId; blockId }
  | { opId; kind: "document.create"; document: WireDocumentCreate }
  | { opId; kind: "document.update"; documentId; patch: WireDocumentPatch; baseRevision: number | null };
```

`fields` states what the client changed relative to `baseRevision`. `baseRevision: null` means "create".
`WireDocumentCreate` may carry an optional `workspaceId` (see *Routing*).

## Routing

A batch is sent as `sync.push({ workspaceId, deviceId, ops })`. The `workspaceId` is only the batch's
**routing workspace**; it does not scope the batch:

- `block.*` and `document.update` ops are authorized against **the document they touch** (its
  workspace role or an explicit grant — see `documentAccess`). One batch may mix documents from several
  workspaces, so a person editing a page shared from another workspace ("Can edit" grant, no
  membership) or opened from a deep link while another workspace is selected uses the same queue.
  Every accepted change stamps the **document's** workspace `changeSeq`.
- `document.create` goes, in order of precedence: under `parentDocumentId` (a nested page always lives
  in its parent's workspace; the caller needs write access to the parent), else into
  `document.workspaceId`, else into the routing workspace. In every case the caller must be an editor
  (or higher) **member** of that workspace — a grant on one page never lets a guest add pages to
  someone else's workspace (`forbidden`). An unknown workspace or one the caller doesn't belong to →
  `not_found` (existence isn't revealed).
- `document.update` may only re-parent a page under a page of the same workspace.
- If the caller isn't a member of the routing workspace (e.g. removed since the ops were queued), the
  batch still runs: each op succeeds or is rejected on its own merits. Nothing is thrown for the batch.

Clients keep **one durable queue per account**, not per workspace. The web client stamps each queued
`document.create` without a parent with the workspace selected when it was queued, so switching
workspaces before the op syncs can't change where the page lands. (Older web builds kept one queue per
workspace id; on first open they are folded into the account queue in a single IndexedDB transaction,
preserving per-queue order and stamping their creates with their workspace.)

## Server rules (`convex/sync.ts#applyOperations`)

For each operation, in order, inside one mutation per batch (max 100 ops):

1. **Authorize** the caller for write access on the document the op touches (derived server-side from
   the JWT subject and the document's own workspace/grants; client-supplied user/workspace ids are never
   trusted — see *Routing*).
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
   - Otherwise apply, bump `revision`, and bump `contentRev` / `positionRev` as appropriate.
   - Updating a tombstoned block → `conflict` with `reason: "deleted"`.
6. **Delete** sets `deletedAt` (tombstone) on the block and its descendants. Always `applied`; the
   content stays recoverable from Trash/version history until the retention job removes it.
7. Every accepted change increments the workspace `changeSeq`, stamps rows with `seq`, updates the task
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

### Derived label caches

Pages that link to a document cache its title: page blocks in `props.titleCache`/`props.iconCache`,
inline links in the `pageLink` node's `label` (including table cells). When a `document.update`
changes the title or icon, the server rewrites those caches in every linking block (found through the
backlink index) in the same mutation. The rewrite bumps the block's `revision` and `seq` — clients
receive it like any remote change — but **not** `contentRev`, because it is derived data: it never
turns someone's concurrent edit of that block into a conflict.

## Client rules (`packages/editor-schema/src/sync.ts`)

The client state is `{ entities, pending, inflight, conflicts, status }`, persisted after every change
(IndexedDB on web, SQLite on Mac). Pure reducer functions:

- `localUpsert / localDelete / localRestore` — apply optimistically, append an op to `pending`. An op
  that is not in flight is **coalesced** with a later op on the same block (create+update → create,
  update+update → one update with the union of `fields`, create+delete → both dropped).
- `takeBatch` — moves up to 100 ops, in order, to `inflight`.
- `applyResults` — `applied`/`duplicate` → record `revision` as the new base, drop the op;
  `conflict` → adopt the server version locally, store the client version in `conflicts`;
  `rejected` → drop the op, revert to the last acknowledged server state and surface the error.
- `batchFailed(kind)` — network error or `unauthenticated`: move `inflight` back to the front of
  `pending` unchanged (same `opId`s, so replays are safe).
- `remoteUpdate` — a subscribed/pulled server row replaces the local entity only when there is no
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

1. Refresh credentials (web: `/api/auth/token`; Mac: `CredentialsManager`). On failure → status
   `Error` with a sign-in prompt; ops stay pending.
2. Re-establish subscriptions (Convex client does this automatically; web re-subscribes on its own).
3. Pull changes since the stored cursor (`sync.pull`, paginated by `seq`) and feed each row through
   `remoteUpdate`.
4. Upload pending ops in order with `takeBatch` → `sync.applyOperations` → `applyResults`.
5. Surface conflicts; mark `Saved` only when `pending` and `inflight` are empty.

## Pull

`sync.pull({ workspaceId, cursor, limit })` is per workspace (members only) and returns rows (documents and blocks, including tombstones)
with `seq > cursor` ordered by `seq`, plus `nextCursor` and `hasMore`. Because each accepted mutation
reads and writes the workspace `changeSeq`, Convex's serializable transactions guarantee sequence
numbers are assigned in commit order; a cursor can never skip a committed change. The Mac app
subscribes to `sync.head` (just the workspace `changeSeq`) and pulls when it advances.

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
expected client state; the TypeScript and Swift reducers must produce identical canonical JSON.

## Logging

Sync logs contain op ids, kinds, entity ids, revisions and status codes only — never block text,
titles, attachment names or contents, tokens, or email addresses.
