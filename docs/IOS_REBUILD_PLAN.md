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

I1 continued (2026-10-31):
- **Sheets** (`FoleviDesign/Phone/PhoneSheet.swift`): the web's Sheet.tsx copies UIKit's sheet, so natively iOS's
  own sheet does the moving (drag, detents, dim, keyboard) and `.phoneSheet(isPresented:size:snapToBlocks:)` draws
  what the web draws on it: the `--iphone-solid` surface with the sheet radius, the grabber, the 56 pt header (round
  Close, sides as wide as each other, title centred) and the web's detents: large under the status bar less 10,
  medium 56% of the screen or fitted to whole sections (`.phoneSheetBlock()`), fit to content. iOS's height detents
  leave out the home indicator, the web's run to the screen's foot, so the native ones are the web's less it.
  On iOS 26 a sheet at a partial detent floats a little in from the screen's edges (the system's look); the web's
  stays attached. Not yet: the card variant (New folder), which arrives with the sheets that use it.
- **Inset grouped lists** (`PhoneGrouped.swift`): Grouped.tsx's section, row, row icon and the hairlines that
  start at a row's text (`.phoneSeparatorInset`).
- **The account sheet** (`PhoneAccountSheet.swift`): AccountSheet.tsx's places (accounts, workspaces under them,
  the library), Settings, Sign in to another account, Move or copy notes, Help, Sign out; medium, ending after
  Places. Filled from the engine since I2.
- **Menus and +** (`PhoneMenu.swift`): the web's iOS menu panel placed as Menu.tsx places it (8 pt off, flips,
  stays on screen) and grown on the menu spring from its corner; the Create menu over + (New note, From template,
  New folder, Quick task; on Tasks, + is Quick task). The sheets New folder and Quick task open come with their
  data (I3, I4).
- Checked in the Simulator by launch hooks (`FOLEVI_REBUILD_SHEET=account` or `create`), light and dark; 12
  tests (tab stacks, detents, menu placement); the iOS match suite still passes (16 of 16, iphone-chrome 0.01%).
  Not yet in the diffs: the sheet and the account rows (no web specimen for them yet).

- **The note page** (2026-10-31): the rebuild frame now runs today's app's one web view and engine
  (`RebuildFrameController`: WebHost, PhoneModel, PageViewHost, the keyboard followed) with the new frame over it;
  a note (`Rebuild/RebuildNote.swift`) adopts the page and draws the web's bars natively (`PhoneNoteBars.swift`):
  Back, the place chip, Share and "…" (the web's note actions, in Folevi's menu), Done while writing; Comments,
  Style, Format, Foli AI and Insert at the bottom; the bar on the keyboard (Insert, Format, Foli AI, To-do, Indent,
  Outdent, Link with a native prompt, Mention, Image, Undo, Redo, Hide). The note's scroll comes from a small page
  script (the note scrolls in `#doc-scroll`, not the web view's scroll view) for the bar's fade and small title.
  A note zooms out of the card it was opened from (iOS's zoom, `.phoneZoomSource(id)` on cards).
- Web change for it: in native-chrome mode on the iPhone the note's scroller runs under the bars with their room
  as its own padding (as on the web's phone layout), so the note's colour reaches the screen's edges
  (`Shell.tsx`, `DocumentView.tsx`). The Mac's native chrome is unchanged. Today's shipped iOS frame gets this too
  with its next build (its note text then scrolls under its glass bars, as iOS does).
- The `iphone-note` specimen (place chip, tool bars, keyboard bar) matches the web at 0.12%; the iOS suite is 18 of
  18. Checked in the Simulator on the built-in interface in local mode (scratch library): a new note, its bars, and
  the bar's fade and small title when it scrolls. Not checked (needs a tap): the keyboard and the bar on it live,
  Done, the tool sheets opening, the zoom and swipe back. The page's tool panels are still the page's sheets.
- Debug hooks: `FOLEVI_REBUILD_NEWNOTE=1` (a new note at launch), `FOLEVI_REBUILD_DEBUG=1` (the engine's state).
  The Simulator build needs the built-in interface: `pnpm shell && pnpm sync` in apps/ios (bundled mode).

- **Format and Insert native** (2026-10-31, the owner's call): the note's Format and Insert tools are native sheets
  (`PhoneFormatSheet.swift`, `PhoneInsertSheet.swift`), matching the web's iPhone panels at 0.08% and 0.00%
  (`iphone-format`, `iphone-insert`; the iOS suite is 22 of 22). Contract revision 21 for them: `format.set`
  (text style, colour, highlight, alignment, Page or Card, focus line, block background, callout tone, code
  language, clear formatting), `editor.state.format` (the line's formatting), `format { block: "code" }`, and
  `insert { kind }` taking any Insert tile by its id and `quick-table-<r>x<c>`. The Insert sheet's sections, tiles
  and pictures are generated from the web's own components (`apps/web/test/native-insert-catalog.test.tsx` writes
  `Generated/InsertCatalog.swift`; it fails when stale). Checked end to end in the Simulator: an insert by id, a
  quick table and a `format.set` reach the editor (`FOLEVI_REBUILD_EDIT=1`); both sheets open
  (`FOLEVI_REBUILD_SHEET=format|insert`). Fitted sheets now size from the panel's natural height and scroll past
  the screen's.
- Not yet: a note theme's own colour names and palette in Format (the fixed colours show); Style, Comments and
  Foli AI are still the page's sheets: Style and Comments need the note's look and its comment threads in the
  contract (views and commands), Foli AI is I5.

- **Style and Comments native** (2026-10-31): the note's Style and Comments tools are native sheets
  (`PhoneStyleSheet.swift`, `PhoneCommentsSheet.swift`), matching the web's iPhone panels at 0.13% and 0.44%
  (`iphone-style`, `iphone-comments`; the iOS suite is 26 of 26, the Mac's 14 of 14). Contract revision 22: the
  `note.style` view (themes with their pictures and plan locks, the colours, separator, font and width as the panel
  shows them) with `note.style.set` and `note.theme.set`; `note.tools` threads carry their comments and who may
  resolve or delete them; `comment.create`, `comment.reply`, `comment.resolve`, `comment.read` and
  `comment.deleteThread` go through the outbox as the web's own controls. Style: preview, themes (the app's own
  covers, or a picture from the web for a theme added later), All themes, Blur background, Document and Text
  colour, Separator, Font, Page width. Comments: a comment on the whole note, Open and Resolved, search, threads
  (one on a line opens in the note with `thread.open`; one on the whole note opens in the sheet with its comments
  and a reply), each with Resolve, read marks, Copy link and Delete; local mode says what comments need.
  Checked in the Simulator: a theme and a page colour sent through the engine change the note and show in the
  sheet (`FOLEVI_REBUILD_EDIT=style`); Comments in local mode.
- Not yet: uploading the person's own image as a style (the web's gallery does it), a theme's own typefaces in the
  Style sheet (each font type's standard face shows), @-mentions picked from a list (a typed "@Name" stays text),
  reactions and editing a comment, a note's Follow/Mute comments row; comments checked with an account.
- Kit changes on the way: disabled buttons fade as one picture at the web's 0.5 (0.4 on the Mac);
  `WebFittedLines` sets wrapped text in exact CSS line boxes in one layout pass; the match test redraws until a
  picture stops changing size.

- **Scene restore** (2026-10-31): the new frame's tabs and their screens are saved with the scene (its
  restoration activity, `NSUserActivityTypes` com.folevi.ios.frame) and come back at the next launch; checked in
  the Simulator (Calendar on show and a folder in Home's stack, back after the app was ended in the background).

I1 is done but for Foli AI's sheet (I5) and tap checks (need Simulator input allowed in the simulator panel).

**I2 started (2026-10-31):**
- The gate screens (first launch, library setup, the library ready, the locked library, the sign-in and message
  cards) moved from FoleviMac to FoleviScreens (`Onboarding/WebGates.swift`) and branch for the iPhone as the web
  does there: every choice the same white card with the suggested one captioned RECOMMENDED, the large title on
  balanced lines, paragraphs broken greedily inside their padding, the column centred on the page as the web lays
  it out (under the status bar), the iPhone's own words for the places. The new frame shows them over itself while
  the engine says one is up.
- iPhone styles for the gates: `apps/ios/scripts/gate-styles.mjs` measures them in the Simulator's web frame (the
  Mac's measuring script, now `scripts/style-extract.mjs`) into `app-styles-cache/gates.ios.json`; `pnpm
  styles:gen` puts the 46 that differ in WebStyles.ios.
- Whole-screen check: `apps/ios/scripts/gate-match.mjs` takes each gate from a fresh install, in the web frame
  and in the new frame, light and dark, and compares them (status bar and home indicator left out; the threshold
  is 0.5%). Now (2026-10-31): first launch 0.04/0.05%, library setup 0.13/0.14%, library ready 0.26/0.27%, sign-in
  0.49/0.51%, the locked library 0.39/0.05% (light/dark). Sign-in dark is 0.01 over: white-on-black text
  antialiasing, the same to the eye. Paragraphs break as the iPhone's WebKit does (`text-wrap: pretty` measured
  against the web's own breaks: a last-line weight of 0.6, `WebTextWrap.iPhonePretty`).
- **Sign-in**: the page's phone layout now reports its screen to native (it didn't: only the Mac's card did), and
  follows the system's appearance (it kept the one it loaded with; a bug in today's app too). The native screen is
  the logo, the title and its line over Continue with Apple, Continue with Google, Sign in with email and Keep notes
  on my devices instead; each presses the page's own button (Apple's sheet, PKCE in the sign-in sheet).
- The new frame survives a change of mode or place (`FoleviViewController.restart` retires it and makes a new one
  on the new web view; before, it fell back to the old frame).
- **The locked library**: measured from the web (`gates.locked.*`), "this iPhone" or "this iPad", unlocks through
  the page (checked in the Simulator: the passphrase typed in the native field opens the library). The column
  moves up out of the keyboard's way, and the hidden page's own field no longer takes the keyboard (it did: a dark
  keyboard, and typing would have gone into the hidden page). The harness reaches it by encrypting a scratch
  library and opening it again without its key (`FOLEVI_FORGET_LIBRARY_KEY`, Debug Simulator builds only).
- **The account sheet** is real: the places from the engine (FoleviScreens' PlacesModel: the open account with
  Personal, its workspaces and New workspace…, the other accounts, the library on this device), a space switching
  in the engine, another place through ShellPlaces and a restart, Sign in to another account through ShellAuth,
  Settings, Help. Sign out is the page's own (`account.signOut`, contract revision 23: this account's copy and keys
  here go, then the host opens the next place), with a warning only when changes haven't synced, as the web.
  Checked in local mode (the page signs out and starts again); in account mode not yet (needs a signed-in test
  account). New workspace and Move or copy say they come with the next update, as today's app does.
- **Upgrade**: `apps/ios/scripts/upgrade-check.mjs` makes a library and a note in today's frame, opens the same
  install in the new frame straight on that note, makes one there, and finds it in today's app again: 5 of 5 pass.
  This is today's frame from this branch's build, not the App Store binary (the Simulator can't install that one);
  a TestFlight-to-rebuild check on a device waits for the one build at the end.

Left in I2: email and password and TOTP sign-in are the website's in the sign-in sheet, as today (no native form);
account-mode sign-out and place switching want a run with a scratch test account.

**I3 started (2026-10-31):**
- **Method**, as I2's: `apps/ios/scripts/screen-match.mjs` seeds one scratch library on a fresh install (the
  sample notes and folders, a note made and starred, one archived, through the engine), then opens each screen in
  the web frame and in the new frame, light and dark, and compares the whole screen. `--styles` measures the web's
  elements for the native screens (`packages/design-tokens/match/app-styles/phone.json`, iPhone only, skipped by
  the Mac's run) into `phone.ios.json`; `scripts/web-styles.mjs` keeps styles only the iPhone has. Debug hooks:
  FOLEVI_REBUILD_SCROLL (a screen's lower part), FOLEVI_GATE_NO_KEYBOARD (search and the lock without the keyboard).
  Times ("4 mins ago") come from the clock on both sides: run `--no-seed` an hour after seeding for steady shots.
- **Home** (FoleviPhone `PhoneHome.swift`, from HomeModel): the avatar, the pill (the bell only signed in), the
  search field, recent cards, Catch me up and the rows, Starred, Folders (cards and their menu), Tags (folding),
  Templates, Archive, Trash. The phone's card rules (globals.css `:root[data-iphone]`): 18 pt open edge, one date,
  balanced Spectral 17/22 titles, folder names 20/24, the dark folder tones. Line boxes shorter than the font (the
  large titles) now keep their CSS height on iOS (WebText).
- **Note lists** (`PhoneNotesList.swift`, from NotesListModel): All notes, Drafts, Starred, Archive, Trash,
  Templates, a folder (its folders first), a tag; cards or rows, the search field, the empty screens, View as and
  Sort; Select mode (Select All, the count, Done, checks and rings, the action bar in the tab bar's place); swipe
  actions on rows (`PhoneSwipe.swift`, the web's SwipeRow); the long-press menu (the web's items; menus now blur
  what's behind them on iOS); Move, Copy and the confirmations (the kit's sheets); pull to refresh (iOS's own).
- **Search** (`PhoneSearch.swift`, from SearchModel): the palette's full screen, chips with their menus, Recent,
  Actions, notes found with the words marked, by meaning.
- **The rest of the screens** (2026-10-31): All folders (`PhoneFolders.swift`: cards or rows, search, View as
  and Sort), New folder (the web's card in the middle of the screen: title, colour, inside, Create; from Home, All
  folders and a folder; checked in the Simulator: made and opened), a folder's colour washed over its screen, New
  note here and the empty screens' New note, Templates' New template and Generate with AI, Shared with Me and
  Changes (`PhoneShared.swift`, signed in only), the bell's Notifications sheet (`PhoneNotifications.swift`: All or
  Unread, Mark all read, Settings, Today, Yesterday and Earlier, swipes and a menu). Menus show their checks on
  iOS (a column before the words, as globals.css); card titles clamp after their last word; the keyboard no longer
  lifts the tab bar.
- **Comparisons now** (light/dark, 2026-10-31, after closing the gaps): Starred 0.04/0.03%, Archive 0.03/0.02%,
  Drafts 0.06/0.05%, Trash 0.09%, a folder 0.12/0.11%, All notes 0.14/0.13%, empty search 0.24%, Home 0.35% light,
  All folders 0.40/0.47%, Home's lower half 0.46/0.49% pass; search typed 0.70/0.69% and Home dark 1.35% don't.
  The gates are unchanged (sign-in dark 0.51%). What closed them:
  1. Cards' previews and folder papers take WebKit's own line breaks (`text.layout`, contract revision 24), since
     iOS WebKit's `text-wrap: pretty` in a line-clamped box matched no model.
  2. No kerning across a hyphen on iOS, as WebKit shapes text (a zero-width non-joiner and space after each one).
  3. The folder card: its cover's words in a box of the cover's size (they grew it), and the count badge's top
     guide no longer lines the age and the name up 1.3 cq low (`webText`'s explicit guide, carried out through the
     badge's padding into the cover's ZStack). A thing to watch elsewhere: a one-line `webText` with padding in a
     ZStack or HStack moves its siblings by that padding.
  4. Search's Recent is the notes opened last (`recent.viewed`), as the web means it.
  What's left:
  1. Home dark: the tab bar's glass over the folder cards. The web blurs what's behind at 9 px with saturate(1.8),
     which keeps the folders' colours in the glass; iOS's public blur (the lightest material, its tint removed)
     blurs wider and doesn't saturate. Matching it needs private API (a custom backdrop filter), so it stays.
     Light passes, since the light glass is near white either way.
  2. Search typed: the marked words' highlight is about 1 pt wider each side natively.
  3. Small text everywhere differs by antialiasing (WebKit and Core Text shape Instrument Sans a little
     differently): the remaining 0.1 to 0.3% on every screen.
- **Not checked against the web:** Shared with Me, Changes and Notifications exist only signed in, so the scratch
  library can't show them; they follow the web's markup and need a run with a scratch test account. Changes
  shows a note's changes with the kit's native diff, where the web draws the changed blocks in its editor.
- A folder's menu: a long press on a folder card (Home, All folders) shows the kit's folder menu (new note, new
  folder inside, rename, colour, move, Foli AI, copy link, delete); rename, move and delete use the kit's dialogs
  (iOS's own alerts and sheets, where the web draws its dialogs: to match in a later pass). Moving a folder to
  another place and inviting people say they're coming.
- Not yet in I3: iPad (I6 has its own frame).

**I4 (2026-10-31): Tasks, Calendar and Settings, native** (branch `claude/xenodochial-lamarr-eba91d`, on top of I3):
- **Tasks** (`FoleviPhone/PhoneTasks.swift`, `Rebuild/RebuildTasks.swift`, from TasksModel): the views as capsules
  (Today, Inbox, Upcoming, All, Mine, Done, with counts; the chosen one kept 16 pt in sight as Tasks.tsx places it),
  the filter, the groups by note (a link to it) or by day in Upcoming, folding with their count, task rows (the box
  that fills and ticks, the words on exact CSS line boxes, the second line: overdue in red, the time, the note, who,
  priority, the repeat icon; closed tasks struck through), swipes (Done or Reopen; Tomorrow, Date), the empty and
  loading screens, More (Calendar, Completed tasks). One model per tab: another view replaces the first screen's
  address and the model follows it.
- **A task's sheet** (`PhoneTaskSheet.swift`, from TaskSheetHost, so Tasks and Calendar share it): the task and its
  box, Status as the web's segmented capsule, Date and Time (iOS's own pickers inline, as the web asks the app for
  them; Remove date, All day), the quick dates, Priority and Assignee as menus, Repeats, In the note. Every change
  saved as made (TaskEdits, Undo in the toast where the web has it).
- **Calendar** (`PhoneAgenda.swift`, from CalendarModel): the month as the large title, Today when another day is
  picked, More with Agenda, Week, Month and (signed in) Subscribe to a calendar; the week strip (weekday letters,
  today and the picked day filled, a dot for days with something on, weeks paged sideways keeping the weekday) with
  its pull-down month (dragged 1:1 with rubber banding, settled with the release's speed, or by the grabber; open,
  it pages by month and folds when a day is picked), pinned under the bar while the days scroll (`pinsHeader`); the
  agenda: the picked day and the next 30 with something on, overdue first on today, done tasks ticked (the range now
  asks for completed tasks, as the web's does), events with their calendar's colour, Nothing planned, a day's +
  (a task on that day). Week and Month show the kit's grids (`CalendarGrids.swift`), not matched to the web's yet.
- **Settings** (`PhoneSettingsKit.swift`, `PhoneSettings.swift`, `PhoneSettingsAccount.swift`,
  `Rebuild/RebuildSettings.swift`): the web's iPhone Settings kit natively (IosSection, IosRow with its value up to
  55% of the row, IosSwitch, IosText, ChoiceRow's pushed list with a check, DestructiveRow with iOS's action sheet),
  each section and each pushed screen (`/settings/<section>?screen=<id>`) a screen of the frame's stack. The list
  (You, the workspace's, Create a workspace, Support, the version). A library's sections: Library, AI on the device,
  Appearance, Import & export, This device (the app's own Face ID lock, LockSettings and AppLock). An account's:
  Account, AI, Plan & billing (the plan only: no buying in the app), Security, Privacy, Devices, Connected apps,
  Notifications, Offline & sync, and the workspace's General, Members, Privacy, Guests, Plan & billing, from the
  engine's settings views and the Convex allowlist (`settings.query`, `settings.run`, as the Mac's Settings).
  `viewsSettings.ts` gives the library and local AI payloads the iPhone's own words (a `phone` object: the short
  status, the device rows, the footers), no contract change.
- **Kit fixes that move I3's screens too:** a large title that fits on one line is framed exactly (laid out as lines,
  38.08 pt became 38.33 at 3x and everything under it sat a pixel low); the search field's placeholder is drawn in
  the web's letter spacing (a UIKit prompt has none); grouped footers on exact CSS line boxes.
- **Harness:** `screen-match.mjs` seeds tasks (in a note and the Inbox: overdue, today, tomorrow with a time and a
  priority, later, undated, one done), has I4's screens, `--side web|native` (one side only, then `--diff-only`),
  `settle` (a script run in the web frame once the screen is drawn: Tasks' capsule row placed by the web's own rule,
  since the web places it once on first paint before or after the counts arrive; the month's grabber) and
  `nativeEnv` (the new frame's launch hooks: `FOLEVI_REBUILD_MONTH=1`, `FOLEVI_REBUILD_TASK=<title>`). Run on a
  Simulator of its own: `--device "Folevi I4 iPhone 18 Pro"` (a clone, `xcrun simctl clone`).
