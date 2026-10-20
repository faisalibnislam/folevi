# @folevi/local-store

The library format and merge behind "Keep notes on my devices" (docs/LOCAL_MODE_PLAN.md §3). It is pure TypeScript (WebCrypto, TextEncoder and fflate), so the same code runs in the app's web view, in Node tests, and as the reference that the Mac and iOS file layers are checked against. It depends only on `@folevi/editor-schema`.

## The folder

```
folevi-library.json            format, libraryId, createdAt, minWriterVersion, encryption header or null
notes/<docId>.fnote            one note per file: canonical JSON with a sha256 `sum`
files/<aa>/<sha256>            attachments, content addressed, written once
history/<docId>/<name>.fver    versions, gzip of canonical JSON, immutable
index/library.findex           folders, tags, settings, permanently deleted notes (a CRDT)
index/catalog/<deviceId>.fcat  one writer: title, folder and trash hints for a fast cold start
devices/<deviceId>.json        one writer: name, platform, lastSeen, heads
.folevi-tmp/                   temp files for atomic rename
```

## A note file

Each field carries the stamp of its last write. Stamps are hybrid logical clocks, `<ms base36, 9>-<counter base36, 4>-<deviceId>`, so string order is time order with the device id breaking ties. The local clock never runs more than 5 minutes past wall time, whatever a remote stamp says.

- `doc`: registers `{v, c, cv}` for the title, icon, folder, parent, rank, style, cover, starred, archive and trash; `tags` as `{add, rm}`.
- `blocks`: per block, the content group (`type`, `schemaVersion`, `text`, `props`, `deleted`, `by`) with its version vector `cv`, then `parentId`/`rank` and `collapsed`, each with its own stamp in `c`.
- `files`, `fileText`, `versionNames`, `collections`, `row`: last writer wins per key.
- `notices`: "Changed on another device" records; `seen`: per device, the newest stamp the file holds; `compacted`: vectors of tombstones removed by compaction.

A permanent delete leaves a stub, `{format, v, id, deleted: {c}, seen, sum}`, kept for 180 days.

## The merge

`mergeNoteFiles(a, b)` is commutative and idempotent, and the content it produces doesn't depend on merge order.

- Content: if one side's `cv` covers the other's, it wins. Otherwise the edits were concurrent: the newer `c` wins, the winner takes both vectors, and the other becomes a `Loss`. A delete counts as a content write.
- Each loss is written to `history/<doc>/<loser c>-<dev>-conflict-<hash>.fver` before any note without it is written, and a notice on the block points at that file. The name and bytes depend only on what lost, so two devices merging the same pair write the same file.
- Position and `collapsed` are last writer wins, with no notice. Tags are add wins. Notices are a union; dismissal is last writer wins. `seen` is a pointwise max.
- A stub drops only what it has seen. If a note has a stamp the stub didn't see, the note comes back in Trash with a "restored" notice.
- On read, `normalizeBlocks` moves blocks with a missing or deleted parent to the top level and breaks cycles at the block moved last. Siblings sort by (rank, id).

The golden scenarios in `fixtures/merge-scenarios.json` cover each rule. Their source is `scripts/merge-scenarios.py`.

## Files

`LocalFs` is the library part of the bridge contract (§4.1): `list`, `read`, `write` with `ifMatch`, `remove`, `conflictVersions`, `resolveConflicts`. Every write is read-merge-write (`readMergeWrite`). A file that can't be read, parsed, checksummed or decrypted is treated as not arrived yet and is never overwritten. `NoteReplica` brings a device's notes and the folder into step: it ingests changed files and the copies providers make (Dropbox, iCloud on the Mac, Drive and OneDrive names, NSFileVersion conflicts), flushes, deletes copies only after a successful write, and keeps re-asserting local state until the file holds it.

## Encryption

`crypto/envelope.ts` is the reference for the FLV1 envelope: PBKDF2-SHA256 wraps a random master key; HKDF-SHA256 derives a key per file from its canonical path; files are AES-256-GCM, and attachments use 64 KiB STREAM chunks so they can be read by byte range. Names are HMACs of ids. `EncryptedFs` does all of this transparently around a `LocalFs`, the way the native layers do. The vectors in `fixtures/crypto-vectors.json` are checked against node:crypto, and natives must reproduce them. In the apps the key stays in native code; the TypeScript version is for tests and the FakeShell.

## Tests

- `merge-scenarios.test.ts`: the golden scenarios, plus commutativity, idempotence and absorption at every merge.
- `convergence.test.ts`: 2 to 4 devices make random concurrent edits through `FaultyCloud`, which delays, duplicates, reorders, truncates, makes conflict copies and loses updates, also through `EncryptedFs`. It asserts that every replica and the folder end identical, and that every edit is live, in history, or knowingly superseded.
- `crypto.test.ts`, `files.test.ts`, `format.test.ts`, `web-runtime.test.ts`: vectors and tampering, conflict-copy names, the never-overwrite rule, the codecs, history thinning, the index, catalogs, garbage collection, compaction and the journal.

`UPDATE_GOLDEN=1 npx vitest run` rewrites the golden checksums and vectors after an intended format change.
