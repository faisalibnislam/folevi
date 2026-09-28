# Folevi for Mac

The native macOS client: Swift 6 (strict concurrency) + SwiftUI, with AppKit where SwiftUI can't
deliver: `NSTextView` block editing, Quick Look, save/open panels, PDF rendering, the Finder drag-out.
It is not a web view, Electron or Catalyst app.

- Bundle id `com.folevi.mac`, deployment target macOS 15.0, App Sandbox (network client,
  user-selected files read/write, Downloads), hardened runtime.
- Swift package: `convex-swift` 0.8.1 (`ConvexMobile`). Sign-in uses the system's `AuthenticationServices`.
- Project: `apps/macos/project.yml` (XcodeGen). The generated `Folevi.xcodeproj` is committed, so
  building doesn't need XcodeGen.

## Build, run, test

```sh
# Debug build → apps/macos/build/Folevi.app, then launch it
script/build_and_run_macos.sh
script/build_and_run_macos.sh --release --no-launch               # Release build, staged only
script/build_and_run_macos.sh -- -FoleviForceOffline YES          # extra launch arguments after --

# Unit tests (no host app, no network)
xcodebuild -project apps/macos/Folevi.xcodeproj -scheme Folevi -destination 'platform=macOS' build test

# UI tests: need the local backend (npx convex dev on :3210) and a Convex token for a test account; they
# skip otherwise. They take over the keyboard and mouse while they run.
TEST_RUNNER_FOLEVI_UITEST_TOKEN=<token> \
  xcodebuild -project apps/macos/Folevi.xcodeproj -scheme FoleviUITests -destination 'platform=macOS' test
```

After editing `project.yml` or adding or removing source files, run `cd apps/macos && xcodegen generate`
(`brew install xcodegen`).

Helper scripts (in `apps/macos/scripts/`):

| Script | What it does |
| --- | --- |
| `packages/design-tokens/scripts/brand-icons.mjs` | Writes the app icon (`Assets.xcassets/AppIcon.appiconset`) and the in-app mark (`FoleviMark.imageset`) from the brand files in `packages/design-tokens/brand/source`, along with the web's icons. Run: `node packages/design-tokens/scripts/brand-icons.mjs`. |
| `generate-test-fixtures.mjs` | Bundles `packages/editor-schema` with esbuild and writes `FoleviTests/Fixtures/reference-outputs.json`: expected Markdown/HTML export, Markdown import, inline parsing, tree and number-formatting outputs from the TypeScript reference. Run with `node`. |
| `update-string-catalog.py` | Refreshes `Resources/Localizable.xcstrings` (English source strings) from the compiler's extracted `.stringsdata`. Run after a build. |

## Configuration

`apps/macos/Config/{Debug,Release}.xcconfig` → Info.plist keys → `AppConfig` at runtime.

| Setting | Debug | Release |
| --- | --- | --- |
| `FOLEVI_APP_URL` (sign-in pages and `/api/auth`) | `http://app.localhost:3000` (`pnpm dev`) | `https://app.folevi.com` |
| `CONVEX_URL` | `http://127.0.0.1:3210` | `https://fastidious-clownfish-123.convex.cloud` |
| ATS exception for `localhost` (and subdomains) / `127.0.0.1` | yes (Info.plist preprocessing, `FOLEVI_LOCAL_ATS`) | no |

Placeholder values are detected at runtime. The app says so honestly ("Folevi isn't configured for
sign-in yet" / "…isn't configured yet") instead of failing. URLs in xcconfig use `http:/$()/…`
because `//` starts a comment there.

## Auth

Folevi accounts, signed in through the browser with **Authorization Code + PKCE** (RFC 7636, the
native-app pattern of RFC 8252). The server side is `convex/lib/nativeAuth.ts`; see
`docs/AUTH_DECISION.md` → "Native apps".

1. **Sign In or Create Account** opens `<FOLEVI_APP_URL>/connect?client_id=folevi-mac&redirect_uri=
   com.folevi.mac://auth/callback&code_challenge=…&code_challenge_method=S256&state=…` in an
   `ASWebAuthenticationSession` sheet (`Features/Auth/AuthProviders.swift`, `WebSignIn`). It shares
   Safari's cookies, so someone already signed in there only presses **Continue**; otherwise they sign in
   (password, then two-step verification) or create an account first.
2. The page returns `com.folevi.mac://auth/callback?code=…&state=…`, which only the sheet receives (the
   scheme isn't registered with Launch Services). `AuthCallback.parse` accepts nothing else, and the
   `state` must match.
3. `FoleviAccountAuth` posts the code and the PKCE verifier to `/api/auth/native/token` and receives a
   **session of its own**: it's listed in Settings → Devices as "Folevi for Mac", counts toward the
   plan's device limit, and can be signed out from any device.
4. The session token is stored only in the Keychain (`folevi.session`). It's sent as
   `Authorization: Bearer …` to `/api/auth/convex/token` for 15-minute Convex JWTs, kept in memory and
   renewed when fewer than 120 s remain (ConvexMobile asks through `loginFromCache`). A 401 there means
   the session ended (signed out elsewhere, revoked, expired, password reset) and the Mac signs out.
5. **Sign Out** posts to `/api/auth/sign-out` with the bearer token and deletes it from the Keychain.

`RoutingAuthProvider` is the single `AuthProvider` given to the one process-wide
`ConvexClientWithAuth`. Besides Folevi accounts it has one DEBUG-only mode for UI tests
(`-FoleviDevToken <jwt>`), compiled out of Release.

Credentials live only in the Keychain (`Support/Keychain.swift`, legacy file keychain with the app's
default access group, so no provisioning profile is needed). `UserDefaults` holds only the non-secret
device id, the last profile id (which selects the local database) and view preferences.

After a token is in place, `users:me` routes the app: `needs_bootstrap` calls `users:bootstrap`
automatically, and `email_unverified`, `mfa_required`, `suspended`, `session_revoked` and
`device_limit` each get a dedicated screen (the device-limit screen links to Settings → Devices and
Plan & billing on the web). Onboarding has three steps (name the workspace, choose an appearance, open
Welcome). `users:registerSession({client:"mac"})` runs after sign-in, and a live `users:me`
subscription signs the Mac out if its session is revoked elsewhere.

## Architecture

```
Folevi/
  App/            FoleviApp (scenes: main WindowGroup, per-document WindowGroup(for: String), Quick Add
                  window, Settings, MenuBarExtra), AppModel (auth phase, session, documents, sync status),
                  NavigationModel (per window), FoleviCommands (menus), Automation (DEBUG only)
  Domain/         JSONValue (lossless JSON + JS-identical canonical output), flexible Int decoding, Rank,
                  Tree, RichText, WireBlock/Block, DocumentModels, Markdown (export + import), HTMLExport,
                  Tasks/Search helpers, ULID + deterministic Inbox/Daily ids, BlockDrop (drag-and-drop move math), Generated/ (read-only)
  Data/Local/     SQLiteStore (actor, system libsqlite3, WAL, versioned migrations)
  Data/Remote/    ConvexService (wraps the single client), API DTOs, repositories
  Sync/           SyncReducer (exact port of sync.ts), SyncEngine (actor), ConnectionMonitor
  Features/       Auth, Documents (sidebar, browser, windows), Editor, Tasks, Calendar, Search, Settings
  DesignSystem/   Generated tokens, FoleviFont (bundled Instrument Sans / Spectral / JetBrains Mono), Surfaces
                  (token shadow stacks as Core Animation shadow paths), components (pill buttons,
                  segmented control, chips, keycaps, sync pill, cards), canvas glow, window chrome,
                  cover art, the Folevi mark
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
The Inbox page (Quick Add's target) uses the deterministic id `inbox-<fnv1a64(profileId:workspaceId)>`,
identical to `packages/editor-schema`, so offline devices converge on the same page. (The older
`daily-<date>-…` helper is kept in Domain with its tests; the app no longer creates daily notes.)

### Look ("Warm Folio")

The Mac follows the web app's design system (`docs/DESIGN_SYSTEM.md`): same fonts, colors, radii,
shadows and layout vocabulary, drawn natively.

- **Fonts**: Instrument Sans (variable; weights set on its `wght` axis), Spectral and JetBrains Mono ship in `Resources/Fonts` (OFL licenses beside
  them), are registered at launch (`ATSApplicationFontsPath` + `FoleviFont.registerBundledFonts()`),
  and are used for every piece of product UI (`Font.ui/serif/mono`, `FoleviFont.nsFont` for the
  editor). The document font (sans/serif/mono) picks the family; editor zoom scales it.
- **Depth**: `foleviSurface(_:shape:shadow:)` / `foleviShadow(_:radius:)` render the layered
  `FoleviShadow` tokens (outer drops with spread, 1pt rings, inset top highlights) with CALayer shadow
  paths — CSS `box-shadow` semantics, cheap while scrolling. Increase Contrast adds a `lineStrong`
  ring.
- **Window**: full-size content under a transparent unified title bar (an empty `NSToolbar` gives the
  52pt band so the traffic lights sit centred). The canvas has two soft radial glows (flat under
  Reduce Transparency). Our own toolbar row: back/forward pill, breadcrumb (folder or Home › parents ›
  page), sync pill, comments, Share (Markdown), "…" menu, inspector toggle; list views show their
  primary action (New / Add Task). Drag the toolbar to move the window; double-click zooms.
- **Sidebar**: 264pt, sidebar tint; 32pt rows, the active row a raised pill with an ember icon; search
  pill with ⌘K; "New Document" pill; caps section labels; account/help/settings card. ↑/↓ move the
  selection when the list has focus.
- **Inspector**: a floating 320pt card (material unless Reduce Transparency) with six icon tabs —
  Insert, Format, Style, Outline, Info, Comments — and a heading with a close button.
- **Covers**: none, color, gradient (soft multi-glow in the page accent), or one of 20 abstract
  artworks (`Resources/Covers`, `cover.kind == .art`, value `art-01`…`art-20`; dimmed 18% in dark;
  unknown ids fall back to the gradient). The "Accent" page accent renders ember.

### Editor

- `EditorView`: a centered page sheet (surface, radius 22, sheet shadow; text column narrow 640,
  default 760 or wide 960 pt + 128pt padding; paper, plain, tinted or grid background) in a
  `ScrollView` + `VStack` of block rows. The cover sits inside the sheet's top, the icon on a raised
  rounded square overlaps it, and the title is a plain `BlockTextView` (40pt semibold, heading color).
  It has a conflict banner with a merge sheet and a find bar (⌘F).
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
- Block selection: Esc, ⇧-click, ⇧↑/↓, then Delete, ⌘D, ⌥⇧↑/↓, Tab and Return.
- **Drag and drop** (`BlockDrag.swift`, move math in `Domain/BlockDrop.swift`): hovering a block shows
  a small raised pill with "+" (add below) and a 6-dot grip (click = native block-options menu).
  Press the grip and move 4pt: the block and its children lift (a snapshot copy follows the pointer at
  1.02 scale, −0.6°, lift shadow; the source fades to 35%). An ember drop line with a ring at its
  leading edge glides (120ms) between rows; every 24pt of horizontal travel nests or un-nests (never
  shallower than the row below, at most one deeper than the row above). Near the scroll view's
  top/bottom 64pt the page auto-scrolls, faster closer to the edge. Release = one undoable move that
  syncs as a `position` change, then the block glows ember-soft for 700ms; Escape cancels and the
  copy glides back. Insert tiles drag into the page the same way (releasing outside cancels). A
  SwiftUI gesture only starts the drag; local NSEvent monitors drive it at the display's rate. Reduce
  Motion: no tilt/scale/glide, the line jumps, the glow is a static tint. Dropping Finder files inserts image/file blocks whose ops are
  held back (`blockedBy`) until the upload is finalized (`files:generateUploadUrl` → POST →
  `files:finalize`).
- Idle snapshots: `documents:createSnapshot` runs 2 minutes after the last acknowledged edit and when
  the editor closes. Version history (list, preview, restore) lives in a sheet.
- Inspector tabs: Insert (searchable tiles in Basics, Lists, Blocks, Media, Structure; click inserts
  below the current block, drag drops it where you want), Format (turn into, marks, color, highlight,
  callout tone, code language), Style (font, width, page background, card in lists, accent, cover
  incl. the art grid), Outline (headings; click to jump; the current section has an ember bar), Info
  (words, characters, reading time, blocks, dates, version history, backlinks, activity) and
  Comments.

### Other features

- **Sidebar**: New Document, Home, Tasks (today's count), Calendar, Shared with Me, Templates,
  Starred, Folders (drop documents on them to move; the move is a sync op, so it works offline), Tags,
  Archive, Trash, Settings and Help.
- **Browser**: cards, compact or list layout; sort by last edited, created or title; context menu
  (open in a new window, star, move, duplicate, archive, trash/restore).
- **Tasks**: Inbox, Today, Upcoming, All, Completed and My Tasks, derived locally from to-do blocks
  (so they work offline). Checking a task is a block edit.
- **Quick Add**: a panel (⇧⌘A, ⌃⌥Space while Folevi is active), the Tasks view's field and a menu bar
  extra. It appends a to-do to the person's **Inbox** page (`inbox-<fnv1a64(profileId:workspaceId)>`,
  identical to the web), creating it locally when missing and restoring it from the Trash when online.
  Daily Notes are no longer a feature; existing daily documents are ordinary pages in Home.
- **Calendar**: a month grid (one card) and agenda with tasks by due date. Dragging a task onto
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
| `-FoleviOpenDocument <id or title>`, `-FoleviSidebar tasks\|calendar\|trash`, `-FoleviInspector insert\|format\|style\|outline\|info\|comments` | DEBUG | open a view (screenshots) |
| `-FoleviAutomation offline-edit\|offline-conflict\|resolve-both\|export-all` | DEBUG | scripted verification scenarios through the real editor model and sync engine |
| `-FoleviAutomation drag\|drag-nest\|drag-cancel\|drag-tile [-FoleviDragHold s] [-FoleviDragDY pt]` | DEBUG | drives a block (or Insert tile) drag with posted mouse events through the drag controller, holds for screenshots, drops (or Escape-cancels), then undoes. Activates the app. |
| `-FoleviAutomation cover-art [-FoleviCover art-07]`, `cover-set -FoleviCover gradient:moss` | DEBUG | shows an art cover for a while and restores the original; sets a cover |
| `-FoleviLayoutProbe YES` | DEBUG | dump window/view geometry to the container's tmp dir |

## Tests

- **Unit** (`FoleviTests`, 68 tests; compiled against the Domain, Sync reducer, SQLite, Keychain and
  auth-callback sources, with no host app):
  - Rank golden cases and `sequence10`.
  - Document golden round-trip, byte-identical canonical JSON including the unknown `timeline` block.
  - All 9 sync scenarios with `expectedFinal` compared byte for byte.
  - SQLite CRUD and op-log durability across reopen.
  - Keychain wrapper.
  - Auth callback URL parsing, PKCE (RFC 7636 test vector), the /connect URL, config placeholder detection.
  - Tree flatten, `rankForPosition` and `assignTreePositions` against TypeScript outputs.
  - Markdown/HTML export and Markdown import against TypeScript outputs.
  - Flexible Int decoding, JS number formatting, Daily Note and Inbox page ids.
  - Drag and drop: gap from pointer, allowed depths, 24pt nesting, placement (sibling / first child /
    root), subtree moves, multi-block moves, refusing moves into a block's own subtree, no-op
    detection, a move against the reference tree fixture, and "a move is a `position` change".
- **UI** (`FoleviUITests`, 7 tests): sidebar navigation; creating a document and typing, with `# ` →
  heading and `[] ` → to-do; reordering with ⌥⇧↑/↓; dragging a block by its grip (and ⌘Z); menus
  exist; appearance switch; offline banner.

## Known limitations

- **Architecture**: ConvexMobile ships an arm64-only macOS slice, so the app builds arm64 only. Its
  static library objects are built for macOS 26.2, and the linker warns about the mismatch with the
  15.0 deployment target. The app has only been run on macOS 27; running on macOS 15 is untested.
- **Signing**: builds are ad-hoc signed ("Sign to Run Locally"). Distribution needs a Developer ID
  and notarization. Credentials use the legacy keychain; with a team id, the data-protection keychain
  plus `keychain-access-groups` would be preferable.
- **Sign-in**: the server side and the /connect page are covered end to end (`apps/web/e2e/native-auth.spec.ts`);
  the Mac's browser sheet needs a person at the keyboard and is tested by hand.
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
  - No sharing or permissions UI (web); the toolbar's Share button shares the page as Markdown.
  - No presence avatars in the toolbar (presence isn't synced to the Mac).
  - Permanent deletion stays on the web.
- **Long documents**: the editor lays out all rows in a `VStack` (smooth for hundreds of blocks).
  Very large documents (thousands of blocks) would benefit from an `NSTableView`-backed list.
- **Offline gaps**:
  - A document never opened or pulled can't be opened offline (it shows a read-only "not available
    offline" state).
  - Starred and tag lists come from the server and are cached for offline use.
