# Folevi for Android

The Android half of the one Capacitor mobile app (`apps/mobile`, owner's decision 2026-11-24: one web app
everywhere). The web app's built-in interface (the static shell export) runs in the Android System WebView, served
from `https://localhost`; Kotlin does only what the page can't do itself. It replaces the native Compose app
(`apps/android`, PR 54), which stays in the tree and in history as the reference for platform behavior.

- Package `com.folevi.android`, the same as the native app and the Play listing, so it updates in place.
- minSdk 33 (Android 13), targetSdk 36, compileSdk 37.
- The version and Play's versionCode come from the repo's `version.json` (`scripts/version.mjs` is the only way
  they change). A Play upload needs a versionCode above 83 (build 83 is the native app on internal testing).
- Account mode signs in through a Custom Tab (PKCE) and keeps a bearer token in the Keystore; local mode never
  contacts Folevi.

## Updating in place over the native app

Everything the native app kept is read where it was: its library files (`no_backup/library`), the journal,
SharedPreferences (`folevi-shell`, `folevi-places`, `folevi-library`, `folevi-device`, `folevi-lock`, ...),
Keystore secrets, end-to-end encryption keys, and the WebView's own storage for `https://localhost` (IndexedDB,
local storage). The Kotlin services are the same code the native app moved in from the earlier Capacitor app,
back on Capacitor's real `Plugin` classes.

## What's where

| Path | What it is |
| --- | --- |
| `../capacitor.config.ts` | Shared with iOS. Android's block: `includePlugins: []` (no stock plugins on Android, see below), user agent, debugging |
| `app/src/main/assets/folevi-bridge.js` | `window.foleviShell` (platform `android`) and `window.foleviNative`, injected at document start for `https://localhost` only |
| `bridge/` | The cloud half of the bridge (Dropbox and Google Drive through `packages/cloud-folders`), bundled into `assets/folevi-cloud.js` by `scripts/bundle-bridge.mjs` before every build |
| `app/src/main/java/com/folevi/android/` | `MainActivity` (windows, insets, keyboard, back and predictive back, links, sign-in return), `web/` (bridge script, link rules), `auth/` (Custom Tab sign-in), `secure/` (Keystore), `library/` (the library on this phone and its journal), `cloud/`, `ai/` (Gemini Nano or the person's own key), `host/` (reminders, saving files, calendars), `lock/`, `extras/` (share target, Quick Settings tile, widgets, scanner, REST client), `push/` (FCM), `e2ee/` (device keys) |
| `app/src/test/` | JVM unit tests (fs contract, journal, links, sign-in, cloud auth, AI providers, calendars, E2EE vectors, local actions) |
| `scripts/emulator.mjs` | Emulators, build, install, screenshots, JavaScript in the web view |
| `scripts/e2e/` | Sign-in through the real Custom Tab, and UI Automator helpers |

Why no stock Capacitor plugins on Android: Folevi's own Kotlin already answers the page for insets, the keyboard,
back, links, splash and push. The Keyboard plugin's inset callback dispatches with `DISPATCH_MODE_STOP`, which
would stop the WebView's own keyboard animation, and the Push plugin's service would take Firebase's messages
away from `FoleviMessagingService`.

How the platform behaves:
- **Edge to edge:** the page draws under the bars and gets the insets as `--android-inset-*` and events.
- **Keyboard:** the web view's bottom margin follows the IME; the page gets the keyboard's height as it animates.
- **Back and predictive back:** the gesture's progress goes to the page. Sheets and menus close first. On the
  phone layout Back follows the screen's own Back, then Home. On wide windows (tablets, an open foldable,
  Googlebooks) Back presses the page's own Back button, which follows the web's tab rule (back within the tab;
  with nothing left the tab closes and the tab it was opened from shows), then Home. Home leaves the app.
- **Windows:** `singleInstancePerTask` with multi-instance: links and notifications go to the open window, and
  Googlebooks and tablets can open more from the launcher or with Ctrl+Shift+N. Resizing, folding and keyboards
  are handled in place (no restart), and the page picks the phone or sidebar layout from the window's width.
- **Links:** `folevi://`, App Links for `app.folevi.com` (`/d/`, `/documents`, `/tasks`, `/calendar`, `/inbox`,
  sign-in's `/native/callback`); other sites open in a Custom Tab.
- **Share:** "Save to Folevi" in the share sheet (text, links, images, PDFs, files); the page's own share uses
  Android's share sheet.

## Build and run

You need the Android SDK in `~/Library/Android/sdk` (or `ANDROID_HOME`) with platform 37, the android-37.0
`google_apis_playstore` arm64 image, and a JDK (Homebrew `openjdk`, or `JAVA_HOME`).

```sh
cd apps/mobile && CI=true pnpm install --ignore-workspace       # Capacitor, outside the pnpm workspace
cd ../web && node scripts/build-shell.mjs --platform android --dest ../mobile/web && cd ../mobile
npx cap sync android
cd android && ./gradlew :app:assembleDebug :app:testDebugUnitTest
node scripts/emulator.mjs boot phone        # or tablet, foldable, desktop; add --window to see it
node scripts/emulator.mjs run phone
```

Emulators boot on ports 5560 to 5566 (other projects on this Mac use 5554 to 5558). `Folevi_Desktop` is a
Googlebook-size AVD made by hand from the android-37.0 image (`hw.lcd.width=1920`, `hw.lcd.height=1200`,
`hw.lcd.density=160`, `hw.keyboard=yes`). The foldable folds with `adb shell cmd device_state state 0` and opens
with `state 2`.

Debug builds sign in with the dev server at `http://app.localhost:3002` (`web-3002` in `.claude/launch.json`).
`install` and `run` set up `adb reverse tcp:3002` so the emulator reaches it. Use `-Pfolevi.serviceUrl=...` for
another server.

```sh
node scripts/emulator.mjs eval 'return location.href' phone   # JavaScript in the web view (debug only)
node scripts/emulator.mjs click 'Open Folevi' phone
node scripts/emulator.mjs theme dark phone
node scripts/emulator.mjs shot out.png phone <display id>      # a foldable has two displays
node scripts/e2e/signin.mjs emulator-5560                      # a new dev account, signed in through the Custom Tab
```

## Tests

```sh
cd apps/mobile/android
./gradlew :app:testDebugUnitTest                                                  # Kotlin unit tests
cd ../../.. && node_modules/.bin/vitest run --config apps/mobile/android/bridge/vitest.config.ts   # the cloud bridge
npx vitest run tests/parity/android.test.ts                                       # local mode's parity scenarios on the bridge script
```

## Build settings

Each is a Gradle property (`-Pfolevi.x=...` or `~/.gradle/gradle.properties`) or the environment variable next
to it. All are empty by default, and the feature stays hidden until it's set. None of them is a secret, but keep
them out of the repo anyway.

| Property | Environment | Turns on |
| --- | --- | --- |
| `folevi.dropboxAppKey` | `FOLEVI_DROPBOX_APP_KEY` | Sync with Dropbox |
| `folevi.googleAndroidClientId` | `FOLEVI_GOOGLE_ANDROID_CLIENT_ID` | Sync with Google Drive |
| `folevi.firebaseAppId`, `folevi.firebaseApiKey`, `folevi.firebaseProjectId`, `folevi.firebaseSenderId` | `FOLEVI_FIREBASE_APP_ID`, `FOLEVI_FIREBASE_API_KEY`, `FOLEVI_FIREBASE_PROJECT_ID`, `FOLEVI_FIREBASE_SENDER_ID` | Notifications through FCM (no `google-services.json` needed) |
| `folevi.serviceUrl` | `FOLEVI_SERVICE_URL` | Debug builds only: another dev server |
| `folevi.uploadStoreFile`, `folevi.uploadStorePassword`, `folevi.uploadKeyAlias`, `folevi.uploadKeyPassword` | (none) | Release signing with the owner's upload key. Keep these in `~/.gradle/gradle.properties` only, never in the repo |

Server side (set by the owner, never by a build): Convex `FCM_SERVICE_ACCOUNT` (and `FCM_PROJECT_ID` if it
differs), and Vercel `FOLEVI_ANDROID_CERT_SHA256` for `/.well-known/assetlinks.json`.

## Release

```sh
cd apps/web && node scripts/build-shell.mjs --platform android --production --dest ../mobile/web && cd ../mobile
FOLEVI_RELEASE=1 npx cap sync android
cd android && ./gradlew :app:bundleRelease   # app/build/outputs/bundle/release/app-release.aab, signed with the upload key
```

Release builds shrink and optimize with R8 (Capacitor's own consumer rules keep the plugins). Native releases are
paused (owner, 2026-11-24): no Play upload without the owner's OK.

## Size and memory (2026-11-24, emulators)

| | Native app (build 83) | This app |
| --- | --- | --- |
| Release AAB | 100.8 MB | 96.6 MB |
| Release APK | 122.3 MB | 119.1 MB |
| Code (dex) | 6.3 MB | 3.4 MB |
| Memory on Home, local library (PSS: app + WebView renderer) | 78.8 + 120.5 = 199.3 MB | 80.2 + 125.4 = 205.7 MB |

Both carry the same web export (84 MB, of which 64 MB is note covers) and 39 MB of native libraries (ML Kit, Tink,
Firebase). Memory was measured on the Folevi_Phone emulator, release builds, three samples after a 45 s settle.

## Steps only the owner can do

The Play app, upload key, App Links, Firebase, Drive and Dropbox steps are the same as for the native app
(`apps/android/README.md` "Steps only the owner can do"); the package, signing key and redirect URIs are
unchanged, so nothing new is needed for this app.
