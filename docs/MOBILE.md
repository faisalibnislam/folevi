# Folevi mobile: one Capacitor app (iPhone, iPad, iPhone Duo, Android)

> **Paused (2026-11-28, owner decision):** the Windows, Linux and Android apps are paused. folevi.com shows them as
> coming soon, with no download links. Folevi is available on the Mac, iPhone and iPad (iPhone Duo too), the web and
> Folevi Server. The Android parts below are kept as they are for when the work picks up again.

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

The web app decides in `apps/web/src/lib/platform.ts` (with `lib/iphone.ts` on top), by the window's width, never the
model (the owner's rule, 2026-11-24): any window under 700 px gets the phone interface (`components/iphone`: large
titles, the floating bottom bar with Home, Tasks, Calendar, Foli AI and +, bottom sheets), and wider windows get the
sidebar layout, with touch sizes on a touch device (`<html data-tablet>`, and `data-ipad` on Apple's). It switches in
place as the window changes.

- **iPhone**: the phone interface, upright or sideways.
- **iPad**: the sidebar layout; Slide Over or a narrow Split View the phone interface.
- **iPhone Duo**: closed, the phone interface, with iOS's side column kept clear by the safe-area insets; open (951 pt
  wide), the sidebar layout. Checked: closed on the iPhone Duo simulator; open by `apps/web/test/platform.test.ts`.
- **Android**: phones and folded foldables the phone interface; tablets and unfolded foldables the sidebar layout.
- **Tabs** follow the web's rule everywhere the sidebar layout shows (a note from a list opens a tab that remembers its
  opener; the sidebar and New note open fresh tabs).

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
- **Local mode** ("Keep notes on my devices"): the owner chose (2026-11-24) to let it check for new styles when online:
  one anonymous, read-only request for the style list, then only new or changed images, kept for offline use; nothing
  about the person or their notes is sent. The proposed endpoint is `GET <deployment>.convex.site/note-styles` (an
  HTTP action answering `themes.list`'s rows), with images from `GET <deployment>.convex.cloud/api/storage/<id>`.
  The iOS app's local-mode network rules allow exactly those two and still block everything else on Folevi and Convex
  (checked on the simulator); Android has no network rules of its own. The copy on the features and docs pages now
  says "your notes never leave the device; the app only checks Folevi for new note styles".
- The work is in `apps/web` (`lib/shell/snapshot.ts`, `lib/local/functions/themes.ts`, the theme loader), which the
  web session owns; coordinated through the main session.

## Not carried over yet (follow-ups)

Carried over (2026-11-25): the share extension, and the widgets (Today, Recent notes, Quick add, the Lock Screen's),
the Control Center control, Siri and Shortcuts (App Intents, `FoleviShortcuts`) and Spotlight. They build from
`apps/ios` in place (`project.yml`: the `FoleviWidgets` target, `com.folevi.ios.widgets`, App Group
`group.com.folevi`). With an account the app fetches their data from the REST API with this device's token
(`App/AppServices.swift`, as the iPhone and iPad app did); in local mode the page feeds them through FoleviNative
(`setWidgetSnapshot`, `indexSpotlight`, `takeLocalActions`, `finishLocalAction`: `apps/ios` Native/LocalExtensions.swift,
called by the web app's `LocalExtensions`). Taps on a widget, a Shortcut or a Spotlight result reach the page as
folevi:// links (`App/DeepLinkRouter.swift`).

Still missing:


- The background refresh task (`apps/ios` Native/BackgroundRefresh.swift: BGAppRefreshTask for accounts that aren't
  open). The widgets refresh their own copy on their timeline, and the app refreshes it as it comes and goes.
- The widgets' PNG renders for checks in the Simulator (`apps/ios` Native/WidgetSnapshots.swift, Debug only).
- iOS's native long-press preview, date and colour pickers and keyboard bar (the web's own versions show instead).
- One bridge script for both platforms (Android still has its own `folevi-bridge.js` with its own plugin names).
- Release scripts (`pnpm release` for TestFlight and Play) and `scripts/version.mjs` writing `apps/mobile`'s versions.
- Note styles sync (above): the `/note-styles` endpoint and the page's fetch and cache (web session), and the local e2e guard's allowance for them.
