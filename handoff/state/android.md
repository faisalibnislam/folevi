# Android (`apps/mobile/android` Capacitor, `apps/android` native Compose)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- What ships is the Capacitor app (`apps/mobile/android`, package `com.folevi.android`). Play internal testing had 1.5.74 (build 89) when a session last looked (2026-11-24); newer bundles wait for the owner's drag-in (`handoff/state/release.md`).
- Release build: `handoff/guide.md` section 6 and `apps/mobile/android/README.md`. Push needs the `FOLEVI_FIREBASE_*` values from the owner's `google-services.json` (on 2026-11-25 it was at `~/Downloads/New Folder With Items/google-services.json`, not directly in Downloads; without it a build has push off).
- "Your own server" is in (PR 103). `network_security_config` allows cleartext because it can't name private address ranges; `net/Http.kt` refuses http to hosts that aren't home addresses. The owner has not reviewed that trade-off.
- The native Compose app is PR 112 (`claude/android-native-compose`), a draft: Compose UI for everything but the writing area (which stays the web engine in a WebView), including native onboarding and gates, the tablet sidebar and the Material 3 polish pass. Plan: `docs/ANDROID_NATIVE_PLAN.md`.
- PR 112 raises the engine contract to revision 36 (onboarding sends `firstName`) and carries two web fixes for native chrome (greeting by first name; a plain note's paper runs up under the native top bar). Production runs revision 35 until 112 merges, so a native build pointed at app.folevi.com connects but lacks those two.
- A native test APK: `./gradlew :app:assembleDebug -Pfolevi.serviceUrl=https://app.folevi.com` in `apps/android` (debug key, sign-in returns on `com.folevi.android://`). Same package as the Play app, so it won't install over it.
- Native tests: 116 app and 5 engine unit tests (Robolectric 4.18.1, needed on JDK 27); emulator checks used a local anonymous Convex and the web dev server through `adb reverse`.

## Next steps

- The owner drags the 1.7.78 bundle into Play Console.
- PR 112 out of draft needs: CI green on the latest merge, the owner's real-device pass with the test APK, then the owner's OK to merge.
- Not tested: a full sign-in on a server, a real QR read, home-network discovery, the native app on a real device.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
