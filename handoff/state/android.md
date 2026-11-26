# Android (`apps/mobile/android` Capacitor, `apps/android` native Compose)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- What ships is the Capacitor app (`apps/mobile/android`, package `com.folevi.android`). Play internal testing had 1.5.74 (build 89) when a session last looked (2026-11-24); newer bundles wait for the owner's drag-in (`handoff/state/release.md`).
- Release build: `handoff/guide.md` section 6 and `apps/mobile/android/README.md`. Push needs the `FOLEVI_FIREBASE_*` values from the owner's `google-services.json` (on 2026-11-25 it was at `~/Downloads/New Folder With Items/google-services.json`, not directly in Downloads; without it a build has push off).
- "Your own server" is in (PR 103). `network_security_config` allows cleartext because it can't name private address ranges; `net/Http.kt` refuses http to hosts that aren't home addresses. The owner has not reviewed that trade-off.
- The native Compose app is PR 112 (`claude/android-native-compose`), a draft: Compose UI for everything but the writing area.

## Next steps

- The owner drags the 1.7.78 bundle into Play Console.
- PR 112 stays a draft until its session marks it ready.
- Not tested: a full sign-in on a server, a real QR read, home-network discovery, a real device.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
