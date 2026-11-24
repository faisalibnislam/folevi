# Folevi mobile: one Capacitor app (iPhone, iPad, iPhone Duo, Android)

Decided by the owner on 2026-11-24: one web app everywhere, in the system's own web view, small and light. On phones
and tablets that is one Capacitor project, `apps/mobile`, around the web app's built-in interface (the shell export
of `apps/web`). It replaces the native SwiftUI app (`apps/ios`, its iPhone, iPad and Duo screens) and the native
Compose app (`apps/android`) as the thing we ship. Those folders stay in the repository (nothing deleted) because the
mobile app builds services from them in place, and their history holds the platform touches the owner liked.

## What runs where

| Layer | iOS (iPhone, iPad, iPhone Duo) | Android (phones, tablets, foldables) |
| --- | --- | --- |
| Interface | The web app's shell export (`web/`, from `build-shell.mjs --platform mobile`), the same for both | same |
| Web view | WKWebView at `capacitor://localhost` (the iPhone and iPad app's origin, so an update keeps its storage) | Android System WebView at `https://localhost` |
| Page bridge | `bridge/mobile-bridge.js`: `window.foleviNative` and `window.foleviShell` | `android/app/src/main/assets/folevi-bridge.js` (the Capacitor-era Android bridge) |
| Stock Capacitor plugins | App, Haptics, StatusBar, Keyboard, Browser, Share, Clipboard, ActionSheet, SplashScreen | same (the Android bridge uses its own haptics and bars today) |
| Folevi plugins | One Capacitor plugin, `FoleviHost`, routes calls to the shell services shared with the Mac app, built in place from `apps/ios/ios/App/Native/Shell` and a few `apps/ios` files (library, sign-in and session in the Keychain, E2EE device keys, Dropbox and Google Drive, reminders, the lock, push with Done and Snooze, the share extension's inbox, the scanner, Sign in with Apple) | The Capacitor-era Kotlin plugins (`FoleviShell`, `FoleviLibrary`, `FoleviAuth`, `FoleviPlaces`, `FoleviSecrets`, `FoleviAi`, `FoleviLock`, `FoleviNotify`, `FoleviHttp`, `FoleviFiles`, `FoleviCloud`, `FoleviNative`) with the Keystore, FCM, widgets, share target, Quick Settings tile, scanner |
| Native screens | None | None |
| Identity | `com.folevi.ios` (+ `.share`), App Group `group.com.folevi`, Keychain group `com.folevi.shared`, iCloud `iCloud.com.folevi`, team 7K32QQ2FX8 | `com.folevi.android` |

The iOS side reuses the shell services the iPhone app and the Mac app already share, unchanged: `App/Host/HostBridge.swift`
gives them the small host API they were written against (`BridgePlugin`, `BridgeCall`, `WebHost`), carried by Capacitor.
Android reuses the Kotlin services as they were when the app was last on Capacitor (commit `7a4155c0~1`); they had
barely changed since (import swaps only).

## Layouts: one UI, picked by the window

The web app decides in `apps/web/src/lib/iphone.ts`, by the window's size, never the model:

- **iPhone**: the phone interface (`components/iphone`: large titles, the floating bottom bar with Home, Tasks,
  Calendar, Foli AI and +, bottom sheets). Upright or sideways.
- **iPad**: the sidebar layout with iPadOS touches (`<html data-ipad>`); under 700 pt (Slide Over, a third of Split
  View) the phone interface, switching in place.
- **iPhone Duo**: open (inner screen, 951 x 669 or 669 x 951 pt) is a window at least 600 x 600 pt, so it takes the
  iPad's sidebar layout (`isWideIphone`, `isTabletApp`); closed (466 x 678) the phone interface, with iOS's side
  column kept clear by the safe-area insets. Folding or unfolding switches the layout in place, without reloading
  the page. (Checked: closed, on the iPhone Duo simulator; open: by the unit tests only, since the hinge couldn't be
  moved from scripts on the build Mac.)
- **Android**: the phone interface on phones (also sideways: short windows) and folded foldables; the sidebar layout
  on tablets and unfolded foldables.
- **Tabs** follow the web's rule everywhere the sidebar layout shows (a note from a list opens a tab that remembers its
  opener; the sidebar and New note open fresh tabs).

Tests: `apps/web/test/mobile-layout.test.ts`.

## Build and run

```bash
cd apps/mobile
CI=true pnpm install --ignore-workspace        # own lockfile, outside the workspace (like apps/ios was)
pnpm shell                                     # the web export into web/ (dev Convex from apps/web/.env.local)
pnpm sync                                      # bridge kit, then `npx cap sync` (copies web/, writes configs)
cd ios/App && xcodegen                         # only after editing project.yml (the project is committed)
```

- iOS: open `ios/App/App.xcodeproj` (scheme App) or
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'id=<sim udid>' -derivedDataPath ios/App/build/DerivedData build`.
- Android: `cd android && ./gradlew :app:assembleDebug` (JAVA_HOME: Homebrew's OpenJDK), then `adb install -r`.
- Signing in against the dev server: `FOLEVI_SERVICE_URL=http://app.localhost:3002 pnpm sync` (iOS). Android's debug
  build signs in with `http://app.localhost:3002` by default (`adb reverse tcp:3002 tcp:3002`).
- Debug helpers: `node scripts/sim.mjs eval '<js>' <udid>` runs JavaScript in the iOS Simulator's page;
  `node scripts/android-eval.mjs '<js>' <serial>` does the same on Android over DevTools.
- `npx cap sync` rewrites `ios/App/CapApp-SPM/Package.swift`; `scripts/after-update.mjs` (a Capacitor hook) raises its
  tools version so it can name iOS 18.

## Size and memory (2026-11-24, against the native apps)

Release builds of each, with the same 86 MB web export inside (64 MB of it the bundled note covers):

| | New Capacitor app | Native app (before) |
| --- | --- | --- |
| iOS app bundle (Release, iphoneos, unsigned) | **94 MB** (app code 2.5 MB, Capacitor 1 MB, share extension 1 MB) | 182 MB (app code 89 MB, widgets and share extension 2.6 MB) |
| Android APK (release, R8, all CPU types) | **125 MB** | 128 MB |
| iOS memory at Home, local library (Simulator, phys_footprint) | app 30 MB + web view 153 MB = **183 MB** | app 55 MB + web view 117 MB = 172 MB |
| Android memory at Home, local library (emulator, PSS) | app 96 MB + web view 131 MB = **227 MB** | app 89 MB + web view 116 MB = 205 MB |

The new app halves the iOS download's native part; memory is about the same as before (5 to 10% more), since the
native apps also ran the web app in a web view behind their screens. On Android the Play Store splits the APK per
device, so a phone downloads about 30 MB less than the universal APK above.

The checks: first launch, a library on the device, Home, the note editor (an edit lands in the library's `.fnote`
file), tabs on iPad and Android tablet, the share inbox (a queued share becomes a note), dark mode, iPhone Duo
closed, Android foldable open, and installing the new app over the native one on iOS and Android (the library opens
as it was). Not checked: a real device, signing in end to end, iPhone Duo open and folding, push delivery.
Screenshots: `docs/mobile/`.

## Note styles and covers (owner's decision, 2026-11-24)

The owner's words: "keep inside the app and sync if sever side changes the note styles." So:

- **Bundled stays:** the built-in covers (`public/covers`, 64 MB) and the build's snapshot of the admin-managed styles
  (`shell/snapshot.json` with their images in `shell/themes/`, written by `apps/web/scripts/snapshot-themes.mjs`) ship
  inside the app and are the offline fallback. Built-in covers are code, so new built-in art comes with app updates.
- **Sync from the server:** the server's styles are `themes.list` (public, no account), each row with `updatedAt`
  and `revision`, which serve as the version to compare. Signed in, the page already reads that list live, so a
  changed style shows without a release; what's missing is keeping the newest rows and their images on the device
  for offline use (Cache Storage in the web view), with the newest of bundled and cached winning by `updatedAt`.
- **Local mode** ("Keep notes on my devices") reads only the bundled snapshot today and promises never to contact
  Folevi (enforced by the app's network rules). Checking `themes.list` there needs the owner's OK to relax that
  promise for this one anonymous, read-only request. Asked 2026-11-24; open.
- The work is in `apps/web` (`lib/shell/snapshot.ts`, `lib/local/functions/themes.ts`, the theme loader), which the
  web session owns; coordinated through the main session.

## Not carried over yet (follow-ups)

- iOS widgets, Control Center control, Siri and Shortcuts intents, Spotlight (their code is in `apps/ios`; add the
  targets to `project.yml` when wanted). The share extension is in.
- iOS's native long-press preview, date and colour pickers and keyboard bar (the web's own versions show instead).
- One bridge script for both platforms (Android still has its own `folevi-bridge.js` with its own plugin names).
- Release scripts (`pnpm release` for TestFlight and Play) and `scripts/version.mjs` writing `apps/mobile`'s versions.
- Note styles sync (above): keep the server's newest styles and images on the device; local mode waits on the owner.
