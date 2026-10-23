# Folevi for Mac on WebKit (2026-10-22)

**Status (2026-10-23):** built and shipping as Folevi 1.0.00 (`apps/mac`, `docs/DESKTOP.md`, `docs/MAC_RELEASE.md`).
The Electron app (`apps/desktop`) has been removed from the repository, and with it the Electron 1.22 handover
(section 8.3: it never shipped, so the migration has no offline step) and the Squirrel feed step (section 9: the
Electron feed never resolved, so no Electron copy can be updated to the native app; people download it). Updates
and downloads come from `https://folevi.com/download/` (the R2 bucket through a rewrite on the website). The rest
of this page is the plan as it was written; paths into `apps/desktop` are the record.

Folevi for Mac today is Electron 44 (`apps/desktop`): Chromium plus Node, showing the bundled interface at
`app://folevi`. This plan replaces Electron with a thin native AppKit app that shows the same bundled interface
in the system's own web view (`WKWebView`) and reuses the iOS app's Swift services. The web app is not rewritten:
every screen stays the same web code that runs on the website, on iPhone and iPad and in Safari.

**Owner decision (2026-10-22): option A, the AppKit + WKWebView shell, built now.** Sections 1 and 2 keep the
comparison short for the record; sections 3 to 11 are the build plan. The Mac polish audit
(`docs/MAC_POLISH_PLAN.md`) designs its native pieces for this shell.

---

## 1. What the spike proved (2026-10-22)

A 300-line AppKit app (`main.swift`, built with `swiftc`, ad hoc signed, in the session scratchpad
`mac-webkit-spike/`, not in the repository) with one `WKWebView`, a `WKURLSchemeHandler` for `app://folevi`
serving `apps/desktop/web` (the development shell export), a stand-in `window.foleviShell` injected at document
start, and a `WKScriptMessageHandlerWithReply` bridge. The iOS app's `Native/Shell/LibraryFS.swift`,
`LibraryPaths.swift` and `Keychain.swift` were compiled in **unchanged**. Results (macOS 27.2, M5 MacBook Pro,
on a machine loaded by six iOS builders, so times are pessimistic):

| Check | Result |
| --- | --- |
| The bundled interface loads from `app://folevi/` with the SPA fallback | yes: the first-launch screen ("Where should your notes live?") renders pixel for pixel as in Electron, light and dark (`prefers-color-scheme` follows `NSApp.appearance`) |
| First load (process start to `didFinish`) | 0.21 to 0.60 s |
| Origin and context | `app://folevi`, `isSecureContext` true |
| IndexedDB (with a `Uint8Array` value), localStorage, Web Locks, BroadcastChannel | all work on the custom scheme |
| WebCrypto X25519 and Ed25519 (E2EE needs both) | both generate keys |
| `:has()`, Popover API, `<dialog>`, `backdrop-filter`, WebGPU | all present |
| Bridge call with a reply (`ping`) | works; the page awaits a promise |
| iOS `FolderFS` through the bridge: write, read back, list, etags | works, same etag on write and read |
| iOS `Keychain` helper: set, get, delete | works |
| A `Uint8Array` as a bridge argument | arrives as a dictionary `{0: 1, 1: 2, ...}`: bytes need base64 (as iOS does) or a request body |
| 4 MB POSTed to `app://folevi/_bridge/bytes` | arrives intact in `httpBody` (SHA-256 matches), 5 ms |
| `-webkit-app-region: drag` | **not supported**: the window can't be dragged by the page's top bar without native help (section 6.3) |
| `showSaveFilePicker` (File System Access) | absent (the app doesn't use it) |
| `navigator.storage.persist()` | false (see risk R5) |
| User agent | `... AppleWebKit/605.1.15 (KHTML, like Gecko)` with no `Safari/` or app token: set `applicationNameForUserAgent` |

Memory, measured with `footprint` at the same first-launch screen:

| | Processes | Footprint |
| --- | --- | --- |
| Spike (AppKit + WKWebView, one window) | host 26 to 55 MB, WebContent 74 MB, GPU 21 MB, Networking 5 MB | **126 to 155 MB** |
| Electron from source (main window + the hidden Quick Add window) | browser 79 MB, GPU 37 MB, network 8 MB, two renderers 51 MB each | **226 MB** |
| The owner's installed Electron app, signed in, idle after hours | main 60, GPU 268, network 8, renderers 85 + 131, folevi-ai 6 | **557 MB** |

Per page, WebKit's content process (74 MB) is not smaller than a Chromium renderer (51 MB). The saving comes from
the host process, the GPU process and not shipping a browser. Battery was not measured; Safari's advantage over
Chrome on macOS suggests WebKit draws less, but treat that as unproven until WM0's measurement (section 10).

Size: the Electron app is 348 MB, of which 237 MB is the Electron framework and 19 MB its Chromium licence file.
The spike app is 296 KB. A full native app is about 5 MB of code plus Sparkle (about 3 MB) plus the web export
(86 MB today: 64 MB of it is `web/covers`, see section 12), so **about 95 MB, or about 35 MB once the covers are
compressed**.

Porting check: every file in `apps/ios/ios/App/Native/Shell/` except `FoleviShellPlugin.swift`, plus
`App/AppLock.swift`, was type-checked for `arm64-apple-macos26.0` with `import UIKit` swapped for `AppKit`. Pure
Foundation, CryptoKit, Security, LocalAuthentication, AuthenticationServices, FoundationModels and
NSFileCoordinator code compiles as is. The UIKit touch points are 25 lines in six files (section 4.2) plus
AppLock's cover view (UIKit views, rewritten in AppKit). `FoleviShellPlugin.swift` (659 lines) is the Capacitor
transport and is replaced by a router (section 4.3).

---

## 2. The options compared (for the record)

| | (a) AppKit + WKWebView (chosen) | (b) Tauri 2 | (c) Mac Catalyst of the iOS app | (d) keep Electron |
| --- | --- | --- | --- | --- |
| App size | about 95 MB (35 MB with compressed covers) | about the same (Rust binary 10 to 15 MB instead of 5) | about 95 MB | 348 MB |
| Memory, first screen | 126 to 155 MB measured | similar to (a) (same WKWebView) plus the Rust host | similar to (a) | 226 MB measured, 557 MB measured in daily use |
| Code reused | the whole web app; the iOS Swift services (library, Keychain, E2EE keys, sign-in, Foli AI on device, places, reminders, cloud); iOS `bridge.js`'s `foleviShell` half | the web app; none of the Swift (Rust can call Swift only through a plugin layer); `apps/desktop`'s TypeScript has to become Rust | the whole iOS app including Capacitor | everything as it is |
| Rewritten | the Electron main process (1,473 lines of `main.ts` and its modules) becomes Swift: menus, windows, Quick Add, tray, Dock, updates, migration; the Node library layer (`src/library/`) is dropped for the iOS Swift one | the same main process in Rust plus every native service the iOS Swift already has (library coordination, iCloud, Keychain, Touch ID, FoundationModels, Vision) through Swift plugins | nothing for the basics, but Catalyst gives an iPad app on a Mac: UIKit menus and windows, iPad sizing, no real NSStatusItem or NSPanel without an AppKit bundle plugin, poorer Mac keyboard and pointer conventions | nothing |
| Mac feel | full AppKit: real menus, NSPanel, NSStatusItem, sheets, Services, Writing Tools, state restoration | good (tao windows), menus and tray through Tauri's wrappers, gaps for NSPanel and Services | weakest: Catalyst look and behaviour, the reason Craft and Things ship AppKit | today's, with Chromium's gaps (section 6 of the polish plan) |
| WebKit differences to handle | section 7 | the same | the same plus iPad layout detection | none (Chromium) |
| Updates | Sparkle 2 | Tauri updater | Sparkle (with an AppKit plugin) or the Mac App Store | Squirrel.Mac (`src/updates.ts`) |
| Main risks | migration of Chromium storage (R1 to R3), drag regions, background places | a third language (Rust) for one platform; two copies of every native service | Catalyst limits block the polish plan's native pieces | Chromium's size and memory stay; `-webkit-app-region` and other Chromium-only behaviour keeps the Mac on a different engine from iPhone, iPad and Safari |
| Existing users' data | section 8 | the same as (a), in Rust | the same as (a) | nothing to move |

Why (a): it is the only option that reuses the Swift the iPhone and iPad app already has (one implementation of
the library, keys and sign-in for every Apple platform), it gives the polish plan every AppKit piece it asks
for, and it puts the Mac on the same engine as iPhone, iPad and Safari, so the web app is tested on one engine
fewer. (b) costs a second implementation of every native service; (c) can't make a first-class Mac app; (d)
keeps 250 MB of browser and the memory.

---

## 3. Architecture

```
Folevi.app (AppKit, Swift 6, macOS 14+, Developer ID, hardened runtime, not sandboxed)
├── AppDelegate               menus, Dock, status item, login item, URL scheme, Sparkle, migration at launch
├── WindowManager             main windows (one per window), runner views per place, Quick Add panel,
│                             Settings window, state restoration
├── WebViewFactory            one WKProcessPool, the default WKWebsiteDataStore, per-view
│                             WKUserContentController (bootstrap script, bridge, content rules by place)
├── AppScheme (app://folevi)  the bundled export: SPA fallback, CSP header by mode, /_files/<sha256>
│                             (library attachments, Range), /_bridge/* (bytes in request bodies)
├── Bridge                    WKScriptMessageHandlerWithReply "folevi": { plugin, method, options } →
│   ├── ShellRouter           foleviShell: the iOS method names (libSetup, authFetch, e2eeOpen, ...)
│   └── DesktopRouter         foleviDesktop: badge, notify, recent, status, settings, window buttons, ...
├── Shared services (Swift)   from apps/ios/ios/App/Native/Shell: LibraryService, LibraryFS, EncryptedFS,
│                             LibraryCrypto, LibraryJournal, LibraryPaths, LibraryWatcher, LibraryFileHandler,
│                             Keychain, E2eeKeys, ShellAuth, ShellCloud (+ folevi-cloud.js), ShellAI,
│                             ShellPlaces, ShellServices
├── Mac services              QuickAddPanel + HotKey, StatusItem, DockMenu, MacAppLock (cover + LAContext),
│                             CallRecorder (ScreenCaptureKit), TextRecognition (Vision), DragOut (file
│                             promises), Print, Share, Services provider, Spotlight, App Intents
└── Resources/web             the shell export (apps/web build:shell, platform mac), as today
```

Rules that carry over from Electron (`main.ts`, `docs/DESKTOP.md` "Security"), unchanged in meaning:

- Every bridge call is answered only for the app's own page: `message.frameInfo.isMainFrame` and
  `securityOrigin` = `app://folevi` (the spike does this). Every argument is validated in Swift; the iOS services
  already validate paths, names and sizes.
- **A page is bound to its place by the host**, never by an argument: each `WKWebView` carries its place id;
  `auth.fetch`, `auth.convexToken`, the E2EE calls and reminders use the sender view's place
  (`docs/MULTI_ACCOUNT_PLAN.md` §2.2). The one exception stays `places.convexToken(id)` from a signed-in page.
- Navigation to another origin is cancelled in `decidePolicyFor navigationAction` and opened in the default
  browser (http, https, mailto only); `window.open` and `target=_blank` to Folevi's own paths open a new window
  (`createWebViewWith`), the rest go to the browser (`urls.ts` `linkTarget` ported).
- Local mode never contacts Folevi: the CSP by mode (from `protocol.ts` `shellCsp`, sent as a header by
  `AppScheme`), plus a `WKContentRuleList` per web view that blocks Folevi's and Convex's hosts for a view
  bound to the library. This is stronger than Electron's session-wide `onBeforeRequest`: the rules are per view.
- Permissions: microphone (audio only) through `WKUIDelegate`
  `requestMediaCapturePermissionFor` for the app's origin; full screen through
  `preferences.isElementFullscreenEnabled`; clipboard and notifications through the bridge; everything else
  refused.
- Secrets never enter page JavaScript: sessions, Foli AI keys and the library key live in the Keychain; the page
  may only ask whether a key is set (iOS `ShellSecrets` semantics).

### 3.1 Where the code lives

| Path | What |
| --- | --- |
| `apps/mac/project.yml` | XcodeGen spec (`/opt/homebrew/bin/xcodegen` is installed); the generated `Folevi.xcodeproj` is not committed, `scripts/project.mjs` generates it. Parallel builders then never conflict in a `.pbxproj` |
| `apps/mac/Folevi/App/` | `AppDelegate.swift`, `WindowManager.swift`, `MainWindowController.swift`, `WebViewFactory.swift`, `AppScheme.swift`, `Places.swift` (runners), `Paths.swift` (support folder by build) |
| `apps/mac/Folevi/Bridge/` | `MessageRouter.swift`, `ShellRouter.swift`, `DesktopRouter.swift`, `Events.swift` (native to page), `mac-bridge.js` (transport for the shared `shell-bridge.js`, plus `foleviDesktop`) |
| `apps/mac/Folevi/Chrome/` | `MainMenu.swift`, `StatusItem.swift`, `DockMenu.swift`, `TitleBar.swift` (traffic lights, drag regions), `QuickAddPanel.swift`, `HotKey.swift`, `SettingsWindow.swift`, `TextMenu.swift` |
| `apps/mac/Folevi/Services/` | `MacAppLock.swift`, `Notifications.swift`, `LoginItem.swift`, `CallRecorder.swift`, `TextRecognition.swift`, `DragOut.swift`, `Sharing.swift`, `ServicesProvider.swift`, `Spotlight.swift`, `Intents.swift`, `Clipboard.swift` |
| `apps/mac/Folevi/Migration/` | `ElectronMigration.swift`, `SafeStorage.swift`, `MigrationWindow.swift` |
| `apps/mac/Folevi/Updates/` | `Updater.swift` (Sparkle) |
| `apps/mac/Folevi/Debug/` | `MacEval.swift` (DEBUG only: run JavaScript in a window from a script, like iOS `SimulatorEval.swift`) |
| `apps/mac/Folevi/Resources/` | `Info.plist`, `Folevi.entitlements`, `FoleviDev.entitlements`, `Assets.xcassets`, the app icon (`Folevi.icon` from `packages/design-tokens/scripts/app-icon.mjs`) |
| `apps/mac/FoleviTests/` | XCTest: router validation, scheme handler, migration from fixtures, safeStorage vectors, menus |
| `apps/mac/scripts/` | `project.mjs`, `build.mjs`, `release.mjs`, `publish.mjs`, `mac.mjs` (eval, menu, shot, the screens script), `screens.mjs` (the version: `scripts/version.mjs` at the repo root) |
| `apps/ios/ios/App/Native/Shell/*.swift` | **shared**: referenced by path from `project.yml` (no copies); the six files with UIKit touch points get `#if os(iOS)` / `#if os(macOS)` (section 4.2) |
| `apps/ios/ios/App/Native/Shell/shell-bridge.js` | **shared** (WM0, done): the `foleviShell` half of `bridge.js`, `foleviShellBridge(SHELL, host)` with a transport `{ call(plugin, method, options), listen(plugin, event, cb) }` and the host's words (platform, version, device name and family, `fileBase`, the cloud kit); iOS `bridge.js` keeps `foleviNative` and passes Capacitor as the transport, the Mac passes `mac-bridge.js`'s. In `Native/Shell` (a synchronized folder) so the iOS project needed no `.pbxproj` edit |

Later, once the iOS polish is done and the files are quiet: move the shared Swift into a Swift package
(`apps/apple/FoleviShellKit`) used by both projects. Not now: the iOS builders are editing these files today.

`apps/mac` sits outside the pnpm workspace, like `apps/desktop`. Vercel builds only `apps/web`; nothing here
changes that.

### 3.2 Build identities (so development never touches the owner's app or data)

| Build | Bundle id | Support folder | Keychain service prefix | URL scheme | Installed |
| --- | --- | --- | --- | --- | --- |
| Debug (Xcode, `scripts/build.mjs`) | `com.folevi.mac.dev` | `~/Library/Application Support/Folevi Dev` (or `FOLEVI_USER_DATA`) | `com.folevi.dev.` | `folevi-dev://` | never; runs from `apps/mac/build/` |
| Release dry run | `com.folevi.mac` | as release, but `scripts/release.mjs --dry-run` launches it only with `FOLEVI_USER_DATA` set to a scratch folder | | | never; output in a scratch folder |
| Release | `com.folevi.mac` (the Electron app's, so the Keychain item and login item carry over) | `~/Library/Application Support/Folevi` (Electron's `userData`) | `com.folevi.` | `folevi://` | only when the owner says so (rule: never install over /Applications without it) |

`Paths.swift` is the only place that knows these; every service gets its folder and Keychain prefix from it.
`FOLEVI_USER_DATA` and `FOLEVI_URL` keep their meanings from `docs/DESKTOP.md` (test runs, the dev site).

---

## 4. Reusing the iOS code

### 4.1 What is reused as is

`LibraryFS.swift`, `EncryptedFS.swift`, `LibraryCrypto.swift`, `LibraryJournal.swift`, `LibraryPaths.swift`,
`LibraryFileHandler.swift` (its `WKURLSchemeHandler` logic is mounted under `/_files/` of `AppScheme`),
`Keychain.swift`, `ShellAI.swift` (FoundationModels on macOS 26; BYO keys over URLSession), and the
`fs-contract.json` tests in `Tests/ShellTests.swift` (run on macOS too).

The Mac's own Node library layer (`apps/desktop/src/library/`, the `folevi-files` and `folevi-ai` helpers, the
`FoleviFiles.app` helper) is not ported: the iOS Swift does the same job in process, with the same on-disk format
(both are checked against `packages/local-store/fixtures/fs-contract.json`). The iCloud container
(`iCloud.com.folevi`) entitlement moves onto the main app.

### 4.2 The UIKit touch points (the whole list)

| File | Lines today | On macOS |
| --- | --- | --- |
| `LibraryService.swift` | `UIDevice` idiom for "On My iPad/iPhone" (277, 300); `UIApplication.beginBackgroundTask` around a write (451 to 453) | "On My Mac"; no background task (a Mac app isn't suspended); `ProcessInfo.beginActivity` for the write |
| `LibraryWatcher.swift` | `UIApplication.applicationState` (40), `didBecomeActiveNotification` (46) | `NSApplication.isActive`, `NSApplication.didBecomeActiveNotification` (and `NSWorkspace.didWakeNotification`, as Electron rescans on resume) |
| `ShellAuth.swift` | `UIWindow?` presentation anchor (82, 174, 185); `UIDevice.current.name` (221 to 222) | `NSWindow` anchor (the `ASWebAuthenticationSession` sheet attaches to the window); the Mac's name from `SCDynamicStoreCopyComputerName` (Electron reads `scutil --get ComputerName`) |
| `ShellCloud.swift` | `UIWindow?` anchor (112) | `NSWindow` |
| `ShellPlaces.swift` | device label (91) | "Mac" |
| `ShellServices.swift` | notification subtitle "On this iPad/iPhone" (45); `UIDocumentPickerViewController` export (174 to 203) and folder picker (208 to 231) | "On this Mac"; `NSSavePanel` and `NSOpenPanel` ("Use This Folder", `canCreateDirectories`), as Electron's dialogs |
| `E2eeKeys.swift` | calls `AppLock.confirm(reason:)` | `MacAppLock.confirm` (LAContext, same semantics: a yes within 30 seconds covers windows opening, as `e2ee.ts`) |
| `App/AppLock.swift` | the cover is UIKit views | the logic stays shared; the cover becomes an AppKit `NSView` over each window's content (Electron's `lock.ts` `electronCover`) |

A shared `Platform.swift` (WM0, in `Native/Shell/`) holds the small differences (`deviceLabel`, `deviceName`, the
`PlatformWindow` and `PlatformPresenter` types, being in front, background work, and on the Mac `SignInSheet`,
`ShellFiles` and `FolderPicker`) plus where the services keep things (`supportFolder`, `documentsFolder`,
`keychainService`, `defaults`: on iOS exactly as before, on the Mac from `Paths.swift`, so a Debug build or a
`FOLEVI_USER_DATA` run never reaches the installed app's folder, Keychain items or settings). Each file has one
`#if` at most (its import).

### 4.3 The router instead of the Capacitor plugin

`FoleviShellPlugin.swift` maps Capacitor calls to the services. The Mac gets `ShellRouter.swift` with the same
method names and option keys, so the shared `shell-bridge.js` calls the same names on both platforms:

```swift
protocol BridgeEvents { func emit(_ plugin: String, _ event: String, _ data: [String: Any]) }
struct BridgeError: Error { let code: String; let message: String; let path: String? }
final class ShellRouter {
    init(place: @escaping () -> String?, window: @escaping () -> NSWindow?, events: BridgeEvents)
    func handle(_ method: String, _ options: [String: Any]) async throws -> [String: Any]
}
```

The Mac's router is written next to the iOS plugin, not by changing the plugin, because the plugin is being
edited by the iOS builders now. Once both are stable, the iOS plugin becomes a thin adapter over the same router
(a later clean-up, section 11, not in these packages).

Transport (`mac-bridge.js`, injected at document start into the page world of every view):

- `call(plugin, method, options)` → `webkit.messageHandlers.folevi.postMessage({ plugin, method, options })`,
  which resolves with the reply or rejects with `{ code, message, path }` (the shapes `bridge.js` produces from
  Capacitor errors today, so `shell-bridge.js` needs no change).
- `listen(plugin, event, cb)` → native calls `window.__foleviEmit(plugin, event, data)` with
  `evaluateJavaScript` in that view only (library changes, cloud status, places changed, menu commands).
- Bytes: base64 in options, as on iOS (`toB64`/`fromB64` in `bridge.js`); above 256 KB the page POSTs the bytes
  to `app://folevi/_bridge/<call id>` and passes the id (proved: 4 MB in 5 ms). Reads above 256 KB come back as a
  `GET app://folevi/_bridge/<id>` the router answers once.
- The bootstrap values Electron reads with `sendSync` (`shell:bootstrap`: mode, version, device name, place,
  background) are written into the injected script itself; a mode or place switch replaces the view's user
  scripts before it reloads.

---

## 5. Bridge parity checklist (every method today's Electron app answers)

Each row is done when the Mac app answers it with the same result shape, verified by the check named. "iOS" means
the iOS service and the shared `shell-bridge.js` already do it.

### 5.1 `window.foleviShell` (preload.ts, built-in interface only)

| Member | Electron (`main.ts` / module) | Mac WebKit | Package |
| --- | --- | --- | --- |
| `platform`, `shellVersion`, `deviceName`, `initialMode`, `places.current`, `places.background` | `shell:bootstrap` | injected bootstrap; `platform: "mac"` | WM0 |
| `setMode(mode)` | `shell:set-mode` (reload every window in that place) | `ShellRouter.setMode`, WindowManager reloads views with new user scripts and content rules | WM1 |
| `library.setup / info / list / read / write / remove / conflictVersions / resolveConflicts / startDownload` | `library:*` (`src/library/ipc.ts`) | iOS `LibraryService` (`libSetup` ... `libStartDownload`) | WM1 |
| `library.watch(cb)` / unwatch | `library:changes` | iOS `libWatch`/`libUnwatch`, event `libraryChanges` | WM1 |
| `library.journal.append / readAll / truncate` | `library:journal-*` | iOS `journalAppend` / `journalRead` / `journalTruncate` | WM1 |
| `library.unlock / setPassphrase / changePassphrase` | `library:*` | iOS `libUnlock` / `libSetPassphrase` / `libChangePassphrase` | WM1 |
| `library.fileUrl(sha, mime)` | `app://folevi/_files/<sha>` | the same URL, served by `AppScheme` through iOS `LibraryFileHandler` (Range, nosniff, sandbox CSP) | WM0 (route), WM1 (reader) |
| `library.move(to)` | `library:move` | iOS `libMove` | WM1 |
| `library.cloud.status / connect / cancel / signOut / onStatus` (Dropbox, Google Drive) | `cloud:*` (`src/library/cloud/`) | iOS `ShellCloud` (`cloudStatus`, `cloudConnect`, `cloudCancel`, `cloudSignOut`, `cloudRequest`, `libSetCloud`, `mirror*`) | WM1 |
| `secrets.has / set / delete` (Foli AI keys, write-only) | `shell:secrets-*` | iOS `secretsHas` / `secretsSet` / `secretsDelete` (Keychain) | WM1 |
| `auth.signIn / signOut / fetch / convexToken` | `authBridge.ts` (browser PKCE, `folevi://auth/callback`, bearer, `Origin: SERVICE_URL`) | iOS `ShellAuth` (`ASWebAuthenticationSession` sheet: passkeys, Google, Apple work there) | WM1 |
| `ai.capabilities / generate (chunks) / cancel / testKey` | `ai.ts` + `folevi-ai` helper | iOS `ShellAI` in process (FoundationModels, macOS 26) | WM1 |
| `lock.getSettings / setSettings` | `lock.ts` | shared AppLock logic + `MacAppLock` cover (locks at launch, on screen lock and sleep, after "away" time) | WM1 |
| `places.list / onChange / switchTo / signIn / describe / signOut / forgetLibrary / convexToken / quickAddPlace / setQuickAddPlace` | `shell:places-*`, runner windows | iOS `ShellPlaces` + Mac `Places.swift` runners (section 6.6) | WM1 |
| `notify.schedule / cancel` (local mode reminders) | `reminders.ts` (in-process timers, `reminders.json`) | iOS `ShellServices` (UNUserNotificationCenter: reminders fire with the app closed, an improvement) | WM1 |
| `files.save(name, bytes)` | `saveFile.ts` (save dialog) | `NSSavePanel` as a sheet on the window | WM1 |
| `http.preview(url)` / `http.calendar(url, previous)` | `calendarFetch.ts` | iOS `httpPreview` / `httpCalendar` | WM1 |
| `e2ee.deviceKeys / open / sign / reset / settings / setTouchId` | `e2ee.ts` (safeStorage files, per account) | iOS `E2eeKeys` (Keychain per place, LAContext) | WM1 |

### 5.2 `window.foleviDesktop` (both the website and the built-in interface today; the built-in interface only on WebKit)

| Member | Electron | Mac WebKit | Package |
| --- | --- | --- | --- |
| `platform: "mac"`, `e2ee` | preload | the same object as `foleviShell.e2ee` | WM0 |
| `setBadge(n)` | Dock badge, sum over places | `NSApp.dockTile.badgeLabel`, same sum | WM2 |
| `notify({ id, title, body, path })` | `Notification`, click opens path, labelled by place | `UNUserNotificationCenter` with categories and actions (polish plan §3.11) | WM2 |
| `setRecent(notes)` / `setStatus(text)` | menu bar icon's menu | `StatusItem` and the Dock menu | WM2 |
| `getSettings()` / `setSettings(patch)` | `settings.ts` (`settings.json`) | `UserDefaults` (`DesktopSettings` keys), same page shape (`pageSettings`) | WM2 |
| `placeWindowButtons({ x, y, height })` | `setWindowButtonPosition` | `TitleBar.swift` moves the three buttons and keeps them there through resize and full screen (section 6.3) | WM2 |
| `pauseShortcut(paused)` | `globalShortcut` off while recording | `HotKey` off while recording | WM2 |
| `closeQuickAdd()` / `sizeQuickAdd(h)` | Quick Add window | `QuickAddPanel` | WM2 |
| `dragFile({ name, text })` | `startDrag` with a temp file | `DragOut.swift`: an `NSFilePromiseProvider` drag session (the file is written on drop) | WM5 |
| `signInInBrowser(url)` | default browser + `folevi://auth/google` | `ASWebAuthenticationSession` with callback scheme `folevi` (no browser round trip) | WM1 |
| `recognizeText(image, handwriting)` | `folevi-text` helper (Vision) | Vision in process (`VNRecognizeTextRequest`, same 30 s limit and one at a time) | WM5 |
| `openInMain(path)` | from Quick Add | WindowManager | WM2 |
| `onCommand(cb)` (`navigate`, `new-note`, `quick-add-shown`, and the new menu commands) | `desktop:command` | `Events.emit("desktop", "command", ...)` | WM0 (channel), WM2 (menus) |
| `callCapture`, `screenAccess()`, `openSystemSettings("screen-recording")` | `getDisplayMedia` with `audio: "loopback"` | `CallRecorder.swift` (ScreenCaptureKit audio + microphone, mixed natively, handed to the page as a file); `callCapture` stays true; `SCShareableContent` for the access check | WM5 |

### 5.3 What the Electron main process does that isn't a bridge call

| Behaviour (`main.ts`) | Mac WebKit | Package |
| --- | --- | --- |
| Single instance, `second-instance` brings it forward | automatic for an app bundle; `applicationShouldHandleReopen` | WM0 |
| `folevi://` links (`open-url`, before ready too), `parseDeepLink`, auth callbacks | `NSAppleEventManager` `kAEGetURL` handler, ported `urls.ts` | WM0 |
| Main window: size and place remembered, 800 × 480 minimum, hidden on close, ⌘Q quits | WindowManager (all windows restored, polish plan §3.5) | WM2 |
| Seamless title bar, page-placed traffic lights | `TitleBar.swift` | WM2 |
| Menus (`buildMenu`) | `MainMenu.swift` (complete set in polish plan §3.1) | WM2 |
| Menu bar icon (`updateTray`) | `StatusItem.swift` | WM2 |
| Quick Add window, ⌥Space (`globalShortcut`), over full-screen apps | `QuickAddPanel` (`NSPanel`, `.nonactivatingPanel`, `.canJoinAllSpaces`, `.fullScreenAuxiliary`) + Carbon `RegisterEventHotKey` (no Accessibility permission) | WM2 |
| Open at login (only applied on change) | `SMAppService.mainApp.register()` / `unregister()` | WM2 |
| Hidden runner windows per place, no background throttling in local mode | runner `WKWebView`s with `inactiveSchedulingPolicy = .none` (section 6.6) | WM1 |
| Network guard for library pages | `WKContentRuleList` per view | WM1 |
| Offline page with Try again | not needed for `app://` (local files); kept for a failed load | WM0 |
| "Update Folevi" page when the website's database is newer (`needsUpdate`) | the same page, from the handover import (section 8) | WM3 |
| One-time IndexedDB handoff (`handoff.ts`) | replaced by the Electron handover (section 8.3) | WM3 |
| Updates (Squirrel.Mac, `RELEASES.json`) | Sparkle 2 (section 9) | WM3 |
| `ApplePersistenceIgnoreState` hack | not needed (AppKit restoration behaves; Folevi restores its own windows) | WM2 |
| Drag-session quit hang workaround (`dragStarted`, `reallyExit`) | not needed (native drag sessions end) | WM5 |
| `FOLEVI_OFFLINE=1` test switch | a `URLProtocol`-free equivalent: a content rule list blocking http(s) and ws(s) in every view, and URLSession refusing | WM0 |
| Spellcheck | WebKit's own (system spelling, grammar, substitutions) | free |
| Dev tools (⌥⇧⌘I) | `isInspectable` in Debug builds only; Safari's Web Inspector | WM0 |

---

## 6. Native pieces that need care

### 6.1 Bytes and calls

See 4.3. Rule for builders: no `Uint8Array` crosses `postMessage`; `shell-bridge.js` already base64-encodes.

### 6.2 Storage engine

WKWebView stores IndexedDB, localStorage and caches per bundle id in the default `WKWebsiteDataStore`
(under `~/Library/WebKit/<bundle id>/`; no container, since the app isn't sandboxed). The origin
string stays `app://folevi`, so every database name the web app uses (`folevi-<profileId>`, `folevi-e2ee-*`,
`folevi-local-*`) is the same. A Debug build's bundle id keeps its storage apart from the release app's.

### 6.3 Dragging the window by the page's top bar

WebKit has no `-webkit-app-region` (proved). The page already marks drag areas (`.ui-drag` and
`body::before` in `globals.css`). The Mac app:

1. `mac-bridge.js` watches `.ui-drag` elements (ResizeObserver and a MutationObserver, throttled to a frame)
   and sends `desktop.dragRegions({ drag: rects, noDrag: rects })` (the no-drag list is the interactive
   descendants `globals.css` already lists, and every open popover, dialog or menu).
2. `FoleviWebView` (a `WKWebView` subclass) overrides `mouseDown(with:)`: a click inside a drag rect and outside
   every no-drag rect calls `window.performDrag(with:)`; a double-click there does what System Settings says
   (`AppleActionOnDoubleClick`: zoom, minimise or nothing). Everything else goes to `super`.
3. The web change is additive. (`globals.css` kept `-webkit-app-region` for Electron; with Electron retired it is gone, and the 8 / 36 px strip along the top is the one `chrome-page.js` reports.)

### 6.4 Traffic lights

The page reports its spot (`placeWindowButtons`, unchanged). `TitleBar.swift` sets the three buttons' frames in
their superview after every `windowDidResize`, `windowDidEndLiveResize`, `windowDidExitFullScreen` and
`viewDidChangeEffectiveAppearance` (AppKit resets them), and tells the page `data-fullscreen` so the 60 pt
traffic space collapses in full screen (polish plan §3.3).

### 6.5 Text, menus and editing

WKWebView brings the system's text services that Electron lacks: spelling and grammar suggestions, Look Up,
Translate, Writing Tools, Services, Speech, Dictation and Emoji & Symbols. `TextMenu.swift` decides, through
`willOpenMenu(_:with:)`, which right-clicks show the native text menu (polish plan §3.2, decision M1).
`writingToolsBehavior` is set by decision M5.

### 6.6 Places in the background

Electron keeps a hidden window per place that isn't open (`/place-sync?place=...`). On WebKit: one
`WKWebView` per runner, not in any window, with `configuration.preferences.inactiveSchedulingPolicy = .none`
(macOS 14) so its timers aren't suspended, and a 1 × 1 frame. Local mode's main windows get the same policy
(Electron's `applyThrottling`). WM1 measures that a runner keeps syncing for 30 minutes with the main window
hidden, and its memory (budget: 60 MB per runner).

### 6.7 Clipboard

`navigator.clipboard.readText()` in WebKit shows a "Paste" confirmation bubble unless it follows a paste
gesture, so the app's own context menu's Paste item can't use it. `Clipboard.swift` answers
`desktop.clipboard.read()` / `write()` (text, HTML, image) from `NSPasteboard`, for the app's menus only;
⌘V and the Edit menu keep the normal paste path.

### 6.8 Downloads, printing, full screen, zoom

`WKDownloadDelegate` for `<a download>` and blob URLs (save panel sheet); ⌘P runs
`webView.printOperation(with:)` on the note (the page gets a `print` command first to switch to its print
layout); `isElementFullscreenEnabled` for presenting; ⌘+ / ⌘- / ⌘0 set `pageZoom`, remembered per app.

---

## 7. What the web app must handle on WebKit

The web app already runs in WKWebView (iPhone, iPad) and Safari, so the list is short:

| Difference | Change | Package |
| --- | --- | --- |
| No `-webkit-app-region` | drag regions reported to the host (6.3); the Electron-only CSS removed after Electron was retired | WM2 (web part in `DesktopBridge.tsx`) |
| `Uint8Array` can't cross `postMessage` | already base64 in `shell-bridge.js`; `foleviDesktop.recognizeText` and `dragFile` go through it too | WM0 |
| User agent lacks `Safari/` and the `FoleviDesktop/` token (`setUserAgent` in Electron) | `applicationNameForUserAgent = "Version/<system Safari version> Safari/605.1.15 FoleviDesktop/<version>"`, so `browserLabel()` and session names read "Folevi for Mac" | WM0 |
| `getDisplayMedia` with system audio (`audio: "loopback"`) doesn't exist | `lib/callCapture.ts` asks `foleviDesktop.recordCall()` when present (native recorder), else today's path | WM5 |
| Clipboard reads outside a paste gesture | `desktop.clipboard` (6.7) in `AppContextMenu` and the editor's menu | WM4 |
| The page must not look like the iOS app | no `window.Capacitor`, no `window.foleviNative`; `foleviShell.platform` is `"mac"`; `data-desktop="mac"` set at document start (the spike does) | WM0 |
| Hidden views are throttled unless told | 6.6 | WM1 |
| Notification permission prompts in the page | none: notifications go through the bridge as today | |
| Service worker | the shell skips it already (`isShell()`) | |

The Playwright suite gets a WebKit project for the shell export (`mac-webkit`, Desktop Safari engine against
`E2E_LOCAL_BASE_URL`), which catches most engine differences without the app; the app itself is checked with
`apps/mac/scripts/mac.mjs` (section 10).

---

## 8. Moving existing Mac users' data from Electron

Context: the public update feed (`updates.folevi.com`) doesn't resolve today, so the installed Electron copies are
the owner's (and any testers'). The plan still moves everything properly, because the owner's Mac holds real
data, and so nothing depends on that.

Electron's `userData` is `~/Library/Application Support/Folevi`. The release Mac app uses the same folder and the
same bundle id `com.folevi.mac`, replaces the app in place, and on first launch runs `ElectronMigration` once
(recorded in `migration.json`; nothing of Electron's is deleted for 30 days, then `Partitions/`, `secrets/`,
`e2ee/`, `library-keys/` and Chromium's caches go).

### 8.1 What moves, and how

| Electron (`userData/...`) | Mac WebKit | How |
| --- | --- | --- |
| `secrets/auth.session.<userId>.bin`, `secrets/auth.session.bin`, `secrets/ai.*.bin` (safeStorage) | Keychain, iOS `ShellAuth` / `ShellSecrets` names (`session.<placeId>`, the AI keys) | decrypt (8.2), store, read back and compare, then mark done. Sessions keep working: no sign-in again |
| `e2ee/device.bin` + `device.json` + `prefs.json`, and `e2ee/accounts/<userId>/` (safeStorage-sealed X25519 and Ed25519 private halves, device id `mac-<ulid>`) | Keychain, iOS `E2eeKeys` per place, **with the same device id and keys** | decrypt, check each private key gives the public key in `device.json` (as `e2ee.ts` does), store. The server keeps recognising this Mac: no re-approval, no recovery |
| `library.json` `{ kind, path, libraryId, chosenFolder?, move?, encryptionJob? }` | iOS shape `{ v, kind, libraryId, bookmark?, sub?, move?, encryptionJob? }` | `path`/`chosenFolder` become a bookmark (`URL.bookmarkData()`, no sandbox needed); iCloud and device kinds map directly; a half-done `move` or `encryptionJob` is carried over for `LibraryService.open()` to finish |
| `library/journal-<libraryId>.bin` | the same path | unchanged (same file, same format: both follow `packages/local-store`'s journal) |
| `library-keys/` (safeStorage-sealed library key cache) | Keychain (iOS `LibraryKeyCache`) | decrypt and store; if anything fails, the library asks for its passphrase once (nothing is lost) |
| `places.json` | the same file | same format (`places.ts` and iOS `ShellPlaces` share the model); read as is |
| `settings.json` (Quick Add shortcut, menu bar icon, notifications, open at login, mode) | `UserDefaults` | copied; the login item is re-registered with `SMAppService` if it was on |
| `window.json` | WindowManager's `windows.json` | the first window's frame |
| `reminders.json` | `UNUserNotificationCenter` pending requests | rescheduled; past ones dropped |
| IndexedDB and localStorage in `Partitions/folevi/` (Chromium LevelDB) | WKWebView's storage | **not converted.** Account caches, E2EE replicas and offline snapshots refill from the server; the library's notes are files. Only edits not yet sent matter: section 8.3 |
| `handoff.json`, `Cache/`, `Code Cache/`, `GPUPersistentCache/`, `GraphiteDawnCache/`, `blob_storage/`, `Shared Dictionary/`, `Trust Tokens` | none | left, then removed after 30 days |

### 8.2 Reading Electron's safeStorage

Electron on macOS encrypts with Chromium's OSCrypt: a random password in a login-keychain generic password item
(service "Folevi Safe Storage"), stretched with PBKDF2-HMAC-SHA1 (salt `saltysalt`, 1003 iterations, 16 bytes) into
an AES-128-CBC key with an IV of 16 spaces; each blob starts with `v10`. `SafeStorage.swift` implements exactly
that (CommonCrypto), and `FoleviTests` checks it against a vector produced by Electron itself (WM3 makes the
vector with a throwaway `safeStorage.encryptString` run from source, never from the owner's data).

The Keychain item's access list names the Electron app's code signature. The native app has the same bundle id
and team (`7K32QQ2FX8`), so its designated requirement should match and macOS should hand the item over without
a prompt. **This is the riskiest assumption in the plan (R1) and WM3's first task is to prove it** with two
Developer ID builds of a test bundle id. If macOS prompts, the person sees one Keychain dialog
("Folevi wants to use your confidential information stored in "Folevi Safe Storage"") and chooses Always Allow;
the migration screen says so before it happens. If that is refused, sessions are signed in again and E2EE device
keys are re-approved from another device or the recovery method: the migration screen explains it and never
deletes the Electron copies.

### 8.3 Edits not yet sent (the handover)

*Dropped 2026-10-23, before it shipped (see the status at the top and `docs/MAC_RELEASE.md` section 2).* The plan was:
the last Electron release (1.22.0, WM3) adds a handover step that reuses `handoff.ts`'s kit (`handoffKit.ts`
`inventory`, `readChunk`, and the localStorage entries):

1. When an update to the native app is ready, Electron first waits for every account's outbox and uploads to be
   empty (the normal sync; up to ten minutes, with "Finishing sync before the update" in the menu), then writes
   every database that still has pending work (the kit's `pending` count above zero) as chunk files into
   `userData/handover/` with an index (database names, versions, record counts, SHA-256 of each chunk).
2. The native app's first launch, before any window opens, imports them into WKWebView storage through a hidden
   view on `app://folevi/_folevi-handoff` running the same kit (`prepare`, `writeChunk`, `writeStorage`): nothing
   already there is overwritten, and a database newer than the bundled interface opens the "Update Folevi" page
   (today's `needsUpdate` rule).
3. Without a handover folder (someone installed the native app by hand over an Electron that had unsent edits),
   the migration screen says "Some changes made offline on this Mac may not have reached Folevi. Open the
   previous version once to send them." and offers to keep a copy of the old app (`Folevi (previous).app`) to do
   that. The library's own data is never at risk: it is files plus the journal, which move as files.

### 8.4 The first launch, step by step

1. Migration screen (a small window, native AppKit, 480 × 320): "Moving Folevi to its new engine" with a
   progress line per step (sessions, encryption keys, library, settings, offline changes). Typically under 3 s.
2. Any failure stops at that step with what happened and Try Again / Continue Without (each step is
   idempotent).
3. Windows open where the old app's were, in the place that was open.

---

## 9. Signing, notarization and updates

- **Signing**: "Developer ID Application: Abu Mohammad Faisal (7K32QQ2FX8)", hardened runtime, timestamped,
  `--options runtime`. Not sandboxed (decision M8). Entitlements: `com.apple.security.device.audio-input`;
  `com.apple.developer.icloud-container-identifiers` and `com.apple.developer.ubiquity-container-identifiers`
  = `iCloud.com.folevi` with `com.apple.developer.icloud-services` = `CloudDocuments`;
  `keychain-access-groups` = `7K32QQ2FX8.com.folevi.mac` (the data-protection Keychain, as on iOS). No JIT
  entitlements (Electron needed `allow-jit` and `allow-unsigned-executable-memory`; WebKit's JIT runs in its own
  signed processes).
- **Provisioning profile**: iCloud and the Keychain group on a Developer ID app need a "Developer ID" provisioning
  profile for `com.folevi.mac` with the iCloud capability, embedded as `Contents/embedded.provisionprofile`. Made
  through the App Store Connect API (decision M10): "Folevi for Mac Developer ID iCloud", committed as
  `apps/mac/signing/Folevi.provisionprofile` (docs/MAC_RELEASE.md §3). Debug builds run without iCloud.
- **Notarization**: `xcrun notarytool submit <zip> --keychain-profile folevi-notary --wait`, then
  `xcrun stapler staple` on the app and the DMG (the profile `docs/DESKTOP.md` already uses).
- **Updates: Sparkle 2** (SPM, `Sparkle.framework` embedded and signed inside out). `SUFeedURL` =
  `https://folevi.com/download/mac/appcast.xml` (planned as `updates.folevi.com`, which never resolved),
  `SUPublicEDKey` in Info.plist; automatic checks every 6 hours
  (Electron's interval), background download, "Restart to Update" in the Folevi menu. The EdDSA key pair was made
  on this Mac with Sparkle's `generate_keys --account folevi` (decision M10): the private key stays in the login
  Keychain, the public key is `SUPublicEDKey`; `generate_appcast` signs each release on the owner's Mac.
- **Delta updates**: Sparkle's binary deltas between consecutive versions (the web export changes every release,
  so a delta is about the size of the changed chunks).
- **Electron users** (dropped: the Electron feed never resolved, so there's nothing to point; they download the
  native app): the last Electron release's Squirrel feed points at a ZIP of the native app (Squirrel.Mac
  accepts it: same bundle id and team), after the handover (8.3). Squirrel.Mac checks that the new bundle's signature matches the
  running one's (same bundle id and team), which it should; WM3 verifies it on a dry run. With no public
  Electron users yet, this mainly serves testers.

### 9.1 The release script (`apps/mac/scripts/release.mjs`)

Same shape as `apps/desktop/scripts/release.mjs`:

1. The version from `version.json` (`scripts/version.mjs` at the repo root, one version for every platform:
   1.0.00, 1.0.01 ... 1.1.00; decision M9's 2.0.0 is replaced), set and committed before the build.
2. `apps/web/scripts/build-shell.mjs --production` with `FOLEVI_SHELL_PLATFORM=mac` into `apps/mac/web-release/`;
   check `shell/build.json` says production and this version (`shellBuild.ts` rules ported).
3. `scripts/project.mjs` (XcodeGen), then `xcodebuild -project Folevi.xcodeproj -scheme Folevi -configuration
   Release -destination 'generic/platform=macOS' -archivePath <out>/Folevi.xcarchive archive`, universal
   (arm64 + x86_64) for publishing, arm64 for the owner's personal build.
4. `xcodebuild -exportArchive` with `ExportOptions.plist` (`method: developer-id`, `teamID: 7K32QQ2FX8`,
   `signingStyle: manual`).
5. Verify: `codesign --verify --deep --strict --verbose=2`, `spctl -a -t exec -vv`, the packaged
   `Resources/web/shell/build.json`, the entitlements (`codesign -d --entitlements :-`), Sparkle's signature.
6. `--dry-run` (default for builders): stop here, print the output folder. Nothing installed, nothing opened.
7. `pnpm release` without `--dry-run` (owner only): replace `/Applications/Folevi.app`, relaunch.
8. `publish.mjs` (owner only): notarize, staple, DMG (`hdiutil`, with the Applications link and background),
   ZIP, `generate_appcast`, upload to R2 with wrangler (`mac/Folevi-<version>.zip`, `mac/Folevi.dmg`,
   `mac/appcast.xml`).

---

## 10. Work packages

Six packages. **WM0 lands first** (two days); WM1 to WM5 then run in parallel, each owning its files. Shared
files are edited only by the package named; others ask. Every package follows the brief's rules (no em dashes,
explicit-path commits, never push or deploy, never install over /Applications, Debug identity from 3.2, never
the owner's support folder or Keychain items).

### WM0: Foundation

- Owns: `apps/mac/project.yml`, `apps/mac/Folevi/App/*`, `apps/mac/Folevi/Bridge/{MessageRouter, Events}.swift`
  and `mac-bridge.js`, `apps/mac/Folevi/Debug/MacEval.swift`, `apps/mac/scripts/{project, build, mac}.mjs`,
  `apps/mac/FoleviTests/{Scheme, Router}Tests.swift`; the split of `apps/ios/ios/App/App/bridge.js` into
  `bridge.js` + `shell-bridge.js` and the new `Native/Shell/Platform.swift` with the `#if` edits of 4.2 (agreed
  with the iOS builders first: `FoleviShellPlugin.swift` and `ShellPlaces.swift` are being edited now; if they
  are still busy, WM0 adds the guards after their commits land, not over them).
- Delivers: the app opens a main window on the bundled interface (`FOLEVI_SHELL_DIR` or `apps/desktop/web`),
  the Debug identity, `AppScheme` (SPA fallback, CSP header by mode, `/_files` route, `/_bridge` bodies), the
  transport and bootstrap, an empty `ShellRouter`/`DesktopRouter` returning `unavailable`, folevi:// links,
  the user agent, `FOLEVI_OFFLINE`, `FOLEVI_USER_DATA`, `FOLEVI_URL`, the eval hook. A measurement script
  (`mac.mjs measure`) records footprint and energy impact (`powermetrics` is root-only, so `top -stats
  power` sampled for 10 minutes idle and 10 minutes typing) for the WebKit app and the Electron app side by
  side.
- Verify: `xcodebuild build` and `xcodebuild test`; `mac.mjs eval` runs the spike's checks in the real app;
  the first-launch screen renders in light and dark; the iOS project still builds (`xcodebuild -project
  apps/ios/ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' build`), one at a
  time on this loaded Mac.

- Landed (2026-10-23): `node apps/mac/scripts/build.mjs` (Debug "Folevi Dev.app" in `apps/mac/build`, never
  installed), `build.mjs --test` (XCTest), `node apps/mac/scripts/mac.mjs launch` then `eval`, `shot`, `open`,
  `appearance`, `windows`, `checks`, `measure` (each run on its own `FOLEVI_USER_DATA`, by default
  `apps/mac/build/run/default`). Extension points for the other packages, so they don't edit WM0's files:
  `ShellRouter.handle` and `DesktopRouter.handle` (WM1, WM2), `DesktopRouter.features` and `extraHandlers` (the
  optional `foleviDesktop` members appear in the page only once listed), `WebViewFactory.extraScripts` (page-side
  files placed inside `mac-bridge.js`'s function, with `call`, `listen`, `desk`, `fire` in reach),
  `WebViewFactory.rulesFor` (content rules per place), `WindowManager.modeOf`, `bootstrapOf`, `currentPlace`,
  `quickAdd` and `reload`, `AppDelegate.buildMenu` and `beforeFirstWindow`, `Links.handlers` (sign-in callbacks),
  `AppScheme.files` (the `/_files` reader), `FoleviWebView.mouseDownHook` (drag areas), `MacEval.commands`. A new
  file in `apps/ios/ios/App/Native/Shell` must be added to `apps/mac/project.yml` by name if the Mac should build it.

### WM1: `foleviShell` parity (library, sign-in, keys, Foli AI, places)

- Owns: `apps/mac/Folevi/Bridge/ShellRouter.swift`, `apps/mac/Folevi/App/Places.swift`,
  `apps/mac/Folevi/Services/MacAppLock.swift`, `apps/mac/FoleviTests/{Shell, Library, E2ee, Places}Tests.swift`.
  Uses the shared iOS services without changing them beyond WM0's guards (bugs found go to the iOS owner).
- Delivers: every row of 5.1; `setMode` reloads; runners with `inactiveSchedulingPolicy`; per-view content
  rules; the lock cover.
- Verify: XCTest including `fs-contract.json` on macOS; scripted flows with `mac.mjs`: local mode (set up a
  folder library in a scratch folder, write a note, quit, reopen, the journal replays, an encrypted library
  unlocks), account mode against the dev deployment with a test account (sign-in sheet, a note syncs, Convex
  token refresh), two places (switch, the runner keeps the other syncing for 30 minutes with the window
  hidden, labelled notification), E2EE (WP1 vectors open and sign as `apps/desktop/src/e2ee.test.ts` checks);
  the existing web e2e `local` project still passes against the shell export.
- Landed (2026-10-23): `Bridge/ShellRouter.swift` answers every method `shell-bridge.js` calls with the iOS plugin's
  names (FoleviTests checks the list against both), each call run with `ShellPlaces.acting` set to the sender view's
  place, so the session, E2EE keys and what a page says of itself are its own place's; `App/Places.swift` (places at
  launch, runners on `/place-sync` in no window, `setMode` and switches that rebuild every main window in the new
  place, the library's views blocked from Folevi's and Convex's hosts, `inactiveSchedulingPolicy = .none` for
  runners and the library's windows through `WebViewFactory.configure`, `/_files` through `LibraryAttachments`);
  `Services/MacAppLock.swift` (Electron's lock.ts rules, `lock.json`, an AppKit cover over every main window);
  `Bridge/DesktopRouter+SignIn.swift` (`signInInBrowser` in the sign-in sheet). Shared-file extension points:
  `Platform.e2ee` (mac-<ulid> ids, Touch ID words), `Platform.canAskOwner`, `Platform.dropboxRedirect`
  (folevi://oauth/dropbox on the Mac), `Platform.libraryPlace` (Electron's displayPath), `ShellPlaces.acting`.
  For WM2: `Places.switched` (reset the menu bar's recent notes and status) and `Places.quickAddChanged` (load
  Quick Add again in its place). Debug commands (`mac.mjs cmd`): `places`, `runner-eval`, `switch`,
  `test-session`, `add-account`, `hide`, `lock-cover`, `forget-library-key`. e2e: `apps/web/e2e/mac-app.spec.ts`
  (`E2E_MAC_APP=<Folevi Dev.app>`): the same foleviShell script in Electron and in the native app, local mode with
  the journal after a kill, account mode with two places. Owner: add `folevi://oauth/dropbox` to the Dropbox App
  Console's redirect URIs; a build with cloud sync sets `FOLEVI_DROPBOX_APP_KEY` and `FOLEVI_GOOGLE_IOS_CLIENT_ID`
  (an iOS-type Google client) or Info.plist's `FoleviDropboxAppKey` and `FoleviGoogleClientId`.

### WM2: Mac chrome (menus, windows, title bar, Quick Add, status item, Dock, Settings window)

- Owns: `apps/mac/Folevi/Chrome/*`, `apps/mac/Folevi/Bridge/DesktopRouter.swift` (all rows of 5.2 except
  `dragFile`, `recognizeText` and call capture), `apps/mac/Folevi/Services/{Notifications, LoginItem}.swift`;
  on the web side only additive edits in `apps/web/src/components/app/DesktopBridge.tsx` and
  `apps/web/src/lib/desktop.ts` (new commands, drag regions, `data-fullscreen`, `data-window-active`).
- Delivers: `docs/MAC_POLISH_PLAN.md` §3.1 (menu bar), §3.2 (native text menu), §3.3 (title bar and traffic
  lights), §3.5 (windows), §3.8 (Quick Add panel), §3.9 (status item and Dock), §3.10 (Settings window, per
  decision M2), §3.11 (notifications).
- Verify: XCTest for the menu model (every item has its shortcut and a command, no duplicates); `mac.mjs shot`
  of every menu and window in light and dark; Quick Add over a full-screen app and from another app without
  stealing activation; state restoration across quit and relaunch with three windows; the page commands
  arrive (eval checks).

### WM3: Migration, signing, updates, release

- Owns: `apps/mac/Folevi/Migration/*`, `apps/mac/Folevi/Updates/*`, `apps/mac/Folevi/Resources/{Info.plist,
  *.entitlements}`, `apps/mac/scripts/{release, publish}.mjs`, `apps/mac/FoleviTests/Migration*`;
  in `apps/desktop`: new `src/handover.ts` (+ test) and small marked edits in `src/main.ts` and
  `src/updates.ts` for the 1.22.0 handover release.
- Delivers: section 8 and section 9. First task: prove R1 (the safeStorage Keychain item opens without a prompt
  from a second Developer ID app of the same bundle id; done with a test bundle id `com.folevi.migration-test`,
  never `com.folevi.mac`).
- Verify: a fixture made by running Electron from source with `FOLEVI_USER_DATA=<scratch>` (a folder library,
  a test account session on the dev site, E2EE keys, reminders, two places), then the native Debug build with
  `FOLEVI_USER_DATA` pointing at a copy of that folder migrates it: sessions work without sign-in, the E2EE
  device id is the same and unlocks, the library opens, a queued offline edit from the handover reaches the dev
  server; `release.mjs --dry-run` passes every verification in 9.1. Never run against the owner's folder.

- Landed (2026-10-23, docs/MAC_RELEASE.md has the details and the owner's steps):
  - **R1 proved**: a Swift app with Electron's bundle id and team (Developer ID) read a "Safe Storage" item that
    Electron 44 made, with every prompt refused, in 15 ms; the same binary under another bundle id, or ad hoc
    signed, got "needs permission" with no dialog. Throwaway bundle id `com.folevi.migration-test` and item, deleted
    after; the owner's item was never read. `release.mjs` checks every release keeps the Electron app's designated
    requirement.
  - `Migration/`: `ElectronMigration.swift` (the five steps of 8.1, idempotent, `migration.json`, the 30-day
    clean-up), `SafeStorage.swift`, `HandoverImport.swift` (with `handover-kit.js` made from `handoffKit.ts`),
    `MigrationWindow.swift` (8.4), run from `AppDelegate.migrate` before anything else reads the support folder.
    `ElectronMigration.firstWindowFrame(record)` is the old window's frame for WM2's first window.
  - Electron 1.22's handover (`apps/desktop/src/handover.ts`): written at every quit and before an update installs,
    after up to ten minutes of normal sync ("Finishing Sync Before the Update…").
  - Signing: the Developer ID profile "Folevi for Mac Developer ID iCloud" (made through the App Store Connect API
    on 2026-10-22, checked and adopted, `apps/mac/signing/`), `Folevi.entitlements` (iCloud, Keychain group,
    microphone). Updates: Sparkle 2.10.0, `Updates/Updater.swift`, the EdDSA key generated on this Mac (login
    Keychain, account `folevi`; public key in Info.plist). Scripts: `release.mjs` (dry run by default),
    `publish.mjs` (owner only), `migration-fixture.mjs`.
  - For WM2: the Folevi menu's update item shows `Updater.shared.menuTitle` and calls `Updater.shared.menuAction()`
    (refresh on `Updater.changed`); `Chrome.checkForUpdates` and `Chrome.updateTitle` can point there.

### WM4: Web-layer Mac polish (shared by Electron today and WebKit tomorrow)

- Owns: a marked `:root[data-desktop="mac"]` block in `apps/web/src/app/globals.css`, Mac styles in
  `apps/web/src/components/ui/{Menu, Dialog, Popover}.tsx` (coordinated with the iOS WP3 owner, who owns their
  iPhone styles), `apps/web/src/components/app/{DesktopQuickAdd, AppContextMenu, TabStrip, CommandPalette}.tsx`
  Mac variants, `apps/web/src/components/views/settings/DesktopSection.tsx`, the page side of the new menu
  commands (a `lib/desktop/commands.ts` registry). Coordinate with the multi-account builder for `Sidebar.tsx`
  (Mac-only styles through the CSS block, no logic changes).
- Delivers: the web items of `docs/MAC_POLISH_PLAN.md` §2, §3.4, §3.6, §3.7, §3.8 (the form), §3.12, §3.14 to §3.16.
- Verify: before and after screenshots with the audit script (Electron, light and dark) and, once WM0 lands, with
  `mac.mjs shot`; e2e `desktop-app.spec.ts` and `desktop-windows.spec.ts` still pass; new e2e for keyboard-only
  focus rings and the menu commands; the new `mac-webkit` Playwright project for the shell export.

### WM5: Mac capabilities (recording, text recognition, drag and drop, print, share, Services, Spotlight)

- Owns: `apps/mac/Folevi/Services/{CallRecorder, TextRecognition, DragOut, Sharing, ServicesProvider, Spotlight,
  Intents, Clipboard}.swift`, their `DesktopRouter` rows (through a small extension file
  `DesktopRouter+Capabilities.swift`), `apps/web/src/lib/callCapture.ts` (the native path), the drag-out web
  hooks.
- Delivers: 5.2's `dragFile`, `recognizeText`, call capture; `docs/MAC_POLISH_PLAN.md` §3.13 (drag and drop),
  print, the Share menu, the "New Folevi Note with Selection" service, Spotlight and Shortcuts (App Intents:
  New Note, Add Task, Open Note).
- Verify: XCTest (Vision on a fixture image, mixing two audio buffers, file promise written on drop); a recorded
  call through a test tone (`afplay`) with the microphone muted; drag a note to a scratch Finder folder; the
  service appears in the Services menu of TextEdit.

- Landed (2026-10-23). Everything registers in `Capabilities.install()` (`Bridge/DesktopRouter+Capabilities.swift`,
  one line in AppDelegate) through WM0's hooks; the page side is `Bridge/capabilities.js` (members appear only
  once listed in `DesktopRouter.features`), typed in `apps/web/src/lib/desktop/capabilities.ts`, and the page's
  answers live in `components/app/DesktopCapabilities.tsx` (mounted by Shell; nothing in Electron or a browser).
  - Text recognition: `TextRecognition.swift`, Vision in process with folevi-text's rules (one at a time, 25 MB,
    3000 px, 30 s, 100,000 characters).
  - Call recording: `CallRecorder.swift`. ScreenCaptureKit audio (Folevi's own sound left out, the picture never
    kept) and the microphone through AVAudioEngine, mixed by `AudioMix` into mono 48 kHz, AAC 64 kbit/s in an
    .m4a in the temporary folder, handed over once through `/_bridge/<id>` and deleted. The page drives it as
    `foleviDesktop.recordCall` through `lib/callCapture.ts` `NativeCallRecording` (MediaRecorder's shape), so
    the recorder panel's pause, meter, limits and "stopped" states are unchanged. A page that loads again cancels
    its recording.
  - Drag out: `DragOut.swift`. `dragFile` (the Export dialog) starts a native file-promise drag from the last mouse
    event. Note cards and rows (`lib/app/noteDrag.ts` calls `dragNotes`) keep WebKit's own drag: when WebKit
    begins it, the item becomes the notes' `NSFilePromiseProvider`s; over Folevi's windows the pasteboard holds
    WebKit's data alone (with file promises on it WebKit reads a drag as files and hides the notes' ids), outside
    them the promises with WebKit's data. The Markdown (`export.ts` `markdownWithFiles`, attachments in
    "<title> files" beside it) is asked of the page only on a drop. Tab drags aren't wired (the tab strip has no
    HTML5 drag today).
  - Printing and downloads: `Printing.swift` answers WebKit's private print delegate (`_webView:printFrame:...`)
    with `_printOperationWithPrintInfo:forFrame:`, so `print()` in a hidden frame (PDF export, recovery key)
    prints that frame as a sheet; File > Print asks the page, which prints the open note through the PDF export's
    clean page, else the page as it is. `Downloads.swift` turns `download` links and attachment responses into
    WKDownloads saved through a save panel (WebKit otherwise does nothing with them; exports depend on it).
  - Share: `Sharing.swift`: `foleviDesktop.share` (the picker for text, a link, or Markdown as a file, at a page
    rect or point; WM2's text menu uses it), File > Share's services (WM2's `Chrome.shareItems`, from the page's
    `setShareTarget`), File > Print (`Chrome.print`), hooked in `ChromeHooks.swift`.
  - Services: `ServicesProvider.swift` and `NSServices` in Info.plist ("New Folevi Note with Selection", "New
    Folevi Dev Note with Selection" in Debug; plain text, RTF): the page makes the note (first line the title).
  - Spotlight: `Spotlight.swift`. Each place's page hands over its recent and starred notes (both modes; the Mac
    has no REST token of its own), a domain per place, pruned when a place goes; a result opens the note in its
    place (`Places.switchTo`) through `application(_:continue:)`.
  - Shortcuts: `Intents.swift`: New Note (with text), Add a Task (with a due date) and Open Note (from the notes
    Spotlight holds), with phrases; they go through the open place's page as the menus do.
  - Also `Clipboard.swift` (`foleviDesktop.clipboard` for WM4's menus) and `QuickLook.swift` (attachments'
    Quick Look button in the Mac app).
  - Debug commands for scripts (`mac.mjs cmd ...`): `printToFile`, `downloadTo`, `service`, `intent`,
    `spotlight`, `openSpotlight`, `printNote`, `shareAnswer`, `dragLog`, `dragProbe`.
  - WM0 follow-up: the shared `Folevi.defaults`, `Folevi.container` and `DeviceCredential` are the build's own on
    the Mac (Platform), never shared between Folevi Dev, Folevi and FOLEVI_USER_DATA runs.

### Sequence

| Day | WM0 | WM1 | WM2 | WM3 | WM4 | WM5 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 to 2 | builds | reads, plans | reads, plans | proves R1 (independent of WM0) | starts (Electron) | reads |
| 3 to 10 | supports | builds | builds | builds migration | builds | builds |
| 11 to 14 | | parity sign-off | polish sign-off | dry-run release, handover release | sign-off on both engines | sign-off |

Then the owner dogfoods the Debug build beside Electron for a week, approves, and says when to run the release
(installs over /Applications) and later the publish.

---

## 11. Phased plan

1. **Phase 0, done**: the spike (section 1).
2. **Phase 1, foundation** (WM0): the app runs the interface, Debug identity, transport, eval hook, measurement.
3. **Phase 2, parity** (WM1 to WM5 in parallel): every row of section 5; the polish plan's native pieces.
4. **Phase 3, switch-over** (WM3): Electron 1.22.0 with the handover; Folevi 1.0.00 native (was 2.0.0 before the one-version rule), installed by the owner;
   the migration on the owner's Mac (with the Electron app kept as `Folevi (previous).app` until the owner says
   it can go).
5. **Phase 4, public**: notarized, Sparkle feed live, DMG on folevi.com/mac.
6. **Phase 5, clean-up** (after a month without a regression): `apps/desktop` archived on a tag
   (`electron-mac-archive`) and removed from `main`; the iOS plugin becomes a thin adapter over the shared
   router; the shared Swift moves into `apps/apple/FoleviShellKit`; `-webkit-app-region` CSS and Electron-only
   branches in the web (`desktop()` website mode, the `handoff` origin, `callCapture` loopback) are deleted;
   `docs/DESKTOP.md` is rewritten for the new app.

---

## 12. Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | The native app can't open Electron's "Folevi Safe Storage" Keychain item silently | WM3 proves it first with test bundle ids; fallback is one Always Allow prompt, explained before it appears; last resort sign in again and re-approve (never data loss) |
| R2 | Unsent offline edits stranded in Chromium storage | the handover (8.3) with "wait for sync" first; the library is files, never at risk |
| R3 | Device ids change and the server sees a new Mac | the migration keeps the `mac-<ulid>` ids and keys, checked against `device.json` |
| R4 | Runners throttled or suspended in the background | `inactiveSchedulingPolicy = .none`; WM1's 30-minute check; fall back to an off-screen window |
| R5 | WebKit evicts site data (`persist()` is false) | WebKit's 7-day cap on script-written storage is a browser policy and isn't expected to apply to an app's own scheme in its own data store; WM1 verifies it (a 7-day clock skip in a scratch identity, and storage pressure); the library is files and accounts resync, so the worst case is a cache refill |
| R6 | Drag regions feel off (missed drags, a click on a button dragging the window) | hit-testing in `mouseDown` against both lists, updated every frame of layout change; WM2 tests every top-bar control |
| R7 | Text menus mix native and web inconsistently | one rule (polish plan §3.2), decided by the owner (M1) |
| R8 | Engine differences in the editor (contenteditable, IME, drag handles) | the editor already runs on WebKit on iPhone and iPad; the `mac-webkit` Playwright project and WM4's checks cover the Mac's pointer and keyboard |
| R9 | Two implementations during the transition (Electron and native) | Electron is frozen after 1.22.0 except security fixes; web changes keep shipping to both through the shared bundle |
| R10 | iOS builders and Mac builders editing the same Swift | WM0 owns the guard edits and does them only after the iOS packages commit; everyone else uses the files read-only |

### Found while measuring, outside this plan

- `web/covers` is 64 MB of the 86 MB export (and of every app download): compress the cover images (AVIF or WebP
  at the sizes used) or fetch them on first use. Worth doing for the iOS and Android apps too.

---

## 13. Decisions for the owner

- **M1** Context menus: object menus (cards, rows, blocks, tabs, sidebar) stay Folevi's web menus in Folevi's
  fonts, as decided for iOS; right-clicks on text (selected text, the caret in a note, text fields) show the
  native macOS text menu with Folevi's items added (spelling, Look Up, Translate, Writing Tools, Services come
  only with it). Accept?
- **M2** Settings: a separate Settings window for ⌘, (Mac convention, Things and Craft do it), or keep Settings as
  a page in the main window (today)?
- **M3** Sidebar material: keep Folevi's neutral solid sidebar (the "neutral chrome" rule), or the system's
  translucent sidebar (vibrancy picks up the wallpaper's colour, as Apple Notes and Things)?
- **M4** Native macOS window tabs off (Folevi has its own tab strip)?
- **M5** Writing Tools (Apple Intelligence) in notes: on everywhere, on except in encrypted spaces, or off?
- **M6** Minimum macOS: 14 Sonoma (proposed: `inactiveSchedulingPolicy` needs it; Foli AI on device needs 26
  and is hidden below), or 15, or 26 only?
- **M7** Keep the bundle id `com.folevi.mac` (in-place replacement, Keychain and login item carry over; proposed)?
- **M8** Developer ID outside the Mac App Store, not sandboxed (proposed), with the code kept ready for a sandbox
  (security-scoped bookmarks are already what the iOS library uses)?
- **M9** Version 2.0.0 for the first native build?
- **M10** Create the Developer ID provisioning profile for `com.folevi.mac` with iCloud and the Keychain group, and
  the Sparkle EdDSA key pair (both are the owner's to make and keep).

### Owner's answers (2026-10-22)

- **M1: Folevi's own menus everywhere**, right-click on text included, restyled to the macOS spec (Folevi's fonts).
  Spelling suggestions, Look Up and Share are added into Folevi's text menu through the native shell
  (NSSpellChecker and friends), since the system text menu isn't used.
- **M2: a separate Settings window** for ⌘, (toolbar of sections, like Apple's apps).
- **M3: the system's translucent sidebar** (vibrancy that tints with the wallpaper), the Mac exception to
  "neutral chrome"; content stays Folevi's.
- **M4: macOS window tabs off**; Folevi keeps its own tab strip.
- **M5: Apple's Writing Tools off** in notes (Foli AI covers writing help).
- **M6: minimum macOS 15 Sequoia.**
- **M7 to M9:** keep the bundle ID `com.folevi.mac`; Developer ID only (no Mac App Store sandbox); the first
  native build is version 2.0.0. (Replaced 2026-10-23: one version for every platform, 1.0.00 first, docs/MAC_RELEASE.md §5.)
- **M10:** Claude creates the Developer ID provisioning profile (iCloud and Keychain group) through the App
  Store Connect API key and generates the Sparkle signing key on this Mac (private key in the owner's
  Keychain; public key in the app).
- **Polish (MAC_POLISH_PLAN.md):** only **P3, Quick Add as one growing field** with natural dates. Not chosen:
  the quiet "+" (keep the "New note" button), Ask Foli AI as a toolbar button (keep the pill), native alert
  sheets (keep Folevi's dialogs, restyled).

---

## 14. Memory

Every page is a WebKit content process of its own (Activity Monitor's "Folevi Web Content"), so the pages the app
keeps open are most of its footprint. Measured with `footprint` per process (the number Activity Monitor's Memory
column shows), MB.

**How to measure**: `apps/web/e2e/mac-memory.spec.ts` sets the Debug app up as a day of use looks (a folder library
and two test accounts, so two places in the background; three windows, the first with four notes in tabs, one of
them with a flowchart and a whiteboard; Quick Add and Settings opened and closed), waits 90 s, then measures every
process three times idle and three times while typing (a character every 120 ms into the note):

```
E2E_MAC_MEMORY=<out.json> E2E_MAC_APP=<Folevi Dev.app> E2E_MAC_SHELL_DIR=<export> E2E_BASE_URL=http://app.localhost:3002 \
  E2E_NO_SERVER=1 npx playwright test e2e/mac-memory.spec.ts --project account --workers=1
```

`mac.mjs cmd memory` lists every page with its role, place, address and process (Debug builds, `App/Memory.swift`).
The machine was loaded by other builders throughout; footprints don't depend on CPU load, times do.

### The owner's installed app (2026-10-23, read only)

`/Applications/Folevi.app` (1.0.00, native), one main window, running 25 minutes; footprints by pid only, nothing of
its data read: app 55, GPU 28 to 41, Networking 8, the window's page 224 to 264 (growing; 104 MB of it is graphics
memory WebKit can reclaim, 99 MB WebKit's heap), a second page 60 (no window: a place's runner) **= 375 to 411 MB**.

### Before (2026-10-23, HEAD 3832da01, Debug build)

| Process | After setup | Idle | Typing |
| --- | --- | --- | --- |
| App | 53 | 52 | 53 |
| Window 1 (the note with the flowchart and whiteboard; four notes in tabs) | 174 | 174 | 192 |
| Window 2 (Tasks) | 79 | 84 | 94 |
| Window 3 (Calendar) | 102 | 109 | 110 |
| Quick Add (closed, kept) | 69 | 63 | 62 |
| Runner, the second account | 61 | 60 | 60 |
| Runner, the library | 60 | 60 | 61 |
| Settings (closed) | released | released | released |
| GPU | 43 | 30 | 148 |
| Networking | 9 | 9 | 9 |
| **Total** | **650** | **641** | **789** |

So a third of an idle day's footprint (183 MB of 641) is pages nobody sees: Quick Add's after its first use and a
runner per place in the background.

### Step 1: background places (`App/BackgroundSync.swift`)

Two designs for the places no window shows, instead of a page each all day:

- **One shared runner** syncing every place in turn: one runner page is always up (60 MB, the size of each runner
  above), and it loads a new page for every turn.
- **Timed wake** (chosen): no page between wakes. A place's runner wakes right away when the place leaves the
  windows (a switch, so what was queued there goes up), when an account is added, when the library's folder
  changes (while Folevi is in front, or iCloud says so) and every 10 minutes one place at a time; it stays at least
  15 s and until its page says nothing waits (at most 2 minutes, 10 while something still waits), then goes, and
  WebKit ends its process. New notifications stay prompt without a page: every minute each background account asks
  Convex for its unread count over HTTPS with its own token (`notifications:unreadCount`, one small query); a higher
  count wakes its page, which shows them as before. The runner now starts from where the last one stopped
  (`PlaceSync` keeps what it has shown in the Mac app), so nothing that came in between is missed or shown twice.
  The library's reminders were already the system's (they fire with no page and with Folevi quit).

Measured (the same setup; `cmd places` shows each wake and release in `background.log`):

| | Before | After |
| --- | --- | --- |
| Runner, the second account | 60 | 0 (woke for 19 s after setup, released "done") |
| Runner, the library | 60 | 0 (woke at setup and again for a folder change, released "done" each time) |
| Total idle | 641 | 588 |

(The windows' own pages vary by 20 to 40 MB between runs with what they show, so the totals move by more than the
runners; the runners' 120 MB are what this step removes.) Electron's design and the shared runner keep 60 to 120 MB
for places nobody looks at; the timed wake keeps none between wakes, for one 60 MB page for about 20 s every 10
minutes per place and one Convex query a minute per background account (about 43,000 a month each).
