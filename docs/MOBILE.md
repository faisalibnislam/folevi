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

## Not carried over yet (follow-ups)

- iOS widgets, Control Center control, Siri and Shortcuts intents, Spotlight (their code is in `apps/ios`; add the
  targets to `project.yml` when wanted). The share extension is in.
- iOS's native long-press preview, date and colour pickers and keyboard bar (the web's own versions show instead).
- One bridge script for both platforms (Android still has its own `folevi-bridge.js` with its own plugin names).
- Release scripts (`pnpm release` for TestFlight and Play) and `scripts/version.mjs` writing `apps/mobile`'s versions.
- Note covers are 64 MB of the 86 MB web export: compressing them, or fetching them on demand, would shrink both apps.
