# Folevi for iPhone and iPad: the native rebuild (plan, 2026-10-30)

The owner, 2026-10-30: "let's start the iOS app, same native rule as mac app." The Mac rule
(docs/MAC_REBUILD_PLAN.md): native as much as possible, SwiftUI/UIKit, looks match the web 100%, only the note
editor in a web view, no Capacitor or Electron.

Android stays paused completely. The Mac app keeps shipping (1.2.x) while this is built.

---

## 0. Owner decisions (2026-10-30, from the picker)

| Topic | Decision |
| --- | --- |
| iPhone look | Pixel match with the web's phone layout, as the iOS app shows it today (`apps/web/src/components/iphone/*`): the glass top bar, the Home / Tasks / Calendar tab bar, the Foli AI and + pill, Folevi's fonts. iOS behaviour stays iOS: swipe back, native scrolling and rubber banding, haptics, the keyboard, VoiceOver, Dynamic Type where the web scales. |
| iPad | Together with iPhone, one universal app. The iPad matches the web's iPad layout (sidebar and tab strip, as on the Mac) with touch sizes. |
| Starting point | The Mac rebuild's code only (`apps/native-kit`: `FoleviEngine`, `FoleviDesign` and its `Web*` components, the screens in `FoleviMac`). The older iPhone work on the `native-app` branch is reference only. |
| No account | Yes, like the Mac: first launch offers "Keep notes on my iPhone" (free, no limits, library on the device or in iCloud Drive, or a folder from Files) and "Sign in to Folevi". Local Vault and Foli AI (Apple's on-device model or the person's own key) work without an account. |
| Web parts | Only the note editor and what's drawn inside a note (mind maps, flowcharts, tables, embeds). Everything else native: Vault, Foli AI, every Settings section, Graph, Reviews. |
| Minimum iOS | iOS 18 (today's app is iOS 17; installs on 17 keep the current app). |
| Rollout | One build at the end. No TestFlight builds on the way; the upload is asked first, as always. Same bundle id `com.folevi.ios`, data carries over. |

Unchanged from earlier decisions: no buying inside the app (no prices or upgrade links, App Store 3.1.1); every
iPhone fix also applies to iPad ([[iphone-feedback-applies-to-ipad]]); the iOS extras stay (below).

---

## 1. Where things are

- **Shipped (TestFlight, 1.0.x builds):** `apps/ios` is Folevi's own web view host (`ios/App/Native/Host`, no
  Capacitor since 2026-10-24) around the whole web app at `capacitor://localhost`, with Swift services: Face ID
  lock, deep links, haptics, share extension, widgets and the Control Center control, App Intents, Spotlight,
  the document scanner and text recognition, APNs push, background refresh, Apple sign-in, the local library
  shell (`ios/App/Native/Shell`).
- **Mac rebuild (on `main`, shipping as 1.2.x):** `apps/native-kit` holds the pieces to reuse.
  `FoleviEngine` (bridge client, generated models, about 11,800 lines, no AppKit) and `FoleviDesign` (tokens,
  fonts, `WebText`, the web's icons, `WebNoteCard`, `WebFolderCard`, `WebComponents`, about 9,700 lines, 7 AppKit
  files) are mostly cross-platform. `FoleviMac` (about 25,000 lines, 47 AppKit files) holds the Mac frame and
  the Mac's screens (`WebNoteScreens`, `WebSidebar`, `WebTopBar`, Settings, Vault, Foli AI, Planner).
- **The web's phone layout** (the target to match): `IphoneShell`, `RootBar`, `TabBar`, `Glass`, `Screen`,
  `Sheet` and `sheetMotion`, `Rows`, `Grouped`, `NoteList`, `NoteBars`, `NoteChrome`, `IphoneHome`, `Tasks`,
  `Agenda`, `WeekStrip`, `QuickAddSheet`, `NewFolderSheet`, `AccountSheet`, `SettingsKit`, `Swipe`,
  `PullToRefresh`, `SearchScopes`, `transitions`, `tabStacks`.

---

## 2. Architecture

The same as the Mac: one `WKWebView` per scene runs the web engine (sync, outbox, E2EE, local library, places)
and draws the note page in content-only mode; SwiftUI screens read typed live views and send commands over the
bridge (`apps/web/src/lib/engine/protocol.ts`). No second data layer in Swift.

Package layout in `apps/native-kit`:
- `FoleviEngine`, `FoleviDesign`: shared as they are; the few AppKit pieces get UIKit twins behind `#if os(...)`.
- **Shared screens out of `FoleviMac`:** the screen bodies that are plain SwiftUI (cards, lists, Tasks,
  Calendar, Settings sections, Vault, Foli AI chat) move to a cross-platform target so iPad and Mac draw the
  same views. AppKit frame code stays in `FoleviMac`.
- **`FoleviPhone` (new):** the iPhone frame (glass top bar, tab bar and pill, per-tab navigation stacks,
  sheets with the web's detents and motion, swipe rows, pull to refresh, the note page's bars and keyboard
  toolbar) and the iPad frame (sidebar, tab strip, split view, popovers instead of sheets).
- `apps/ios` keeps its targets and services; the app's root switches from the web view host to
  `FoleviPhone`. The page stays at `capacitor://localhost` so installs keep their data.

---

## 3. Matching the web exactly

- The match harness (`pnpm match`, `apps/mac/scripts/match.mjs`) gains iPhone and iPad specimens: the web in
  Playwright WebKit at the device's viewport and scale (iPhone 16 Pro 402x874 @3x, iPhone 16 Pro Max 440x956
  @3x, iPhone SE 375x667 @2x, iPad Air 11" 820x1180 @2x, both orientations on iPad), the native view in the iOS
  Simulator (XCTest snapshots). Same thresholds as the Mac (channel 24, 0.5% of pixels), light and dark.
- Fixture data, fixed clock and avatars as on the Mac. Safe areas, the status bar and the home indicator are
  masked.
- Behaviour to match too: sheet detents and drag settle, the zoom from cards into a note, swipe actions,
  long-press menus (web menus styled to the iOS spec, per [[ios-polish-2026-10-22]]), empty states, copy (no em
  dashes, "Foli AI").

---

## 4. Work packages

**I0. Foundations.** Raise the iOS deployment target to 18 (app and package), split cross-platform code out of
`FoleviMac`, add `FoleviPhone`, make `FoleviDesign` build and render the same on iOS (fonts, `WebText`, icons,
cards), iPhone and iPad specimens in the harness.

**I1. iPhone frame and editor glue.** Glass top bar, tab bar and pill, navigation stacks with swipe back, sheets,
the note page in content-only mode with its bars, keyboard toolbar and Done, the zoom transition, scene restore.

**I2. First launch, local mode, sign-in.** The two choices, the local library (device, iCloud Drive, a folder),
sign-in (email and password, TOTP, Apple, Google, PKCE), the account and place switcher, migration from the
shipped app tested with scratch data.

**I3. Lists.** Home, All notes, folders, Starred, Shared, Drafts, search and its scopes, Notifications,
selection, swipe actions, long-press menus, pull to refresh.

**I4. Tasks, Calendar, Settings.** Tasks and their sheet, the week strip with the pull-down month, Agenda,
every Settings section.

**I5. Foli AI.** The chat sheet and page, tools, Continue, guardrails; on-device and own-key in local mode.

**I6. Vault.** Account and local Vault, previews (PDFKit, AVKit, Quick Look), Face ID.

**I7. iPad.** Sidebar, tab strip, split view, pointer and keyboard shortcuts, popovers, Stage Manager sizes.
(Shared screens arrive with I3 to I6; this package is the iPad frame and its own states.)

**I8. The rest.** Sharing and invitations, Templates, Archive, Trash, Graph, Reviews, Quick Add, help.

**I9. iOS extras on the new frame.** Share extension, widgets and the control, App Intents, Spotlight, scanner,
push with Done and Snooze, background sync, deep links, haptics.

**I10. Performance, tests, release.** Launch, scrolling at 120 Hz (Instruments hitches, as for the Mac), memory,
energy; the full test suites and the match suite; the upgrade test from the shipped app; one TestFlight / App
Store upload only with the owner's OK.

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| Mac changes break iOS (and back) | Shared targets build for both in CI; the match suite runs on both. |
| Text renders differently in Core Text | The Mac's `WebText` already matches WebKit; checked again on iOS at @3x. |
| Data loss on upgrade | Same bundle id and page origin; the upgrade test with scratch data is a release gate. |
| Glass and blur cost on scroll | Measure with Instruments from I1 on; flatten static layers (as on the Mac, 1.2.07). |

---

## 6. Hard rules

Never push `main`, deploy, notarize or upload to TestFlight without the owner's OK. Never use `--prod` with the
Convex CLI. Never print secrets. Never touch the owner's real library or app data (on the Mac or the owner's
iPhone); tests use the Simulator and scratch data. No em dashes. The assistant is "Foli AI". Commit with
`git commit <paths>`.

---

## 7. Where it stands

2026-10-30: plan written, I0 started.
- The shared package (`apps/native-kit`) builds for the iOS Simulator again (one Mac-only line in `FrameModel`
  was outside its `#if os(macOS)`), and needs iOS 18; the app's targets need iOS 18 too.
- New target `FoleviPhone` (empty frame so far: `PhoneTab`, the three tabs and their first routes).
- Today's iOS app builds again: its iPhone screens (`apps/ios/ios/App/Native/Phone`) hadn't been updated for the
  Settings pages and the `panesChange` event the Mac work added.

Later on 2026-10-30, I0 continued:
- **The match harness runs on iOS:** `node apps/mac/scripts/match.mjs --platform ios [--device "iPhone 18 Pro"]`
  photographs the web as the iOS app shows it (`data-native="ios"`) at 3x and draws the same specimens in the
  Simulator (`MatchShotTests`, ImageRenderer); report in `apps/ios/match-report/` (untracked). Sizes may differ
  by 1 px at 3x (CSS's 1/64 pt layout against SwiftUI's pixel grid). **All 14 specimens pass on iOS**, and all 14
  still pass on the Mac.
- What it took: type roles use Apple's Dynamic Type sizes on iOS, as the web does there (`WebTypeRole.metrics`);
  `.ui-caps` at Footnote in the muted ink; `pnpm styles:gen` also reads the samples as the iOS app shows them and
  writes the 41 that differ (buttons, menus, dialogs, inputs, selects, cards, chips) as `WebStyles.ios`, which
  `WebStyles.named` prefers on iOS; menus drawn the iOS way (icon after the label, hairlines, headings as written,
  at least 250 wide); line boxes round font metrics to the pixel grid on iOS (to whole points on the Mac).
  Text fields are drawn as their text in the diffs only (a UIKit field can't go into an ImageRenderer picture).
- **Sharing screens:** the web's phone layout reuses the same views as the desktop (Settings, Tasks, Calendar,
  the note browser, the Foli AI chat) and branches inside each. So screens move from `FoleviMac` to the
  cross-platform `FoleviScreens` one at a time, as each iPhone screen is built, and branch there the same way; no
  new target. First moved: `FrameRoute` (the web's routes, which the iPhone's tab stacks use too).
- Known, not from this work: `streamsIntoTheChat` (the unfinished native Foli AI chat's frame-time test) fails its
  33 ms p95 budget on a busy Mac, with or without these changes.

**I1 started (2026-10-30):**
- The web's Liquid Glass (`.ui-liquid`, `-strong`: shadows, hairline, blur, fill, edge light, sheen, rim, in the
  web's order) as `.liquidGlass()`, and the iPhone's floating controls on it (`FoleviDesign/Phone`):
  `WebGlassCircle`, `WebGlassPill`, `WebPillButton`, `WebGlassTextButton`, `PlusDisc` and `PhoneTabBar` (Home,
  Tasks, Calendar with the sliding lens; Foli AI and +). The `iphone-chrome` specimen (iOS only) matches the web's
  real Glass.tsx controls and TabBar.tsx markup at **0.01%**, light and dark.
- `PhoneScreen`: the web's Screen.tsx (Back or a leading control, the screen's actions, the large title with its
  eyebrow and subtitle, the bar's solid fade after 4 pt of scroll, the small title fading in over the last 12 pt).
- `FoleviPhone`: `PhoneFrameModel` (tabStacks.ts's rules, 6 tests) and `PhoneFrameView` (a navigation stack per
  tab, kept alive, iOS's push and edge swipe, the tab bar stepping away for a note).
- In the app: Debug builds with `FOLEVI_REBUILD=1` show the new frame with placeholder screens
  (`apps/ios/ios/App/Native/Rebuild/RebuildFrame.swift`; `FOLEVI_REBUILD_OPEN=/folders/x,...` opens routes at
  launch). Release, TestFlight and today's frame are untouched.
- The live blur behind glass is the system's lightest blur with its tint cleared; it can't be in the diffs (they
  draw over a plain canvas, where the web's blur changes nothing), so it's checked by eye on a device in I10.

Next in I1: the note page (the Page View from today's app's plumbing, its bars, keyboard toolbar and Done, the
zoom from a card), sheets with the web's detents and motion, the + menu and the account sheet; scroll and push
checks in the Simulator.
