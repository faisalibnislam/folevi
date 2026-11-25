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
- [x] App module: theme (Folevi colors, fonts, Lucide icons), adaptive scaffold, Home, All notes, folders,
      note page, Tasks, Calendar, Foli AI and Search screens, generic gate screen (first versions)
- [x] Demo engine (fixture data, debug only) so every layout can be checked without an account
- [x] Page View with the engine: marker, transport, the Android export; gates drawn natively
- [x] Run on phone, tablet, foldable and desktop-size emulators; screenshots

Phase 1, sign-in and data (done 2026-11-23)
- [x] Phone polish: the bar steps away on a note, a back arrow in the note bar, Home's rows open their lists
      (Drafts is `notes.list` unsorted, Shared with Me and Changes are native, Reviews through `web.show`)
- [x] Host bridge: a `window.Capacitor` stand-in over a WebMessageListener (`app/.../bridge/`), answered by
      Plugin and PluginCall with the API the services were written against
- [x] Every service moved from `apps/android/android` with its tests and manifest entries; the page runs on
      `https://localhost` as before
- [x] Sign-in: the page's own sign-in gate drives AuthBridge's Custom Tab flow (PKCE), drawn by the generic
      gate screen. Checked on an emulator with a dev test account (2026-11-24)
- [x] Web: phone note layout for the Android marker; big batches straight to `foleviEngineHost`
- [x] Contract revision 34: `"android"` in the marker's and `AppInfo`'s platforms

Phase 2, the rest of the first build (done 2026-11-23 unless noted)
- [x] Tasks (Today, Upcoming, Inbox, All, quick add) and Calendar (month grid, the day's tasks)
- [x] Foli AI chat (conversations, streamed replies) and Settings (account, appearance, text size, the web's
      settings pages, sign-out, Delete account)
- [x] Local mode on this device (checked end to end); Drive and Dropbox wait for the owner's client ids
- [x] Vault: set up, recovery key, unlock, passwords, files, trash, item fields, Lock
- [x] Android extras moved: share target (checked end to end), widgets, Quick Settings tile, app shortcuts,
      push (needs the owner's Firebase settings), scanner, biometric lock, app actions
- [x] Googlebook: keyboard shortcuts with the shortcuts helper, right-click and long-press note menus, Open in
      new window, dragging a note out as a link, hand pointer; desktop-size emulator pass
- [x] Capacitor and `apps/android/android` removed
- [ ] Native screens still drawn by the web or missing: onboarding and sign-in polish (Google and passkeys via
      Credential Manager), note sharing sheet, templates, archive and trash lists in the sidebar, Search's
      filters, widgets restyled in Material 3

Phase 2b, tabs and polish (2026-11-24, branch `claude/android-tabs`; details in `docs/ANDROID_POLISH_2026-11-24.md`)
- [x] Tabs on tablets, open foldables and Googlebooks with the web's rules (owner, 2026-11-24); phones keep Back
- [x] Links inside notes (`navigate.request`); note titles name their tabs
- [x] android-skills audit: place switching and share-target hardening, edge-to-edge, widgets, ANRs, keys, Back
- [ ] Audit follow-ups: Baseline Profile, icon codegen, R8 rules, Glance canonical layouts, app lock, previews

Phase 3, release
- [x] Release build with R8 (keep rules for the bridge and the contract), upload-key signing from the owner's
      `~/.gradle/gradle.properties`; a debug-key R8 build ran local mode on an emulator
- [ ] Play internal testing (owner uploads), Data safety form, account deletion link
- [ ] Adaptive quality Tier 2 checks, then the large-screen badge
- [ ] Target API 37 before the next Play deadline; the app bundle is large (about 128 MB universal APK: the web
      export and ML Kit), so check the bundle's per-device size in Play Console

## 5. Owner steps (later)

The Capacitor README's list still applies (`apps/android/README.md`, "Steps only the owner can do"): Play
Console app and Play App Signing, an upload key outside the repo, App Links fingerprints on Vercel, Firebase
for push, Google Cloud Android OAuth client for Drive, the Dropbox redirect URI. If the Play account is a
personal one, budget 14 days of closed testing with 12 testers before production.

## 6. Resumed 2026-11-25: native UI, "Today's UI, Material 3 native"

Owner's answers (2026-11-25, relayed by the iOS session):

- **Look:** keep today's screens, layout, spacing, type and colours from the web phone and tablet layout
  (`apps/web/src/components/iphone/*`, the tablet Shell). Build them with Android's own elements: Material 3
  Expressive buttons, sheets, menus, motion, predictive back and edge-to-edge.
- **Shape:** Compose for every screen and for the note page's chrome; only the writing area stays the web editor.
  The data layer stays the web engine (this plan's section 3).
- **Rollout:** one big switch. The Capacitor app (`apps/mobile/android`, PR 69 with PR 103 and PR 108) ships until
  then and gets only serious bug fixes. Emulators only; no Play upload without the owner's OK.
- **Match iOS:**
  - Foli AI chat is native.
  - Settings are native, except Webhooks, API tokens, Connected apps, AI export and workspace Data, which open as
    in-app web pages.
  - Phone first, then tablet and foldable.

More owner answers (2026-11-25):

- The UX to keep is the **Capacitor app's** (the web phone and tablet UI).
- Surfaces use **Folevi's own glass, colors and shadows** (`design/Glass.kt`, the web's `.ui-liquid` values), not
  Material's tonal tint or elevation.
- Touch feedback is **Android's ripple**.
- "Your own server" is drawn natively **under the sign-in buttons, like the web**.

Starting point: this app (sections 3 and 4), which still builds (59 unit tests pass, 2026-11-25) and runs in demo
mode.

### Gaps, in order

1. **Phone bar** matches the web's (done 2026-11-25, `ui/PhoneBar.kt`):
   - Home, Tasks and Calendar in one floating capsule; Foli AI and + in another.
   - + offers New note, New folder and Quick task. On Tasks, + is Quick task straight away.
   - Restyled to the web's look:
     - Glass capsules with the web's shadow.
     - Icon-only tabs, with a lens that slides between them.
     - The gradient Foli AI mark (`design/AiMark.kt`).
     - The dark + disc.
   - One difference from the web: the bar sits above Android's gesture area.
   - Headless UI tests: `PhoneBarTest`.
   - Still to do:
     - From template (needs a native templates screen).
     - Content scrolling under the bar.
2. **Port the Capacitor app's newer service work** into `apps/android` (done 2026-11-25 for "Your own server";
   most file differences are only the plugin base class). Ported:
   - "Your own server": `server/ShellServer.kt`, `server/LocalServers.kt`, `Places.kt` (server places),
     `AuthBridge` per-site sign-in, `PlacesPlugin` (addServer, localServers, scanCode, setActiveOrigin).
   - The per-place CSP and the Http home-network rule.
   - SaveTargets and PlaceOutbox skipping server places.
   - Also:
     - The page's bridge (`places.server`, `addServerPlace`, `scanCode`, `listLocalServers`, best connection
       through `folevi-server.js`).
     - Cleartext only to home addresses.
     - `server/ServerSignIn.kt`, shared by the bridge and the native block.
   - The native block is `ui/OwnServer.kt` (`OwnServerTest`), shown under Folevi Cloud's sign-in gate.
   - Not yet checked on an emulator: the sign-in gate needs the dev server. A full server sign-in and a real QR
     read are untested.
   - Not ported, since they're Capacitor-only and the native chrome replaces them: PR 108's keyboard and polish
     fixes in the Capacitor `MainActivity`.
3. **Screen-by-screen match with the web phone layout**, with screenshot tests per screen against the web's:
   - Home (glass top bar, Recent cards, rows, Starred).
   - Notes lists (swipe actions, Select mode, Organize).
   - Note chrome (NoteBars: top bar, floating bottom bars, keyboard bar, tool sheets).
   - Tasks (WeekStrip, TaskSheet).
   - Calendar (Agenda).
   - Search scopes.
   - Account sheet.
   - New folder sheet.
   - Pull to refresh.
   - Sync status.
4. **Settings:** native for every section except the technical ones above, which open through `WebShowRoute`.
5. **Missing native screens** (section 4's open items):
   - Onboarding and sign-in (Credential Manager: Google, passkeys).
   - Note sharing sheet.
   - Templates.
   - Archive and Trash.
   - Search filters.
   - Material 3 widgets.
6. **Tablet and foldable**, matching the web tablet Shell (sidebar and tab strip are already here). Then
   Googlebook.
7. **The switch:**
   - Release build checks.
   - The owner's OK.
   - Play upload by the owner.
   - The Capacitor app retires.

### Where it stands (2026-11-25, evening)

Built natively, to the web phone layout's sizes, type, colors and shadows (`design/PhoneKit.kt`, `design/Glass.kt`):

| Area | Where | Notes |
| --- | --- | --- |
| Phone bar | `ui/PhoneBar.kt` | The tab capsule and the Foli AI and + capsule. |
| Home | `ui/HomeScreens.kt` | Avatar, sync and bell, the "…" menu, search pill, notebook cards, Catch me up, tiles, Bookmarks, Folders, Tags, then Vault, Templates, Archive and Trash. |
| Note lists | `ui/HomeScreens.kt` | Cards or rows, filter, view and sort, swipe actions, long-press menu, Select mode with its bar, Empty Trash, built-in templates. |
| All folders, Notifications | `ui/HomeScreens.kt` | |
| Note page chrome | `ui/NoteScreen.kt` | A Compose layer over the page (MainActivity). Glass top bar (Back, place chip, Share, menu, Done while writing), tool capsules, keyboard bar, native Format sheet, the note menu from `NoteMenuState`. |
| Tasks, Quick add | `ui/TasksScreens.kt` | Chips with counts, groups, task lines, swipes, the task sheet. |
| Calendar | `ui/CalendarScreens.kt` | Week strip and month, the agenda with events. |
| Search | `ui/SearchScreens.kt` | |
| Account sheet, New folder | `ui/AccountSheet.kt`, `ui/NewFolderSheet.kt` | |
| Settings | `ui/SettingsScreens.kt` | Native sections. The technical ones (and those the engine has no typed view for) open as web pages. |
| Your own server | `ui/OwnServer.kt`, `server/*` | |

Checked on the Android 37 emulator with real data (local mode):
- The screens above.
- The chrome over the live editor.
- The Format sheet and the keyboard bar.
- A tablet-sized window.

The 87 app unit tests and 5 engine unit tests pass; 14 of the app tests are Robolectric UI tests.

Still open:
- **Engine and page side:**
  - Insert, Comments, Style and Foli AI panels are still the page's own sheets. There is no Kotlin Insert catalogue, and no flag to stop the page drawing its sheet.
  - The place chip doesn't fold into the title on scroll, because the page sends no scroll event.
- **Screens not restyled yet:** the Foli AI chat, Vault, Shared and Changes keep the earlier native styling.
- **Smaller gaps:**
  - Search's Actions section.
  - The month view's 1:1 drag.
  - The tablet's rail is Material, not the web tablet sidebar.
- **Not tested:**
  - Signing in to Folevi Cloud on the emulator. Chrome's first-run screen asks to accept Google's terms, which is left to the owner.
  - A real QR code.
  - Signing in to a home server.
- **Activity theme:** it is now light by day and dark at night, so the page follows the phone (it was always dark).
