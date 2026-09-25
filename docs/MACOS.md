# Folevi for Mac

The native macOS client: Swift 6 (strict concurrency) + SwiftUI, with AppKit where SwiftUI can't
deliver: `NSTextView` block editing, Quick Look, save/open panels, PDF rendering, the Finder drag-out.
It is not a web view, Electron or Catalyst app.

- Bundle id `com.folevi.mac`, deployment target macOS 15.0, App Sandbox (network client,
  user-selected files read/write, Downloads), hardened runtime.
- Swift packages: `convex-swift` 0.8.1 (`ConvexMobile`), `Auth0.swift` 3.1.0.
- Project: `apps/macos/project.yml` (XcodeGen). The generated `Folevi.xcodeproj` is committed, so
  building doesn't need XcodeGen.

## Build, run, test

```sh
# Debug build → apps/macos/build/Folevi.app, then launch it
script/build_and_run_macos.sh
script/build_and_run_macos.sh --dev-login ada@example.com        # sign in with a local dev token
script/build_and_run_macos.sh --release --no-launch               # Release build, staged only
script/build_and_run_macos.sh -- -FoleviForceOffline YES          # extra launch arguments after --

# Unit tests (no host app, no network)
xcodebuild -project apps/macos/Folevi.xcodeproj -scheme Folevi -destination 'platform=macOS' build test

# UI tests: need the local backend (npx convex dev on :3210) and a dev token; they skip otherwise.
TEST_RUNNER_FOLEVI_UITEST_TOKEN=$(node scripts/dev-token.mjs --email uitest@example.com --name "UI Tester") \
  xcodebuild -project apps/macos/Folevi.xcodeproj -scheme FoleviUITests -destination 'platform=macOS' test
```

After editing `project.yml` or adding or removing source files, run `cd apps/macos && xcodegen generate`
(`brew install xcodegen`).

Helper scripts (in `apps/macos/scripts/`):

| Script | What it does |
| --- | --- |
| `make-app-icon.swift` | Renders the app icon (the leaf/folio "F" mark on a warm paper squircle with an ultramarine leaf and edge band) at every size into `Assets.xcassets/AppIcon.appiconset`. Pure CoreGraphics. Run: `swift apps/macos/scripts/make-app-icon.swift`. |
| `generate-test-fixtures.mjs` | Bundles `packages/editor-schema` with esbuild and writes `FoleviTests/Fixtures/reference-outputs.json`: expected Markdown/HTML export, Markdown import, inline parsing, tree and number-formatting outputs from the TypeScript reference. Run with `node`. |
| `update-string-catalog.py` | Refreshes `Resources/Localizable.xcstrings` (English source strings) from the compiler's extracted `.stringsdata`. Run after a build. |

## Configuration

`apps/macos/Config/{Debug,Release}.xcconfig` → Info.plist keys → `AppConfig` at runtime.

| Setting | Debug | Release |
| --- | --- | --- |
| `CONVEX_URL` | `http://127.0.0.1:3210` | `https://<prod>.convex.cloud` (placeholder) |
| `FOLEVI_DEV_AUTH_URL` | `http://localhost:3000/api/dev-auth/token` | empty |
| `AUTH0_DOMAIN` / `AUTH0_CLIENT_ID` | placeholders | `auth.folevi.com` / `set-me` |
| ATS exception for `localhost`/`127.0.0.1` | yes (Info.plist preprocessing, `FOLEVI_LOCAL_ATS`) | no |

Placeholder values are detected at runtime. The app says so honestly ("Folevi isn't configured for
sign-in yet" / "…isn't configured yet") instead of failing. URLs in xcconfig use `http:/$()/…`
because `//` starts a comment there.

## Auth

`RoutingAuthProvider` is the single `AuthProvider` given to the one process-wide
`ConvexClientWithAuth`. It routes to:

- **Auth0 (Universal Login)**, `Features/Auth/AuthProviders.swift`: `ASWebAuthenticationSession` via
  Auth0.swift with PKCE, scopes `openid profile email offline_access`. Credentials are kept by
  `CredentialsManager` in our Keychain wrapper (`KeychainCredentialsStorage`), and the ID token is
  renewed with the refresh token when fewer than 120 s remain. We don't use `convex-swift-auth0`
  because it pins Auth0.swift 2.17.
- **Developer sign-in** (DEBUG builds only, and only when `FOLEVI_DEV_AUTH_URL` is set): a small sheet
  (email and name) that POSTs to the web app's `/api/dev-auth/token`. Automation can pass
  `-FoleviDevToken <jwt>` or `FOLEVI_DEV_TOKEN`. All of this sits behind `#if DEBUG`; the Release
  binary contains none of it (verified with `strings`).

Credentials live only in the Keychain (`Support/Keychain.swift`, legacy file keychain with the app's
default access group, so no provisioning profile is needed). `UserDefaults` holds only the non-secret
device id, the last profile id (which selects the local database) and view preferences.

After a token is in place, `users:me` routes the app: `needs_bootstrap` calls `users:bootstrap`
automatically, and `email_unverified`, `mfa_required`, `suspended` and `session_revoked` each get a
dedicated screen. Onboarding has three steps (name the workspace, choose an appearance, open Welcome).
`users:registerSession({client:"mac"})` runs after sign-in, and a live `users:me` subscription signs
the Mac out if its session is revoked elsewhere.

### Setting up Auth0 for the Mac

1. In the Auth0 tenant, create a **Native** application ("Folevi for Mac"). Enable the Authorization
   Code grant with PKCE and Refresh Token rotation.
2. Allowed Callback URLs and Allowed Logout URLs:
   `com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback` (use your tenant/custom domain).
3. Set `AUTH0_DOMAIN` / `AUTH0_CLIENT_ID` in `Config/Release.xcconfig` (and in Debug to test).
4. On the Convex deployment, set `AUTH0_MAC_CLIENT_ID` to the new client id. `convex/auth.config.ts`
   trusts ID tokens whose audience is either the web or the Mac client id.

## Architecture

```
Folevi/
  App/            FoleviApp (scenes: main WindowGroup, per-document WindowGroup(for: String), Quick Add
                  window, Settings, MenuBarExtra), AppModel (auth phase, session, documents, sync status),
                  NavigationModel (per window), FoleviCommands (menus), Automation (DEBUG only)
  Domain/         JSONValue (lossless JSON + JS-identical canonical output), flexible Int decoding, Rank,
                  Tree, RichText, WireBlock/Block, DocumentModels, Markdown (export + import), HTMLExport,
                  Tasks/Search helpers, ULID + deterministic Daily Note ids, Generated/ (read-only)
  Data/Local/     SQLiteStore (actor, system libsqlite3, WAL, versioned migrations)
  Data/Remote/    ConvexService (wraps the single client), API DTOs, repositories
  Sync/           SyncReducer (exact port of sync.ts), SyncEngine (actor), ConnectionMonitor
  Features/       Auth, Documents (sidebar, browser, windows), Editor, Tasks, Calendar, Search, Settings
  DesignSystem/   Generated tokens, typography, components, the Folevi mark
  Support/        Logging, Keychain, ExportService (Markdown/HTML/PDF, Import Markdown)
```

### Local-first data flow

1. The editor changes a block. `EditorModel.commit` (structural changes) or `textChanged` (typing)
   updates the in-memory model immediately and sends a batch through a **serial edit queue** to the
   `SyncEngine` actor. The queue keeps edits in order.
2. The engine applies the batch through the reducer (`SyncState.localUpsert/Delete/Restore`). Unsent
   upserts for the same block coalesce. A coalescing writer persists the entities, the op log,
   conflicts, uploads and errors to SQLite in one transaction, and the newest state always lands last.
3. When online, the **reconnect pipeline** runs: refresh auth when needed, keep a `sync:head`
   subscription, pull pages from `sync:pullJson` since the stored cursor (each row goes through
   `remoteUpdate`, so local unsent work always wins), then push: `takeBatch` → `sync:pushJson`
   (JSON-string payload) → `applyResults` (conflicts, rejections, rebasing of queued ops). Network
   failures call `batchFailed(.network)` and retry with backoff. `unauthenticated` refreshes the
   token and retries. Repeated server failures shrink the batch size to isolate a bad op.
4. `SyncEvent`s (`blocks`, `remoteBlocks`, `documents`, `status`, `acknowledged`) update `AppModel`.
   Open editors reload from the engine, keeping blocks that still have local edits in flight. A reload
   that raced with a local edit is discarded and retried.
5. The status pill shows the reducer's status (Saved / Saving / Offline / Syncing / Conflict / Error).
   "Saved" only appears after the server has acknowledged every op. Status changes are announced
   politely to VoiceOver.

Safety guards learned from the web client:

- The editor never sends a diff before it has been hydrated with the document's real blocks.
- Programmatic text installs never count as edits.
- A non-explicit structural edit that would delete more than half of a document is refused and
  logged.
- Changed fields and Undo snapshots are computed against the last committed state, not the mutated
  working copy.

Document-level ops (`document.create`, `document.update`) share the same queue. The reducer passes
them through, and the engine records their results; coalesced patches fold into an unsent create.
Daily Notes use the deterministic id `daily-<date>-<fnv1a64(profileId:workspaceId)>`, identical to
`packages/editor-schema/src/ids.ts`, so offline devices converge on the same note.

### Editor

- `EditorView`: a centered folio page (narrow 640, default 760 or wide 960 pt; paper, plain, tinted
  or grid background) in a `ScrollView` + `VStack` of block rows. It has a cover/icon/title header
  (the title is a plain `BlockTextView`, New York serif), a conflict banner with a merge sheet, and a
  find bar (⌘F).
- `BlockTextView` (an `NSTextView` on an explicit TextKit 1 stack) runs every text-bearing block:
  - Typing: IME/marked text, spelling, services, per-block typing undo that falls back to the
    editor's structural undo (window `UndoManager`).
  - Block keys: Return splits, Backspace at start converts, outdents or merges, Tab and ⇧Tab
    indent/outdent, ↑/↓/←/→ at edges move between blocks, ⌥⇧↑/↓ reorder, Esc selects the block.
  - Markdown shortcuts: `# `, `## `, `### `, `- `, `1. `, `[] `, `> `, `---`, ```` ``` ````.
  - Popups: the `/` slash menu and the `[[` page-link picker, both keyboard-navigable.
  - Marks are stored as custom attributes, and `InlineAttributedString` maps them to and from
    `[InlineNode]`.
- Non-text blocks are native views: divider, code (monospaced, language picker), image (async load
  from the attachment cache or signed URL, upload progress, drag out to Finder, Quick Look with Space),
  file (Quick Look, Reveal, Save As), table (editable cell grid, add/remove rows and columns), page
  (card or link; ⌥-click opens a new window), bookmark, collection (read-only table of rows that open
  their pages), callout, quote, toggle, to-do (checkbox, due date and priority chips), and unknown
  blocks ("Needs a newer version of Folevi", preserved byte-for-byte).
- Block selection: Esc, ⇧-click, ⇧↑/↓, then Delete, ⌘D, ⌥⇧↑/↓, Tab and Return. Drag handles reorder
  blocks with an insertion indicator. Dropping Finder files inserts image/file blocks whose ops are
  held back (`blockedBy`) until the upload is finalized (`files:generateUploadUrl` → POST →
  `files:finalize`).
- Idle snapshots: `documents:createSnapshot` runs 2 minutes after the last acknowledged edit and when
  the editor closes. Version history (list, preview, restore) lives in a sheet.
- Inspector tabs: Insert, Format, Style (typeface, width, background, accent, card, cover), Info
  (counts, dates, backlinks, activity) and Comments.

### Other features

- **Sidebar**: New Document, All Documents, Tasks, Calendar, Daily Notes, Shared with Me, Templates,
  Starred, Folders (drop documents on them to move; the move is a sync op, so it works offline), Tags,
  Archive, Trash, Settings and Help.
- **Browser**: cards, compact or list layout; sort by last edited, created or title; context menu
  (open in a new window, star, move, duplicate, archive, trash/restore).
- **Tasks**: Inbox, Today, Upcoming, All, Completed and My Tasks, derived locally from to-do blocks
  (so they work offline). Checking a task is a block edit.
- **Quick Add**: a panel (⇧⌘A, ⌃⌥Space while Folevi is active) and a menu bar extra. It appends to
  today's Daily Note, locally.
- **Calendar**: a month grid and agenda with tasks by due date and Daily Notes. Dragging a task onto
  a day calls `tasks:update` when online (a local edit otherwise), with Undo.
- **Command palette** (⌘K): recent documents, instant local matches, then `search:documents`
  full-text with highlighted matches, plus actions. Fully keyboard-driven.
- **Settings**:
  - Account: name, sessions list and revoke, sign out.
  - Appearance: system, light or dark, and editor text size.
  - Notifications: task reminders only after explicit permission; the app stays fully useful when
    it's denied.
  - Offline & Sync: pending count, Sync Now, Work Offline, Reset Local Cache.
  - About.
- **Export and import**:
  - Markdown: a single `.md` file, or a folder with `assets/` when the document has attachments.
  - HTML: self-contained, with images inlined.
  - PDF: rendered by AppKit's text system.
  - All exports reveal the result in Finder.
  - Import Markdown… parses locally, so it works offline.
  - Share (toolbar) sends a Markdown file.
- **Accessibility**:
  - Labels, values and actions on custom controls.
  - Heading traits and levels on H1–H3 rows for the rotor.
  - Visible focus for Full Keyboard Access.
  - Reduce Motion disables animations; Reduce Transparency swaps glass and materials for solid
    surfaces.
  - Dynamic editor zoom (⌘+ / ⌘- / ⌘0).
- **Liquid Glass**: on macOS 26+, `glassEffect` is used for floating chrome (find bar, toasts). On
  macOS 15 the same chrome uses standard materials.

### Launch arguments

| Argument | Build | Purpose |
| --- | --- | --- |
| `-FoleviDevToken <jwt>` / `FOLEVI_DEV_TOKEN` | DEBUG | sign in with a development token |
| `-FoleviUITestReset YES` | all | wipe local cache and saved credentials on launch (UI tests) |
| `-FoleviForceOffline YES` | DEBUG | start with sync forced offline (also View ▸ Force Offline, ⌃⌥⌘O) |
| `-FoleviAppearance light\|dark` | DEBUG | override appearance |
| `-FoleviOpenDocument <id or title>`, `-FoleviSidebar tasks\|calendar\|daily\|trash` | DEBUG | open a view (screenshots) |
| `-FoleviAutomation offline-edit\|offline-conflict\|resolve-both\|export-all` | DEBUG | scripted verification scenarios through the real editor model and sync engine |
| `-FoleviLayoutProbe YES` | DEBUG | dump window/view geometry to the container's tmp dir |

## Tests

- **Unit** (`FoleviTests`, 53 tests; compiled against the Domain, Sync reducer, SQLite, Keychain and
  auth-callback sources, with no host app):
  - Rank golden cases and `sequence10`.
  - Document golden round-trip, byte-identical canonical JSON including the unknown `timeline` block.
  - All 9 sync scenarios with `expectedFinal` compared byte for byte.
  - SQLite CRUD and op-log durability across reopen.
  - Keychain wrapper.
  - Auth callback URL parsing and config placeholder detection.
  - Tree flatten, `rankForPosition` and `assignTreePositions` against TypeScript outputs.
  - Markdown/HTML export and Markdown import against TypeScript outputs.
  - Flexible Int decoding, JS number formatting, Daily Note ids.
- **UI** (`FoleviUITests`, 6 tests): sidebar navigation; creating a document and typing, with `# ` →
  heading and `[] ` → to-do; reordering with ⌥⇧↑/↓; menus exist; appearance switch; offline banner.

## Known limitations

- **Architecture**: ConvexMobile ships an arm64-only macOS slice, so the app builds arm64 only. Its
  static library objects are built for macOS 26.2, and the linker warns about the mismatch with the
  15.0 deployment target. The app has only been run on macOS 27; running on macOS 15 is untested.
- **Signing**: builds are ad-hoc signed ("Sign to Run Locally"). Distribution needs a Developer ID
  and notarization. Credentials use the legacy keychain; with a team id, the data-protection keychain
  plus `keychain-access-groups` would be preferable.
- **Auth0**: Auth0 isn't configured in this repo (placeholders). The Universal Login code path is
  written against Auth0.swift 3.1.0 but has not been exercised end-to-end.
- **Quick Add hotkey**: ⌃⌥Space is a menu shortcut, so it works only while Folevi is active (no
  global hotkey). The menu bar extra is always available.
- **Undo**: typing undo is per block. Structural undo (split, merge, indent, move, delete, convert,
  props) is document-wide. After a structural change the affected blocks' typing history is cleared.
- **Collaboration**: v1 sync is block-granular (see `docs/SYNC_PROTOCOL.md`). Concurrent edits to
  the same block produce a conflict, resolved with Keep Mine / Keep Theirs / Keep Both.
- **Collections**: rendered read-only (rows open their pages). Editing collection schemas, views or
  values is web-first. When offline, collections show "connect to load".
- **Online-only actions**: star, archive, trash/restore, duplicate, folder creation, sessions,
  comments, backlinks, version history and sharing lists need a connection and say so. Document moves
  between folders work offline.
- **Missing features**:
  - No `@mention` picker (mentions from other clients render and round-trip).
  - No image resize handles.
  - No syntax highlighting in code blocks.
  - No sharing or permissions UI (web).
  - Permanent deletion stays on the web.
- **Long documents**: the editor lays out all rows in a `VStack` (smooth for hundreds of blocks).
  Very large documents (thousands of blocks) would benefit from an `NSTableView`-backed list.
- **Offline gaps**:
  - A document never opened or pulled can't be opened offline (it shows a read-only "not available
    offline" state).
  - Starred and tag lists come from the server and are cached for offline use.
