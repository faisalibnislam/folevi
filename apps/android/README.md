# Folevi for Android

The web app's built-in interface (the static `FOLEVI_BUILD=shell` export the Mac app ships) in a Capacitor 8
shell, with Kotlin for everything the page can't do itself. Plan and owner decisions: `docs/ANDROID_PLAN.md`.

- Package `com.folevi.android`, minSdk 33 (Android 13), targetSdk 36, compileSdk 37.
- The interface is served from `https://localhost` inside the app. Account mode talks to Folevi with a bearer
  token, like the Mac's built-in interface. Local mode never contacts Folevi.
- Debug builds only so far. Release signing (upload key plus Play App Signing) is an owner step, below.

## What's where

| Path | What it is |
| --- | --- |
| `capacitor.config.ts` | App id, `webDir: web`, start path `/documents`, edge-to-edge insets handled by the app |
| `android/app/src/main/assets/folevi-bridge.js` | `window.foleviShell` (platform `android`) and `window.foleviNative`, injected at document start for `https://localhost` only |
| `bridge/` | The cloud half of the bridge (Dropbox and Google Drive through `packages/cloud-folders`), bundled into `assets/folevi-cloud.js` by `scripts/bundle-bridge.mjs` before every Gradle build |
| `android/app/src/main/java/com/folevi/android/` | `MainActivity` (insets, keyboard, back and predictive back, links), `web/` (bridge script, link rules), `auth/` (Custom Tab sign-in with PKCE), `secure/` (Keystore), `library/` (the library folder and journal), `cloud/`, `ai/` (Gemini Nano or the person's own key), `host/` (reminders, saving files, calendars), `lock/`, `extras/` (share target, Quick Settings tile, widgets, scanner, REST client), `push/` (FCM), `e2ee/` (device keys) |
| `android/app/src/test/` | JVM unit tests (fs contract, journal, links, sign-in, cloud auth, AI providers, calendars, E2EE vectors, local actions) |
| `scripts/emulator.mjs` | Emulators, build, install, screenshots, JavaScript in the web view |
| `scripts/e2e/` | Sign-in through the real Custom Tab, and UI Automator helpers |

## Build and run

You need the Android SDK in `~/Library/Android/sdk` (or `ANDROID_HOME`) with platform 37, the android-36
`google_apis_playstore` arm64 system image, and a JDK (Homebrew `openjdk`, or `JAVA_HOME`).

```sh
pnpm install
# 1. The built-in interface, into apps/android/web (git-ignored)
cd apps/web && node scripts/build-shell.mjs --platform android && cd ../android
# 2. Into the app's assets
npx cap copy android
# 3. Emulators (made once from the installed image), then build and run
node scripts/emulator.mjs avds
node scripts/emulator.mjs boot phone        # or tablet, foldable; add --window to see it
node scripts/emulator.mjs build
node scripts/emulator.mjs run emulator-5554
```

Debug builds talk to the dev server at `http://app.localhost:3002`. `install` and `run` set up
`adb reverse tcp:3002` so the emulator reaches it. Use `-Pfolevi.serviceUrl=...` for another server.

Handy while testing:

```sh
node scripts/emulator.mjs eval 'return location.href' emulator-5554   # JavaScript in the web view (debug only)
node scripts/emulator.mjs click 'Open Folevi' emulator-5554
node scripts/emulator.mjs theme dark emulator-5554
node scripts/emulator.mjs shot out.png emulator-5558 <display id>      # a foldable has two displays
node scripts/e2e/signin.mjs emulator-5554                              # a new dev account, signed in through the Custom Tab
```

The foldable folds with `adb shell cmd device_state state 0` and opens with `state 2`.

## Tests

```sh
cd apps/android
pnpm typecheck
pnpm test:bridge                    # the Mac's Dropbox and Drive contract through Android's bridge marshalling
node scripts/emulator.mjs unit      # Kotlin unit tests
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

Server side (set by the owner, never by a build):

- Convex `FCM_SERVICE_ACCOUNT`: the Firebase service account key as JSON. Without it nothing is sent and the
  app hides notifications. `FCM_PROJECT_ID` overrides the project if it differs.
- Vercel `FOLEVI_ANDROID_CERT_SHA256`: the signing certificates' SHA-256 fingerprints, comma separated, for
  `/.well-known/assetlinks.json` (App Links for sign-in and shared links).

## Steps only the owner can do

1. **Play Console:** create the app `com.folevi.android`, turn on Play App Signing, add internal testers.
2. **Upload key:** make one outside the repo (`keytool -genkeypair -v -keystore folevi-upload.jks -alias upload
   -keyalg RSA -keysize 4096 -validity 10000`), keep the password yourself, and register it in Play Console.
   Gradle has no release signing config yet (debug builds only for now); when it's added it reads the
   keystore's path and passwords from your own `~/.gradle/gradle.properties`, never from the repo.
3. **App Links:** put the SHA-256 of the upload key and of Play's app signing key into `FOLEVI_ANDROID_CERT_SHA256`
   on Vercel. Release builds then return from sign-in on `https://app.folevi.com/native/callback`.
4. **Firebase:** a project with an Android app `com.folevi.android`. Its app id, API key, project id and sender
   id go into the build settings above. A service account key (Project settings, Service accounts) goes into
   Convex `FCM_SERVICE_ACCOUNT`, on the development deployment first, then production.
5. **Google Cloud (Drive):** in the project that holds the web's Drive client, turn on the Drive API, add an
   Android OAuth client for `com.folevi.android` with the SHA-1 of the debug key, the upload key and Play's
   signing key, with the `drive.file` scope on the consent screen. Google matches that client by package name
   and SHA-1, so the app never sends its id; putting the id into `folevi.googleAndroidClientId` is what shows
   Sync with Google Drive.
6. **Dropbox:** in the Folevi Dropbox app, add the redirect URI `com.folevi.android://oauth/dropbox`. The app key
   goes into `folevi.dropboxAppKey`.
7. **API 33 emulator (optional):** testing on Android 13 needs the android-33 system image, which isn't
   installed here.
