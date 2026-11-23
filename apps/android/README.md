# Folevi for Android

A native app for Android phones, foldables, tablets and Googlebooks (owner decisions 2026-11-23,
`docs/ANDROID_NATIVE_PLAN.md`): Compose screens in Material 3 Expressive with Folevi's colors, fonts and icons;
the web engine and the note editor in one WebView per window, as on iPhone and Mac; Kotlin for everything the
page can't do itself (sign-in, the Keystore, the local library, Drive and Dropbox, Foli AI on the device, the
lock, reminders, push, widgets, the share target, the Quick Settings tile, the scanner).

- Package `com.folevi.android`, minSdk 33 (Android 13), targetSdk 36, compileSdk 37.2 (Compose 1.13 needs it).
- The version comes from the repo's `version.json` (scripts/version.mjs is the only way it changes).
- The web export is served from `https://localhost` inside the app. Account mode signs in with a bearer token
  through a Custom Tab (PKCE); local mode never contacts Folevi.

## How it fits together

```
Compose screens (app/ui)  --typed views, lists, commands, events-->  EngineClient (engine/)
                                                                        |  WebViewTransport
Page View: one WebView per window (app/engine/PageView.kt) running the Android web export in native chrome mode
    |  window.foleviShell / window.foleviNative (assets/folevi-bridge.js) -> window.Capacitor stand-in
Host plugins (app/bridge + the services in auth/, secure/, library/, cloud/, ai/, e2ee/, lock/, host/, extras/, push/)
```

| Path | What it is |
| --- | --- |
| `engine/` | The bridge to the web engine: `generated/` (from `apps/web/src/lib/engine/protocol.ts` by `scripts/engine-codegen-kotlin.mjs`; never edit by hand), `client/` (EngineClient, value and list stores), `transport/` (WebViewTransport over WebMessageListener, ScriptedTransport), `protocol/` (envelope, Patch, Json). Its unit test decodes every contract fixture. |
| `app/src/main/java/com/folevi/android/` | `MainActivity` (one per window: the Compose frame, the Page View laid over the note pane, the host duties), `engine/` (PageView, AppSession, the debug demo engine), `ui/` (adaptive shell, screens, gate screen, Googlebook keys and menus), `design/` (theme, palette, Lucide icons from `scripts/icons-codegen-kotlin.mjs`, cards and folders), `bridge/` (the host bridge: Plugin, PluginCall, the page's `window.Capacitor` stand-in) and the services |
| `app/src/main/assets/folevi-bridge.js` | `window.foleviShell` (platform `android`) and `window.foleviNative`, injected at document start for `https://localhost` only, after the stand-in |
| `bridge/` | The cloud half of the bridge (Dropbox and Google Drive through `packages/cloud-folders`), bundled into `assets/folevi-cloud.js` by `scripts/bundle-bridge.mjs` before every build |
| `app/src/test/` | JVM unit tests of the services (fs contract, journal, links, sign-in, cloud auth, AI providers, calendars, E2EE vectors, local actions) |
| `scripts/emulator.mjs` | Emulators, build, install, screenshots, JavaScript in the web view |

Layouts by window width: phones get a Material navigation bar (Home, Tasks, Calendar, Foli AI) and a New note
button, and a note opens full screen; medium and expanded windows (tablets, an open foldable) get a rail and the
list beside the note; large windows (Googlebooks, big tablets) get a sidebar with the folders. On Googlebooks
and with a keyboard: Ctrl (or the Googlebook key) + N new note, Shift+N new window, K or F search, comma
settings, 1 to 4 the tabs, [ back; right-click or long-press a note for its menu; drag a note out as a link.

## Build and run

You need the Android SDK in `~/Library/Android/sdk` (or `ANDROID_HOME`) with platform 37.2 and the android-36 or
android-37.0 `google_apis_playstore` arm64 system image, and a JDK (Homebrew `openjdk`, or `JAVA_HOME`).

```sh
pnpm install
cd apps/web && node scripts/build-shell.mjs --platform android && cd ../android   # the web export, into web/
./gradlew :engine:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug
node scripts/emulator.mjs avds && node scripts/emulator.mjs boot phone             # or tablet, foldable
node scripts/emulator.mjs run emulator-5554
adb shell am start -n com.folevi.android/.MainActivity --ez demo true              # debug only: fixture data, no page
```

The build copies `web/` into the app's assets, bundles `bridge/` and, for debug builds, copies the contract
fixtures for the demo engine. After any change to `protocol.ts`, run `pnpm engine:gen` (Swift and Kotlin); after
the web adds a Lucide icon, `pnpm icons:gen:kotlin`. CI checks both.

A desktop-size emulator for Googlebook layouts: an AVD named `Folevi_Desktop` from the android-37.0 image with
`hw.lcd.width=1920`, `hw.lcd.height=1200`, `hw.lcd.density=160`, `hw.keyboard=yes` in its `config.ini`.

Debug builds sign in with the dev server at `http://app.localhost:3002`. `install` and `run` set up
`adb reverse tcp:3002` so the emulator reaches it. Use `-Pfolevi.serviceUrl=...` for another server.

```sh
node scripts/emulator.mjs eval 'return location.href' emulator-5554   # JavaScript in the web view (debug only)
node scripts/emulator.mjs shot out.png emulator-5558 <display id>      # a foldable has two displays
node scripts/e2e/signin.mjs emulator-5554                              # a new dev account, signed in through the Custom Tab
```

The foldable folds with `adb shell cmd device_state state 0` and opens with `state 2`.

## Tests

```sh
cd apps/android
pnpm typecheck && pnpm test:bridge                  # the cloud bridge's TypeScript half
./gradlew :engine:testDebugUnitTest :app:testDebugUnitTest
cd ../.. && npx vitest run tests/parity/android.test.ts   # local mode's parity scenarios on the bridge script
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

Server side (set by the owner, never by a build):

- Convex `FCM_SERVICE_ACCOUNT`: the Firebase service account key as JSON. Without it nothing is sent and the
  app hides notifications. `FCM_PROJECT_ID` overrides the project if it differs.
- Vercel `FOLEVI_ANDROID_CERT_SHA256`: the signing certificates' SHA-256 fingerprints, comma separated, for
  `/.well-known/assetlinks.json` (App Links for sign-in and shared links).

## Release

```sh
./gradlew :app:bundleRelease     # app/build/outputs/bundle/release/app-release.aab, signed when the upload key is set
```

Release builds shrink and optimize with R8 (`app/proguard-rules.pro` keeps the bridge's reflective plugin calls
and the generated contract). Without the upload key properties the bundle is unsigned and can't be uploaded.

## Steps only the owner can do

1. **Play Console:** create the app `com.folevi.android`, turn on Play App Signing, add internal testers. A
   personal developer account needs a closed test with 12 testers for 14 days before production.
2. **Upload key:** make one outside the repo (`keytool -genkeypair -v -keystore folevi-upload.jks -alias upload
   -keyalg RSA -keysize 4096 -validity 10000`), keep the password yourself, register it in Play Console, and put
   the four `folevi.upload*` properties above into your own `~/.gradle/gradle.properties`.
3. **App Links:** put the SHA-256 of the upload key and of Play's app signing key into `FOLEVI_ANDROID_CERT_SHA256`
   on Vercel. Release builds then return from sign-in on `https://app.folevi.com/native/callback`.
4. **Firebase:** a project with an Android app `com.folevi.android`. Its app id, API key, project id and sender
   id go into the build settings above. A service account key (Project settings, Service accounts) goes into
   Convex `FCM_SERVICE_ACCOUNT`, on the development deployment first, then production.
5. **Google Cloud (Drive):** in the project that holds the web's Drive client, turn on the Drive API, add an
   Android OAuth client for `com.folevi.android` with the SHA-1 of the debug key, the upload key and Play's
   signing key, with the `drive.file` scope on the consent screen. Putting the client id into
   `folevi.googleAndroidClientId` is what shows Sync with Google Drive.
6. **Dropbox:** in the Folevi Dropbox app, add the redirect URI `com.folevi.android://oauth/dropbox`. The app key
   goes into `folevi.dropboxAppKey`.
7. **Play listing:** the Data safety form (notes and account data are collected and encrypted in transit; the
   WebView's traffic counts), the account deletion link (`https://app.folevi.com/settings`), and screenshots for
   phone, 7-inch and 10-inch tablet and Chromebook/Googlebook.
