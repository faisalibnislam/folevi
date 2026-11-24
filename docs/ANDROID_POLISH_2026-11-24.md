# Android: tabs and the android-skills audit (2026-11-24)

Two things on branch `claude/android-tabs` (stacked on `claude/android-native-622675`, PR 54):

1. **Tabs on tablets, open foldables and Googlebooks**, the owner's rule of 2026-11-24 ("everything will open in
   new tab just like the web app"). Phones keep one page with Back.
2. **A polish pass against Google's Android agent skills** (the `android-skills` plugin, `android/skills` 1.0.24),
   from four read-only audits: adaptive layouts with Navigation 3 and predictive back; edge-to-edge and Glance
   widgets; intent and permission security; Compose performance, R8 and ANRs.

## 1. Tabs

The web's rules (`apps/web/src/lib/app/tabs.tsx`) as the Mac app has them (`TabsModel.swift`), in
`apps/android/app/src/main/java/com/folevi/android/ui/Tabs.kt`, with `TabsModelTest` (16 tests, the Mac's
`TabBackTests` among them):

- Home is the first tab and never closes. A view gets one tab (one per kind, one per folder or tag) that follows
  you inside it (a Foli AI chat stays in Foli AI's tab).
- A page opened from a page (Home's rows and cards, See all, a folder card, a note in a list, a search result)
  opens a tab that remembers its opener. Back walks the tab's own history, then closes it and shows the opener.
- The sidebar, the rail and New note (+ in the strip, Ctrl+N) open fresh tabs with no way back.
- A link inside a note replaces the note's tab (Back returns to the note before); a modifier click or "Open in new
  tab" adds a tab behind. This needed `navigate.request`, which Android didn't handle before: links inside notes
  did nothing.
- Folders open Finder style in one folder tab. At most 12 tabs besides Home. Closed tabs reopen.
- Keys: Ctrl+W, Ctrl+Shift+T, Ctrl+Tab and Ctrl+Shift+Tab, Ctrl+[ and Ctrl+], plus the existing ones. Right-click
  or long-press a tab for Close, Close other tabs, Reopen. Middle-click closes.
- The strip survives rotation and the process going away (`TabsModel.saver`). A fold carries the page on screen:
  unfolding opens it as a tab, folding puts the tab on screen on the phone's stack.

Checked on emulators: Folevi_Tablet (2560x1600, sidebar), Folevi_Foldable open (rail) and folded (phone), the
keys on the open foldable.

## 2. Audit findings

### Fixed on this branch

| Area | Finding | Fix |
| --- | --- | --- |
| Security | Any web page or app could switch the open account or library with `folevi://...?place=` | Only intents Folevi makes (through the non-exported `.InternalLink` alias) may switch the place or open a window at a note |
| Security | The share target could be made to copy Folevi's own private files into the Inbox (`file://`, own provider, folders Folevi holds a grant on) | Only other apps' `content://` addresses; read off the main thread |
| Security | `onNewIntent` kept the old intent | `setIntent` first |
| Security | An unused FileProvider | Removed |
| Feature | `RECORD_AUDIO` declared but the page's microphone was never granted (the editor's audio recorder couldn't work) | A WebChromeClient grants audio only to Folevi's own page, after Android's permission prompt |
| Edge-to-edge | System bar icons followed the system's theme, not Folevi's appearance | `enableEdgeToEdge` with the app's light or dark style |
| Edge-to-edge | The whole app was padded by the safe area (nothing reached the edges; the phone's bar rode on the keyboard) | Each area keeps clear of the bars and keyboard itself (scaffolds, the strip, the gate screens) |
| Edge-to-edge | The WebView could apply insets of its own on top | Its insets are consumed: native lays the note pane out |
| Adaptive | Every step of a window resize threw away all screen state | The frame starts over only when the width class changes |
| Back | Back at the root of Tasks, Calendar or Foli AI closed the app | It goes Home first (`NavigationBackHandler`) |
| Back | Lists and search had no Back arrow for mouse users | A Back arrow in tabs that can go back |
| Keys | Holding a shortcut repeated it (Ctrl+N made a note per repeat) | Repeats ignored; the shortcuts helper lists only keys that work here |
| Widgets | A live widget session showed stale data after a change | A revision in each widget's state; the widget reads its copy again when it changes |
| Widgets | A release build could strip the check-off action's constructor | Keep rule for `ActionCallback` constructors |
| Widgets | The check-off made a network call inside the action | The background refresh sends it |
| ANR | Synchronous `SharedPreferences.commit()` on place changes; a Keystore decrypt in `onCreate`; WorkManager setup in `Application.onCreate` | `apply()`; the decrypt and the scheduling off the main thread |
| Jank | Notes grid without `contentType`; a new `DateFormat` per card | Added; one shared formatter |
| State | Search text lost on rotation | `rememberSaveable` |

### Not done yet (follow-ups)

- **Baseline Profile** (`:baselineprofile` module: cold start, notes grid scroll, opening a note). Google's typical
  gain is 20-30% faster cold start.
- **Icons**: `WebIcon` is a 341-entry enum allocating about 1,000 path strings on first use, and only 39 are used.
  Change `scripts/icons-codegen-kotlin.mjs` to emit one lazy `ImageVector` per icon.
- **R8 rules**: the serialization keep rules keep all 487 contract models; kotlinx.serialization 1.13 ships
  conditional rules. Narrow them and run `analyzeReleaseR8Config`, then check a release build end to end
  (including restoring the back stack after process death).
- **Widgets**: map to Glance canonical layouts (check list, action list, toolbar), `SizeMode.Exact`, resize and
  preview attributes, Glance theme colors, `appWidgetBackground()`, 48dp touch targets, `onCompositionError`.
- **App lock**: `BIOMETRIC_STRONG or DEVICE_CREDENTIAL`, a Keystore key tied to authentication for the Vault and
  E2EE keys; ask for the lock before the share sheet lists places.
- **Bridge permissions**: two page permission requests at once lose a callback; queue them.
- **Application.onCreate**: make the services lazy (OkHttp, cloud, AI) so widget, push and boot processes start
  faster.
- **Predictive back**: the note (a WebView) doesn't move with the back gesture's animation.
- **Phone tabs' saved state**: one `NavDisplay` for four back stacks; the Nav3 "multiple back stacks" recipe keeps
  each stack's screen state (scroll) across tab switches.
- **Tooltips and cursors**: icon buttons have no tooltips; drag sources should show the grab cursor.
- **Form-factor previews and screenshot tests** for phone, foldable, tablet and desktop.
- **configChanges**: the activity handles configuration changes itself to keep the WebView alive. The adaptive
  skill says never to; the trade-off stays, recorded here.
