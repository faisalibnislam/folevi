# Local mode plan (2026-10-20)

## Owner decisions

- First launch in the Mac, iPhone and iPad apps offers "Keep notes on my devices" (subline "Free forever. No account.") or "Sign in to Folevi". The website stays sign-in only.
- Storage is a folder of files, one per note plus a small index. Sync: "Sync with iCloud" (one tap), "Choose a folder" (Dropbox, Google Drive, OneDrive or any folder; the Files app on iOS) or "This device only". Changeable in Settings. One library per device.
- Foli AI in local mode: Apple's on-device models, plus an optional own OpenAI, Anthropic or Google key called straight from the device.
- Switching works both ways: sign in and upload, or export an account into a local library.
- Server-only features are hidden behind one "Sign in to Folevi to share and collaborate" note. On iPhone and iPad, local mode never shows prices or upgrades.
- The apps ship the interface built in for everyone, so both modes start offline; updates come with app updates.
- Edits on two devices merge per block; the same block changed on both: the newer wins, the other is kept in version history with a "Changed on another device" notice.
- Optional Face ID or Touch ID lock, and optional passphrase-encrypted sync folder (unrecoverable if the passphrase is lost).

# "Keep notes on my devices": architecture and build plan

## 0. Facts from the code that shape the design

- **The client already has one network seam.** In 146 files, every server call goes through `convex/react` (`useQuery` 98, `useMutation` 81, `useAction` 21, `useConvex()` 15, `usePaginatedQuery` 2, `useQueries` 1, `useConvexConnectionState` 1). In convex 1.46 those hooks only call these methods on the client object from `ConvexProvider`: `watchQuery(ref, args, opts)` (which returns `{onUpdate, localQueryResult, journal}`), `mutation`, `action`, `query`, `connectionState` and `subscribeToConnectionState` (see `node_modules/convex/dist/esm/react/client.js`, `use_queries.js`, `queries_observer.js`). Pagination is plain `watchQuery` with `paginationOpts` in the args. A duck-typed client can therefore stand in for Convex without touching those 146 files.
- **The sync engine and outbox talk to the server through one call each.** The engine uses `this.client.mutation(api.sync.push, …)` (engine.ts:748). The outbox uses `client.mutation(OUTBOX_MUTATIONS[name].ref, args)` (outbox.ts:145). Uploads use `files.generateUploadUrl`, then `fetch`, then `files.finalize` (uploads.ts).
- **The product is already a client SPA.** `(app)/[...path]/page.tsx` only checks the session cookie and renders `<ProductApp/>`. Routing is `lib/app/router.tsx` (`usePathname` plus `pushState`). Product components never import `next/link` or `next/image`; only admin and marketing do. `next/font/google` is self-hosted at build time.
- **Much of the domain logic is already pure and shared** in `packages/editor-schema`: the sync reducer, `tree`, `rank`, `markdown`/`html`, `search` (`documentSearchText`, `highlightRanges`, `searchSnippet`), `tasks` (`projectTask`, `taskViews`), `recurrence`, `tableFormulas`, `collectionFormulas`, `synced`, `fileText`, and every data-block parser. Server helpers that are pure but sit in `convex/lib` are `buildPreview`, `sanitizeTitle`, `newDocumentRank` (lib/documents.ts), `specsToWireBlocks` and `cloneBlocks` (lib/create.ts), `BUILT_IN_TEMPLATES` (lib/templates.ts), `seedContent.ts`, and all the AI prompt builders (`lib/mindmapAi.ts`, `stickiesAi.ts`, `tableAi.ts`, `chartAi.ts`, `wireframeAi.ts`, `flowchartAi.ts`, `lib/ai/writing.ts`). Those import only `@folevi/editor-schema`.
- **Native sign-in pieces already exist.** `convex/lib/nativeAuth.ts` has `/native/authorize`, `/native/token` (which returns a bearer session token) and `/native/redeem`. The `bearer()` plugin is enabled in `convex/auth.ts`, and `/connect` exists. `NATIVE_CLIENTS` lists `folevi-mac` (`com.folevi.mac://auth/callback`) and `folevi-app` (`folevi://auth/google`).
- **The client uses 340 distinct non-admin Convex functions.** About 120 must be ported for local mode; the rest are hidden or replaced (§2.4).

---

## 1. Building and bundling the web app into Electron and Capacitor

### Decision: a static export of the product shell, served from a privileged custom scheme

Rejected options:
- **A bundled local server** (`next start` inside Electron). It can't run on iOS because there is no Node, so it would give two different architectures.
- **Loading remote plus offline caching** (today's setup). It contradicts "local mode never contacts Folevi". It is also an App Review 2.5.2 and 4.2 liability once the app must work without an account.
- **Vite.** It works, but needs shims for `next/navigation` and `next/font`, plus a second CSS and Tailwind pipeline.

**Build target:** the same `apps/web` project with a second build mode, `FOLEVI_BUILD=shell`, in `apps/web/next.config.ts`:
- `output: "export"`, `distDir: "out-shell"`, `images: { unoptimized: true }`.
- `pageExtensions: ["shell.tsx", "shell.ts"]`. This makes Next ignore every existing `page.tsx`, `layout.tsx`, `route.ts`, `proxy.ts` and metadata file: admin, marketing, `/api/*`, `/s/[token]`, the auth pages and the session-checking catch-all.
- No `headers()` or `redirects()`. Static export doesn't support them, so return them only when the target isn't `shell`.
- `env: { NEXT_PUBLIC_FOLEVI_SHELL: "1" }`.

**New files:**
- `src/app/layout.shell.tsx`: the same `fontVariables` and `THEME_BOOT_SCRIPT` as `layout.tsx`, plus `<meta http-equiv="Content-Security-Policy">` (static export can't send headers).
- `src/app/page.shell.tsx`: renders `<ShellRoot/>` (new, `components/app/ShellRoot.tsx`). It reads the mode synchronously from the bridge global and renders one of three things: the first-launch chooser, `<ProductApp backend="local"/>`, or `<ProductApp backend="account"/>`.
- `apps/web/scripts/build-shell.mjs`: runs `next build` with the shell env, then copies `out-shell/` to `apps/desktop/web/` and `apps/ios/www/`.

**SPA fallback:** both hosts serve `index.html` for any path that isn't a file. `create-initial-router-state.js` seeds `canonicalUrl` from `location`, so `usePathname()` should report `/d/<id>`. This must be proven in spike S1. **Fallback if the `pageExtensions` trick or deep-link hydration fails:** a sibling `apps/shell` Next project with `turbopack.root` at the monorepo root and `@/*` pointed at `../web/src/*`. Nothing else in this design changes.

**Electron (`apps/desktop`):**
- New `src/protocol.ts`:
  - `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])` before `ready`. `standard` and `secure` give the scheme a real origin with IndexedDB, Web Locks and `crypto.subtle`.
  - `ses.protocol.handle("app", …)` on the `persist:folevi` partition serves `process.resourcesPath/web`, with the SPA fallback and a CSP header chosen by mode (local mode: `connect-src 'self'`).
- `/_files/<sha256>` is served from the library by the same handler (§3.7).
- `src/urls.ts`: `APP_URL` becomes `app://folevi`, plus `SERVICE_URL` (`https://app.folevi.com`) for sign-in and links. `isAppUrl` checks `app://folevi`; in development it checks `FOLEVI_SHELL_DEV_URL` (`next dev` with `FOLEVI_BUILD=shell`).
- `electron-builder.yml`: add `extraResources: web/**`.
- In local mode, `ses.webRequest.onBeforeRequest` cancels `*.folevi.com`, `*.convex.cloud` and `*.convex.site` as a second layer of defence.

**Capacitor (`apps/ios`):**
- `capacitor.config.ts`: drop `server.url`, set `webDir: "www"` (the shell build), keep `iosScheme` at its default, so the origin is `capacitor://localhost`. `limitsNavigationsToAppBoundDomains` is no longer needed for a service worker.
- `bridge.js`: the origin check becomes `capacitor://localhost`.
- `FoleviViewController.webView(with:configuration:)`: register a `WKURLSchemeHandler` for `folevi-file`, used for attachments (§4.2).
- In local mode, install a `WKContentRuleList` that blocks the Folevi and Convex hosts.

### What breaks, and the fix for each

| What breaks | Fix |
|---|---|
| `(app)/[...path]` server session check (`hasSessionCookie`) | Excluded from the shell. `ShellRoot` with `LocalGate` / `AccountGate` gates on the client. |
| `/api/auth/[...all]` proxy (first-party cookie) | Signed-in shell uses **bearer** auth through native fetch (below). The proxy stays on the website. |
| `src/proxy.ts` host routing, `headers()`, `redirects()` | Not part of the shell build. CSP goes in a meta tag (iOS) or a protocol header (Electron). |
| Service worker (`ServiceWorkerRegistration`, `public/sw.js`) | Skipped when `isShell()`; the assets are already local. |
| `next/image` default loader | Not used by product code; `images.unoptimized` as a guard. |
| `process.env.NEXT_PUBLIC_*` | Baked in per build: production and dev shell builds. |
| Built-in templates and admin themes (`settings.builtInTemplates`, `themes.list`) | Bundled snapshots: move `BUILT_IN_TEMPLATES` to editor-schema, and have `scripts/snapshot-themes.mjs` write themes at build time. |
| Passkeys (rpID is app.folevi.com) | Don't work from a custom origin. Sign-in in the system browser (ASWebAuthenticationSession on iOS, the default browser on Mac) supports passkeys, so the in-app passkey UI is hidden in the shell (it's already hidden in iOS). |
| `files/:id` pixel reads (`corsFor` in `convex/http.ts`) | Add `app://folevi` and `capacitor://localhost` to `corsFor`. Uploads to Convex storage use plain `fetch` (check the storage endpoint's CORS in spike S4). |
| **IndexedDB origin change** for existing installs (stranded queued edits) | One-time handoff on first launch of the bundled build (§7, risk R2). |

### Signed-in mode from a non-https origin

Use bearer tokens, with HTTP done by the native layer. That means no cookies, no CORS and no origin problems.

1. "Sign in to Folevi" calls `shell.auth.signIn()`, which opens `https://app.folevi.com/connect?client_id=folevi-shell&redirect_uri=folevi://auth/callback&code_challenge=…&state=…` in ASWebAuthenticationSession (iOS) or the default browser (Mac; the `folevi://` return already works for Google in `main.ts` `openLink`/`isSignInReturn`). Password, two-step, Google and passkeys all work there because it is the real website.
2. Native exchanges the code at `/api/auth/native/token`, which creates a new session labelled as the device. It stores the bearer token in the Keychain (iOS: the existing `DeviceCredential` pattern; Mac: Electron `safeStorage` in `userData`). **The token never enters page JavaScript.**
3. `lib/auth/client.ts` is created with `baseURL: SERVICE_URL + "/api/auth"` and `fetchOptions: { customFetchImpl: shellAuthFetch }`. `shellAuthFetch` forwards to `shell.auth.fetch(path, init)`. Native allows only `/api/auth/*` on `SERVICE_URL`, adds `Authorization: Bearer`, sends no cookies, and stores a rotated `set-auth-token` header if one comes back. Requests still pass through the Next proxy, so the signed client-IP rate limits keep working.
4. `lib/convex/provider.tsx` `fetchAccessToken`: in the shell it becomes `shell.auth.convexToken()`, which is native `GET /api/auth/convex/token` with the bearer and returns a 15-minute JWT. `ConvexReactClient` connects to `wss://…convex.cloud` straight from the web view; WebSockets aren't subject to CORS, but check in spike S4 that Convex accepts these origins. `authPhaseOf` is unchanged.
5. **Server changes:** `convex/lib/nativeClients.ts` adds `"folevi-shell": { label: "Folevi app", redirectUris: ["folevi://auth/callback"] }`; `ConnectApp` accepts it; sign-out calls `/sign-out` with the bearer, then native deletes the token. If S4 shows Better Auth's origin check firing on bearer requests without cookies, add the two shell origins to `trustedOrigins`.
6. **Version skew is new** (risk R1). Add `minShellVersion` to `settings.status`, and an API-compatibility snapshot test (§5.3).

---

## 2. The data-layer seam

### 2.1 `LocalClient`: a duck-typed Convex client

`apps/web/src/lib/local/client.ts`:

```ts
export class LocalClient /* satisfies FoleviClient */ {
  watchQuery(ref, args, opts?) // → { onUpdate(cb): () => void; localQueryResult(): unknown; journal(): undefined }
  query(ref, args): Promise<unknown>
  mutation(ref, args, _opts?): Promise<unknown>   // optimisticUpdate ignored: local writes resolve in milliseconds
  action(ref, args): Promise<unknown>
  connectionState() // { isWebSocketConnected: true, hasEverConnected: true, connectionRetries: 0, ... }
  subscribeToConnectionState(cb): () => void
  close(): Promise<void>
  readonly local: LocalHostApi   // putFile(blob), notices, library status: local-only extras
}
```

- **Dispatch:** `getFunctionName(ref)` (for example `"documents:list"`) is looked up in `LOCAL_FUNCTIONS`. An unknown name throws `ConvexError({ code: "local_unsupported" })`. In development it also logs loudly, and the e2e network guard (§5.4) fails the test.
- **Provider switch:** `lib/convex/provider.tsx` gains `BackendProvider({ backend })`. For `"local"` it renders `<ConvexProvider client={localClient as unknown as ConvexReactClient}>`, which is the only cast, guarded by a conformance test. For `"account"` it renders today's `ConvexProviderWithAuth`. `getConvexClient()` throws in local mode (it is used by `lib/nativePush.ts`).
- **Typing seam:** a new `lib/convex/client.ts` exports `type FoleviClient = Pick<ConvexReactClient, "mutation" | "query" | "action">`. Use it in `SyncEngine.open`, `Outbox.open`, `Uploader` and `uploadFileNow`, replacing `ConvexReactClient`. These are signature-only edits.
- **Uploads:** `uploads.ts` `uploadOne` and `uploadFileNow` branch on `"local" in client` and call `client.local.putFile(blob, meta)`, which returns a fileId. There is no POST to a custom scheme.

### 2.2 Reactivity

`lib/local/queryCache.ts`:
- One cache entry per `(name, canonicalJson(args))`, with reference-counted subscribers. `QueriesObserver` creates watches repeatedly, so watches are cheap views over that cache.
- Handlers run against a `LocalCtx` whose reads go through a tracking store. Each read records keys such as `doc:<id>`, `blocks:<id>`, `catalog`, `folders`, `tags`, `tasks`, `collection:<id>`, `search`, `history:<id>`, `notices:<id>`, `stream:<id>`.
- Every store commit (a local mutation, or an ingest from disk) emits the keys it changed. Dirty entries re-run in one microtask batch. A result is replaced only if `canonicalJson` differs, which keeps references stable for `useMemo` and `documentBlocks`.
- `localQueryResult()` returns `undefined` until the first run, exactly as Convex does while loading.
- **Streaming AI** uses the same mechanism: `ai.stream` reads `stream:<id>`, and native AI chunks write to it.

### 2.3 Wiring

- **`components/app/LocalGate.tsx`** replaces `AccountGate` in local mode. It renders `AppStateProvider` with the local profile, skips `bootstrap`, `registerSession` and `useConvexAuth`, and runs local onboarding (seeding from `seedContent`, moved to editor-schema).
- **`lib/app/state.tsx`:** in local mode `effectivelyOnline` is always `true` (the engine and outbox drain to the local backend), and `registerSession` is skipped.
- **Engine and outbox:** `SyncEngine` and `Outbox` are used unchanged. Locally `sync.push` always returns `applied`.
- **Concurrent edits arriving from disk.** If the editor has a pending op based on an older revision, `LocalBackend` doesn't return `conflict` (which would show the account-mode banner). It stamps the op with a fresh HLC, so the local edit is the newer one, applies it, saves the overwritten remote content to version history, and records a "Changed on another device" notice (§3.5).
- **`lib/mode.ts`:**
  - `useBackendMode()` returns `"local" | "account"`.
  - `useCapabilities()` returns booleans such as `sharing`, `comments`, `workspaces`, `presence`, `billing`, `semanticSearch`, `connectedApps`, `emailToNote` and `aiServer`.
  - `<SignInToCollaborate/>` shows the single "Sign in to Folevi to share and collaborate" note.
  - `canPurchaseHere()` returns `false` whenever the mode is local, so prices and upgrades are never shown on any platform.
- **Multi-window Mac** (Quick Add, ⇧⌘N). `lib/local/host.ts` uses a Web Lock, `folevi-local-library`, to pick one window to host `LocalBackend`. The other windows get a `RemoteLocalClient` that sends query, mutation and action calls, and change-key fan-out, over a `BroadcastChannel`. When the host window closes, the lock passes to the next window, which loads the store. iOS has one scene, so it is always the host.

### 2.4 Exactly which functions, and what happens to each

**Port in L1, for the "This device only" MVP (about 75):**
- `sync.push`
- `blocks.list`, `changes`, `rebalance`
- `documents.get`, `list` (paginated), `titles`, `pageTree`, `backlinks`, `info`, `recent`, `recentNotes`, `recordView`, `hideFromRecent`, `showInRecent`, `setStarred`, `setArchived`, `moveToTrash`, `restoreFromTrash`, `deletePermanently`, `trashSummary`, `emptyTrash`, `move`, `bulkUpdate`, `reorder`, `duplicate`, `createSnapshot`, `versions`, `snapshotContent`, `blockAuthors` (which device), `nameVersion`, `copyVersion`, `restoreSnapshot`
- `organization.sidebar`, `index`, `recentFolders`, `draftCount`, `createFolder`, `renameFolder`, `moveFolder`, `setFolderColor`, `deleteFolder`, `createTag`, `updateTag`, `deleteTag`, `setDocumentTags`
- `users.me` (local profile: the most capable shape; plan UI hidden by mode, not by inventing a plan value), `updateProfile`, `completeOnboardingStep`, `setAvatar`, `removeAvatar`
- `workspaces.mine` returns `[]`
- `settings.status`, `builtInTemplates`, `disabledBuiltInTemplates`
- `themes.list`, `planForDocument`
- `files.generateUploadUrl`, `finalize` (both route to `putFile`), `urls`, `setPalette`, `shareForPaste`
- `fileText.forDocument`, `save`
- `synced.home`, `info`
- `clock.now`
- `imports.importText`, `exports.exportScope` (ZIP with fflate, saved through `shell.files.save`)
- `search.documents`, `everywhere`, `meaningAvailable` (returns `false`)

**Port in L2:**
- `tasks.list`, `counts`, `range`, `update`, `quickAdd`, `inbox`, `moveToDocument`, plus a port of `repeatTask` using `recurrence.ts`
- All 15 `collections.*` functions, plus `charts.collections`
- `study.queue`, `review`, `summary`, `setNewPerDay` (move `convex/lib/study.ts` FSRS logic to shared)

**Port in L3:**
- `externalCalendars.*`: fetch ICS through native HTTP, which never touches Folevi; move `lib/icsParse.ts` to shared.
- `bookmarks.preview`: native fetch of the target site.
- `aiGraph.graph`: notes and links only.

**Replace locally with on-device or bring-your-own-key AI (L4):**
- `ai.ask`, `brief`, `write`, `flowchart`, `startStream`, `stream`, `cancelStream`
- `aiChat.*`: a local conversation store
- `aiActions.apply`, `aiMemory.*`, `aiWriting.saveDraft`, `aiStudy.*`, `aiTodos.find`
- `mindmapAi.*`, `stickiesAi.*`, `tableAi.*`, `chartAi.*`, `wireframeAi.*`
- `aiAgent.*` comes later, and only with a BYO key.

**Hide in local mode:**
- `sharing.*`, `workspaces.*` (except `mine`), `workspaceBilling.*`, `billing.*`
- `apiTokens.*`, `webhooks.*`, `mcp.*`, `emailNotes.*`, `comments.*`, `presence.*`, `push.*`, `proposals.*`, `changes.*`, `calendarFeeds.*`
- `routines.*`, `aiDigest.*`, `aiResearch.*`, `aiSharing.*`, `aiSuggestions.*`, `aiAttachments.*` (later replaced by on-device speech), `search.byMeaning`, `fileText.readImage`
- `unsplash.*`, `copies.copyTo` (there's only one place)
- `users.listSessions`, `revokeSession`, `revokeOtherSessions`, `registerSession`, `heartbeat`, `bootstrap`, `deletionBlockers`, `requestAccountDeletion`, `cancelAccountDeletion`
- `support.*` (becomes `mailto:`), `signInOptions`, `passkeyUsage`, `authEmails`
- `notifications.*`: the bell is hidden, and reminders become OS notifications (WP14).

### 2.5 Keeping the two modes in parity as features are added

1. **The compiler checks return shapes.** Handlers are declared as
   `defineLocal(api.documents.get, async (ctx, args: FunctionArgs<typeof api.documents.get>) => … as FunctionReturnType<typeof api.documents.get>)`.
   If the server changes a return type, local mode fails to typecheck.
2. **A coverage test forces every new function to be classified.** `tests/parity/coverage.test.ts` scans `apps/web/src/components` and `src/lib` (excluding admin and marketing) with the regex `api\.\w+\.\w+`. Every hit must be in `LOCAL_FUNCTIONS` or in `LOCAL_HIDDEN`, and a hidden entry must name the capability that gates its UI.
3. **The same scenarios run against both backends.** `tests/parity/scenarios/*.ts` are written against a `Backend { query, mutation, action }` driver. `ConvexDriver` wraps `convex-test` with `signedIn()` from `tests/convex/helpers.ts`. `LocalDriver` wraps `LocalBackend` over `MemoryFs`. `normalize.ts` replaces ids, timestamps, revisions and profile or device ids with placeholders before comparing.
4. **Pure logic is extracted rather than duplicated.** This is WP7-pre: `buildPreview`, `sanitizeTitle`, `newDocumentRank`, `specsToWireBlocks`, `cloneBlocks`, link extraction (`syncLinks` in lib/syncEngine.ts), the templates, seed content, study, ICS parsing and the AI prompt builders move into `packages/editor-schema` (or `packages/ai-prompts`). Convex then imports them back, so both backends run the same derived-data code.

**Rejected alternative:** running the real Convex handlers in the browser on a syscall emulator, convex-test style. It would bundle multi-tenant auth, Better Auth components, the scheduler, `"use node"` actions and plan checks into the client. Its on-disk form would be a dump of Convex tables, not per-note files. And disk merges would bypass the server invariants anyway.

---

## 3. The on-disk format and the merge

### 3.1 Layout

The library is one folder: the iCloud container `iCloud.com.folevi/Documents/Folevi`, a chosen folder, or `Documents/Folevi Library` for "This device only" (visible in the Files app):

```
folevi-library.json            format, libraryId, createdAt, minWriterVersion, encryption header (or null)
notes/<docId>.fnote            one file per document (note, template, synced content, collection row, Inbox page)
files/<aa>/<sha256>            attachments, content-addressed, immutable (encrypted: HMAC name)
history/<docId>/<hlc>-<dev>-<reason>.fver   immutable version files (gzip, fflate)
index/library.findex           folders, tags, library settings: a multi-writer CRDT
index/catalog/<deviceId>.fcat  single writer each: title/icon/kind/folder/parent/updated/trashed hints for a fast cold start
devices/<deviceId>.json        single writer each: name, platform, app version, format understood, lastSeen, seen heads
.folevi-tmp/                   temp files for atomic rename (ignored, cleaned up)
```

Device-private data, outside the library, in the app container:
- IndexedDB `folevi-local-<libraryId>`: the parsed replica, catalog, MiniSearch index, and the `fileStates` map (path → etag or hash last ingested).
- The native journal (§3.6).

### 3.2 Clocks

- **HLC string:** `<ms base36, 9 chars>-<counter base36, 4 chars>-<deviceId>`. Comparing strings gives the total order, with the device as the tie-break.
- **Remote clocks** more than 24 hours ahead of local wall time are accepted, but the local clock is never advanced past `now + 5 min`. This is logged so a clock skew on one device can't make its edits win forever.
- **Per-block version vectors** (`cv: {deviceId: hlc}`) on the content group distinguish "edited after seeing it" from "edited concurrently".

### 3.3 Note file (`.fnote`, canonical JSON via `canonicalJson`, schema version 1)

```jsonc
{ "format":"folevi-note","v":1,"id":"01J…",
  "doc": { "title":{"v":"Trip","c":"<hlc>","cv":{…}}, "icon":{…}, "kind":{"v":"document"}, "folderId":{"v":…,"c":…},
           "parentDocumentId":{…}, "rank":{…}, "style":{…}, "cover":{…}, "starred":{…}, "archivedAt":{…},
           "trashedAt":{…}, "templateKey":{…}, "createdAt":…,
           "tags": { "<tagId>": {"add":"<hlc>","rm":"<hlc>|null"} } },              // OR-set, add wins
  "blocks": { "<blockId>": { "type","schemaVersion","text","props",                 // the content group
                 "parentId","rank",                                                   // the position group
                 "c":{"content":"<hlc>","position":"<hlc>","collapsed":"<hlc>"},
                 "cv":{"<dev>":"<hlc>"}, "deleted": null | {"c":"<hlc>"}, "by":"<dev>" } },
  "files": { "<fileId>": { "sha256","name","mime","size","kind","palette?" } },     // this note's own files
  "collections": { "<collectionId>": { "name":{…}, "properties":{ "<pid>":{…,"c"} }, "views":{…} } },  // host note
  "row": { "collectionId","rank":{…}, "values":{ "<pid>":{"v":…,"c":…} } },        // only on collection-row notes
  "fileText": { "<fileId|blockId>": { "source","reader","text","pageStarts","fingerprint","c" } },
  "versionNames": { "<versionFile>": {"v":"Before trip","c":…} },
  "notices": { "<noticeId>": { "blockId","kind":"changed|deleted|restored","from":"<dev>","at","version":"<file>","dismissed":{"c"}? } },
  "seen": { "<dev>":"<max hlc incorporated>" },
  "sum": "<sha256 of canonical JSON without sum>" }
```

Two notes on this format:
- **Data blocks are one block each.** Mind map, whiteboard, stickies, chart, wireframe, flowchart and table each keep their data in a single `props.data`, so concurrent edits to the same mind map conflict at block level. A later work package can do structural merges using history as the base (risk R6).
- **Permanent delete leaves a stub:** `{format, id, deleted: {c}, seen}`. It is kept for 180 days. See the delete rule in §3.4.

### 3.4 The merge: a state-based CRDT (commutative, associative, idempotent)

`packages/local-store/src/merge.ts`:

```
mergeNote(A, B):
  doc fields: last write wins by c. A concurrent title change also creates a history version and a notice.
  tags:       add-wins OR-set
  per block id in A ∪ B:
    content (with delete counted as a content write):
       if cv(A) ≥ cv(B) → A;  if cv(B) ≥ cv(A) → B
       else (concurrent) → winner = max(c); loser → Loss{blockId, state, from}; winner.cv = max(cv(A), cv(B))
    position:  last write wins on (parentId, rank); no notice
    collapsed: last write wins; no notice
  files, fileText, versionNames, collections, row values: last write wins per key
  notices: union (dismissal is last write wins); seen: pointwise max
```

**Making the loser visible:**
- Each `Loss` produces a history version file, `history/<doc>/<hlc>-<dev>-conflict.fver`. The name is derived deterministically from `hash(blockId, loser.c)`, so two devices that merge the same pair write the same file (idempotent).
- It also produces a notice that the editor shows on that block: "Changed on another device · See the other version", which opens version history at that file.

**Delete versus edit:** the same last-write-wins rule applies, and the loser always goes to history, so nothing is silently lost.

**Permanent delete:** the stub only drops edits it has seen. If a replica has a clock from device `d` greater than `stub.seen[d]`, the note comes back **in Trash** with a "restored" notice.

**After merging, on read:**
- Normalize the tree: concurrent moves can create cycles, and those are re-rooted, mirroring the server. Shapes are tolerated (columns and tabs are only repaired on local edits, as now).
- Ranks tie-break by `(rank, id)`.

**Golden fixtures:** `packages/local-store/fixtures/merge-scenarios.json`, run in the same way as `sync-scenarios.json`.

### 3.5 Library index, catalog and tombstones

- **`library.findex`:** a CRDT of folders (name, color, parent, rank), tags, library settings (profile name, appearance defaults, AI preferences) and `deletedNotes` (id → c, kept for one year). It is merged exactly like a note.
- **Catalog files (one writer each):** let a new device show the whole library before the note files have downloaded. Per note, the highest c across all devices' catalogs wins, and a note file with a newer c always overrides the catalog.
- **Block tombstones** are compacted once every device listed in `devices/` has `seen` past them and they are more than 90 days old.

### 3.6 Writes: durable, atomic and never blind

1. A local mutation updates the replica, then appends to the **native journal** (`shell.library.journal.append`, fsync'd, in Application Support, not in the library), then acknowledges. "Saved" means "on this device".
2. Each note is flushed after 1 second of quiet, or at most every 5 seconds, plus on hide or background (iOS `beginBackgroundTask`). The flush is **read-merge-write**: read the current file (`etag` = mtime+size+inode, or NSFileVersion), merge, then `write(path, bytes, { ifMatch: etag })`. If the etag no longer matches, read and merge again.
   - Native writes atomically: iCloud and File Provider locations use `NSFileCoordinator(.forReplacing)` with `Data.write(.atomic)`; plain folders write to `.folevi-tmp/`, fsync, then `rename`.
   - Journal entries are truncated once the file holds them.
3. **Anti-entropy:** each device keeps re-asserting its changes until the file's `seen[me]` covers its latest clock. A lost update (a provider overwrote without merging) is therefore repaired on the next scan.
4. **Never overwrite a file that couldn't be read and merged.** A failed parse, a wrong `sum`, a GCM tag failure or a short read means "not arrived yet": retry with backoff, then show it in Library health.

### 3.7 Detecting changes in the cloud folder

- **Mac:** Node `fs.watch(root, { recursive: true })` (FSEvents) and a full listing every 30 seconds, on wake and on focus, compared with `fileStates`. For iCloud, the Swift helper adds an `NSMetadataQuery` for download and upload state and conflicts.
- **iOS iCloud:** `NSMetadataQuery` in `NSMetadataQueryUbiquitousDocumentsScope` (adds, changes, `downloadingStatus`), plus `startDownloadingUbiquitousItem` for all `.fnote` files and attachments on demand.
- **iOS chosen folder:** an `NSFilePresenter` on the bookmarked folder, plus polling every 30 seconds while active and a full scan on foreground. Third-party File Providers notify unreliably, so polling is the real mechanism.
- **iCloud placeholders:** dataless or `.name.icloud` files are listed as `downloaded: false`. The UI shows "Downloading from iCloud…" and the catalog supplies titles meanwhile.
- **Conflict copies** are recognized by name: `<ULID> (… conflicted copy …).fnote` (Dropbox), `<ULID> 2.fnote` (iCloud on Mac), `<ULID>(1).fnote` (Drive/OneDrive), and iOS `NSFileVersion.unresolvedConflictVersionsOfItem`. The id is parsed from the first 26 characters (or the HMAC name), the copy is merged into the canonical file, and only after a successful write is the copy deleted or the version marked resolved.
- **Partial arrival** (a note before its attachment, a synced block before its content, a row before its host) shows a "Waiting for this from your other device" placeholder until the missing file arrives.
- **Two devices writing the index** is just another CRDT merge with read-merge-write.

### 3.8 Version history, attachments and garbage collection

- **When versions are made:** `documents.createSnapshot` is triggered by the client on idle, as today. Restore saves "before restore" first, then applies the version as new local edits.
- **Thinning:** auto versions are thinned only by the device that created them (hourly for a day, daily for a month, weekly after that). Named and conflict versions are kept.
- **Attachments** are written once. **Garbage collection** is the risky part: one device could delete a file that another device, offline, has just started referencing. So a file is deleted only if (a) no live, trashed or retained-history note references it, (b) it has been unreferenced for at least 30 days, and (c) every known device's `seen` is past that point. A device that has the bytes cached and sees a referenced file missing rewrites it.

### 3.9 Encryption

- **`folevi-library.json`:** `encryption: { alg: "A256GCM", kdf: { name: "PBKDF2-SHA256", iterations: 600000, salt }, wrappedKey, keyCheck }`. A random master key is wrapped by a key derived from the passphrase. Changing the passphrase rewraps the key only.
- **Per file:**
  - Format: magic `FLV1` + header `{ nonce }` + AES-256-GCM ciphertext.
  - Key: HKDF(master key, file path id).
  - Attachments use 64 KiB STREAM chunks (nonce prefix ‖ counter, a last-chunk flag in the AAD), so audio and video can be read by byte range.
- **File names** are an HMAC of the id. ULIDs would leak creation times. Still visible: the number of notes, their sizes and their modification times.
- **Where crypto runs:** in native code (CryptoKit plus CommonCrypto PBKDF2 on iOS; Node `crypto` on Mac), transparently inside `LocalFs` read and write, with a TypeScript reference implementation for tests and FakeShell. All three share `packages/local-store/fixtures/crypto-vectors.json`. The page never holds the key.
- **Unlocking:** the unwrapped key is cached in the Keychain (`ThisDeviceOnly`, and behind `.userPresence` when the app lock is on).
- **Switching encryption on or off** rewrites every file in the background and can resume. Mixed states are fine because each file describes itself.
- **Lost passphrase:** the cloud copy is unrecoverable, as decided. But a device that still has its replica can export, or "re-encrypt with a new passphrase from this device's copy".
- **Documented limit:** widget, Spotlight and app-container data are plaintext on the device. The threat model is data at rest in the cloud.

---

## 4. Native pieces and the bridge

### 4.1 Bridge contract

`apps/web/src/lib/shell/types.ts`. It replaces and absorbs `lib/desktop.ts` and `lib/nativeApp.ts` behind `shell()`.

```ts
interface FoleviShell {
  platform: "mac" | "ios"; shellVersion: string;
  initialMode: "unset" | "local" | "account";           // set before page scripts (preload / bridge.js)
  setMode(m: "local" | "account"): Promise<void>;
  library: {
    setup(o: { kind: "icloud" | "folder" | "device" }): Promise<LibraryInfo | null>;  // the folder kind opens the picker
    info(): Promise<LibraryInfo>;   // kind, displayPath, available (iCloud signed in?), encrypted, locked
    list(dir: string): Promise<{ path: string; size: number; mtimeMs: number; etag: string; downloaded: boolean; hasConflicts: boolean }[]>;
    read(path: string): Promise<{ bytes: Uint8Array; etag: string } | { notDownloaded: true }>;
    write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<{ etag: string } | { mismatch: true; etag: string }>;
    remove(path: string, o?: { ifMatch?: string }): Promise<void>;
    conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]>; resolveConflicts(path: string, ids: string[]): Promise<void>;
    startDownload(paths: string[]): Promise<void>;
    watch(cb: (changes: { path: string; kind: "changed" | "removed" | "downloaded" | "uploaded" }[]) => void): () => void;
    journal: { append(r: Uint8Array): Promise<void>; readAll(): Promise<Uint8Array[]>; truncate(n: number): Promise<void> };
    unlock(passphrase: string): Promise<boolean>; setPassphrase(p: string | null): Promise<void>; changePassphrase(o: string, n: string): Promise<boolean>;
    fileUrl(sha256: string, mime: string): string;     // app://folevi/_files/<sha> | folevi-file://lib/<sha>
    move(to: { kind: "icloud" | "folder" | "device" }): Promise<LibraryInfo>;
  };
  secrets: { has(name: SecretName): Promise<boolean>; set(name: SecretName, v: string): Promise<void>; delete(name: SecretName): Promise<void> }; // write-only from JS
  auth: { signIn(): Promise<boolean>; signOut(): Promise<void>; fetch(path: string, init: RequestInit): Promise<{ status: number; headers: Record<string, string>; body: string }>; convexToken(): Promise<string | null> };
  ai: { capabilities(): Promise<AiCaps>; generate(req: AiRequest, onChunk: (t: string) => void): { done: Promise<AiResult>; cancel(): void } };
  lock: { getSettings(); setSettings() };              // the iOS AppLock already exists; Mac gets Touch ID
  notify: { schedule(n: { id: string; at: number; title: string; body: string; path: string }): Promise<void>; cancel(id: string): Promise<void> };
  files: { save(name: string, bytes: Uint8Array): Promise<boolean> };
  http: { preview(url: string): Promise<string | null> };   // bookmark HTML from non-Folevi hosts only
}
```

All paths are relative to the library, use forward slashes, and are rejected if they contain `..`, leading slashes or control characters. On iOS, bytes cross the bridge as base64 and are chunked above 4 MB. `SecretName` is an allowlist: `"ai.openai" | "ai.anthropic" | "ai.google"`.

### 4.2 `apps/desktop`

- **`src/protocol.ts`:** the scheme, CSP by mode, the SPA fallback, and `/_files/<sha>` (decrypting STREAM chunks, honouring Range, `nosniff`).
- **`src/library/fs.ts`:** the Node `LocalFs`: path validation, `.folevi-tmp` atomic rename, etags, and crypto through `node:crypto`.
- **`src/library/watch.ts`:** `fs.watch` recursive plus polling.
- **`src/library/journal.ts`.**
- **`native/folevi-files.swift`:** a long-running helper speaking JSON lines over stdio, built universal like `folevi-text` by `scripts/build-helper.mjs`. It provides `ubiquityContainerURL`, coordinated read and write, `NSMetadataQuery` events, `startDownloading` and `NSFileVersion` conflicts.
- **`src/secrets.ts`** (`safeStorage`), **`src/authBridge.ts`** (PKCE in the browser through the existing `folevi://` handling, plus `net.fetch` restricted to `SERVICE_URL/api/auth/*`), **`src/lock.ts`** (`systemPreferences.promptTouchID` plus a cover view).
- **`native/folevi-ai.swift`:** FoundationModels `LanguageModelSession` (macOS 26 SDK, `#available`), streaming JSON lines. BYO-key HTTPS (only `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`) goes through `net.fetch` in main, with the key read from `safeStorage`.
- **`preload.ts`:** exposes `foleviShell` and sets `initialMode` synchronously from `settings.json`.
- **`main.ts`:** IPC handlers that check `isAppUrl(senderFrame.url)` and validate every argument, as today.

### 4.3 `apps/ios`

- **`Native/Library/`:**
  - `LibraryPlugin.swift`: Capacitor plugin `FoleviLibrary`.
  - `ICloudLibrary.swift`: `url(forUbiquityContainerIdentifier: "iCloud.com.folevi")` off the main thread, `NSMetadataQuery`, `NSUbiquitousContainers` in Info.plist with `NSUbiquitousContainerIsDocumentScopePublic` so the folder appears in iCloud Drive.
  - `FolderLibrary.swift`: `UIDocumentPickerViewController(forOpeningContentTypes: [.folder])`, bookmark data stored in UserDefaults, `startAccessingSecurityScopedResource` around each operation, `NSFilePresenter`.
  - `CoordinatedIO.swift`, `LibraryCrypto.swift`, `Journal.swift`.
  - `FileSchemeHandler.swift`: `folevi-file://`, with CORS for `capacitor://localhost` and Range support.
- **`Native/AuthSession.swift`:** ASWebAuthenticationSession and the bearer token in the Keychain group.
- **`Native/AI/OnDeviceModel.swift`:** FoundationModels, iOS 26+, `SystemLanguageModel.default.availability`.
- **`Native/SecretsPlugin.swift`.**
- **AppLock:** the existing `AppLock.swift` is reused.
- **Extensions in local mode** (`AppServices` checks the mode):
  - **Widgets** read `widgets.json`, which the page writes through `setWidgetSnapshot`.
  - **`ToggleTaskIntent`, Add task, New note** write to an App Group `LocalActions/` queue. The page drains it on foreground (`takeLocalActions`), the same pattern as `takeShares`.
  - **The share extension** always queues, and the existing `takeShares` → `lib/share/save.ts` path is unchanged.
  - **Spotlight** items are pushed from the page (`indexSpotlight`). None of these use the REST API in local mode.

---

## 5. Features reimplemented locally

### 5.1 Status of every feature

| Feature | Status | Local implementation |
|---|---|---|
| All block types, mind map, stickies, chart, wireframe, whiteboard, flowchart, columns, tabs, Mermaid, KaTeX, embeds | Client-only | none (embeds reach third-party hosts, which is allowed) |
| Table formulas (`evaluateTable`), collection formula properties (`collectionFormulas`) | Client-only | none |
| Slides and present, themes rendering, covers (bundled art) | Client-only | themes snapshot bundled |
| Markdown/HTML import and export, single-note PDF | Mostly client | `imports.importText` → `markdownToBlocks`; ZIP via fflate |
| Notes CRUD, nesting, folders, tags, star, archive, Trash (30 days), duplicate, drafts/unsorted | Local port L1 | `functions/documents.ts`, `organization.ts`; derived data via shared `buildPreview`, `documentSearchText` |
| Backlinks, page-link labels | Local port L1 | links extracted on ingest; labels resolved at read time like `ReaderLabels` (no cross-file cache rewrites) |
| Synced blocks (`home`, `info`, Trash when unreferenced) | Local port L1 | from the local link index |
| Templates (user and built-in) | Local port L1 | user templates are notes; built-ins bundled |
| Version history (auto, named, restore, copy, which device) | Local port L1 | history files (§3.8) |
| Search (titles, text, highlights, ⌘K) | Local port L1 | `lib/local/search/`: MiniSearch (prefix, BM25), persisted in IndexedDB, updated per note; snippets via shared `highlightRanges` and `searchSnippet` |
| Search in PDFs and images and handwriting | Client reading already exists | `fileText` is stored in the note file, so another device doesn't read it again; `useFileText` reads bytes from `fileUrl` |
| Tasks (views, counts, quick add, Inbox, recurrence, move) | Local port L2 | projection via `projectTask`; `tasks.update` edits the todo block through the same op path |
| Calendar (tasks) | Local port L2 | `tasks.range` |
| Calendar subscriptions (ICS) | Local port L3 | native HTTP plus shared `icsParse` |
| Reminders | Local port L2 | `shell.notify.schedule` (UNUserNotificationCenter; Electron `Notification` from main) |
| Collections (properties, views, rows, summaries) | Local port L2 | definition lives in the host note, rows are notes |
| Reviews / flashcards (FSRS) | Local port L2 | review state lives in the note file per card |
| Graph view | Local port L3 | links only |
| Bookmark previews | Local port L3 | `shell.http.preview` plus a shared OG parser |
| Foli AI (write, ask, brief, block AI, chat, memory) | Local replacement L4 | `packages/ai-prompts` plus `LocalAiProvider` (Apple on-device or a BYO key, native HTTP); capabilities through `aiChat.capabilities`, so the UI offers only what the active model can do |
| Agent, research, digest, routines, semantic search, suggestions, transcription | Hidden (agent later with a BYO key) | |
| Sharing, public pages, comments, presence, workspaces, members, guests, email-to-note, web clipper, MCP/REST, API tokens, webhooks, AI credits, billing, sessions/devices, notifications bell, Changes, Copy to, Unsplash | Hidden | one `<SignInToCollaborate/>` note |

### 5.2 Exactly what gets hidden in the interface

- **Sidebar:** the workspace switcher, Shared with me, Changes.
- **A note:** the Share button (replaced by the note), the Comments tab and margin, presence carets, people mentions in the @ menu (dates and pages stay).
- **Settings:** account, billing, security, devices, connected-apps and all `workspace*` sections. A new "Library" section replaces "sync".
- **Plans:** every plan, trial or upgrade surface (`canPurchaseHere()` is false in local mode on every platform).

### 5.3 Version skew in signed-in mode

`tests/contract/api-snapshot.test.ts` records the argument validators and return types of every function in the shell's allowlist, using `convex/_generated/api.d.ts` and the validators. CI fails on a breaking change. `settings.status.minShellVersion` gates the app with "Update Folevi to keep syncing", which carries no pricing.

### 5.4 Tests that guard "never contacts Folevi"

- The Playwright `local` project routes `**/*.folevi.com/**` and `**/*.convex.*/**` to abort and fail the test.
- A unit test asserts that `ConvexReactClient` is never constructed in local mode.

---

## 6. Migration paths

### 6.1 From local to an account (`lib/migrate/uploadLibrary.ts`)

1. Sign in with PKCE (§1). Preflight with a new `migration.preflight` query: counts and storage against the plan. A shortfall is reported as "Some files didn't fit"; iOS shows no prices.
2. Folders and tags go through the existing outbox mutations with **the same client ids** (`createFolder` takes `id`).
3. Notes go through the normal `SyncEngine`: `document.create` with the same ULID, then `block.upsert` (`baseRevision: null`) with the same block ids.
   - Order: parents before children, synced content before the notes that show it, collection hosts before rows (`collections.create` and its properties, then rows).
   - A replay is idempotent: identical content returns `applied`, so the upload can resume. Progress is recorded in the replica (`migration.done[docId]`).
4. Attachments go through `uploadFileNow({ documentId })`, giving `fileId`. `props.fileId` (and `files` entries) are rewritten from local to server ids **before** the block ops are queued. `fileText` goes through `fileText.save`.
5. Remapped ids:
   - The local Inbox `inboxDocumentId(localProfileId, "personal")` maps to the account's Inbox id. Its blocks are appended if that Inbox already exists.
   - The local profile id in `assigneeId` and in `mention` nodes maps to the account's profile id.
6. Version history: add an owner-only, size-limited `documents.importSnapshot` mutation (reason `"imported"`). If it isn't wanted, the history is exported as a ZIP into the library folder instead.
7. Switch to account mode. Write `migratedTo` into `folevi-library.json` and leave the folder untouched, with "Remove the local copy…" offered later.

### 6.2 From an account to local (`lib/migrate/exportToLocal.ts`, run in signed-in mode)

1. Page through `documents.list` (including Archive and Trash), `blocks.list` per note, `collections.get`, `organization.index`, tags, `fileText.forDocument`, and optionally `documents.versions` with `snapshotContent`.
2. Download each file from its `files.urls` signed URL, hash it with sha256, and store it under `files/`. Rewrite each `fileId` to a fresh local fileId.
3. **Document and block ids are kept**, so `pageLink` and `synced` references survive. Inbox ids are remapped.
4. Comments, sharing and workspace membership are written to `exported/server-only.json` for the record.
5. Scope: Personal always. Workspaces the person can manage are offered as top-level folders named after the workspace.
6. Then sign out: revoke the session, `forgetThisDevice`, clear the account's IndexedDB. Say clearly that the account itself still exists.

---

## 7. Phased plan as independent work packages

Each package lists the files it owns, to minimize overlap between builders.

**Phase 0, spikes (one builder, about a week). Gate: a decision record, `docs/LOCAL_MODE.md`.**

| Spike | Question |
|---|---|
| S1 | `pageExtensions` static export, and `/d/<id>` deep-link hydration under the SPA fallback |
| S2 | `app://` in Electron: IndexedDB, Web Locks, `crypto.subtle`, `BroadcastChannel` |
| S3 | `capacitor://localhost` on iOS 17 and 26: the same APIs, plus `folevi-file://` fetch with CORS and Range |
| S4 | Bearer `/native/token` and `/convex/token` through native fetch; the Convex WebSocket from both origins; the Convex storage upload CORS |
| S5 | `LocalClient` driving the real `convex/react` hooks |
| S6 | The iCloud container from both the Electron helper and iOS. This needs the Developer Program. |

**Phase 1, foundations (in parallel):**
- **WP1, shell build:** `next.config.ts` (shell branch), `src/app/layout.shell.tsx`, `src/app/page.shell.tsx`, `components/app/ShellRoot.tsx`, `lib/shell/*`, `scripts/build-shell.mjs`, `scripts/snapshot-themes.mjs`, the `ServiceWorkerRegistration` guard.
  - Tests: the build emits `out-shell/index.html` with no route-handler output; Playwright against a static server with SPA fallback loads `/d/<id>` and `/tasks/today` and navigates with pushState; a grep test that the bundle contains no `admin` chunks.
- **WP6, `packages/local-store` (new, pure TypeScript, depends only on editor-schema):** `hlc.ts`, `vv.ts`, `noteFile.ts`, `merge.ts`, `indexFile.ts`, `catalog.ts`, `history.ts`, `attachments.ts`, `tombstones.ts`, `layout.ts` (conflict-copy name parsing), `io.ts` (`LocalFs` interface plus read-merge-write), `journal.ts`, `crypto/envelope.ts`, `fs/memoryFs.ts`, `fs/faultyFs.ts`.
  - Tests: golden `merge-scenarios.json`; property tests with N replicas, random concurrent edits and file exchange with duplicates, reordering, partial files, conflict copies and lost updates (via `faultyFs`), asserting **convergence** and **no loss** (every edit is either live or in history); crypto vectors; partial file → no overwrite.
- **WP5, data seam:** `lib/local/client.ts`, `queryCache.ts`, `registry.ts`, `host.ts`, `lib/convex/client.ts` (the `FoleviClient` type), `lib/convex/provider.tsx` (`BackendProvider`), `lib/mode.ts`, `components/app/LocalGate.tsx`, small signature edits in `engine.ts`, `outbox.ts`, `uploads.ts` and `state.tsx`.
  - Tests: `useQuery`, `usePaginatedQuery`, `useMutation` and `useConvexConnectionState` against `LocalClient` (jsdom); reactivity (minimal re-runs, stable references); leader election and handover with two jsdom windows; `getConvexClient` throws in local mode.
- **WP7-pre, extraction:** move the pure helpers listed in §2.5 into `packages/editor-schema/src/{derive,content,templates,study,ics}.ts` and `packages/ai-prompts`. Convex re-imports them, with no behaviour change.
  - Tests: the existing `tests/convex` suite and editor-schema tests stay green.
- **WP8a, parity harness:** `tests/parity/{drivers,normalize.ts,coverage.test.ts}`, the vitest project, and `apps/web/e2e/fixtures/localShell.ts` (FakeShell over OPFS, enabled only in development like `__foleviTestRecognizer`), plus the Playwright `account` and `local` projects.

**Phase 2: bundled apps in account mode (ships first), local backend, native file layers:**
- **WP4, signed-in bundled:** `lib/auth/client.ts` (custom fetch), the provider's token path, `convex/lib/nativeClients.ts`, `ConnectApp` client acceptance, `convex/http.ts` `corsFor`, `settings.status.minShellVersion`, `tests/contract/api-snapshot.test.ts`.
  - Tests: convex tests for the `folevi-shell` client (wrong redirect refused, PKCE mismatch, replay); `e2e/native-auth.spec.ts` extended; sign-out revokes.
- **WP2, Electron hosting:** `apps/desktop/src/{protocol.ts,urls.ts,main.ts,preload.ts,authBridge.ts,secrets.ts}`, `electron-builder*.yml`, plus the one-time IndexedDB handoff (a hidden window on the old origin, served locally through `ses.protocol.handle("https")`, reads `folevi-*` queues and hands them to the new origin).
  - Tests: `shell.test.ts` (scheme, paths, CSP by mode); `e2e/desktop-app.spec.ts` against the bundled build, offline from cold.
- **WP3, Capacitor hosting:** `capacitor.config.ts`, `bridge.js`, `FoleviViewController.swift`, `FileSchemeHandler.swift`, `AuthSession.swift`.
  - Tests: XCTest for scheme-handler path validation and Range; simulator `scripts/simulator.mjs` for sign-in, a cold offline launch, and widgets refreshing.
- **WP7a–e, LocalBackend handlers** in `apps/web/src/lib/local/functions/`. Each builder owns whole files:
  - a: `sync.ts`, `blocks.ts`, `documents.ts`
  - b: `organization.ts`, `users.ts`, `settings.ts`, `themes.ts`, `workspaces.ts`
  - c: `tasks.ts`, `study.ts`
  - d: `collections.ts`, `charts.ts`
  - e: `search.ts` with `lib/local/search/`, `files.ts`, `fileText.ts`, `synced.ts`, `imports.ts`, `exports.ts`, `versions` (in `documents.history.ts`)
  - Tests: parity scenarios per module (WP8b writes them alongside); `@both` tags added to `editor`, `documents`, `organize*`, `nested-folders`, `search`, `import-export`, `collections`, `collection-formulas`, the block specs, `tasks`/`calendar` and `offline-everything` specs.
- **WP9, native file layers:**
  - Mac: `apps/desktop/src/library/*`, `native/folevi-files.swift`.
  - iOS: `apps/ios/ios/App/Native/Library/*`.
  - Shared `LocalFs` contract fixtures (`packages/local-store/fixtures/fs-contract.json`) run by vitest (Node) and XCTest (Swift): atomic write under concurrent writers, `ifMatch`, conflict-version handling, placeholders, journal fsync.
  - Manual: two Simulators plus the Mac on one iCloud account; Dropbox and Google Drive folders on both; airplane-mode edits on both, then rejoin.

**Phase 3, product surface (in parallel):**
- **WP10, mode UI:** `components/app/ModeChoice.tsx` ("Keep notes on my devices" / "Free forever. No account." / "Sign in to Folevi"), `LibrarySetup.tsx` (iCloud / Choose a folder / This device only, plus iCloud-off detection), `views/settings/LibrarySection.tsx` (location, move, devices with last seen, Sync now, Library health, passphrase), `SignInToCollaborate.tsx`, capability gates in Sidebar, Inspector, Settings and Share, `components/editor/notices/ChangedElsewhere.tsx`, the Mac Touch ID lock.
  - Tests: `e2e/local-mode.spec.ts` (first launch to a note, every hidden surface absent, no-network guard); `ios-app.spec.ts` and `native-app.test.tsx` (no prices in local mode on any platform); axe on the new screens.
- **WP12, migration:** `lib/migrate/*`, `convex/migration.ts` (`preflight`), optional `documents.importSnapshot`.
  - Tests: a parity-style round trip, local → account → local, with ids, attachments (by sha), collections, synced blocks and Inbox remap preserved; resume after the process is killed mid-upload.
- **WP13, extensions and windows in local mode:** iOS `AppServices`, `WidgetStore`, the intents' local-actions queue, Spotlight from the page; Mac Quick Add through `RemoteLocalClient`.
- **WP14:** local reminders and ICS subscriptions.

**Phase 4:** WP11 local AI (`packages/ai-prompts`, `lib/local/ai/*`, `Native/AI/OnDeviceModel.swift`, `native/folevi-ai.swift`, Settings > AI keys stored write-only in the Keychain); structural merges for data blocks, three-way using history as the base; making encryption on and off a resumable background job.

**Recommended release order:**
1. Bundled shell in account mode only.
2. Local mode, "This device only".
3. iCloud.
4. "Choose a folder".
5. Encryption.
6. AI.

### Riskiest parts and how to reduce the risk

- **R1, version skew.** Today web, Mac and iOS always run the latest site; bundling freezes the client per app version. Mitigations: the API snapshot test, `minShellVersion`, and only additive changes to the shell's function allowlist. This is also the App Review-safe option (no downloaded code).
- **R2, origin change strands unsynced edits.** Mitigation: the WP2 handoff on Mac. Ship the iOS bundled build before the App Store launch, since there's no user base yet.
- **R3, the `pageExtensions` export and deep-link hydration.** Mitigation: spike S1, with the `apps/shell` sibling project as the fallback.
- **R4, convex/react internals** (the duck-typed client). Mitigations: pin `convex`, the hook conformance test, and review on every upgrade.
- **R5, cloud providers** are not iCloud: Dropbox, Drive and OneDrive File Providers on iOS notify late and evict files. Mitigations: polling, a full scan on foreground, anti-entropy re-assertion, "Sync now", device last-seen in Settings, and iCloud as the recommended choice.
- **R6, concurrent edits inside one data block** (mind map, table, whiteboard) resolve as a block-level loss: newer wins and the loser goes to history. Mitigation: a Phase 4 three-way structural merge on element ids.
- **R7, the iCloud container on Mac** needs the paid Developer Program, a provisioning profile and the Developer ID build (`electron-builder.dist.yml`). Until then, Mac "Sync with iCloud" can't share the iPhone's container. Gate the option on spike S6.
- **R8, attachment garbage-collection races.** Mitigation: the rule in §3.8, plus re-writing missing referenced files from a local cache.
- **R9, clock skew.** Mitigation: HLC with a cap on forward drift, and version vectors decide concurrency, so skew only changes which concurrent edit wins, never whether one is kept.
- **R10, Foundation Models** need iOS or macOS 26 and Apple Intelligence hardware, with a context of about 4K tokens. Mitigations: per-feature capability flags, chunking, a BYO-key fallback, and hiding features the device can't run.
- **R11, encryption UX.** Mitigations: native-only key handling, test vectors, the escape hatch "re-encrypt from this device's copy", and repeated warnings on setup.
- **R12, duplicated handlers drifting from the server.** Mitigations: typed returns, the coverage test, shared scenarios and pure-logic extraction (§2.5).

### Critical Files for Implementation
- /Users/faisalislam/Documents/GitHub/Airly Studio/folevi/apps/web/src/lib/convex/provider.tsx
- /Users/faisalislam/Documents/GitHub/Airly Studio/folevi/apps/web/src/lib/sync/engine.ts
- /Users/faisalislam/Documents/GitHub/Airly Studio/folevi/apps/web/src/lib/app/state.tsx
- /Users/faisalislam/Documents/GitHub/Airly Studio/folevi/apps/web/next.config.ts
- /Users/faisalislam/Documents/GitHub/Airly Studio/folevi/convex/lib/nativeAuth.ts (with `convex/lib/nativeClients.ts`, `apps/desktop/src/main.ts`, `apps/ios/ios/App/App/FoleviViewController.swift`)