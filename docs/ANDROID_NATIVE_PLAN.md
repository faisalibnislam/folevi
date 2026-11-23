# Folevi for Android, native: plan (2026-11-23)

The owner asked for a native Android app "just like iPhone", for phones, tablets and "Google Book". This plan
replaces the Capacitor approach in `docs/ANDROID_PLAN.md` (2026-10-22) for the app's structure; that plan's
service decisions (sign-in, local mode backends, push, no purchases) still hold unless this one says otherwise.

Full research notes, with a source and date for every fact: `docs/ANDROID_RESEARCH_2026-11.md`.

## 1. Owner decisions (2026-11-23, checkbox answers)

| Topic | Decision |
| --- | --- |
| "Google Book" | **Googlebook**, Google's Android-based laptops (announced 2026-05-12, shipping since October 2026). |
| Devices | Googlebook laptops, Android phones and foldables, Android tablets. Older Chromebooks are not a target (the same app may run there, untested). |
| Minimum Android | **Android 13 (API 33)**, as before. |
| Look | **Material 3 Expressive with Folevi's colors.** Folevi keeps its own icons (the web's Lucide set), its typefaces (Instrument Sans for text, Spectral for titles), and its note cards, frosted folders and note colors. Bars, navigation, buttons, menus, sheets, search, dialogs and motion are Material 3 Expressive. |
| Layouts | Phone like the iPhone app; tablet like the iPad app; Googlebook like the Mac app (three columns, tabs, shortcuts, right-click, hover, several windows, drag and drop); foldables show list beside note when open and keep the note on screen when folded. |
| Phone navigation | The iPhone's tabs (Home, Tasks, Calendar) as a Material navigation bar, plus **Foli AI as its own tab** and a **floating New note button**. |
| First build | Everything: notes core, Tasks and Calendar, Foli AI and Settings, local mode, Vault and the Android extras. |
| Old Capacitor app | **Replace it and reuse its Kotlin.** The native app takes over `com.folevi.android`; the Kotlin services move in; Capacitor goes, as it did on iOS. |
| Package | `com.folevi.android` (kept). |
| Builds | Emulators for now, then Play internal testing soon (the owner does Play Console and keys). |

## 2. What the research says (short)

Sources and dates in `docs/ANDROID_RESEARCH_2026-11.md`.

- **Android 17 (API 37)** is current (2026-06-16); QPR2 (API 37.2) is in beta. Apps targeting 37 can't restrict
  orientation or resizability on screens 600dp and wider. Edge-to-edge and predictive back are already
  mandatory at target 36. Android is "Compose-first": View libraries get critical fixes only.
- **Play:** new apps and updates must target **API 36** (since 2026-08-31); 16 KB page support is required for
  updates from 2027-02-01 (pure Kotlin is fine); new personal accounts need a closed test with 12 testers for
  14 days; a Data safety form and in-app account deletion are required.
- **Material 3 Expressive** went stable in Compose Material 3 **1.5.0** (2026-11-18): floating toolbars, button
  groups, split and toggle buttons, flexible bottom bar, expressive list items, `MaterialTheme.motionScheme`.
  `LoadingIndicator`, `MaterialShapes` and `AppBarWithSearch` are still experimental.
- **Adaptive:** five width classes (Compact, Medium, Expanded, Large 1200dp+, Extra-large 1600dp+);
  **Navigation 3** is stable (1.2.2) and Material 3 Adaptive 1.3.0 gives it `ListDetailSceneStrategy` and
  `SupportingPaneSceneStrategy`; `NavigationSuiteScaffold` switches bar and rail.
- **Googlebook:** Play apps run in free-form resizable windows, several instances, cross-window drag and drop;
  Play shows "Optimized for desktop" badges. No separate SDK: the work is adaptive layouts, keyboard shortcuts
  (Keyboard Shortcuts Helper), pointer and hover, right-click menus. Tested on the Android Studio desktop
  emulator and at Extra-large width. The adaptive app quality tiers (3 ready, 2 optimized, 1 differentiated)
  replace the old large-screen tiers; Tier 2 earns the large-screen badge.
- **Web editor in a WebView:** `WebViewCompat.addWebMessageListener` with allowed origins is the recommended
  bridge (`addJavascriptInterface` is legacy); `addDocumentStartJavaScript` for scripts before any page script;
  `WebViewAssetLoader` for bundled files over https; `startUpWebView` to warm up. `androidx.web` `WebContent`
  (alpha) keeps a WebView across configuration changes.
- **Services:** Credential Manager 1.6 (passkeys, Sign in with Google, restore credentials), Auth Tab for
  OAuth, FCM HTTP v1, Glance 1.2 widgets with generated previews, Room 3 if a native store is ever needed
  (it isn't: the engine keeps the device copy, as on iOS).

## 3. Architecture

The same split as the iPhone, iPad and Mac apps (`docs/NATIVE_APP_PLAN.md`): everything is native except the
note editor and note page, and there is no native data layer.

```
Compose screens (Material 3 Expressive, Folevi colors, Lucide icons)
   |  typed views, list windows, commands, editor commands, events
EngineClient (apps/android/engine)  <- generated from protocol.ts by scripts/engine-codegen-kotlin.mjs
   |  WebViewTransport: foleviEngineHost (batches) / foleviEngineReply (replies), evaluateJavascript calls
Page View: one WebView per window, the web export (build-shell --platform android) in native chrome mode
   |  window.foleviShell / foleviNative: the host bridge (sign-in token, library files, keys, AI, lock, ...)
Host services in Kotlin (moved from the Capacitor app: auth, secrets, places, library, cloud, e2ee, push, ...)
```

- **Engine bridge.** `scripts/engine-codegen-kotlin.mjs` writes `EngineModels.kt` and `EngineApi.kt` from
  `protocol.ts`, the twin of the Swift codegen (same schema hash, so `hello` confirms both sides match). CI
  runs it with `--check`. The client mirrors `EngineClient.swift`: hello and reconnect, windowed lists with
  diffs, rev gaps refetch, pause and resume off screen, typed events. Every contract fixture is decoded by
  the engine module's unit test.
- **Transport.** Android can't await a promise from `evaluateJavascript`, so each call runs
  `__foleviEngine.handle(m)` and the page posts the reply to `foleviEngineReply` with the call's token. The
  engine already posts batches to `window.foleviEngineHost` when there is no WebKit handler.
- **Native chrome marker.** `window.__foleviNativeChrome = { platform: "android", protocol: 1, place }`, set
  at document start for the app's origin only. The contract's `platform` unions gain `"android"` in a small
  protocol revision (with the Swift regenerated) once the iOS redesign session has landed, to avoid clashing
  with its regenerated files; until then Android sends it as a plain string, which the engine accepts.
- **Page View origin.** The export is served by `WebViewAssetLoader` (or the existing local-server path rules)
  from the app's own https origin. Debug builds can load the dev server instead.
- **Host bridge.** `folevi-bridge.js` calls `Capacitor.nativePromise(plugin, method, args)`. The native app
  keeps that script unchanged and provides a small `Capacitor` stand-in over a WebMessageListener, routed to
  Kotlin host plugins with Capacitor's method names. The plugins move over from `apps/android/android` with
  their base class swapped (`HostPlugin`, `HostCall`); their logic (AuthBridge, Places, SecretStore,
  LibraryFs, CloudAuth, DeviceKeys, AiService, Reminders, Push) is plain Kotlin and moves as is.
- **Navigation.** Navigation 3 back stack per tab. Compact: `NavigationSuiteScaffold` bar (Home, Tasks,
  Calendar, Foli AI) and a floating New note button; the note opens full screen. Medium and Expanded: rail
  plus list and note side by side (`ListDetailSceneStrategy`). Large and Extra-large (Googlebook, big
  tablets): sidebar, list and note in three columns, note tabs in the window's header, keyboard shortcuts.
- **Gates.** The engine reports the screen before the app (`gate.changed`: mode choice, sign-in, library setup,
  onboarding, migration, E2EE unlock, device limit). Native draws a generic gate screen from the event's
  title, message, fields and actions, and sends `gate.act`; dedicated screens replace the generic one where
  the iPhone has them (sign-in with Google and passkeys, onboarding).

## 4. Checklist

Phase 0, this session
- [x] Research and owner answers (sections 1 and 2)
- [x] Kotlin codegen for the contract, with `--check` for CI
- [x] Engine module: client, stores, WebView transport, fixture test over every contract fixture
- [ ] App module: theme (Folevi colors, fonts, Lucide icons), adaptive scaffold, Home, All notes, folders,
      note page, Tasks, Calendar, Foli AI and Search screens, generic gate screen
- [ ] Demo engine (fixture data, debug only) so every layout can be checked without an account
- [ ] Page View with the engine: marker, transport, the Android export; gates drawn natively
- [ ] Run on phone, tablet, foldable and desktop-size emulators; screenshots

Phase 1, sign-in and data
- [ ] Host bridge stand-in and the first host plugins: Shell, Auth, Secrets, Places
- [ ] Native sign-in screens (email and password, Google with Credential Manager, passkeys, browser sign-in)
- [ ] Web: phone note layout for the Android marker; big batches straight to `foleviEngineHost`
- [ ] Contract revision adding `"android"` to the marker and `AppInfo` platforms

Phase 2, the rest of the first build
- [ ] Tasks and Calendar screens in full, Foli AI chat and note actions, Settings
- [ ] Local mode (library, Drive, Dropbox), Vault and E2EE unlock
- [ ] Android extras: share target, widgets (Glance), Quick Settings tile, app shortcuts, push (FCM),
      scanner, biometric lock, app actions
- [ ] Googlebook: shortcuts helper, right-click menus, hover, several windows, drag and drop of notes and
      files, desktop emulator pass
- [ ] Remove Capacitor and the old `apps/android/android` project once every service has moved

Phase 3, release
- [ ] Release build, R8, signing config reading the owner's keystore from `~/.gradle/gradle.properties`
- [ ] Play internal testing (owner uploads), Data safety form, account deletion link
- [ ] Adaptive quality Tier 2 checks, then the large-screen badge
- [ ] Target API 37 before the next Play deadline

## 5. Owner steps (later)

The Capacitor README's list still applies (`apps/android/README.md`, "Steps only the owner can do"): Play
Console app and Play App Signing, an upload key outside the repo, App Links fingerprints on Vercel, Firebase
for push, Google Cloud Android OAuth client for Drive, the Dropbox redirect URI. If the Play account is a
personal one, budget 14 days of closed testing with 12 testers before production.
