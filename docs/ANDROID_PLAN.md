# Folevi for Android: plan (2026-10-22)

## Owner decisions

- **Approach:** a Capacitor shell like the iPhone app, with the web app inside, so every feature matches the web (local mode and end-to-end encryption included). Kotlin for the native extras. Lives in `apps/android`.
- **Devices:** phones, tablets and foldables, one adaptive app. Tablets and unfolded foldables get the sidebar layout the iPad uses. **Minimum Android 13 (API 33).**
- **Payments:** no buying in the app: no prices, buy buttons or upgrade links. People subscribe on folevi.com and the app unlocks (the iOS rule, `docs/IOS.md` "No purchases in the app").
- **Local mode:** yes. The library lives on the phone and syncs through Google Drive or Dropbox, the same backends the Mac uses, so one library works across the Mac and Android. On-device Foli AI uses Gemini Nano where the phone supports it, otherwise the person's own key.
- **Native v1:** share target (saved offline to the Inbox), a Quick Add tile in Quick Settings and app shortcuts, home screen widgets (today's to-dos, recent notes, Quick Add), push notifications (reminders, mentions, comments, with Reply and Mark done), a document scanner with text recognition, a fingerprint or face lock, and Google Assistant / Gemini app actions.
- **Look:** Folevi's own design, the same as the iPhone app (fonts, neutral chrome, floating bars), with Android behaviour: the back gesture and predictive back, edge-to-edge, ripples, haptics and the system share sheet. Not a Material You restyle.
- **Distribution:** Google Play (the owner has a Play Console account): internal testing, then closed testing, then production, with Play App Signing.
- **Timing:** right after the encryption build, alongside resuming the iPhone and iPad apps, so the shared web-layer work is done once for both.

## How it fits together

| Piece | Choice |
| --- | --- |
| Package name | `com.folevi.android` (permanent once on Play; matches `com.folevi.mac` and `com.folevi.ios`) |
| Shell | Capacitor 8 (`@capacitor/android`, the version the iOS app uses), Kotlin, Gradle version catalog, minSdk 33, target/compile the latest SDK |
| Interface | The built-in copy of the web app (the static shell export the Mac app ships, `FOLEVI_BUILD=shell`), served by Capacitor from `https://localhost`. Needed for local mode, which never contacts Folevi. Account mode signs in with a bearer token like the Mac's built-in interface (`lib/auth/shellFetch.ts`) |
| Bridge | `window.foleviShell` with `platform: "android"`, implementing the contract in `docs/LOCAL_MODE_PLAN.md` §4.1 (library, secrets, auth, ai, lock, notify, files, http) plus the E2EE device-key calls the Mac has (`apps/desktop/src/e2ee.ts`) |
| Secrets and keys | Android Keystore (StrongBox where present): sign-in token, Drive and Dropbox tokens, own AI keys, E2EE device keys. Never readable from JavaScript, like the Mac |
| Sign-in | Browser sign-in through a Custom Tab with PKCE, returning on an App Link (`https://app.folevi.com/native/callback`), using the endpoints in `convex/lib/nativeAuth.ts` |
| Links | App Links for `app.folevi.com` and `folevi.com/s/...` (`/.well-known/assetlinks.json` on both hosts, with the Play signing fingerprint) |
| Passkeys | Credential Manager, using the same assetlinks file, so passkeys made on the web work in the app (and the E2EE passkey unlock, WebAuthn PRF, where the provider supports it) |
| Updates | The built-in interface updates with each app release; the service worker isn't used in the shell |

## Shared work with iOS (done once)

- `lib/shell` learns `platform: "android"`; the phone layout the iPhone app uses becomes "native phone" for both, keeping iOS-only parts (glass bars, Face ID copy) behind the platform.
- Android back handling: the system back gesture closes sheets, menus and full canvas first, then goes back in the app's history, then leaves the app. Predictive back animates the same steps.
- Edge-to-edge: safe-area insets for the status bar, the gesture bar and display cutouts; foldable hinge handling through window size classes.
- The cloud backends move from `apps/desktop/src/library/cloud` (Node) into a shared TypeScript package (`packages/cloud-folders`: Drive and Dropbox over `fetch`) so the Mac and Android share one implementation; each shell only does OAuth and token storage.
- The "No purchases in the app" rule applies to both shells through one check (`isNativeStoreApp()`).

## Phases

1. **Shell:**
   - the Capacitor project in `apps/android`;
   - signing: an upload key kept outside the repo, with Play App Signing;
   - the built-in interface, the bridge skeleton, and back, insets and haptics;
   - account sign-in and offline use;
   - emulator test runs for a phone, a tablet and a foldable, on API 33 and the latest.
2. **Local mode:**
   - the library on the device (app storage) with the journal;
   - Google Drive and Dropbox sync through the shared package;
   - Keystore secrets;
   - Gemini Nano through ML Kit GenAI where AICore has it, otherwise the person's own key;
   - parity scenarios on the Android driver.
3. **Native extras:**
   - the share target: intent filters for text, links, images and files, saved offline to the Inbox;
   - the Quick Settings tile and app shortcuts;
   - Glance widgets;
   - the ML Kit document scanner with text recognition;
   - BiometricPrompt lock;
   - App Actions through `shortcuts.xml` capabilities for new note and new to-do, where Google Assistant and Gemini support them.
4. **Notifications:**
   - Firebase Cloud Messaging on the device, with Reply and Mark done actions;
   - an FCM HTTP v1 sender on the server next to the APNs one (`convex/pushSend.ts`, `convex/apnsSend.ts`);
   - local reminders in local mode through the `notify` bridge.
5. **Encryption on Android:**
   - device keys in the Keystore;
   - approval from another device;
   - the passkey unlock through Credential Manager;
   - the same e2e flows as the web.
6. **Release:**
   - Play listing, data safety form and screenshots;
   - internal testing, then closed testing, then production.
   - From then on, web changes ship to Android too, like the Mac.

## Status (2026-10-22)

Phases 1 to 5 are built in `apps/android` (how to build, run and test: `apps/android/README.md`, which also has
the owner's steps in detail). Checked on the phone, tablet and foldable emulators (android-36), light and dark.

- **Built and seen working:** the shell, insets, back and predictive back, the keyboard, sign-in through a
  Custom Tab (debug redirect `com.folevi.android://auth/callback`), local mode on the phone, the phone layout on
  phones and folded foldables and the sidebar on tablets and open foldables, the share target (offline queue in
  local mode, straight to the Inbox with an account), the Quick add tile, the three widgets (fed by the page in
  local mode, by the REST API with an account), local reminders.
- **Built, waiting on owner accounts (off until set):** Dropbox and Google Drive sync (shared code in
  `packages/cloud-folders`, used by the Mac too), FCM notifications (`convex/fcmSend.ts`, `FCM_SERVICE_ACCOUNT`),
  App Links (`FOLEVI_ANDROID_CERT_SHA256`), release signing.
- **Built, not checked on an emulator:** Gemini Nano (needs AICore on a real phone), the document scanner and
  text recognition (Play services modules), the fingerprint or face lock (needs a screen lock), App Actions.
- **Not on Android yet:** the passphrase for a library (the setting says so), bookmark previews in local mode,
  the passkey unlock through Credential Manager, API 33 test runs (the image isn't installed).

## Steps only the owner can do (given in detail when each phase starts)

- **Play Console:** create the app `com.folevi.android`, turn on Play App Signing, and add internal testers.
- **Firebase:** a Firebase project for Cloud Messaging, and a service account key for the server sender. It goes into Convex environment variables, never the repo.
- **Google Cloud:** an Android OAuth client for Drive with the app's SHA-1 fingerprints (upload and Play signing).
- **Dropbox:** the Folevi Dropbox app gets the Android redirect.
- **Upload key:** a password the owner keeps.
