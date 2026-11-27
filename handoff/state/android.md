# Android (`apps/mobile/android` Capacitor, `apps/android` native Compose)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- What ships is the Capacitor app (`apps/mobile/android`, package `com.folevi.android`). Play internal testing has 1.8.79 (version code 109) since 2026-11-27 (108 went up an hour before it). No public Play listing yet.
- Release build: `handoff/guide.md` section 6 and `apps/mobile/android/README.md`. Push needs the `FOLEVI_FIREBASE_*` values from the owner's `google-services.json` (on 2026-11-25 it was at `~/Downloads/New Folder With Items/google-services.json`, not directly in Downloads; without it a build has push off).
- Direct download (owner, 2026-11-27): `folevi.com/download/android/Folevi.apk` and `Folevi-<version>.apk` are the signed universal APK from Play Console (App bundle explorer > Downloads), never an upload-key build, so direct and Play installs share Google's signing key and update each other. Steps: build the bundle (`:app:bundleRelease`, Firebase values from the owner's `google-services.json`), the owner drags it into a new internal testing release (no browser tool can upload a 100 MB file; a session can do the rest in the built-in browser when the owner asks), publish, download the APK, check `apksigner verify --print-certs` (signer `CN=Android, O=Google Inc.`, certificate SHA-256 `69f5227e...75c262`) and that no `com.pairip` is in it, launch it on an emulator, then `npx wrangler r2 object put folevi-updates/android/<name> --content-type application/vnd.android.package-archive --remote` (versioned name immutable, `Folevi.apk` no-cache). Hosting needs the owner's OK each release.
- Play's "Automatic protection: Installer check" (Protected with Play) is OFF since 2026-11-27, on the owner's OK: with it on, Play adds a license check and an app installed outside Play closes at launch and opens Google Play (seen with 108's APK). It is baked in when Play processes a bundle, so 108 keeps it; 109 and later have none. If it is ever turned back on, the direct download breaks for every bundle uploaded after that.
- The hosted build has push on (Firebase) and no Dropbox app key or Google Drive client ID, so those two sync choices are hidden in it.
- "Your own server" is in (PR 103). `network_security_config` allows cleartext because it can't name private address ranges; `net/Http.kt` refuses http to hosts that aren't home addresses. The owner has not reviewed that trade-off.
- The native Compose app is PR 112 (`claude/android-native-compose`), a draft: Compose UI for everything but the writing area.

## Next steps

- Each Android release that should be downloadable repeats the direct download steps above; the APK does not update itself while there is no public Play listing.
- PR 112 stays a draft until its session marks it ready.
- Not tested: a full sign-in on a server, a real QR read, home-network discovery, a real device.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
