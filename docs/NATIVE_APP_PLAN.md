# Native Folevi for iPhone, iPad and Mac (2026-10-24)

**Status:** plan, not started. Nothing in this document has been built yet.

Everything outside the editor becomes native Swift in the iPhone, iPad and Mac apps: the app frame (bars,
tab bar, back swipe, the zoom from a card into its note, sheets, menus, the keyboard toolbar, startup), every
list screen, Settings, sharing, Quick Add, onboarding and sign-in, and the Foli AI chat. The note page (the
editor and everything drawn inside a note) stays the web app in a `WKWebView`. Data keeps one source of truth:
the web data layer (sync engine, offline outbox, E2EE, local mode, several places) runs in that web view and
native screens read and write through a typed bridge. There is no native data layer.

The plan also covers the owner's follow-up of the same day: a full copy of every note on the device, kept up to
date in the background, so any note opens instantly (section 11). Much of that ships before the native release
and helps the website, the PWA and today's hybrid apps too.

Related: `docs/IOS.md` (today's iOS app), `docs/IOS_POLISH_PLAN.md` (the hybrid polish, superseded in the apps
by this plan; section 12 says which parts), `docs/MAC_WEBKIT_PLAN.md` (the native Mac shell this builds on),
`docs/MAC_POLISH_PLAN.md`, `docs/MULTI_ACCOUNT_PLAN.md`, `docs/E2EE_DESIGN.md`, `docs/SYNC_PROTOCOL.md`,
`docs/LOCAL_MODE_PLAN.md`, `docs/DESIGN_SYSTEM.md`.

---

## 0. Owner decisions (2026-10-24, final)

- **Scope.** Native: the app frame (top bars, bottom buttons and tab bar, back swipe, the Craft-like zoom from a
  card into its note with iOS 18's native zoom transition, sheets, menus, keyboard toolbar, instant startup);
  list screens (Home with recent cards, the Catch me up / Your week card, All notes, folders including nested
  folders and folder cards, Starred, Shared with me, Changes, Drafts, search, Notifications, the account and
  place switcher, Tasks, Calendar); Settings, Templates, Archive, Trash, sharing, Quick Add, onboarding and
  sign-in. The editor and note pages stay web (`WKWebView`).
- **Data.** Native screens get their data from the existing web layer through the bridge. Sync, the offline
  outbox, E2EE and multi-account / places stay in JavaScript. No native data layer.
- **Platforms.** iPhone, iPad and Mac all get the native parts.
- **Rollout.** One big release.
- **Look.** iPhone feedback applies to iPad. Neutral chrome (white / near-black); notes carry the colour; a
  note's style colour never fills the top bar. Folevi's own look (Craft as the reference), not stock iOS, with
  native behaviours: sheets, menus, haptics, swipe actions, context menus, large titles done right. The
  assistant is "Foli AI". No in-app buying on iOS.
- **Background sync** (follow-up): a full on-device copy per place, delta-synced; sync while the app is closed
  (iOS background tasks plus silent pushes, the Mac's timed wake); prefetch on intent; attachments with a
  storage budget; E2EE stored encrypted at rest; respect Low Power Mode, Low Data Mode and cellular settings;
  "Keep all notes on this device" (default on) with storage shown, per place; server cost within the pricing
  and 30% margin rules. The cache and the offline outbox are the same local store.

These replace the 2026-10-22 decision to keep the iOS app hybrid and polish it (`docs/IOS_POLISH_PLAN.md`
section 6, the "ios-polish" notes): the owner chose native on 2026-10-24.

---

## 1. Where the code is today (what the plan builds on)

| Area | Today | Files |
| --- | --- | --- |
| iOS host | Capacitor `CAPBridgeViewController` subclass showing the bundled shell export from `capacitor://localhost` (`plugins.FoleviShell.bundled: true`); `window.foleviNative` and `window.foleviShell` through Capacitor plugins | `apps/ios/ios/App/App/FoleviViewController.swift`, `FoleviNativePlugin.swift`, `bridge.js`, `Native/Shell/FoleviShellPlugin.swift`, `Native/Shell/shell-bridge.js`, `capacitor.config.ts` |
| iOS native pieces | Alerts, pickers, haptics, keyboard frames, the lifted preview, key commands, deep links, push, background refresh, widgets, share extension, Spotlight, App Intents, document scanner, Apple sign-in, Face ID lock | `apps/ios/ios/App/Native/**`, `AppAndWidgets/`, `Widgets/`, `ShareExtension/`, `Shared/` |
| Shared Swift services | Library, Keychain, E2EE device keys, sign-in (`ShellAuth`), on-device Foli AI, places, cloud folders | `apps/ios/ios/App/Native/Shell/*.swift` (compiled into the Mac app by path, `apps/mac/project.yml`) |
| Mac host | AppKit + `WKWebView` on `app://folevi`, its own transport (`MessageRouter`, not Capacitor) answering the iOS method names (`ShellRouter`), native menus, title bar, Quick Add panel, Settings window (web content), status item, Sparkle, background places with timed wake, memory pressure | `apps/mac/Folevi/**`, macOS 15.0 deployment target |
| Web app | Next.js 16 static shell export; one catch-all route with a client router (`lib/app/router.tsx` `parseRoute`); the iPhone frame in the web layer (`components/iphone/*`, on only inside the iOS app on a phone-width window) | `apps/web/src/**` |
| Data layer | `FoleviClient` (`lib/convex/client.ts`): the Convex client in account mode, `LocalClient` in local mode, wrapped by `E2eeRouterClient` when E2EE is set up; one sync engine per account (`lib/sync/engine.ts`), the outbox for folders, moves, comments and collections (`lib/sync/outbox.ts`), pure overlays of queued changes (`lib/sync/overlays.ts`), last answers kept for offline (`lib/sync/queryCache.ts`), the per-account IndexedDB (`lib/sync/db.ts`, v3); E2EE spaces have a full replica fed by `e2ee.pull` and answered on the device by the local backend (`lib/e2ee/replica/*`) | |
| Server | Convex; `sync.pull` / `sync.pullJson` by scope cursor (`convex/sync.ts`), `sync.head`, APNs (`convex/apnsSend.ts`, `convex/lib/apns.ts`), REST API (`convex/restApi.ts`) used by widgets and extensions | `convex/**` |

Two facts shape the architecture more than any other:

1. **The whole data layer already sits behind one client interface** (`watchQuery`, `query`, `mutation`,
   `action`), with three implementations chosen per mode and space. A bridge that speaks in terms of that
   interface gets local mode, E2EE and Standard accounts for free.
2. **E2EE spaces already have exactly the "full copy on the device" design** the owner asked for: a replica
   fed by a cursor pull, answered by the local backend's handlers, with the engine's pending edits overlaid.
   Section 11 extends it to every space.

---

## 2. Architecture

### 2.1 The process and view model (chosen)

```
Folevi (iOS / iPadOS / macOS app process)
├── Native frame (UIKit on iOS, AppKit on Mac, SwiftUI inside both)
│   ├── tab bar / sidebar, navigation stacks, bars, sheets, menus, toolbar, tab strip
│   └── native screens (Home, lists, folders, Tasks, Calendar, search, Settings, Foli AI chat, ...)
│         │  typed bridge (EngineClient: queries with live subscriptions, commands, events)
│         ▼
├── Page View (one WKWebView per window, per open place)          <- the "engine" and the note page in one
│   ├── the bundled web export in "native chrome" mode (no web frame at all)
│   ├── the data layer: AccountGate / LocalGate, places, sync engine, outbox, replica, E2EE router
│   ├── lib/engine: the bridge's JavaScript side (view queries, commands, events)
│   └── the note page (DocumentView and its panels), shown only while a note is on screen
└── Shared services (Swift): ShellAuth, LibraryService, E2eeKeys, ShellPlaces, ShellAI, background pull
```

**One `WKWebView` per window does both jobs**: it is the engine that native screens query, and it is the note
page when a note is open. While a list screen is in front, the Page View sits behind the native root, attached
to the window (so WebKit doesn't throttle its timers or suspend it), invisible and not taking touches. Opening a
note moves the same view into the note's view controller.

Why one view and not a hidden engine plus an editor view:

- **One JavaScript context owns the data.** Today `DocumentView` writes through the sync engine in its own
  context and reads the engine's pending overlay synchronously. Splitting the engine from the editor would mean
  a second copy of the account state, IndexedDB coordination between two contexts for every keystroke, and
  cross-context locking of the replica. The website's multiple tabs already coordinate through Web Locks and
  `BroadcastChannel` (`lib/local/host.ts`), but making every edit cross that path would add latency to typing.
- **Memory.** A WebKit content process for this app is 60 MB empty and 125 to 175 MB with a note open
  (measured, `docs/MAC_WEBKIT_PLAN.md` section 14). A separate engine view costs a second process all day.
- **Startup.** One web export boots once; the note page code is already preloaded by Home today (step 4 of the
  Mac memory work keeps it that way on purpose).

Several windows (iPad scenes, Mac windows) each get their own Page View, as today's Mac windows each have a page.
The first view of a place takes the replica's Web Lock and hosts it; the others use it through
`BroadcastChannel` (the existing `lib/local/host.ts` executor), exactly as several Mac windows or browser tabs
do now. Native screens of a window always talk to their own window's Page View.

### 2.2 Alternatives considered

| Option | Verdict |
| --- | --- |
| **Engine in JavaScriptCore** (a `JSContext` with no web view) running the data layer | Rejected. JSC has no IndexedDB, no `fetch`/`WebSocket` (the Convex client needs a socket), no WebCrypto (E2EE needs X25519, Ed25519, AES-GCM, HKDF), no Web Locks or `BroadcastChannel`. Each would need a native polyfill, the storage would need a new adapter (the existing IndexedDB databases would not be readable, so upgrades would lose pending edits), and the editor would still need a web view holding a second copy of the state. |
| **Hidden engine `WKWebView` plus a separate editor `WKWebView`** | Rejected for the reasons above (two contexts, a second process, slower typing path). Kept as the fallback if a measured problem appears with the combined view (section 13, R3). |
| **A web view per screen** (each native-looking screen is still a page) | Rejected: it's today's app with more processes; startup, memory and feel are what the owner wants changed. |
| **A native data layer** (Swift models, a Swift sync client, SQLite) | Excluded by the owner's decision. It would be a second implementation of sync, E2EE, local mode and places; the retired native Swift client (tag `native-mac-archive`) is the record of why one implementation wins. |

### 2.3 Background places

- **Mac:** unchanged. Places no window shows keep their timed-wake runners (`App/BackgroundSync.swift`), which
  are Page Views without a window on `/place-sync`. With section 11 they also keep that place's replica current,
  so switching to it shows fresh data at once.
- **iPhone and iPad:** one place's Page View at a time (iOS gives a background app no running web view). Places
  that aren't open are synced by the native background pull (section 11.4), which only fetches and stores
  opaque pages for the place's Page View to take in when it next opens. The account switcher shows the other
  places from `ShellPlaces` plus each account's unread count (one small REST call per place, as the Mac does).
- Switching places on iOS loads the new place's Page View; the previous one is kept for 2 minutes (a quick switch
  back is instant), then released.

### 2.4 Memory budgets

Measured the way `docs/MAC_WEBKIT_PLAN.md` section 14 measures (`footprint` per process on the Mac,
`XCTMemoryMetric` and `footprint` on the Simulator and a device for iOS).

| Platform | Native process | Page View | Total target | Today, for reference |
| --- | --- | --- | --- | --- |
| iPhone, Home after launch | 45 to 70 MB | 90 to 120 MB (no note mounted) | at most 190 MB | web frame drawing every screen |
| iPhone, a note with a flowchart open | same | 130 to 200 MB | at most 270 MB | |
| iPad, one window, split view | 55 to 80 MB | as iPhone | at most 280 MB; each extra window adds at most 130 MB | |
| Mac, one window, idle on Home | 55 to 80 MB | 90 to 120 MB | at most 300 MB with GPU and networking | 375 to 411 MB (owner's install), 454 to 536 MB (realistic Debug setup) |
| Mac, background place between wakes | 0 | 0 | 0 | 0 (already) |

The Page View drops what it can when it isn't showing a note: the editor unmounts after 30 s on a list screen
(its code stays loaded), heavy block code is already loaded on demand, and the memory pressure path
(`lib/memoryPressure.ts`, `App/Memory.swift`) gets an iOS twin driven by
`UIApplication.didReceiveMemoryWarningNotification`. Native image caches (covers, thumbnails) are `NSCache`
bounded at 40 MB on iPhone and 80 MB on iPad and Mac, cleared on memory warnings.

If iOS ends the Page View's content process (memory pressure while in the background), the native screens keep
showing what they last had, the view reloads on return (about 0.6 s), and the subscriptions resubscribe.
Edits are never lost: the engine writes them to IndexedDB before any network call.

---

## 3. The bridge protocol

### 3.1 Transport

One transport for iOS and Mac, generalised from the Mac's `MessageRouter`:

- **JavaScript to native:** `window.webkit.messageHandlers.foleviEngine.postMessage(string)` carrying a JSON
  string (not an object, so Swift decodes `Data` with `JSONDecoder` off the main thread instead of walking an
  `NSDictionary`). Messages are batched: the engine flushes at most once per animation frame (or at once for a
  reply).
- **Native to JavaScript:** `WKWebView.callAsyncJavaScript("return __foleviEngine.handle(m)", arguments: ["m":
  json], in: nil, contentWorld: .page)`, which resolves with the reply.
- **Big payloads:** above 256 KB the existing `/_bridge/<id>` mechanism of `apps/mac/Folevi/App/AppScheme.swift`
  carries the body (POST in, one GET out). The iOS scheme handler gets the same route (section 9, N1).
- **Who may talk:** only the main frame of the app's own origin, as `MessageRouter` checks today. The host binds
  each Page View to its place; a message's `place` must match the view's or it is refused (`place_mismatch`).

### 3.2 Messages

```ts
// apps/web/src/lib/engine/protocol.ts (the source of truth; Swift is generated from it, 3.3)
type ToEngine =
  | { v: 1; id: string; kind: "hello"; app: AppInfo }                                    // handshake
  | { v: 1; id: string; kind: "watch"; sub: string; place: string; name: ViewName; args: unknown; window?: ListWindow }
  | { v: 1; id: string; kind: "unwatch"; sub: string }
  | { v: 1; id: string; kind: "window"; sub: string; window: ListWindow }                // scroll moved the window
  | { v: 1; id: string; kind: "query"; place: string; name: ViewName; args: unknown }     // once (search)
  | { v: 1; id: string; kind: "command"; place: string; name: CommandName; args: unknown }
  | { v: 1; id: string; kind: "editor"; name: EditorCommand; args?: unknown };

type FromEngine =
  | { kind: "reply"; id: string; ok: true; value: unknown }
  | { kind: "reply"; id: string; ok: false; error: { code: string; message: string; data?: unknown } }
  | { kind: "update"; sub: string; rev: number; value?: unknown; diff?: ListDiff; stale?: boolean }
  | { kind: "event"; name: EventName; data: unknown };

interface ListWindow { start: number; count: number }          // rows the native list wants (plus overscan)
interface ListDiff {
  total: number;                    // rows in the whole list
  order?: string[];                 // ids of the window in order, sent when it changed
  upsert?: Record<string, unknown>; // rows that are new or changed, by id (each carries a `h` content hash)
  remove?: string[];
}
```

- **Handshake.** `hello` returns `{ protocol: 1, build, schemaHash, features }`. The web export ships inside the
  app, so native and JavaScript are always the same build; the check is a guard against a stale export in a
  development build, and it fails loudly (`protocol_mismatch`).
- **Versioning.** `v` is the protocol's major version. Views and commands are added, never changed in place; a
  changed shape gets a new name (`notes.list2`). The generated Swift and the fixtures (3.8) fail CI when the TS
  types change without regeneration.
- **Subscriptions.** `watch` starts a live view; the first `update` carries the whole value (or the window of a
  list), later ones carry diffs. `rev` increases by one per update; a gap makes the native side ask for the
  whole value again (`watch` with the same `sub`). Native ends a subscription when its screen goes away
  (`unwatch`), and keeps the last value for a screen still in its navigation stack, with the subscription
  paused after 60 s off screen and resumed (a fresh full value) when the screen comes back. `stale: true` marks a
  value that came from the device's copy while the server hasn't answered yet (offline, starting up).
- **Big lists.** Lists are windowed: native asks for the rows around what's visible (plus 100 rows of overscan
  each way) and moves the window as the person scrolls. The engine keeps the full ordered id list per
  subscription and sends `order` only when the window's order changes, and `upsert` only for rows whose content
  hash changed. A 5,000-note All notes list costs one id list (about 130 KB, sent once) plus 200 rows; an edit
  to one note sends one row. Updates are coalesced per frame.
- **Commands** are the writes: `note.star`, `note.move`, `folder.create`, `task.complete`, ... (section 5
  lists them per screen). They go through the same paths the web uses (the sync engine, the outbox, the E2EE
  router, `noteActions.ts`), so they work offline and are sealed in encrypted spaces. A command replies when the
  change is applied locally (queued if offline), not when the server answered; the sync status says the rest.
- **Events** from the engine: `engine.ready`, `gate.changed` (which onboarding or lock screen to show),
  `sync.status`, `place.changed`, `toast` (with an optional undo command), `navigate.request` (a link inside a
  note to another note or screen), `note.ready`, `note.meta` (title, icon, place chip, star state for the bars
  and the tab strip), `editor.state` (marks and block type at the selection, undo/redo availability, for the
  keyboard toolbar), `editor.panel` (a web panel opened or closed), `memory.relieved`.

### 3.3 Typed Swift models (codegen)

- The view, command and event types live in `apps/web/src/lib/engine/protocol.ts`. View results are **view
  models shaped for screens** (`NoteCard`, `FolderNode`, `TaskRow`, `HomeSummary`, ...), not raw Convex
  documents, so server refactors don't ripple into Swift. Where a screen needs a server shape as is (many
  Settings sections), the type is declared as `FunctionReturnType<typeof api.module.fn>` in `protocol.ts`, still
  generated.
- `scripts/engine-codegen.mjs`: TypeScript compiler API, then `ts-json-schema-generator` to JSON Schema, then a
  small Swift emitter (Codable structs and enums with string raw values, optional for `?`, `[String: X]` for
  records) into `apps/native-kit/Sources/FoleviEngine/Generated/`. `pnpm engine:gen`; CI fails on stale output
  (the same rule as `pnpm tokens`).
- The same script emits `ViewName`, `CommandName`, `EventName` as Swift enums with their argument and result
  types attached, so `engine.watch(.notesList(view: .folder, folderId: id))` is typed end to end.

### 3.4 Latency targets

| Path | Target (iPhone 15, release build) |
| --- | --- |
| Native `query` round trip, a 50-row result | p50 under 4 ms, p95 under 12 ms |
| A data change in the engine to the native list redrawn | under one frame (8 ms on ProMotion) after the engine has the value |
| Tap on a swipe action or a star to visible change | under 50 ms (native updates optimistically, the engine's update confirms; a refused command rolls back with a toast) |
| Tap on a card to the zoom starting | under 100 ms (section 4.3) |

Measured with `os_signpost` intervals on both sides (`engine.call`, `engine.update`) and an XCTest performance
test per path (section 8).

### 3.5 Errors

Replies carry the server's own `ConvexError` codes unchanged (`not_found`, `forbidden`, `e2ee_unavailable`,
...) plus the bridge's: `engine_not_ready` (the Page View is still booting; native retries after
`engine.ready`), `place_mismatch`, `protocol_mismatch`, `unknown_view`, `invalid_args`, `page_gone` (the
content process ended; native waits for the reload). User-facing text comes from the web's existing messages
(`data.message`), so wording stays in one place.

### 3.6 Auth, sessions and places

- Nothing about sign-in changes. `ShellAuth` keeps each account's bearer session in the Keychain
  (`session.<user id>`); the Page View gets Convex tokens through `foleviShell` as now. Native screens never
  see a token. Only the background pull (section 11.4) asks `ShellAuth.convexToken(for:)` for one, as the
  widgets' REST calls already do.
- Every message names its place; the host routes it to that place's Page View and checks the binding
  (`ShellPlaces.acting`, as `ShellRouter` does on the Mac).
- Signing in, signing out, adding an account, switching places and choosing local mode are native screens that
  call engine commands or the shared Swift services, then the host reloads Page Views in the new place, as
  `Places.switchTo` does today.

### 3.7 E2EE across the bridge

- Decrypted titles, previews and text cross the bridge in memory only. Native keeps them in view models and
  image caches in memory, never on disk, with one exception below.
- **Launch snapshot** (section 4.6) for an e2ee-active place is sealed with the device's local storage key
  (section 11.6) before it is written, and is never written while the app lock is on and locked.
- When the app lock engages (`AppLock.swift`, `MacAppLock.swift`), native drops every view model and cache of
  encrypted content and shows the lock cover; the screens fill again from the engine after unlock.
- Spotlight, widgets and Handoff keep today's rules: no content from encrypted notes (titles of encrypted notes
  aren't indexed; widgets show counts and "Locked").

### 3.8 Contract tests

Fixtures in `apps/web/src/lib/engine/fixtures/*.json` (one per view, command and event, including edge cases:
empty, offline-stale, encrypted-locked, a 5,000-row window, diffs). TS tests (vitest) check each fixture against
the JSON Schema and that each view's selector produces it from seeded data (the local backend's `MemoryStore`).
Swift tests decode every fixture into the generated types and apply every diff fixture to a list store, checking
the result equals the fixture's expected rows.

### 3.9 Offline and "waiting to sync"

Every row that can wait carries `sync: "saved" | "waiting" | "failed" | "conflict"` (from the outbox's
`Waiting` and the engine's pending ops, `lib/sync/overlays.ts`). `sync.status` carries the global state from
`docs/SYNC_PROTOCOL.md` ("Saved", "Saving", "Offline" with the count, "Syncing", "Conflict", "Error") and the
replica's download progress per place (section 11). Native shows a small status in the bar (iPhone: under the
large title on Home; iPad and Mac: the sidebar's bottom), as `SyncStatus.tsx` does on the web.

### 3.10 Images, covers and card previews

- **Built-in theme covers** (`art-01` to `art-57`) come from the app bundle: the shell export already carries
  `covers/`, and the Cloudflare cost plan compresses them to about 8 MB. Native loads the 640 px WebP for cards
  and the 1600 px one for large cards, by theme key, with no bridge call.
- **Custom covers and images** come as short-lived signed links (`files.urls`, R2 per the 2026-10-23 plan); native
  downloads them with `URLSession` into the on-device attachment store (section 11.5) and draws from there. In an
  encrypted note, the engine decrypts and hands the bytes over the `/_bridge` body route into an in-memory
  `NSCache` only.
- **Card previews are drawn natively from text**, not snapshots. `documents.list` already returns `preview` as
  structured lines (`PreviewLine`: block type, text, level, checked, table rows; `components/views/DocumentCard.tsx`)
  plus `excerpt`, `style`, `cover` and the font type. Native lays them out with the note's page colours
  (`packages/design-tokens/src/palette.ts`, generated to Swift) and the font type's standard face. Snapshots
  were rejected: a WebKit snapshot per card costs memory and a render pass in the Page View, goes stale on every
  edit, blurs with Dynamic Type and can't be made accessible. Notes whose first block is visual (whiteboard,
  flowchart, chart, image) show the block's glyph and, for images, the image's thumbnail.

---

## 4. Navigation and transitions

### 4.1 iPhone

- `UITabBarController` with its system bar hidden, and Folevi's own floating capsule bar (Home, Tasks,
  Calendar on the left; Foli AI and + on the right, the shape `components/iphone/TabBar.tsx` has today). Each tab
  is a `UINavigationController`, so stacks per tab, state restoration and the system back swipe come for free.
  The capsule uses `UIGlassEffect` on iOS 26 and later and a `UIVisualEffectView` material below.
- Screens are SwiftUI views in `UIHostingController`s, except the large lists, which are `UICollectionView`s
  with compositional layout, diffable data sources and `UIHostingConfiguration` cells (smooth at 120 Hz with
  thousands of rows, which SwiftUI `List` doesn't guarantee on iOS 17).
- **Large titles done right:** the system large title (`prefersLargeTitles`) with Folevi's fonts set through
  `UINavigationBarAppearance` (Spectral 34 pt large, Instrument Sans semibold 17 pt inline), neutral background
  (white / near-black), a hairline only once content scrolls under it. Bar buttons are Folevi glyphs in plain
  circular buttons, not the system's tinted text.
- The tab bar steps away on a note, on the Foli AI chat and in Select mode, as today.

### 4.2 Opening a note (the zoom)

1. **Touch-down on a card** (or a row): native sends `editor` command `note.prepare { id }`. The Page View
   (hidden behind the native root) routes to `/d/<id>` in native-chrome mode and renders from the device's copy
   (section 11), then posts `note.ready { id }` after the first frame with the title and first blocks drawn. With
   the full copy this takes 30 to 80 ms; a tap lasts about 100 ms, so the note is usually ready at touch-up.
2. **Touch-up:** native pushes a `NoteViewController` that adopts the Page View as its content.
   - iOS 18 and later: `preferredTransition = .zoom(sourceViewProvider:)` with the card as the source, so the card
     grows into the note and the interactive dismiss (swipe down or from the edge) shrinks it back into the card.
   - iOS 17: a custom `UIViewControllerAnimatedTransitioning` that scales and crossfades from the card's frame,
     with the edge swipe as the interactive pop.
3. If `note.ready` hasn't arrived 150 ms after touch-up (a cold note, VoiceOver activation with no touch-down),
   the transition runs anyway over a native placeholder (the card's cover or the note's page colour, its title
   in place) that crossfades away on `note.ready`.
4. A touch-down that turns into a scroll leaves the prepared note in the hidden Page View; nothing is shown and
   the next prepare replaces it.

Note to note (a link inside a note): the engine sends `navigate.request { route }`; native snapshots the Page
View (`WKWebView.takeSnapshot`) into the current `NoteViewController` as a still, pushes a new
`NoteViewController`, and moves the Page View to it with `note.show`. Back swipe reveals the still; on pop the
Page View moves back and shows the previous note, with its scroll and selection restored
(`lib/app/noteViewState.ts` already keeps them per note). The web history stays one entry: every web
navigation in native-chrome mode is a replace, and WebKit's own back gesture is off.

### 4.3 The note screen's native chrome

- **Top bar** (neutral, never the note's colour): Back, the place chip (parent page, folder or Drafts; tapping it
  opens that place), and a pill with Share and the "..." menu (a `UIMenu`: star, move, copy to, duplicate,
  export, version history, present, print, archive, delete; actions run engine commands, or open web panels for
  the editor-bound ones).
- **Bottom buttons:** Comments, Style and Format on the left, Foli AI and Insert on the right, as native glass
  buttons. Each opens its tool, which stays a web panel in the Page View (`editor` command `panel.open`); the
  in-flight shared web sheet primitive draws it, and native hides its own bottom buttons while the engine says
  a panel is open.
- **Keyboard toolbar:** a native bar pinned to `keyboardLayoutGuide`, over the web view (not an
  `inputAccessoryView`, which would need swizzling WebKit's private content view): to-do, bullets, heading,
  outdent, indent, image, undo, redo, the Foli AI spark and put-away. Its buttons are `UIButton`s that never
  become first responder, so the editor keeps the keyboard. Each sends an `editor` command; `editor.state`
  lights the active ones. WKWebView's own input assistant bar is emptied (`inputAssistantItem` groups). The
  page keeps the caret above the toolbar with the bar's height passed in `editor.insets`.
- **Interactive keyboard dismissal** keeps `Native/UI/KeyboardBridge.swift`'s behaviour.

### 4.4 iPad

- `UISplitViewController` (double column): the native sidebar (places, Home, Tasks, Calendar, Foli AI, All
  notes, Drafts, Shared with me, Changes, Starred, folders as an outline with nested folders, tags, Templates,
  Archive, Trash) and a secondary column with the **native tab strip** on top (owner decision D2 keeps it) and
  a navigation stack below. Tabs hold any screen; a note tab shows the Page View.
- Compact width (Slide Over, a narrow Split View, under 700 pt) collapses to the iPhone layout, as the web does
  today.
- The note's inspector (outline, related, comments) stays web inside the Page View; native gives it room.
- Hardware keyboard: app commands (`Native/KeyCommands.swift`) go to native actions; editing keys stay with the
  web view.
- Several windows: each scene gets its frame and its Page View (2.1).

### 4.5 Mac

- `NSSplitViewController`: the sidebar (an `NSOutlineView` on the system's translucent sidebar material,
  decision M3, so drag and drop with nesting is AppKit's proven path) and the content: a native screen
  (SwiftUI in `NSHostingView`) or the Page View for a note.
- The native tab strip in the title bar area (Folevi look, the existing polish spec: `docs/MAC_POLISH_PLAN.md`
  section 3.3), the window buttons in their usual place (no more page-reported positions: `TitleBar.swift`'s
  page-driven layout goes for native screens).
- `Chrome/MainMenu.swift` targets native actions and engine commands; menu state comes from native screens and
  `editor.state`, not from the page's `setMenuState`.
- **Settings window** becomes native SwiftUI (`Chrome/SettingsWindow.swift` keeps the window and toolbar, the
  content is no longer `/settings/<section>?window=1`).
- **Quick Add panel** becomes a native SwiftUI field in `Chrome/QuickAddPanel.swift` (section 5.12).
- Window restoration (`Chrome/WindowRestore.swift`) restores native routes and tabs.

### 4.6 Startup

Target: under 0.5 s from tap to the last screen with cached data on an iPhone 15 and an M-series Mac.

1. At launch the native frame draws the last screen at once from the **launch snapshot**: the view-model values
   of the screens that were visible (the tab, its stack's top two screens, the first 40 rows of each list), saved
   by native when they last changed (at most every 2 s) in `Application Support/Places/<place>/launch.json`
   (file protection `completeUntilFirstUserAuthentication`; sealed for encrypted places, 3.7). This is a render
   cache of what was on screen, like the widgets' copy, not a data layer: it is never written back, and the
   engine replaces it.
2. In parallel the Page View boots the bundled export in native-chrome mode (0.2 to 0.6 s measured on the Mac
   spike) and opens the account's local store; the engine posts `engine.ready`; native subscribes and the live
   values replace the snapshot by id (no visual jump when nothing changed).
3. Taps before `engine.ready`: navigation works from the snapshot; opening a note shows the placeholder (4.2
   step 3) until the Page View has it; commands wait in a small native queue (at most 5 s, then a toast).

### 4.7 Deep links, restoration, Quick Add, Spotlight, Handoff

- `Native/DeepLinkRouter.swift` stops forwarding to the page: a Swift port of `parseRoute` maps `folevi://` and
  `https://app.folevi.com/...` paths to native routes (a shared fixture of paths keeps the two parsers equal,
  run by vitest and XCTest). Note routes open the note (4.2); unknown ones open Home.
- State restoration: each scene saves its tab, stacks (as routes) and the open note with scroll position
  (`NSUserActivity` / `stateRestorationActivity` on iOS, `WindowRestore.swift` on the Mac).
- Quick Add: 5.12. Spotlight and Handoff keep today's behaviour (`Native/SpotlightIndex.swift`; Handoff of a note
  becomes a native `NSUserActivity` with the note's URL). Richer Spotlight comes later.

---

## 5. Screen by screen

Legend: **N** native on iPhone, iPad and Mac; **W** stays web in the Page View. Views and commands are bridge
names (section 3); the Convex functions behind them are today's.

### 5.1 Gates, onboarding and sign-in (N)

| Screen today | Native | Bridge |
| --- | --- | --- |
| First launch, "Where should your notes live?" (`ModeChoice.tsx`) | Onboarding screen with the two choices, Sign in to Folevi highlighted | `gate.changed`, command `mode.choose` |
| Sign in / sign up / forgot / reset / two-factor / verify email (`app/(auth)/*`, `components/auth/*`, `ShellSignIn.tsx`, `AppSocialSignIn.tsx`) | Native forms; Google and Apple go straight to the provider (`ShellAuth.signIn(provider:)`, `AppleSignIn.swift`); email and password through `ShellAuth.fetch` to `/api/auth/*`; TOTP field with one-time-code autofill | commands `auth.*` (Swift services, not the Page View, since there's no session yet) |
| Onboarding (`Onboarding.tsx`, `OnboardingPreview.tsx`) | Native pages | `onboarding.state`, `onboarding.complete` |
| Local library setup / locked library (`LibrarySetup.tsx`, `LockedLibrary.tsx`, `LocalGate.tsx`) | Native: folder choice (iCloud or any folder, `UIDocumentPickerViewController` / `NSOpenPanel`), passphrase | `LibraryService` (Swift) plus `library.*` commands |
| Device limit (`DeviceLimit.tsx`), update required (`ShellUpdateGate.tsx`), migration (`MigrationGate.tsx`, `MoveBetweenModes.tsx`) | Native screens | `gate.changed` data |
| E2EE unlock, setup wizard, approve device, migration progress, recovery key (`components/e2ee/*`) | Native: unlock screen (in place of locked content), setup wizard steps, approve-device sheet, progress, recovery key with print (native print of the engine's PDF) | `e2ee.status`, commands `e2ee.unlock`, `e2ee.setup.*`, `e2ee.approve`, `e2ee.recoveryPdf` |
| Invite and share-invite pages (`InviteView.tsx`, `ShareInviteView.tsx`) | Native accept screens | `invite.preview`, `invite.accept` |
| OAuth consent for apps (MCP) (`OauthConsent.tsx`) | Native consent sheet | `oauth.request`, `oauth.decide` |

### 5.2 The frame (N)

Sidebar (`Sidebar.tsx`, `SidebarMenu.tsx`), workspace and account menu (`WorkspaceMenu.tsx`, `AccountSheet.tsx`),
the iPhone frame (`IphoneShell.tsx`, `Screen.tsx`, `RootBar.tsx`, `TabBar.tsx`, `Glass.tsx`, `transitions.ts`,
`tabStacks.ts`, `PullToRefresh.tsx`), the tab strip (`TabStrip.tsx`, `lib/app/tabs.tsx`), back and forward
(`BackForward.tsx`), the sync status (`SyncStatus.tsx`), toasts (`ui/Toast.tsx`), the context menu layer
(`AppContextMenu.tsx`), the drop layer (`FolderDropLayer.tsx`), Mac commands (`MacCommands.tsx`,
`MacPolish.tsx`, `DesktopBridge.tsx`).

Bridge: `places.list`, `place.current`, `profile`, `sidebar` (`organization.sidebar` with overlays), `counts`
(drafts, tasks, changes, reviews, proposals, unread), `sync.status`; commands `place.switch`, `tab.*` (native
owns tabs; the engine only needs `note.show`).

### 5.3 Home (N)

`HomeDashboard.tsx` / `IphoneHome.tsx`: the avatar (account and places), notifications and More; "Home" with the
place under it; the search field; **recent notes as cards** (horizontal row on iPhone, grid on iPad and Mac);
**Catch me up / Your week** card (`CatchUp.tsx`, `ai.brief`, Foli AI on); rows with counts (All notes, Drafts,
Shared with me, Changes, Reviews); Starred; Folders (folder cards, nested); Tags (folded); Templates, Archive,
Trash.

Bridge: view `home` (`documents.recentNotes`, `organization.recentFolders`, `organization.index`,
`organization.draftCount`, `changes.list` count, `proposals.count`, `study.summary`, `documents.list` starred),
action `ai.brief`. Interactions: long-press menus on cards (native context menu with the card itself as the
lifted preview), drag a card onto a folder card, pull to refresh (`engine.refresh`: re-pull now), the zoom into
notes.

### 5.4 Note lists (N)

All notes, Drafts (`unsorted`), Starred, Archive, Trash, Templates, a folder, a tag (`DocumentBrowser.tsx`,
`NoteList.tsx`, `DocumentCard.tsx`, `SelectionBar.tsx`, `useCardSelection.ts`, `noteActions.ts`).

- Cards or List, sort (updated, created, title, manual), a filter field over what's loaded, Select mode.
- Swipe: right to star, left to archive or delete (a long swipe deletes, with a warning haptic). Trash: restore,
  delete forever, Empty Trash with confirmation (`documents.emptyTrash`, `trashSummary`).
- Multi-select: tap in Select mode, two-finger pan on iOS, Shift and Command clicks on the Mac; the selection bar
  has Move, Copy to, Star, Archive, Delete.
- Manual sort: drag to reorder (`documents.reorder`).
- Templates: built-in and own (`settings.builtInTemplates`), "Use template" (command `note.createFromTemplate`).
- Bridge: view `notes.list { view, folderId?, tagId?, sort }` windowed; commands `note.star`, `note.archive`,
  `note.trash`, `note.restore`, `note.deleteForever`, `note.duplicate`, `note.move`, `note.copyTo`,
  `notes.bulk`, `note.reorder`, `trash.empty`, `note.create { folderId?, templateKey? }`.

### 5.5 Folders and tags (N)

Folders index and tags index (`OrganizeIndex.tsx`), folder cards (`FolderCard.tsx`, `FolderCardArt.tsx`,
`FolderBadge.tsx`, `ui/FolderGlyph.tsx`), folder menu and colour (`FolderMenu.tsx`, `FolderColorDialog.tsx`), new
folder (`NewFolderSheet.tsx`), move dialogs (`MoveToFolderDialog.tsx`, `CopyToDialog.tsx`, `doc/MoveNoteDialog.tsx`,
`doc/MovePageDialog.tsx`), drag logic (`lib/app/folderDrop.ts`, `noteDrag.ts`, `dragSession.ts`, `folders.ts`).

- A folder's screen lists its subfolders (cards) above its notes. Nested folders to any depth.
- Drag and drop: notes onto folders, folders into folders (nesting), with spring-loaded folders (hover 0.6 s
  opens it) on iPad and Mac, drop indicators in ember, and the same rules as `folderDrop.ts` (no folder into its
  own descendant; scope rules from `docs/SYNC_PROTOCOL.md`). iOS: `UICollectionViewDragDelegate` /
  `UIDropInteraction`; Mac: `NSOutlineView` and `NSCollectionView` pasteboard. Items carry a Folevi type
  (`com.folevi.note-ref`, `com.folevi.folder-ref`) and a plain URL so a note dropped into the editor becomes a
  page link and a note dropped into another app is its link.
- Bridge: views `folders.tree`, `tags.list`; commands `folder.create`, `folder.rename`, `folder.move`,
  `folder.setColor`, `folder.delete`, `tag.update`, `tag.delete` (all through the outbox, so offline works).

### 5.6 Shared with me, Changes, Notifications (N)

- Shared with me (`SharedView.tsx`): view `shared.list` (`sharing.sharedWithMe`).
- Changes (`ChangesView.tsx`): what others changed, per note, with proposals to accept or reject and undo. The
  change detail that shows the note's changed blocks renders in a web panel (it is note content); the list,
  counts and accept/reject/undo are native. Views `changes.list`, `proposals.list`; commands `changes.markSeen`,
  `changes.undo`, `proposal.accept`, `proposal.reject`.
- Notifications (`NotificationsButton.tsx`): a native sheet on iPhone, a popover on iPad and Mac; mark read,
  unread, remove, accept invites inline. View `notifications.list`, `notifications.unread`; commands
  `notification.*`, `invite.accept`, `pageInvite.accept`.

### 5.7 Search (N)

The command palette (`CommandPalette.tsx`, `SearchScopes.tsx`): a native search screen (iPhone full screen,
iPad and Mac a centred panel with Command-K) with scopes (this place, everywhere), recent notes before typing,
results as rows with the matched text, search by meaning when available, and commands (New note, go to ...).
Bridge: `query` `search { text, scope, meaning }` debounced 120 ms (`search.documents`, `search.everywhere`,
`search.byMeaning`, `search.meaningAvailable`, answered on the device for spaces with a full copy), view
`recent`.

### 5.8 Tasks and Calendar (N)

- Tasks (`TasksView.tsx`, `Tasks.tsx`, `TaskSheet.tsx`, `QuickAddTask.tsx`, `QuickAddSheet.tsx`): views as chips
  (Inbox, Today, Upcoming, All, Completed, Mine), grouped by note with folding headers, Upcoming by day;
  details sheet; check off; swipe right to complete, left to move to tomorrow or pick a date (native date
  picker); assignees in workspaces. Views `tasks.list { view }`, `tasks.counts`, `members`; commands
  `task.create` (natural language dates parsed by the engine's `nlDate.ts`, so the rules stay in one place),
  `task.update`, `task.complete`, `task.moveToNote`.
- Calendar (`CalendarView.tsx`, `CalendarWeek.tsx`, `Agenda.tsx`, `WeekStrip.tsx`, `calendarLayout.ts`,
  `CalendarSubscriptions.tsx`, `CalendarFeedDialog.tsx`): the agenda with the week strip and pull-down month
  (owner decision D4), Week and Month on iPad and Mac, subscribed calendars' events, add a task on a day,
  calendar feeds and subscriptions in a sheet. Views `tasks.range`, `calendars.events`; commands for feeds and
  subscriptions. The daily note is a note (W).

### 5.9 Foli AI chat (N, decided)

**Decision: the Foli AI chat is native; the note's own Foli AI panel and the inline editor AI stay web.**

Why native: the chat opens from the tab bar (and the sidebar, and Command-J) over every screen, including native
lists. A web chat would need the Page View, which may be showing a note underneath, or a second web view (60 to
100 MB and a 0.3 s boot every time). The chat is a list of messages plus a composer, a natural native screen,
and the streaming already arrives as a reactive query (`aiChat.streamText`), which the engine relays as an
ordinary subscription, so streaming costs nothing new. E2EE chats (`SealedChat.tsx`, the router's `ai` route)
are the engine's business; native sees plaintext in memory only.

What it covers (`components/ai/chat/*`, `AiView.tsx`, `AskAiPanel.tsx`, `AiMarkdown.tsx`, `AiDiffView.tsx`,
`AiCredits.tsx`, `AiIntro.tsx`, `AiUnavailable.tsx`): conversation list (pinned, rename, delete, share), a thread
with streaming text revealed word by word (`useAiStream.ts`'s pacing, reduced motion shows all), markdown
(Apple's `swift-markdown` parser into Folevi-styled SwiftUI: headings, lists, tables, code, links to notes),
context chips (this note, a folder, the web toggle), attachments (photos, files, the document scanner), cards
(actions with Apply, agent runs, research, save memory, search suggestions), the edit-proposal diff drawn from
the engine's `aiDiff` output, credits and the unavailable states, the consent prompt for encrypted content.
Views `ai.conversations`, `ai.conversation { id }`, `ai.stream { messageId }`, `ai.capabilities`; commands
`ai.send`, `ai.stop`, `ai.regenerate`, `ai.edit`, `ai.rename`, `ai.pin`, `ai.remove`, `ai.saveAsNote`,
`ai.applyActions`, `ai.consent`.

The note's Foli AI tool (bottom button on a note) opens the web panel inside the Page View, as now (W). No
purchase surfaces on iOS: credits show usage only (`canPurchaseHere()` keeps answering false on iOS; the Mac
opens the website for packs, as today).

### 5.10 Settings (N)

Every section of `SettingsView.tsx` and `components/views/settings/*`, built the way `SettingsKit.tsx` already
models iOS Settings (inset grouped, pushed choice screens), now native: Account (`AccountSection`,
`SignInMethods`, `IdentityImageField`, `DeleteAccountCard`), Foli AI (`AiSection`, `AiUsage`, `AiMemory`,
`AiRoutines`, `AiDigest`, `AiExport`, `LocalAiSection`), Plan and billing (`BillingSection`, `PlanRow`,
`BuyCreditsDialog`: usage only on iOS, the website for changes on the Mac), Security (`SecuritySection`, passkeys,
two-factor), Privacy and encryption (`PrivacySection`, `e2ee/PrivacyPanel`, `RecoveryKeyPanel`,
`EncryptionDevices`, `LowerLevelDialog`, `WhatEachChoiceMeans`, `LockDialog`, `TouchIdCard`), Devices
(`DevicesSection`), Connected apps (`ConnectedAppsSection`, `ApiTokens`, `Webhooks`, `EmailToNote`,
`SaveFromAnywhere`), Appearance (`AppearanceSection`), Notifications (`NotificationsSection`, `PushCard`,
`NativePushCard`), Workspace (`WorkspaceSection`, `MembersSection`, `GuestsSection`, `WorkspaceBillingSection`,
`WorkspacePrivacySection`, `DataSection`), Sync (`SyncSection`), Library (`LibrarySection`), This device
(`ThisDeviceSection`, gains the storage settings of section 11.8), Desktop (`DesktopSection`, Mac only), Help
and support (`HelpView.tsx`, `support/SupportForm.tsx`), takeout (`places/TakeoutCard.tsx`), moving places
(`places/MovePlaces.tsx`). New workspace and invite dialogs (`NewWorkspaceDialog.tsx`, `InviteDialog.tsx`).

Bridge: one view per section (`settings.account`, `settings.ai`, ...) typed from the server's return types;
commands per setting. Section 14, Q1 asks whether a few developer sections may stay web for this release.

### 5.11 Sharing (N)

`doc/ShareDialog.tsx`, `e2ee/PublishCopyDialog.tsx`, `ShareSheet.tsx`: people and access (grant, revoke, access
mode), public link with its theme (`sharing.setPublicLinkTheme` picks from previews drawn natively from the
theme palette), page invites, publish-a-copy for encrypted notes, the system share sheet for the link. Views
`sharing.get { documentId }`; commands `sharing.*`. Opened from the note's Share button and from list menus.

### 5.12 Quick Add (N)

- iPhone and iPad: the + menu's Quick task and New note (`QuickAddSheet.tsx`) as native sheets.
- Mac: `QuickAddPanel.swift` keeps the panel and its keyboard behaviour; the field is native SwiftUI. Saving goes
  to the Quick Add place's engine: its Page View if open, else a runner woken on demand (the existing mechanism,
  with keys buffered while it starts); offline with no engine, the shared `LocalActions` queue and REST path that
  the iOS extensions use (`Shared/SaveTargets.swift`, `PlaceOutbox` in `Native/BackgroundRefresh.swift`) moves
  into the shared package for the Mac too.
- Widgets, the share extension, Siri and Shortcuts are already native and stay as they are.

### 5.13 Stays web (W)

The note page and everything in it: `doc/DocumentView.tsx`, the editor (`components/editor/**`), its panels
(Format, Insert, Style and themes `ThemeGallery.tsx`, Comments, Inspector, Outline, Related, Version history,
Find, export preview), the note's Foli AI panel and inline AI (`AskAiChat` inside a note, `InlineAi.tsx`,
`TranslateNote.tsx`, `StudyMode.tsx`), presentation (`components/present/*`), the daily note, a folder's or note's
read-only views for guests. Also, by this plan's recommendation (Q2): **Reviews** (`ReviewView.tsx`,
flashcards render note content) and **Graph** (`GraphView.tsx`, a canvas) open in the Page View like a note, with
native bars.

### 5.14 Parity checklist

`apps/web/src/lib/engine/parity.ts` lists every user action of the web's non-editor screens (each menu item,
swipe, button, shortcut, setting) with its native owner screen and status; a vitest test fails when a web action
has no entry, and the native UI tests check each "native" entry exists by accessibility identifier. The list
starts from `noteActions.ts`, the menus in `FolderMenu.tsx` and `AppContextMenu.tsx`, `MacCommands.tsx`,
`lib/shortcuts.ts` and every Settings control. Nothing ships while an entry is "missing".

---

## 6. Shared Swift code

### 6.1 The package

`apps/native-kit/` (Swift Package, Swift 6, strict concurrency), used by `apps/ios` and `apps/mac`:

| Target | Platforms | Holds |
| --- | --- | --- |
| `FoleviEngine` | iOS, macOS | protocol envelope, generated models (3.3), `EngineClient` (watch, query, command, events), list stores with diff application, the launch snapshot store |
| `FoleviBridgeHost` | iOS, macOS | the transport (`MessageRouter` generalised from the Mac), the scheme handler with `/_bridge`, the Page View factory and lifecycle (attach, reparent, reload on content process end, memory relief) |
| `FoleviServices` | iOS, macOS | today's `apps/ios/ios/App/Native/Shell/*.swift` (moved, not rewritten), `SaveTargets`, `LocalActions`, `FoleviAPI`, background pull (section 11) |
| `FoleviDesign` | iOS, macOS | tokens (generated), fonts and registration, colours, type scale, components (section 7) |
| `FoleviScreens` | iOS, macOS | SwiftUI screens and their view models (Home, lists, folders, tasks, calendar, search, notifications, settings, chat, sharing, onboarding) |
| `FoleviPhone` | iOS | UIKit frame: tab bar, navigation, zoom transitions, `NoteViewController`, keyboard toolbar, sheets with `UISheetPresentationController` detents, context menus, collection view lists |
| `FoleviMac` | macOS | AppKit frame: split view, sidebar outline, tab strip, toolbar, windows, Settings window content, Quick Add field |

### 6.2 Platform adaptations

- **iOS:** UIKit for the keyboard toolbar, sheets (`UISheetPresentationController` with medium and large
  detents, grabber, custom corner radius 28 = `sheet` token), zoom transitions (iOS 18 gated, 4.2), context
  menus (`UIContextMenuInteraction` with targeted previews of the real card view, which retires the snapshot
  workaround in `Native/UI/LiftPreview.swift`), swipe actions (`UICollectionLayoutListConfiguration`
  swipe providers with Folevi-styled actions), haptics (`Native/UI/Haptics.swift` moved).
- **Mac:** AppKit windows and `NSSplitViewController`, `NSOutlineView` sidebar, `NSToolbar`, the existing menus,
  `NSPopover` for notifications, the Settings window. SwiftUI fills content areas.
- **Minimum OS:** iOS 17 (today's `IPHONEOS_DEPLOYMENT_TARGET = 17.0`), with iOS 18 features (zoom transition,
  `UITab` APIs if used) and iOS 26 materials (`UIGlassEffect`) behind `#available`. macOS 15 (today's
  `project.yml`), macOS 26 materials gated. `@Observable` (iOS 17, macOS 14) is the model layer.
- The Capacitor dependency goes (section 9, N1): iOS gets the Mac's transport, so both platforms answer
  `foleviShell` and `foleviNative` the same way, through one router.

---

## 7. Design system in Swift

- **Tokens:** `packages/design-tokens/src/tokens.json` gains a Swift output in `pnpm tokens`
  (`generated/Tokens.swift` copied into `FoleviDesign`): colours as light/dark pairs (`UIColor(dynamicProvider:)`
  / `NSColor(name:dynamicProvider:)`), with the **neutral chrome** values of `docs/DESIGN_SYSTEM.md` ("Neutral app
  chrome") as the app's chrome palette and ember for small signals; radii (container 18, panel 14, control 10,
  small 8, chip 6, tiny 4, float 40, sheet 28, capsule); spacing; shadows as layer stacks (`hairline`, `control`,
  `card`, `pop`, `lift`); motion curves and durations from `docs/IOS_POLISH_PLAN.md` section 2.4. Note palettes
  from `palette.ts` generated the same way. The contrast check covers the Swift output too.
- **Fonts bundled:** Instrument Sans (UI and body), Spectral (titles, large UI, note titles, card titles, folder
  names), JetBrains Mono (code), all under the SIL Open Font License; registered with
  `CTFontManagerRegisterFontsForURL`. Card previews also bundle the font types' standard faces (Inter for
  Modern, Spectral for Serif, JetBrains Mono for Mono, the system rounded face for Soft); a theme's alternative
  family is drawn with its type's standard face in cards (same x-height rule as the web's `font-size-adjust`).
- **Dynamic Type:** every style is `Font.custom(_:size:relativeTo:)` / `UIFontMetrics`-scaled; layouts are
  tested at the largest accessibility sizes (cards switch to a single column, rows wrap).
- **Components** (`FoleviDesign`): note card (cover, title, preview lines, footer), folder card (art from
  `FolderCardArt` rules, name always visible, counts), list row (icon, title, subtitle, accessory, swipe), section
  header, chip, segmented control (track 10 + thumb 6 nesting), primary and secondary buttons (light
  skeuomorphism per the system: faint top highlight, soft cast), text field, search field, empty state, toast,
  glass capsule, tab bar item, sheet header, badge, avatar (6 radius, nothing fully round outside the iPhone
  glass), checkbox (rounded square, decision D3), date chip, sync status pill.
- **Accessibility:** VoiceOver labels and traits for every control and card (cards read title, place, edited
  time, preview first line), custom actions for swipe and menu actions, rotor headings; Reduce Motion replaces
  the zoom with a crossfade and turns off parallax; Reduce Transparency makes glass solid; Increase Contrast uses
  the strong line and ink tokens; Full Keyboard Access on iPad and Mac; hit targets at least 44 pt on touch.
  An accessibility audit (`XCUIApplication.performAccessibilityAudit`, iOS 17) runs in UI tests per screen.

---

## 8. Web side changes

All behind one switch, so **the website is unchanged**:

- **Native chrome mode.** The host's bootstrap script sets `<html data-native-chrome>` and
  `window.__foleviNativeChrome = { platform, protocol: 1 }` before the first paint; `lib/nativeApp.ts` gains
  `nativeChrome()`. In this mode `components/app/Shell.tsx` renders `NativeContentShell`: the providers
  (`AccountGate`, `LocalGate`, places, sync, E2EE, themes), `EngineHost`, and the route only when it's a note,
  daily note, Reviews or Graph. Not rendered: `Sidebar`, `TabStrip`, `IphoneShell` and everything in
  `components/iphone` except what the note page itself uses, `CommandPalette`, `NotificationsButton`, the floating
  `AskAiChat`, toasts (sent as `toast` events), onboarding and gate screens (sent as `gate.changed`), every dialog
  section 5 makes native. A new route head `native` (`lib/app/routes.ts`) is the idle state: providers and engine,
  nothing drawn.
- **`lib/engine/`** (new): `protocol.ts`, `host.tsx` (`EngineHost`, registers `__foleviEngine`), `views/*.ts`
  (one module per view: pure functions over `client.watchQuery(ref, args)` results, the outbox overlays and the
  query cache's kept answers for offline cold starts), `commands.ts`, `editorCommands.ts`, `diff.ts`,
  `fixtures/`, `parity.ts`. Logic that today lives inside React components (Home's composition in
  `IphoneHome.tsx` and `HomeDashboard.tsx`, list sorting and grouping in `DocumentBrowser.tsx`, task grouping in
  `Tasks.tsx`) moves into pure modules that both the components and the engine call, which keeps the website and
  the apps in step.
- **Editor command API** (`editorCommands.ts`, used by the native keyboard toolbar, bars and menus): `format
  { mark | block }`, `insert { kind }`, `undo`, `redo`, `indent`, `outdent`, `dismissKeyboard`, `panel.open
  { format | insert | style | comments | ai | outline | history | find | inspector }`, `panel.close`, `ai { action
  }`, `note.menu { id }` (editor-bound note menu actions), `scrollToTop`, `insets { top, bottom }` (the native bars'
  sizes so content and caret stay clear), `note.prepare`, `note.show`. The in-flight web keyboard toolbar already
  calls most of these handlers; they move behind this API.
- **Note-ready signal:** `DocumentView` posts `note.ready` after the first frame with the title and first blocks
  drawn from the device's copy (a `requestAnimationFrame` after commit).
- **Links:** in native chrome mode, `AppLink` and note links call `navigate.request` instead of the router, except
  inside the note page (anchors, blocks, comments).
- **Mac and iOS share the mode;** the Mac's page-driven chrome code (`DesktopBridge.tsx` window button reports,
  drag areas, `setMenuState`) stays for nothing but the note page's own needs and goes where native replaces it.

---

## 9. Work packages

Sizes are in focused engineer-days (S 2 to 3, M 4 to 6, L 8 to 12, XL 15 to 20). Each package names the files it
owns; two packages never own the same file. Shared files that several packages must touch
(`apps/web/src/lib/engine/protocol.ts`, `apps/native-kit/Package.swift`, `apps/ios` and `apps/mac` project files)
have one owner each (named below) who merges others' additions.

### Foundation (weeks 1 to 2)

| WP | What | Owns | Size | Depends on |
| --- | --- | --- | --- | --- |
| **N0** Package and codegen | `apps/native-kit` package and targets; move `Native/Shell/*.swift`, `SaveTargets`, `FoleviAPI`, `LocalActions`, `Haptics` into `FoleviServices` (iOS and Mac projects reference the package); `scripts/engine-codegen.mjs`; Swift output of `pnpm tokens` | `apps/native-kit/Package.swift`, `apps/native-kit/Sources/FoleviServices/**`, `scripts/engine-codegen.mjs`, `packages/design-tokens/scripts/*` | M | none |
| **N1** iOS host without Capacitor | New iOS app container (`SceneDelegate`, root controller) hosting the native frame and the Page View; serve the export at **`capacitor://localhost`** with an own `WKURLSchemeHandler` (same origin, so IndexedDB, localStorage and sessions carry over); port `FoleviNativePlugin`, `FoleviShellPlugin` and the four Capacitor plugins in use (App: `appUrlOpen`; Keyboard; Haptics; StatusBar) to the shared router; App-Bound Domains kept | `apps/ios/ios/App/App/**`, `apps/ios/capacitor.config.ts` (retired), `apps/native-kit/Sources/FoleviBridgeHost/**`, `bridge.js` and `shell-bridge.js` transport parts | L | N0 |
| **N2** Engine (web) | `lib/engine/**`: protocol, host, the view and command framework, diffing, fixtures, the first views (`home`, `notes.list`, `folders.tree`, `sync.status`, `places.list`); native chrome mode in `Shell.tsx`, `lib/nativeApp.ts`, `lib/app/routes.ts` | `apps/web/src/lib/engine/**` (owner of `protocol.ts`), `components/app/Shell.tsx`, `lib/nativeApp.ts`, `lib/app/routes.ts` | L | none |
| **N3** Engine client (Swift) | `FoleviEngine`: `EngineClient`, list stores, launch snapshot, signposts, Swift contract tests | `apps/native-kit/Sources/FoleviEngine/**` | M | N0, N2 protocol draft |
| **N4** Design system | `FoleviDesign`: tokens, fonts, components, previews gallery screen for snapshot tests | `apps/native-kit/Sources/FoleviDesign/**` | L | N0 |
| **R1** Full copy, web side (section 11) | Replica for Standard spaces, pull v2, prefetch on intent, store unification with the outbox | `apps/web/src/lib/sync/replica/**` (new), `lib/e2ee/replica/*` (generalised), `convex/sync.ts` (pull v2), coordination on `lib/sync/db.ts` with the outbox owner | XL | outbox work landed |

### Vertical slice (weeks 3 to 4)

| WP | What | Owns | Size | Depends on |
| --- | --- | --- | --- | --- |
| **N5** iPhone frame | Tab bar, navigation, large titles, `NoteViewController`, zoom (iOS 18) and fallback (iOS 17), native note bars, keyboard toolbar, sheets, context menu and swipe plumbing, deep link router port, state restoration | `apps/native-kit/Sources/FoleviPhone/**`, `apps/ios/ios/App/Native/DeepLinkRouter.swift`, `KeyCommands.swift` | XL | N1, N3, N4 |
| **N6** Editor command API and note-ready (web) | `editorCommands.ts`, `note.ready`, `navigate.request`, insets, panels opened by command, web history as replace-only in native chrome | `apps/web/src/lib/engine/editorCommands.ts`, `components/doc/DocumentView.tsx` (native-chrome hooks only), `components/editor/EditorMenus.tsx` (hooks only) | M | N2 |
| **N7** Home and lists | Home (cards, Catch me up / Your week, counts, starred, folders, tags), note lists with cards and list modes, sort, filter, swipe, Select mode, Templates, Archive, Trash | `apps/native-kit/Sources/FoleviScreens/Home/**`, `.../Lists/**` | XL | N3, N4, N5 |
| **N8** Mac frame | `NSSplitViewController`, sidebar outline, native tab strip, toolbar, menus wired to native actions, Page View hosting, window restoration of native routes | `apps/native-kit/Sources/FoleviMac/**`, `apps/mac/Folevi/App/MainWindowController.swift`, `Chrome/TitleBar.swift`, `Chrome/MainMenu.swift`, `Chrome/WindowRestore.swift` | L | N3, N4 |

**Milestone M1 (end of week 4):** on iPhone and Mac, launch to Home from the snapshot, open a note with the zoom,
type with the native toolbar, go back, star and move notes, offline included.

### All screens (weeks 5 to 7)

| WP | What | Owns | Size | Depends on |
| --- | --- | --- | --- | --- |
| **N9** Folders, drag and drop, multi-select | Folder screens and cards, nested folders, all drag and drop (iPhone, iPad, Mac), move and copy dialogs | `FoleviScreens/Folders/**`, drag types in `FoleviDesign/DragTypes.swift` | L | N7 |
| **N10** Tasks and Calendar | Tasks views, task sheet, Quick task, Calendar agenda, week strip, month, week, subscriptions | `FoleviScreens/Tasks/**`, `.../Calendar/**` | L | N7 |
| **N11** Search, Notifications, Changes, Shared, account and places | | `FoleviScreens/Search/**`, `.../Notifications/**`, `.../Changes/**`, `.../Shared/**`, `.../Places/**` | L | N7 |
| **N12** Foli AI chat | Section 5.9 | `FoleviScreens/FoliAI/**` | L | N3, N4 |
| **N13** Settings | Every section of 5.10 | `FoleviScreens/Settings/**` | XL | N3, N4 |
| **N14** Onboarding, sign-in, gates, E2EE screens, sharing, Quick Add | 5.1, 5.11, 5.12 | `FoleviScreens/Onboarding/**`, `.../Auth/**`, `.../E2EE/**`, `.../Sharing/**`, `.../QuickAdd/**`, `apps/mac/Folevi/Chrome/QuickAddPanel.swift` | L | N3, N4 |
| **N15** iPad layout | Split view, sidebar, tab strip, compact collapse, multiple scenes, pointer and keyboard | `FoleviPhone/Pad/**` | L | N5, N7 |
| **N16** Engine views for all screens (web) | Every remaining view and command, extracted pure modules, fixtures, `parity.ts` complete | `apps/web/src/lib/engine/views/**`, `commands.ts`, extracted modules under `apps/web/src/lib/app/*` | L | N2 |
| **R2** Background sync (section 11) | Silent pushes on the server, iOS background pull and staging, Mac runners ingest, storage budget, settings | `convex/syncNudges.ts` (new), `convex/lib/apns.ts` (background type), `FoleviServices/BackgroundPull/**`, `apps/ios/ios/App/Native/BackgroundRefresh.swift`, `ThisDeviceSection.tsx` storage UI | L | R1 |

**Milestone M2 (end of week 7):** every screen native on all three platforms; the parity checklist has no
"missing" entries.

### Hardening and release (weeks 8 to 10)

| WP | What | Owns | Size |
| --- | --- | --- | --- |
| **N17** Tests and budgets | XCUITest suites, snapshot tests, performance tests, memory runs, accessibility audits, crash reporting (section 10) | `apps/ios/ios/App/UITests/**`, `apps/ios/ios/App/Tests/**`, `apps/mac/FoleviTests/**`, `apps/web/e2e/native-*.spec.ts` | L (starts week 3, runs alongside) |
| **N18** Migration and release | Upgrade tests from the shipped builds, release scripts, App Review notes, TestFlight, notarized Sparkle update, docs (`IOS.md`, `DESKTOP.md`, this plan's status) | `apps/ios/release/**`, `apps/mac/scripts/release.mjs`, `docs/IOS.md`, `docs/DESKTOP.md` | M |

**Milestone M3 (week 8):** feature complete, budgets met, internal TestFlight and a Debug Mac build to the owner.
**Milestone M4 (weeks 9 to 10):** fixes from the owner's use; release candidate.

### Totals and streams

About 205 engineer-days (N0 to N18 about 165, R1 and R2 about 40). With six builder agents in parallel, about
10 weeks of calendar time:

| Stream | Packages, in order |
| --- | --- |
| A, web engine | N2, N6, N16 |
| B, Swift foundation and iPhone frame | N0, N1, N3, N5, N15 |
| C, design system and lists | N4, N7, N9 |
| D, screens | N10, N11, then N14 |
| E, Mac, chat, settings | N8, N12, N13 |
| F, data and background | R1, R2, then N17 and N18 with B |

One Simulator at a time across all agents (each UI test run takes the Simulator lock; agents queue).

### Release plan (one big release)

1. Everything merges behind nothing: the native frame replaces the web frame in the apps in one version (the next
   unified version bump, 1.1.00, since this is a big change).
2. iOS: archive, owner approves upload, TestFlight internal (owner and testers) for at least a week, then App Store
   review (the owner submits; the App Store Connect key has the Developer role). Review notes explain the native
   app and the absence of purchases, as `docs/IOS.md` "App Review notes" does now.
3. Mac: Developer ID build, owner approves notarization (the notary keychain profile), staple, Sparkle
   appcast on `folevi.com/download`.
4. Web: the engine, native chrome mode and the full copy (R1) deploy with the release; R1 and parts of R2 can
   deploy earlier when the owner says so (section 11.10). No push or deploy without the owner's word.

### Migration (existing users upgrade seamlessly)

- Same bundle ids (`com.folevi.ios`, `com.folevi.mac`), App Group `group.com.folevi`, Keychain access group and
  item names, `places.json`, the Mac's support folder and the library on the Mac: all untouched.
- The iOS web data stays readable because the origin stays `capacitor://localhost` in the default
  `WKWebsiteDataStore` (N1). An upgrade test installs the shipped TestFlight build, makes notes offline (pending
  ops, outbox entries, an E2EE space, a second place), installs the new build over it and checks everything
  arrives.
- The Mac keeps `app://folevi` and its data store; nothing moves.
- The first launch after upgrade has no snapshot yet: it shows Home from the engine (about 0.8 s), then the
  snapshot exists. The full copy (section 11) downloads in the background after upgrade with progress in Settings
  > This device.

---

## 10. Testing

- **Unit (XCTest):** generated model decoding of every fixture, list diff application, launch snapshot round trip,
  route parser parity (shared path fixtures with vitest), view models of each screen against fixture streams,
  drag and drop rules (shared fixtures with `folderDrop.ts`), date parsing results shown by Quick Add.
- **Bridge contract (vitest + XCTest):** section 3.8; plus an end-to-end bridge test in a real `WKWebView`
  (XCTest host app) that boots the export against a local `MemoryStore` and runs every view and command.
- **UI (XCUITest):** per screen, the flows of the parity checklist, on iPhone and iPad Simulators and the Mac
  (XCUITest for macOS), against the local dev backend (`E2E_BASE_URL=http://app.localhost:3002`, test accounts)
  and scratch libraries only (never `~/Documents/Folevi Library`, never the installed app's data). One Simulator
  at a time.
- **Snapshot tests:** each component and screen in light and dark, three Dynamic Type sizes, compared as images
  (an in-repo `ImageRenderer` / `UIGraphicsImageRenderer` comparison with a small tolerance, no third-party
  dependency).
- **Performance budgets** (XCTest metrics on a physical iPhone 15 and the M-series Mac, CI on the Simulator for
  regressions):

  | Budget | Target |
  | --- | --- |
  | Cold start to the last screen with cached data | under 0.5 s (`XCTApplicationLaunchMetric`, plus a signpost at first frame with data) |
  | Engine ready | under 1.0 s on iPhone 15 |
  | Scrolling Home and a 5,000-note list | 120 fps on ProMotion, no hitch over 8 ms (`XCTOSSignpostMetric.scrollingAndDecelerationMetric`) |
  | Tap to response (any control) | under 100 ms |
  | Card tap to zoom start | under 100 ms; note content visible at the end of the zoom |
  | Bridge round trip | 3.4 |
  | Memory | 2.4 (`XCTMemoryMetric`; `footprint` on the Mac with `mac-memory.spec.ts` extended) |

- **Web e2e:** `apps/web/e2e/native-chrome.spec.ts` runs the export in native chrome mode in a browser with a fake
  host (the engine protocol over `postMessage`), so the web half is tested on every web change.
- **Crash and hang reporting:** MetricKit (`MXCrashDiagnostic`, `MXHangDiagnostic`) on iOS and macOS, sent without
  any content to a Convex HTTP action (`/diagnostics`), plus Xcode Organizer. The Page View's content process
  terminations are counted the same way.

---

## 11. Notes on the device, synced in the background (owner follow-up)

Goal: any note opens instantly from the device, and what changed elsewhere is already there when the app opens.

### 11.1 One local store per place: the replica, the cache and the outbox together

Today an account has three stores: the per-account IndexedDB (`lib/sync/db.ts`: the sync engine's pending ops,
the outbox entries, kept query answers, list rows, and the blocks of notes once opened), the E2EE replicas
(`folevi-e2ee-<scopeKey>`, a full copy per encrypted space), and in local mode the library. The plan makes the
**replica the single local copy for every space** and puts it in the same per-account database as the engine's
queue and the outbox:

- **Database v4** of `folevi-<account>` adds `replicaRows` (keyed `<scopeKey>|<table>|<id>`, partitioned like the
  local store's tables) and `replicaMeta` (cursor, head, completeness, counts per scope). The pending ops and
  outbox entries stay where they are. Accepting a server result and updating the replica happen in one
  IndexedDB transaction, so a reload never shows an acknowledged change missing or a pending one twice.
- **Standard spaces get a replica too**: `StandardReplica` reuses `SpaceReplicaStore` and `ingest.ts` with an
  identity "open" step instead of decryption. Device queries (`documents.list`, `recentNotes`, `organization.index`,
  `search.documents`, `tasks.list`, ... the router's "device" routes) are answered from it once the scope's first
  full pull completes; before that they go to the server as today.
- The overlay rules stay: device queries read the replica with the engine's pending ops and the outbox's entries
  applied on top (`lib/sync/overlays.ts`), so offline changes show everywhere.
- The kept query answers (`queryCache.ts`) remain for what isn't in the replica (notifications, AI chats, settings,
  calendars) and as the cold-start value of server-only views.
- **Coordination with the outbox work in flight:** R1 starts after the persistent outbox lands and takes over
  `lib/sync/db.ts`'s next version bump together with its owner (one bump, v4, designed jointly; no second schema
  change). E2EE replicas move from their own databases into v4 on first open (copied, then the old database
  deleted), keeping the per-account naming rule of `docs/MULTI_ACCOUNT_PLAN.md` section 4.

### 11.2 Delta sync from the server cursor

- **Pull v2** (`convex/sync.ts` `sync.pullAll`, same page shape as `e2ee.pull.pull`): every row of the scope the
  caller can read with `seq > cursor`: documents, blocks, folders, tags, collections and rows, file metadata,
  study reviews, tombstones, and the caller's own "mine" records (stars, recents). The existing `sync.pull` keeps
  working for old clients. A JSON variant (`pullAllJson`, like `pullJson`) serves the native background pull.
- **Shared pages** from someone else's Personal aren't in any feed: `sync.pullDocs({ ids, since })` refreshes the
  pages in Shared with me (the list is small), on launch and when `sharing.sharedWithMe` changes.
- While a Page View is up: subscribe to `sync.head({ scope })` per scope; when it moves past the cursor, pull
  after 1 s of quiet (at most every 3 s while changes keep coming), 300 rows a page, one IndexedDB commit per page.
  The open note keeps its live block subscription (instant collaboration) and its rows are also ingested.
- First download: right after sign-in or upgrade, in the background, recents and starred first (a priority pull of
  those ids), then the rest in `seq` order. Progress in `sync.status` ("Downloading notes, 412 of 1,530"), shown in
  Settings > This device and, until complete, as a quiet line under Home's title.

### 11.3 Opening a note from the device

`DocumentView` renders from the replica's blocks immediately (with pending ops on top) and subscribes for live
changes after; reconciliation is the existing `remoteUpdate` rule (`docs/SYNC_PROTOCOL.md` client rules). With
the native frame, the zoom waits for `note.ready` (section 4.2), which the replica makes a 30 to 80 ms affair.

### 11.4 Sync while the app is closed

**iOS and iPadOS** (`FoleviServices/BackgroundPull`, wired into `Native/BackgroundRefresh.swift`):

- **Silent pushes:** the server sends `content-available` pushes (`apns-push-type: background`, priority 5, no
  alert, payload `{ "f": { "place": "<user id>", "scopes": [...] } }`, no content) when something the person can
  see changes **from another device or another person**. New `convex/syncNudges.ts`: the push mutation
  (`sync.push` and the outbox's mutations) records a nudge per affected profile (the scope's members and the
  page's grantees, from the indexes the server already has), debounced: sent after 2 minutes of quiet, at most
  once every 15 minutes per device, never to the device that made the change (its APNs token carries its device
  id), and skipped for devices seen in the foreground in the last minute (presence). It goes through the existing
  token-based APNs path (`convex/apnsSend.ts`, key `5PG87M528M`, set up for alerts already). iOS itself limits
  silent pushes to a few an hour and drops them in Low Power Mode, which the design accepts.
- **Background tasks:** `BGAppRefreshTask` (`com.folevi.ios.refresh`, already registered, about 30 s, a few times
  a day) and a new `BGProcessingTask` (`com.folevi.ios.catchup`, minutes, network required, preferably on power)
  for the nightly catch-up and attachment downloads.
- **What runs:** for each account place, native asks `ShellAuth.convexToken(for:)` and calls Convex's HTTP query
  API (`sync:pullAllJson`, `e2ee/pull:pull` for encrypted scopes) from the place's **staging cursor**, writing
  each page as an opaque file into `Application Support/Places/<place>/staging/<scope>/<seq>.json` (file
  protection `completeUntilFirstUserAuthentication`; encrypted scopes' rows stay sealed as the server stores them).
  It also fetches thumbnails and small attachments listed in those pages (11.5). Native never interprets rows
  beyond the cursor fields.
- **Taking it in:** when the place's Page View opens (or is up), the engine reads the staging files in order through
  `foleviShell`, ingests them like any pull page (local, about 5 to 15 ms a page), advances its cursor and deletes
  them. Then its own head subscription takes over. A staging page older than the engine's cursor is dropped.
- **Edits made on the phone** go up before the app is suspended: when the app goes to the background with pending
  ops or outbox entries, native holds a `beginBackgroundTask` (up to about 30 s) while the engine flushes. Queued
  shares, tasks and notes for other places keep using `PlaceOutbox`.
- Why not run the Page View in the background: iOS suspends WebKit's content process for background apps, a
  background task's 30 s rarely covers booting the app plus a sync, and the memory would make iOS end the app
  sooner. The staging design gets the bytes onto the device; the one engine stays the only thing that reads them.

**Mac:** the background places' timed-wake runners already run the full engine; with the replica they keep
each place's copy current. The open place's Page View syncs as on iOS in the foreground. While the Mac app is
quit, nothing runs (as now); the first launch catches up from the cursor.

### 11.5 Prefetch on intent and attachments

- **Prefetch on intent** (web data layer, so the website and today's apps get it too): when a list or Home shows
  cards, the engine makes sure their notes' blocks are in the replica (only matters until the full copy is
  complete, or with "Keep all notes" off); on touch-down, pointer-down or hover of a card (and arrow-key focus in
  a list), it prefetches the note's blocks, its cover, its first images and the note page code. The native frame
  sends `note.prepare` on touch-down (4.2), which does the same and renders it.
- **Attachments:** the on-device attachment store (native: `Application Support/Places/<place>/files/<sha256>`,
  served to the Page View through the scheme handler like `LibraryFileHandler.swift` serves library files; the
  website keeps them in Cache Storage):
  - always: image thumbnails (made on the device at download, 640 px, with ImageIO natively or
    `createImageBitmap` on the web) and files up to 1 MB;
  - on Wi-Fi, or on cellular when allowed: images up to 10 MB and files up to 25 MB of notes opened in the last 90
    days, starred or in recents;
  - on demand: everything else (opening the file downloads it, with progress).
  - **Storage budget:** default 2 GB or 10% of free space, whichever is smaller (Q4), shown in Settings; least
    recently opened large files go first; never evicted: note content, thumbnails, pending uploads, files of
    starred notes.
  - Downloads come straight from R2 with signed links (no Convex bandwidth), per the Cloudflare cost plan.
  - Encrypted notes' files are stored as downloaded (ciphertext) and decrypted in memory when shown (the existing
    decrypted-file cache, up to 200 MB, cleared under memory pressure).

### 11.6 Encrypted spaces: encrypted at rest

The owner's rule replaces today's "devices keep a readable copy" (`docs/E2EE_DESIGN.md` section 3.3, limit 4):

- Rows are kept **sealed as pulled** (note keys, as the server stores them); a note's blocks are opened in memory
  when it opens.
- What lists and search need (titles, excerpts, previews, counts, links, the search index) is kept as one **sealed
  space index** per space, encrypted with a per-device **local storage key** (AES-256-GCM): a non-extractable
  `CryptoKey` in IndexedDB on the web, and on Apple devices a key held in the Keychain (`ThisDeviceOnly`,
  available after first unlock) and handed to the page as a non-extractable import through `foleviShell.e2ee`,
  like the device keys today. On unlock the index is opened in one pass (about 10 ms per MB) and lives in memory.
- Staging files of encrypted scopes are sealed rows; the launch snapshot is sealed (3.7); attachments are
  ciphertext (11.5).
- The honest-limits copy in Settings > Privacy changes to say the device copy is encrypted and opened while the
  app is unlocked. Public computer mode keeps its memory-only behaviour.

### 11.7 Low Power Mode, Low Data Mode, cellular

Native reads `ProcessInfo.isLowPowerModeEnabled`, `NWPathMonitor` (`isConstrained` for Low Data Mode,
`isExpensive` for cellular and hotspots) and the app's settings, and tells the engine (`device.conditions` event;
the web can't see Low Data Mode itself).

| Condition | Note content | Thumbnails, small files | Large files | Background |
| --- | --- | --- | --- | --- |
| Normal, Wi-Fi | live | yes | per 11.5 | refresh, processing, silent pushes |
| Cellular | live | yes | only if "Use cellular for attachments" is on | refresh and pushes; processing waits for Wi-Fi |
| Low Data Mode | live, pull debounced to 10 s | thumbnails only | on demand | no processing task; refresh only |
| Low Power Mode | live, pull debounced to 10 s, no prefetch on hover | on demand | on demand | none scheduled (iOS also holds pushes) |

### 11.8 Settings

Settings > This device (`ThisDeviceSection.tsx` on the web, native Settings in the apps):

- **Keep all notes on this device** (default on): "Notes open instantly and work offline." Shows storage used:
  notes, attachments, other (kept answers), and the device's free space.
- Per place: the same switch and storage, and "Download now" / "Remove downloaded copy" (never removes pending
  changes; asks first when anything waits).
- **Attachments:** Download automatically: On Wi-Fi only (default) / On Wi-Fi and cellular / Only when opened;
  storage limit (1, 2, 5, 10 GB, or no limit); "Remove downloaded files".
- With "Keep all notes" off: the replica keeps recents (last 50 opened), starred and the notes on Home; the rest
  is answered by the server as today.

### 11.9 Server cost

Assumptions for an active heavy user: 1,500 notes averaging 60 blocks, three devices, about 3,000 block changes
a day while writing, one device in front at a time. Convex Professional list prices at the time of writing
(verify on convex.dev/pricing before release): 25 M function calls and 50 GB database bandwidth included per
month, then about $2 per million calls and $0.20 per GB.

| Item | Per active user per month | Cost |
| --- | --- | --- |
| First download (once per device, three devices) | about 600 calls, 150 MB read | about $0.03 once |
| Pulls of others' changes | about 10,000 calls, 60 to 120 MB | about $0.04 |
| `sync.head` re-runs on foreground devices (each accepted batch re-runs it) | about 90,000 calls, under 0.1 GB | about $0.18 |
| Silent pushes (at most 4 an hour per device, debounced; typically under 300 a month) | 300 internal actions | under $0.01; APNs is free |
| Attachment downloads | R2 signed links: no Convex bandwidth, R2 egress free | about $0 |
| **Total added, worst case** | | **about $0.25** |
| **Removed:** server list subscriptions re-running on every edit (`documents.list` with previews, `recentNotes`, `organization.index`, `tasks.counts`) once the replica answers them | often 100,000+ calls and several hundred MB today for the same user | **about $0.20 to $0.40 saved** |

So the full copy is expected to be cost-neutral or cheaper than today, because list screens stop asking the
server. The margin check (30% of price after Polar's fees, Free users at 20:1, per the 2026-10-11 pricing audit):
Core at $1.99 leaves about $0.74 a month for all costs; worst-case sync adds $0.25 for the user and, for Free
users (one device, few changes, about $0.02 each), about $0.40 per paying user. That fits only because of the
removed list queries, so R1 measures both sides on the staging deployment with Convex's usage dashboard before
the release, and keeps three levers ready: head subscriptions only on foreground devices (default), a per-scope
"changed by someone else" nudge row instead of `sync.head` for own-device writes, and for Free plans no
processing task and silent pushes only for shared spaces (Q3).

### 11.10 What can ship before the native release

Ready to deploy when the owner says so, each useful on its own to the website, the PWA and today's hybrid apps:

1. **R1 part 1:** pull v2 on the server, the Standard-space replica with device-answered lists and search, and
   instant note opening from the device (web data layer). Biggest win: notes open instantly everywhere.
2. **Prefetch on intent** in the web lists (hover, pointer-down, touch-down).
3. **Settings > This device** storage switches and attachment downloads with the budget (web Cache Storage first).
4. **R2 part 1:** silent pushes from the server plus the iOS background pull and staging, read by today's
   Capacitor app's page through `foleviShell` (the same staging reader the native app uses).
5. Mac runners ingesting into the replica (automatic once 1 lands).

E2EE at rest (11.6) ships with 1 for encrypted spaces, since it changes the same store.

---

## 12. The in-flight work, and what this supersedes

| In flight | Native release |
| --- | --- |
| iPhone/iPad web performance and shell fixes: startup ("open the last-known folio at once"), header, bottom bar, neutral top bar, zoom transition (`components/iphone/*`, `transitions.ts`, `NoteBars.tsx`, `NoteChrome.tsx`, `TabBar.tsx`) | The frame parts are superseded in the iOS app by the native frame. They stay as the interim iOS UI until the release, and stay for Android (paused, same phone layout) and phone browsers. Startup work stays valuable: the Page View's boot is the engine's readiness time. |
| Full-width note page | Kept: the note page is web. |
| Web keyboard toolbar | Superseded by the native toolbar; its command handlers become the editor command API (N6). |
| Shared mobile web sheet primitive | Kept: it draws the editor's panels (Format, Insert, Style, Comments) inside the Page View, and serves the mobile website. The Foli AI, notifications and account sheets built on it are superseded in the apps by native screens (kept for Android and the mobile website). |
| Offline-first outbox for account mode | Foundation of section 11: the same local store. R1 builds on it after it lands. |
| Foli AI big-note backend fix | Unaffected and needed (the native chat calls the same backend). |
| Folder card fixes | Kept for the website; the native folder card follows the fixed rules (names always visible, art per `FolderCardArt.tsx`). |
| `docs/IOS_POLISH_PLAN.md` decisions D1 (web menus in Folevi's fonts) and the 2026-10-22 "stay hybrid" choice | Superseded in the apps by the 2026-10-24 decision: native menus and screens. D2 (iPad tab strip), D3 (rounded checkboxes), D4 (week strip with pull-down month) carry over. |
| `docs/MAC_POLISH_PLAN.md` decision M2 (Settings window with web content) | Superseded: the Settings window content is native. |

---

## 13. Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Bridge latency or jank on big lists | Windowed lists and hashed diffs (3.2), JSON strings decoded off the main thread, frame-coalesced updates, signposted budgets in CI (3.4). |
| R2 | Two sources of state (native view models vs the engine) drifting | Native holds no authority: every value comes from a subscription, optimistic changes are only for the instant feel and are replaced by the next update; `rev` gaps force a full refresh; the launch snapshot is replaced on `engine.ready`. |
| R3 | The combined Page View grows with editing and hurts list screens | Unmount the editor 30 s after leaving a note; memory relief on warnings; measured budgets (2.4); the split design (2.2) stays the fallback if budgets fail. |
| R4 | WKWebView content process ended by iOS in the background | Snapshot keeps screens drawn, automatic reload, resubscribe; edits are durable in IndexedDB first. |
| R5 | Keyboard and focus between native fields and the web editor (toolbar taking focus, selection lost under native sheets, iPad hardware keys) | Toolbar buttons never take first responder; native sheets over a note save and restore the editor selection (`noteViewState.ts`); key commands split app vs editing keys; UI tests for each case. |
| R6 | iOS storage origin changes on the Capacitor removal, losing pending edits | Serve the export at `capacitor://localhost` with an own scheme handler in the same data store; an upgrade test from the shipped build is a release gate. |
| R7 | Parity with the website: new web features stop reaching the apps automatically | `parity.ts` coverage test fails the web build when a non-editor action has no native entry; screens' logic shared as pure modules (section 8); the "web changes ship to all apps" rule now includes adding the native piece in the same change. |
| R8 | App Review guideline 4.2 (minimum functionality) or 2.5.2 (downloaded code) | 4.2 is no concern for a native app; the web export is bundled, never downloaded. Review notes say so. |
| R9 | One big release concentrates risk | Long internal TestFlight and a Debug Mac build with the owner from M3; the release candidate's upgrade, offline, E2EE and multi-place suites must pass; the previous build stays available on TestFlight and Sparkle can roll back by publishing the previous version as newer. |
| R10 | Background sync cost or battery higher than estimated | Measure on staging (11.9), debounce and cap pushes, honour Low Power and Low Data Mode, the three cost levers. |
| R11 | E2EE at rest slows unlock on large spaces | One sealed index per space opened in one pass; rows decrypted lazily per note; measured on a 5,000-note space (target under 300 ms to the list). |
| R12 | Swift and TS route parsers or date parsing diverge | Shared fixtures run in both test suites; date parsing stays in the engine. |

---

## 14. Open questions for the owner

1. **Developer and admin Settings sections.** Build every Settings section native (the plan), or let Webhooks, API
   tokens, Connected apps (MCP), AI export and workspace Data open as web pages inside the app for this release
   (saves about 8 days)?
2. **Reviews and Graph.** They render note content (flashcards) and a canvas, so the plan keeps them web inside the
   Page View with native bars. Agree?
3. **Free plan and background sync.** Full copy for everyone (decided), but should Free accounts also get silent
   pushes and the nightly processing task, or only background refresh (cheaper, slightly staler on open)?
4. **Attachment storage default.** 2 GB or 10% of free space (whichever is smaller), Wi-Fi only by default. Different
   numbers?
5. **Android.** With iOS native, the web phone frame (`components/iphone`) serves only the paused Android app and
   phone browsers. Keep maintaining it at today's level, or freeze it until Android resumes?
