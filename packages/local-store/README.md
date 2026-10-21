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

- `doc`: registers `{v, c, cv}` for the title, icon, folder, parent, rank, style, cover, starred, archive, trash and a daily note's day; `tags` as `{add, rm}`.
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

## End-to-end encryption (`@folevi/local-store/e2ee`)

`crypto/e2ee/` is the crypto core for encrypted Folevi spaces (docs/E2EE_DESIGN.md §4), shared by the web app, the Mac app and Convex (which only seals). Every format starts with a 4-byte magic and a mode byte, so `envelopeKind` recognises all of them next to modes `0x01` and `0x02` above.

| Format | Layout | Used for |
| --- | --- | --- |
| FLV1 `0x03` keyed record | `"FLV1"` `0x03` flags(1) keyVersion(u32 BE) nonce(12), then AES-256-GCM with AAD = the 22 header bytes ‖ utf8(context) | every sealed field and every symmetric key wrap; flag bit 0 = deflate-raw (used from 1024 bytes when it saves 10 %; readers refuse more than 8 MiB inflated) |
| FLV1 `0x04` keyed stream | `"FLV1"` `0x04` chunkSize(u32 BE, 65536) noncePrefix(8), then chunk i = AES-256-GCM(nonce = prefix ‖ u32 BE(i), AAD = header ‖ context ‖ last flag) | attachment bytes, readable by byte range; the final chunk is always authenticated |
| FLS1 sealed box | `"FLS1"` `0x01` E(32) nonce(12), then AES-256-GCM with k = HKDF(X25519(e, R), salt E ‖ R, "seal/" ‖ context), AAD = header ‖ context | anything sealed to an X25519 public key; all-zero shared secrets are refused |
| FST1 statement | Ed25519 over utf8("folevi/e2ee/v1/statement\n" ‖ kind ‖ "\n") ‖ canonicalJson(body), stored `{ kind, body, sig }` | device, account-key, space-grant and note-grant statements |

Contexts (`ctx`, one builder per row of §4.5) are never stored: the reader rebuilds them from where the bytes were found, so ciphertext moved to another document, block or person fails to open. HKDF-SHA256 uses salt `"folevi/e2ee/v1"`; derivation strings, the recovery key text (36 Crockford base32 characters with a 20-bit check), the Argon2id parameters and the approval and member codes are in §4.3 to §4.8 and pinned in `fixtures/e2ee-vectors.json`.

Each primitive runs on WebCrypto where the runtime has it and on `@noble` otherwise (`cryptoBackend()`); a `CryptoKey` always runs on WebCrypto and raw key bytes on noble, so keys keep working across backends. `forceBackend` is for tests, which run every vector on both.

## Tests

- `merge-scenarios.test.ts`: the golden scenarios, plus commutativity, idempotence and absorption at every merge.
- `convergence.test.ts`: 2 to 4 devices make random concurrent edits through `FaultyCloud`, which delays, duplicates, reorders, truncates, makes conflict copies and loses updates, also through `EncryptedFs`. It asserts that every replica and the folder end identical, and that every edit is live, in history, or knowingly superseded.
- `crypto.test.ts`, `files.test.ts`, `format.test.ts`, `web-runtime.test.ts`: vectors and tampering, conflict-copy names, the never-overwrite rule, the codecs, history thinning, the index, catalogs, garbage collection, compaction and the journal.
- `e2ee-vectors.test.ts`, `e2ee-web-runtime.test.ts`: every E2EE vector recomputed on WebCrypto and on noble (in Node and the edge runtime) and checked against node:crypto; `e2ee-envelope.test.ts`: every changed byte, wrong contexts, truncation, a compression bomb, fast-check round trips and garbage; `e2ee-keys.test.ts`: derivations, the four AMK wraps, recovery key text, statements, codes, low-order X25519 keys.

`UPDATE_GOLDEN=1 npx vitest run` rewrites the golden checksums and vectors after an intended format change.
