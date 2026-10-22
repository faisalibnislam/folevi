# Folevi for iPhone and iPad

Folevi for iPhone and iPad is the web app in an app of its own, the way Folevi for Mac is (`docs/DESKTOP.md`):
a Capacitor shell (`apps/ios`) around the same product code. Since 2026-10-22 the app carries the interface
built in (the web app's shell export, `docs/LOCAL_MODE_PLAN.md` §1), served from `capacitor://localhost`, so it
opens offline in both modes: "Keep notes on my devices" (local mode, no account) and "Sign in to Folevi". The
shell adds what a browser tab can't do in Swift: the library over files, sign-in, Foli AI on the device,
end-to-end encryption keys, and the native parts below. Web changes reach the app with each app build
(`pnpm release`), like the Mac app's built-in interface. The sections below "The built-in interface" describe
the parts that predate it; they apply unchanged unless that section says otherwise.

- Universal (iPhone and iPad), iOS 17 and later, bundle id `com.folevi.ios`, display name "Folevi".
- Capacitor 8 with Swift Package Manager (no CocoaPods), pinned exact versions, outside the pnpm workspace
  (Vercel builds only `apps/web`).
- Commands: `apps/ios/README.md`.

## The built-in interface (2026-10-22)

### What runs where

```
apps/web (shell export, build-shell.mjs --platform ios) -> apps/ios/web/ (git-ignored) -> ios/App/App/public
apps/ios/ios/App/Native/Shell/
  FoleviShellPlugin.swift   "FoleviShell": every foleviShell call, origin-checked like FoleviNative
  LibraryService.swift      the library: where it is, its manifest, passphrase, move, attachments
  LibraryFS.swift           LocalFs over a folder: coordinated I/O, etags, placeholders, conflict versions
  EncryptedFS.swift         FLV1 envelopes under HMAC names (the Mac's encryptedFs.ts)
  LibraryCrypto.swift       PBKDF2, HKDF, AES-GCM single and STREAM envelopes, HMAC names (CryptoKit)
  LibraryJournal.swift      the native journal (the Mac's format: "FLVJ" 0x01, length, CRC-32, record)
  LibraryWatcher.swift      NSMetadataQuery for iCloud, a listing every 30 s and on coming to the front
  LibraryFileHandler.swift  folevi-file://lib/<sha256>?type=<mime>: attachments, Range, CORS for the page
  ShellAuth.swift           bearer sign-in (client folevi-shell) in iOS's sign-in sheet, /api/auth/* fetch
  ShellAI.swift             Foli AI: Apple's on-device model (FoundationModels, iOS 26+) or the person's keys
  E2eeKeys.swift            this device's X25519 and Ed25519 keys for end-to-end encryption
  ShellServices.swift       the mode, reminders (local notifications), calendars and previews, saving files
  Keychain.swift            the app's own Keychain items; a reinstall forgets them
Native/AppleSignIn.swift    Sign in with Apple in Apple's own sheet (foleviNative.signInWithApple)
```

- `bridge.js` adds `window.foleviShell` (types: `apps/web/src/lib/shell/types.ts`, platform `"ios"`, with
  `deviceFamily` "iPhone" or "iPad") next to `window.foleviNative`, on the app's own origin only.
  `FoleviViewController` fills in the mode (read before any page script runs), the version and the device's
  name. Bytes cross the bridge as base64; failures reject with `{ name, code, message, path }`.
- The start page is `/documents` (bridge.js sets it before the router reads the address; index.html is "/").
- `setMode` saves the choice (`UserDefaults`) and starts the app's screen again with a new web view on the same
  storage, so the mode in the page and the network rules match. In local mode a `WKContentRuleList` blocks
  folevi.com, `*.convex.cloud` and `*.convex.site` under the page's own policy.
- Links to the app's own pages on the website (https://app.folevi.com/d/...) open in the app; others open in
  the in-app Safari view as before.
- The extensions' REST API base is the service (https://app.folevi.com/api/v1), not the page's origin.

- Several places (`docs/MULTI_ACCOUNT_PLAN.md`): `ShellPlaces.swift` keeps the library and the accounts in
  Application Support (`places.json`); each account's session is the Keychain item `session.<user id>` and its
  E2EE keys `device.<user id>`. Switching starts the screen again in that place. The share extension and the
  widgets act on the open place.

### Local mode on iPhone and iPad

- **First launch**: "Keep notes on my devices" (Free forever. No account.) or "Sign in to Folevi"
  (`ShellRoot`, `ModeChoice`, `LibrarySetup` from the web). Choosing to sign in goes straight on to signing in
  after the app restarts in account mode (no second choice).
- **Places**: Sync with iCloud, Choose a folder (the Files app's folder picker: On My iPhone, iCloud Drive,
  Dropbox, Google Drive, OneDrive and other File Providers; a security-scoped bookmark), This device only
  (`Documents/Folevi Library`, visible in the Files app under On My iPhone > Folevi), and Sync with Dropbox and
  Sync with Google Drive when the build has their client ids.
- **Dropbox and Google Drive** (WP9b): the provider code is `packages/cloud-folders`, through the Android
  bridge's kit (`apps/android/bridge/cloud.ts`), bundled by `scripts/bundle-cloud.mjs` into
  `Native/Shell/folevi-cloud.js` (git-ignored, made by `pnpm shell`, `pnpm build` and `pnpm release`) and put
  into bridge.js. Sign-in is OAuth with PKCE in iOS's sign-in sheet (`Native/Shell/ShellCloud.swift`;
  Dropbox's redirect is `com.folevi.ios://oauth/dropbox`, Google's the reversed iOS client id); the tokens stay
  in the Keychain (`com.folevi.cloud-tokens`, this device only), requests go only to the providers' own hosts,
  and the library's copy on the device (Application Support/Folevi/Cloud libraries) serves attachments. The
  client ids come from the build: `FOLEVI_DROPBOX_APP_KEY` and `FOLEVI_GOOGLE_IOS_CLIENT_ID` when running
  `cap sync` or `pnpm release`; without one, that place isn't offered. Owner: make the Dropbox app (scoped,
  App folder, redirect above) and a Google OAuth client of type iOS for `com.folevi.ios`, then build with them.
  Checked in the Simulator with placeholder ids: the sheet opens on each provider and a cancel comes back as
  cancelled; a real sign-in hasn't been run. A passphrase isn't offered for these two on iOS yet, and moving
  from one of them to "Choose a folder" goes through This device only first.
- **iCloud**: the app's own container, `iCloud.com.folevi`, its `Documents` folder (`NSUbiquitousContainers`
  makes it public: "Folevi" in iCloud Drive). The library is the container's Documents folder itself (not a
  subfolder), shown as "iCloud Drive › Folevi". Notes, catalogs, the index and devices' files start
  downloading as soon as iCloud lists them; attachments when they're shown. A device not signed in to iCloud,
  or with iCloud Drive off for Folevi, gets the reason and what to do in the Settings app.
- **The same files on the Mac**: Folevi for Mac uses `~/Library/Mobile Documents/iCloud~com~folevi/Documents`
  once that folder is on the Mac (apps/desktop/src/library/locations.ts `iCloudLocation`); see "The Mac and the
  iCloud container" below.
- **Writes**: every write is `NSFileCoordinator(.forReplacing)` with `Data.write(.atomic)`, F_FULLFSYNC, and
  the `ifMatch` check inside the coordinated block, inside a background task assertion so a flush finishes when
  the app leaves the screen. Reads never block on the network: a file whose contents are in the cloud reads as
  `notDownloaded` and is asked for.
- **Encryption** with a passphrase (on, change, off, resumable) works as on the Mac; the unwrapped key is kept
  in the Keychain (this device only). Checked in the Simulator: HMAC names and FLV1 envelopes on disk, plain
  reads in the page, and back.
- **Foli AI**: Apple's on-device model where iOS 26 and Apple Intelligence are there (the Simulator on this Mac
  reports it available and streams answers), else the person's OpenAI, Anthropic or Google key, kept in the
  Keychain and sent only to that provider.
- **Reminders** are local notifications (up to iOS's 64 pending; the page schedules the next ones again after
  each change); tapping one opens its note.
- **Moving** between modes (WP12) and moving the library between places are the web's flows on this bridge.
- **Widgets, Siri, Shortcuts and Spotlight** (WP13) work without an account: there's no REST API in local mode
  (`SharedAccount.api()` is nil there even with an old token kept), so the page that holds the library feeds
  them (`components/app/LocalExtensions.tsx`). It hands the app the widgets' copy (open tasks through tomorrow,
  the recent notes: `foleviNative.setWidgetSnapshot`), the notes Shortcuts can pick from (`local-notes.json`)
  and Spotlight's notes (the recent and starred ones: `indexSpotlight`) whenever the library changes. What a
  widget's check-off, Add a task or New note with text does while the page isn't running waits in the App
  Group's `LocalActions/` queue (`Shared/LocalExtras.swift`); the page takes it as it opens or comes back
  (`takeLocalActions`, `finishLocalAction`; a Darwin notification tells a running app at once), a new note
  opens, and the widget shows the check meanwhile. Add a task says "It goes into your Inbox when you next open
  Folevi." A change of mode clears the widgets, Shortcuts' notes and Spotlight; queued actions wait for local
  mode. Checked in the Simulator: Add a task (app running and app closed), a check-off from a widget, New note
  with text, Open note by name, Spotlight's entries and the widgets drawn from a local library.

### Signed in

`ShellAuth` signs in the way the Mac app does (Authorization Code with PKCE, client `folevi-shell`,
`folevi://auth/callback`), with the website in iOS's sign-in sheet (ASWebAuthenticationSession; Safari's
session carries over). The bearer token stays in the Keychain; the page's Better Auth client sends
`/api/auth/*` through `foleviShell.auth.fetch`, and Convex gets its JWT from `convexToken()`. Checked in the
Simulator against the dev server: sign-in, the signed-in Home, the device's REST token for the extensions.

**Sign in with Apple** in Apple's own sheet (`Native/AppleSignIn.swift`, `lib/auth/appleSheet.ts`): the iOS
sign-in screen of the built-in interface shows "Continue with Apple" (Apple's black or white button) next to
"Sign in with email or Google". The page makes a nonce, the app asks Apple with its SHA-256, the page signs in
with the id token (`signIn.social({ provider: "apple", idToken })`; in the built-in interface the app keeps the
session the answer's `set-auth-token` carries), then posts the one-time authorization code to
`/api/auth/apple/native-code`. A two-step account gets the web's message. The website-in-the-app mode
(FOLEVI_URL) uses the same sheet from `SocialSignIn`. Only the sheet opening was checked (the Simulator has no
Apple Account); a full sign-in needs a device signed in to an Apple Account.

### End-to-end encryption

`foleviShell.e2ee` has the Mac's shape (`deviceKeys`, `open`, `sign`, `reset`, `settings`, `setTouchId`):
X25519 and Ed25519 keys made with CryptoKit and kept in the Keychain (this device only, after first unlock),
device ids `ios-<ulid>`. `open` checks the FLS1 box and context and asks for Face ID first when "Ask for Face ID
to unlock encrypted notes" is on (Settings > This device; turning it on or off asks too). Unit tests open
local-store's FLS1 vectors and verify the FST1 statements. Approving this device from another one, or another
from this one, is the web's flow on these keys. Still the E2EE code's to do (lib/e2ee/keys/macBridge.ts, owned
there): the device is labelled "Folevi for Mac" with platform "mac", and passkey unlock is offered although
WebAuthn can't run on capacitor://localhost (`inMacApp()` should also cover `platform === "ios"`, with the label
"Folevi for iPhone on <name>" or iPad).

### The Mac and the iCloud container

The Mac makes and uses the container itself (2026-10-22). folevi-files is also built as a small helper app,
`Contents/Helpers/FoleviFiles.app` (bundle id `com.folevi.mac`, no Dock icon), with the Developer ID profile
"Folevi for Mac Developer ID iCloud" embedded (`apps/desktop/build/FoleviFiles.provisionprofile`, made with the
API key, valid to 2044) and the entitlements in `apps/desktop/native/FoleviFiles.entitlements`
(`icloud-container-identifiers` and `ubiquity-container-identifiers` `iCloud.com.folevi`, `icloud-services`
`CloudDocuments`, `icloud-container-environment` `Production`, the application and team identifiers). A bare
command-line tool can't carry a profile and is killed at launch (spike S6), so the app bundle is what makes it
allowed.

- `scripts/build-helper.mjs` (`pnpm helper`) assembles it in `native-build/` and signs it with the hardened
  runtime and a timestamp by "Developer ID Application: Abu Mohammad Faisal (7K32QQ2FX8)"
  (`FOLEVI_MAC_IDENTITY` overrides). Without that certificate or the profile it's signed ad hoc and without the
  entitlement: it works, but can't make the container.
- Both electron-builder configs copy it to `Contents/Helpers` (extraFiles) and leave its signature alone
  (`signIgnore`); the universal build lists its binary in `x64ArchFiles`. `pnpm release` checks it's there, its
  signature verifies, it has the container entitlement and its profile.
- Its `icloud` request with `container: true` asks `FileManager.url(forUbiquityContainerIdentifier:)` off the
  main thread, which makes `~/Library/Mobile Documents/iCloud~com~folevi` (and its `Documents`) when no device
  has yet; `locations.ts` `iCloudLocation` and `service.ts` use that folder for Sync with iCloud. In the
  container its watch uses `NSMetadataQueryUbiquitousDocumentsScope`, so uploads and downloads are reported
  (polling stays as well).
- The bare `Resources/folevi-files` is still shipped: `FilesHelper` falls back on it (with the requests that
  were waiting) if the helper app is stopped before it answers, for example by a profile macOS won't accept.
  Then only the container is out of reach, and Sync with iCloud is the iCloud Drive folder `Folevi` as before
  (Settings > Library > Move library > Sync with iCloud moves it into the container later).

Checked on this Mac: the signed helper app launches, says it's entitled, and made the container
(`brctl status iCloud.com.folevi` lists it, synced down); the bare binary answers `entitled: false`; a
`pnpm release --dry-run` build into a temporary folder passed its checks, `codesign --verify --deep --strict`
passes for the whole app, and the packaged helper app answers with the container. Not checked: a library
syncing between this Mac and an iPhone through the container (no signed-in device), and a notarized,
universal `pnpm publish-mac` build.

### Building it

```sh
cd apps/ios
pnpm shell                                  # the built-in interface for development (dev Convex) into web/
FOLEVI_SERVICE_URL=http://app.localhost:3002 npx cap sync ios   # sign in against the dev server
node scripts/simulator.mjs run "Folevi iPhone 18 Pro"
FOLEVI_SHELL_URL=http://localhost:3003 npx cap sync ios         # or the interface from next dev (dev:shell)
pnpm release [--build <n>]                  # TestFlight: production export, archive, profiles, upload
```

## How it fits together

```
apps/ios/
  capacitor.config.ts          server.url (app.folevi.com/documents, or FOLEVI_URL), App-Bound Domains, plugins
  www/offline.html             the only page in the app: shown when nothing can load (first launch offline)
  scripts/simulator.mjs        build, run, test, and (Debug) eval and native hooks in the Simulator
  ios/App/App/
    AppDelegate.swift          one scene; links and activities to Capacitor
    SceneDelegate.swift        the window, and the Face ID lock following the scene
    FoleviViewController.swift Capacitor's view controller: swipe back, no page bounce, bridge.js, NavigationGuard
    FoleviNativePlugin.swift   "FoleviNative": lock settings, links out, the offline page's retry
    AppLock.swift              the Face ID lock and its cover
    bridge.js                  window.foleviNative, data-native="ios", viewport-fit=cover
    SimulatorEval.swift        Debug Simulator builds only: run JavaScript from a script
    AppIcon.icon               the Mac app's Icon Composer file (iOS 26 and later); both icons come from
                               packages/design-tokens/scripts/app-icon.mjs
    Assets.xcassets            AppIcon (1024 px PNG, iOS 17 to 25), Mark (the lock screen's F)
    App.entitlements           the App Group and the Keychain group (below)
  ios/App/Shared/              in the app and both extensions: the REST API client, the device token in the
                               Keychain, the App Group, the share queue and saver, folevi:// links, the look
  ios/App/AppAndWidgets/       in the app and the widgets: the widgets' copy of tasks and notes and their
                               timeline, what the widgets draw (and the F they show), the App Intents
  ios/App/Native/              the app only: FoleviNativePlugin's stage 2 and 3 calls, AppServices, DeepLinkRouter,
                               SpotlightIndex, DocumentScanner, the Siri phrases, PushNotifications (stage 3),
                               DebugHooks and WidgetSnapshots (Debug Simulator)
  ios/App/ShareExtension/      "Save to Folevi" in the share sheet
  ios/App/Widgets/             the widgets and the Control Center control
  ios/App/Tests/               unit tests (XCTest, run in the app)
  ios/App/UITests/             the share sheet from Safari and the widget gallery, driven like a person would
```

The folders under `ios/App` other than `App` are Xcode synchronized folders: a new file in one is part of
its targets with no project edit.

Plugins: `@capacitor/app` (folevi:// links), `@capacitor/haptics`, `@capacitor/keyboard` (the web view
shrinks above the keyboard), `@capacitor/status-bar`. Links out use `SFSafariViewController` directly from
FoleviNativePlugin (it sees every navigation, so the page needs no changes for it); settings live in
`UserDefaults`. So `@capacitor/browser` and `@capacitor/preferences` aren't needed.

### Loading the site, and offline

The web view loads `https://app.folevi.com/documents` (the site's `/` is only a server redirect, which the
service worker doesn't keep). `WKAppBoundDomains` in Info.plist lists `app.folevi.com` (and `localhost`,
Capacitor's own scheme for the offline page), with `limitsNavigationsToAppBoundDomains`: that's what lets the
site's service worker (`apps/web/public/sw.js`) run in WKWebView, and it also keeps injected scripts and
message handlers to Folevi's own pages.

- First launch needs the network. After that the service worker serves the app shell and its scripts, and
  the app opens offline with what this device has (the same as the installed web app).
- Checked in the Simulator: the service worker registers and controls the page, caches the shell and the
  static files, and serves `/documents` with the server stopped. The session check
  (`authPhaseOf` in `lib/convex/provider.tsx`) only signs anyone out on a definite answer from the auth server
  (no session in a successful reply, or 401/403). No answer, a gateway or server error, a rate limit, a check
  that hangs for six seconds, or the device offline are all "offline": the app opens from this device's copy
  and the sync status says Offline, whether or not `navigator.onLine` knows. `AccountGate` checks once more
  before it goes to sign in and stays offline when that check has no definite answer either (e2e
  `offline.spec.ts`, unit `test/auth-phase.test.ts`).
- When neither the network nor the cache has the page, Capacitor shows `www/offline.html` ("Folevi can't
  connect", Try again).

The local dev server for the Simulator: `pnpm sync:dev` (FOLEVI_URL=http://app.localhost:3002). A build phase
adds `app.localhost` to the app-bound domains and allows plain http to it, in Debug builds only; Release
builds keep Info.plist as written (https to app.folevi.com only). The Simulator resolves `app.localhost` to
the Mac.

### The bridge

`bridge.js` runs before the page's own scripts, in the main frame, and only when the page's origin is the one
the app loads (FoleviViewController fills it in). It defines a frozen `window.foleviNative` on top of
Capacitor's bridge, marks `<html data-native="ios">`, and adds `viewport-fit=cover, maximum-scale=1` to the
viewport tag (so the page can lay out under the status bar, and focusing a small field doesn't zoom).

```ts
window.foleviNative = {
  platform: "ios",
  version: "1.0",
  haptic(kind: "light" | "medium" | "heavy" | "success" | "warning" | "error"): void,
  setStatusBar(theme: "light" | "dark"): void,          // the page's theme; light text on a dark page
  openExternal(url: string): Promise<boolean>,           // in-app Safari view (mail and phone: the system)
  getSettings(): Promise<{ lock: boolean; lockAfter: 0 | 60 | 300 | 900; method: "faceID" | "touchID" | "opticID" | "passcode" | "none" } | null>,
  setSettings(patch: { lock?: boolean; lockAfter?: 0 | 60 | 300 | 900 }): Promise<Settings>,
  onCommand(listener: (c: { type: "link"; url: string }) => void): () => void,   // folevi:// links
  // stage 2: device, setCredential, clearCredential, takeShares, finishShare, scanDocument (below)
  // stage 3, notifications:
  pushStatus(): Promise<{ permission: "notDetermined" | "denied" | "granted"; enabled: boolean; asked: boolean;
                          token: string | null; environment: "sandbox" | "production"; bundleId: string }>,
  enablePush(): Promise<PushStatus>,                    // asks iOS the first time, then Apple's device token
  disablePush(): Promise<void>,
  setBadge(count: number): void,                        // the bell's unread count on the app icon
  openNotificationSettings(): Promise<void>,            // Folevi's page in iOS Settings > Notifications
  // search in files (Native/TextRecognition.swift): the words in an image, read with Vision on the device
  recognizeText(image: { data: string /* base64 */; type: string; handwriting?: boolean }): Promise<{ text: string } | null>,
};
```

bridge.js also asks the app (`FoleviNative.accessibility`, `Native/SystemSettings.swift`) for what iOS knows and
a web view can't read, and asks again whenever it changes (the `folevi:accessibility` window event): it marks
`<html data-reduce-transparency>`, `data-increase-contrast` and `data-bold-text`, and sets `--ios-text-scale`
(Dynamic Type, below). A tap on the status bar reaches the page as `folevi:status-bar-tap` (below).

The page's typed view is `apps/web/src/lib/nativeApp.ts` (`nativeApp()`, `inIosApp()`, `canPurchaseHere()`,
`withoutPurchaseHints()`, `haptic()`), next to `lib/desktop.ts` for the Mac app. Every FoleviNative call checks
that the web view is showing the app's own origin (the offline page, for one, can't read or change the lock).

### Links

FoleviNativePlugin decides where every navigation goes:

- Folevi's own pages stay in the web view; one opened as a new window (`target=_blank`, `window.open`) loads
  there too, since the app has one window.
- Other sites open in an in-app Safari view over the app. Embeds (a video in a note) load in their frame.
  Folevi's pricing page (folevi.com/pricing, reachable only through the app host's redirect of /pricing) is
  never opened.
- A navigation called off on purpose (a redirect sent to the Safari view) doesn't end on the offline page:
  `NavigationGuard` in FoleviViewController.swift sits in front of Capacitor's navigation delegate and drops
  those cancellations, which Capacitor would otherwise treat as a network failure.
- `mailto:`, `tel:`, `sms:` and `folevi:` go to the system. `javascript:`, `file:` and other apps' schemes
  never load.
- `folevi://` links from other apps reach the page through the App plugin; the page reads them with
  `apps/web/src/lib/deepLink.ts`, which accepts exactly what the Mac app's `parseDeepLink` accepts (a test
  checks the two agree). folevi://new makes a new note; folevi://quick-add opens Quick add task.

### Face ID lock

Off by default. Settings > This device (shown only in the app, like Settings > Desktop app in the Mac app)
turns it on, which asks for Face ID once, and picks when to ask again: immediately, or after 1, 5 or 15
minutes in the background. The choice is kept on the device (`UserDefaults`), never on Folevi's servers.

While it's on, a cover (the F, "Folevi is locked", Unlock with Face ID) hides the app whenever it leaves the
screen, so the app switcher's snapshot shows the cover. Coming back after the chosen time asks for Face ID,
falling back to the device passcode (`LAPolicy.deviceOwnerAuthentication`). Canceling leaves the cover and its
button; it doesn't ask again by itself. A device with no passcode can't turn the lock on; if the passcode is
removed later, the lock steps aside rather than shut the person out.

### What the web app does inside the iOS app

All of it hangs on `data-native="ios"` (CSS) or `nativeApp()`/`canPurchaseHere()` (scripts); browsers and the
Mac app are unchanged.

- **Safe areas** (`globals.css`): the app's frame (`.ui-shell`) keeps clear of the status bar, the home
  indicator and the landscape camera housing, with the canvas colour showing behind the status bar. Full-page
  canvases (sign in) get a clear border instead, pages without one (onboarding) pad the body; the sidebar
  drawer, toasts, and the Ask Foli AI button and chat move in by the same insets. Long presses open Folevi's
  own menus, not iOS link previews.
- **Layout**: iPhone gets its own interface (below, "iPhone interface"); iPad gets the tablet and desktop
  layout, with tabs, except in a compact window (below, "iPad"). There's one tab strip on iPad (the web app's
  own); iOS adds no chrome.
- **Keyboard**: the web view shrinks above the keyboard (Keyboard plugin, `resize: native`), so the editor
  and what floats at the bottom of the page (on iPhone the bar of writing tools) sit above it.
- **Status bar** follows the app's theme (light or dark), not only the system's. Tapping it scrolls the
  screen back to its top, as in any iOS app: the page scrolls inside its views, so the web view's own scroll
  view has nothing to scroll. A scroll view of the app's own behind the web view (`StatusBarTapProxy`) is the
  one iOS asks; the page is told (`folevi:status-bar-tap`) and bridge.js scrolls whatever scrolls under the
  middle of the screen (a list, a note, a sheet) to its top. A page can take it first (`folevi:scroll-to-top`,
  cancelable).
- **Dynamic Type**: the text follows iOS's text size, from the smallest size up to 150% (past that the screens
  don't have the room, and iOS's Zoom is there for more): `--ios-text-scale` is applied as
  `-webkit-text-size-adjust` on `body`, not the root, so only text grows and rem-based spacing and the layout
  keep their size (rows grow with their text). Checked at the largest standard size (135%) on iPhone and iPad.
- **Reduce Transparency** (a web view can't read it: the app marks `data-reduce-transparency`): glass becomes a
  solid surface with its rim (`.ui-liquid`, menus, the desktop layout's glass, the fade behind a screen's bar).
  **Increase Contrast** makes the glass nearly opaque with a visible edge and the app's lines and muted text
  stronger (WebKit's `prefers-contrast: more` too). **Reduce Motion**: WebKit reports it as
  `prefers-reduced-motion`, which turns off pushes and pops, sheet springs and the editor's motion.
- **Haptics**: a light tap when a task is checked off (editor and Tasks), a medium one for a new note, light
  and medium when something is dragged and dropped, medium when a long press opens a menu.
- **Swipe back**: the edge swipe steps back through the router's history (it uses `pushState`). Pull to
  refresh doesn't exist and the page doesn't rubber-band; views scroll on their own.
- **Recording**: the existing recorder, microphone only. iOS lets an app record in the background only with
  a background audio mode, which the app doesn't have, so the recording pauses when Folevi leaves the screen
  and carries on when it's back (with a note saying so).
- **No passkeys yet**: WebAuthn in the app's web view needs Associated Domains (below). Sign in with a passkey
  and Add a passkey are hidden in the app until then.
- **No buying** (App Store Review Guideline 3.1.1): see below.

### iPhone interface

On an iPhone the app doesn't look like the web app in a phone browser: it has the shape of an iOS app, built
in the web layer (`apps/web/src/components/iphone`), so it works from iOS 17 and ships with the site like
everything else.

**When it's on.** `isIphoneApp()` / `useIphoneApp()` (`lib/iphone.ts`): the page is in the iOS app
(`inIosApp()`) and the web view's user agent says iPhone (portrait and landscape), or it's the iPad app in a
window narrower than 700 px (below, "iPad"). The iPad app asks for the desktop site, so its web view reports a
Mac with a touch screen and keeps the sidebar layout when there's room; a phone's browser keeps the mobile web
layout; the Mac app and desktop browsers never see it. Shell marks `<html data-iphone>` while it's on;
the iPhone CSS in `globals.css` hangs on that mark, and the components check the hook. Nothing else changes
for any other surface (e2e `iphone-app.spec.ts` checks a phone browser too).

**The shell.** `Shell` renders `IphoneShell` instead of the sidebar, tab strip and drawer. One screen at a
time fills the display; each view's `ViewChrome` becomes an `IphoneScreen` (`Screen.tsx`):

- A large title (Spectral, 34pt) at the top of the content, which hands over to a small centred title in
  the bar once it scrolls under it, with a soft blur fading in behind the bar. Views pass their iPhone look
  as `ViewChrome`'s `iphone` option (title, subtitle, actions, a header under the title); a view that
  doesn't gets a large title and its usual facts and actions in a row under it.
- A round glass Back button whenever the screen isn't a tab's first one: it steps back through the tab's
  stack, or (opened from a link, with nothing behind it) goes to the screen's parent. The edge swipe goes
  back too (WebKit's own interactive swipe, `allowsBackForwardNavigationGestures`).
- The screen's actions in a glass pill on the right.
- **Each tab keeps its own stack** (`tabStacks.ts`), as iOS tab bars do: Home > a folder > a note, then Tasks,
  then Home again shows that note, scrolled where it was. The browser's history is always the current tab's
  stack (`rewriteHistory` in `lib/app/historyNav.ts` steps back to the first entry, heard by nobody, then
  replaces and pushes), so Back, the edge swipe and `canBack` stay inside the tab. Tapping the tab you're on
  pops to its first screen (sliding), or, already there, scrolls to the top. A link to another tab's first
  screen (Calendar from Tasks' More) switches to that tab; Home or Calendar opened from deeper in their own
  tab pops to its root; another place (Personal, a workspace) starts the other tabs again. Each screen's
  scroll position is kept as it scrolls and restored after Back and a tab switch (also when the screen is
  drawn again while it loads). The stacks live in sessionStorage, so a reload keeps them. The popstate
  listener is added when `historyNav.ts` loads, before Next's router, so the position is known before the
  page a Back leads to is drawn (Chromium calls window listeners in the order they were added).
- Push and pop: a new screen slides in from the right over the old one (which eases left and dims); Back
  slides the top screen away (`transitions.ts`: the leaving screen is a copy of its elements, taken the
  moment the router moves, `onHistoryMove` in `lib/app/historyNav.ts`). Switching tabs, the edge swipe and
  reduced motion don't animate.

**Liquid glass.** Floating chrome uses `.ui-liquid` / `.ui-liquid-strong` (a frosted fill, a fine bright rim
and a soft shadow, light and dark, `--liquid-*` in `globals.css`); only small floating things are blurred
(bars, pills, menus, sheets), never a scrolling page. `prefers-reduced-transparency` makes them solid. Two
corner tokens exist for this interface only: `sheet` (28) and `capsule` (fully round), and
`test/radius.test.ts` keeps them inside `components/iphone` and `globals.css`.

**The tab bar** (`TabBar.tsx`): a glass capsule with Home, Tasks and Calendar on the left (the current one on
a soft glass highlight), and one with Foli AI and + on the right, floating above the home indicator. It
steps away while the keyboard is up (Capacitor's `keyboardWillShow`/`Hide`, and focus in a text field), on a
note (which has its own bars), on the Foli AI page and in Select mode. + opens New note, From template, New
folder and Quick task; on Tasks it opens Quick task straight away.

**Screens.**

- **Home** (`IphoneHome.tsx`): the avatar (account and places sheet: Personal and workspaces with a check,
  the workspace's people and settings, Settings, Help, appearance, Sign out) and a pill with notifications
  (a sheet) and More; "Home" with the place under it; a search field that opens search; recent notes as a
  row of their cards; Catch me up (with Foli AI), All notes, Drafts, Shared with me, Changes and Reviews as
  rows with counts; Starred, Folders (rows with note counts; a folder's screen lists its subfolders) and
  Tags (folded) sections, empty ones as a quiet grey box; Templates, Archive and Trash.
- **Lists** (All notes, Drafts, a folder or tag, Starred, Archive, Trash, Templates; `NoteList.tsx`): a large
  title, a search field filtering what's loaded, Select (a bar of Move, Copy to, Star, Archive and Delete takes
  the tab bar's place), and a More menu with Cards or List and the sort. Rows swipe: right to star, left to
  archive or delete (a long swipe runs Delete). Every card and row has its long-press menu.
- **A note**: the page fills the screen under Back, the note's place (a glass chip: its parent page, folder
  or Drafts) and a pill with Share and the note's "…" menu; a note without artwork is a full-width sheet of
  paper. At the bottom, glass bars with Comments, Style and Format on the left and Foli AI and Insert on
  the right, each opening its tool as a sheet. While writing, a bar over the keyboard has to-do,
  bullets, a heading, outdent, indent, an image, undo, redo and a key that puts the keyboard away (its
  buttons never take focus, so the keyboard stays up). The line being written stays above that bar (the note
  scrolls inside its page, so `useCaretInView` in `chrome.tsx` scrolls it when the keyboard comes up, the web
  view settles at its new height, and the caret moves). Selecting text puts the formatting bar on the writing
  bar, in its place, so it never meets iOS's own edit menu over the selection; the slash, @ and [[ menus fit
  between the line and the writing bar (`visibleBottom()` counts the bar).
- **Wide blocks** (a table, a long formula) scroll sideways inside the note, with momentum, never the page
  (`.fb-hscroll`, `scrollEdges.ts`): a soft fade on an edge says there's more that way, and on the iPhone they
  run to the screen's edges, starting in line with the text. Code blocks wrap; images and embeds fit the width.
- **Moving blocks**: press and hold a line until its menu opens, then move the finger: the menu gives way and
  the block lifts and follows it (a medium tap when it lifts, a light one when it lands), as on iOS
  (`HOLD_MOVE_EVENT` in `lib/touchContextMenu.ts`; the view under the finger stays still while a held menu is
  up). Holding the grip lifts it too (280 ms), and moving it right away drags as before. On a touch screen the
  grip is slimmer and keeps a gap before the text.
- A note that starts with an image (or any media) opens with nothing selected (ProseMirror would select that
  block and its alt text tools would show), on every platform.
- **Tasks** (`Tasks.tsx`): the views as chips (the chosen one names itself), tasks grouped by note under
  headers that fold away (Upcoming by day), a tap opens a task's details, the box checks it off, a swipe
  right completes it and left moves it to tomorrow or opens its date.
- **Calendar** (`Agenda.tsx`): an agenda by default: today as the large title ("Oct 16", "Today · Friday"),
  overdue tasks first, then each day of the next month under its own header (Tomorrow named), with tasks and
  subscribed calendars' events; each day's "…" adds a task on that day. Week and Month are in More.
- **Foli AI**: a sheet (half the screen, pulled up for all of it) titled New chat, with suggestions and the
  composer as a card; the history button opens the Foli AI page. On a note, its Foli AI tool (the note's own
  panel) opens in the tool sheet.
- **Search**: the command palette as a full-screen sheet, the field at the top with Cancel and results as
  rows.
- **Settings**: a grouped list (inset sections, icons, chevrons) where each section is its own screen, and
  every section is built the way iOS Settings is (`SettingsKit.tsx`; the desktop forms are unchanged):
  inset grouped sections with a short sentence-case heading and the explanation under them; rows with a label,
  a value, a switch (iOS's shape, dark when on, light in dark mode) or a chevron, split by hairlines that start
  past the row's icon; every choice (theme, time zone, editor text size, a digest's time, a member's role, a
  guest's access, when the lock asks again) a pushed screen with a check by the chosen one and a light tap
  when another is picked (time zones have a search field); short text as fields inside their rows (Name),
  longer or one-off text on a screen of its own with Done (a passkey's name, a memory, Change password, a new
  token or webhook, an invitation); destructive actions as red rows confirmed by an action sheet (a warning
  tap). A section's pushed screens are `?screen=<id>` on its address, on the Settings tab's stack, so Back,
  the edge swipe and the collapsing large title work; the section stays mounted under them, so a draft
  survives picking a choice. Every section keeps what it can do on the web; Plan & billing shows the plan and
  usage only. e2e: `iphone-settings.spec.ts` walks the tree.

**Sheets** (`Sheet.tsx`): in the iPhone app every `Dialog` and `Popover` is a sheet from the bottom with a
grabber (dragged down to dismiss from the grabber or the header, or from the content once it's at its top;
medium sheets drag up to full height), or for short forms (`size="sm"`: confirmations, New folder, editing a
task) a glass card in the middle, which sits above the keyboard because the page shrinks for it. Both are
modal `<dialog>`s: the page behind is inert, Escape closes, focus returns. Menus keep their place next to
what opened them, with iOS-sized rows on glass, and stay below the status bar.

**Haptics**: light for a tab change and a task checked off, medium for a new note and a long press, warning
when confirming something destructive (a danger button, a menu's Delete, a swipe's Delete).

**Accessibility**: 44pt targets, every icon button named, the large title is the screen's heading, sheets
are labelled dialogs, swipe actions are also in the long-press menu; VoiceOver reads the bar (Back, the small
title, the actions), then the screen, then the tab bar. The text follows Dynamic Type, glass follows Reduce
Transparency and Increase Contrast, and motion follows Reduce Motion (above, "What the web app does").
`e2e/a11y.spec.ts` runs axe on the iPhone interface (Home, a list, Tasks, Calendar, Settings, a sheet) in light
and dark.

**Reviews** on touch: a tap on the card shows the answer; then a swipe right is Good and a swipe left Again
(the card follows the finger, a success or warning tap when it goes), or a rating button.

**Testing**: `e2e/iphone-app.spec.ts` (an iPhone-sized window with an iPhone user agent and a stand-in
bridge: tab bar, large titles, Back, the + menu, New folder, Quick task, a note's bars and sheets, Settings,
and a phone browser keeping the web layout). In the Simulator: `pnpm sync:dev`, then Debug builds show the
dev server; `node scripts/simulator.mjs eval '...'` drives it.

Not done yet: an interactive Back swipe drawn by the app itself (WebKit's own swipe shows its snapshot of the
page behind, which after a tab switch can be the screen shown just before it), and per-point pressure on the
whiteboard. Settings > Desktop app (only in the Mac app) keeps its web cards if opened by its address.

### iPad

The iPad app keeps the web app's sidebar layout, with tabs, in portrait and landscape and in any window wide
enough for it. A window narrower than 700 px (Slide Over, a third of Split View, a small Stage Manager window)
has no room for the sidebar and a note, so it takes the iPhone's compact interface (tab bar, large titles,
sheets) as iPad apps do in a compact-width window, and goes back to the sidebar layout, in place, when the
window widens (`isIpadApp()`, `useIphoneApp()` follows the width; e2e `iphone-app.spec.ts`).

- **Multitasking**: all four orientations and no `UIRequiresFullScreen`, so Split View, Slide Over and Stage
  Manager's resizable windows work. One window: Capacitor has one scene
  (`UIApplicationSupportsMultipleScenes` false), so two Folevi windows side by side aren't possible.
- **Hardware keyboard** (`Native/KeyCommands.swift`): New Note (⌘N), Search (⌘K), Quick Add Task (⇧⌘A), Ask
  Foli AI (⌘J), Today's Tasks (⌥⌘T), Show or Hide Sidebar (⌘\), Back (⌘[) and Forward (⌘]) are UIKeyCommands,
  listed in the overlay iPadOS shows while ⌘ is held, and handed to the page as the same key press on what has
  focus, so the web app does what it does for them anywhere (plain ⌘N makes a note in the app; a browser keeps
  it for a new window). Editing keys (⌘B, ⌘I, ⌘Z, ⌘C) stay with the web view. `native '{"command":"key",
  "title":"Search"}'` presses one in a Debug build.
- **Pointer**: WebKit turns the trackpad and mouse into hover and mouse events, so the web app's hover states,
  cursors and right-click menus work as on a Mac.
- **Apple Pencil**: the whiteboard draws with a pen, a finger or a mouse; once a pen has drawn on a whiteboard,
  only the pen draws there (a resting palm doesn't) and a finger scrolls the note, as in iPad drawing apps.
  Strokes have a fixed width (the whiteboard's format has no pressure). Scribble works in the app's text fields
  as in any web view.
- **Drag and drop** from other apps: images and files dropped on a note are inserted where they land (the
  editor's drop handler, as in a browser); text and web pages too, cleaned up like a paste.
- Status bar taps, Dynamic Type, Reduce Transparency and the menus' and sheets' glass work as on the iPhone; the
  floating keyboard is a narrow window's keyboard to WebKit, so the page shrinks above it the same way.

## Widgets, the share sheet, Siri and Spotlight (stage 2)

Four targets: the app (`com.folevi.ios`), the share extension (`com.folevi.ios.share`), the widgets
(`com.folevi.ios.widgets`: WidgetKit and the iOS 18 control) and the unit tests. Everything outside the web view
talks to Folevi through the REST API (`/api/v1`) with a token made for the device; the web view stays the only
place that syncs, so anything with files goes through it.

### The device's token

- When someone is signed in inside the app (and online), the page asks the app which token it holds
  (`foleviNative.device()`: the install id, the model, the account and token ids it holds, never the token)
  and calls `apiTokens.ensureDevice` (convex/apiTokens.ts). The server keeps the token the app holds, or makes
  a new one (first launch, another account, revoked in Settings) and the page hands it to the app
  (`setCredential`), once (`lib/nativeDevice.ts`, from `components/app/NativeBridge.tsx`).
- The token is an ordinary personal access token named for the device ("Folevi for iPhone (iPhone 18 Pro)"),
  with notes:read, notes:write, tasks:read and tasks:write, never expiring. Its places follow the person:
  Personal and every workspace they're in at the time of each request, so joining or leaving a workspace
  needs no new token. One per device (its install id), up to ten devices (signing in on an eleventh replaces
  the one used longest ago); they don't count towards the 20 tokens a person makes. Settings > Connected apps
  lists it with the others, marked "This device" in the app, and Revoke works the same; the next launch then
  makes a new one. The REST API's rate limits apply to it like any token.
- The app keeps it in the Keychain (`DeviceCredential`): access group `<team prefix>com.folevi.shared`
  (`keychain-access-groups` in each target's entitlements; Info.plist's `FoleviKeychainGroup` carries the
  same expanded name to the code), readable after first unlock (`AfterFirstUnlockThisDeviceOnly`, so widgets
  refresh on a locked phone), never in iCloud, never logged. Keychain sharing works in the Simulator (the widgets
  and the share extension read the token there), so nothing falls back to the App Group for it. The account and token ids, the API's address
  (the site the app loads + `/api/v1`) and the install id live in the App Group's settings.
- Signing out (any way: the menu, the session ending) revokes it on the server while the session still can
  (`apiTokens.revokeDevice`), and the app deletes it with the widgets' copy, the share sheet's places and the
  Spotlight entries (`clearCredential`). A 401 anywhere native also forgets it.

### App Group

`group.com.folevi` (`com.apple.security.application-groups` in all three targets): the settings above, the
places for the share sheet, `widgets.json` (the widgets' copy of tasks and notes), `Shares/` (the share queue),
and a link an App Intent left for the app (`PendingLink`). Files are written with
`completeUntilFirstUserAuthentication`.

### Share extension: Save to Folevi

Takes links, text, images and PDFs from any app (an activation rule, so it isn't offered for other files).
A compact card in the app's neutral look: Cancel, "Save to Folevi" (Spectral), Save; the title (Safari's page
title, else the first line, else the link's host); a preview (the link, the text, the files with thumbnails);
"Save to" with "Inbox in Personal" and each workspace (from `GET /places`, cached, refreshed while the sheet is
open; the last choice is remembered). Images are kept as PNG, GIF, WebP or JPEG (HEIC from Photos becomes
JPEG), up to ten files of 20 MB, like the web's share page.

Saving (`ShareSaver`): text and links go straight to the Inbox through `POST /api/v1/notes` (`inInbox`, with
an Idempotency-Key) when there's a token and a connection; the sheet says "Saved to your Inbox". Anything
else (offline, signed out, a place that's gone, any refusal, and every share with images or PDFs, since the
REST API doesn't take files) is written to the App Group queue first and the sheet says "Saved, it will sync
when Folevi opens". When the app opens (and whenever it comes back), the page takes the queue
(`takeShares`), saves each one with the web app's own share flow (`lib/share/save.ts`, the same code as
`/share`: through the sync engine, files through the upload queue, offline too) into the Inbox chosen, says
"Saved what you shared to your Inbox", and only then lets the app delete it (`finishShare`). A file waits in
the upload queue until its new note has reached the server (`lib/sync/uploads.ts`), so a share saved offline
uploads its photos once the connection is back, and a failure that can pass never drops one. A share kept
for one account is never saved into another.

### Widgets

From the App Group's copy (`WidgetStore`), so they draw at once and offline. One timeline provider for all of
them: refreshed from the REST API when the copy is older than ten minutes (open tasks due today or before,
and the ten recent notes), next look in 20 minutes (or just after midnight). The app also refreshes the copy
and reloads every widget when it comes to the front (at most every five minutes) and when it goes to the
background.

- **Today** (small, medium, large, extra large on iPad): today's and overdue tasks, overdue first, then by time
  and priority; "Overdue · Yesterday" in red. The large and extra large ones put the date under the title, the
  overdue tasks in an Overdue group of their own, and, when today leaves room, tomorrow's tasks under
  Tomorrow and a "+ Add task" row that opens Quick add task (on the extra large one, Tomorrow and Add task take
  the second column). The copy is fetched through tomorrow (`due_before` the day after); everything else counts
  today's and overdue ones only (`openTasks`, `overdueTasks`, `todayTasks`, `tomorrowTasks`); a circle checks a task off right there (iOS 17 interactive
  widgets, `ToggleTaskIntent` → `PATCH /tasks/{id}`): it disappears at once, and a check made offline is sent
  with the next refresh. Tapping a task opens its note; the rest opens Tasks > Today. Empty: "Nothing due
  today".
- **Recent notes** (small to extra large): the last edited notes with their place and when; each opens its
  note (`folevi://d/<id>`, an Inbox page's `inbox-` id too).
- **Quick add** (small): opens Quick add task (`folevi://quick-add`). The F (`WidgetMark`) fills its frame at
  the title's height, there and on the signed-out widgets.
- **Lock Screen**: circular (how many tasks today), rectangular (the next task and when), inline ("3 tasks
  today").
- **Control Center / Lock Screen / Action button** (iOS 18 and later): "Quick add task", which opens the app on
  Quick add task.
- Rows are one line each, so no title can push a widget out of shape: just the text in small widgets, the due
  day (or the note's time) at the end of the row in medium ones, under it in large ones, and two columns
  in the iPad's extra large ones once there are more than five.
- Signed out: "Open Folevi to sign in". The look: white or near-black from the chrome tokens, Spectral
  SemiBold for titles (bundled in the extensions; the SIL Open Font License is in the font file's metadata),
  dark mode, the system's tinting on a tinted Home Screen.

### App Intents, Siri and Shortcuts

`AppAndWidgets/Intents.swift`, phrases in `Native/FoleviShortcuts.swift`:

- **Add a task** ("Add a task in Folevi"): text, an optional due date and an optional note (a `NoteEntity`);
  runs in the background through `POST /tasks` and refreshes the widgets.
- **New note** ("New note in Folevi"): opens a new note; with text, makes the note from it (Drafts: the first
  line is the title, each other line a paragraph) and opens it; offline, the text is kept like a share and
  reaches the Inbox when the page opens (the app opens on Home meanwhile).
- **Open note** ("Open a note in Folevi"): a `NoteEntity` found by searching Folevi (`GET /notes?q=`), the
  recent notes as suggestions.
- **Show today's tasks** ("Open my Folevi tasks"), **Quick add task**.

Intents that open the app hand it a folevi:// link (`PendingLink`): straight to the page when the app is
running, else kept in the App Group and opened when the app becomes active.

### Spotlight

`SpotlightIndex`: the 30 most recently edited and 30 starred notes (`GET /notes?starred=true`), each with its
title, the start of its text (Markdown taken out) and where it is (folder path, else the place), indexed when
the app comes and goes; a note's details are fetched only when it changed since it was indexed, and notes
that are neither recent nor starred any more are removed. Tapping a result opens the note (the activity's id
becomes `folevi://d/<id>`). Signing out removes them all.

### Links into the app

Widgets, intents, Spotlight, Handoff of a Folevi page and links from other apps all become folevi:// links and
go through the same path: Capacitor's App plugin (`appUrlOpen`) to the page's `lib/deepLink.ts`
(`DeepLinkRouter`). On a cold launch a link waits until the web view and its plugins exist, then the App plugin
keeps it until the page listens. `folevi://quick-add` now opens Quick add task (it used to make a new note);
`folevi://new` makes a new note. An Inbox page (its id is `inbox-` and a hash, not a note id) opens with
`folevi://d/inbox-<hash>`, which `lib/deepLink.ts`, the Mac app's `parseDeepLink` and `DeepLink.parse` all
accept (and nothing else under `d/`); `folevi://inbox` (the web's `/inbox`) opens the Inbox page of the place
the app is in, found by the server or, offline, by that same id.

### Document scanner

The editor's Insert panel (Media) and slash menu have "Scan document" (the camera's scanner, VisionKit, where
`VNDocumentCameraViewController.isSupported`) and "Scan from photos" (the system photo picker, up to ten
pages), only in the app. Each page comes back as a JPEG of at most 2200 px on its long side, with the text
read from all pages (Vision, accurate, with language correction). The page inserts the pages as image blocks
through the usual upload queue (works offline) and the text in a closed toggle "Text from the scan" under
them, so search finds it. The Simulator has no document camera, so only "Scan from photos" shows there.

### Testing it in the Simulator

- Unit tests: `pnpm test` (or `node scripts/simulator.mjs test "Folevi iPad Pro 13"`): the API client, folevi://
  links (the web's cases), the share content and queue, the saver's fallbacks, the Keychain group, the App
  Group, the widgets' copy and timeline, Spotlight's items, and notifications (the categories and buttons,
  where a tap or a button leads, Snooze's request).
- The share sheet and the widget gallery, driven through Safari and the Home Screen (needs a signed-in Debug
  build on the device): `TEST_RUNNER_FOLEVI_SHOTS=<dir> xcodebuild test -project ios/App/App.xcodeproj -scheme
  FoleviUITests -destination 'platform=iOS Simulator,name=Folevi iPhone 18 Pro'` (screenshots of each step go
  to the folder). The share sheet, the widgets (added from the gallery, a task checked off on the Home Screen)
  and Scan from photos pass; the Spotlight one often can't open Spotlight in the iOS 27 Simulator (its
  Search pill doesn't answer to a tap there), so Spotlight is checked with `native '{"command":"spotlight"}'`
  (what the index holds) and `"activity"` (a result tapped) instead.
- `node scripts/simulator.mjs widgets <folder>` draws every widget (each family, the empty and signed-out
  states, the Lock Screen's) from this device's copy, in light and dark, plus a sheet filled with long titles
  (`widgets-light.png`, `widgets-dark.png`, `widgets-full.png`): the same views as the widget extension at the
  iPhone 18 Pro's sizes (extra large: the 13-inch iPad's), with WidgetKit's margins and the Lock Screen's
  vibrancy approximated.
- `node scripts/simulator.mjs native '<json>'` runs the native parts in a Debug build: `{"command":"status"}`,
  `"refresh"` (the widgets' copy), `"timeline"`, `"spotlight"` (index, then search the index), `"share"` (the
  extension's save path with sample items, `"image": true` to queue one), `"intent"` (`"name": "addTask" |
  "newNote" | "openNote" | "showToday" | "quickAdd"`), `"complete"` (a widget's check-off), `"activity"` (a
  Spotlight result tapped), `"widgets"` (what the `widgets` command uses).
- The Lock Screen widgets and the Control Center control: long-press the Lock Screen > Customize, or Control
  Center > edit, and search for Folevi.

## Notifications (stage 3)

Reminders and @mentions reach the iPhone or iPad through Apple's push service (APNs), the way browsers get
them through web push (`convex/pushSend.ts`). Web push doesn't work inside WKWebView, so the app has its own.

### On the device

- **Asking**: never at launch. iOS asks when the person turns on "Notifications on this iPhone" (Settings >
  Notifications) or, the first time they set a reminder on a to-do in the app (`offerPushAfterReminder` in
  `lib/nativePush.ts`, from the task's Reminder field). Either way only once: after that the switch decides.
- **Settings > Notifications**: in the app the browser's web push card is replaced by "Notifications on this
  iPhone" (or iPad, `NativePushCard.tsx`): a switch, how many other devices get them, and "Open iOS Settings"
  when notifications are off for Folevi in iOS. The card only shows once the server can send them
  (`push.apnsAvailable`, false until the APNs key is set). What arrives follows the In app column above it.
- **Registering**: `enablePush` asks iOS, registers with Apple and hands the device token (hex) to the page,
  which sends it with the app's install id and the model to `push.registerApns`. On each launch (and each
  return to the front) a device with notifications on registers again, in case iOS changed the token; one
  whose notifications were turned off in iOS Settings is removed on the server (`syncPushRegistration`).
  Turning the switch off removes it (`push.unregisterApns`), and so does signing out (`forgetThisDevice`,
  which also turns notifications off in the app, clears what's in Notification Center and the badge).
- **The notifications**: a reminder shows "Reminder: <the to-do>" and "In <the note>", with **Done** (checks
  the task off through the REST API with the device's token, without opening the app; offline it waits like
  a widget's check and goes with the next refresh) and **Snooze 1 hour** (moves the reminder through
  `PATCH /tasks/{id}` with `remindAt`, so it rings again from the server; offline the app shows the same
  notification again in an hour itself). A mention shows who mentioned you and where, with **Open**. A
  note's notifications are grouped (`thread-id`).
- **Tapping one** opens what it's about through the same path as every folevi:// link (`DeepLinkRouter`):
  `/d/<note>#block-<to-do>` focuses the to-do. On a cold launch the link waits for the page. folevi:// links
  now keep `#block-<id>` and `#comment-<id>` (the web, the Mac app and `DeepLink.parse` agree).
- **In front**: still a banner (`willPresent`).
- **Badge**: the bell's unread count, set by the page whenever it changes (the same count as the Mac app's
  Dock badge), and sent with each notification.
- Tapping a notification opens its note with the app running (warm) and from not running (cold), on both
  Simulators (checked again on 2026-10-16: no crash, the note opens).
- `PushNotifications` is the notification center's delegate from `didFinishLaunching`, so a notification
  that launches the app, or a button pressed while it isn't running, is heard. Capacitor's own router is
  off (`ios.handleApplicationNotifications: false` in capacitor.config.ts). The delegate uses the
  completion-handler methods and calls them on the main thread: the async ones finish elsewhere, which
  UIKit stops the app for when a tap launches it.
- `aps-environment` is in App.entitlements (development; Xcode signs distribution builds with production).
  Debug builds register `sandbox` tokens, Release builds (TestFlight, App Store) `production` ones.

### On the server

- `apnsTokens` (one row per token, and per install id): `push.registerApns` (re-registering updates the row;
  a token or device that was someone else's moves to you; a device's new token replaces its old one; at most
  20 per person), `push.unregisterApns` (by token or install id, your own only), `push.apnsStatus`,
  `push.apnsAvailable`. Deleting an account removes them (and its web push subscriptions).
- `lib/push.ts` `schedulePush` is the one place reminders (`tasks.processReminders`), mentions
  (`lib/notify.ts`) and routines send push: web push as before, and `apnsSend.sendToProfile` when APNs is set
  up and the person has a device. The bell's choices decide as before (a reminder or mention turned off
  In app isn't pushed; a burst folded into one notification isn't pushed twice).
- `apnsSend.ts` ("use node"): HTTP/2 to `api.push.apple.com` or `api.sandbox.push.apple.com` (each token's
  own environment) with Node's `http2` (`lib/apnsHttp2.ts`), a provider JWT (ES256 with `node:crypto`, `kid`
  the key id, `iss` the team, kept 50 minutes: `lib/apnsJwt.ts`). Headers: `apns-push-type: alert`,
  `apns-topic` the bundle id, priority 10, an hour's expiration, `apns-collapse-id` (the same reminder
  replaces itself). Payload (`lib/apns.ts`): `aps.alert` title and body, `sound`, `badge`, `thread-id`,
  `category` (`REMINDER`, `MENTION`), `mutable-content`, and `kind`, `path`, `taskId` for the app.
- Apple's answers: 410, `Unregistered`, `BadDeviceToken` and `DeviceTokenNotForTopic` remove the token;
  429, 5xx and no answer are tried again after 1 and 4 seconds (three tries); `ExpiredProviderToken` gets a
  fresh JWT once; anything else is given up. The log line says how many were sent, gone or failed and
  Apple's reasons, never a token or what a notification says.
- Without `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY` and `APNS_BUNDLE_ID` nothing is scheduled or sent, and
  the app hides the option. A key that isn't a P-256 private key logs `apns.key_invalid` and sends nothing.
- No Notification Service Extension: nothing is fetched or decrypted on the device (no images), so it isn't
  needed. `mutable-content` is set so one can be added later.

### Testing it in the Simulator

The iOS 27 Simulator registers for remote notifications and gets a real (sandbox) device token, so the whole
path runs there except Apple delivering a server's push, which needs the Developer Program's key. In a Debug
Simulator build that can't reach Apple, the app uses a stand-in token made from its install id.

- A notification by hand: `xcrun simctl push "Folevi iPhone 18 Pro" com.folevi.ios payload.apns`, where the
  file is the server's payload (`lib/apns.ts`), for example
  `{"aps":{"alert":{"title":"Reminder: Take the bins out","body":"In Inbox"},"category":"REMINDER","thread-id":"<note>","badge":1},"kind":"reminder","path":"/d/<note>#block-<task>","taskId":"<task>"}`.
  Long-press the banner for Done and Snooze 1 hour.
- `node scripts/simulator.mjs native '{"command":"push"}'`: the permission, the switch, the start of the
  token, and what's in Notification Center from Folevi. `{"command":"respond","action":"folevi.done",
  "userInfo":{...}}` runs a button (or a tap, with no action) without the UI.
- The Debug log (`com.folevi.ios`, category `push`) says when Done was sent or kept, and when a Snooze moved
  the reminder on Folevi or stayed on the device.
- Against Apple from the dev deployment: with a made-up key in the dev Convex env, `npx convex run
  apnsSend:sendToProfile` reaches the sandbox host and Apple answers `InvalidProviderToken` (the request and
  JWT are well formed; the key just isn't registered). Never set APNS_* on production until the real key.

## Sign in with Apple

App Store rule 4.8: an app that offers another social sign-in (Google) must offer Sign in with Apple too. The
server side is done (`docs/AUTH_DECISION.md`, "Google and Apple"; setup in `docs/DEPLOYMENT.md`, "Sign in with
Apple"), and `App.entitlements` has `com.apple.developer.applesignin` = `["Default"]` (the App ID
`com.folevi.ios` already has the capability; a build signed with the team picks it up).

**Today** the app's web view shows "Continue with Apple" and signs in like Google: iOS's sign-in sheet
(`authenticate`, ASWebAuthenticationSession) opens `/app-google?provider=apple`, the browser signs in at Apple
and hands the app a one-time code through `folevi://auth/google`, and the web view redeems it
(`components/auth/SocialSignIn.tsx`, `/native/redeem`). That works, but App Review prefers the native sheet,
which is the next step.

**Next: the native sheet.** Better Auth takes Apple's id token directly, and one small endpoint keeps a token
Folevi can revoke later:

1. The page asks the bridge, e.g. `foleviNative.signInWithApple({ nonce })`, where `nonce` is a random string
   the page made (32 random bytes, base64url) and keeps.
2. Native code runs `ASAuthorizationAppleIDProvider().createRequest()` with `requestedScopes = [.fullName,
   .email]` and `request.nonce = sha256hex(nonce)` (Apple puts the request's nonce in the id token as is;
   Better Auth accepts a token whose nonce is the raw value or its SHA-256 in hex), presents
   `ASAuthorizationController`, and answers with `{ idToken, authorizationCode, firstName, lastName }` from
   the credential (`identityToken` and `authorizationCode` as UTF-8; the name only comes the first time
   someone uses Apple with Folevi), or null if it was cancelled.
3. The page signs in with it, same origin, so the session cookie lands in the web view:

   ```ts
   const { error } = await authClient.signIn.social({
     provider: "apple",
     idToken: { token: idToken, nonce, user: { name: { firstName, lastName } } },
   });
   ```

   Better Auth checks the token against Apple's keys, the issuer, the audience (the bundle ID,
   `APPLE_SIGNIN_BUNDLE_ID`, default `com.folevi.ios`; the Services ID is accepted too) and the nonce, then
   links or creates the account exactly as the web flow does. An account with two-step verification on is
   refused (403, code `two_factor_required`): show the same message as the web
   (`socialError("two_factor_required", "apple")`) and offer the password sign-in.
4. Right after, the page sends the sheet's authorization code (single use, valid 5 minutes):
   `authClient.$fetch("/apple/native-code", { method: "POST", body: { authorization_code: authorizationCode } })`.
   The server trades it at Apple as the app (client id `com.folevi.ios`, a client secret made for it), checks
   it's for the Apple ID linked to this account, and keeps the refresh token on that account
   (`convex/lib/appleNative.ts`). If this step fails the person is still signed in; only revoking later has
   nothing to send (log it, and the next sign-in with the sheet tries again).
5. `SocialSignIn.tsx`'s `routeHere()` picks the native sheet when the bridge has `signInWithApple`, and keeps
   the browser route for Google and for older app builds.

**Revoking (5.1.1(v)), built.** Deleting the account (Settings > Security > Delete account) or removing Apple
in Sign-in methods queues the account's Apple token in `appleRevocations`, and `convex/appleRevoke.ts` asks
Apple to revoke it (`POST https://appleid.apple.com/auth/revoke`) as the client it was issued to: the bundle ID
for the native sheet's token, the Services ID for a web sign-in's (read from the stored id token's audience).
Neither waits for Apple; failures are logged with Apple's error code only and tried again (1 minute, 10
minutes, an hour, 6 hours, then daily for 3 days). Tests: `tests/convex/apple-signin.test.ts`.

## No purchases in the app

Plans are sold on folevi.com. Inside the app nothing shows a price or offers to buy, upgrade or change plans:

- Settings > Plan & billing shows the plan as it is (trial days left, renewal date, storage, AI credits,
  devices) and doesn't say where plans are bought (App Review reads that as steering). No plan cards, credit
  packs, billing portal, cancel or billing history. The workspace Plan & billing shows the plan's name and
  state only.
- The sidebar's trial pill shows the days left and isn't a button; the Free "Upgrade to Pro" pill isn't shown.
- Foli AI's "Buy more" and "Upgrade" buttons, "See plans" links (Settings > AI, Account, routines, the graph,
  "Foli AI isn't part of your plan"), "Get unlimited devices", the device limit screen's upgrade buttons and
  seat prices (Members, Invite) are hidden.
- Server messages that end with where to buy ("Buy more in Settings → Plan & billing.") lose that sentence
  (`withoutPurchaseHints`, applied in `errorMessage` and the toasts).
- The sign-in page's logo, which links to the marketing site, isn't a link in the app.
- The app never opens folevi.com/pricing, even in its Safari view.

Tests: `apps/web/test/native-app.test.tsx` (Plan & billing, AI panels and server messages in and out of the
app) and `apps/web/e2e/ios-app.spec.ts` (the whole app with a stand-in bridge).

Still on the marketing host from inside the app: Help's "Folevi docs" and the Terms and Privacy links on sign
up open there in the in-app Safari view, and the site's header has a Pricing link. That's ordinary reader-app
territory, but if App Review objects, give the site a way to hide pricing for the app (a query parameter set
by those links).

## App Review notes

- **More than a website (4.2)**: Face ID lock with a covered app switcher snapshot, offline use of everything
  on the device (service worker and the app's own storage), haptics, folevi:// links from Shortcuts and other
  apps, in-app Safari for links, native keyboard handling, iPad layout with keyboard shortcuts, and (stage 2)
  a share extension, interactive Home Screen and Lock Screen widgets, a Control Center control, Siri and
  Shortcuts actions, Spotlight search of notes and a document scanner with text recognition, and (stage 3)
  push notifications for reminders and mentions with Done and Snooze actions.
- **Payments (3.1.1, 3.1.3)**: no purchases, prices or links to buying in the app (above). Accounts made on
  the web keep their plan. Account creation is in the app (sign up), and account deletion is in Settings >
  Security (Delete account), as 5.1.1(v) requires.
- **Privacy strings**: `NSMicrophoneUsageDescription` (recording audio in a note),
  `NSCameraUsageDescription` (the file picker's Take Photo or Video, and scanning a document into a note),
  `NSPhotoLibraryUsageDescription` (scanning pages from photos; the system picker doesn't need it, but it says
  what the photos are for), `NSFaceIDUsageDescription` (the optional lock). No tracking.
  `ITSAppUsesNonExemptEncryption` is false; see "Export compliance" below.
- **Privacy labels**: the same data the web app handles (account, notes, usage for AI credits).
- **Demo account** for the reviewer: a Pro account without two-step verification, or with a code shared in
  the review notes.
- **The interface is in the app** (no remote server.url since 2026-10-22): no downloaded code, and local mode
  works with no account and no network (4.2, 2.5.2).
- **Sign in with Apple** (4.8): Apple's own sheet next to Google and email.

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in Info.plist, for the owner to confirm before external testing or
the App Store. What the app uses: HTTPS (URLSession, WebKit), and for end-to-end encryption and encrypted
libraries standard algorithms only (AES-256-GCM, X25519, Ed25519, HKDF-SHA256, PBKDF2-SHA256, Argon2id), through
Apple's CryptoKit and CommonCrypto, WebKit's WebCrypto, and the open-source @noble JavaScript libraries. Nothing
proprietary. The case for `false`: Apple's exemptions cover standard encryption in a mass-market app whose
primary function isn't information security (a notes app), and none of it needs documents uploaded to Apple.
The stricter reading: encryption beyond HTTPS that isn't only Apple's own (the @noble code) is "standard
encryption algorithms instead of, or in addition to, Apple's", which App Store Connect accepts without
documents but which, under the US EAR (5D992, License Exception ENC 740.17(b)(1)), asks for a yearly
self-classification report to BIS and the NSA (and a declaration to ANSSI to sell in France). If the owner
takes that reading: set the key to `true`, answer App Store Connect's questions once ("standard encryption
algorithms"), and file the report each year by February 1. Internal TestFlight builds aren't affected either
way.

## Release and TestFlight

`pnpm release` (`scripts/release.mjs`): the production export (`build-shell.mjs --platform ios --production
--required`), `cap sync ios`, a Release archive signed automatically on team 7K32QQ2FX8 with the App Store
Connect API key (`-allowProvisioningUpdates`), App Store profiles (made through the API when missing: the key
can't use cloud-managed certificates, so they name the "Apple Distribution" certificate in this Mac's
keychain), the export and the upload with altool. Build 2 (version 1.0) was uploaded on 2026-10-22 for the
internal group "Folevi team"; never submitted for external review.

The TestFlight build talks to production. Until the owner deploys the local commits, production lacks what
came after origin/main (end-to-end encryption, Sign in with Apple's server parts, the apple-app-site-association
route): local mode works fully, signing in works (folevi-shell is on production), but encrypted spaces and
"Continue with Apple" need the deploy, and universal links need the AASA file live.

## After joining the Apple Developer Program

Status on 2026-10-22 (team 7K32QQ2FX8):

1. **Signing**: done. `DEVELOPMENT_TEAM` on every target, automatic signing; Debug Simulator builds and a
   Release archive sign; App Store profiles for the app and both extensions exist.
2. **Associated Domains**: done in the app (`applinks:` and `webcredentials:app.folevi.com`); the web app serves
   `/.well-known/apple-app-site-association` (team 7K32QQ2FX8: `com.folevi.ios`, notes and app pages only), live
   once deployed. Universal links become folevi:// links (`DeepLink.fromWeb`).
3. **App Group, Keychain sharing, iCloud container**: done (signed builds carry `group.com.folevi`,
   `7K32QQ2FX8.com.folevi.shared` and `iCloud.com.folevi`).
4. **Push**: the app side is unchanged and signed with `aps-environment` (production in TestFlight). The dev
   deployment has no `APNS_*` variables (checked with `npx convex env list`, names only), so Settings >
   Notifications hides the switch there; production wasn't checked (never touched from here). To try it:
   the owner sets `APNS_KEY_ID=5PG87M528M`, `APNS_TEAM_ID=7K32QQ2FX8`, `APNS_KEY` (the .p8),
   `APNS_BUNDLE_ID=com.folevi.ios` on dev (`APNS_ENV=sandbox`) and/or production, then a reminder a minute
   ahead on a TestFlight build (production token) or a Debug build from Xcode (sandbox).
5. **TestFlight**: build 2 uploaded, processed (VALID) and in the internal group "Folevi team" (it has access
   to all builds). Testers install it from the TestFlight app.
6. App Store Connect: screenshots (6.9" iPhone and 13" iPad), privacy labels, age rating, the support URL
   (folevi.com/support) and the privacy policy URL (folevi.com/privacy).

On a real device (the owner's iPhone wasn't available: Developer Mode off and not connected at the time):
enable Settings > Privacy & Security > Developer Mode, connect it, then `xcodebuild -scheme App -destination
'platform=iOS,name=Faisal’s iPhone' -allowProvisioningUpdates ...` or install from TestFlight. Worth checking there:
iCloud sync between iPhone, iPad and Mac, Sign in with Apple, Face ID, push, the document scanner, widgets on a
locked phone, iOS 17 behaviour, real airplane mode, background recording, Siri phrases.

## iOS versions

The app targets iOS 17. Nothing in the Swift code needs a newer iOS: `UIButton.Configuration` and the async
`LAContext.evaluatePolicy` are iOS 15, `LABiometryType.opticID` is iOS 17. Interactive widgets and
`containerBackground` are iOS 17; the Control Center control (`ControlWidget`) is iOS 18 and only offered there
(`#available` in the widget bundle). Capacitor 8 itself supports iOS 15
and up. The app icon: `AppIcon.icon` (Icon Composer, drawn by iOS 26 and later) and `AppIcon.appiconset` with
one 1024 px PNG for iOS 17 to 25. Only iOS 27 Simulators were installed when this was built, so it was
compiled against 17.0 and run on 27.
