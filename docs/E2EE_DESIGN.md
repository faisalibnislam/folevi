# End-to-end encryption: design (2026-10-21)

This is the build design for the owner's decisions in `docs/E2EE_PLAN.md`. Those decisions are fixed; where
this document had to interpret one, it says so in §14. Several builders implement it in parallel (§12), so
formats, names and file ownership here are normative. If code and this document disagree, fix one of them in
the same change.

Reading order for a builder: §0 (summary), §2 (the architecture), §4 (keys and formats), then your work
package in §12 and the sections it points to.

## 0. Summary

- **Hybrid architecture (option A, extended).** Encrypted content stays in the existing Convex tables, one
  row per document and per block, with ciphertext in new optional fields. The server keeps ids, revisions,
  ranks, the page tree, scopes, roles and grants, so it still enforces permissions, conflicts, presence,
  comments, sharing and retention. The editor's `SyncEngine` and `Outbox` are unchanged: a duck-typed
  client (`E2eeRouterClient`) seals outgoing arguments and opens results. Everything the server used to
  derive from plaintext (previews, search, backlinks, tasks, collections, daily notes, exports) runs on the
  device through the local-mode `LocalBackend` handlers over a decrypted replica of the space
  (`SpaceReplicaStore`, a new `LocalStore`).
- **Per-note keys.** Account master key (AMK) → account key pairs; space key (versioned) per Personal and per
  workspace, granted to members' account keys; note key (versioned) per document, wrapped by the space key,
  by a guest grant or by a link key; file key per attachment, wrapped by the note key.
- **One crypto library**, extended from `packages/local-store/src/crypto`, exported as
  `@folevi/local-store/e2ee`, used by the web app, the Mac app and Convex (for sealing inbound email). It
  adds two FLV1 modes (keyed record `0x03`, keyed stream `0x04`), a sealed box (`FLS1`), signed statements
  and shared test vectors.
- **Feature switches** create explicit, separately stored readable copies (`e2eeMirrors`, `e2eeInbox`,
  `e2eeReminders`) that are deleted when the switch goes off. Locked ("Always fully encrypted") folders and
  notes never produce any of them.
- **Standard is untouched** except for one cheap guard in content-writing paths and "skip if sealed" checks in
  derived-data paths. All schema changes are additive optional fields and new tables.

## 1. Facts from the code that shape the design

| Fact | Where | Consequence |
| --- | --- | --- |
| Every Convex call from the product goes through a `ConvexReactClient`-shaped object; a duck-typed `LocalClient` already stands in for it. | `apps/web/src/lib/local/client.ts`, `lib/convex/provider.tsx`, LOCAL_MODE_PLAN §2.1 | A second duck-typed client can sit between the app and Convex and route per call, with no edits to the 140 component files. |
| The sync engine and the outbox each make one call: `client.mutation(api.sync.push, …)` (engine.ts:748) and `client.mutation(OUTBOX_MUTATIONS[name].ref, args)` (outbox.ts). | `apps/web/src/lib/sync/engine.ts`, `outbox.ts` | Sealing at the client boundary keeps the engine, the reducer, the outbox and their golden tests as they are. |
| About 120 server functions already have local handlers over a `LocalStore`, typed against the server's argument and return types, with parity scenarios. | `apps/web/src/lib/local/functions/*`, `registry.ts`, `tests/parity` | Derived features for encrypted spaces reuse these handlers over a replica instead of being written again. |
| The server derives plaintext on every edit: `refreshDerived` (searchText, excerpt, preview, counts), `syncTaskProjection`, `syncLinks`, `refreshLinkLabels`, `trackMentions`, `queueIndex`, `emitWebhook`. | `convex/lib/syncEngine.ts:369-1000`, `convex/lib/documents.ts:230-251`, `convex/lib/editSettle.ts` | Each needs one "skip if sealed" check; the device computes the same data from the same shared helpers. |
| Block content is structured (`text: InlineNode[]`, `props: any`) and validated on the server with `validateWireBlock`; the largest block payloads are about 400k characters (flowchart). | `convex/lib/validators.ts:200`, `packages/editor-schema/src/generated/schema.ts` LIMITS | Ciphertext fits a Convex document (1 MiB) as `v.bytes()`; the server validates sizes and structure only. |
| Server conflict detection compares content (`sameContent`) as well as revisions. | `convex/lib/syncEngine.ts:430-470` | Sealed blocks carry a keyed content MAC so equal content is still detected without plaintext. |
| Rows belong to exactly one scope (`ownerProfileId` or `workspaceId`) and never change scope. | `convex/schema.ts:44`, `convex/lib/scope.ts` | Space keys map one-to-one to scopes; no re-keying on move, because moves between scopes are copies. |
| Permissions are row-based and server-enforced: `documentAccess`, `requireDocument`, `PageReader`, restricted pages, page grants inherited from ancestors. | `convex/lib/auth.ts:266-620` | Keeping the page tree visible to the server keeps all of this. A blob-store design would lose it. |
| `files` live in Convex `_storage`; `files.finalize` reads the bytes to hash, sniff and strip metadata; quota counts `files.size` only. | `convex/files.ts:226`, `convex/lib/entitlements.ts:138-199` | Devices run the same checks before encrypting (`packages/editor-schema/src/fileBytes.ts`, already used by local mode); the server counts ciphertext bytes. |
| The local store's FLV1 envelope, HMAC names, STREAM chunks, journal and CRDT merge exist and are tested against `fixtures/crypto-vectors.json`. | `packages/local-store/src/crypto/envelope.ts`, `encryptedFs.ts` | The new formats extend FLV1 with new mode bytes so one parser recognises all of them. |
| A static test refuses `argon2`, `scrypt` and similar words in `convex/` outside Better Auth. | `tests/convex/static/invariants.test.ts:55` | Passphrase KDFs run only on devices, never in Convex. |
| `@noble/hashes@2.4.0` and `@noble/ciphers@2.4.0` are already installed (through better-auth); `@noble/curves` is not. Electron is 44.4.5 (Chromium with WebCrypto X25519 and Ed25519). | `node_modules/.pnpm`, `apps/desktop/package.json` | WebCrypto is the primary implementation everywhere; noble is the fallback and the Convex runtime implementation. |
| The Mac app loads `https://app.folevi.com` by default; the bundled interface at `app://folevi` is opt-in. Secrets go through `safeStorage` in the main process and never reach the page. | `apps/desktop/src/urls.ts`, `secrets.ts`, `authBridge.ts` | The Mac keeps its device private key in the main process (Keychain-backed), behind a narrow bridge. |
| Passkeys don't work from `app://folevi` (rpID is app.folevi.com), and Electron has no dependable WebAuthn PRF. | LOCAL_MODE_PLAN §1 | Passkey recovery is set up and used on the website, not inside the Mac app (§14). |
| Many tables hold derived plaintext copies outside the space's own rows: notifications, proposals, webhookDeliveries, mcpEvents, apiRequests, aiStreams, scheduler args, push, APNs and email bodies. | inventory in §5.7 | Every one gets a rule in §5.7. |

## 2. The central decision

### 2.1 The options

**A. Per-block encryption inside the existing Convex sync protocol.** Documents and blocks rows carry
ciphertext; the server keeps revisions, ranks and structure; derived data is computed on the device by the
local-mode handlers over a decrypted replica.

**B. An encrypted space is a local-mode library whose sync folder is Convex.** Convex stores FLV1 library
files (note files, index, catalogs, history, attachments) as an opaque blob store with etags and change
notifications; the app runs `LibraryStore` and `LocalClient` for that space, reusing the CRDT merge, journal
and `EncryptedFs`.

### 2.2 Comparison

| Concern | A (rows with ciphertext) | B (library files in Convex) |
| --- | --- | --- |
| Real-time collaboration and presence | Unchanged: per-block ops, Convex subscriptions on `blocks.list`/`blocks.changes`, presence by block id. Typing appears in about the same time as today. | Each note is one file, written after 1 s of quiet and at most every 5 s, whole file each time. Two people in one note see each other's text 1 to 6 s late. Presence would need a separate channel. |
| Conflicts | The documented banner (SYNC_PROTOCOL §Server rules 5) keeps working; equality checked by MAC. | Local-mode semantics: newer wins, the other goes to history with a notice. Workable, but a different behaviour from Standard workspaces. |
| Per-note sharing and per-note keys | Note key per document; guests and links get only that key. The server serves one document's rows. | Note files can use per-note keys, but the catalog and index files hold every title in the space under the space key, so a page grant would leak the other titles. |
| Permissions the server can still enforce | All of today's: roles, member access, restricted pages, inherited page grants, guests, read-only members, write access per page. | Space membership and write role only. The tree is inside the files, so restricted pages and inherited grants can't be enforced. |
| Comments, mentions, notifications, Changes, proposals | Kept: rows stay, bodies are sealed. | Hidden in local mode today; all would need rebuilding on files. |
| Bandwidth | One block per edit (bytes to a few hundred KB). | Whole note per flush; a 300 KB whiteboard note re-uploads 300 KB every few seconds while edited. |
| Quotas and billing | Ciphertext bytes on existing `files` rows; nothing else changes. | A new blob accounting model for every note, index and history file. |
| Version history | The server keeps making automatic versions by copying ciphertext rows (no plaintext needed); restore and diffs run on the device. | Devices write history files; thinning and GC are not implemented yet in local-store (LOCAL_MODE_PLAN §3.14). |
| Offline | Unchanged engine queue and outbox; replica in IndexedDB. | Library journal; on the web it needs a new IndexedDB journal (the native journal is a shell API). |
| Web (no folder) | Works: replica in IndexedDB, no folder needed. | Needs a Convex-backed `LocalFs` and a web journal; workable. |
| Mac app | Same as web. | Same code, plus the native library service is unused. |
| Tested code reused | Sync reducer and server engine (golden scenarios), outbox and overlays, local handlers and parity scenarios, envelope code. | local-store merge, journal, EncryptedFs, LibraryStore, local handlers. |
| Migration and reversal | In place, per document, resumable; rows describe themselves. | Export the space into a new store and delete the rows; reversal is a full re-import (lib/migrate exists), but ids, grants, comments and links must be remapped. |
| Standard code paths | One guard plus "skip if sealed" checks. | Untouched, but every collaborative feature forks. |

### 2.3 Decision

**A, as a hybrid that borrows B's pieces where they fit.** The deciding points are workspaces (B can't
enforce restricted pages, inherited grants or per-page guests, and drops comments, mentions, presence and
Changes) and collaboration latency (per-block ops versus whole-file flushes). From B we take:

- the FLV1 envelope family and the shared vectors (extended, §4.4);
- the local backend and its handlers, run over a replica store fed from Convex (§6.5);
- the local-mode collection model for encrypted spaces: a collection's definition is a sealed record on its
  host note and a row's values are sealed on the row's note (as `.fnote` does), so the server's four
  collection tables are not used for sealed notes (§5.1, §6.7);
- local-mode host election across Mac windows (`lib/local/host.ts`) for the replica.

What A costs, and how this design pays it:

1. Server code that derives plaintext must skip sealed rows: one helper (`isSealed`) and the per-function
   table in §5.7.
2. The client must know, per call, whether it concerns encrypted data: the route table in §6.4, checked by a
   coverage test like `tests/parity/coverage.test.ts`.
3. The device needs a full replica of each encrypted space to run derived features. Local mode already
   requires this, and Standard's web client already caches documents and blocks.

Rejected variants:
- **Projecting `LocalBackend` mutations into server writes** (like `store/project.ts` does for files). Row
  diffs lose intent (a trash cascade becomes N row writes, a star becomes a doc patch) and server rejections
  would need rollback of local rows. Mutations stay intent-level: passthrough, sealed variants or device
  composers (§6.4).
- **Plaintext block types on the server.** `type` would reveal how many to-dos, images and tables a note has.
  Only two references stay visible because the server enforces something with them: the source of a synced
  block and the mentioned people (§4.6).

## 3. Threat model and what the server can see

### 3.1 Adversaries

| Adversary | In scope | Notes |
| --- | --- | --- |
| Someone with read access to Convex data, backups, logs or Vercel (an attacker, a rogue employee, a subpoena) | Yes | They must not read encrypted content. |
| A server that actively lies (substitutes public keys, replays old ciphertext, withholds rows) | Partly | Key substitution in device approval is defeated by the comparison code (§4.8). Substitution of a workspace member's account key is detectable with member security codes (§8.6). Rollback of a block to an older ciphertext is not detected in v1 (§13). |
| A server that serves malicious web code | No (documented limit) | The website's JavaScript comes from our server. The Mac app with the bundled interface narrows this to signed app updates. |
| Other members of a workspace | Partly | They hold the space key. The server stops them reading restricted pages, but a member colluding with a malicious server could read restricted pages' ciphertext in that space (§13, R3). |
| A device thief | Out of scope beyond the OS | Replicas on trusted devices are plaintext, like Standard's offline cache and local mode. Public computer mode keeps nothing readable after the tab closes (§6.10). |
| AI and email providers | Out of scope | They see what a switch sends them, and only then. |

### 3.2 What the server can and can't see (for the UI's "What each choice means" table)

This table is the source for the copy in §10.3. "Readable" means Folevi's servers can read it.

| Data | Standard | Encrypted, with the features you pick | Fully encrypted |
| --- | --- | --- | --- |
| Note text, titles, icons, covers, page styles | Readable | Encrypted | Encrypted |
| Folder names, tag names | Readable | Encrypted | Encrypted |
| Attachments (images, files, recordings) and their names | Readable | Encrypted | Encrypted |
| Version history, comments, text found in files, collections | Readable | Encrypted | Encrypted |
| Search on our server | Yes | Only if Search everywhere is on (then titles, text and text in files are readable) | No, search runs on your devices |
| Foli AI | Reads the notes it needs | Off, or reads only what you send it: each time you say yes, or automatically if you choose | Off |
| Background Foli AI (Catch me up, related notes, suggestions, routines, search by meaning) | Yes | Only if that switch is on (then a readable copy of your notes is kept for it) | Off |
| Apps and integrations (MCP, REST API, webhooks, calendar feeds) | Yes | Only if that switch is on (then a readable copy is kept for them) | Off |
| Email-to-note and web clipper | Yes | Only if that switch is on (mail and clips are readable while they arrive, then encrypted) | Off |
| Notification previews (push, email, the bell's text on our server) | Titles and short excerpts | Only if that switch is on | No: "You have a new comment" |
| Always visible, at every level | Your name, email and plan; workspace names, members and roles; who can open which note; when notes are created, changed, opened and deleted; their sizes, nesting, number of blocks, which notes are in which folder and which tags; which files belong to which note, their sizes and kinds; who is mentioned and who commented where; reminder times; daily note dates; IP addresses and devices | same | same |

Folders and notes marked **Always fully encrypted** behave like the last column whatever the level.

### 3.3 Honest limits (each one appears in plain words in §10)

1. The website's code comes from our server. If our server were taken over it could send code that reads
   your notes in the browser. The Mac app's built-in interface (Settings > Desktop app) only runs code
   that came with the app.
2. Metadata stays visible (the last row above).
3. Turning encryption on encrypts what's stored now. Copies made before that can stay in our backups until
   they expire (§14 Q4 gives the number to confirm).
4. Your devices keep a readable copy so they work offline. Anyone who can open your unlocked device can
   read your notes, as today.
5. People you share with can copy what they see. Removing someone stops them reading anything new; what
   they already opened, they may have kept.
6. If you lose every recovery method, nobody, including Folevi, can read your encrypted notes again.
   Workspace notes can be recovered by another member who still has the workspace key (§8.7).
7. What a switch sends (to Foli AI, to an app, by email) is readable by Folevi while it's processed, and
   by the provider named.

## 4. Keys and formats

### 4.1 Hierarchy

```
Account master key AMK (32 random bytes, one per person, per key epoch)
 ├─ HKDF "account/x25519"  → account wrapping key pair  (others seal space keys and note keys to its public half)
 ├─ HKDF "account/ed25519" → account signing key pair   (signs device statements and key grants)
 └─ HKDF "account/records" → AES key for the person's own sealed records (scope "account")
   wrapped to: each trusted device's X25519 key (sealed box) | recovery key | passkey PRF | passphrase

Space key SK(scope, v) (32 random bytes; v = 1, 2, … per Personal or workspace)
 ├─ HKDF "space/wrap"    → AES key that wraps note keys
 ├─ HKDF "space/meta"    → AES key for folder names, tag names, space records
 ├─ HKDF "space/mac"     → HMAC key for blind uniqueness (tag names)
 └─ HKDF "space/x25519"  → space inbox key pair (server seals email, clips, app writes to the public half)
   granted to: each member's account X25519 key (sealed box, signed by the granter)

Note key NK(doc, v) (32 random bytes; v = 1, 2, … per document)
 ├─ HKDF "note/content"  → AES key for title, appearance, meta, blocks, comments, found text, version names
 ├─ HKDF "note/mac"      → HMAC key for block and title content MACs
 └─ HKDF "note/files"    → AES key that wraps file keys
   wrapped by: SK(scope, current) | a guest's account key (sealed box) | a link key (from the URL fragment)

File key FK(file) (32 random bytes per attachment)
   wrapped by: NK "note/files" of the note that owns the file
   encrypts: the bytes (FLV1 keyed stream) and the file's metadata (name, mime, width, height, palette)

Device key pairs (per device or trusted browser): X25519 (receives the AMK) and Ed25519 (signs approvals)
```

Why per-note keys: one note can be shared by link or with a guest without giving the space key, and a key can
be rotated for one note (link revoked) or for all (member removed).

### 4.2 Algorithms and where they run

| Primitive | Algorithm | Implementation |
| --- | --- | --- |
| Symmetric encryption | AES-256-GCM, 96-bit random nonce, 128-bit tag | WebCrypto; `@noble/ciphers/aes.js` `gcm` where `crypto.subtle` is missing |
| KDF | HKDF-SHA256, salt `utf8("folevi/e2ee/v1")` | WebCrypto; `@noble/hashes/hkdf.js` fallback |
| MAC | HMAC-SHA256 truncated to 16 bytes | WebCrypto; `@noble/hashes/hmac.js` fallback |
| Key agreement | X25519 | WebCrypto (`{name: "X25519"}`); `@noble/curves/ed25519.js` `x25519` fallback |
| Signatures | Ed25519 | WebCrypto (`{name: "Ed25519"}`); `@noble/curves/ed25519.js` `ed25519` fallback |
| Passphrase KDF | Argon2id, m = 65536 KiB, t = 3, p = 1, 32-byte output, 16-byte salt | `@noble/hashes/argon2.js` `argon2idAsync` (with `asyncTick` so the page stays responsive); about 0.5 s in Node, 1 to 2 s in browsers. Never in Convex. |
| Random | `crypto.getRandomValues` | everywhere |

Feature detection runs once per process (`cryptoBackend()` in `primitives.ts`): try
`crypto.subtle.generateKey({name:"X25519"}, false, ["deriveBits"])` and the Ed25519 equivalent; use noble for
whichever fails. All current targets (Chrome and Edge 137+, Safari 17+, Firefox 130+, Electron 44, Node 22)
support both in WebCrypto. The Convex default runtime is not relied on for X25519: Convex code uses noble.

Dependencies to add, exact versions (WP1): `@noble/curves` (newest 2.x release compatible with
`@noble/hashes@2.4.0`, pinned exactly), `@noble/hashes@2.4.0` and `@noble/ciphers@2.4.0` as direct
dependencies of `packages/local-store`, and `@folevi/local-store: workspace:*` in the root `package.json`
(Convex bundles from the root).

Raw key bytes: HKDF outputs and unwrapped keys pass through JavaScript memory as `Uint8Array` before being
imported as non-extractable `CryptoKey`s. Callers `fill(0)` the arrays after import. JavaScript can't promise
the bytes are gone; this is listed in §13.

### 4.3 Derivation strings

All HKDF calls use SHA-256, salt `utf8("folevi/e2ee/v1")`, output 32 bytes unless stated.

| Input key | info | Output |
| --- | --- | --- |
| AMK | `account/x25519` | X25519 private scalar (RFC 7748 clamping applied by the library) |
| AMK | `account/ed25519` | Ed25519 seed |
| AMK | `account/records` | AES-256 key |
| AMK | `account/check` | first 16 bytes = `amkCheck` (stored with every wrap, compared after unwrapping) |
| SK | `space/wrap`, `space/meta` | AES-256 keys |
| SK | `space/mac` | HMAC key |
| SK | `space/x25519` | X25519 private scalar of the inbox key pair |
| SK | `space/check` | first 16 bytes = `skCheck` |
| NK | `note/content`, `note/files` | AES-256 keys |
| NK | `note/mac` | HMAC key |
| recovery key bytes (20) | `recovery/wrap` | AES-256 key |
| passkey PRF output (32) | `passkey/wrap` | AES-256 key |
| Argon2id output (32) | `passphrase/wrap` | AES-256 key |
| link secret (32) | `link/wrap` | AES-256 key |
| FK | (used directly as the AES-256 key) | |

### 4.4 Envelopes

All binary formats start with a 4-byte magic and a mode byte, so `isEnvelope` and one dispatcher recognise
every format (`packages/local-store/src/crypto/envelope.ts` keeps modes `0x01` and `0x02` as they are).

**Keyed record, FLV1 mode `0x03`** (every sealed field, every key wrap made with a symmetric key):

```
offset  size  field
0       4     "FLV1"
4       1     0x03
5       1     flags: bit 0 = plaintext was deflate-raw compressed (fflate), other bits 0
6       4     keyVersion, uint32 big endian (the version of the key that sealed it; 0 when the key has no versions)
10      12    nonce (random)
22      n+16  AES-256-GCM(key, nonce, plaintext', AAD = bytes[0..22) ‖ utf8(context))
```

- `plaintext'` is `deflateRaw(plaintext)` when the plaintext is 1024 bytes or more and compression saves at
  least 10 %, else the plaintext itself. Decoders reject a decompressed size over 8 MiB.
- `context` is the AAD string from §4.5. It is never stored in the envelope: the reader rebuilds it from where
  the bytes were found (which document, which block), so ciphertext moved to another place fails to open.
- Field contents are UTF-8 canonical JSON (`canonicalJson` from `@folevi/editor-schema`) unless §4.6 says
  otherwise.

**Keyed stream, FLV1 mode `0x04`** (attachment bytes, readable by byte range):

```
0   4   "FLV1"
4   1   0x04
5   4   chunkSize, uint32 BE (65536)
9   8   noncePrefix (random)
17  …   chunk i = AES-256-GCM(FK, noncePrefix ‖ uint32 BE(i), chunk plaintext,
                              AAD = bytes[0..17) ‖ utf8(context) ‖ (0x01 if last chunk else 0x00))
```

This is mode `0x02` with an explicit key and a context in the AAD; `openStreamRange`'s logic (always
authenticate the last chunk) is reused.

**Sealed box, `FLS1`** (anything sealed to an X25519 public key: AMK to a device, space key to a member,
note key to a guest, inbound email to a space):

```
0   4   "FLS1"
4   1   0x01 (version)
5   32  ephemeral X25519 public key E
37  12  nonce (random)
49  …   AES-256-GCM(k, nonce, plaintext, AAD = bytes[0..49) ‖ utf8(context))
where   s = X25519(e_private, R)            (R = recipient public key, 32 bytes)
        k = HKDF-SHA256(ikm = s, salt = E ‖ R, info = "seal/" ‖ context)
```

An all-zero `s` is rejected. A sealed box is anonymous; who made it is proven separately by a signature when
it matters (grants, §4.7).

**Signed statement, `FST1`**:

```
signature = Ed25519(sk, utf8("folevi/e2ee/v1/statement\n" ‖ kind ‖ "\n") ‖ utf8(canonicalJson(body)))
```

`kind` is one of `device`, `space-grant`, `note-grant`, `account-key`. Stored as `{kind, body, sig}` with
`sig` base64url. Bodies are listed in §4.7 and §4.8.

### 4.5 AAD contexts

Every context starts with `folevi/e2ee/v1/`; the table lists the rest. Ids are public ids (ULIDs); `scope` is
`scopeKey` from `convex/lib/scope.ts` (`personal:<profilePublicId>` or `workspace:<workspacePublicId>`; WP2
confirms the exact output of `scopeKey` and uses the public ids, never Convex `_id`s).

| Sealed thing | Context | Key |
| --- | --- | --- |
| AMK to a device | `amk/device/<profileId>/<deviceId>` | device X25519 (FLS1) |
| AMK to recovery key | `amk/recovery/<profileId>/<wrapId>` | recovery wrap key (FLV1 0x03, keyVersion = AMK epoch) |
| AMK to passkey | `amk/passkey/<profileId>/<credentialIdB64u>` | passkey wrap key |
| AMK to passphrase | `amk/passphrase/<profileId>/<wrapId>` | passphrase wrap key |
| Space key to a member | `space-grant/<scope>/<version>/<profileId>` | member's account X25519 (FLS1) |
| Note key wrapped by the space | `note-key/<docId>/<noteVersion>/space/<scope>/<spaceVersion>` | SK "space/wrap" |
| Note key to a guest | `note-key/<docId>/<noteVersion>/grant/<profileId>` | guest's account X25519 (FLS1) |
| Note key to a link | `note-key/<docId>/<noteVersion>/link/<linkPublicId>` | link wrap key |
| Document title | `doc/<docId>/title` | NK "note/content" |
| Document appearance (icon, cover, style) | `doc/<docId>/appearance` | NK |
| Document meta (templateKey, collection row) | `doc/<docId>/meta` | NK |
| Block content | `block/<docId>/<blockId>` | NK |
| Comment body | `comment/<docId>/<commentId>` | NK |
| Found text | `file-text/<docId>/<blockId>` | NK |
| Version name | `version-name/<docId>/<snapshotId>` | NK |
| File key | `file-key/<docId>/<fileId>` | NK "note/files" |
| File metadata | `file-meta/<docId>/<fileId>` | FK |
| File bytes | `file/<fileId>` | FK (FLV1 0x04) |
| Folder name | `folder/<scope>/<folderId>` | SK "space/meta" |
| Tag name | `tag/<scope>/<tagId>` | SK "space/meta" |
| Space record | `record/<scope>/<kind>/<recordId>` | SK "space/meta" |
| Account record | `record/account/<profileId>/<kind>/<recordId>` | AMK "account/records" |
| Inbox item | `inbox/<scope>/<inboxId>` | space inbox X25519 (FLS1) |

Records under a note (collections, found text, study schedules) are sealed with the note key, not the space
key, with context `record/<scope>/<kind>/<recordId>` and `keyVersion` = the note key version, so a guest or a
link holder can read a shared note's collection.

MACs: `mac = base64url(HMAC-SHA256(NK "note/mac", utf8(<context>) ‖ 0x00 ‖ plaintext)[0..16))`. Including the
context means equal content in two blocks has different MACs; only "this block's content didn't change" is
visible. Tag name uniqueness uses `nameMac = base64url(HMAC(SK "space/mac", utf8("tag-name\n") ‖
utf8(normalizeForSearch(name)))[0..16))`.

### 4.6 Wire shapes

Types live in `packages/local-store/src/crypto/e2ee/wire.ts` (WP1) and the matching Convex validators in
`convex/lib/e2ee/validators.ts` (WP2). A type test (`tests/convex/e2ee-wire.test.ts`, WP2) asserts they agree.
`Bytes` is `ArrayBuffer` on the wire (`v.bytes()`).

```ts
/** A block as it travels for a sealed document. It is a valid vWireBlock: the plaintext fields hold fixed placeholders. */
export interface SealedWireBlock {
  id: string;
  type: "sealed";          // placeholder; the real type is inside `sealed.c`
  parentId: string | null;
  rank: string;
  schemaVersion: 0;        // placeholder
  text: [];                // placeholder
  props: {};               // placeholder
  revision?: number;
  sealed: SealedBlockFields;
}
export interface SealedBlockFields {
  c: Bytes;                // FLV1 0x03 of canonicalJson({ type, schemaVersion, text, props }) with props.collapsed removed
  mac: string;             // §4.5
  k: number;               // note key version (also in the header; plaintext so the server can find old-key rows)
  collapsed?: true;        // a toggle's open/closed state (last writer wins, no contentRev bump, as today)
  syncedSource?: string;   // only on synced blocks: the source document's public id (server checks access, SYNCED_BLOCKS.md)
  mentions?: string[];     // profile public ids mentioned in this block now (server notifies the new ones)
  mentionPreview?: { title: string; line: string };  // only with notification previews on (§7.7), ≤ 140 characters each
}

/** document.create for a sealed document: vDocumentCreate with placeholders plus these. */
export interface SealedDocumentCreate {
  title: "";  icon: null;  style?: undefined;  cover?: undefined;   // placeholders
  templateId?: null;                                               // templates are copied on the device (§6.7)
  sealed: {
    title: Bytes; titleMac: string;
    appearance: Bytes;     // canonicalJson({ icon, cover, style })
    meta?: Bytes;          // canonicalJson({ templateKey?, row?: { collectionId, rank, values } })
    noteKey: { v: 1; spaceVersion: number; wrapped: Bytes };     // the first note key, wrapped by the space key
    lockedOwn?: true;      // this note itself is "Always fully encrypted"
    fileIds?: string[];    // files this note references (cover image included), for access and GC
  };
}
export interface SealedDocumentPatch {
  sealedTitle?: { c: Bytes; mac: string };
  sealedAppearance?: Bytes;
  sealedMeta?: Bytes;
  // folderId / parentDocumentId stay plaintext, as in vDocumentPatch
}

/** What every sealed field looks like inside results returned to the client (documents, folders, comments, …). */
export interface SealedField { c: Bytes; k: number }
```

Rules:
- A block or document is **sealed** when its row has `sealed` (blocks) or `sealedAt` (documents). The server
  refuses plaintext content fields (anything but the placeholders) for sealed rows (`e2ee_plaintext`) and
  refuses sealed fields for documents in a scope with no space key (`e2ee_not_set_up`).
- `collapsed` and `syncedSource` exist because the server acts on them; `mentions` exists for notifications.
  Nothing else in a block is visible.
- `dailyDate` stays plaintext (it is a date; the server enforces one daily note per person per date, as
  today). `kind`, `folderId`, `parentDocumentId`, `rank`, `collectionId` (for sealed rows always unset, see
  §6.7), `accessMode` and timestamps stay plaintext.

### 4.7 The account master key and its wraps

**Creation** (`setup.ts`, WP6): AMK = 32 random bytes; derive the account key pairs; register
`e2eeAccounts` with the public keys, `amkCheck` and a self-signed `account-key` statement
`{profileId, epoch, x25519Pub, ed25519Pub, createdAt}`. The first device registers itself (§4.8) and receives
a self-made wrap. The person must then add recovery methods until at least two kinds exist (§4.7.5) before
any space can be encrypted.

**Epochs.** Resetting encryption (every method lost) creates a new AMK with `epoch + 1`. Old wraps are kept
(read-only, for 30 days) in case a lost method turns up; spaces keyed only to the old epoch stay unreadable.

#### 4.7.1 Recovery key

- 20 random bytes (160 bits). Check value: first 20 bits of `SHA-256(utf8("folevi/e2ee/v1/recovery-key") ‖
  bytes)`. Together 180 bits, written as 36 Crockford base32 characters in 9 groups of 4, uppercase, for
  example `7KQ2-M9XD-…-R4TA` (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; on input, `O` reads as `0`,
  `I` and `L` as `1`, spaces and dashes are ignored, case is ignored).
- Wrap: `wrapKey = HKDF(bytes, "recovery/wrap")`; stored `FLV1 0x03(wrapKey, keyVersion = epoch, context
  amk/recovery/<profileId>/<wrapId>, AMK)`.
- Shown once with Copy, Download (`Folevi recovery key.txt`) and Print (a printable page with the key, the
  account email and the date, no app chrome). The wizard then asks for groups 3 and 7 back before it counts.
- Replacing it deletes the old wrap.

#### 4.7.2 Passkey (WebAuthn PRF)

- A dedicated credential, created by our own WebAuthn ceremony (`passkey.ts`), not the Better Auth sign-in
  passkey: `navigator.credentials.create({ publicKey: { rp: { id: "app.folevi.com", name: "Folevi" },
  user: { id: random 16 bytes, name: email, displayName: "Folevi encryption" }, challenge: random 32 bytes,
  pubKeyCredParams: [{type: "public-key", alg: -7}, {type: "public-key", alg: -8}],
  authenticatorSelection: { residentKey: "required", userVerification: "required" },
  extensions: { prf: { eval: { first: salt } } } } })`.
- `salt` = 32 random bytes stored with the wrap. The PRF output comes from create (where supported) or from a
  following `get` with `allowCredentials: [that credential]` and the same salt.
- If `getClientExtensionResults().prf?.enabled !== true` or no output arrives, the method isn't offered on
  that browser: "This browser's passkeys can't unlock encryption. Use another way, or set this up in Chrome,
  Safari or Firefox on a recent system."
- Wrap: `HKDF(prfOutput, "passkey/wrap")`, context `amk/passkey/<profileId>/<credentialId>`.
- The server doesn't verify the attestation; the credential is only a key source. Not available inside the
  Mac app or at `app://folevi` (§14 Q2).

#### 4.7.3 Encryption passphrase

- At least 12 characters and not one of the 10,000 most common passwords (list shipped with the app); NFC
  normalized. The wizard says it should differ from the sign-in password; it can't check that.
- `Argon2id(passphrase, salt 16 random bytes, m 65536, t 3, p 1, dkLen 32)` → `HKDF(…, "passphrase/wrap")`.
  Stored `kdf: { name: "argon2id", m, t, p, salt }` so parameters can rise later. Readers also accept
  `{ name: "pbkdf2-sha256", iterations }` (≥ 600,000) for a future native client; nothing writes it now.
- Unlock attempts are rate limited by the server handing out the wrap: 10 per hour per account
  (`e2ee.keys.getWrap` counts in `rateLimits`), which also slows an attacker who stole a session.

#### 4.7.4 Approve from another device

Covered by device wraps (§4.8). It counts as a recovery method only while the person has at least two trusted
devices or browsers that aren't public sessions.

#### 4.7.5 The two-method rule

Kinds: `device` (two or more trusted devices), `recoveryKey`, `passkey`, `passphrase`. `e2ee.spaces.enable`
and `e2ee.content.setFolderLocked` / `setDocumentLocked` refuse with `e2ee_recovery_required` unless at least two kinds exist. Removing a
method that would leave fewer than two is refused while any space is encrypted (`e2ee_last_method`).

### 4.8 Devices, trusted browsers and approval

**Device keys.** Each Mac app install, each trusted browser and each public session has an X25519 and an
Ed25519 key pair and a `deviceId` (the sync engine's ULID from IndexedDB `meta.deviceId`; on the Mac the main
process's own id, §6.2). Registered in `e2eeDevices` with `kind: "app" | "browser" | "session"`.

**Device statement** (signed by the account Ed25519 key, so a new device can check the list):
`{ profileId, deviceId, kind, x25519Pub, ed25519Pub, label, approvedBy: deviceId | "recovery", approvedAt }`.

**Approval protocol** (commit-then-reveal short authentication string, so a server that substitutes keys
can't grind a matching code):

```
New device N                         Server                         Trusted device T
1. keys K_N, nonce n_N (32 B)
   commit = SHA-256("folevi/e2ee/v1/approval-commit" ‖ n_N ‖ K_N.x ‖ K_N.ed)
   e2ee.devices.requestApproval({ deviceId, kind, label, x25519Pub, ed25519Pub, commit }) → requestId
                                     stores, notifies T's sessions
                                                                    2. person taps "Approve" on T;
                                                                       n_T (32 B) random
                                                                       e2ee.devices.answerApproval({ requestId, nonce: n_T, approverDeviceId })
3. sees n_T; reveals
   e2ee.devices.revealApproval({ requestId, nonce: n_N })
                                                                    4. checks commit; both compute
   code = SAS(SHA-256("folevi/e2ee/v1/approval-code" ‖ K_N.x ‖ K_N.ed ‖ K_T.ed ‖ A.x ‖ A.ed ‖ n_T ‖ n_N))
          A = the account public keys each side holds (N fetched them; T derives them from the AMK)
          SAS = first 20 bits of the hash as a decimal number mod 10^6, zero-padded, shown "123 456"
                                                                    5. person checks the codes match and confirms on T;
                                                                       T seals AMK to K_N.x (FLS1, context amk/device/…),
                                                                       signs the device statement,
                                                                       e2ee.devices.completeApproval({ requestId, wrapped, statement })
6. opens the AMK; derives account keys; checks they equal A; stores the wrap; done.
```

- A request expires after 10 minutes (cron `e2ee.devices.expireRequests`, every 5 minutes). T must be a
  trusted `app` or `browser` (not a public session).
- N shows the code with "Check that your other device shows the same code." T shows it with "Do these
  numbers match the ones on your new device?" and two buttons, "They match" and "They don't match". "They
  don't match" cancels and tells the person to try again; three cancelled requests in an hour lock approvals
  for an hour (server counts).
- Unlocking with a recovery method on N skips steps 1 to 5: N opens the AMK itself, then seals it to its own
  key and signs its own statement (`approvedBy: "recovery"`).

**Trusted browser.** After the first unlock on the website, "Trust this browser" (default on, except when
"This is a public or shared computer" was chosen) registers a `browser` device whose private keys are
non-extractable `CryptoKey`s in IndexedDB `folevi-e2ee` (§6.2). Next visits unlock with no prompt.

**Public computer mode.** A `session` device: keys generated non-extractable and kept in memory only; the AMK
is never wrapped to it on the server. A reload asks to unlock again (§6.10).

**Revocation** (Settings > Devices): `e2ee.devices.revoke({ deviceId })` deletes its AMK wrap and its
statement, signs the device out (existing `users.revokeSession` for its session), and marks it `revoked`. The
revoked device can't fetch wraps any more. A revoked device that kept the AMK in memory or IndexedDB still
knows it: when the person revokes a device they're asked "Also change your encryption key?" (default on for a
lost device): that runs an AMK rotation (new epoch wraps for every remaining method and device, re-grant of
every space key to the new account key; space keys themselves don't change, §4.9) and then space key rotation
for Personal (§4.9), so the revoked device can't read new notes.

### 4.9 Space keys, note keys, versions and rotation

- **Space key versions.** `e2eeSpaceKeys` holds one row per (scope, version) with `inboxPub`, `skCheck`,
  `createdBy`, `createdAt`, `retiredAt?`. The newest non-retired version is current. Grants
  (`e2eeSpaceGrants`) seal each version to each member's account key, with a signed `space-grant` statement
  `{scope, version, profileId, granteeX25519Pub, grantedBy, at}` signed by the granter's account key.
- **Note key versions.** `e2eeNoteKeys` holds one row per (document, version, wrappedBy). Writers always seal
  with the newest note key version they hold; readers pick the version from the envelope header.
- **New note**: the creating device makes NK v1 and sends it wrapped by the current space key in the same
  `document.create` op (§4.6), so the document never exists without its key.
- **Rotating one note** (a link revoked, a guest removed): a device with access makes NK v(n+1), wraps it by
  the current space key and for each remaining guest and link, uploads with
  `e2ee.grants.rotateNoteKey`, then the background re-sealer (§6.9) re-seals that note's rows.
- **Rotating a space** (a member removed, a device revoked with "change your key"): the device of the person
  doing it makes SK v(n+1), grants it to every remaining member, retires v(n) (`retiredAt`), and wraps every
  note key's current version by v(n+1) (one `e2eeNoteKeys` row per note, batched 200 per mutation). Then, in
  the background, every note gets NK v(m+1) (new data at once: any device writing to a note whose newest note
  key is wrapped only by a retired space version makes a new note key first) and old rows are re-sealed. When
  a note has no rows left under old note key versions (the server counts, §5.3 `e2ee.migrate.progress`), the
  old versions' wraps are deleted.
- **History is re-sealed too**, version by version, as the owner asked ("old data in the background").

### 4.10 Test vectors

`packages/local-store/fixtures/e2ee-vectors.json` (WP1), generated with fixed keys and nonces by
`UPDATE_GOLDEN=1 vitest run test/e2ee-vectors.test.ts`, covers: every HKDF row of §4.3; FLV1 0x03 with and
without compression and with every context kind in §4.5; FLV1 0x04 with 0, 1, 65536 and 65537-byte inputs and
two ranges; FLS1 with a fixed ephemeral key; FST1 signatures; MACs; the recovery key encoding and parsing
(including `O`/`I`/`L` substitutions and a bad check value); Argon2id with the production parameters for one
fixed passphrase (and with m = 1024 for fast tests); the approval commit and the SAS code. Both the WebCrypto
and the noble backends must reproduce every vector (the test runs each backend explicitly).

**Settled while building WP1.**
- `SignedStatement` is `{ kind, body, sig }` with `body` the canonical JSON string that was signed (as the
  `v.string()` validators store it) and `sig` base64url without padding. Public keys inside bodies are
  base64url strings. The `note-grant` body, not listed above, is `{ documentId, version, profileId,
  granteeX25519Pub, grantedBy, at }`. `openStatement` returns the parsed body only when it verifies and is
  canonical.
- `ctx` builders, one per row of §4.5: `amkDevice`, `amkRecovery`, `amkPasskey`, `amkPassphrase`,
  `spaceGrant`, `noteKeySpace`, `noteKeyGrant`, `noteKeyLink`, `docTitle`, `docAppearance`, `docMeta`,
  `block`, `comment`, `fileText`, `versionName`, `fileKey`, `fileMeta`, `file`, `folder`, `tag`,
  `spaceRecord` (also for records under a note), `accountRecord`, `inbox`. They return the full string and
  refuse empty parts or parts containing `/`.
- Recovery key text: the 20 key bytes then the 20 check bits, most significant bit first, 5 bits per
  character. `parseRecoveryKey` also returns null for a wrong length or a character outside the alphabet.
- `approvalCode` and `memberSecurityCode` return bare digits; `formatCode` adds the spaces for display.
- Readers of FLV1 `0x04` refuse a chunk size over 16 MiB. Writers of `0x03` never compress a plaintext over
  8 MiB (readers would refuse it); `compress: false` turns compression off.
- `passphraseWrapKey` also accepts `{ name: "pbkdf2-sha256", iterations, salt }` (iterations ≥ 600,000) for
  reading, and refuses stored Argon2id parameters outside m 8 to 1 GiB, t 1 to 64, p 1 to 16, or a salt
  under 16 bytes.
- `blockFromPlaintext(bytes, shell, collapsed?)` takes the row's `sealed.collapsed` as a third argument.

## 5. Server changes

### 5.1 New tables (all in `convex/schema.ts`, written by WP2 in its first commit)

```ts
// Per person: the account's E2EE identity. One row per profile and epoch.
e2eeAccounts: defineTable({
  profileId: v.id("profiles"),
  epoch: v.number(),
  x25519Pub: v.bytes(), ed25519Pub: v.bytes(),
  amkCheck: v.bytes(),
  statement: v.object({ kind: v.literal("account-key"), body: v.string(), sig: v.string() }),
  status: v.union(v.literal("active"), v.literal("superseded")),
  createdAt: v.number(), supersededAt: v.optional(v.number()),
}).index("by_profile", ["profileId", "epoch"]),

// The AMK, wrapped for each way in.
e2eeAccountWraps: defineTable({
  profileId: v.id("profiles"),
  epoch: v.number(),
  publicId: v.string(),
  kind: v.union(v.literal("device"), v.literal("recoveryKey"), v.literal("passkey"), v.literal("passphrase")),
  deviceId: v.optional(v.string()),           // kind device
  credentialId: v.optional(v.string()),       // kind passkey (base64url)
  prfSalt: v.optional(v.bytes()),             // kind passkey
  kdf: v.optional(v.object({ name: v.literal("argon2id"), m: v.number(), t: v.number(), p: v.number(), salt: v.bytes() })), // passphrase
  wrapped: v.bytes(),                         // FLS1 (device) or FLV1 0x03 (others)
  label: v.optional(v.string()),              // "iPhone passkey", shown in Settings > Privacy
  createdAt: v.number(), lastUsedAt: v.optional(v.number()),
}).index("by_profile", ["profileId", "epoch"]).index("by_profile_device", ["profileId", "deviceId"]).index("by_public_id", ["publicId"]),

// Devices and browsers that hold (or asked for) the AMK.
e2eeDevices: defineTable({
  profileId: v.id("profiles"),
  deviceId: v.string(),
  kind: v.union(v.literal("app"), v.literal("browser"), v.literal("session")),
  label: v.string(), platform: v.string(),
  x25519Pub: v.bytes(), ed25519Pub: v.bytes(),
  status: v.union(v.literal("pending"), v.literal("trusted"), v.literal("revoked")),
  statement: v.optional(v.object({ kind: v.literal("device"), body: v.string(), sig: v.string() })),
  sessionKey: v.optional(v.string()),         // sessionsMirror.sessionKey, to sign the device out with it
  createdAt: v.number(), lastSeenAt: v.number(), revokedAt: v.optional(v.number()),
}).index("by_profile", ["profileId", "status"]).index("by_profile_device", ["profileId", "deviceId"]),

e2eeApprovals: defineTable({
  publicId: v.string(), profileId: v.id("profiles"), deviceId: v.string(),
  commit: v.bytes(), approverDeviceId: v.optional(v.string()),
  approverNonce: v.optional(v.bytes()), requesterNonce: v.optional(v.bytes()),
  wrapped: v.optional(v.bytes()),
  status: v.union(v.literal("waiting"), v.literal("answered"), v.literal("revealed"), v.literal("done"), v.literal("cancelled"), v.literal("expired")),
  createdAt: v.number(), expiresAt: v.number(),
}).index("by_public_id", ["publicId"]).index("by_profile_status", ["profileId", "status"]).index("by_expires", ["expiresAt"]),

// Per space: level, state, switches. One row per scope that ever had E2EE set up.
e2eeSpaces: defineTable({
  ...scoped,
  scopeKey: v.string(),
  level: v.union(v.literal("standard"), v.literal("selected"), v.literal("full")),
  state: v.union(v.literal("off"), v.literal("enabling"), v.literal("on"), v.literal("disabling")),
  switches: vE2eeSwitches,                    // §7.1
  currentKeyVersion: v.number(),
  inboxDocumentId: v.optional(v.id("documents")),   // the space's Inbox page when sealed (tasks.ensureInbox can't find it by title)
  lockedCount: v.number(),                    // folders + notes marked Always fully encrypted (Standard spaces with locks are "e2ee-active")
  migrationId: v.optional(v.id("e2eeMigrations")),
  changedBy: v.id("profiles"), changedAt: v.number(),
  seq: v.number(),
}).index("by_scope_key", ["scopeKey"]).index("by_workspace", ["workspaceId"]).index("by_owner", ["ownerProfileId"]),

e2eeSpaceKeys: defineTable({
  ...scoped, scopeKey: v.string(), version: v.number(),
  inboxPub: v.bytes(), skCheck: v.bytes(),
  createdBy: v.id("profiles"), createdAt: v.number(), retiredAt: v.optional(v.number()),
}).index("by_scope_version", ["scopeKey", "version"]),

e2eeSpaceGrants: defineTable({
  ...scoped, scopeKey: v.string(), version: v.number(),
  profileId: v.id("profiles"), epoch: v.number(),     // the grantee's account epoch it was sealed to
  wrapped: v.bytes(),                                 // FLS1
  statement: v.object({ kind: v.literal("space-grant"), body: v.string(), sig: v.string() }),
  grantedBy: v.id("profiles"), createdAt: v.number(),
}).index("by_scope_profile", ["scopeKey", "profileId", "version"]).index("by_profile", ["profileId"]),

// Members waiting for a grant (they joined before they had keys, or reset their keys).
e2eePendingGrants: defineTable({
  ...scoped, scopeKey: v.string(), profileId: v.id("profiles"),
  reason: v.union(v.literal("joined"), v.literal("reset"), v.literal("rotation"), v.literal("page")),
  documentId: v.optional(v.id("documents")),        // reason page: a page shared with someone who has no keys yet
  createdAt: v.number(),
}).index("by_scope", ["scopeKey"]).index("by_profile", ["profileId"]).index("by_document", ["documentId"]),

e2eeNoteKeys: defineTable({
  ...scoped, documentId: v.id("documents"), version: v.number(),
  wrappedBy: v.union(v.literal("space"), v.literal("grant"), v.literal("link")),
  spaceVersion: v.optional(v.number()),               // wrappedBy space
  profileId: v.optional(v.id("profiles")),            // wrappedBy grant
  linkId: v.optional(v.id("publicLinks")),            // wrappedBy link
  wrapped: v.bytes(),
  createdBy: v.id("profiles"), createdAt: v.number(),
  seq: v.number(),
}).index("by_document", ["documentId", "version"]).index("by_document_grantee", ["documentId", "profileId"])
  .index("by_link", ["linkId"]).index("by_workspace_seq", ["workspaceId", "seq"]).index("by_owner_seq", ["ownerProfileId", "seq"]),

// Sealed rows the server never interprets: collections on a host note, found text, study schedules,
// Foli AI chats, note-level settings. `partition` is the note's id when the record belongs to a note.
e2eeRecords: defineTable({
  ...scoped,
  kind: v.union(v.literal("collection"), v.literal("fileText"), v.literal("studyReview"), v.literal("aiChat"), v.literal("aiMemory"), v.literal("prefs")),
  recordId: v.string(),
  documentId: v.optional(v.id("documents")),
  profileId: v.optional(v.id("profiles")),          // set for records only one person reads (aiChat, aiMemory, studyReview, prefs)
  keyVersion: v.number(),
  sealed: v.bytes(), size: v.number(),
  rev: v.number(),                                   // compare-and-set on write
  updatedBy: v.id("profiles"), updatedAt: v.number(), deletedAt: v.optional(v.number()),
  seq: v.number(),
}).index("by_scope_kind_record", ["workspaceId", "ownerProfileId", "kind", "recordId"])
  .index("by_document", ["documentId"]).index("by_workspace_seq", ["workspaceId", "seq"]).index("by_owner_seq", ["ownerProfileId", "seq"]),

// Readable copies a feature switch asked for (§7). Deleted when the switch goes off.
e2eeMirrors: defineTable({
  ...scoped,
  purpose: v.union(v.literal("search"), v.literal("ai"), v.literal("apps")),
  documentId: v.id("documents"),
  title: v.string(),
  text: v.string(),                                  // search: searchText plus found text; ai/apps: Markdown (noteDetail shape)
  folderPath: v.optional(v.string()), tags: v.optional(v.array(v.string())),
  tasks: v.optional(v.array(v.object({ blockId: v.string(), text: v.string(), done: v.boolean(), due: v.optional(v.string()), dueTime: v.optional(v.string()) }))),
  contentHash: v.string(), updatedAt: v.number(),
}).index("by_document_purpose", ["documentId", "purpose"]).index("by_scope_purpose", ["workspaceId", "ownerProfileId", "purpose"])
  .searchIndex("search_text", { searchField: "text", filterFields: ["workspaceId", "ownerProfileId", "purpose"] })
  .searchIndex("search_title", { searchField: "title", filterFields: ["workspaceId", "ownerProfileId", "purpose"] }),

// Things that arrived for a sealed space (email, a clip, an app write), sealed to the space inbox key.
e2eeInbox: defineTable({
  ...scoped, publicId: v.string(), scopeKey: v.string(), keyVersion: v.number(),
  kind: v.union(v.literal("email"), v.literal("clip"), v.literal("app")),
  sealed: v.bytes(), size: v.number(),
  targetDocumentId: v.optional(v.string()),          // the id the new note will have, or the note an app appends to
  status: v.union(v.literal("waiting"), v.literal("applied"), v.literal("failed")),
  receivedAt: v.number(), expiresAt: v.number(), appliedBy: v.optional(v.id("profiles")),
}).index("by_scope_status", ["scopeKey", "status", "receivedAt"]).index("by_public_id", ["publicId"]).index("by_expires", ["expiresAt"]),

// Reminder times for sealed to-dos (tasks.processReminders can't read sealed blocks).
e2eeReminders: defineTable({
  ...scoped, profileId: v.id("profiles"), documentId: v.id("documents"), blockId: v.string(),
  remindAt: v.number(), preview: v.optional(v.object({ title: v.string(), note: v.string() })),  // only with notification previews on
  sentAt: v.optional(v.number()), updatedAt: v.number(),
}).index("by_remind", ["sentAt", "remindAt"]).index("by_document_block", ["documentId", "blockId"]).index("by_profile", ["profileId"]),

// A plaintext copy made on purpose by Publish to the web (§9.3).
e2eePublishedCopies: defineTable({
  ...scoped, linkId: v.id("publicLinks"), documentId: v.id("documents"),
  title: v.string(), icon: v.optional(v.string()), cover: vDocumentCover, style: vDocumentStyle,
  chunkCount: v.number(), publishedBy: v.id("profiles"), publishedAt: v.number(),
}).index("by_link", ["linkId"]).index("by_document", ["documentId"]),
e2eePublishedChunks: defineTable({ copyId: v.id("e2eePublishedCopies"), index: v.number(), data: v.string() }).index("by_copy", ["copyId", "index"]),

// Background encrypt / decrypt / re-seal jobs, resumable by any eligible device.
e2eeMigrations: defineTable({
  ...scoped, scopeKey: v.string(),
  direction: v.union(v.literal("seal"), v.literal("unseal"), v.literal("reseal")),
  targetLevel: v.union(v.literal("standard"), v.literal("selected"), v.literal("full")),
  scopeOf: v.union(v.literal("space"), v.literal("folder"), v.literal("document")),
  rootId: v.optional(v.string()),                     // folder or document public id for a lock
  total: v.number(), done: v.number(), failed: v.number(),
  cursor: v.optional(v.string()),                     // last document public id handled (ULID order)
  phase: v.union(v.literal("documents"), v.literal("history"), v.literal("files"), v.literal("cleanup"), v.literal("done")),
  leaseDeviceId: v.optional(v.string()), leaseProfileId: v.optional(v.id("profiles")), leaseUntil: v.optional(v.number()),
  startedBy: v.id("profiles"), startedAt: v.number(), finishedAt: v.optional(v.number()),
}).index("by_scope", ["scopeKey", "startedAt"]),
```

`vE2eeSwitches` (in `convex/lib/e2ee/validators.ts`):

```ts
export const vE2eeSwitches = v.object({
  foliAi: v.union(v.literal("off"), v.literal("ask"), v.literal("auto")),
  backgroundAi: v.boolean(),
  searchEverywhere: v.boolean(),
  apps: v.boolean(),
  emailToNote: v.boolean(),
  webClipper: v.boolean(),
  notificationPreviews: v.boolean(),
});
```

All new scoped tables go into `SCOPED_TABLES` (`convex/lib/scope.ts`, WP2) and are inserted through
`insertScoped`. Every new table gets a purge path in `maintenance.ts` (WP4): `purgeDocument` deletes
`e2eeNoteKeys`, `e2eeRecords`, `e2eeMirrors`, `e2eeReminders`, `e2eePublishedCopies` of the document;
`purgeAccount` and workspace deletion delete the rest by scope or profile.

### 5.2 Additive fields on existing tables

| Table | New optional fields | Meaning |
| --- | --- | --- |
| documents | `sealedAt: v.number()`, `sealedTitle: v.object({c: v.bytes(), k: v.number(), mac: v.string()})`, `sealedAppearance: v.object({c, k})`, `sealedMeta: v.object({c, k})`, `locked: v.boolean()` (this note is Always fully encrypted), `lockedVia: v.optional(v.id("folders"))` (inherited from a locked folder, kept in step by moves), `sealing: v.object({ by: v.string(), until: v.number() })` (a device is converting it), `fileIds: v.array(v.string())` | Sealed document. Plaintext columns hold placeholders: `title ""`, `icon` unset, `cover {kind:"none"}`, `style` default, `searchText ""`, `excerpt ""`, `preview` unset, counts 0, `templateKey` unset. |
| blocks | `sealed: v.object({ c: v.bytes(), mac: v.string(), k: v.number() })`, `syncedSource: v.string()`, `mentionIds: v.array(v.string())` | Sealed block (placeholders as in §4.6; `props` may hold only `{collapsed: true}`). |
| folders | `sealedName: v.object({c, k})`, `locked: v.boolean()` | Name placeholder `""`. |
| tags | `sealedName: v.object({c, k})`, `nameMac: v.string()` + index `by_workspace_name_mac`, `by_owner_name_mac` | `name ""`, `normalizedName` = `nameMac` (so the existing duplicate check by `normalizedName` keeps working blind). |
| comments | `sealedBody: v.object({c, k})` | `body []`. |
| documentSnapshots | `sealed: v.boolean()`, `sealedName: v.object({c, k})` | Chunks hold a `SealedVersionContent` JSON (§5.4). `title ""`. |
| files | `sealed: v.object({ key: v.bytes(), meta: v.bytes(), k: v.number(), plainSize: v.number() })` | `filename "file"`, `mimeType "application/octet-stream"`, `sha256` of the ciphertext, `size` = ciphertext bytes (what counts toward storage). |
| publicLinks | `e2ee: v.object({ noteVersion: v.number(), wrapped: v.bytes() })`, `plainCopy: v.boolean()` | Encrypted link or published plain copy (§9). |
| documentTags | `seq: v.number()` | Stamped by e2ee writes so the replica sees tag changes. |
| notifications | `sealedDocument: v.boolean()` | The title and body are generic; the device fills in the real title (§7.7). |
| aiStreams | `kind: v.union(v.literal("answer"), v.literal("context"))`, `ephemeral: v.boolean()` | A temporary row holding a request's provided context (aiResearch) or an answer for a sealed space; deleted when the request finishes. |
| webhookPlaces, mcpGrants, apiTokens | none | Spaces are checked through `e2eeSpaces` at use. |

No existing field changes type, no index is removed, no row is rewritten by a migration. Standard rows never
have any of these fields.

### 5.3 New Convex modules and their functions

All arguments use public ids; all functions call `requireProfile` and the existing access helpers. Errors are
`ConvexError({ code, message })` with the codes in §5.6.

**`convex/e2ee/keys.ts` (WP2)**

```ts
export const status = query({ args: {}, returns: AccountE2eeStatus });                 // epoch, public keys, method kinds present, devices count, setUp: boolean
export const createAccount = mutation({ args: { x25519Pub, ed25519Pub, amkCheck, statement, device: DeviceRegistration, deviceWrap: v.bytes() } });
export const addWrap = mutation({ args: { kind, wrapped, credentialId?, prfSalt?, kdf?, label? }, returns: v.object({ publicId: v.string() }) });
export const removeWrap = mutation({ args: { publicId } });                             // e2ee_last_method rule
export const listWraps = query({ args: {} });                                         // kinds, labels, dates; never `wrapped`
export const getWrap = mutation({ args: { kind, credentialId? } });                    // returns wrapped + kdf/prfSalt; rate limited (§4.7.3); a mutation so it can count
export const getDeviceWrap = query({ args: { deviceId } });                           // for this device's own wrap
export const rotateAccount = mutation({ args: { newEpoch: AccountRegistration, wraps: WrapInput[], regrants: SpaceGrantInput[] } }); // AMK rotation (§4.8)
export const resetAccount = mutation({ args: { newEpoch: AccountRegistration, wraps: WrapInput[] } });  // every method lost; creates e2eePendingGrants(reason "reset") per workspace
export const accountKeysOf = query({ args: { profileIds: v.array(v.string()) } });     // current public keys + statement of people the caller shares a space or page with
```

**`convex/e2ee/devices.ts` (WP2)**: `register`, `requestApproval`, `answerApproval`, `revealApproval`,
`completeApproval`, `cancelApproval`, `approvals` (query: waiting requests for this account, for the approve
dialog on trusted devices), `approval` (query by id, for the new device), `list` (with statements),
`revoke`, `touch` (lastSeenAt, called once an hour), `expireRequests` (internal, cron).

**`convex/e2ee/spaces.ts` (WP2)**

```ts
export const get = query({ args: { scope: vScopeArg } });       // level, state, switches, currentKeyVersion, inboxPub, lockedCount, migration progress, keyHolders count
export const mine = query({ args: {} });                        // every space the caller can open that is e2ee-active (level ≠ standard or lockedCount > 0), with the caller's grant versions
export const setUp = mutation({ args: { scope, key: SpaceKeyInput /* version 1, inboxPub, skCheck */, grants: SpaceGrantInput[] } });  // first space key; managers only for workspaces
export const enable = mutation({ args: { scope, level: "selected" | "full", switches } });   // starts a seal migration; e2ee_recovery_required
export const setSwitches = mutation({ args: { scope, switches } });                 // turning a switch off schedules purge of its mirror/inbox rows (§7)
export const lower = mutation({ args: { scope, level, recheckedWrapId: v.string() } });   // full→selected (no data change) or →standard (starts unseal migration)
export const rotate = mutation({ args: { scope, key: SpaceKeyInput, grants: SpaceGrantInput[], noteKeys: NoteKeyWrapInput[] /* first batch */ } });
export const addNoteKeyWraps = mutation({ args: { scope, noteKeys: NoteKeyWrapInput[] } }); // later batches of a rotation
export const keyHolders = query({ args: { scope } });           // members with a current grant, pending members
```

`lower` checks that `recheckedWrapId` is a wrap the device opened within the last 10 minutes (the client calls
`keys.getWrap` first; the server records `lastUsedAt`), which is how "re-check a recovery method" is enforced.

**`convex/e2ee/grants.ts` (WP2)**: `grantSpace({scope, grants})` (fulfils pending grants, managers only),
`pending({scope})`, `grantNote({documentId, version, profileId, wrapped, statement})` (to a page guest),
`noteAudience({documentId})` (the people with page grants on the note or its ancestors and their account
keys, so a device creating a sub-page wraps its key for them), `rotateNoteKey({documentId, version, wraps})`,
`myNoteKeys({documentIds})` (the caller's wraps for documents they open outside a replica: guests).

**`convex/e2ee/content.ts` (WP3)**: sealed variants of content mutations that take plaintext today. Each
mirrors the original's permission checks and limits, accepts client-chosen public ids (ULIDs), stamps `seq`
from the scope counter and bumps the document's `seq` when it changes document-level data.

| Function | Replaces in a sealed context | Args beyond ids |
| --- | --- | --- |
| `createFolder` | `organization.createFolder` | `scope, folderId, parentFolderId, sealedName, color?, rank, locked?` |
| `renameFolder` | `organization.renameFolder` | `folderId, sealedName` |
| `createTag` | `organization.createTag` | `scope, tagId, sealedName, nameMac, color` (duplicate check by `nameMac`) |
| `updateTag` | `organization.updateTag` | `tagId, sealedName?, nameMac?, color?` |
| `setDocumentTags` | `organization.setDocumentTags` | `documentId, tagIds` (stamps `documentTags.seq` and the doc's `seq`) |
| `putRecord` | collections, found text, study, chats | `scope, kind, recordId, documentId?, sealed, keyVersion, baseRev` → `{rev}` or `e2ee_conflict` |
| `deleteRecord` | | `scope, kind, recordId, baseRev` |
| `createComment` / `replyComment` / `editComment` | `comments.create/reply/edit` | `…, sealedBody, mentions: profileId[], preview?: {title, excerpt}` |
| `nameVersion` | `documents.nameVersion` | `snapshotId, sealedName` |
| `importVersion` | `documents.importSnapshot` | `documentId, content: SealedVersionContent` |
| `setFolderLocked` | (new) | `folderId, locked` (starts a folder-scoped migration in Standard spaces; keeps `documents.lockedVia` in step) |
| `setDocumentLocked` | (new) | `documentId, locked` |
| `setDocumentRowMeta` | `collections.setValue` / `renameRow` / `moveRow` for sealed rows | `documentId, sealedMeta` (a collection row's values live in its note's sealed meta) |

**`convex/e2ee/pull.ts` (WP3)**

```ts
export const head = query({ args: { scope } });                 // { seq } of the scope counter
export const pull = query({ args: { scope, cursor: v.number(), limit: v.optional(v.number()) }, returns: E2eePullPage });
export const mine = query({ args: { scope } });                 // the caller's stars, recents, recentHidden in the scope (no seq; small; reactive)
export const document = query({ args: { documentId } });        // one sealed document's rows for someone without a replica (a guest): doc, note key wraps for the caller, files meta, records
```

```ts
type E2eePullPage = {
  documents: PulledDocument[];  // seq > cursor and readable by the caller (PageReader). Sealed: sealed fields; plain (during a migration): the plain fields
  blocks: PulledBlock[];        // of readable documents; tombstones included
  folders: PulledFolder[]; tags: PulledTag[];
  records: PulledRecord[];      // e2eeRecords; profile-only kinds only for that profile
  noteKeys: PulledNoteKey[];    // wraps the caller can open (space-wrapped for members; grant-wrapped for the caller)
  space: PulledSpace | null;    // e2eeSpaces row when its seq > cursor
  nextCursor: number; hasMore: boolean; head: number;
};
type PulledDocument = { id; kind; parentDocumentId; folderId; rank; dailyDate; accessMode; createdAt; updatedAt; archivedAt; inTrash;
  deletedAt; revision; titleRev; seq; contentSeq; createdBy; lastEditedBy; locked; lockedVia; tagIds: string[]; fileIds: string[];
  sealed?: { title: SealedField & { mac }; appearance: SealedField; meta?: SealedField };
  plain?: { title; icon; cover; style; templateKey; collectionId };      // only while a migration has not reached this doc
  files: PulledFile[] };
```

Paging: read up to `limit` (default 500, max 1000) rows with `seq > cursor` from each table's `by_*_seq`
index, merge by `seq`, cut at the `limit`-th row's `seq` and include every row with that same `seq` (rows of
one mutation share it). In a Standard-level space with locks, `pull` returns only sealed documents and their
rows, and locked folders.

**`convex/e2ee/files.ts` (WP3)**: `generateUploadUrl({documentId, kind, declaredSize})` (quota on
ciphertext size), `commit({documentId, fileId, storageId, sealed: {key, meta, k, plainSize}, size, sha256})`
(an internal action checks the stored blob's size and SHA-256, never its content; then `commitFile` with
`kind` kept), `replaceBlob` (used by migration and re-sealing: swap `storageId`, adjust storage by the size
difference, delete the old blob), `updateMeta({fileId, meta})` (palette and other metadata, re-sealed),
`rewrap({fileId, targetDocumentId, key})` (a pasted file in another note of the same scope shares the bytes
and gets the file key wrapped by the target note's key).

**`convex/e2ee/migrate.ts` (WP3)**

```ts
export const start = internalMutation(...)                       // called by spaces.enable / lower / content.setFolderLocked / setDocumentLocked / rotate
export const claim = mutation({ args: { migrationId, deviceId } });     // lease for 2 minutes; returns the next documents to handle (50, ULID order after cursor)
export const heartbeat = mutation({ args: { migrationId, deviceId } });
export const beginDocument = mutation({ args: { documentId, noteKey?: NoteKeyWrapInput } }); // sets documents.sealing; refuses others' writes (e2ee_busy)
export const sealBlocks = mutation({ args: { documentId, blocks: { blockId, revision, sealed, syncedSource?, mentionIds? }[] } });   // ≤ 200 blocks or 4 MiB; CAS on revision
export const sealDocumentFields = mutation({ args: { documentId, sealedTitle, sealedAppearance, sealedMeta?, fileIds } });
export const sealComments = mutation({ args: { documentId, comments: { commentId, sealedBody }[] } });
export const sealSnapshot = mutation({ args: { snapshotId, content: SealedVersionContent, sealedName? } });
export const finishDocument = mutation({ args: { documentId, records: RecordInput[] } });  // atomically: sets sealedAt, purges derived plaintext (§5.5), clears sealing, writes records
export const unsealBlocks = mutation({ args: { documentId, blocks: { blockId, revision, block: vWireBlock }[] } }); // validateWireBlock applies
export const unsealDocumentFields = mutation({ args: { documentId, title, icon, cover, style, templateKey? } });
export const finishUnseal = mutation({ args: { documentId, collections: PlainCollectionInput[], fileTexts: PlainFileTextInput[] } }); // recreates server collections/fileTexts; refreshDerived, syncTaskProjection, syncLinks, queueIndex
export const resealBlocks = mutation({ args: { documentId, blocks: { blockId, revision, sealed }[] } });   // rotation; skips rows whose revision moved
export const progress = query({ args: { scope } });               // for the progress UI
export const finishPhase = mutation({ args: { migrationId, phase } });
```

**`convex/e2ee/mirrors.ts`, `inbox.ts`, `reminders.ts`, `links.ts` (WP5)**: see §7 and §9 for their
functions.

**Settled while building WP2.**

- Scope strings. `e2eeSpaces.scopeKey` and the other `scopeKey` columns hold `lib/scope.ts` `scopeKey(scope)`
  (`p:<profile _id>` or `w:<workspace _id>`), the same key `scopeCounters` uses, so guards need no extra read.
  The scope inside AAD contexts and statements (§4.5) is `e2eeScopeId(ctx, scope)` from `lib/e2ee/state.ts`:
  `personal:<profile id>` or `workspace:<workspace public id>`. Profiles have no separate public id; their id
  is what clients already see (members lists, mentions). `spaces.get` and `spaces.mine` return it as `scopeId`.
- `keys.addWrap` (and the wraps of `rotateAccount` / `resetAccount`) accept an optional client-chosen `wrapId`
  (a ULID), because the recovery and passphrase contexts contain the wrap id and the device seals before the
  server answers. Passphrase wraps must declare at least m 65536, t 3, p 1 and a 16-byte salt.
- `keys.rotateAccount` takes `regrants: { scope, grant }[]` and optional `deviceStatements` (each trusted
  device's statement signed again by the new account key). `keys.sweep` (daily) deletes wraps and the public
  keys of epochs superseded more than 30 days ago (index `e2eeAccounts.by_status_superseded`).
- The server checks that a statement's body names the row it is stored with (person, device, keys, scope,
  version, granter) and that it is signed by the right account key (`verifyStatement` from WP1; it never
  opens anything), so a stolen session alone can't mark a device trusted. Devices still verify statements
  themselves (§4.8, §8.6). A trusted device re-registering keeps its stored statement.
- `e2eeNoteKeys` has an optional `statement` (the `note-grant` statement of a grant-wrapped key). Every new
  scoped table also has `by_workspace` / `by_owner` (or `_seq`) indexes for `scopedRows`.
- `devices.completeApproval` also stores the sealed AMK on the approval row, which `devices.approval` returns
  once done (a public session gets no stored wrap). `createAccount` from a public session stores no wrap.
- The `e2ee` feature flag is in `lib/flags.ts` (default off). Error codes are thrown with `failE2ee` from
  `lib/e2ee/state.ts` (`lib/errors.ts` is unchanged). `isE2eeActive` also counts a space being decrypted
  (`state: "disabling"`).
- `spaces.setSwitches` and `spaces.enable` schedule `e2ee/mirrors:purge` with `{ scope: vScope, purpose }`.
  `spaces.enable`, `lower` and `rotate` create the `e2eeMigrations` row through `startSpaceMigration` in
  `lib/e2ee/keyStore.ts` (a space-wide job, `total` from the scope's note count); WP3's `migrate` claims it.
- `grants.ts` exports `addPagePending(ctx, doc, profileId)` for the sharing hooks (§8.4).

### 5.4 The sync engine branch (`convex/lib/syncEngine.ts`, WP3)

In `SyncEngine`, a document is sealed when `doc.sealedAt !== undefined` or the space's `level !== "standard"`
and the doc is being created (a new document in an encrypted space must be sealed).

- `createDoc`: if the target scope's `e2eeSpaces.level !== "standard"` or the target folder or parent is
  locked: require `document.sealed`, refuse `templateId` (`e2ee_device_only`), insert the placeholder
  plaintext columns plus `sealedTitle`, `sealedAppearance`, `sealedMeta`, `sealedAt = now`, `locked`,
  `lockedVia`, and the first `e2eeNoteKeys` row in the same mutation. Skip `refreshDerived`, `queueIndex`,
  template copying and the `note.created` webhook (WP5's `emitWebhook` also checks).
- `updateDoc`: for sealed docs require `sealedTitle`/`sealedAppearance` instead of `title`/`icon`/`cover`/
  `style`; title conflicts use `titleRev` and compare `mac`; skip `sanitizeTitle`, `refreshDerived`,
  `refreshLinkLabels`, `checkedCover`'s file check is replaced by "the cover file id is in `fileIds`".
- `upsertBlock`: for sealed docs require `op.block.sealed`; replace `validateWireBlock` by `validateSealedBlock`
  (placeholders exact; `c.byteLength ≤ 600 KiB`; `mac` 22 characters base64url; `k` ≥ 1 and a version that
  exists in `e2eeNoteKeys`; `mentions ≤ 50`); `sameContent` becomes `existing.sealed?.mac === incoming.sealed.mac`;
  the collapse rule reads `sealed.collapsed`; the synced check uses `sealed.syncedSource`; skip
  `trackMentions` (replaced by: notify `mentions` that weren't in `mentionIds` before, with generic text or the
  preview the device sent, §7.7), `syncTaskProjection`, `syncStudyCard`, `syncLinks`.
- `deleteBlock`, `restoreBlock`, positions, ranks and `blocks.rebalance`: unchanged.
- `finish`: `noteEdited` still schedules `autoVersion` for sealed docs, but `settleEdits` skips
  `refreshDerived`; no `queueIndex`, no webhooks.
- Plaintext op on a sealed doc, or on any doc in a space whose `level !== "standard"`: per-op `rejected` with
  `e2ee_required` ("Update Folevi to edit this encrypted note").
- An op touching a document whose `sealing.by` is another device and `sealing.until > now`: throw
  `ConvexError({ code: "e2ee_busy" })` for the whole batch. The client engine treats thrown errors as
  `batchFailed` and retries with its backoff, so nothing is lost.

`snapshot()` (`convex/documents.ts:1415`, WP3) for sealed docs writes `SealedVersionContent`:

```ts
type SealedVersionContent = { e2ee: 1;
  title: { c: string /* base64url */; k: number }; appearance: { c: string; k: number }; meta?: { c: string; k: number };
  blocks: { id: string; parentId: string | null; rank: string; c: string; k: number; collapsed?: true }[];
  authors: string[]; removed: string[] };
```

It is built from the rows' ciphertext with no decryption, so automatic versions, "before restore" versions and
retention keep working. `documentSnapshots.title` is `""`, `sealed: true`.

### 5.5 What the server still validates, and what it purges

On ciphertext the server checks: placeholders, byte sizes, block counts (`maxBlocksPerDocument`), tree
structure (parents exist, no cycles, same document), ranks, scopes, permissions, key versions exist, file ids
belong to the document's scope, record sizes (≤ 900 KiB each, ≤ 20,000 records per scope per kind), rates.
It can't check block types, text limits, table sizes, formulas or links; devices run the same validators
(`validateWireBlock`, `collectionValues.ts`) before sealing, and the router refuses to send invalid blocks.

`purgeDerivedPlaintext(ctx, doc)` in `convex/lib/e2ee/purge.ts` (WP3), run by `migrate.finishDocument`:

| Derived data | Action |
| --- | --- |
| documents.searchText, excerpt, preview, wordCount, charCount, blockCount, templateKey, title, icon, cover, style | placeholders |
| aiChunks, aiIndexState, aiEntities, aiMentions, aiRelations, aiGraphState, documentEdits | delete rows of the doc |
| tasks, studyCards | delete rows of the doc (devices project them) |
| documentLinks (source = doc) | delete |
| fileTexts of the doc | delete (their sealed copies are records) |
| collections, collectionProperties, collectionRows, collectionValues, collectionViews hosted by the doc, or rows of it | delete after the device wrote `collection` records and row metas |
| notifications with documentId = doc | set `title` to the generic text of its kind, clear `body`, set `sealedDocument` |
| proposals pending for the doc | reject (`expired`) |
| webhookDeliveries pending for the doc | clear `payload` and cancel |
| mcpEvents, apiRequests mentioning the doc | clear `result` / `body` |
| aiConversations: `noteRefs` to the doc | remove the reference (titles in messages are not rewritten; listed in §13) |

### 5.6 Guards and error codes

`convex/lib/e2ee/state.ts` (WP2):

```ts
export async function spaceE2ee(ctx: QueryCtx, scope: Scope): Promise<Doc<"e2eeSpaces"> | null>;   // one indexed read
export function isSealed(doc: Doc<"documents">): boolean;                                          // doc.sealedAt !== undefined
export function isSealedBlock(row: Doc<"blocks">): boolean;
export async function isLocked(ctx: QueryCtx, doc: Doc<"documents">): Promise<boolean>;            // doc.locked || doc.lockedVia !== undefined
export async function requirePlainWrite(ctx: MutationCtx, doc: Doc<"documents">): Promise<void>;   // throws e2ee_required if sealed or space level ≠ standard
export async function requirePlainWriteInScope(ctx: MutationCtx, scope: Scope): Promise<void>;
export async function readableFor(ctx: QueryCtx, doc: Doc<"documents">, purpose: "search" | "ai" | "apps"):
  Promise<{ title: string; text: string; tasks?: MirrorTask[]; folderPath?: string; tags?: string[] } | null>;
  // Standard doc: built from the row and blocks as today; sealed doc: from e2eeMirrors if the switch is on and the doc isn't locked; else null
export function switchesOf(space: Doc<"e2eeSpaces"> | null): Switches;                              // Standard: everything "on" (today's behaviour)
```

| Code | Meaning | Copy shown by the client (§10.12) |
| --- | --- | --- |
| `e2ee_required` | plaintext write to sealed data or an encrypted space | "This note is end-to-end encrypted. Update Folevi to edit it." |
| `e2ee_not_set_up` | sealed write without a space key | internal; the client sets up first |
| `e2ee_plaintext` | plaintext fields on a sealed row | internal bug |
| `e2ee_busy` | a device is converting this note | (retried silently; after 2 minutes) "Encrypting this note. Your changes are saved on this device." |
| `e2ee_unavailable` | a feature that needs plaintext, in an encrypted space; `data: { feature }` | per feature, §10.12 |
| `e2ee_switch_off` | the space's switch for this feature is off; `data: { switch }` | "Turn on <switch> in Settings > Privacy to use this here." |
| `e2ee_locked` | the note or folder is Always fully encrypted | "This note is always fully encrypted, so <feature> can't use it." |
| `e2ee_recovery_required` | fewer than two recovery methods | opens the recovery step of the wizard |
| `e2ee_last_method` | removing it would leave one | "You need at least two ways to unlock. Add another before removing this one." |
| `e2ee_conflict` | record compare-and-set lost | (client re-reads, merges, retries) |
| `e2ee_device_only` | the server can't do this for a sealed note (template copy, server duplicate) | internal; the router composes on the device |
| `e2ee_rate_limited` | too many unlock attempts | "Too many tries. Try again in an hour, or use another way to unlock." |

### 5.7 Inventory: every server function that reads or derives plaintext

Columns: what happens for sealed data. **Device**: the router serves it from the replica (§6.4) and the
server function is not called for encrypted spaces (it keeps a guard so an old client gets a clean error).
**Skip**: the server function keeps working but leaves sealed rows out. **Sealed**: a sealed variant (§5.3)
or the same function with sealed fields. **Blind**: works on ciphertext unchanged. **Switch**: works only if
the named switch is on, reading `e2eeMirrors`/provided context. **Off**: refused with `e2ee_unavailable`.
Owner WP in brackets.

**Sync, documents, blocks, organization, files (WP3)**

| Function | Encrypted behaviour |
| --- | --- |
| sync.push / pushJson | Sealed (§5.4) |
| sync.pull / pullJson / head | Skip: sealed rows are returned with placeholders and `sealed` fields; the web uses `e2ee.pull` |
| blocks.list / changes / deleted | Blind: sealed rows returned as `SealedWireBlock`; `ReaderLabels` skipped for sealed blocks; the router opens them |
| blocks.rebalance | Blind |
| documents.list / titles / children / pageTree / info / recent / recentNotes / daily / dailyDates | Device for e2ee-active spaces; the server returns placeholders plus `sealed` fields (so the router's overlay can open titles in Standard spaces with locks) |
| documents.get | Blind with sealed fields |
| documents.backlinks | Device (unlinked mentions skip sealed docs on the server) |
| documents.recordView / seenMark | Blind (snapshot is blind) |
| documents.create / move / bulkUpdate / reorder / setStarred / setArchived / moveToTrash / restoreFromTrash / emptyTrash | Blind (no plaintext); `setTrashState` skips `queueIndex` and webhooks for sealed docs |
| documents.deletePermanently | Blind: `confirmTitle` is checked on the device; the server accepts `confirmTitle: "sealed"` for sealed docs |
| documents.settleEdits / refreshDerivedLater | Skip |
| documents.duplicate, copyVersion, restoreSnapshot, restoreVersion, rewritePage | `e2ee_device_only`; the router composes (§6.7) |
| documents.createSnapshot / autoVersion / snapshot() | Blind (`SealedVersionContent`) |
| documents.importSnapshot | Sealed (`e2ee.content.importVersion`) |
| documents.snapshots / versions / snapshotContent | Blind; the router opens names and content |
| documents.nameVersion | Sealed |
| documents.purgeSnapshots | Blind |
| organization.sidebar / index / recentFolders / draftCount | Device for e2ee-active spaces (sorting by name needs plaintext) |
| organization.createFolder / renameFolder / createTag / updateTag / setDocumentTags | Sealed |
| organization.moveFolder / setFolderColor / deleteFolder / deleteTag | Blind; `moveFolder` and moves of documents keep `lockedVia` in step |
| files.generateUploadUrl / finalize / commitFile | Sealed (`e2ee.files.*`); `finalize` refuses sealed docs |
| files.urls / byPublicId / `/files/*` | Blind: serves ciphertext as `application/octet-stream` |
| files.setPalette | Sealed: the palette is in the file's sealed meta (re-sealed with `e2ee.files.updateMeta`) |
| files.shareForPaste / copyBlob / FileCopies | Same scope and same note: Blind. Another note: the file key is re-wrapped by the target note key on the device (`e2ee.files.rewrap`), bytes shared |
| fileText.forDocument / save | Device (records `fileText`); server refuses sealed docs |
| fileText.readImage | Switch `foliAi` with provided bytes (§7.2) |
| changes.list / note / away | Blind; the router opens titles and blocks |
| changes.undo | `e2ee_device_only`; composed |
| synced.info / home | Blind; titles opened by the router |
| copies.copyTo | `e2ee_device_only` when source or target is sealed; composed |
| lib/linkLabels (`ReaderLabels`, `sharedLabels`, `relabel`), `refreshLinkLabels` | Skip sealed blocks; labels are filled on the device from the replica |
| lib/synced `withSyncedForReader`, `withSyncedShared` | Skip sealed |

**Search, collections, comments, sharing, tasks, study, exports, imports, maintenance, users, workspaces (WP4)**

| Function | Encrypted behaviour |
| --- | --- |
| search.documents / searchDocuments / everywhere | Skip sealed docs (their `searchText` is empty); Switch `searchEverywhere` adds hits from `e2eeMirrors` purpose `search`; the router merges device hits |
| search.byMeaning / meaningAvailable | Switch `backgroundAi` (embeddings built from purpose `ai` mirrors) |
| collections.* (15 functions), charts.collections, lib/collections `copyCollectionsInto` | Device for sealed host notes; the server refuses sealed docs with `e2ee_device_only` |
| comments.threads | Blind; `blockText` empty for sealed blocks; bodies opened by the router |
| comments.create / reply / edit | Sealed (`e2ee.content.*Comment`) |
| comments.remove / setResolved / react / mark* / deleteThread / mentionable / unreadCount | Blind |
| sharing.setAccessMode / grant / revoke | Blind, but `notify` text is generic for sealed docs; `grant` to a person requires a note key grant first (§8.4) |
| sharing.previewPageInvite / sharedWithMe | Blind with sealed fields; the invitee's device opens the title once it has the note key, else "A note shared with you" |
| sharing.openPublicLink | Encrypted link: returns sealed rows plus the link wrap (§9.1). Published plain copy: serves `e2eePublishedCopies` |
| sharing.createPublicLink | Encrypted link requires `e2ee.wrapped`; `plainCopy` path (§9.3) |
| tasks.list / counts / range | Device for e2ee-active spaces; the server skips sealed docs |
| tasks.update / quickAdd / inbox / moveToDocument | `e2ee_device_only` for sealed targets; composed |
| tasks.ensureInbox / legacyPersonalInbox | Sealed Personal: `e2eeSpaces.inboxDocumentId`; never searched by title |
| tasks.repeatTask | Skip (the device repeats to-dos) |
| tasks.processReminders | Skip sealed; WP5's `e2ee.reminders.process` sends `e2eeReminders` |
| study.queue / review / summary | Device (records `studyReview`) |
| exports.exportScope / documentPage / buildExport | Device: export runs in `LocalBackend` (`exports.exportScope` local handler). The server's export of an e2ee-active space includes plaintext notes only, plus `ENCRYPTED.txt` naming how many notes were left out |
| exports.exportForUser (staff) | Same as above |
| imports.importText | `e2ee_device_only`; composed (the local handler parses) |
| maintenance.purgeDocument / purgeAccount / runDeletionJobs / purgeExpiredTrash / purgeTombstones / housekeeping | Blind; also delete the new tables' rows |
| migrations.backfillDocumentPreviews / refreshLinkingPages / backfillStudyCards | Skip sealed |
| migration.documents / fileTexts (account → local) | Blind with sealed fields; the export-to-local flow opens them on the device |
| users.bootstrap (seed) / completeOnboardingStep (`addStarterPages`, `styleWelcomePage`) | Run before E2EE is set up; if Personal is already sealed, starter pages are created by the device (composed) and `styleWelcomePage` is skipped |
| workspaces.guests / setGuestAccess | Blind; generic notification text for sealed docs |
| workspaces.removeMember / leave | Blind, plus a `rotation` pending entry and an `e2eePendingGrants` cleanup; the client prompts a manager's device to rotate (§8.3) |
| workspaces.scheduleDeletion | Blind |
| admin.*, adminAnalytics.* | Blind (no content today) |
| notifications.list | Blind; `sealedDocument` rows get their title opened on the device |
| calendarFeeds.render | Switch `apps` (tasks from purpose `apps` mirrors); else sealed tasks are left out |
| bookmarks.preview | Off by default for encrypted spaces: the server would see the link. Switch: none; the device fetches the preview itself on the Mac (native fetch, as local mode does); on the web the bookmark shows the link only (§14 Q6) |

**AI, integrations, inbound, notifications and push (WP5)**

| Function | Encrypted behaviour |
| --- | --- |
| ai.noteText / gather / recent | Skip sealed (return null / leave out) unless `readableFor(…, "ai")` gives text |
| ai.ask / write / brief / flowchart, aiChat.send / regenerate / edit | Switch `foliAi` with `provided` context (§7.2); no persistence of messages for sealed spaces (`ephemeral`) |
| ai.startStream / stream / writeStream / sweepStreams | Blind; streams for sealed requests are deleted when finished |
| aiChat.pinned / list / get / exportMarkdown / exportAll / saveAsNote / rename / setContext / setActionsOutcome | Device: chats about encrypted spaces are `aiChat` records; `saveAsNote` composed |
| aiActions.folders / apply | Switch `foliAi`: folder names come in `provided`; `apply` is composed on the device |
| aiAgent.* | Off for encrypted spaces in v1 (`e2ee_unavailable`, feature `agent`) (§14 Q5) |
| aiAttachments.answerWithFiles / readForAgent / transcribe | Switch `foliAi`: the device uploads a temporary plaintext copy (kind `attachment`, deleted after the answer) only for the request |
| aiIndex.prepare / store / indexDocument / backfill / sweep / hybridSearch / searchScope | Switch `backgroundAi`: built from purpose `ai` mirrors; otherwise skip sealed; `queueIndex` returns early for sealed docs without the switch |
| aiGraph.* (extract, related, duplicates, contradictions, missingConnections, graph, linkNote) | Switch `backgroundAi` (from mirrors); `linkNote` composed |
| aiResearch.start / regenerate / run / saveAsNote | Switch `foliAi` with provided notes; no note text in scheduler args (pass the request id; text in an `aiStreams`-like temporary row deleted after) |
| aiStudy.translateNote / translationSource / saveTranslated / versionBeforeReplace | Switch `foliAi` with provided blocks; result returned and saved by the device |
| aiSuggestions.forNote / dismiss | Switch `backgroundAi` |
| aiTodos.source / find | Switch `foliAi` with provided text |
| aiWriting.saveDraft | Composed (device saves the draft) |
| aiMemory.* / forHold | Encrypted Personal: memories are `aiMemory` account records, sent in `provided.memories` per request |
| aiDigest.due / start / run / deliver, routines.due / start / run / deliver | Switch `backgroundAi` (material from mirrors); `deliver` into a sealed space writes an `e2eeInbox` item (kind `app`) that a device turns into the note |
| chartAi.fromWords, flowchartAi.fromText (with a note), mindmapAi.generate (note or PDF) | Switch `foliAi` with provided text (PDF: the found text) |
| chartAi.assist, flowchartAi.extend / explain / labels / arrange, mindmapAi.expand / summarize / tasks / tidy, stickiesAi.*, tableAi.*, wireframeAi.* | Switch `foliAi` (they already send block data from the device) |
| emailNotes.receive (via `/webhooks/resend`) | Switch `emailToNote`: parsed, sealed to the space inbox key, stored in `e2eeInbox`, plaintext dropped; off: the address bounces with "This Folevi space is end-to-end encrypted and doesn't accept email." |
| mcp.read / readResource / runRead, restApi.read | Switch `apps`: from purpose `apps` mirrors; else sealed notes are invisible to apps |
| mcp.write / runWrite, restApi.write, web clipper (`create_note` with `inInbox`) | Switch `apps` (clipper: `webClipper`): the write is sealed into `e2eeInbox` (kind `app` or `clip`) and answered `{ status: "queued", id }`; a device applies it |
| proposals.proposeAppend / list / accept | For sealed docs replaced by `e2eeInbox` items |
| webhooks.fanout / deliver, lib/webhooks `emitWebhook` | Switch `apps`: `eventData` from mirrors; else not emitted for sealed docs |
| digest.sendDailyDigests | Blind: notification titles are generic for sealed docs |
| lib/notify `notify` / `notifyAccessChange`, push.*, pushSend.sendToProfile, apnsSend.sendToProfile | Switch `notificationPreviews`: device-supplied preview text; else generic text (§7.7) |
| tasks reminders push | `e2ee.reminders.process` (cron every minute) |
| http `/ical/*`, `/mcp`, `/api/v1/*`, `/webhooks/resend` | As the functions above |

### 5.8 Quotas

Storage counts `files.size`, which for sealed files is the ciphertext size (plaintext + 16 bytes per 64 KiB
+ 17). Nothing else changes in `lib/entitlements.ts`. Records, mirrors, inbox items and published copies are
not counted, like note text today, but are capped: records 900 KiB each, mirrors 1 MiB of text per note,
inbox 25 MiB waiting per space (older items expire after 30 days), published copies 5 MiB.

### 5.9 Deployment safety

- Additive only: new tables, new optional fields, new indexes. `npx convex deploy` with existing data is safe.
- Every new code path is reached only when an `e2eeSpaces` row exists for the scope or a row has `sealedAt` /
  `sealed`. Standard pays one indexed read (`spaceE2ee`) per content-writing mutation; WP3 adds it to
  `tests/convex/backend-performance.test.ts`.
- Feature flag `e2ee` (`featureFlags` table) gates `e2ee.keys.createAccount` and `e2ee.spaces.enable` until
  launch; reads and guards are always on.
- `settings.status.minShellVersion` is raised to the first bundled shell build that understands sealed rows,
  so an old bundled Mac interface asks to update.

## 6. Client architecture

### 6.1 Module map (`apps/web/src/lib/e2ee/`)

```
keys/      keystore.ts      IndexedDB "folevi-e2ee" (device keys, trusted-browser flag, wrap cache)     WP6
           session.ts       KeySession: lock state, the AMK as non-extractable keys, events             WP6
           keyring.ts       space and note keys: fetch grants, open, cache (LRU 5,000 note keys)         WP6
           setup.ts         account creation, recovery methods, rotation, reset                         WP6
           passkey.ts, passphrase.ts, recoveryKey.ts, approval.ts, macBridge.ts, publicMode.ts         WP6
           useKeys.ts       React hooks: useKeySession(), useRecoveryMethods(), useApprovals()          WP6
seal.ts                     sealBlock/openBlock, sealDocumentFields/openDocumentFields, folders, tags,
                            comments, records, files meta (all through the keyring)                      WP7
router/    client.ts        E2eeRouterClient (the duck-typed client)                                     WP7
           routes.ts        E2EE_ROUTES: every api function → route                                      WP7
           decoders.ts      result openers per function                                                 WP7
           merge.ts         overlay and append merges for Standard spaces with locks                    WP7
           spaces.ts        which spaces are e2ee-active, documentId → space index                      WP7
compose/   *.ts             device versions of server mutations that derive plaintext                   WP7
replica/   store.ts         SpaceReplicaStore implements LocalStore                                     WP7
           ingest.ts        pull pages → decrypted rows (derived fields via the local shared helpers)    WP7
           host.ts          one replica host per space across Mac windows (reuses lib/local/host.ts)     WP7
files.ts                    sealed uploads and decrypted downloads (object URLs, cache)                 WP7
migrate/   runner.ts, seal.ts, unseal.ts, reseal.ts, progress.ts                                       WP8
features/  mirror.ts, inbox.ts, reminders.ts, ai.ts, notifyPreview.ts                                   WP8
links.ts                    encrypted share links (fragment, viewer data)                               WP8
copy.ts                     every user-facing string of §10                                            WP9
```

### 6.2 Where keys live

| Platform | Device private keys | AMK | Space and note keys |
| --- | --- | --- | --- |
| Web, trusted browser | non-extractable `CryptoKey`s (X25519 `deriveBits`, Ed25519 `sign`) in IndexedDB `folevi-e2ee`, store `device` | opened at each page load from the device wrap, imported as non-extractable HKDF key; derived keys non-extractable | in memory (keyring), opened from grants each load; nothing persisted |
| Web, public computer | non-extractable `CryptoKey`s in memory only | memory only | memory only |
| Mac app (website or bundled interface) | in the main process: Node `crypto` X25519 and Ed25519 keys, private halves sealed with `safeStorage` in `userData/e2ee/device.bin` (Keychain-backed); `deviceId` in `userData/e2ee/device.json` | the main process opens the device wrap and hands the 32 bytes to the page, which imports them non-extractable and zeroes the array | as web |

Mac bridge (`apps/desktop/src/e2ee.ts`, exposed as `foleviShell.e2ee` from `preload.ts`, origin-checked like
the other bridges, WP6):

```ts
interface ShellE2ee {
  deviceKeys(): Promise<{ deviceId: string; x25519Pub: Uint8Array; ed25519Pub: Uint8Array }>;  // creates on first call
  open(sealedBox: Uint8Array, context: string): Promise<Uint8Array>;   // FLS1 open with the device X25519 key
  sign(kind: string, body: string): Promise<string>;                  // FST1 with the device Ed25519 key
  reset(): Promise<void>;                                              // forget the device keys (sign-out, revoke)
}
```

The Mac's existing app lock (`apps/desktop/src/lock.ts`) can require Touch ID before `open` runs (Settings >
Desktop app > "Ask for Touch ID to unlock encrypted notes"; WP6).

### 6.3 Unlock flow

```
App start (AccountGate, signed in)
  → e2ee.keys.status + e2ee.spaces.mine
  → nothing e2ee-active and no account keys: no change (Standard user)
  → account keys exist:
       this device has a trusted wrap?  yes → open it (Mac bridge or IndexedDB key) → Unlocked
                                        no  → UnlockScreen: "Approve from another device" | "Use a passkey" |
                                              "Enter your encryption passphrase" | "Enter your recovery key"
                                              then "Trust this browser" or "This is a public or shared computer"
  → Unlocked: keyring loads grants for e2ee-active spaces; replicas open (§6.5); the router goes live
```

While locked, Standard spaces work normally; e2ee-active spaces show the unlock screen in place of their
content (the sidebar shows the space with a lock). The router answers their queries with
`ConvexError({ code: "e2ee_locked_session" })`, which `AccountGate` turns into the unlock screen.

Sign-out clears the keyring, the session and, on a public session, all IndexedDB `folevi-e2ee*` databases; on a
trusted browser the device keys stay (so the next sign-in on this browser can unlock) unless the person chose
"Forget this browser".

### 6.4 Routing: `E2eeRouterClient`

`lib/convex/provider.tsx` (WP7) wraps the account `ConvexReactClient` in `E2eeRouterClient` when the account
has E2EE set up (`e2ee.keys.status().setUp`); otherwise it passes the raw client, so Standard users run exactly
today's code. `getConvexClient()` keeps returning the raw client for `nativePush` and `nativeDevice`.

```ts
export class E2eeRouterClient /* the same surface as LocalClient: watchQuery, query, mutation, action, connectionState, subscribeToConnectionState, logger, setAuth, clearAuth, close */ {
  constructor(inner: ConvexReactClient, deps: { session: KeySession; keyring: KeyRing; spaces: SpaceIndex; replicas: ReplicaHub; engine?: () => SyncEngine });
}

type Route =
  | { kind: "pass" }                                         // no content: straight to Convex
  | { kind: "decode"; open: Decoder }                        // Convex, then open sealed fields in the result
  | { kind: "device" }                                       // LocalBackend over the space's replica (e2ee-active spaces); else pass
  | { kind: "overlay"; open: Decoder; merge: Merger }        // Convex, open, then fill sealed entries from the replica (Standard spaces with locks)
  | { kind: "append"; merge: Merger }                        // Convex result plus the replica's hits (search, tasks, backlinks)
  | { kind: "sealed"; to: FunctionReference<"mutation">; seal: ArgSealer }   // seal args, call the e2ee variant
  | { kind: "compose"; run: Composer }                       // device implementation (reads replica, writes via engine + sealed calls)
  | { kind: "ai"; run: AiRouter }                            // feature switches and consent (§7.2)
  | { kind: "off"; feature: string };                        // e2ee_unavailable

export const E2EE_ROUTES: Record<string /* "module:function" */, Route>;
```

Which space a call concerns (`spaces.ts`, `resolveSpace(name, args)`):
1. `args.scope` → that scope.
2. else the first of `documentId`, `parentDocumentId`, `sourceId`, `targetDocumentId`, `folderId`, `tagId`,
   `collectionId`, `threadId`, `commentId`, `fileId`, `snapshotId`/`versionId`, in that order, looked up in
   the `SpaceIndex` (ids from every replica, plus documents opened outside a replica through `decode`).
3. else the router's current context scope (`AppStateProvider`'s scope, set with `setScope`).
4. A route is applied only when the resolved space is e2ee-active or the resolved document is sealed;
   otherwise every call is `pass`.

`sync.push` is handled by the router itself: it seals each op whose document is sealed or is created in an
e2ee-active space or locked folder (§6.6), sends one Convex `sync.push`, opens every returned block and
document, and returns results in the plaintext shape the engine expects.

The route table covers every function the app calls. A coverage test (`tests/e2ee/route-coverage.test.ts`,
WP7) scans the same files as `tests/parity/coverage.test.ts` and fails when a function has no entry. Starting
classification (WP7 fills in every function):

| Route | Functions |
| --- | --- |
| pass | users.*, workspaces.* (except guests), billing.*, workspaceBilling.*, settings.*, themes.*, presence.*, push.*, apiTokens.*, mcp grants, notifications mark*, comments.remove/setResolved/react/mark*/deleteThread/mentionable/unreadCount, documents.setStarred/setArchived/moveToTrash/restoreFromTrash/emptyTrash/trashSummary/move/bulkUpdate/reorder/recordView/hideFromRecent/showInRecent/createSnapshot, organization.moveFolder/setFolderColor/deleteFolder/deleteTag, sharing.setAccessMode/revoke/createPublicLink (non-e2ee args)/revokePublicLink/setPublicLinkTheme, blocks.rebalance, e2ee.* |
| decode | documents.get, blocks.list/changes/deleted, documents.snapshots/versions/snapshotContent/blockAuthors, comments.threads, changes.list/note/away, synced.info, notifications.list, sharing.sharedWithMe/previewPageInvite/get, files.urls, workspaces.guests |
| device | documents.list/titles/children/pageTree/backlinks/info/recent/recentNotes/daily/dailyDates, organization.sidebar/index/recentFolders/draftCount, search.documents/everywhere (+ append of Standard spaces for `everywhere`), tasks.list/counts/range, collections.get/rowForDocument, charts.collections, study.queue/summary, fileText.forDocument, synced.home, exports.exportScope |
| sealed | organization.createFolder/renameFolder/createTag/updateTag/setDocumentTags, comments.create/reply/edit, documents.nameVersion/importSnapshot, collections.* writes (as records), fileText.save, study.review/setNewPerDay, files.setPalette, documents.deletePermanently (confirmTitle checked on device) |
| compose | documents.duplicate/copyVersion/restoreSnapshot/restoreVersion, changes.undo, tasks.update/quickAdd/inbox/moveToDocument, imports.importText, copies.copyTo, aiChat.saveAsNote, aiResearch.saveAsNote, aiWriting.saveDraft, aiActions.apply, aiGraph.linkNote, documents.create from a template |
| ai | ai.*, aiChat.*, aiResearch.*, aiStudy.*, aiTodos.*, *Ai.*, fileText.readImage, aiAttachments.*, search.byMeaning, aiSuggestions.*, aiGraph queries |
| off | aiAgent.* (v1), bookmarks.preview on the web, exports server-side for sealed notes |

The outbox (`OUTBOX_MUTATIONS`) calls `client.mutation(ref, args)` on the router, so offline folder,
comment and collection changes are sealed when sent. Their plaintext args wait in IndexedDB like today, which
is fine on a trusted device; in public computer mode the outbox database is in memory (§6.10).
`lib/sync/overlays.ts` applies queued changes over whatever `useQuery` returned, so it works on device results
unchanged.

### 6.5 The replica: `SpaceReplicaStore`

One replica per e2ee-active space, opened after unlock, held by `ReplicaHub` (`replica/host.ts`). It
implements `LocalStore` (`apps/web/src/lib/local/store.ts`) for the `LocalBackend`, read-only for handlers:
mutations are never routed to the backend, and `put`/`remove` throw `e2ee_replica_read_only` in development.

- **Tables filled**: `documents` (`LocalDocument`, with `searchText`, `excerpt`, `preview`, counts, `links`
  and `textRev` computed by the same shared code the local backend uses on writes,
  `lib/local/functions/shared.ts` `refreshDerived`; `starred` and `starOrder` from `e2ee.pull.mine` for this
  person; `row` from the sealed meta), `blocks`, `folders`, `tags`, `collections` (from `collection`
  records), `fileTexts`, `studyReviews`, `files` (opened metadata), `recents` (from `mine`), and `meta`
  (`seq`, ordinals). Handlers that read tables the replica doesn't fill (`calendars`, `notices`, `versions`)
  get empty lists; those functions are routed elsewhere.
- **Feeding**: subscribe to `e2ee.pull.head({scope})`; when `head > cursor`, page through `e2ee.pull.pull`
  until `hasMore` is false; open every row (keyring), write into the replica in one commit per page, and
  emit the dependency keys (`doc:<id>`, `blocks:<id>`, `catalog`, `folders`, `tags`, …) so device queries
  re-run. Also subscribe to `e2ee.pull.mine({scope})`.
- **The engine's own writes**: after `sync.push` results come back, the router passes the accepted blocks and
  documents to the replica immediately (`replica.applyAccepted(results)`), so a device query after `await
  mutation` already sees the change. The pull later delivers the same rows; ingest is idempotent by
  `(id, revision)`.
- **Pending edits**: device queries read the replica with the engine's pending ops applied on top
  (`engine.state.entities`), the same overlay `DocumentView` already uses, so lists and previews update while
  typing offline.
- **Persistence**: trusted devices keep the replica in IndexedDB `folevi-e2ee-<scopeKey>` (rows and cursor,
  the `replicaDb.ts` layout reused), so a launch shows the space before the first pull; public sessions keep
  it in memory.
- **Cold start**: until the first full pull completes, device queries for that space return what's there and
  `useE2eeSpaceStatus(scope)` reports `"downloading"` with counts; search shows "Still downloading this
  space (N of M notes). Results may be missing." With Search everywhere on, the router appends server search
  hits meanwhile.
- **Multiple windows (Mac)**: `replica/host.ts` takes the Web Lock `folevi-e2ee-<scopeKey>`; other windows
  use a `RemoteExecutor` over `BroadcastChannel` (the classes in `lib/local/host.ts`).
- **Locks in Standard spaces**: the replica holds only sealed documents, locked folders, and tags (names come
  plaintext from the server for Standard tags). `overlay` routes fill sealed entries in server results from
  it; `append` routes add its hits.

### 6.6 The transport for `sync.push`

`router/client.ts` `pushSealed(args)`:

1. For each op, find the document's state (replica, `SpaceIndex`, or for a create the target scope, folder
   and parent).
2. Plain document in a Standard space: unchanged op.
3. Sealed document (or a create into an e2ee-active space or locked folder):
   - `block.upsert`: `sealBlock(docId, block)` → `SealedWireBlock` with `mac`, `k` (newest note key), `collapsed`
     if `props.collapsed`, `syncedSource` if `type === "synced"`, `mentions` from the block's `mention`
     inline nodes.
   - `document.create`: make NK v1, wrap it by the current space key, seal title, appearance and meta, add
     `fileIds`; if the parent page has guests (`e2ee.grants.noteAudience`), queue `e2ee.grants.grantNote`
     for each right after the create is applied.
   - `document.update`: seal title (with `mac`) and appearance from the patch; `folderId`/`parentDocumentId`
     unchanged. Moving into a locked folder or out of one is a composer (§6.7), never a plain patch.
4. Results: open `block`, `document`, `conflict.server`, `conflict.client` back to plaintext; a block that
   fails to open becomes an `unreadable` block (`type: "paragraph"`, text "This block couldn't be decrypted.
   It may have been damaged.") marked read-only, and the failure is logged without content.

### 6.7 Derived features on the device

| Feature | How it runs in an encrypted space |
| --- | --- |
| Previews, excerpts, word counts | `refreshDerived` from `lib/local/functions/shared.ts` at ingest |
| Search (titles, text, text found in files) | `LocalSearchIndex` (`lib/local/search`), persisted with the replica on trusted devices |
| Links, backlinks, unlinked mentions | local `documents.backlinks` over `LocalDocument.links` |
| Page link labels and page card titles | decoders relabel `pageLink` labels and `titleCache` from replica titles before returning blocks |
| Tasks, Today, calendar, reminders | local `tasks.*` (`projectTask`); reminders: `features/reminders.ts` keeps `e2eeReminders` rows in step (§7.6) |
| Repeating to-dos | the local `repeatTask` port runs on the device that checks one off |
| Collections, charts, formulas | local `collections.*`; definitions are `collection` records (`LocalCollection` JSON), row values in each row note's sealed meta; writes go through `e2ee.content.putRecord` and sealed document patches (`sealed` route) |
| Synced blocks | same space only; content opened like any note; `synced.home` local |
| Daily notes | local `documents.daily`; creation sends plaintext `dailyDate` |
| Study cards | local `study.*`; schedules are `studyReview` records (one per note, `profileId` set) |
| Version history | server keeps versions blindly; `VersionHistory.tsx` gets opened content from the decoder; diffs are computed on the device as today |
| Restore, copy version, undo changes | composers: read the opened version, write the differences as engine ops (the "before restore" version is made by the server first via `documents.createSnapshot`, which is blind) |
| Duplicate, templates, import, copy to another space | composers: read source rows from the replica (or the server for templates and built-ins), make new ids, create through the engine; copying from sealed to Standard asks first: "The copy in <space> won't be end-to-end encrypted. Copy anyway?" |
| Export | local `exports.exportScope`: the ZIP is built on the device (fflate) and saved (`shell.files.save` on the Mac, a download on the web) |
| Inbox page (Quick add) | `tasks.quickAdd` composer adds the to-do to `e2eeSpaces.inboxDocumentId`, creating the Inbox on first use |

### 6.8 Attachments

- Upload (`lib/sync/uploads.ts` branches to `lib/e2ee/files.ts` `uploadSealed` when the document is sealed):
  run `fileBytes.ts` checks (sniffed type, limits, metadata stripped, width and height) on the plaintext;
  FK random; seal meta `{name, mime, width, height, palette?, sha256 (plaintext)}`; FLV1 0x04 the bytes;
  `e2ee.files.generateUploadUrl` → `fetch` → `e2ee.files.commit`. The upload queue and retries are the same
  (`PendingUpload` gains `sealed: true`; the blob stored is the plaintext, so a retry re-encrypts).
- Download and display: the `files.urls` decoder returns `blob:` URLs from `FileCache` (fetch ciphertext,
  open, `URL.createObjectURL`); cache up to 200 MB per tab, evicted least recently used. Audio and video open
  whole (v1 limit 500 MB per file, a larger file offers "Download" only); range decryption through a service
  worker is a follow-up (§13).
- Covers and note style images are files like any other (their palette lives in the sealed meta).

### 6.9 Background migration

`migrate/runner.ts` (WP8) runs on any unlocked device of a person allowed to do it (Personal: its owner;
workspaces: owners and admins) while a migration is open. It claims a lease (`e2ee.migrate.claim`), works
through documents in ULID order, heartbeats every 30 s, and releases on hide. If the lease expires another
device continues from `cursor`. Progress shows in Settings > Privacy and in a small status line in the
sidebar footer (WP9).

**Seal one document** (`migrate/seal.ts`):
1. `beginDocument` (lease on the document, note key v1 wrapped by the space key).
2. Read plaintext rows through the normal decode-free server queries (`documents.get`, `blocks.list`
   including tombstones via `blocks.deleted`, comments, fileTexts, collections hosted by it, its row values).
3. `sealBlocks` in batches; `sealDocumentFields`; `sealComments`.
4. `finishDocument` with the `collection`, `fileText` and `studyReview` records; the server purges (§5.5).
5. Phase `history`: for each snapshot, `documents.snapshotContent` → seal → `sealSnapshot`.
6. Phase `files`: for each file, download plaintext, seal, `e2ee.files.replaceBlob`, wrap FK.
7. Phase `cleanup`: folders and tags sealed (`e2ee.content.renameFolder` / `updateTag` with sealed names),
   AI chats of the space moved into `aiChat` records and the server copies deleted, `aiMemories` moved,
   mirrors created if switches are on.

Edits during a migration: a device that wants to write to a not-yet-sealed document in an enabling space
seals that document first (steps 1 to 4, out of order), then sends sealed ops. Documents being sealed by
another device answer `e2ee_busy` and the engine retries.

**Unseal** is the mirror image (`unsealBlocks`, `unsealDocumentFields`, `finishUnseal`, then history, files
and cleanup). The server recomputes derived data per document in `finishUnseal`. When the last document is
done, `e2eeSpaces.level` becomes `standard`, `state` `off`, and the space's keys and grants are deleted after
30 days (so a mistaken reversal can still be read on devices meanwhile).

**Re-seal** (rotation) re-encrypts rows under old note key versions with `resealBlocks` and friends; rows
whose revision changed are skipped (their new content already used the new key).

**Lock a folder or note** in any space: `e2ee.content.setFolderLocked({folderId, locked})` /
`e2ee.content.setDocumentLocked({documentId, locked})` (WP3) mark it and start a `document`- or `folder`-scoped seal migration (only
needed in Standard spaces; in encrypted spaces the notes are already sealed and the lock only removes their
mirrors). Unlocking in a Standard space asks "Stop encrypting this folder? Its notes will be readable by Folevi
again." and starts an unseal for it. Moving a note into a locked folder seals it first; out of a locked folder
in a Standard space asks the same question.

### 6.10 Public computer mode

- Chosen on the unlock screen ("This is a public or shared computer"). The device is a `session` device with
  in-memory keys; no wrap is stored for it.
- The replica, the keyring, the sync engine's state and the outbox use in-memory databases for this tab:
  `lib/sync/db.ts` gets an `openLocalDb({ memory: true })` option (WP7) backed by a `Map`, and
  `SpaceReplicaStore` skips IndexedDB.
- Edits not yet sent when the tab closes are lost. The status pill says "Public computer: changes are kept
  only until you close this tab", and closing with unsent changes shows the browser's leave-page prompt.
- At sign-out or the next load, anything left over from a public session in IndexedDB is deleted.

### 6.11 Mac app

- Same web code at either origin. The main process owns the device keys (§6.2). Settings > Desktop app
  recommends the built-in interface for encrypted spaces ("The built-in interface only runs code that came
  with the app"), and offers the switch.
- Passkey recovery isn't offered in the Mac app; the unlock screen says "To use your passkey, open Folevi in
  your browser and approve this Mac from there."
- WP6 adds `foleviShell.e2ee` to `apps/desktop/src/preload.ts` and its handler registration to `main.ts`, and
  unit tests in `apps/desktop/src/e2ee.test.ts`.

## 7. Feature switches

### 7.1 The switches and the levels

| Switch (`vE2eeSwitches`) | Values | Default at "features you pick" | At "Fully encrypted" |
| --- | --- | --- | --- |
| `foliAi` | `off`, `ask` (ask every time), `auto` | `ask` | `off`, can't change |
| `backgroundAi` | on/off | off | off |
| `searchEverywhere` | on/off | off | off |
| `apps` | on/off | off | off |
| `emailToNote` | on/off | off | off |
| `webClipper` | on/off | off | off |
| `notificationPreviews` | on/off | off | off |

In a Standard space every switch reads as on (`switchesOf(null)`), which is today's behaviour; sealed
(locked) notes in a Standard space follow the "Fully encrypted" column. A locked folder or note never uses any
switch at any level: mirrors skip it, `provided` AI context may not include it (the server refuses its ids
with `e2ee_locked`), inbox items can't target it, previews are generic.

Who sets them: Personal, its owner; a workspace, its owner and admins (members see them read-only in
Settings > Workspace > Privacy).

### 7.2 Foli AI (`foliAi`)

Per request, from `features/ai.ts` (WP8) through the `ai` route:

1. The router resolves the space. Standard and not locked: pass through unchanged.
2. `off` or locked: `e2ee_switch_off` / `e2ee_locked`; the UI shows §10.12's text with a link to the setting.
3. Gather context on the device, matching what the server would have read:
   - one note (`ai.write`, the editor AI modules, `aiTodos.find`, `aiStudy.translateNote`, `chartAi.fromWords`,
     `flowchartAi.fromText`, `mindmapAi.generate`): the note as Markdown (`blocksToMarkdown` from
     editor-schema, the same as `ai.noteText`), plus found text for PDFs;
   - "about my notes" (`ai.ask`, `aiChat.send`, `aiResearch.start`): candidates from the replica's search
     index for the question (top 12 notes, at most 60,000 characters in total, the same budget as
     `answerFromNotes`), plus the notes the person attached;
   - `ai.brief`: notes edited in the last 7 days (searchText up to 2,500 characters each) and open to-dos;
   - memories from `aiMemory` records.
4. `ask`: show the consent dialog (§10.9) listing each note's title and the character count, with "Send" and
   "Don't send". Remember "Don't ask again for this note today" per note in memory only.
5. Call the server function with the extra argument:

```ts
provided?: {
  scope: WireScope;
  notes: { id: string; title: string; markdown: string; folder?: string }[];
  memories?: string[];
  files?: { name: string; mime: string; bytes: ArrayBuffer }[];   // only readImage, transcribe, chat attachments; ≤ 8 MB total
  consent: "asked" | "auto";
  ephemeral: true;                                                // nothing about the request is stored on the server after the answer
}
```

Server rules (WP5, in each AI function and in one helper `providedContext(ctx, provided)` in
`convex/lib/e2ee/ai.ts`): the scope's `foliAi` must not be `off`; none of `notes[].id` may be locked
(`isLocked`); every id must be a document the caller can read in that scope; with `provided`, the function
never calls `ai.noteText`, `gather` or `hybridSearch` for that scope; credits are metered exactly as today
(`ai.begin` / `ai.settle`); stream rows (`aiStreams`) for the request are deleted when it finishes; no
`aiConversations`, `aiMessages`, `aiRuns` or `aiResearch` rows are written for sealed spaces; the answer is
returned to the device, which stores chats as `aiChat` records (one record per conversation, `profileId` set).
Nothing from `provided` goes into scheduler arguments: `aiResearch` keeps its notes in a temporary row
(`aiStreams` with a `kind: "context"` field, WP2 adds it as optional) deleted when `run` finishes.

`backgroundAi`: when on, `features/mirror.ts` keeps purpose `ai` mirrors (title and Markdown) for every
sealed, unlocked note, and the server's background features read them through `readableFor(…, "ai")`:
`aiIndex` (embeddings, search by meaning), `aiGraph` (related notes, duplicates), `aiSuggestions`,
`aiDigest` (Catch me up), `routines`. When off (or the level goes to Fully encrypted), `e2ee.spaces.setSwitches`
schedules `e2ee.mirrors.purge({scope, purpose: "ai"})`, which deletes the mirrors and the AI rows built from
them (`aiChunks`, `aiIndexState`, `aiEntities`, `aiMentions`, `aiRelations`, `aiGraphState` of sealed docs).

### 7.3 Search everywhere (`searchEverywhere`)

On: purpose `search` mirrors hold, per sealed unlocked note, `title` and `text` = the note's `searchText`
plus its found text (the same strings the server's `search_text` index holds for Standard notes).
`search.documents` and `search.everywhere` (WP4) add mirror hits (`e2eeMirrors.search_text` and
`search_title`, filtered by scope and purpose) for scopes the caller can read, with the same snippet code.
The router uses server results while a replica is still downloading and on public sessions before the first
pull ends, and merges them with device results by document id. Off: purge purpose `search`.

### 7.4 Apps and integrations (`apps`)

On: purpose `apps` mirrors hold title, the note as Markdown (the `noteDetail` shape from `mcp.ts:177`),
`folderPath`, tag names and tasks. Reads in `mcp.ts`, `restApi.ts`, `webhooks.ts` (`eventData`) and
`calendarFeeds.render` use `readableFor(…, "apps")`. Writes (`create_note`, `append_to_note`, `add_task`,
`complete_task`, `update_task`, REST `notes.create`, `notes.append`, `tasks.*`) for a sealed space become
`e2eeInbox` items of kind `app`, sealed by the server to the space inbox key (`convex/lib/e2ee/inboxSeal.ts`,
WP5, using noble X25519 + WebCrypto or noble AES-GCM), and the tool answers
`{ status: "queued", id, message: "Folevi will add this the next time one of your devices is online." }`.
New note ids are chosen by the server so the app can refer to them. Webhooks fire once a device has applied
the item (the mirror update triggers `note.created` / `task.*`). Off: purge purpose `apps`; webhooks, MCP,
REST and calendar feeds no longer see the space's sealed notes (their places in Settings > Connected apps show
"Paused: this space is end-to-end encrypted").

### 7.5 Email-to-note and web clipper (`emailToNote`, `webClipper`)

On: `emailNotes.receive` (WP5) parses the mail as today (`emailNoteBlocks`), then instead of
`saveToInbox` seals `{ kind: "email", subject, from, blocks, attachments: [{ name, mime, bytes }] }` (≤ 20 MB)
into `e2eeInbox`; the clipper's `create_note` with `inInbox` seals `{ kind: "clip", title, markdown, url }`.
Plaintext is dropped at the end of the mutation; nothing plaintext is stored. `features/inbox.ts` (WP8) on
any unlocked member device subscribes to `e2ee.inbox.waiting({scope})`, opens each item with the space inbox
key, creates the note in the Inbox (sealed, through the engine), uploads attachments sealed, and calls
`e2ee.inbox.markApplied`. Off: email to the space's address bounces with the text in §5.7; the clipper shows
"This space is end-to-end encrypted. Turn on the web clipper in Settings > Privacy to save clips here."

### 7.6 Reminders

Every space with sealed notes: `features/reminders.ts` (WP8) keeps one `e2eeReminders` row per open to-do with
a reminder for the people it reminds (the person who set it; assignees in workspaces), through
`e2ee.reminders.put({documentId, blockId, profileId, remindAt, preview?})` and `remove`. `preview` is set only
with `notificationPreviews` on (`{ title: to-do text, note: note title }`). The cron
`e2ee.reminders.process` (every minute, WP5) sends push and in-app notifications: "A reminder is due"
(body "Open Folevi to see it.") or, with previews, "Reminder: <to-do>" / "In <note>". Times are visible to the
server; that is in §3.2.

### 7.7 Notification previews (`notificationPreviews`)

For sealed documents, `lib/notify.ts` (WP5) writes generic titles and no body unless a preview was supplied:

| Event | Without previews | With previews (text supplied by the acting device) |
| --- | --- | --- |
| Mention in a note | "<Name> mentioned you in a note" | "<Name> mentioned you in <title>", body = the line |
| Comment / reply | "<Name> commented on a note" / "<Name> replied to your comment" | "… on <title>", body = comment excerpt |
| Shared with you | "<Name> shared a note with you" | "<Name> shared <title> with you" |
| Reminder | "A reminder is due" | "Reminder: <to-do>" |

The bell (`notifications.list`) on an unlocked device replaces the generic title with the real one from the
replica or the note key (decoder), so people still see titles inside the app. Push (Web Push, APNs) and email
digests get only what the server has. Supplied previews: the router adds `preview: { title, excerpt }` to
sealed comment calls and `mentions` with a `preview` map to sealed block ops (`sealed.mentionPreview`,
optional, max 140 characters) only when the switch is on.

## 8. Workspaces

### 8.1 Keys for members

A workspace's space key is granted to each member's account key (`e2eeSpaceGrants`). `e2ee.spaces.keyHolders`
reports how many members can unlock it. Joining needs E2EE set up: a member without account keys sees "This
workspace is end-to-end encrypted. Set up encryption to open it." and the setup wizard.

### 8.2 Invites (pending until the invitee has keys)

1. An admin invites as today (`workspaces.invite`). Nothing E2EE happens yet (the invitee may not have an
   account).
2. The invitee accepts (`workspaces.acceptInvite`, WP4 adds a hook): membership is created and, for an
   encrypted workspace, an `e2eePendingGrants` row (`reason: "joined"`).
3. When the invitee has account keys (`e2ee.keys.createAccount` or already), any online device of an owner or
   admin with the space key sees the pending row (`e2ee.grants.pending`, subscribed by `features/inbox.ts`'s
   sibling `features/grants.ts`, WP8), fetches the invitee's public keys and statement (`accountKeysOf`),
   verifies the statement's signature against its own `ed25519Pub`, seals every space key version the member
   needs (current, plus retired ones for history) and calls `e2ee.grants.grantSpace`.
4. Until then the invitee sees the workspace with "Waiting for an admin's device to share the key. This happens
   automatically when one of them opens Folevi." Admins see a badge on Settings > Members.

### 8.3 Removing a member, and rotation

`workspaces.removeMember` (and `leave`) delete the person's grants at once (the server stops serving them
anything, as today) and create a `rotation` pending entry. The next online owner or admin device runs
`e2ee.spaces.rotate` (§4.9): new space key for all remaining members, new data under it at once, background
re-seal of old data (`reseal` migration). Settings > Members shows "Changing the workspace key… 120 of 900
notes" while it runs.

### 8.4 Guests and page sharing

- Sharing a sealed page with a person (`sharing.grant`): the sharer's device first seals the page's current
  note key, and the keys of its sub-pages, to the person's account key (`e2ee.grants.grantNote`), then calls
  `sharing.grant`. A person without account keys gets a pending page invite: "They'll be able to open it once
  they set up encryption." The grant is completed by the sharer's or any manager's device (same pattern as
  §8.2, with `e2eePendingGrants` keyed by document; WP2 adds `documentId` optional to that table).
- New sub-pages of a shared page get grants for the same people at creation (§6.6 step 3).
- Guests open the page through `decode` routes with keys from `e2ee.grants.myNoteKeys`; they have no replica,
  so device-only features (backlinks across the space, search) are scoped to what they can open.
- Removing a guest rotates that page's note key (and its sub-pages').
- Encrypted links are in §9.

### 8.5 Roles

Unchanged and enforced by the server. Only owners and admins can change the level, the switches, rotate keys,
or complete grants. Read-only members get grants (they need to read); the server stops their writes as today.

### 8.6 Member security codes

Settings > Members > a member > "Security code": 12 digits from `SHA-256("folevi/e2ee/v1/member-code" ‖
ed25519Pub)` (the first 40 bits as a decimal number mod 10^12, zero-padded, shown as four groups of three). Both people compare it in person or by call. When
a member's account key changes (reset), co-members' devices show "<Name>'s encryption key changed. If you
didn't expect this, check with them." This doesn't block anything in v1.

### 8.7 Admin recovery

- A member who lost every method resets encryption (`e2ee.keys.resetAccount`); their workspaces get
  `reason: "reset"` pending grants and an admin's device re-grants the space keys to the new account key.
  Their Personal notes stay unreadable.
- If the workspace's last key holder loses their keys, nobody can read it. Settings > Workspace > Privacy warns
  while only one person holds the key: "Only you can unlock this workspace. If you lose your recovery methods,
  its notes are gone. Make sure another admin has set up encryption."

## 9. Links and publishing

### 9.1 Encrypted share links

- Creating a link for a sealed note (`ShareDialog.tsx`, WP9; `links.ts`, WP8): random 32-byte link secret
  `s`; `wrapped = FLV1 0x03(HKDF(s, "link/wrap"), keyVersion = note version, context
  note-key/<docId>/<v>/link/<linkPublicId>, NK)`; `sharing.createPublicLink({ …, e2ee: { noteVersion, wrapped } })`.
  The URL is `https://app.folevi.com/s/<token>#k=<base64url(s)>`. The fragment never reaches the server
  (browsers don't send it).
- Opening: `app/s/[token]/page.tsx` (WP8) sees `e2ee` on the link (from `sharing.openPublicLink`, which for
  sealed notes returns the sealed rows, the files' sealed metadata, collections as records and the wrap)
  and renders `EncryptedShare.tsx`, a client component, with no content in the HTML. It reads `#k`, opens the
  note key, opens everything and renders with `ReadOnlyBlocks`. Images load through `e2ee` file decryption
  with signed URLs issued by the share response. Password-protected links keep the server-side password check.
- Missing or wrong `#k`: "This link is missing its key. Ask the person who shared it to send the whole link."
- Revoking a link deletes its row and its `e2eeNoteKeys` link wrap and rotates the note key in the background
  (§4.9), so someone who saved the key can't read later edits.
- Sub-pages and linked pages aren't included (as today for links to other pages: "Page you can't open").
- No search engine indexing for encrypted links (`allowIndexing` is forced off: the HTML has no content).

### 9.2 Invites by email

Page invites and workspace invites follow §8.2 and §8.4. The invitation email (Resend) never contains titles
of sealed notes: "<Name> shared a note with you on Folevi."

### 9.3 Publish to the web (a plain copy, on purpose)

"Publish to the web" on a sealed note opens the warning (§10.11). Confirming makes the device render a plain
copy: title, icon, cover, style, blocks (with page link labels resolved), collections as read-only tables,
and images re-uploaded as plain public files (`files` rows of kind `image`, unsealed, in the same scope,
counted in storage). `e2ee.links.publishCopy({ documentId, linkId?, copy })` (WP5) stores it in
`e2eePublishedCopies` / `e2eePublishedChunks`; `sharing.openPublicLink` serves the copy for `plainCopy`
links exactly like a Standard page (server-rendered, indexable if allowed). The copy doesn't follow edits:
the note's share panel shows "Published copy from 21 Oct, 14:02" with "Update published copy" and "Stop
publishing" (deletes the copy and its plain files).

## 10. Screens and copy

House rules for every screen: no em dashes; the assistant is "Foli AI"; the app's `Select`, `Menu`,
`Switch`, `Dialog`, `Button`, `Checkbox` components only (no native `<select>`, checkboxes or alerts); no
emoji; neutral chrome (white and near-black surfaces, the note's own colours only inside notes); corner radius
tokens (`rounded-control` for inputs and buttons, `rounded-panel` for cards, `rounded-sheet` for dialogs);
plain, specific words. All strings live in `lib/e2ee/copy.ts` (WP9) and go through the i18n helper like the
rest of the app. Strings below are the English source.

### 10.1 Settings > Privacy (new section, You)

Placed after Security in `SettingsView.tsx` (`{ id: "privacy", label: "Privacy", icon: LockKeyhole }`).

- Heading: "Privacy"
- Intro: "Choose how much of your Personal space Folevi's servers can read. Workspaces have their own setting,
  chosen by their admins."
- Three cards (radio cards, one selected):
  - **Standard.** "Folevi's servers can read your notes so search, Foli AI, apps and email-to-note work
    everywhere. This is how Folevi works today."
  - **Encrypted, with the features you pick.** "Your notes are encrypted on your devices before they're sent.
    Folevi can't read them. Features that need to read notes are off until you turn them on below, and each
    one says what it shares."
  - **Fully encrypted.** "Your notes are encrypted on your devices and nothing is ever shared in a readable
    form. Search runs on your devices. Foli AI, apps, email-to-note and notification previews are off."
- Link under the cards: "What each choice means" (opens §10.3).
- When the selection differs from the current level: button "Turn on encryption" / "Change to <level>"
  (opens the wizard or the lowering flow).
- When encrypted, below the cards, the switches (§10.2), then:
  - "Ways to unlock" list (recovery key, passkeys, passphrase, trusted devices) with "Add" and per-row Menu
    "Replace" / "Remove".
  - "Encrypting your notes: 1,240 of 1,800" progress row while a migration runs (§10.10).
- Not set up and Standard: a short line under the cards: "You can also mark single folders or notes as
  Always fully encrypted from their menu."

### 10.2 The switches (only at "Encrypted, with the features you pick")

Each row is a `Switch` (Foli AI uses a `Select`), with a one-line description that names what becomes
readable:

| Row | Control | Description |
| --- | --- | --- |
| Foli AI | Select: "Off", "Ask me each time", "Automatically" | "When you use Foli AI, the notes it needs are sent to it in a readable form for that request. Nothing is kept on our servers afterwards." |
| Foli AI in the background | Switch | "Catch me up, related notes, suggestions, routines and search by meaning. To work while you're away, they need a readable copy of your notes on our servers." |
| Search everywhere | Switch | "Keeps a readable copy of titles, note text and text found in files on our servers, so search works instantly on any device. Off: search runs on each device." |
| Apps and integrations | Switch | "Lets connected apps (MCP), the REST API, webhooks and calendar feeds read your notes. Keeps a readable copy on our servers for them." |
| Email to note | Switch | "Mail you send to your Folevi address is readable by our servers while it arrives, then encrypted until one of your devices files it." |
| Web clipper | Switch | "Clips are readable by our servers while they arrive, then encrypted until one of your devices files them." |
| Notification previews | Switch | "Shows note titles and a short excerpt in push notifications, emails and reminders. Off: notifications only say that something happened." |

Turning a switch off: toast "Turned off. Folevi deleted the readable copy." (after the purge job reports
done; until then "Deleting the readable copy…").

Footer under the switches: "Folders and notes marked Always fully encrypted never use these features."

### 10.3 "What each choice means" (Dialog, `rounded-sheet`)

Title: "What each choice means". A table built from §3.2 with columns Standard, Encrypted with the features
you pick, Fully encrypted, and rows in plain words:

- "Your notes, titles, folder and tag names, icons, covers, comments, attachments and history"
- "Search on our servers"
- "Foli AI"
- "Foli AI in the background"
- "Apps and integrations"
- "Email to note and web clipper"
- "Notification previews"

Cells say "Folevi can read it", "Encrypted", "Only if you turn it on", "Off".

Then "What Folevi can always see": "Your name, email and plan. Workspace names, members and roles. Who can
open which note. When notes are created, changed and deleted, how big they are and how they're arranged in
folders. Who is mentioned or commented where. Reminder times and daily note dates. The devices you use."

Then "Things to know":
- "The website's code comes from our servers. If they were taken over, that code could read your notes in
  your browser. The Mac app's built-in interface only runs code that came with the app."
- "Notes are encrypted from the moment you turn this on. Copies made before then can stay in our backups for
  up to <N> days."
- "Your devices keep a readable copy so Folevi works offline."
- "People you share with can copy what they see."
- "If you lose every way to unlock, nobody can read your encrypted notes again. Not even Folevi."

### 10.4 Setup wizard (Dialog, steps)

1. **Before you start.** "Turning on encryption takes a few minutes. Your notes stay usable while Folevi
   encrypts them in the background." Bullets from "Things to know" (the first and last). Button "Continue".
2. **Ways to unlock.** "If this device is lost, you'll need another way to unlock your notes. Pick at least
   two." Options as rows with an "Add" button each, done ones ticked:
   - "Recovery key": "A code to print or save. Works anywhere."
   - "Passkey": "Unlock with Face ID, Touch ID or your security key." (hidden where PRF isn't available, with
     the note from §4.7.2)
   - "Encryption passphrase": "A passphrase only you know. Use a different one from your sign-in password."
   - "Another device": "Approve new devices from one you already use. Counts once you have two."
   Footer: "2 of 2 needed" counter; "Continue" disabled until two kinds exist.
3. **Recovery key** (if chosen): the key in a mono block grouped by four, buttons "Copy", "Download",
   "Print". Text: "Keep this somewhere safe, away from this device. Anyone with it can unlock your notes."
   Then "Type groups 3 and 7 to check you saved it" with two inputs.
4. **Passphrase** (if chosen): two password fields, a strength line ("Too common" / "Fine" / "Strong"),
   text "If you forget it and lose your other ways to unlock, your notes can't be recovered."
5. **Confirm.** "Encrypt my Personal space" with a summary of the choice and switches. Button "Turn on
   encryption".
6. **Done.** "Encryption is on. Folevi is encrypting your existing notes in the background. You can keep
   working." Progress bar.

For a workspace the same wizard opens from Settings > Workspace > Privacy with "Encrypt this workspace", and
step 1 adds "Every member will need to set up encryption to open it. Members without it lose access until
they do."

### 10.5 Unlock screen (in place of locked content)

- Title: "Unlock your encrypted notes"
- Text: "This browser hasn't been set up yet. Choose how to unlock."
- Buttons (primary first): "Approve from another device", "Use a passkey", "Enter passphrase", "Enter
  recovery key".
- After success, a choice between two radio rows: "Trust this browser" ("You won't have to unlock
  again here. You can remove it in Settings > Devices.") and "This is a public or shared computer"
  ("Folevi forgets the key when you close this tab. Changes not yet saved are lost."). Button "Continue".
- Wrong passphrase: "That passphrase didn't unlock your notes. Check it and try again." Rate limit:
  §5.6 text.

### 10.6 Approve-a-device dialog

On the new device: "Waiting for approval" / "Open Folevi on a device you've already unlocked. It will ask
you to approve this one." then, once answered, "Check that your other device shows this code:" and the code
in large type "482 019". Cancel button.

On the trusted device (Dialog over whatever is open, from `e2ee.devices.approvals`): title "Approve a new
device?", text "<Chrome on Windows> wants to unlock your encrypted notes. Only approve it if you're setting
it up now." Code "482 019" and "Do these numbers match the ones on your new device?". Buttons "They match"
and "They don't match". After "They don't match": "Approval cancelled. If you weren't setting up a device,
someone may have your password: change it in Settings > Security."

### 10.7 Settings > Devices (existing section, extended)

Each device row gains a line: "Can unlock encrypted notes" / "Can't unlock encrypted notes" / "Public
session". Row Menu adds "Remove from encryption" (keeps the session) beside "Sign out". Removing asks:
"Remove <device>? It won't be able to unlock your encrypted notes any more." with a `Switch`
row "Also change your encryption key" ("Do this if the device was lost or stolen. Folevi re-encrypts new
notes so it can't read them.") default on when the device was seen more than 14 days ago.

### 10.8 Folder and note menus: Always fully encrypted

`FolderMenu.tsx` and the note menu in `AppContextMenu.tsx` / `PageDock.tsx` gain "Always fully encrypted"
with a check when on. Turning on (Dialog): "Always fully encrypt <name>? Its notes are encrypted on your
devices and never shared in a readable form, even with features you've turned on for this space. Foli AI,
search on our servers and apps can't use them." Button "Encrypt". In a Standard space without encryption set
up, it opens the wizard first ("To encrypt this folder, set up encryption first."). Locked items show a small
lock glyph after their name in the sidebar (Lucide `LockKeyhole`, 12 px, muted).

### 10.9 Foli AI consent ("Ask me each time")

Popover anchored to the Foli AI control, `rounded-panel`: title "Send to Foli AI?", text "Foli AI needs these
notes in a readable form to answer. They're not kept after the answer." List of note titles with character
counts. Buttons "Send" and "Don't send". Small text: "Change this in Settings > Privacy."

### 10.10 Migration progress

Settings > Privacy row and sidebar footer line: "Encrypting your notes: 1,240 of 1,800". Expanded:
"Notes: done. History: 340 of 2,100 versions. Attachments: 12 of 80 (1.2 GB left)." Paused when no device is
working: "Paused. Open Folevi on a device to continue." Errors: "3 notes couldn't be encrypted. Try again"
with a list.

### 10.11 Lowering or turning off

Choosing a lower level opens a Dialog:
- To Standard: title "Turn off encryption?", text "Folevi will decrypt your notes and store them in a
  readable form again. Search, Foli AI and apps will read them like before. This takes a while and runs in the
  background." Then "To confirm, unlock with one of your recovery methods." with the unlock options. Button
  "Turn off encryption" (destructive style).
- Fully encrypted to features you pick: "Turn on feature choices? Nothing changes until you turn a feature
  on." No recovery check (nothing becomes readable).
- Features you pick to Fully encrypted: "Folevi will delete the readable copies your features use." No check.

Publish warning (§9.3): title "Publish a readable copy?", text "Anyone with the link can read the published
copy, and Folevi stores it unencrypted. The note itself stays encrypted. The copy doesn't change when you
edit the note." Button "Publish readable copy".

### 10.12 Feature-unavailable explanations

Shown where the feature's button would be (disabled with a tooltip) or as an inline note, never as a raw
error:

| Feature | Text |
| --- | --- |
| Foli AI off | "Foli AI is off for this space because it's end-to-end encrypted. Turn it on in Settings > Privacy." |
| Foli AI, Fully encrypted | "Foli AI can't read fully encrypted notes." |
| Foli AI agent (v1) | "Foli AI's agent isn't available in encrypted spaces yet. Ask Foli AI about a note instead." |
| Locked note | "This note is always fully encrypted, so Foli AI, apps and server search can't use it." |
| Search, replica downloading | "Still downloading this space (240 of 1,800 notes). Some results may be missing." |
| Connected apps | "Paused: this space is end-to-end encrypted. Turn on Apps and integrations in Settings > Privacy." |
| Email to note | "Email to note is off because this space is end-to-end encrypted." |
| Bookmark previews on the web | "Link previews aren't fetched in encrypted spaces on the web, so Folevi doesn't see the link." |
| Large video | "This video is too large to decrypt in the browser. Download it to watch." |
| Old app | "This note is end-to-end encrypted. Update Folevi to open it." |

### 10.13 Sharing dialogs

`ShareDialog.tsx`: for sealed notes, the link section says "Encrypted link: the key is in the link itself.
Anyone with the whole link can read this note. Folevi can't." and the copy button copies the URL with the
fragment. Inviting a person: "They'll get the key on their devices. If they haven't set up encryption yet,
they'll be asked to." Publish is a separate row: "Publish to the web: makes a readable copy (§10.11)".

`InviteDialog.tsx` for an encrypted workspace: "This workspace is end-to-end encrypted. New members set up
encryption when they join, then an admin's device shares the key with them automatically."

### 10.14 Notifications when previews are off

Bell: titles are filled in on the device (§7.7). Push and email use exactly the generic strings in §7.7.

## 11. Testing

### 11.1 Unit (vitest)

| Suite | Owner | What |
| --- | --- | --- |
| `packages/local-store/test/e2ee-vectors.test.ts` | WP1 | §4.10 vectors on both backends |
| `packages/local-store/test/e2ee-envelope.test.ts` | WP1 | tamper every byte of 0x03/0x04/FLS1 (fails); wrong context fails; truncation of streams; compression bomb refused; property tests (fast-check) round trip |
| `packages/local-store/test/e2ee-keys.test.ts` | WP1 | derivations, wraps for all four methods, recovery key parse and check, SAS commit and code, statements sign/verify, X25519 all-zero refusal |
| `apps/web/test/e2ee/keyring.test.ts` | WP6 | grants opened, version selection, LRU, rotation (old versions still open, new writes use newest) |
| `apps/web/test/e2ee/approval.test.ts` | WP6 | full protocol against a fake server, including a key-substituting server (codes differ) |
| `apps/web/test/e2ee/router.test.ts` | WP7 | resolveSpace rules; pass for Standard (byte-identical args); sealed push round trip; decoders refuse a ciphertext moved to another block |
| `apps/web/test/e2ee/replica.test.ts` | WP7 | pull ingest idempotent; derived fields equal to local mode's for the same rows; overlay of pending engine ops |
| `tests/e2ee/route-coverage.test.ts` | WP7 | every called function has a route |
| `apps/web/test/e2ee/migrate.test.ts` | WP8 | seal and unseal a seeded space against convex-test; resume after a lease expiry; concurrent edit during migration |
| `apps/web/test/e2ee/features.test.ts` | WP8 | mirrors produced and deleted per switch; locked items never mirrored; inbox items applied once |
| `apps/desktop/src/e2ee.test.ts` | WP6 | bridge origin check, keys sealed with a fake cipher, open/sign |

### 11.2 Convex (convex-test, `tests/convex/e2ee-*.test.ts`)

- `e2ee-keys.test.ts` (WP2): account creation, two-method rule, wraps rate limit, device approval states and
  expiry, revoke, reset.
- `e2ee-spaces.test.ts` (WP2): enable/lower/rotate permissions (members can't), switches, key holders.
- `e2ee-sync.test.ts` (WP3): sealed upsert, conflict by MAC, collapse, synced source access, plaintext refused
  in sealed docs and encrypted spaces (`e2ee_required`), `e2ee_busy` throw, blind snapshots, golden sync
  scenarios re-run with sealed blocks (`fixtures/sync-scenarios.json` through a sealing adapter).
- `e2ee-pull.test.ts` (WP3): paging by seq with ties, permission filtering (restricted pages, guests),
  Standard spaces with locks return only sealed rows.
- `e2ee-no-plaintext.test.ts` (WP3 owns, WP4 and WP5 add cases): seeds a space with marker strings
  (`ZQXJ-TITLE-7f3a`, `ZQXJ-BODY-…`, `ZQXJ-FOLDER-…`, `ZQXJ-TAG-…`, `ZQXJ-COMMENT-…`, `ZQXJ-FILE-…`,
  `ZQXJ-VERSION-…`), runs a full seal migration and then every feature flow with all switches off (edit,
  comment, mention, reminder, version, collection, share link, export request, MCP call, email in, AI
  refused), then scans every row of every table (`t.run(ctx => ctx.db.query(table).collect())` over the
  schema's table list) and every `_storage` blob and every scheduled function's args for any marker in
  UTF-8, UTF-16 and base64. Must find none. A second run with each switch on asserts the markers appear only
  in that switch's tables (`e2eeMirrors` purpose, `e2eeInbox` never in plaintext) and disappear after the
  switch is turned off and the purge ran.
- `e2ee-guards.test.ts` (WP4, WP5): for every row of §5.7 marked Device, Skip, Off or Switch, one test that the
  function behaves as listed for a sealed doc.
- `tests/convex/static/invariants.test.ts` (WP2 adds): no `argon2` in convex (already), and no import of
  `@folevi/local-store/e2ee` functions that open (`openRecord`, `openSealed`) in `convex/`: the server may seal
  but never open.

### 11.3 Parity and contract

- `tests/contract/api-snapshot.json` is regenerated (`pnpm contract:update`) by whoever merges last; no WP
  edits it by hand.
- The parity scenarios (`tests/parity/scenarios`) gain a third driver, `E2eeDriver` (WP7): a router client over
  convex-test with an unlocked key session and a replica, so every existing scenario runs against an
  encrypted Personal and must normalize to the same results as Convex and local.

### 11.4 End to end (Playwright, `apps/web/e2e/e2ee-*.spec.ts`, WP9)

| Spec | Flow |
| --- | --- |
| `e2ee-setup.spec.ts` | sign up, Settings > Privacy, wizard with recovery key and passphrase, migration of the seeded notes completes, titles still show, the server copy has no markers (via a dev-only test query `testSupport.e2eeScan`) |
| `e2ee-unlock.spec.ts` | second browser context: unlock with passphrase, trust; reload unlocks silently; public computer mode forgets on a new context |
| `e2ee-approve.spec.ts` | two contexts: request, approve, codes equal, done; "They don't match" cancels |
| `e2ee-recovery.spec.ts` | revoke all devices, unlock with the recovery key; wrong key message; rate limit text |
| `e2ee-link.spec.ts` | encrypted link opens in a signed-out context; link without fragment shows the missing-key text; revoke |
| `e2ee-workspace.spec.ts` | encrypted workspace, invite a new person, pending until an admin context is open, then the invitee reads; remove the member, rotation progress, the removed context can't open |
| `e2ee-migration.spec.ts` | turn on, edit during migration, turn off with recovery check, notes searchable on the server again |
| `e2ee-switches.spec.ts` | each switch: Foli AI ask consent dialog and refusal; search everywhere results before the replica finishes; apps (MCP read, write queued then applied); email to note arrives; notification text with and without previews |
| `e2ee-lock.spec.ts` | Standard space, lock a folder, its notes sealed, server search can't find them, device search can |
| `e2ee-a11y.spec.ts` | axe on every new screen, light and dark |

Run as documented: `E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1`.

### 11.5 Mac checks (WP6, documented in `docs/DESKTOP.md`)

`apps/desktop` unit tests; `apps/web/e2e/desktop-app.spec.ts` gains "unlock with the device key after
restart" and "bundled interface opens an encrypted space offline". After the build: rebuild, install to
/Applications, unlock, quit, reopen (no prompt), revoke from the web, the Mac asks to unlock.

## 12. Work packages

Rules for everyone:
- One owner per file. Shared files listed here have one owner; others ask that owner (a note in the PR) or
  use the extension points described.
- `convex/schema.ts`, `convex/lib/scope.ts`, `convex/crons.ts`, `convex/lib/e2ee/state.ts` and
  `convex/lib/e2ee/validators.ts` belong to WP2, which writes the whole of §5.1, §5.2 and the validators in
  its first commit (within its first working session) so the others build against them.
- `convex/_generated/*` is regenerated (`npx convex codegen`), never edited; conflicts are resolved by
  regenerating.
- `tests/contract/api-snapshot.json`: regenerated at merge time only.
- Every package starts immediately against the signatures in this document; where it needs another package's
  function before it exists, it uses a stub with the same signature in its own test helpers.
- Commits stay local until the owner says to push (memory rule "No deploy until told").

### WP1: Crypto core and shared wire types

- Goal: §4 as a library with vectors.
- Owns: `packages/local-store/src/crypto/e2ee/*` (`primitives.ts`, `contexts.ts`, `record.ts`,
  `keyedStream.ts`, `seal.ts`, `statements.ts`, `keys.ts`, `recovery.ts`, `sas.ts`, `wire.ts`, `index.ts`),
  `packages/local-store/package.json` (exports `"./e2ee"`, dependencies), root `package.json` (adds
  `@folevi/local-store`), `pnpm-lock.yaml`, `packages/local-store/fixtures/e2ee-vectors.json`,
  `packages/local-store/test/e2ee-*.test.ts`, `packages/local-store/README.md` (format section).
- Exposes:

```ts
export type AeadKey = CryptoKey | Uint8Array;               // CryptoKey on WebCrypto, bytes on noble
export interface X25519KeyPair { privateKey: CryptoKey | Uint8Array; publicKey: Uint8Array }
export interface Ed25519KeyPair { privateKey: CryptoKey | Uint8Array; publicKey: Uint8Array }
export function cryptoBackend(): Promise<{ x25519: "webcrypto" | "noble"; ed25519: "webcrypto" | "noble"; aes: "webcrypto" | "noble" }>;
export function forceBackend(b: "webcrypto" | "noble" | null): void;   // tests
export function randomBytes(n: number): Uint8Array;
export function hkdf(ikm: Uint8Array | CryptoKey, info: string, bytes?: number): Promise<Uint8Array>;
export function importAead(raw: Uint8Array): Promise<AeadKey>;          // non-extractable; zeroes `raw`
export function macOf(key: Uint8Array | CryptoKey, context: string, plaintext: Uint8Array): Promise<string>;
export const ctx: { amkDevice(p: string, d: string): string; /* … one builder per row of §4.5 */ block(doc: string, block: string): string };
export function sealRecord(key: AeadKey, keyVersion: number, context: string, plaintext: Uint8Array, o?: { nonce?: Uint8Array; compress?: boolean }): Promise<Uint8Array>;
export function openRecord(key: AeadKey | ((keyVersion: number) => Promise<AeadKey>), context: string, envelope: Uint8Array): Promise<Uint8Array>;
export function recordKeyVersion(envelope: Uint8Array): number;
export function sealFileStream(fileKey: AeadKey, context: string, plaintext: Uint8Array, o?: { chunkSize?: number; noncePrefix?: Uint8Array }): Promise<Uint8Array>;
export function openFileStream(fileKey: AeadKey, context: string, envelope: Uint8Array): Promise<Uint8Array>;
export function openFileStreamRange(fileKey: AeadKey, context: string, envelope: Uint8Array, start: number, end: number): Promise<Uint8Array>;
export function generateX25519(o?: { extractable?: boolean }): Promise<X25519KeyPair>;
export function generateEd25519(o?: { extractable?: boolean }): Promise<Ed25519KeyPair>;
export function x25519FromSeed(seed: Uint8Array): Promise<X25519KeyPair>;
export function ed25519FromSeed(seed: Uint8Array): Promise<Ed25519KeyPair>;
export function sealTo(recipientPub: Uint8Array, context: string, plaintext: Uint8Array, o?: { ephemeral?: X25519KeyPair; nonce?: Uint8Array }): Promise<Uint8Array>;
export function openSealed(recipient: X25519KeyPair["privateKey"], recipientPub: Uint8Array, context: string, box: Uint8Array): Promise<Uint8Array>;
export function signStatement(key: Ed25519KeyPair["privateKey"], kind: StatementKind, body: object): Promise<SignedStatement>;
export function verifyStatement(pub: Uint8Array, s: SignedStatement): Promise<boolean>;
export interface AccountKeys { x25519: X25519KeyPair; ed25519: Ed25519KeyPair; records: AeadKey; check: Uint8Array }
export function deriveAccountKeys(amk: Uint8Array): Promise<AccountKeys>;
export interface SpaceKeys { wrap: AeadKey; meta: AeadKey; mac: CryptoKey | Uint8Array; inbox: X25519KeyPair; check: Uint8Array }
export function deriveSpaceKeys(sk: Uint8Array): Promise<SpaceKeys>;
export interface NoteKeys { content: AeadKey; mac: CryptoKey | Uint8Array; files: AeadKey }
export function deriveNoteKeys(nk: Uint8Array): Promise<NoteKeys>;
export function newRecoveryKey(): { bytes: Uint8Array; text: string };
export function parseRecoveryKey(text: string): Uint8Array | null;     // null on a bad check value
export function recoveryWrapKey(bytes: Uint8Array): Promise<AeadKey>;
export const ARGON2ID_DEFAULTS: { m: 65536; t: 3; p: 1 };
export function passphraseWrapKey(passphrase: string, kdf: { name: "argon2id"; m: number; t: number; p: number; salt: Uint8Array }, onProgress?: (f: number) => void): Promise<AeadKey>;
export function prfWrapKey(prfOutput: Uint8Array): Promise<AeadKey>;
export function linkWrapKey(secret: Uint8Array): Promise<AeadKey>;
export function approvalCommit(nonce: Uint8Array, x25519Pub: Uint8Array, ed25519Pub: Uint8Array): Promise<Uint8Array>;
export function approvalCode(i: { newX: Uint8Array; newEd: Uint8Array; approverEd: Uint8Array; accountX: Uint8Array; accountEd: Uint8Array; approverNonce: Uint8Array; newNonce: Uint8Array }): Promise<string>;  // "482019"
export function memberSecurityCode(ed25519Pub: Uint8Array): Promise<string>;
export * from "./wire";   // §4.6 types and canonical (de)serializers: blockPlaintext(block), blockFromPlaintext(bytes, shell)
```

- Depends on: nothing. Starts first; publishes `index.ts` with these signatures (throwing stubs) in its first
  commit so others compile.
- Accept: all vectors reproduce on both backends in Node 22 and in the browser test runner; envelope fuzz
  tests; `pnpm --filter @folevi/local-store test typecheck lint` green; existing `crypto-vectors.json` tests
  unchanged.

### WP2: Server foundation (schema, keys, devices, spaces, grants)

- Goal: §5.1, §5.2, the guard helpers, and every key-management function in §5.3.
- Owns: `convex/schema.ts`, `convex/lib/scope.ts`, `convex/crons.ts`, `convex/lib/e2ee/state.ts`,
  `convex/lib/e2ee/validators.ts`, `convex/e2ee/keys.ts`, `convex/e2ee/devices.ts`, `convex/e2ee/spaces.ts`,
  `convex/e2ee/grants.ts`, `tests/convex/e2ee-keys.test.ts`, `tests/convex/e2ee-spaces.test.ts`,
  `tests/convex/e2ee-wire.test.ts`, additions to `tests/convex/static/invariants.test.ts`, additions to
  `tests/convex/helpers.ts` (an `e2eePerson()` helper that creates account keys with WP1).
- Exposes: the Convex functions in §5.3 for these modules; `spaceE2ee`, `isSealed`, `isSealedBlock`,
  `isLocked`, `requirePlainWrite`, `requirePlainWriteInScope`, `readableFor` (reads mirrors; Standard path
  delegates to a function WP3 provides in `lib/e2ee/plainText.ts`, stubbed until then), `switchesOf`.
- Depends on: WP1 types (validators mirror `wire.ts`). Can start at once.
- Accept: convex tests above; `npx convex dev` deploys the schema on a copy of production data with no
  errors (WP2 checks against a fresh export); `backend-performance.test.ts` unchanged within noise.

### WP3: Server sealed content (sync, documents, files, pull, migration)

- Goal: sealed writes and reads for documents, blocks, folders, tags, records, comments' storage, files,
  snapshots; pull; migration endpoints; purge.
- Owns: `convex/lib/syncEngine.ts`, `convex/sync.ts`, `convex/documents.ts`, `convex/blocks.ts`,
  `convex/organization.ts`, `convex/files.ts`, `convex/fileText.ts`, `convex/changes.ts`, `convex/synced.ts`,
  `convex/copies.ts`, `convex/lib/documents.ts`, `convex/lib/editSettle.ts`, `convex/lib/create.ts`,
  `convex/lib/linkLabels.ts`, `convex/lib/synced.ts`, `convex/lib/fileCopies.ts`, `convex/lib/e2ee/purge.ts`,
  `convex/lib/e2ee/plainText.ts`, `convex/e2ee/content.ts` (including `setFolderLocked`,
  `setDocumentLocked`), `convex/e2ee/pull.ts`, `convex/e2ee/files.ts` (including `updateMeta`, `rewrap`),
  `convex/e2ee/migrate.ts`, `tests/convex/e2ee-sync.test.ts`, `tests/convex/e2ee-pull.test.ts`,
  `tests/convex/e2ee-no-plaintext.test.ts`, `tests/convex/e2ee-migrate.test.ts`.
- Exposes: §5.3 content/pull/files/migrate functions; the `SyncOp` acceptance in §5.4; `purgeDerivedPlaintext`.
- Depends on: WP2's schema commit and `state.ts`. Uses WP1 only in tests (sealing fixtures).
- Accept: convex tests above, including the golden sync scenarios over sealed blocks and the no-plaintext
  scan for these flows; all existing convex tests green (Standard unchanged).

### WP4: Server guards for the remaining core modules

- Goal: the §5.7 rows for search, collections, comments, sharing, tasks, study, exports, imports, maintenance,
  migrations, migration, users, workspaces, notifications, calendarFeeds, bookmarks, charts, proposals,
  testSupport.
- Owns: `convex/search.ts`, `convex/collections.ts`, `convex/lib/collections.ts`, `convex/charts.ts`,
  `convex/comments.ts`, `convex/sharing.ts`, `convex/tasks.ts`, `convex/study.ts`, `convex/lib/study.ts`,
  `convex/exports.ts`, `convex/imports.ts`, `convex/maintenance.ts`, `convex/migrations.ts`,
  `convex/migration.ts`, `convex/users.ts`, `convex/seed.ts`, `convex/workspaces.ts`,
  `convex/notifications.ts`, `convex/calendarFeeds.ts`, `convex/bookmarks.ts`, `convex/proposals.ts`,
  `convex/testSupport.ts` (adds `e2eeScan` for e2e, dev only), `tests/convex/e2ee-guards-core.test.ts`.
- Exposes: `sharing.createPublicLink` accepting `e2ee` and `plainCopy`; `sharing.openPublicLink` returning
  sealed payloads; `workspaces.acceptInvite`/`removeMember` hooks writing `e2eePendingGrants`;
  `testSupport.e2eeScan({ markers })` (dev only, refuses in production).
- Depends on: WP2 (helpers), WP3 (`plainText.ts`, purge) for some cases; can start at once on guards.
- Accept: `e2ee-guards-core.test.ts` covers every row it owns; existing tests green.

### WP5: Server AI, integrations, inbound mail, notifications, links

- Goal: the §5.7 AI/integration rows, §7.2 to §7.7 server parts, `e2ee/mirrors.ts`, `e2ee/inbox.ts`,
  `e2ee/reminders.ts`, `e2ee/links.ts`.
- Owns: `convex/ai.ts`, `convex/aiActions.ts`, `convex/aiAgent.ts`, `convex/aiAttachments.ts`,
  `convex/aiChat.ts`, `convex/aiDigest.ts`, `convex/aiGraph.ts`, `convex/aiIndex.ts`, `convex/aiMemory.ts`,
  `convex/aiResearch.ts`, `convex/aiSharing.ts`, `convex/aiStudy.ts`, `convex/aiSuggestions.ts`,
  `convex/aiTodos.ts`, `convex/aiWriting.ts`, `convex/chartAi.ts`, `convex/flowchartAi.ts`,
  `convex/mindmapAi.ts`, `convex/stickiesAi.ts`, `convex/tableAi.ts`, `convex/wireframeAi.ts`,
  `convex/routines.ts`, `convex/digest.ts`, `convex/emailNotes.ts`, `convex/lib/emailNotes.ts`,
  `convex/webhooks.ts`, `convex/lib/webhooks.ts`, `convex/mcp.ts`, `convex/mcpServer.ts`,
  `convex/restApi.ts`, `convex/restApiServer.ts`, `convex/lib/ai/*`, `convex/lib/notify.ts`, `convex/push.ts`,
  `convex/pushSend.ts`, `convex/apnsSend.ts`, `convex/http.ts`, `convex/lib/e2ee/ai.ts`,
  `convex/lib/e2ee/inboxSeal.ts`, `convex/e2ee/mirrors.ts`, `convex/e2ee/inbox.ts`, `convex/e2ee/reminders.ts`,
  `convex/e2ee/links.ts`, `tests/convex/e2ee-guards-ai.test.ts`, `tests/convex/e2ee-features.test.ts`.
- Exposes:

```ts
// e2ee/mirrors.ts
put: mutation({ scope, purpose, documentId, title, text, folderPath?, tags?, tasks?, contentHash });   // refused if the switch is off or the doc locked
remove: mutation({ purpose, documentId });
hashes: query({ scope, purpose });            // { documentId, contentHash }[] so devices upload only changes
purge: internalMutation({ scope, purpose });  // scheduled by spaces.setSwitches (WP2 calls it by name)
// e2ee/inbox.ts
waiting: query({ scope }); open: query({ inboxId }) /* sealed bytes */; markApplied: mutation({ inboxId, createdDocumentId? }); markFailed: mutation({ inboxId, reason });
// e2ee/reminders.ts
put: mutation({ documentId, blockId, profileId, remindAt, preview? }); remove: mutation({ documentId, blockId }); process: internalMutation({});
// e2ee/links.ts
publishCopy: mutation({ documentId, linkId?, copy: PlainCopyInput }); unpublish: mutation({ linkId });
// every AI entry point listed in §5.7 accepts `provided?: ProvidedContext` (§7.2)
```

- Depends on: WP2 (state, switches, schema). Independent of WP3 except `purge` of AI rows (WP5 owns those
  deletions inside `mirrors.purge`).
- Accept: guards tests for every owned §5.7 row; email-to-note and MCP writes end up sealed; no-plaintext scan
  cases added to WP3's suite through an exported `noPlaintextCases` list in `tests/convex/e2ee-features.test.ts`.

### WP6: Client keys, unlock, devices, Mac bridge

- Goal: §4.7, §4.8, §6.2, §6.3, §6.10 (key side), §6.11.
- Owns: `apps/web/src/lib/e2ee/keys/*`, `apps/desktop/src/e2ee.ts`, `apps/desktop/src/e2ee.test.ts`,
  `apps/desktop/src/preload.ts`, `apps/desktop/src/main.ts`, `apps/web/src/lib/shell/types.ts`,
  `apps/web/test/e2ee/keyring.test.ts`, `apps/web/test/e2ee/approval.test.ts`, `docs/DESKTOP.md` (E2EE
  section).
- Exposes:

```ts
export type LockState = "none" /* no E2EE on this account */ | "locked" | "unlocking" | "unlocked";
export interface KeySession {
  state(): LockState; subscribe(cb: () => void): () => void;
  unlockWithDevice(): Promise<boolean>;
  unlockWithPassphrase(p: string): Promise<"ok" | "wrong" | "rate_limited">;
  unlockWithRecoveryKey(text: string): Promise<"ok" | "wrong" | "bad_format" | "rate_limited">;
  unlockWithPasskey(): Promise<"ok" | "cancelled" | "unsupported">;
  requestApproval(): Promise<ApprovalHandle>;       // { code: Promise<string>; done: Promise<boolean>; cancel(): void }
  trust(mode: "browser" | "public"): Promise<void>;
  lock(): void;
  accountKeys(): AccountKeys;                       // throws when locked
  deviceId(): string;
}
export interface KeyRing {
  spaceKeys(scope: WireScope, version?: number): Promise<SpaceKeys & { version: number }>;
  noteKeys(documentId: string, version?: number): Promise<NoteKeys & { version: number }>;
  newNoteKey(documentId: string, scope: WireScope): Promise<{ keys: NoteKeys; version: number; wrapped: Uint8Array; spaceVersion: number }>;
  addNoteKeys(rows: PulledNoteKey[]): Promise<void>;   // from pull or myNoteKeys
  linkNoteKey(documentId: string, secret: Uint8Array, wrapped: Uint8Array, version: number): Promise<void>;
}
export function getKeySession(): KeySession; export function getKeyRing(): KeyRing;
export const setup: { createAccount(): Promise<void>; addRecoveryKey(): Promise<{ text: string; confirm(groups: [string, string]): Promise<boolean> }>;
  addPassphrase(p: string): Promise<void>; addPasskey(label: string): Promise<"ok" | "unsupported" | "cancelled">;
  removeMethod(publicId: string): Promise<void>; rotateAccount(): Promise<void>; resetAccount(): Promise<void>;
  setUpSpace(scope: WireScope): Promise<void>; rotateSpace(scope: WireScope, onProgress: (n: number, of: number) => void): Promise<void>;
  completePendingGrants(scope: WireScope): Promise<number>; grantNote(documentId: string, profileId: string): Promise<void> };
export function useKeySession(): { state: LockState; methods: MethodSummary[] }; export function useApprovals(): IncomingApproval[];
```

- Depends on: WP1, WP2's functions (stubbed in tests until merged).
- Accept: unit tests; unlock paths work in Chromium, WebKit and Firefox Playwright projects against a dev
  backend; Mac unit tests; the Mac build unlocks with the device key after restart.

### WP7: Client router, transport, replica, composers, files

- Goal: §6.4 to §6.8 and §6.10 (data side).
- Owns: `apps/web/src/lib/e2ee/seal.ts`, `router/*`, `compose/*`, `replica/*`, `files.ts`,
  `apps/web/src/lib/convex/provider.tsx`, `apps/web/src/lib/sync/uploads.ts`, `apps/web/src/lib/sync/db.ts`
  (memory option only), `tests/e2ee/route-coverage.test.ts`, `tests/parity/drivers/e2ee.ts` (new driver),
  `apps/web/test/e2ee/router.test.ts`, `apps/web/test/e2ee/replica.test.ts`, and any edit to
  `apps/web/src/lib/local/*` the replica needs (per-person stars and authors in workspaces, a read-only
  store mode); such edits must keep local mode's parity scenarios green.
- Exposes:

```ts
export class E2eeRouterClient { /* §6.4 */ }
export const E2EE_ROUTES: Record<string, Route>;
export interface ReplicaHub { open(scope: WireScope): Promise<SpaceReplica>; get(scope: WireScope): SpaceReplica | null; status(scope: WireScope): ReplicaStatus; }
export interface SpaceReplica { backend: LocalExecutor; status(): ReplicaStatus; whenSynced(): Promise<void>; applyAccepted(results: OpResult[]): void; close(): Promise<void>; }
export type ReplicaStatus = { state: "opening" | "downloading" | "ready" | "locked"; have: number; total: number | null };
export function useE2eeSpaceStatus(scope: WireScope): ReplicaStatus & { level: Level; switches: Switches; locked: boolean };
export function isSealedDocument(documentId: string): boolean;
export function sealBlock(documentId: string, block: WireBlock): Promise<SealedWireBlock>;
export function openBlock(documentId: string, block: SealedWireBlock): Promise<WireBlock>;
export function uploadSealed(p: PendingUpload): Promise<{ fileId: string }>;
export function decryptedFileUrl(fileId: string, documentId: string): Promise<string>;
```

- Depends on: WP1, WP6 (`KeyRing`, `KeySession`), WP2/WP3 function signatures (stubbed with a fake server in
  tests until merged).
- Accept: route coverage green; parity scenarios pass on the `E2eeDriver`; Standard users get the raw
  `ConvexReactClient` (a test asserts `provider.tsx` doesn't wrap without E2EE); a 1,000-note space ingests
  in under 20 s in Chromium on an M1 (benchmark test, skipped in CI).

### WP8: Client migration, feature switches, AI per request, links

- Goal: §6.9, §7 client side, §8.2 to §8.4 grant completion, §9.
- Owns: `apps/web/src/lib/e2ee/migrate/*`, `features/*` (mirror, inbox, reminders, ai, notifyPreview,
  grants), `links.ts`, `apps/web/src/app/s/[token]/page.tsx`, `apps/web/src/app/s/[token]/EncryptedShare.tsx`,
  `apps/web/src/app/s/[token]/data/route.ts` (if the page needs a client fetch route),
  `apps/web/test/e2ee/migrate.test.ts`, `apps/web/test/e2ee/features.test.ts`.
- Exposes:

```ts
export function startMigrationRunner(): () => void;            // started by ProductApp when unlocked
export function useMigrationProgress(scope: WireScope): MigrationProgress | null;
export function startFeatureWorkers(): () => void;              // mirrors, inbox, reminders, grants
export const aiRoute: AiRouter;                                 // used by E2EE_ROUTES "ai" entries (WP7 imports it)
export function useAiConsent(): { pending: ConsentRequest | null; answer(ok: boolean, rememberForNote?: boolean): void };
export function createEncryptedLink(documentId: string, opts: LinkOptions): Promise<{ url: string }>;
export function publishPlainCopy(documentId: string): Promise<{ url: string }>;
```

- Depends on: WP7 (router, replica, seal), WP6, WP3 and WP5 server functions.
- Accept: unit tests; migration resumes after a killed tab; turning each switch off leaves no mirror rows
  within one minute; encrypted link opens in a signed-out browser.

### WP9: Screens, copy and end-to-end tests

- Goal: §10 and §11.4.
- Owns: `apps/web/src/lib/e2ee/copy.ts`, `apps/web/src/components/e2ee/*` (`SetupWizard.tsx`,
  `UnlockScreen.tsx`, `ApproveDeviceDialog.tsx`, `RecoveryKeyPanel.tsx`, `PrintRecoveryKey.tsx`,
  `WhatEachChoiceMeans.tsx`, `ConsentPopover.tsx`, `MigrationProgress.tsx`, `LockDialog.tsx`,
  `LowerLevelDialog.tsx`, `PublishCopyDialog.tsx`, `UnavailableNote.tsx`, `LockGlyph.tsx`),
  `apps/web/src/components/views/settings/PrivacySection.tsx`,
  `apps/web/src/components/views/settings/WorkspacePrivacySection.tsx`, edits to `SettingsView.tsx`,
  `DevicesSection.tsx`, `MembersSection.tsx`, `components/doc/ShareDialog.tsx`,
  `components/app/InviteDialog.tsx`, `components/app/FolderMenu.tsx`, `components/app/AppContextMenu.tsx`,
  `components/doc/PageDock.tsx`, `components/app/Sidebar.tsx` (lock glyph, footer progress),
  `components/app/AccountGate.tsx` (unlock gate), `components/app/ProductApp.tsx` (starts WP8's workers),
  `apps/web/e2e/e2ee-*.spec.ts`, `apps/web/src/i18n` source strings for these.
- Depends on: hooks from WP6 (`useKeySession`, `useApprovals`, `setup`), WP7 (`useE2eeSpaceStatus`), WP8
  (`useMigrationProgress`, `useAiConsent`, links). Builds screens immediately against stubbed hooks
  (`components/e2ee/__stubs__.ts`, deleted at integration).
- Accept: e2e specs green; axe clean; copy review against §10 and the no-em-dash rule (searching owned files for the
  em dash character U+2014 finds nothing); screenshots of each screen in light and dark (`node apps/web/e2e/visual.mjs`).

### Order

```
WP1 ──┬─> WP2 ──┬─> WP3 ──┐
      │         ├─> WP4 ──┤
      │         └─> WP5 ──┤
      ├─> WP6 ────────────┼─> WP7 ──> WP8 ──> integration
      └───────────────────┴──────────────> WP9 (screens from day one on stubs; e2e at integration)
```

All nine start on day one: WP1 publishes stubs first; WP2 lands the schema and validators first; the rest code
against the signatures here. Integration order: WP1, WP2, WP3, WP4 and WP5 (server), WP6, WP7, WP8, WP9.

## 13. Risks and the independent security review

### 13.1 Risks

| Id | Risk | Mitigation |
| --- | --- | --- |
| R1 | A server derivation path forgets the sealed check and writes plaintext somewhere. | The no-plaintext scan (§11.2) runs every flow and scans every table, blob and scheduled job. |
| R2 | Version skew: an old client writes plaintext into an encrypted space. | `e2ee_required` on every plaintext write path (§5.4, §5.6); `minShellVersion`. |
| R3 | Restricted pages in an encrypted workspace are protected by the server, not by keys (members hold the space key). | Documented limit. Follow-up: wrap restricted pages' note keys to their readers only instead of the space key. |
| R4 | Rollback: the server serves an older ciphertext of a block. | Not detected in v1. Follow-up: per-note signed heads (HLC per block, signed by the writer's device). |
| R5 | Members can forge content as other members (shared keys); authorship is the server's word. | Documented; follow-up: per-edit device signatures. |
| R6 | Web code served by us (§3.3). | Bundled interface on the Mac; future: subresource integrity manifest signed offline. |
| R7 | Replica download of large spaces is slow on new devices. | Search everywhere fallback; progress; persistent replica on trusted devices. |
| R8 | Migration of large spaces stalls (devices close). | Resumable leases, progress UI, "Paused" state, per-document atomic finish. |
| R9 | Argon2id in pure JS is slower than native, which helps attackers comparatively. | Unaudited noble argon2 (README says so); server rate limit on wrap fetches; passphrase rules; review item. |
| R10 | Raw key bytes in JS memory. | Immediate import as non-extractable and zeroing; no persistence of raw keys on the web. |
| R11 | Collections move from server tables to records: two implementations in one space during migration. | Per-document atomic switch in `finishDocument`; unseal recreates tables. |
| R12 | Large media can't be streamed from ciphertext in the browser in v1. | 500 MB whole-file limit with download fallback; service-worker range decryption later. |
| R13 | Passkey PRF availability varies and is absent in the Mac app. | Offered only when PRF works; two-method rule ensures another method exists. |
| R14 | The comparison code in approval is skipped by habit. | Code shown large on both sides with explicit "They match"; three mismatches lock approvals for an hour. |
| R15 | AI chat titles stored before encryption keep note titles (`aiConversations`). | The seal migration's cleanup phase moves chats to records and deletes the server rows. |

### 13.2 Checklist for an independent review

1. Envelope formats: nonce uniqueness (random 96-bit per seal; estimate of seals per key), AAD covers the
   header and context everywhere, stream truncation and reordering, compression before encryption.
2. FLS1: HKDF inputs (salt E ‖ R, context in info), all-zero shared secret check, small-order points,
   comparison with HPKE base mode.
3. Key derivation separation: every info string distinct; no key used with two algorithms.
4. Recovery key entropy (160 bits) and encoding; passphrase Argon2id parameters and the noble implementation;
   PRF salt handling; server-side rate limit on `getWrap`.
5. Device approval: commit-reveal ordering, SAS length and binding (account keys, both devices' keys,
   nonces), behaviour on cancel and expiry, phishing (approving a stranger's request).
6. Trust of public keys: account key statements, space grant statements, member security codes, what a
   malicious server can do with key substitution in invites and page shares.
7. Rotation: what a removed member can still read, ordering of revoke and re-grant, retired key handling,
   history re-sealing.
8. Links: fragment handling (no logging, no Referer leak: `Referrer-Policy: no-referrer` already set), revoke
   and rotation, password links.
9. Server guards: every §5.7 row; the no-plaintext test's coverage of tables and the scheduler.
10. Client storage: IndexedDB contents on trusted and public sessions; outbox plaintext; service worker
    caches; crash dumps and logs (no content in logs, as SECURITY.md requires).
11. Mac bridge: origin checks, which page can call `open`, Touch ID gating, safeStorage availability failure
    paths.
12. Feature switches: mirrors contain only what the copy says; purge completeness (including AI rows built
    from mirrors); locked items never mirrored; AI `provided` context not persisted (streams, scheduler args).
13. Metadata leaks beyond §3.2 (block counts, MAC equality, mention ids, `fileIds`, timing of mirror updates).
14. Migration: no window where plaintext and ciphertext of the same content are both served to someone who
    shouldn't see one of them; backups statement.

## 14. Decisions this design made that need the owner's eye

| # | Topic | What the plan said | What this design does, and why |
| --- | --- | --- | --- |
| Q1 | Switch grouping | "Email-to-note, web clipper and notification previews" listed together | Three separate switches (inbound mail, clips and outbound previews have different effects), shown as one group in Settings. One click to merge them if preferred. |
| Q2 | Passkey on the Mac | passkey is a recovery method everywhere | Electron has no dependable WebAuthn PRF and `app://folevi` can't use app.folevi.com passkeys, so the Mac app offers device approval, passphrase and recovery key; passkeys are set up and used on the website. |
| Q3 | Block revision in the AAD | "the note, block and revision bound in" | The server assigns revisions after the device encrypts, so the AAD binds space (through the note key), note and block; revision is protected by the server's revision rules. Rollback detection is a follow-up (R4). |
| Q4 | Backups | not mentioned | The copy says "Copies made before then can stay in our backups for up to <N> days". The owner needs to confirm N from Convex's backup retention (docs/DEPLOYMENT.md). |
| Q5 | Foli AI's agent | Foli AI has ask/automatic modes | The agent reads and edits many notes through server tools; v1 keeps it off in encrypted spaces with an explanation. Ask, write, chat, research and the editor AI tools work with per-request context. |
| Q6 | Link previews (bookmarks) | not mentioned | The server fetching a bookmark's URL reveals the link. On the Mac the device fetches it; on the web encrypted spaces show the link without a preview. |
| Q7 | Fully encrypted and on-device AI | "no exceptions" | Foli AI is off at Fully encrypted, including the person's own key from the device. Allowing own-key AI from the device (never through Folevi) is possible later. |
| Q8 | Restricted pages | not mentioned | Protected by server permissions, not separate keys (R3). |
| Q9 | Locks in Standard spaces | "any folder or note, whatever the level" | Supported. Locked notes in a Standard space get device search, tasks and previews merged into the server's lists; sort-by-title places them correctly only within each loaded page of results. |
| Q10 | Daily note dates, reminder times, mentions | "server sees only sizes, dates and structure" | Daily note dates, reminder times and who is mentioned stay visible (dates and structure); listed in §3.2. |
