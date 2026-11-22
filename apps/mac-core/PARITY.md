# Folevi Core: parity checklist

Every item of today's Folevi Mac app inventory (`mac-feature-inventory.md`, 1,343 items with stable `AREA-nnn` ids, written 21 November 2026 from Folevi 1.5.63) checked against Folevi Core's code at commit `76a21004` on `claude/folevi-core-529dbe`: `apps/mac-core/FoleviCore/**`, `apps/mac-core/project.yml`, and the shared files Core compiles by path (the Mac host's App, Bridge, Updates and Services files and the iPhone/iPad shell services). Core is still moving fast; re-check an item before relying on it.

Statuses:

- `[x]` present in Core: the code really does it. The note says where (paths under `apps/mac-core/FoleviCore/` unless marked shared). Engine-backed features count when Core calls the right engine view or command and shows the result; "the page" means Folevi's web export running in Core's page views (the note editor, Reviews, Foli DNA, a few Settings panes), and what it draws there counts as present.
- `[~]` partly there: the note says what is missing.
- `[ ]` missing.
- `[n/a]` not applicable to Core, with the reason: iPhone/iPad only, Electron migration, today's Debug harness, today's code or docs, or replaced by a native macOS equivalent (named) by Core's design (native window tabs, NavigationSplitView with a native sidebar and an inspector, the web editor drawing its own in-note tools and panels, a SwiftUI Settings window, one engine page per place plus warm editor pages).

Each line keeps the inventory's id and name with a shortened description (today's file paths dropped), then `Core:` (what Core does) or `Why:` (for `[n/a]`).

## Since this grading (commits after `76a21004`)

Closed or improved after the grading below; the per-item marks haven't been redone yet:

- Bugs from work package 1: on a note, "Ask Foli AI About This Note" opens the page's Foli AI panel; the device
  limit gate sends `signOut:<device>`; a Vault one-time code's Copy copies the code; editing a Vault item shows its
  kind's fields; folder colours are Folevi's tokens and tag colours the web's six; the Delete Folder text says
  notes move to Drafts and subfolders move up; menu shortcuts no longer clash (⇧⌘H Home, ⌥⌘I inspector, ⌥⌘[ and
  ⌥⌘] outdent and indent, ⌘[ and ⌘] Back and Forward); destructive alerts default to Cancel.
- Note sharing: File > Share and the note's menu open Core's sharing sheet (people, invites, workspace access,
  public links). The note's menu also has Archive, ⌘⌫ Move to Trash and Foli DNA.
- Joined notes side by side in a tab (panes), Back to the opener tab, a model per window only when it appears.
- Vault: item history, Health, Activity and People sections.
- Changes: a "what changed" diff per note.
- Settings: local-mode Foli AI (on-device model, own keys), folder order in the sidebar, tag menus.
- Release: Developer ID export with iCloud (`iCloud.com.folevi`), its profile embedded and checked.
- Work package 3 (part): a folder picker sheet for Move To, Copy To (other spaces too) and Move Folder.
- Work package 4 (part): a selection bar for several notes (star, move, archive, trash; restore, delete).
- Work package 6 (part): Reopen Closed Tab (⇧⌘T), Show Tab 1 to 9 (⌘1 to ⌘9), an open note's tab comes forward.
- Work package 8 (part): Calendar Week and Agenda, drag a task onto a day with Undo.
- Work package 9 (part): Edit Task (done, date and time, repeat, reminder, priority, assignee, move to a note).
- The Vault, complete: set up, unlock, upgrade, change, reset and recovery; files, notes, passwords (generate,
  strength, one-time codes), sharing with people and one-time links, trash, settings, people and custodians.
- Quick Add: date, repeat, priority and page chips, the destination, Return / ⇧Return / ⌘Return, an in-panel
  confirmation, the first-use hint, and an offline queue that sends when the engine is back.
- Foli AI chat: edit the last question, share with the workspace, Copy as Markdown, delete with a confirmation, a
  conversation menu, loading and missing states, Jump to Latest, Thinking, code blocks with Copy, linked [n]
  citations, Stopped, Try Again, agent Continue, undo with a choice when notes changed, Buy More, context chips, a
  footnote, the history-off banner, and a floating Ask Foli AI panel (⌘J) on every screen but a note.
- Search: recent searches and recent notes before typing, Updated filter, Clear, Notes, By Meaning, Folders and
  Tasks sections, keys through results, an offline notice, `/search` routes. The palette: recent notes before
  typing, Folder, Tag and Updated filters, scope, archived and by meaning, sections, gated Foli AI and Foli DNA
  rows, Go to Changes, ⌘Return for a new tab.
- Settings: today's order, a workspace group, a Support group (Help, Contact Support, About), the last section
  remembered with a fallback, a Library pane (place, status, move, cloud, devices, health, passphrase, account),
  local Foli AI on/off, model and Keep conversations, Remove This Mac's Copy confirms, Use Default for Quick Add,
  menu bar Settings…, File > Import Notes….
- Sidebar: Foli AI gated, heading links, folder sort, open folders kept with ancestors opened, orphans at the top,
  five tags and "N More", ⌃⌘N New Folder.
- A missed `engine.ready` event no longer leaves a window on the starting screen (ready follows the client).
- Tabs: trashed notes leave every window's history, Open in Background Tab, ⌘T opens a tab at Search, New Folder
  on a folder's page goes inside it, restored windows from earlier builds no longer crash on launch.
- Home: Catch me up with Markdown, linked [n] marks, numbered sources, Refresh and a shimmer while it writes;
  Today's Reviews with Start Review; skeleton and empty texts; carousels with edge fades and hover arrows; every
  folder newest first in two rows with its path, menu and drops; Remove from Recent; the sidebar's Reviews count.
- Finishing round (21 November 2026): the Vault and Quick Add marks; notes lists, the Folders and Tags pages,
  folder and tag menus; tasks and a full calendar week (hour grid, timed blocks, half-hour drops), agenda and
  unscheduled tasks; sharing link settings and Leave; templates with Generate with Foli AI; changes; notifications
  with Today/Earlier and Mark as Read from macOS; a Help window with the shortcuts; a Catch Me Up page; Settings
  search, time zones, Foli AI memory, billing, sign-in methods, theme tiles; the menus (Share submenu, text
  menus, page zoom, Appearance); move between places; the first-launch and sign-in screens; links with #block
  and before launch; App Lock on screen lock with keys swallowed; the sidebar without a hide button (owner's
  rule) with Starred's first five and a Drafts count; the note inspector; a floating note pin.
- Left on purpose or for the owner: the owner chose native window tabs over the Mac UI guide's main-window
  profile (hidden title bar, custom top bar); Open at login starts off; ⌘T opens Search, not Home.
- Second finishing round (22 November 2026): demo mode shows data again; tabs kept per space; Markdown and text
  files opened or dropped become notes; a menu for empty space; middle-click for background tabs; notes and
  folders moved together; Add Tag for several notes; Foli DNA of a note (sent to the page, not yet seen on a
  library with links); folder drop zones, reorder and spring-loading (not yet tried with a real drag);
  optimistic list changes.
- Third finishing round (22 November 2026): notes dragged out as Markdown files (the page's noteFile), selection
  drags and sidebar drop zones; Foli DNA saved views; Spotlight stamps per place; notification actions (reply,
  snooze, done) with categories; windows, tabs and history back after a relaunch; image covers on cards; the
  25-colour folder grid; compact cards; the Dock badge counting places that aren't open; spelling from the word's
  paragraph with 8 guesses, Learn and Ignore clearing WebKit's underline; account rows with plan badges and
  reminder marks; inline diffs on Changes; a Folders tree; File > Share for pages off a note; keys typed right
  after ⌘K go to the palette; links caught before launch; the engine's launch snapshot (sidebar, Home and counts
  drawn at once, nothing kept for encrypted spaces); card previews with the page's own line breaks.
- Design pass (22 November 2026, against docs/MAC_NATIVE_LOOK.md inside the system frame): Folevi's web icons in
  labels, menus and toolbars (CoreIcon); a hover on plain controls that never touches its words; no small controls;
  no lines between list rows; cards 25% smaller (188 pt notes, 180 pt folders, 16 pt gaps); Home's sections 8 pt
  closer. Sidebar picks now navigate (they only highlighted before) and start fresh with no way back, as the
  owner's Back rule says.
- Last native items (22 November 2026): the card grid takes arrow keys, Return and Space, ⌘A selects every card
  or folder and Esc clears; one dispatcher for every intent today's screens send (tasks, calendar, a note at a
  block, a route, a Settings section, Help, a place or workspace, New Workspace, another account, move or copy,
  sign out, a file to download); Home and notes lists pause their views a minute after their window or tab goes
  off screen; a note card's press and a list row's selection prepare the note before the click ends (in a page
  the window already holds); Settings > Plan & Billing lists the payments (billing.mine); the system's large
  control size in the main window and Settings.

The items closed in this session's later work packages are marked [x] with "closed after the grading", and the
summary table below is recounted from the marks (1108 there, 15 partly, 0 missing, 220 not applicable).

## Summary

| Area | Id prefix | [x] | [~] | [ ] | [n/a] | Items |
|---|---|---|---|---|---|---|
| Architecture today | `ARCH` | 16 | 0 | 0 | 1 | 17 |
| App & windows | `APP` | 50 | 0 | 0 | 23 | 73 |
| Sign-in, onboarding, accounts, spaces & local mode | `AUTH` | 67 | 2 | 0 | 11 | 80 |
| Sidebar & navigation | `NAV` | 30 | 0 | 0 | 7 | 37 |
| Tabs | `TAB` | 14 | 1 | 0 | 28 | 43 |
| Home | `HOME` | 20 | 0 | 0 | 10 | 30 |
| Notes lists | `LIST` | 60 | 1 | 0 | 11 | 72 |
| Folders | `FOLD` | 34 | 0 | 0 | 3 | 37 |
| Tags | `TAG` | 7 | 0 | 0 | 2 | 9 |
| Note page & editor integration | `NOTE` | 42 | 1 | 0 | 3 | 46 |
| Search & command palette | `SRCH` | 35 | 0 | 0 | 2 | 37 |
| Tasks | `TASK` | 25 | 0 | 0 | 10 | 35 |
| Calendar | `CAL` | 31 | 0 | 0 | 6 | 37 |
| Foli AI | `AI` | 44 | 0 | 0 | 5 | 49 |
| Foli DNA | `DNA` | 36 | 0 | 0 | 0 | 36 |
| Vault | `VAULT` | 40 | 0 | 0 | 1 | 41 |
| Sharing, public links & invites | `SHARE` | 21 | 0 | 0 | 1 | 22 |
| Templates | `TPL` | 12 | 0 | 0 | 0 | 12 |
| Changes & proposals | `CHG` | 11 | 0 | 0 | 2 | 13 |
| Drafts | `DRAFT` | 5 | 0 | 0 | 0 | 5 |
| Archive | `ARCV` | 6 | 0 | 0 | 0 | 6 |
| Trash | `TRASH` | 12 | 0 | 0 | 0 | 12 |
| Notifications / Inbox, Help & support | `NOTIF` | 16 | 0 | 0 | 2 | 18 |
| Settings | `SET` | 144 | 2 | 0 | 19 | 165 |
| Quick Add | `QADD` | 14 | 0 | 0 | 2 | 16 |
| System integrations | `SYS` | 55 | 1 | 0 | 4 | 60 |
| Context menus | `CTX` | 11 | 0 | 0 | 6 | 17 |
| Menus & keyboard shortcuts | `MENU` | 80 | 0 | 0 | 2 | 82 |
| Updates (Sparkle) | `UPD` | 6 | 1 | 0 | 0 | 7 |
| Offline, sync & device storage | `SYNC` | 14 | 0 | 0 | 0 | 14 |
| Migration | `MIG` | 0 | 0 | 0 | 11 | 11 |
| Bridge messages & capabilities | `BRIDGE` | 72 | 1 | 0 | 7 | 80 |
| Debug & eval harness | `DBG` | 0 | 0 | 0 | 8 | 8 |
| Capabilities | `CAP` | 20 | 0 | 0 | 0 | 20 |
| Stays web, WebPage values and the parity list | `WEB` | 2 | 0 | 0 | 2 | 4 |
| Binding UX rules from owner memory | `RULE` | 30 | 1 | 0 | 13 | 44 |
| iPhone and iPad only (skip) | `IOS` | 0 | 0 | 0 | 5 | 5 |
| Gaps, bugs and contradictions | `GAP` | 26 | 4 | 0 | 13 | 43 |
| **Total** | | **1108** | **15** | **0** | **220** | **1343** |

Notable findings (all in the first work package at the end):

- On a note the inspector always shows Note Info (`Views/Note/Inspector.swift`), so Note > Ask Foli AI About This Note never shows the chat.
- `NoteSharingSheet` (`Views/Sharing/SharingViews.swift`) is never opened: nothing sets `window.sharingNote`; File > Share only sends `note.menu share` to the page.
- The device-limit gate's Sign Out sends action `revoke` with a device value; today's action id is `signOut:<id>`.
- Vault: the one-time code's Copy button copies the secret, and editing an existing item shows no fields (its kind is built with an empty field list).
- Tag colours offered are the folder colour ids, not the six tag colours; Delete Folder's warning says notes go to Trash and subfolders are deleted (today: Drafts, and up a level).
- Shortcut clashes: ⇧⌘H (Highlight and Go > Home), ⌥⌘0 (Body and Show Inspector), ⌘[ and ⌘] (Outdent, Indent and Go > Back, Forward).
- Destructive alerts make the destructive button the default (Return); a page shown in a pool editor page (Reviews, Foli DNA) has no one listening to its `navigate.request`, so opening a note from it works only when the engine page hosts it.

## Architecture today

- [x] `ARCH-001` **AppKit host plus WKWebView, no Electron**: The native AppKit app (Swift 6, not sandboxed, Developer ID) shows the web app's static "shell" export inside WKWebView at… Core: SwiftUI app hosting the same export in WKWebView, shared services by path (`project.yml`, `Host/PageView.swift`).
- [x] `ARCH-002` **app:// scheme handler (AppScheme)**: `WKURLSchemeHandler` for `app://folevi`. Core: shared AppScheme, installed by `Host/PageView.swift` (WebViewFactory.scheme).
- [x] `ARCH-003` **/_files/<sha256> route**: Library attachments through the pluggable `LibraryFiles` reader. Supports Range and 206, a safe-MIME allowlist, a sandboxing CSP… Core: shared AppScheme serves it unchanged.
- [x] `ARCH-004` **/_bridge/<id> route (BridgeBodies)**: Carries bridge calls and replies bigger than 256 KB: POST the body, then name `bodyId` in the message. A reply is kept for one… Core: `Engine/Pages.swift` (CoreEngineTransport reads BigBatchPointer).
- [x] `ARCH-005` **/_folevi-offline page**: Shown when a load fails: inline HTML with "Try again", which retries on the `online` event. Core: `Host/PageView.swift` (Navigation.failed loads the offline page).
- [x] `ARCH-006` **WebViewFactory: every web view is made here**. Core: `Host/PageView.swift` (WebViewFactory.make).
- [x] `ARCH-007` **ViewRole and FoleviWebView**: Roles are `main`, `runner` and `quickAdd`. Each view carries `place` (set by the host only), `loaded` and `nativeFrame`.… Core: `Host/PageView.swift` (FoleviWebView, ViewRole, acceptsFirstMouse).
- [x] `ARCH-008` **Bridge script injection (mac-bridge.js)**: Injected at document start, main frame only. The template inlines, the shared, the extra scripts (`chrome-page`, `capabilities`… Core: `Host/PageView.swift` (bridgeScript; extras are capabilities.js only, no chrome-page or memory-probe).
- [x] `ARCH-009` **Bootstrap JSON**: `{ version, build, debug, desktop: [features], shell: { mode, deviceName, places: { current, background }, start } }`. Core: `Host/PageView.swift` (Bootstrap).
- [x] `ARCH-010` **Native frame (N8; the default on this branch)**: Each main window's web view is a "Page View": a marker script turns on native chrome mode. The page runs the engine and draws… Core: `Host/PageView.swift` (NativeChromeMarker on engine and editor pages); Core draws all chrome.
- [x] `ARCH-011` **Engine transport (MacEngineTransport over WebViewTransport)**. Core: `Engine/Pages.swift` (CoreEngineTransport over WebViewTransport).
- [x] `ARCH-012` **Engine envelope**: `OutgoingMessage { v: 1, id, kind: hello|watch|unwatch|window|query|command|editor, app, sub, place, name, args, window }`.… Core: FoleviEngine package (same contract).
- [x] `ARCH-013` **EngineClient**: One per Page View, so one per window per place. Request and response with ids and a 10 s timeout. `watch` gives a ValueStore and… Core: `Engine/Pages.swift` (one EngineClient per engine or editor page).
- [n/a] `ARCH-014` **EngineRouter**: Maps place to client. `command(_, in: place)` fails with place_mismatch when no Page View hosts that place. Why: replaced by PagePool: one engine client for the open place (`Engine/Pages.swift`).
- [x] `ARCH-015` **LaunchSnapshotStore**: A render cache of on-screen view-model values (Places/<place>/launch.json), written at most every 2 s. Optional seal and open for… Core: closed after the grading (see "Since this grading").
- [x] `ARCH-016` **Engine views, commands and events (contract)**. Core: FoleviEngine generated contract.
- [x] `ARCH-017` **Paths (build identity)**: The only place that knows the build. Core: `Host/CorePaths.swift` (own bundle id, folders, Keychain names, scheme).

## App & windows

### App window & frame

- [x] `APP-001` **Frame root and gates**: while the engine is not up, the whole window shows the gate (sign in, onboarding, lock, placeMove). It is drawn natively… Core: `Views/Gate/GateScreen.swift` over the window (`Views/MainWindow.swift`), gate.act.
- [n/a] `APP-002` **Web gates fallback switch**: `FOLEVI_WEB_GATES=1` shows every gate as the page's own screen. Why: debug switch; Core draws every gate natively from the gate data.
- [x] `APP-003` **Frame layout (FrameSplitViewController)**: one translucent surface with the title bar strip on top, the sidebar at the leading edge and the content card beside it… Core: `Views/MainWindow.swift` (NavigationSplitView plus inspector; Focus Mode hides the sidebar).
- [n/a] `APP-004` **Page panel takes the inspector column**: while the note page has a panel open (Style, Format, Insert, Foli AI), the page draws it in the right column. Why: the page draws its panels inside the note view (design); `editor.panel` is tracked only.
- [n/a] `APP-005` **Window drag strip**: empty strip space moves the window, and a double-click follows System Settings (Zoom/Minimize/None). Why: native title bar and unified toolbar.
- [n/a] `APP-006` **Content card surface**: controlBackgroundColor, 12 pt continuous corners, quiet shadow. Off on a note (the page draws its own card). Why: native split view, no content card.
- [n/a] `APP-007` **Scroll edge effect**: under the card's floating glass controls (blur fade, no hard line). Why: native toolbar scroll edge effect on macOS 26.
- [n/a] `APP-008` **Other-theme screens (Vault)**: the card chrome (fill, edge effect, controls, Ask AI, toasts) takes the inverted theme over the Vault. Why: no card chrome to invert; the Vault is a native screen.
- [n/a] `APP-009` **One Page View per window**: the WKWebView runs both the engine and the note page and never leaves the window. A native screen covers it. Why: replaced by one engine page per place plus warm editor pages (`Engine/Pages.swift`).
- [n/a] `APP-010` **Note top inset**: the bar height divided by the page zoom is sent so the note title clears the bar. Why: the page sits below the native toolbar (safe area), no inset to send.
- [x] `APP-011` **Keep note mounted**: the note stays in the Page View 30 s after a native screen comes in front, then `note.close`. Core: closed after the grading (see "Since this grading").
- [x] `APP-012` **Show note on route change**: `note.show` gets the id, joined panes, sizes and other open note tabs (for the Join picker), then `note.meta` is queried. Core: `Model/WindowModel.swift` enterNote: note.show with panes, sizes and the other open notes, then note.meta.
- [x] `APP-013` **Drawn-note handoff**: the previous content stays on screen until `note.ready` (never a blank page). Core: `Views/Note/NoteScreen.swift` (NotePlaceholder until note.ready).
- [x] `APP-014` **Accessibility**: the page is hidden from VoiceOver while a native screen covers it. Core: the page leaves the view tree when no note is shown (`Views/Note/NoteScreen.swift` PageHostView).
- [x] `APP-015` **Reload screen**: re-reads the native screen's data (context menu Reload). Core: closed after the grading (see "Since this grading").
- [x] `APP-016` **View As Cards / As List**: for the list on screen. Core: `App/AppCommands.swift` View > as List / as Cards (⌘1, ⌘2).
- [x] `APP-017` **Toasts**: bottom centre of the window. At most 3; dismissed after 4 s (7 s with an action). Undo runs the inverse command; an engine toast… Core: `Model/AppModel.swift` toasts (3, 4 s / 7 s, Undo, toast.action) and `Views/MainWindow.swift` ToastStack.
- [x] `APP-018` **Generic action runner**: an engine refusal becomes an error toast; unknown command/view gives "That isn't available in this version yet.". Core: `Model/AppModel.swift` perform.
- [x] `APP-019` **Ask Foli AI floating chat**: over everything except a note. ⌘J on a note toggles the note's AI panel; on the AI page it focuses that page's box. Core: closed after the grading (see "Since this grading").
- [x] `APP-020` **First click acts on an inactive window**: (ClickThroughHostingView, MAC-05). Core: `Host/PageView.swift` acceptsFirstMouse.
- [n/a] `APP-021` **Card controls (glass at the card top)**: screen title, the screen's controls, a search capsule that opens into a field (⌘K, Esc closes while empty, typing opens the… Why: native toolbar items and `.searchable`; ⌘K palette (`Views/Common/CommandPalette.swift`).
- [n/a] `APP-022` **Card item groups**: segmented, pull-down (Sort with "Sort by" heading), action button, "…" more, clusters. They fold to pull-downs, then into one "…"… Why: native toolbar overflow.
- [x] `APP-023` **Main window basics**: 1280x820 start, 800x480 minimum. The frame is built on the page with a marker script before first paint; rebuilt on a place or… Core: closed after the grading (see "Since this grading").
- [x] `APP-024` **Window restore**: windows.json keeps frame, path and the native frame's TabsModel.Saved (including other spaces). Front-to-back order kept.… Core: closed after the grading (see "Since this grading").
- [n/a] `APP-025` **iPad tab restore (DeskTabs)**: (iPad): UserDefaults `folevi.desk.tabs`, debounced 600 ms. Why: iPad only.
- [x] `APP-026` **Title bar (native frame)**: traffic lights centred on the strip at `MacLook.trafficLightsX`. Window title = note title (without "· Folevi"). Full-screen, key… Core: native title bar; title is the note's title (`Model/WindowModel.swift`).
- [x] `APP-027` **Multiple windows**: new window, Open in New Window (folder, destination, note), bring to front. Core: New Window, Open in New Window, Open Note in New Window (`App/AppCommands.swift`, `Views/Common/Menus.swift`).
- [x] `APP-028` **Navigation policy**: Folevi links open in the app; http/https/mailto go to the browser; window.open to Folevi paths opens a new window; mic only… Core: `Host/PageView.swift` Navigation (window.open to Folevi paths opens in the front window, not a new one).
- [x] `APP-029` **App commands into the frame**: navigate, new-note, menu id, notification actions (reply, read, done, snooze), new-note-with-text (Services/Shortcuts), add-task. Core: closed after the grading (see "Since this grading").
- [x] `APP-030` **⌘K early keys**: a local monitor opens search before the web view eats the keys (QA F04). Core: `App/FoleviCoreApp.swift` a local key monitor opens the palette before the page sees ⌘K.
- [x] `APP-031` **Live engine views at launch**: session, home, folders.tree, sync.status, places.list, all with snapshot keys. Core: `Model/AppModel.swift` rebind (session, sync, folders.tree, places, counts); no snapshot keys.
- [x] `APP-032` **Native text line layout for card previews**. Core: closed after the grading (see "Since this grading").
- [x] `APP-033` **Cover image loader for note cards**. Core: closed after the grading (see "Since this grading").
- [x] `APP-034` **Settings opens apart**: its own window on the Mac, a sheet on the wide iPad. A /settings link opens it at its section. Core: SwiftUI Settings scene and `Views/Settings/SettingsView.swift` SettingsRouter (/settings links).
- [x] `APP-035` **Search routes to the command palette**: on the Mac (folevi://search, /search?q=). Core: closed after the grading (see "Since this grading").
- [x] `APP-036` **Sync popover**: headline, detail, waiting count, download progress, Retry. Core: `Views/Sidebar.swift` SyncDetails popover (headline, waiting, conflicts, per-space progress, Sync Now, Sign In Again).
- [n/a] `APP-037` **Notifications popover (bell)**: list, mark read, mark all read, open. Why: replaced by the Notifications screen (`Views/Screens/PeopleScreens.swift`) and its sidebar badge.
- [x] `APP-038` **Floating notes window (Float Note)**: one NSPanel per note with its own Page View and EngineClient. Keep-on-top pin (floating level, all Spaces); cascade placement… Core: closed after the grading (see "Since this grading").
- [x] `APP-039` **Floating note bar**: room for window buttons, emoji and title, pin "Keep on top" / "Stop keeping on top"; dragging the bar moves the window… Core: closed after the grading (see "Since this grading").
- [x] `APP-040` **Page text menu services**: spelling guesses by context, Learn and Ignore Spelling (clears WebKit underline), Look Up. Core: `Host/DesktopRouter.swift` spelling, learnWord, ignoreWord, lookUp.
- [n/a] `APP-041` **Quiet scroll**: no pointer hit-testing while a list scrolls (performance). Why: native SwiftUI List scrolling.
- [n/a] `APP-042` **List hover tints**: for small controls (segments, Sort, chips, carousel arrows, "…" chips). Why: native control hovers.
- [n/a] `APP-043` **Sheets and popovers infrastructure (FrameSheets)**: a dialog is a sheet on the window, a panel is an NSPopover from its control. Esc or ⌘. closes, Return presses the default, the… Why: SwiftUI sheets, popovers and NSAlert.
- [n/a] `APP-044` **Dialog pieces**: WebSheetDialog (384 pt, md 480 pt), WebSheetFooter, WebSheetButton (Return = primary, Esc = cancel, destructive never Return). Why: SwiftUI forms and sheets.
- [n/a] `APP-045` **Platform shims**: (iPad): AppKit names on UIKit, so the shared views build for iOS. Why: iPad only.
- [n/a] `APP-046` **HardwareKeyboard**: (iPad): key hints and auto-focus only with a hardware keyboard. Why: iPad only.
- [x] `APP-047` **Native More routes**: /help, /graph, /review, /shared/<id>, /shared, /changes drawn natively; unknown paths show an empty state with a way back (MAC-65). Core: closed after the grading (see "Since this grading").
- [n/a] `APP-048` **iPad wide layout (IPadFrame)**: (iPad): same views as the Mac (strip, sidebar, card). Account in the strip corner; floating sidebar when narrow (`sidebarFloats`… Why: iPad only.
- [x] `APP-049` **Main menu**. Core: `App/AppCommands.swift`.
- [x] `APP-050` **Format keys gating**: a format key runs only while the note's text has the keyboard; ⌘⌫ only when nothing is being edited. Core: closed after the grading (see "Since this grading").
- [x] `APP-051` **View-level keys**. Core: closed after the grading (see "Since this grading").

### App lifecycle & windows (launch, restore, multiple windows, dock menu, status item, reopen)

- [x] `APP-052` **main()**: Overlay scrollers (FOLEVI_SYSTEM_SCROLLERS in Debug). Registers `WebContinuousSpellCheckingEnabled=true` before any web view… Core: closed after the grading (see "Since this grading").
- [x] `APP-053` **applicationWillFinishLaunching**: Web text rendering and fonts. Installs the `kAEGetURL` Apple Event handler, which also catches links that arrive before launch… Core: closed after the grading (see "Since this grading").
- [x] `APP-054` **applicationDidFinishLaunching order**. Core: `Host/HostServices.swift` AppDelegate (Offline, Places, rules, launch steps).
- [x] `APP-055` **beforeFirstWindow hooks**: Run in this order. Core: `Host/HostServices.swift` runs AppDelegate.beforeFirstWindow (Places registers them).
- [x] `APP-056` **whenLaunched queue**: Spotlight results and Shortcuts that open the app wait until places, migration and lock are done. Core: closed after the grading (see "Since this grading").
- [x] `APP-057` **Reopen (Dock click)**: Shows a main window when none is visible. Core: `Host/HostServices.swift` applicationShouldHandleReopen.
- [x] `APP-058` **Never quits on last window**: `applicationShouldTerminateAfterLastWindowClosed` returns false. Core: SwiftUI default (the app stays open with no window).
- [x] `APP-059` **Quit flush**: Each loaded page gets `pagehide` plus a 250 ms wait (`PageClosing.script`). The app replies `.terminateLater` with a 2 s cap… Core: `Host/HostServices.swift` applicationShouldTerminate with PageClosing.flush.
- [x] `APP-060` **PageClosing.flush**: When a window closes or a place switches, the old view gets `pagehide` and is kept up to 1 s, then loads about:blank. Core: `Host/PageView.swift` PageClosing.
- [x] `APP-061` **About panel**: Shows the version only, not the build number. Core: closed after the grading (see "Since this grading").
- [n/a] `APP-062` **StarterMenu**: The fallback menu until MainMenu is set. Why: SwiftUI builds the menu bar.
- [x] `APP-063` **WindowManager**: Holds the main window controllers and a weak set of every view. Provides `frontMain`, `openMain(path:tabs:)`, `showMain(path:)`… Core: `Host/WindowManager.swift`.
- [n/a] `APP-064` **MainWindowController**. Why: SwiftUI WindowGroup and WindowModel.
- [x] `APP-065` **Navigation policy**. Core: `Host/PageView.swift` Navigation.
- [x] `APP-066` **Window restore**: in the support folder `{ v: 1, windows: [{ frame, path, hidden?, tabs? }] }`. Saved front to back (debounced 0.6 s) on move… Core: closed after the grading (see "Since this grading").
- [n/a] `APP-067` **Last window hides instead of closing**: Keeps syncing and Quick Add working. Why: the engine page lives apart from windows, so sync and Quick Add go on with none open.
- [x] `APP-068` **Dock menu**: New Note (menu `file.new-note`), Quick Add Task, New Window (`/documents`), up to 5 recent notes, and a Places submenu with a… Core: closed after the grading (see "Since this grading").
- [x] `APP-069` **Dock badge**: Sum of each place's `setBadge` count plus the last-known unread of account places that report nothing; shows "99+". Core: closed after the grading (see "Since this grading").
- [x] `APP-070` **Status item (menu bar icon)**: Template "F" image, rebuilt each time the menu opens. Core: `App/FoleviCoreApp.swift` StatusItem (Quick Add, New Note, Recent, Open, Quit; SF Symbol, not the "F" template).
- [n/a] `APP-071` **Chrome per-view state**: `PageState`: disabled and checked ids, ai, sidebar, inspector, focus, find, locked, route. Also badges, recent notes and status.… Why: replaced by per-window WindowModel editor state (`Model/WindowModel.swift`).
- [x] `APP-072` **Floating notes ("Float Note")**: See the Services section. Restored at launch with the native frame. Core: closed after the grading (see "Since this grading").
- [x] `APP-073` **Settings window**: Separate window (`SettingsWindow.show(section:)`), native with the frame or `/settings/<section>?window=1`. Referenced only. Core: SwiftUI Settings window (`Views/Settings/SettingsView.swift`).

## Sign-in, onboarding, accounts, spaces & local mode

### Sign-in, onboarding, accounts, places, local mode

- [x] `AUTH-001` **Places model**: One library ("library") plus any number of accounts (`acct:<userId>`. Core: shared Places.swift.
- [x] `AUTH-002` **Places.start at launch**: Wires library changes, cloudWant and cloudStatus events to library pages; opens LibraryService; migrates places; sets `modeOf`… Core: shared Places.swift, installed in `Host/HostServices.swift`.
- [x] `AUTH-003` **configureServices**: `ShellAuth.service = Paths.serviceURLMAC/App/Places.swift:102`. Core: shared Places.swift.
- [x] `AUTH-004` **startPlaces (first-run and legacy)**: Builds places from `ShellMode.current` ("unset", "local" or "account"). Account mode with no open account opens the first account… Core: shared Places.swift.
- [x] `AUTH-005` **First-launch choice ("unset" mode)**: The window is bound to no place (`switchTo(nil)`); Quick Add redirects to the main window until a mode is picked. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-006` **setMode**: "local" turns on the library and switches to it. "account" goes to lastAdded, else the first account, else the pending sign-in… Core: shared ShellRouter.
- [x] `AUTH-007` **switchTo / applySwitch**: Sets current, rebuilds every main window in the new place at a path (default `/documents`), ensures runners, posts… Core: shared Places plus `Model/AppModel.swift` placeSwitched and `Engine/Pages.swift` rebuild.
- [x] `AUTH-008` **Sign-in (PKCE sheet)**: `ShellAuth.signInAccount(window:provider:)` (shared iOS service) and then `addAccount`. Entry points: bridge `placesSignIn` and… Core: shared ShellAuth and DesktopRouter+SignIn; `Views/Common/Menus.swift` AccountActions.
- [x] `AUTH-009` **signInInBrowser (Google/Apple)**: Only the website's `/app-google` may start it. Runs ASWebAuthenticationSession with callback scheme `folevi`, non-ephemeral, and… Core: shared DesktopRouter+SignIn.
- [x] `AUTH-010` **Sign out of one account**: Ends the session (`ShellAuth.signOut(userId:)`), forgets its E2EE keys, closes its runner, removes its notes from Spotlight and… Core: shared Places.signOut from PlaceMenu "Sign Out of This Account…" and Settings.
- [x] `AUTH-011` **Forget library**: `LibraryService.forget` (the folder stays), `ShellNotify.cancelAll`, closes the runner, forgets Spotlight, switches to the first… Core: `Views/Common/Menus.swift` PlaceMenu "Stop Keeping a Library on This Mac…" (Places.forgetLibrary).
- [x] `AUTH-012` **Place binding by host**: Every ShellRouter call runs under `ShellPlaces.$acting` set to the sender view's place, never one the page passes. Exception… Core: shared ShellRouter.
- [x] `AUTH-013` **places list and describe**: `placesList` returns `ShellPlaces.list` plus the library's reminders and waiting counts (stored in defaults… Core: shared ShellRouter.
- [x] `AUTH-014` **Quick Add place**: The last picked place, else the current one. Bridge: `placesQuickAdd`, `placesSetQuickAdd`. Posts `Places.quickAddChanged`. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-015` **Local mode network isolation**: A per-view WKContentRuleList "folevi-library" blocks folevi.com, *.folevi.com, *.convex.cloud, *.convex.site and the service host… Core: shared Places rules through WebViewFactory.rulesFor.
- [x] `AUTH-016` **Local mode scheduling**: Runners and library windows get `inactiveSchedulingPolicy =.none`, with hidden-page timer throttling and process suppression… Core: `Host/PageView.swift` keepAwake plus Places' configure hooks.
- [x] `AUTH-017` **Library setup and move**: Kinds: icloud, folder, device. "folder" uses FolderPicker (FOLEVI_TEST_FOLDER in Debug). Bridge: `libSetup`, `libMove`… Core: shared bridge; `Views/Settings/SettingsView.swift` LibrarySection (Move Library To).
- [x] `AUTH-018` **Library location**: Release: `~/Documents/<device folder>`. Debug and test runs: supportFolder/Documents. Core: `Host/CorePaths.swift` documentsFolder ("Folevi Core").
- [x] `AUTH-019` **Dropbox and Google Drive sync (local mode)**: The provider code runs in the bridge JS (folevi-cloud.js). Native handles OAuth, tokens and HTTP: `cloudStatus`, `cloudConnect`… Core: shared ShellCloud and folevi-cloud.js.
- [x] `AUTH-020` **Reminders and subscribed calendars only in local mode**: `notifySchedule` and `notifyCancel` go through ShellNotify (system UNUserNotification, fires with the app quit). `httpCalendar`… Core: shared ShellRouter.
- [x] `AUTH-021` **Foli AI on device or own keys**: `aiCapabilities`, `aiGenerate` (streams `aiChunk` events), `aiCancel`, `aiTestKey`. Keys go through… Core: shared ShellAI and FakeAI.
- [~] `AUTH-022` **E2EE device keys per account**: `e2eeDeviceKeys`, `e2eeOpen`, `e2eeSign`, `e2eeReset`, `e2eeSettings`, `e2eeSetTouchId`. The native frame's Vault offers Touch ID… Core: shared bridge; Core's Vault has no Touch ID unlock.
- [x] `AUTH-023` **Move or copy notes between places**: `frameMoveOrCopy` presents `PlaceMove` (engine `places.move.preview` and `places.move`). Core: closed after the grading (see "Since this grading").
- [n/a] `AUTH-024` **Owner decisions (docs)**. Why: reference notes, not a feature.
- [n/a] `AUTH-025` **Rebuild direction (memory)**: Native everywhere except the editor; web data engine over the bridge; pixel match with the web; account-free local mode… Why: reference notes, not a feature.

### Sign-in, onboarding & gates

- [x] `AUTH-026` **Mac gate host**: `WebGateScreen` over the frame (`GateModel`, device `.mac`); the page's own screen stays mounted behind it; every button is… Core: `Views/Gate/GateScreen.swift` (gate.changed, gate.act).
- [x] `AUTH-027` **Gate kinds**: loading, modeChoice, signedOut, emailUnverified, suspended, setupFailed, offline, error, deviceLimit, onboarding, librarySetup… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-028` **Fallback titles and messages**: native words for each kind; update-required text differs per device; offline and email-unverified have fallback text. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-029` **Loading**: page background only. Core: `Views/MainWindow.swift` StartingScreen.
- [x] `AUTH-030` **Mode choice**: "Where should your notes live?"; account ("Sync and share your notes.", Folevi mark, emphasis) and local ("Free forever. No… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-031` **Signed out (Mac)**: card with Continue with Apple (Apple's black button), Continue with Google, Sign in with email, Keep notes on my devices; while… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-032` **Generic message card**: title, text, busy bar, progress bar, fields (secret or text), button row (primary, secondary, quiet, danger), "Use passphrase… Core: `Views/Gate/GateScreen.swift` (fields, progress, styled actions, error).
- [x] `AUTH-033` **Busy rules**: only stop, cancel, cancelApproval and back can be pressed while busy; a button waits for its own field. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-034` **Wrong secret**: clears the secret and recovery fields; the engine's error replaces the press's. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-035` **Email unverified**: "Check your inbox" with an envelope icon; "…expires in 24 hours and works once.". Core: closed after the grading (see "Since this grading").
- [x] `AUTH-036` **Suspended, setup failed, error**: icon plus the engine's words. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-037` **Offline**: "You're offline / Folevi needs a connection the first time it opens…". Core: closed after the grading (see "Since this grading").
- [x] `AUTH-038` **Update required**: Mac text "…Choose Check for Updates in the Folevi menu…". Core: closed after the grading (see "Since this grading").
- [x] `AUTH-039` **Device limit**: device rows with "Last seen …" and a Sign out button (`signOut:<id>`). Core: closed after the grading (see "Since this grading").
- [x] `AUTH-040` **Library setup places**: iCloud, Dropbox, Google Drive, a folder, this Mac only, each with a Mac detail line; Back. Core: closed after the grading (see "Since this grading").
- [~] `AUTH-041` **Library ready**: "Folevi keeps your notes as files in <path>"; "Encrypt with a passphrase" switch; passphrase and confirm fields; warning; "I… Core: the library-ready step shows the engine's fields and actions; the encrypt switch and checks are the engine's, drawn generically.
- [x] `AUTH-042` **Library locked**: "Enter your library's passphrase", the passphrase field, Unlock, "Forgot the passphrase?" with help text. Core: generic fields and actions.
- [x] `AUTH-043` **Migration and place move**: progress label with "N of M"; iOS migration summary (notes, folders, tags, files and their size, existing notes, "There isn't… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-044` **E2EE unlock**: choose passphrase or recovery key (one field at a time; "Use recovery key" / "Use passphrase instead"); the recovery key is… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-045` **E2EE approval (iOS block)**: approve from another device: waiting spinner, compare-code display, failed notice; space name chip. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-046` **E2EE setup**: methods added (Recovery key, Passphrase, Passkey, Another device); recovery key shown once; confirm groups 3 and 7… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-047` **E2EE waiting and trust**: "Waiting for your encryption key" and "Trust this device?". Core: generic card.
- [x] `AUTH-048` **Onboarding**: the Mac shows the generic card; iOS has the 6-step block (Welcome, Your pages, Note theme, Appearance, Foli AI, Ready), progress… Core: `Views/Gate/GateScreen.swift` OnboardingStep (use cases, note style, appearance, Foli AI).
- [x] `AUTH-049` **Unknown gate kind**: falls back to the generic card. Core: generic card.
- [x] `AUTH-050` **Choose place**: not a gate; the account and place switcher (`switchPlace` intent; Home's `.places` route toasts toward the sidebar). Core: `Views/Common/Menus.swift` PlaceMenu.
- [x] `AUTH-051` **Create workspace**: the `newWorkspace` intent opens a Folevi dialog. Core: `Views/Common/MoreSheets.swift` NewWorkspaceSheet from the place menu.
- [x] `AUTH-052` **Sign in another account and sign out**: intents. Core: PlaceMenu Add Account; Settings Sign Out.
- [n/a] `AUTH-053` **iOS only: SignInFlow steps**: choose, email, two-factor, forgot, forgot sent, sign up, check inbox, waiting; Back (Esc on Mac). Why: iPhone/iPad only.
- [n/a] `AUTH-054` **iOS only: email sign-in**: email and password, "Forgot your password?", Sign in, "Sign in with a passkey" (web sign-in), "New to Folevi? Create an account"… Why: iPhone/iPad only.
- [n/a] `AUTH-055` **iOS only: two-step**: 6-digit TOTP or backup code, "Trust this device for 30 days", Verify, toggle to a backup code, Start over. Why: iPhone/iPad only.
- [n/a] `AUTH-056` **iOS only: sign up**: name, email, password (10 characters or more), Create account, Terms and Privacy links, field errors. Why: iPhone/iPad only.
- [n/a] `AUTH-057` **iOS only: forgot password and check inbox**: Send reset link ("If an account exists…"); Send a new link; "Already confirmed? Sign in". Why: iPhone/iPad only.
- [n/a] `AUTH-058` **AuthService protocol**: providers (Apple, Google), native Apple, `signIn(provider:)`, `signInOnWeb`, email sign-in, `verifyTwoFactor`, `signUp`… Why: iPhone/iPad sign-in flow; the Mac signs in through ShellAuth.

### Places / spaces / move between places

- [x] `AUTH-059` **Account menu rows**: "Places" heading; the open account (Personal) with its workspaces (plan badge, check); New workspace…; other accounts (unread… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-060` **Switch space**: inside the place. Core: PlaceMenu (space.switch).
- [x] `AUTH-061` **Switch place**: every main window reloads in the new place at /documents. Core: PlaceMenu (Places.switchTo); windows start over at Home.
- [x] `AUTH-062` **New workspace**: prompt ("Workspace name", "Create workspace"). Core: NewWorkspaceSheet (workspace.create, then space.switch).
- [x] `AUTH-063` **Sign in to another account**: (ShellAuth, then add the place and switch). Core: PlaceMenu Add Account.
- [x] `AUTH-064` **Sign out of <name>**: with an unsynced-changes warning ("Sign Out Anyway", critical style). Core: closed after the grading (see "Since this grading").
- [x] `AUTH-065` **Move or copy notes… sheet**: destination place/space picker, Move/Copy segmented, preview (what goes, fits storage), Cancel/Move; "switched" or "done" toasts. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-066` **Move to another place…**: from a folder menu (otherPlaces). Core: closed after the grading (see "Since this grading").
- [n/a] `AUTH-067` **Places model**: (iPhone/iPad): roles, plans (Free, Core, Pro, Pro AI, Team, Business), sign-out wording. Why: iPhone/iPad only.
- [n/a] `AUTH-068` **Places menu content**: (iPhone sheet / iPad popover). Why: iPhone/iPad only.
- [n/a] `AUTH-069` **Move places model**: (iPhone): what/where/how labels, version history option. Why: iPhone only.
- [x] `AUTH-070` **Per-space tabs swap**: (see Tabs). Core: closed after the grading (see "Since this grading").
- [x] `AUTH-071` **Place runners**: (background sync web views per non-open place). Core: shared Places runners.
- [x] `AUTH-072` **Library lifecycle**: (set up, moved, forgotten; forget library). Core: shared lifecycle; set up and move in Settings, forget in the place menu.
- [x] `AUTH-073` **Quick Add place**. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-074` **Mode switch**: (local vs account). Core: shared setMode, chosen at the gate.
- [x] `AUTH-075` **Space and account names**: for the UI (spaceName, accountName). Core: `Model/AppModel.swift` spaceName.
- [x] `AUTH-076` **Unread count across places**. Core: PlaceMenu unread per place; Dock badge sum.

### Account screens

- [x] `AUTH-077` **Sign in to collaborate page**: local mode stand-in for account-only pages. Core: closed after the grading (see "Since this grading").
- [x] `AUTH-078` **Shared with Me**: facts "N · from anyone"; shared folders above shared pages; rows "Shared by X · place · role · N notes / updated …"; empty… Core: `Views/Screens/LibraryScreens.swift` SharedScreen (no facts line).
- [x] `AUTH-079` **Shared folder page**: `/shared/<id>`, "Shared with you by X (role)…", subfolders and notes, People button (folder Share dialog), empty "No notes here… Core: closed after the grading (see "Since this grading").
- [x] `AUTH-080` **Changes page**: facts subtitle; Proposed (connected apps' changes: Accept / Reject, "You can't open this note, so its proposal isn't shown.")… Core: closed after the grading (see "Since this grading").

## Sidebar & navigation

- [x] `NAV-001` **Native Mac sidebar body**: drawn on the window material with compact rows and system symbols; no footer (Settings and Help live in the menu bar). Core: `Views/Sidebar.swift` (source list, system material).
- [x] `NAV-002` **Account / place / workspace button**: at the sidebar top (on iPad wide, in the strip corner): avatar or logo, name, chevron; opens the account menu. Core: `Views/Common/Menus.swift` PlaceMenu at the sidebar top.
- [n/a] `NAV-003` **Note mode of the sidebar**: on a note with tools shown, the sidebar shows WebNoteSidebar instead of the list. Why: replaced by the inspector's Note Info (outline, pages) in `Views/Note/Inspector.swift`.
- [x] `NAV-004` **Home row**. Core: `Views/Sidebar.swift`.
- [x] `NAV-005` **Work with Foli AI row**: (only with the `ai` capability);; route /ai. Core: closed after the grading (see "Since this grading").
- [x] `NAV-006` **Foli DNA row and its saved views**: (only with `graph`). Core: closed after the grading (see "Since this grading").
- [x] `NAV-007` **Bookmarks row**: with a disclosure for the first 5 bookmarked notes (they open in a new tab). Core: closed after the grading (see "Since this grading").
- [x] `NAV-008` **Drafts row with count**. Core: closed after the grading (see "Since this grading").
- [x] `NAV-009` **All notes row**. Core: `Views/Sidebar.swift`.
- [x] `NAV-010` **Tasks row with today count**. Core: `Views/Sidebar.swift` (tasks.counts today).
- [x] `NAV-011` **Calendar row**. Core: `Views/Sidebar.swift`.
- [x] `NAV-012` **Reviews row**: (only when reviews are due or the tab is open). Core: closed after the grading (see "Since this grading").
- [x] `NAV-013` **Shared with Me row**: (with the `sharing` capability). Core: `Views/Sidebar.swift` (hidden in local mode).
- [x] `NAV-014` **Vault row**: (VaultSidebarRow). Core: `Views/Sidebar.swift` (hidden in local mode).
- [x] `NAV-015` **Changes row with count**: (with the `changes` capability). Core: `Views/Sidebar.swift` (changes capability, count).
- [x] `NAV-016` **Templates row**. Core: `Views/Sidebar.swift`.
- [x] `NAV-017` **Archive and Trash rows**: at the end. Core: `Views/Sidebar.swift` More section.
- [x] `NAV-018` **Row click rules**: the sidebar opens a fresh tab with no way back (`fromPage: false`); ⌘-click on a folder opens a background tab; middle-click on a… Core: closed after the grading (see "Since this grading").
- [x] `NAV-019` **Section headings as links**: with a full-row hover (Folders goes to /folders, Tags to /tags) and a fold chevron. Core: closed after the grading (see "Since this grading").
- [x] `NAV-020` **Folders section**: tree, first 5 top-level folders plus the active root, Show more / Show less; "No folders yet". Core: `Views/Sidebar.swift` every folder (no Show more); "No folders yet".
- [x] `NAV-021` **Folder sort menu**: (Manual, Name, Recent) kept on the device; Recent watches `folders.cards(all:true)`. Core: closed after the grading (see "Since this grading").
- [x] `NAV-022` **New Folder button**: in the Folders heading (⌃⌘N). Core: closed after the grading (see "Since this grading").
- [x] `NAV-023` **Folder row**: indent per level, disclosure, icon by state (page, stack, outline), count, sync mark, "…" on hover (RowMoreButton), right-click… Core: closed after the grading (see "Since this grading").
- [x] `NAV-024` **Folders open/closed state**: kept (`folevi:sidebar-folders-closed`); ancestors of the open folder are auto-expanded. Core: closed after the grading (see "Since this grading").
- [x] `NAV-025` **Tags section**: first 5 with colour, "…" menu, "N more" link to /tags; "Tag documents from the inspector" when empty. Core: closed after the grading (see "Since this grading").
- [n/a] `NAV-026` **Sidebar menu button (SidebarMenu)**: Hide or Show sidebar (⌘\), Focus mode or Exit focus mode; on a note, Show folders / Show document. Why: native sidebar toggle (toolbar, View menu) and View > Focus Mode.
- [n/a] `NAV-027` **Note tools / Folders switch**: in the strip beside the sidebar button (note only); the choice is kept. Why: note tools live in the inspector.
- [x] `NAV-028` **Sidebar toggle button**: in the strip ("Hide Sidebar (⌘\)"). Core: native NavigationSplitView sidebar button.
- [x] `NAV-029` **Focus mode hides the sidebar**: on a note. Core: `Views/Note/NoteScreen.swift` (editor.state.focus hides the sidebar).
- [n/a] `NAV-030` **Narrow iPad floating sidebar**: (iPad): slides over the content, dismissed on pick. Why: iPad only.
- [n/a] `NAV-031` **iPad web-look sidebar**: (iPad, non-native look): "Search or jump to…" well, bell, Home button, the web's items. Why: iPad only.
- [x] `NAV-032` **Sidebar model**: sections from session, home and folders.tree; orphans at the top level; selection id per route. Core: closed after the grading (see "Since this grading").
- [x] `NAV-033` **Back / Forward per tab**: (strip buttons, dimmed when unavailable, own view). Core: `Model/WindowModel.swift` back and forward stacks, toolbar buttons.
- [x] `NAV-034` **Route model**: web paths in both directions (/documents, /d/<id>, /folders/<id>, /tags/<id>, /tasks/<v>, /calendar?date=, /search?q=… Core: closed after the grading (see "Since this grading").
- [x] `NAV-035` **Screen routes and intents to the frame**. Core: closed after the grading (see "Since this grading").
- [n/a] `NAV-036` **Legacy AppKit outline sidebar**: (legacy): NSOutlineView with search, space menu, account foot, sync, bell, drag and drop and row menus. Why: legacy.
- [n/a] `NAV-037` **Mouse location helper**: for popover anchoring. Why: native popovers anchor themselves.

## Tabs

- [n/a] `TAB-001` **Tab model rules**: Home pinned first; one tab per page; at most 12 tabs besides Home (the oldest is dropped). Why: native window tabs: no tab cap or pinned Home tab.
- [x] `TAB-002` **Show route**: an existing tab comes forward, and a view's tab follows you inside the view. Core: closed after the grading (see "Since this grading").
- [x] `TAB-003` **Replace in a note**: a link inside a note replaces the note tab (a joined pane is replaced in place). Core: `Model/WindowModel.swift` navigate.request replaces in the window, newTab opens a tab.
- [n/a] `TAB-004` **Folder tabs (Finder style)**: `folders:` id; shows in the folder tab on screen or the last-used one, else a new one. Why: native window tabs; folders open in the front window.
- [x] `TAB-005` **Per-tab history**: (Back/Forward, limit 100). Core: `Model/WindowModel.swift` (200 steps).
- [x] `TAB-006` **Opener back rule**: Back with no history left closes the tab and shows its opener; sidebar and "+" tabs are fresh. Core: `Model/WindowModel.swift` opener: Back on a new note tab's first page closes it and shows its opener.
- [x] `TAB-007` **Forget trashed note in history**. Core: closed after the grading (see "Since this grading").
- [x] `TAB-008` **Open in background tab**. Core: closed after the grading (see "Since this grading").
- [n/a] `TAB-009` **Close tab**: shows the right neighbour, else the left, else Home. Why: macOS picks the next tab.
- [n/a] `TAB-010` **Close others / to the right / to the left / all**: (pinned and Home stay). Why: macOS tab menu (Close Other Tabs).
- [x] `TAB-011` **Reopen closed tab**: (⇧⌘T) with its history. Core: closed after the grading (see "Since this grading").
- [n/a] `TAB-012` **Move tab**: (drag); Home fixed; pinned stay among pinned. Why: macOS tab drag.
- [n/a] `TAB-013` **Pinned tabs**: at the start, icon only, no ×, survive close-others. Why: Core uses the Mac's native window tabs, which have no pinning.
- [x] `TAB-014` **Joined notes**: 2 or 3 panes in one `join:` tab, labelled "A + B"; join, unjoin at a gap, unjoin all, move pane, detach pane, sizes. Core: `Model/WindowModel.swift` panes (join, unjoin, move, detach, sizes) through note.show.
- [x] `TAB-015` **Select tab by number**: (⌘1 to ⌘9) and next/previous (wrapping). Core: closed after the grading (see "Since this grading").
- [x] `TAB-016` **Tab titles and icons**: from `notes.meta` (one watch for up to 200 ids), `note.meta`, `note.ready`, folder and tag names; trashed notes leave the strip. Core: window title from note.meta (`Model/WindowModel.swift`).
- [x] `TAB-017` **Per-space tabs**: switching space puts the strip away and brings back that space's tabs (up to 50 spaces). Core: closed after the grading (see "Since this grading").
- [x] `TAB-018` **Saved tabs**: (Codable, validated on restore). Core: closed after the grading (see "Since this grading").
- [n/a] `TAB-019` **Mac tab strip drawing**: Home round button, Show All Tabs round button, capsule track with hairlines, open tab in Liquid Glass, × at the leading edge on… Why: macOS draws the tab bar.
- [n/a] `TAB-020` **Equal-width tabs (Safari rule)**: every tab the same width filling the bar; a joined tab counts as two; minimum 96 pt on the Mac (172 web); scrolls when below the… Why: macOS tab bar.
- [n/a] `TAB-021` **Tab overflow arrows and soft edges**: reveal the open tab. Why: macOS tab bar.
- [n/a] `TAB-022` **Tab click / middle-click close / tooltip with full name**. Why: macOS tab bar.
- [n/a] `TAB-023` **Joined tab sections**: each section opens the group with that note focused. Why: the native tab shows one title; the page draws the panes.
- [n/a] `TAB-024` **Floating badge on a tab**: brings the floating window forward. Why: native window tabs carry no badge; a floating note is its own window in the Window menu.
- [x] `TAB-025` **New note pill**: (black, white in dark mode, prominent glass) right after the tabs; opens a fresh tab ready to type. Core: `Views/MainWindow.swift` New Note pill (InkPillStyle), note opens ready to type.
- [n/a] `TAB-026` **Sync status and bell at the strip end**. Why: sync in the sidebar footer, notifications as a sidebar row with a badge.
- [n/a] `TAB-027` **iPad web-look bar**: (iPad): Back/Forward, Foli AI pill, New folder (in this folder) pill, New note button. Why: iPad only.
- [x] `TAB-028` **Top-bar New folder rule**: on a folder page it creates inside the folder (if nesting allows and the person can edit). Core: closed after the grading (see "Since this grading").
- [n/a] `TAB-029` **Tab preview on hover**: after 300 ms, then instant between tabs; hidden on leave, press, drag or the open tab. Why: macOS Show All Tabs.
- [n/a] `TAB-030` **Tab pictures**: the note page drawn small from `note.picture` in a script-less WKWebView; joined notes side by side; views as their icon and… Why: macOS Show All Tabs.
- [n/a] `TAB-031` **Tab screenshots**: captured when leaving a tab and shortly after it settles; never the Vault; fitted whole. Why: macOS Show All Tabs.
- [n/a] `TAB-032` **Note tab thumbnail as card**: (WebNoteCard) from recent rows. Why: macOS Show All Tabs.
- [n/a] `TAB-033` **Folder/list tab thumbnail**: the first notes as the grid shows them. Why: macOS Show All Tabs.
- [n/a] `TAB-034` **HomePicture**: drawn mini Home (Recent notes row plus Recent folders row, 960x600, 32 pt gap). Why: macOS Show All Tabs.
- [n/a] `TAB-035` **Show All Tabs (Tab Overview)**: "N tabs" heading, "Search tabs" filter, card per tab with close, pinned mark, New note card, Done; Esc, arrows, Return; opening… Why: macOS Window > Show All Tabs.
- [n/a] `TAB-036` **Overview button tooltip**: "Show All Tabs (⌘⇧\)". Why: macOS Show All Tabs.
- [n/a] `TAB-037` **Tab context menu**: (see Context menus). Why: macOS tab menu.
- [n/a] `TAB-038` **Desk tabs persistence**: (iPad). Why: iPad only.
- [n/a] `TAB-039` **Legacy AppKit tab strip**: (legacy): Close, Close Other Tabs, Close Tabs to the Right, Open in New Window. Why: legacy.
- [~] `TAB-040` **New Tab command**: opens Home and focuses search. Core: ⌘T opens a tab at Search with the field focused (recent searches and notes), not Home.
- [n/a] `TAB-041` **Close Tab on Home closes the window**. Why: macOS tab and window closing.
- [n/a] `TAB-042` **Float note from tab**: (Mac only, `frameCanFloatNotes`). Why: native window tabs have no per-tab menu to add Float to; Note > Float on Top does it.
- [n/a] `TAB-043` **Debug tab frames and strip metrics**: for scripts. Why: Debug harness.

## Home

- [x] `HOME-001` **Mac Home screen**: scroll page with Catch me up, Today's reviews, Recent notes, Bookmarks and Recent folders, max width 1400. In the native look the… Core: `Views/Screens/HomeScreen.swift` (summary, Catch me up, Recent, Starred, Folders, Tags).
- [n/a] `HOME-002` **Home has no own card controls (Mac)**: the card's glass bar shows only the title and the search capsule. Why: native toolbar.
- [x] `HOME-003` **Catch me up button**: shown only when `home.catchUp.available`. Foli AI mark plus "Catch me up", with the hint "A quick AI brief of this week's notes… Core: `Views/Screens/HomeScreen.swift` CatchUpCardView (catchUp.run).
- [x] `HOME-004` **Catch me up error line**: the engine's or the command's error, in danger colour, under the button. Core: CatchUpCardView shows the error.
- [x] `HOME-005` **Your week card, running**: "Reading this week's notes…" over 4 shimmering gradient lines; respects Reduce Motion. Core: closed after the grading (see "Since this grading").
- [x] `HOME-006` **Your week card, ready**: Markdown brief whose citation numbers open notes, numbered source chips that open notes, Refresh button (tooltip "Refresh") and… Core: closed after the grading (see "Since this grading").
- [x] `HOME-007` **Catch me up page (route `/catch-up`)**: intro with the AI tile, "Your week in one short read", explainer, three rows (What changed, What's due, Where it came from)… Core: closed after the grading (see "Since this grading").
- [x] `HOME-008` **Today's reviews card**: shown when Home's rows include Reviews. Shows "N cards to review." with a Start review button (opens `/review`), or "All caught… Core: closed after the grading (see "Since this grading").
- [x] `HOME-009` **Recent notes section**: clock icon header; "See all" opens All notes in a new tab; carousel of up to 10 notes. Core: `Views/Screens/HomeScreen.swift` Recent strip, See All.
- [x] `HOME-010` **Recent notes empty and loading**: "No notes yet / Press New to write your first one."; carousel skeleton while loading. Core: closed after the grading (see "Since this grading").
- [x] `HOME-011` **Bookmarks section**: up to 6 starred notes; "See all" opens the Bookmarks list; empty text "No bookmarks yet / Bookmark notes you come back to often… Core: closed after the grading (see "Since this grading").
- [x] `HOME-012` **Note carousel**: horizontal snapping row with fade masks at the ends and back/forward arrow buttons on hover ("Scroll recent notes back/forward")… Core: closed after the grading (see "Since this grading").
- [x] `HOME-013` **Note card cell**: click opens; hover lifts the card and shows the "…" button; press dips; right-click menu; drag carries the note; bookmark ribbon… Core: `Views/Screens/NoteListScreen.swift` NoteCardButton (WebNoteCard, hover, press, menu, drag, unsynced).
- [x] `HOME-014` **Home card menu**: Open, Bookmark / Remove bookmark, Duplicate, Move to folder…, Copy to… (when other spaces exist), Archive / Unarchive, Remove… Core: closed after the grading (see "Since this grading").
- [x] `HOME-015` **Recent folders section**: every folder, most recently changed first, two full rows at the current width; header shows the total count; "See all" opens… Core: closed after the grading (see "Since this grading").
- [x] `HOME-016` **Recent folders empty**: "No folders yet / Create one from the sidebar to group related notes.". Core: closed after the grading (see "Since this grading").
- [x] `HOME-017` **Folder card**: hover lift; "…" in the frosted front; right-click menu; notes or folders dropped on it go inside; spring-loads after 0.6 s… Core: closed after the grading (see "Since this grading").
- [x] `HOME-018` **Folder menu (Mac)**: Open in new tab, New note in folder, New folder inside…, Rename…, Change color…, Move folder…, Move to another place…, Move to… Core: closed after the grading (see "Since this grading").
- [x] `HOME-019` **Drop on Home folders**: notes, multi-selections or folders dropped inside. A refused drop gives an error haptic and a toast; toasts read "Moved", "Moved… Core: closed after the grading (see "Since this grading").
- [x] `HOME-020` **Where Home's rows live on the Mac**: the sidebar has Home, Bookmarks, Drafts (count), All notes, Reviews (count), Shared with Me, Changes (count, `caps.changes`)… Core: closed after the grading (see "Since this grading").
- [x] `HOME-021` **Views pause when Home is off screen**: `setVisible`. Core: closed after the grading (see "Since this grading").
- [n/a] `HOME-022` **iOS only: search entry**: "Search in <space>" field that opens Search, ⌘F. Why: iPhone/iPad only.
- [n/a] `HOME-023` **iOS only: avatar button**: account and places switcher. Why: iPhone/iPad only.
- [n/a] `HOME-024` **iOS only: bell and "…" pill**: bell with unread badge, plus a menu with New folder, All folders, Foli DNA (graph capability), and Refresh ⌘R in a macOS build. Why: iPhone/iPad only.
- [n/a] `HOME-025` **iOS only: counted rows**: All notes, Drafts, Shared with Me, Changes, Reviews; zero counts are hidden. Why: iPhone/iPad only.
- [n/a] `HOME-026` **iOS only: Starred list rows**: "See all bookmarks", context menu, drag. Why: iPhone/iPad only.
- [n/a] `HOME-027` **iOS only: Folders strip or grid**: with a "…" menu (New folder, All folders); dropping on the section moves to the top level. Why: iPhone/iPad only.
- [n/a] `HOME-028` **iOS only: Tags disclosure**: folded by default. Why: iPhone/iPad only.
- [n/a] `HOME-029` **iOS only: Templates, Archive, Trash rows**. Why: iPhone/iPad only.
- [n/a] `HOME-030` **iOS only: extras**: locked-space empty state ("X is locked"), header with eyebrow and sync status, pull to refresh (`engine.refresh`), accessibility… Why: iPhone/iPad only.

## Notes lists

### Notes lists (All, Recent, Starred, Folder)

- [x] `LIST-001` **Routes**: `/notes`, `/drafts`, `/starred`, `/archive`, `/trash`, `/templates`, `/folders/<id>`, `/tags/<id>`. Core: `Model/Destination.swift`.
- [x] `LIST-002` **Mac note browser**: one screen for every list kind. Core: `Views/Screens/NoteListScreen.swift` (windowed notes.list).
- [x] `LIST-003` **List titles**: All notes, Drafts, Bookmarks, Archive, Trash, Templates, the folder's name, the tag's name. Core: `Views/Screens/NoteListScreen.swift` title.
- [x] `LIST-004` **Count / status text**: "N notes", plus " · drag to arrange" in manual order; in the native look it is the card subtitle. Core: navigation subtitle "N notes" (no "drag to arrange").
- [x] `LIST-005` **Filter notes field**: shown when there are notes or while filtering; narrows loaded rows (title, excerpt) at once and re-queries the engine after 250… Core: `.searchable` in the toolbar sends the engine filter.
- [x] `LIST-006` **Filter empty state**: "No notes match "x"". Core: "No Results" empty state.
- [x] `LIST-007` **Windowed loading**: placeholder slots, skeleton cards or rows while loading, snapshot of the list top per sort. Core: closed after the grading (see "Since this grading").
- [x] `LIST-008` **Grid layout**: fixed columns from the width, cards 25% smaller on Mac. Core: LazyVGrid of WebNoteCard.
- [x] `LIST-009` **List layout row**: grip "⋮⋮" (web look only), file icon or selection check, title, "Waiting to sync", folder badge, #tags, time, Use (templates)… Core: closed after the grading (see "Since this grading").
- [x] `LIST-010` **List row interactions**: click opens; ⌘-click toggles; ⇧-click selects a range; ⌥-click opens; draggable; right-click menu; accessibility "Open" action. Core: native List selection (⌘-click, ⇧-click), double-click opens, drag, menu.
- [x] `LIST-011` **Note row menu**: (template) New page from template; Open or Edit template; Bookmark / Remove bookmark; Duplicate; Move to folder…; Copy to…… Core: closed after the grading (see "Since this grading").
- [x] `LIST-012` **Right-click on a multi-selection**: bulk actions, then Clear selection. Core: `Views/Screens/NoteListScreen.swift` selectionMenu.
- [x] `LIST-013` **All notes empty**: "Nothing here yet / Starting a document takes one keystroke." with a "New document" button. Core: empty state with New Note.
- [x] `LIST-014` **Bookmarks (starred) list**: empty "No bookmarks yet / Bookmark a note to keep it close at hand.". Core: empty state.
- [x] `LIST-015` **Recent**: there is no Recent list view (`NotesListView` has no recent case). Recent lives only in the Home carousel and the palette's… Core: `Views/Screens/LibraryScreens.swift` RecentScreen (Views.Recent).
- [n/a] `LIST-016` **Folder title row (web look)**: glyph; name; count; filter; tray with the path menu, Sort, the view switch, Share (sharing capability) and "…" folder options. Why: web look only.
- [x] `LIST-017` **Folder path menu "Enclosing folders"**: this folder (ticked), each folder above it, All folders. Core: closed after the grading (see "Since this grading").
- [x] `LIST-018` **Folder card controls (native look)**: count subtitle; sort; layout segmented; path pull-down; Share button; "…" folder options. Core: closed after the grading (see "Since this grading").
- [n/a] `LIST-019` **Folder page tint**: a faint wash of the folder's colour, web look only. Why: web look only.
- [x] `LIST-020` **Subfolders section "Folders"**: cards above the notes, selectable, multi-drag, middle-click; hidden while filtering. Core: Folders section above the notes.
- [x] `LIST-021` **Folder empty states**: "This folder is empty / Start a document here, or move one in with Move to folder." or "No notes directly in this folder yet /… Core: closed after the grading (see "Since this grading").
- [x] `LIST-022` **New note in the open folder**: the top bar or ⌘N creates the note in the folder on screen, else Drafts, and opens it in a new tab. Core: `Views/Common/Menus.swift` NoteActions.newNote (folder on screen).
- [x] `LIST-023` **Tag note list**: empty "No documents carry this tag yet / Add tags to a document from its Info panel.". Core: closed after the grading (see "Since this grading").
- [x] `LIST-024` **Keyboard**: Esc clears the selection; ⌘A selects all; a click on empty space clears. Core: native List (⌘A, click on empty space).
- [x] `LIST-025` **Mac View menu "As Cards" / "As List" (bug)**: sets `NotesListModel.layout`, but `WebNoteBrowser` reads its own `folevi.web.layout.<view>`, so the menu never changes the Mac… Core: fixed in Core: View > as Cards / as List drives the list (WindowModel.listStyle).
- [n/a] `LIST-026` **iOS only: list screen**: Select / Done, Select All / Deselect All, "…" menu with View as (Cards, List), Sort by, and the screen actions (New note here… Why: iPhone/iPad only.
- [n/a] `LIST-027` **iOS only: swipes**: leading Bookmark / Remove bookmark (Restore in Trash); trailing Trash, Archive / Unarchive, Move (Delete in Trash); full swipe… Why: iPhone/iPad only.
- [n/a] `LIST-028` **iOS only: keyboard grid navigation**: arrows move focus, Return opens, Space selects. Why: iPhone/iPad only.
- [n/a] `LIST-029` **iOS only: folder path bar**: ancestor chips that take drops (un-nesting a folder). Why: iPhone/iPad only.
- [n/a] `LIST-030` **iOS only: pull to refresh**: `engine.refresh`. Why: iPhone/iPad only.

### List features (sort, views, selection, bulk, drag)

- [x] `LIST-031` **Note sort options**: Last edited, Created, Title, Manual order; saved per view (`folevi.sort.<view>`); changing the sort restarts the list. Core: closed after the grading (see "Since this grading").
- [x] `LIST-032` **Sort controls**: web "Sort [x ⌄]" select; title-row sort (icon, value, chevron, tooltip "Sort"); card `.sort` group. Core: toolbar Sort menu.
- [x] `LIST-033` **Mac view modes**: Grid, Compact cards, List (`WebNotesLayout`); saved in `folevi.web.layout.<view>`; List by default for Trash and Archive… Core: closed after the grading (see "Since this grading").
- [x] `LIST-034` **View switch control**: web segmented control or the system segmented picker in the native look; tooltips Grid / Compact cards / List. Core: `Views/Screens/NoteListScreen.swift` ListStylePicker.
- [n/a] `LIST-035` **iOS view modes**: Cards and List (`NotesLayout`, `folevi.layout.<view>`). Why: iPhone/iPad only.
- [x] `LIST-036` **Folders page sort**: Manual, Name, Recent (`folevi.web.folders-sort`; old saved values migrated). Core: closed after the grading (see "Since this grading").
- [x] `LIST-037` **Folders page layout**: Grid or List; List rows show glyph, name, "in path", pages, age. Core: closed after the grading (see "Since this grading").
- [x] `LIST-038` **Folders page title row**: "Folders" with count, "Filter folders", sort and layout tray, New folder button (canEdit); in the native look, card controls. Core: closed after the grading (see "Since this grading").
- [x] `LIST-039` **Folders page empty**: "No folders yet / Create one to group related pages." or "No folders match "x"". Core: FoldersScreen empty state with New Folder.
- [x] `LIST-040` **Folders page search**: looks through every level; a match shows "in <path>". Core: closed after the grading (see "Since this grading").
- [n/a] `LIST-041` **Card glass controls (native look)**: count subtitle; segmented, pull-down, button, more and actions groups; they fold to compact, then into one menu, when narrow. Why: native toolbar items.
- [x] `LIST-042` **Finder-style selection rules**: ⌘-click toggles, ⇧-click selects a range from the anchor, ⌥-click opens, ⌘A selects everything shown, Esc clears. Core: closed after the grading (see "Since this grading").
- [x] `LIST-043` **What can be selected**: subfolders first, then the loaded notes; templates can't be selected. Core: subfolder rows and notes are selectable in the list.
- [x] `LIST-044` **Selection bar**: "N selected", Select all (while not everything is), the actions, × "Clear selection (Esc)"; glass capsule in the native look… Core: closed after the grading (see "Since this grading").
- [x] `LIST-045` **Bulk actions offered**: only what every selected item can take. Notes: Bookmark/unbookmark, Archive/unarchive, Trash, Copy to. Folders: Change color… Core: closed after the grading (see "Since this grading").
- [x] `LIST-046` **Bulk labels and icons**: Open in new tabs, Move to folder…, Copy to…, Change color…, Move to Trash, Delete permanently…, Delete folders… Core: closed after the grading (see "Since this grading").
- [x] `LIST-047` **Open in new tabs**: notes and folders open in background tabs; toast "Opened N new tabs". Core: closed after the grading (see "Since this grading").
- [x] `LIST-048` **Move dialog (Mac)**: notes and folders together, one toast with one Undo. Core: closed after the grading (see "Since this grading").
- [x] `LIST-049` **Copy to dialog**: lists other editable, unlocked spaces; toast "Copied to Space / Folder" (Mac dialog; iOS `CopyToSheet` with space picker, Drafts… Core: closed after the grading (see "Since this grading").
- [x] `LIST-050` **Change color and Delete folders (bulk)**: delete confirmation "Delete N folders? / … notes move to Drafts". Core: closed after the grading (see "Since this grading").
- [x] `LIST-051` **Drag payloads**: `NoteDragItem` (one note or the whole selection, folders included) and `FolderDragItem`; UTTypes `com.folevi.note-ref` and… Core: closed after the grading (see "Since this grading").
- [x] `LIST-052` **Drop on folders**: notes go inside; a folder goes before, inside or after depending on the zone; spring-loading after 0.6 s; nesting rules… Core: closed after the grading (see "Since this grading").
- [~] `LIST-053` **Folders page drag reorder**: a gap opens, a dashed placeholder marks it, the dragged card dims; the commit may switch the sort to Manual; off while searching. Core: drop a folder on the leading or trailing quarter of another card on the Folders page to put it before or after (folder.move afterId; the sort turns Manual); an accent bar marks the spot; no dashed gap or dimmed card; not yet tried with a real drag.
- [x] `LIST-054` **Manual note order**: Move up / Move down in the menu (`note.reorder`); drag reorder exists only in the iOS List (`onMove`). The Mac has no drag… Core: closed after the grading (see "Since this grading").
- [x] `LIST-055` **Hide from recent**: "Remove from recent" (Home cards); toast "Removed from Recent notes" with Undo. Core: `Views/Screens/LibraryScreens.swift` RecentScreen "Hide from Recent" (list rows only).
- [x] `LIST-056` **Card pictures**: cover (built-in art, own image file, colour or plain), preview lines, font, shape, created and edited times; folder cards show up… Core: `Views/Common/Style.swift` Cards (cover, preview lines, font, shape, times, folder previews).
- [n/a] `LIST-057` **Tab pictures**: page thumbnails for the tab hover card and Tab Overview; not used in lists. Why: native window tabs have no pictures.
- [x] `LIST-058` **Optimistic UI**: hidden ids and star overrides settle after 3 s; skipped toast "N notes couldn't be changed. You may not have permission."; no… Core: closed after the grading (see "Since this grading").
- [x] `LIST-059` **Duplicate**: toast "Duplicated". Core: NoteMenu Duplicate (note.duplicate).
- [x] `LIST-060` **Middle-click on folder cards and rows**: opens in a background tab. Core: closed after the grading (see "Since this grading").
- [x] `LIST-061` **Skeletons**: carousel, cards, rows, chips (`ListSkeleton`). Core: closed after the grading (see "Since this grading").
- [x] `LIST-062` **Accessibility**: rows grouped as "<title>, <time>"; "More actions for <title>" labels and tooltips; selected trait. Core: rows combined for VoiceOver, cards labelled.

### Shared with me

- [x] `LIST-063` **Shared with Me screen (Mac)**: header "Shared with Me" with "N folders · N pages · from anyone". Core: closed after the grading (see "Since this grading").
- [x] `LIST-064` **Local mode page**: "Sign in to Folevi to share and collaborate" with an explainer. Core: closed after the grading (see "Since this grading").
- [x] `LIST-065` **Loading and empty**: a placeholder while loading; empty "Nothing has been shared with you yet / Folders and pages people share with you…". Core: SharedScreen loading and empty.
- [x] `LIST-066` **Folders section rows**: glyph, name, "Shared by X · place · role · N notes · updated …"; opens `/shared/<id>`. Core: SharedScreen folder rows (no place or updated time).
- [x] `LIST-067` **Pages section rows**: icon, title, excerpt, "Shared by X · place · role · updated …"; opens the note. Core: SharedScreen note rows.
- [x] `LIST-068` **Shared folder page header**: name; subtitle "place · role"; People button and card control (folder share dialog). Core: closed after the grading (see "Since this grading").
- [x] `LIST-069` **Shared folder page body**: breadcrumb (Shared with Me › path › name); "Shared with you by X (role). Notes added to this folder later show up here too."… Core: closed after the grading (see "Since this grading").
- [x] `LIST-070` **Shared folder not found**: "You can't open this folder / It may have been unshared, moved or deleted…". Core: SharedFolderScreen not found state.
- [x] `LIST-071` **Sidebar row**: shown with the `caps.sharing` capability. Core: `Views/Sidebar.swift` (hidden in local mode).
- [n/a] `LIST-072` **iOS only: SharedListScreen**: pages only (it never draws `folderRows`), emoji icon, lock for encrypted pages, context menu Open, pull to refresh. Why: iPhone/iPad only.

## Folders

- [x] `FOLD-001` **New folder (name prompt)**: "New folder" or "New folder in "X""; "Folder name"; "Create folder"; optionally opens it. Core: `Views/Common/Menus.swift` NameSheet from the sidebar + and Folders screen (folder.create).
- [x] `FOLD-002` **Quick new folder**: (File > New Folder, no prompt, "New folder"). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-003` **Rename folder**: toast "Renamed". Core: FolderMenu Rename (folder.rename).
- [x] `FOLD-004` **Change color**: (25 colours, 5x5, current ringed). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-005` **Change color for several**. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-006` **Move folder**: (picker with Top level first; notes and subfolders go with it). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-007` **Move items (notes and/or folders)**: no Drafts or top level when mixed. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-008` **Move notes to folder**: Drafts, a folder, or New folder "name" made in place. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-009` **Copy notes to another space**: (space select then folder). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-010` **Folder picker**: search, tree, "Current" tag, blocked self/descendants, keyboard ↑/↓/Return, "Back to folders", inline new-folder naming. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-011` **Delete folder (confirm)**: notes go to Drafts, subfolders up a level; toast "Folder deleted". Core: closed after the grading (see "Since this grading").
- [x] `FOLD-012` **Delete several folders**. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-013` **Always fully encrypted (lock) dialog**: on and off wording by level standard/encrypted. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-014` **Move to top level**: toast. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-015` **Copy folder link**: (FoleviLinks.folder). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-016` **Folder Share dialog**. Core: `Views/Sharing/SharingViews.swift` FolderSharingSheet.
- [x] `FOLD-017` **Invite people**: (Settings members). Core: Settings > Workspace (the page's own pane).
- [x] `FOLD-018` **Ask Foli AI about this folder**. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-019` **Edit tag sheet**: Name (max 40), 6 colours, Save ("Saving…"). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-020` **Delete tag confirm**: (goes Home if the tag is on screen). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-021` **Tag colour quick change**: (Cocoa, Moss, Marigold, Plum, Coral, Gray). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-022` **Folder nesting rules**: max 5 levels; never into itself or a descendant; messages. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-023` **Drop zones**: leading quarter before, middle inside, trailing quarter after (cards horizontal, rows vertical). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-024` **Sidebar folder drag and drop**: notes into a folder; a folder above, inside or below (accent line or ring); onto the Folders heading for the top level; a… Core: closed after the grading (see "Since this grading").
- [x] `FOLD-025` **Sidebar own order**: (Manual) synced, independent of rank; dropping between rows of the same level reorders only; a drop while sorted by Name/Recent… Core: `Views/Sidebar.swift` drag top-level folders to order them (folder.setSidebarOrder); top level only, no Undo.
- [x] `FOLD-026` **Multi-item move with refusals**: ("couldn't move" toast) and a summary toast. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-027` **Folder move refusal toasts**: ("A folder can't go inside itself.", "Folders nest up to 5 levels."). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-028` **Folders page (WebFoldersIndex)**: cards, rows or tree; search; sort Manual/Name/Recent; card drag into gaps; multi-select (Open in new tabs, Move, Change color… Core: closed after the grading (see "Since this grading").
- [x] `FOLD-029` **Folder page path menu ("Enclosing folders")**: current folder checked, ancestors, All folders. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-030` **Folder page Share button**. Core: `Views/Screens/NoteListScreen.swift` Share Folder toolbar button.
- [x] `FOLD-031` **Folder page "…" = folder menu**. Core: closed after the grading (see "Since this grading").
- [x] `FOLD-032` **Frosted folder cards**: (Mac/web 25% smaller) with "…" chip on hover. Core: WebFolderCard (FoleviDesign) on Home and Folders; no hover "…" chip.
- [n/a] `FOLD-033` **All Folders screen**: (iPhone): Filter folders, View as / Sort by menus, New folder. Why: iPhone only.
- [n/a] `FOLD-034` **New folder sheet with colour and parent**: (iPhone). Why: iPhone only.
- [n/a] `FOLD-035` **Folder tree rows**: with lock and not-synced marks, "+N more", "Show less" (iPhone/iPad shared). Why: iPhone/iPad only.
- [x] `FOLD-036` **NoteActions folder ops**: (create, rename, color, move, moveFolders with undo, lock, delete). Core: closed after the grading (see "Since this grading").
- [x] `FOLD-037` **Folder menu context**: (canEdit, otherPlaces, aiOn, canLock, level, inviteSpace, subfolderCount). Core: closed after the grading (see "Since this grading").

## Tags

- [x] `TAG-001` **Tags page (Mac)**: route `/tags`; "Filter tags" field (a leading # is ignored); count "N tags" / "N of M tags". Core: closed after the grading (see "Since this grading").
- [x] `TAG-002` **Tag sort**: Name, Most used, Newest; kept in `folevi.tags-sort`; a card sort control in the native look. Core: closed after the grading (see "Since this grading").
- [x] `TAG-003` **Tag chips**: coloured #, name, "N pages"; a click opens the tag's notes. Core: TagsScreen rows (colour, name, count), double-click opens.
- [x] `TAG-004` **Tags empty and loading**: "No tags yet / Add tags to a page from its Info panel." or "No tags match "x""; chip skeleton. Core: TagsScreen empty state.
- [x] `TAG-005` **Tag menu (sidebar)**: Edit tag…, "Color: <name>" for each other colour (Cocoa, Moss, Marigold, Plum, Coral, Gray), Delete tag… Core: closed after the grading (see "Since this grading").
- [x] `TAG-006` **Edit tag sheet (rename)**: name (40 characters at most) and colour chips, Cancel, Save ("Saving…"), toast "Tag updated". Core: closed after the grading (see "Since this grading").
- [x] `TAG-007` **Delete tag**: confirmation "Delete #name? / The tag is removed from every document…", toast "Deleted #name"; goes Home if that tag's page is… Core: closed after the grading (see "Since this grading").
- [n/a] `TAG-008` **iOS only: TagsIndexModel**: the same arrange logic as a model; the Mac copies it inline. Why: iPhone/iPad only.
- [n/a] `TAG-009` **iPhone only: Add tag bulk action**: one toast, "Tagged N notes #x" or "Already tagged #x". Why: iPhone only.

## Note page & editor integration

- [x] `NOTE-001` **Web editor in the Page View**: native sends editor commands only while a note is on screen (`editor` guard). Core: `Model/WindowModel.swift` editor() needs the lent page.
- [x] `NOTE-002` **Prepare on touch-down**: the note starts drawing before the click ends. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-003` **Show / close note**. Core: `Engine/Pages.swift` show(note:) and closeNote.
- [x] `NOTE-004` **Editor state tracking**: (block, marks, link, undo/redo, focus, locked, canLock, format, menu, panel). Core: `Model/WindowModel.swift` listen (editor.state, note.tools, note.meta, editor.panel).
- [x] `NOTE-005` **Note tools sidebar (WebNoteSidebar)**: heading with the note name and "In Folder > Sub" crumbs (no "In Drafts" flash). Core: `Views/Note/Inspector.swift` Location section, plus the toolbar's folder menu.
- [x] `NOTE-006` **Nested pages list**: ("PAGES"; overflow message). Core: Inspector Pages section.
- [x] `NOTE-007` **Tool tabs**: Table of contents, Comments (unread dot), Tasks in this page, Attachments and links, Find in page; kept in… Core: Inspector sections (Outline, Pages, Tasks, Links, Attachments, Comments); Find is the native bar.
- [x] `NOTE-008` **Table of contents (outline)**: title row scrolls to top; heading rows jump; nested page rows open the page; empty text. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-009` **Comments list**: Open / Resolved segments with counts, author, time, unread dot, replies, resolved-by, deleted, "Not sent" / "Waiting to send"; a… Core: closed after the grading (see "Since this grading").
- [x] `NOTE-010` **Tasks in this page**: "x of y done"; toggle a check (if editable); jump. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-011` **Attachments and Links**: an attachment jumps to its block; an internal link opens in place; an external link opens in the browser. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-012` **Find in page (sidebar)**: field, "n of m(+)", "No results in this page", Clear, Previous/Next; ⌘G and ⇧⌘G step it. Core: `Views/Note/NoteScreen.swift` FindBar (find, find.clear, n of m, ⌘G, ⇧⌘G).
- [x] `NOTE-013` **Find in note (page bar)**: ⌘F on a note; Find Next/Previous go to the page's bar when no sidebar search. Core: FindBar on ⌘F.
- [x] `NOTE-014` **Side panels**: format, insert, style, comments, ai, info, related (opened by the page or by native). Core: `Model/WindowModel.swift` panel() (insert, style, comments, related).
- [x] `NOTE-015` **Inspector (Info panel) toggle**: ⌥⌘I. Core: View > Note Info (⌥⌘I) opens Core's inspector.
- [x] `NOTE-016` **Style panel**: (Format > Style…). Core: Format > Style and Theme… (panel.open style).
- [x] `NOTE-017` **Foli AI on a note**: (⌘J toggle). Core: closed after the grading (see "Since this grading").
- [x] `NOTE-018` **Format marks**: bold, italic, underline, strike, code, highlight. Core: `App/AppCommands.swift` Format menu.
- [x] `NOTE-019` **Link**: (Format > Link… goes straight to the page). Core: Format > Link… (link editor command).
- [x] `NOTE-020` **Block types**: H1/H2/H3, body, bulleted, numbered, checklist. Core: Format > Text Style (also toggle, quote, callout, code block).
- [x] `NOTE-021` **Indent / Outdent**. Core: Format > Indent, Outdent.
- [x] `NOTE-022` **Move block up/down, duplicate block**. Core: Format > Move Block Up/Down, Duplicate Block.
- [x] `NOTE-023` **Focus mode toggle**: (⌥⌘\). Core: View > Focus Mode (⌃⇧⌘F, not ⌥⌘\).
- [x] `NOTE-024` **Lock note**: (always fully encrypted; enabled when canLock). Core: `Views/Note/NoteScreen.swift` NoteMoreMenu Lock Note (when canLock).
- [x] `NOTE-025` **Bookmark (star)**. Core: toolbar Bookmark and Note > Star (note.star).
- [x] `NOTE-026` **Archive / Unarchive**. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-027` **Move to Trash**: (⌘⌫ gated); the tab closes and leaves history. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-028` **Move to… / Duplicate / Version History… / Export… (⇧⌘E)**: via the page's dialogs. Core: NoteMoreMenu (note.menu move, duplicate, history, export ⇧⌘E).
- [x] `NOTE-029` **Copy Link**: (⌃⌘C, `https://app.folevi.com/d/<id>`, "Link copied"). Core: Copy Link (⌥⌘C, not ⌃⌘C).
- [x] `NOTE-030` **Print**: (app command, asks the frame whether a note shows). Core: File > Print sends note.menu print; `Host/Capabilities.swift` print and the shared print() hook.
- [x] `NOTE-031` **Share**: (the note's own bar at the page foot; File > Share submenu from MainMenu). Core: closed after the grading (see "Since this grading").
- [x] `NOTE-032` **Note "..." menu actions contract**: share, move, copyTo, duplicate, export, history, present, print, find, delete, moveToVault, saveAsTemplate, showEditors… Core: NoteMoreMenu follows editor.state.menu actions.
- [n/a] `NOTE-033` **Note menu plan**: (iPhone): sections and submenus (Connections, History, Move and copy, Share and export); trash-only menu; permissions (canEdit… Why: iPhone only.
- [n/a] `NOTE-034` **Legacy native note menu**: (legacy, Mac). Why: legacy.
- [n/a] `NOTE-035` **Review this note's cards**: (iPhone menu item; route /review?note=). Why: iPhone menu item.
- [~] `NOTE-036` **Foli DNA of this note**: (/graph?note=<id>). Core: Foli DNA of This Note opens Foli DNA and sends /graph?note=<id> to the page (the engine's center); not yet seen on a library with linked notes.
- [x] `NOTE-037` **Present / Move to the Vault / Save as template / Show-Hide editors / Make text in images searchable**: (page via `note.menu`; listed in NoteMenuPlan). Core: NoteMoreMenu (present, moveToVault, saveAsTemplate, showEditors, readImages).
- [x] `NOTE-038` **Note picture / cover**: card covers via `files.urls`; tab pictures via `note.picture`. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-039` **Floating notes bar**: (Mac Float Note). Core: closed after the grading (see "Since this grading").
- [x] `NOTE-040` **Text context menu in native fields**: spelling guesses, Learn, Ignore, Look up, Cut, Copy, Paste, Select all, Share. Core: system menus on SwiftUI text fields.
- [x] `NOTE-041` **Undo / Redo**: (system menu to the web view). Core: `Host/PageView.swift` Edit > Undo and Redo run the editor's undo and redo on a note.
- [x] `NOTE-042` **Insert**: (Insert panel via the page; `insert {kind}` with tile ids, quick-table-RxC). Core: Format > Insert… (⌘/, panel.open insert).
- [x] `NOTE-043` **web.show / dismissKeyboard / insets / state / focus**: editor commands exist; iPad uses `insets`. Core: web.show used for Reviews, Foli DNA and web Settings panes.
- [x] `NOTE-044` **Note page layout rules**: (flat plain note, page cards, Craft padding; the page draws its card); see Binding rules. Core: the page draws the note's layout.
- [x] `NOTE-045` **Help > Keyboard Shortcuts**: opens /help scrolled to shortcuts. Core: closed after the grading (see "Since this grading").
- [x] `NOTE-046` **Search All Notes / Open Quickly**: focuses the card's search, or opens the palette directly on a note. Core: Edit > Search All Notes (⇧⌘F) and Command Palette (⌘K).

## Search & command palette

### Search

- [x] `SRCH-001` **Search route (Mac)**: `.search(q)` shows the shared `SearchScreen` without Cancel; `prepare` fills in the query. Core: `Views/Screens/LibraryScreens.swift` SearchScreen.
- [x] `SRCH-002` **⌘K palette entry points**: Open Quickly ⌘K, Search All Notes ⇧⌘F, Go > Search…, the card search capsule "Search or jump to… (⌘K)", status item "Search… Core: closed after the grading (see "Since this grading").
- [x] `SRCH-003` **Search field**: "Search in <space>" / "Search everywhere"; focused on open; spinner while searching; clear button; Return opens the selected or… Core: closed after the grading (see "Since this grading").
- [x] `SRCH-004` **Debounced query**: 120 ms debounce, 40 results at most. Core: 180 ms debounce, 100 results (search).
- [x] `SRCH-005` **Scopes**: this space; Everywhere (when there are several spaces); By meaning (when `meaningAvailable` or AI is on). Core: place, Every Place and By Meaning toggles.
- [x] `SRCH-006` **Folder filter**: "Any folder" plus the folders, indented by depth; turned off for Everywhere. Core: Any Folder picker (not indented, not turned off for Every Place).
- [x] `SRCH-007` **Tag filter**: "Any tag" plus #tags. Core: Any Tag picker.
- [x] `SRCH-008` **Updated filter**: Any time, Past week, Past month, Past year. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-009` **Archived toggle and Clear**: "Include archived notes"; Clear filters. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-010` **Before typing**: Recent searches (8 at most, with Clear and swipe Remove) and Recent notes (8). Core: closed after the grading (see "Since this grading").
- [x] `SRCH-011` **Result sections**: Notes, By meaning, Folders (6 at most, matched on the device), Tasks (8 at most, open tasks loaded lazily). Core: closed after the grading (see "Since this grading").
- [x] `SRCH-012` **Result rows**: glyph by type (file match, meaning sparkle, folder glyph, task box); highlighted title and snippet; meta line (space, folder, "In… Core: SearchHitRow (glyph, highlighted snippet, meta line).
- [x] `SRCH-013` **Opening a result**: a note opens, or opens at its block (`openNote` intent); a folder opens; a task opens its note at the block; a recent search… Core: closed after the grading (see "Since this grading").
- [x] `SRCH-014` **Offline fallback**: "Showing what's on this device. Folevi will search everything when it's back."; matches come from earlier answers and recent notes. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-015` **Empty states**: "Search your notes / Titles, words in notes, files and drawings."; "No results for "x"" with "Try without the filters." or "Try… Core: SearchScreen empty states.
- [x] `SRCH-016` **Palette field**: "Search documents or type a command…", with Folder, Tag and Updated pop-ups and the space name. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-017` **Palette before typing**: Recent (the notes opened last) plus the first 4 actions. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-018` **Palette results**: Documents, By meaning, "Searching…", "No documents match "x"."; notes open in a new tab. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-019` **Palette Ask Foli AI item**: "Ask Foli AI about your notes" or "Ask Foli AI: "x"" (⌘J); opens `/ai`. Core: palette "Ask Foli AI" (opens /ai, the text isn't passed).
- [x] `SRCH-020` **Palette actions**: New document (⌘⌥N hint), Go to Tasks · Today, Go to Calendar, Go to Reviews, Go to Changes, Go to Foli DNA (graph capability), Go… Core: closed after the grading (see "Since this grading").
- [x] `SRCH-021` **Palette keys**: ↑/↓ move, Return opens, Esc closes; pointer hover tracked. Core: palette ↑/↓, Return, Esc.
- [x] `SRCH-022` **Early keys**: keys typed after ⌘K are held until the field has focus, then replayed in order (an input method still composes, ⌘V pastes); 2 s… Core: closed after the grading (see "Since this grading").
- [n/a] `SRCH-023` **iOS early keys**: a hidden key catcher takes the typing. Why: iPhone/iPad only.
- [n/a] `SRCH-024` **iOS only: full-screen search**: Cancel button; Home's search entry with ⌘F. Why: iPhone/iPad only.
- [x] `SRCH-025` **Edit > Find…**: off a note, ⌘F focuses the sidebar search. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-026` **Palette gaps**: no scope choice (Everywhere, By meaning) and no Archived toggle; it shows only the space name. Core: closed after the grading (see "Since this grading").

### Command palette

- [x] `SRCH-027` **Open**: ⌘K (File > Open Quickly…), sidebar "Search or jump to…", top bar search, search links prefill the query; Mac shows it as a system… Core: ⌘K overlay (`Views/Common/CommandPalette.swift`).
- [x] `SRCH-028` **Early keys**: typing before the field has focus is held for it, never reaching the note. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-029` **Field**: "Search documents or type a command…". Core: palette field.
- [x] `SRCH-030` **Filters**: Folder (nested, indented, "Any folder"), Tag ("Any tag"), Updated ("Any time" + ranges), and the space. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-031` **Recent before typing**: notes opened last. Core: closed after the grading (see "Since this grading").
- [x] `SRCH-032` **Search results**: title, snippet, "Edited <relative>", "By meaning" section for semantic hits, "Searching…", "No documents match …"; opens in a new… Core: closed after the grading (see "Since this grading").
- [x] `SRCH-033` **Ask Foli AI row**: "Ask Foli AI about your notes" / "Ask Foli AI: …", hint ⌘J, only with AI capability (opens /ai; the typed text is not passed). Core: closed after the grading (see "Since this grading").
- [x] `SRCH-034` **Actions**: New document (⌘⌥N), Go to Tasks · Today, Go to Calendar, Go to Reviews, Go to Changes, Go to Foli DNA, Go to Home, Open Trash… Core: closed after the grading (see "Since this grading").
- [x] `SRCH-035` **Bug: Foli DNA action never hidden**: removal checks id "a:graph" but the action's id is "graph". Core: closed after the grading (see "Since this grading").
- [x] `SRCH-036` **Keys**: Up/Down move, Return opens, Escape closes, click opens. Core: palette keys and click.
- [x] `SRCH-037` **Menu bar Search Folevi…**: from the status item. Core: closed after the grading (see "Since this grading").

## Tasks

- [x] `TASK-001` **Six views**: Inbox (undated), Today, Upcoming, All, Completed, My Tasks, in the web's order with live counts. Core: `Views/Screens/PlannerScreens.swift` TasksScreen (tasks.list, tasks.counts).
- [n/a] `TASK-002` **View switcher, web look**: segmented control with count badges, tooltip "Every task lives in a note. Open its page to see the context it was written in.". Why: web look only.
- [x] `TASK-003` **View switcher, native look**: card glass segmented "Tasks views" with counts and the same help; selecting replaces the route `.tasks(view)`. Core: segmented view picker with counts.
- [x] `TASK-004` **Facts subtitle**: "<View> · N open" (Completed: "N done"), hidden count while loading, announced as updates-frequently. Core: closed after the grading (see "Since this grading").
- [n/a] `TASK-005` **Header buttons (web look)**: Calendar (opens `.calendar(nil)`) and Add task (tooltip "(⌘N)"). Why: web look only.
- [x] `TASK-006` **Add task button (native look)**: card glass "plus" button, help "Add task (⌘N)"; owner decision: no Calendar button in native look (sidebar row already there). Core: closed after the grading (see "Since this grading").
- [x] `TASK-007` **Filter field**: "Filter by task or page", matches task title or page title, case-insensitive, native look has a clear (x) button. Core: closed after the grading (see "Since this grading").
- [x] `TASK-008` **Sort order**: by due date, then due time, then newest change; Completed kept in the engine's order; rows edited away (`edits.isGone`) drop out… Core: the engine's groups and order.
- [x] `TASK-009` **Upcoming grouped by day**: day headings (long date, "No date" for undated), each group its own card. Core: engine groups shown as sections.
- [x] `TASK-010` **Loading state**: three placeholder rows until the list for the current view arrives. Core: closed after the grading (see "Since this grading").
- [x] `TASK-011` **Empty states per view**: Inbox "No undated tasks / Tasks without a due date land here."; Today "Nothing due today / Enjoy the quiet."; Upcoming "Nothing… Core: closed after the grading (see "Since this grading").
- [x] `TASK-012` **Filtered empty state**: "No tasks match that filter". Core: closed after the grading (see "Since this grading").
- [x] `TASK-013` **Keyboard: ⌘N**: opens Quick add task dialog. Core: closed after the grading (see "Since this grading").
- [x] `TASK-014` **Keyboard: ⌘F**: focuses the filter. Core: closed after the grading (see "Since this grading").
- [n/a] `TASK-015` **Keyboard: ⌘1 to ⌘6**: pick a view (note: collides with Go > Go to Tab ⌘1 to ⌘9 in ). Why: ⌘1 to ⌘9 pick a window tab in Core (native tabs), as the inventory notes the clash; views are one click in the segmented control.
- [x] `TASK-016` **Menu: Go > Today's Tasks ⌥⌘T, Go > Inbox**: open `.tasks(.today)` / `.tasks(.inbox)`. Core: closed after the grading (see "Since this grading").
- [x] `TASK-017` **Task row**: checkbox, title (struck and muted when done or canceled, "Untitled task"), page link with doc icon (hover underline, opens note)… Core: closed after the grading (see "Since this grading").
- [x] `TASK-018` **Row trailing facts**: priority badge (not "none"), repeat icon with the rule as tooltip, due label ("Overdue · " prefix in danger colour when past)… Core: TaskLine due (overdue red), repeat, reminder, priority colour.
- [x] `TASK-019` **Checkbox toggle with Undo**: open to done ("Task completed"), done to open ("Task reopened"), canceled to reopened; each toast has Undo. Core: closed after the grading (see "Since this grading").
- [x] `TASK-020` **Edit button on hover**: pencil button visible on row hover, opens Edit task. Core: closed after the grading (see "Since this grading").
- [x] `TASK-021` **Right-click task menu**: Mark as done / Mark as not done / Reopen, Edit task…, Move to…, separator, Open note. Core: closed after the grading (see "Since this grading").
- [x] `TASK-022` **Drag a task**: row drags its id as text (to Calendar days and hour slots). Core: closed after the grading (see "Since this grading").
- [x] `TASK-023` **Edit task dialog**: read-only title; Status (Open, Done, Canceled); Due date (popover month calendar); Clear / Clear date; Time (optional, "All day"… Core: closed after the grading (see "Since this grading").
- [x] `TASK-024` **Move task dialog**: "Move <title> to the end of another page", page picker excludes the current page, clearing means Inbox; toast "Task moved to… Core: closed after the grading (see "Since this grading").
- [x] `TASK-025` **Page picker (DocumentPicker)**: chosen page chip with x ("Add to Inbox instead"), field "Inbox, or search a page…" / "Search another page…", recent 6 pages when… Core: closed after the grading (see "Since this grading").
- [x] `TASK-026` **Date field + month popover**: field with clear (x), popover month grid, Previous/Next month, arrow keys move days, Clear button. Core: graphical date popover, Remove Due Date.
- [x] `TASK-027` **Time field + option list**: "All day" plus half-hour times, popover list with arrow keys. Core: closed after the grading (see "Since this grading").
- [x] `TASK-028` **Assignees only in workspaces**: members watched lazily when the place is a workspace. Core: closed after the grading (see "Since this grading").
- [n/a] `TASK-029` **Floating dialogs, not sheets**: PlannerPanel / PlannerDialog over the window, Escape closes the top one, click outside closes popovers. Why: native menus and popovers.
- [n/a] `TASK-030` **Debug hook**: notification `folevi.planner.show` opens quick/edit/move/menu on the first task (scripts). Why: Debug harness.
- [n/a] `TASK-031` **iPhone only: TasksScreen**: list with pull to refresh, hidden ⌘N "New task", More menu (Calendar, Completed tasks, Refresh). Why: iPhone only.
- [n/a] `TASK-032` **iPhone only: swipe actions**: leading Done / Reopen (full swipe), trailing Date and Tomorrow. Why: iPhone only.
- [n/a] `TASK-033` **iPhone only: context menu**: Mark as done / Reopen, Move to tomorrow, Details…, Open in note (with block id). Why: iPhone only.
- [n/a] `TASK-034` **iPhone only: TaskDetailSheet**: status toggle, inline DatePicker, Remove date, time picker, All day, priority picker, assignee picker, Done. Why: iPhone only.
- [n/a] `TASK-035` **iPhone only: view chips, note sections with fold, inline quick add field (⌘Return), keep-as-text chip, offline pending rows with Retry / Discard**. Why: iPhone only (Core has its own inline quick add with task.parse).

## Calendar

- [x] `CAL-001` **Layouts: Month, Week, Agenda**: remembered on this Mac (`folevi.mac.calendar.layout`), crossfade between them. Core: closed after the grading (see "Since this grading").
- [x] `CAL-002` **Layout switch**: web look segmented in the toolbar, native look card segmented "Calendar view". Core: closed after the grading (see "Since this grading").
- [x] `CAL-003` **Period heading**: "MMMM yyyy", "MMM d to MMM d yyyy", "Next 30 days"; short form for narrow windows ("Nov 2 to 8", "Nov 30 to Dec 6", "Dec 28 to… Core: closed after the grading (see "Since this grading").
- [x] `CAL-004` **Previous / Today / Next**: pages a month or week (hidden in Agenda); native look "Go to" actions after the title. Core: `Views/Screens/PlannerScreens.swift` CalendarScreen Previous, Today, Next.
- [n/a] `CAL-005` **Responsive toolbar**: one row, then compact (icons for Calendars and Subscribe), then two rows. Why: native toolbar.
- [x] `CAL-006` **Calendars button**: opens the subscriptions popover; red dot / badge and help "Calendars (one isn't loading)" when any subscription has an error. Core: closed after the grading (see "Since this grading").
- [x] `CAL-007` **Subscribe (tasks feed)**: "Subscribe" button (web look) or "Subscribe in Another Calendar…" in the "…" menu (native look); account mode only. Core: Calendars menu > Folevi Calendar Feed… (CalendarFeedSheet).
- [x] `CAL-008` **Month grid**: weekday header (VoiceOver full names), 6 weeks by 7, day numbers (today style, other-month dim), selected cell style, task chips… Core: CalendarScreen month grid (6x7, today, dimmed days, chips, +N).
- [x] `CAL-009` **Select a day**: click a cell; VoiceOver names full date, today, task and event counts. Core: click selects; VoiceOver reads the cell.
- [x] `CAL-010` **Drop a task on a day**: reschedules (keeps time) with highlight while targeted; finds the task in range, unscheduled or overdue lists. Core: closed after the grading (see "Since this grading").
- [x] `CAL-011` **Month task chip**: accent-soft when open, struck when done; click edits; draggable. Core: closed after the grading (see "Since this grading").
- [x] `CAL-012` **Event chip / row / block**: click opens the read-only event popover. Core: closed after the grading (see "Since this grading").
- [x] `CAL-013` **Event popover**: calendar colour and name, title ("Untitled event"), when, location with pin, scrolling selectable description, footnote "From a… Core: closed after the grading (see "Since this grading").
- [x] `CAL-014` **Arrow keys**: Left/Right one day, Up/Down one week; month or week follows the selection. Core: closed after the grading (see "Since this grading").
- [x] `CAL-015` **Day aside (Month)**: selected day's long date, its tasks (empty "No tasks due / Drag a task onto this day to schedule it."), Events list, hint "Drag… Core: CalendarScreen day aside (tasks and events).
- [x] `CAL-016` **Unscheduled tasks**: open undated tasks (first 8), each with "Schedule for today" / "Schedule for MMM d"; empty "Nothing unscheduled / Every open task… Core: closed after the grading (see "Since this grading").
- [x] `CAL-017` **Week header**: day name and number per column, today number in a pill. Core: closed after the grading (see "Since this grading").
- [x] `CAL-018` **All-day row**: untimed tasks and all-day events per day; dropping here keeps the date and clears the time. Core: closed after the grading (see "Since this grading").
- [x] `CAL-019` **Hour grid**: 52 pt hours, 12/24-hour labels per locale, today column tint, current-time line and clock label (updates every 60 s), opens an… Core: closed after the grading (see "Since this grading").
- [x] `CAL-020` **Timed blocks with overlap layout**: tasks as 30-minute blocks, events by their span, side by side when overlapping; click task edits, click event shows popover… Core: closed after the grading (see "Since this grading").
- [x] `CAL-021` **Drop to a half-hour slot**: dashed accent preview under the pointer, sets date and time. Core: closed after the grading (see "Since this grading").
- [x] `CAL-022` **Week hint**: "Drag a task to a time to set it, or to the all-day row to keep just the date. Select a task to edit it."; Unscheduled under the… Core: closed after the grading (see "Since this grading").
- [x] `CAL-023` **Agenda**: Overdue section (danger heading), next 31 days that have items plus today ("Today" label), "Nothing due.", tasks and events per… Core: closed after the grading (see "Since this grading").
- [x] `CAL-024` **Reschedule toast with Undo**: "Moved to Oct 30[, 09:00]", Undo restores date and time. Core: closed after the grading (see "Since this grading").
- [x] `CAL-025` **Data range follows layout**: tasks re-watched when the shown days change; completed included; events kept on the same days by CalendarModel. Core: CalendarScreen re-binds tasks.range and calendars.events on paging.
- [x] `CAL-026` **Calendars popover**: "Calendars you subscribe to by link show beside your tasks. They're read-only here. Turn one off to hide its events.", the list… Core: closed after the grading (see "Since this grading").
- [x] `CAL-027` **Subscription row**: colour dot, name (muted when hidden), host and "Loading…" / "Updated <relative>", error banner, Show switch (flips at once… Core: closed after the grading (see "Since this grading").
- [x] `CAL-028` **Edit a subscription**: Edit / Close, name field, colour picker (Cocoa, Moss, Marigold, Plum, Coral, Gray), Save, Refresh, Remove then confirm "Remove… Core: closed after the grading (see "Since this grading").
- [x] `CAL-029` **Add calendar**: URL ("https://… or webcal://…"), optional name, colour (cycles by count), Add on Return; cap message at 20 calendars. Core: `Views/Screens/PlannerScreens.swift` AddCalendarSheet (calendar.add).
- [x] `CAL-030` **Tasks feed dialog "Your tasks in your calendar"**: switch "Workspace tasks assigned to you" (Personal always in), Make a link / Make a new link, the link shown once with Copy and… Core: closed after the grading (see "Since this grading").
- [x] `CAL-031` **Menu: Go > Calendar ⌥⌘C**. Core: Go > Calendar (⌃⌘K, not ⌥⌘C).
- [n/a] `CAL-032` **Debug hook**: notification `folevi.calendar.layout` switches layout. Why: Debug harness.
- [x] `CAL-033` **Gap on Mac**: no ⌘T / ⌘Left / ⌘Right, no "new task on this day" (Quick Add's `due:` parameter exists but nothing passes it). Core: closed after the grading (see "Since this grading").
- [n/a] `CAL-034` **iPhone only: CalendarScreen**: Agenda / Three days / Month picker, Previous / Today / Next, ⌘T, ⌘Left, ⌘Right, ⌘N new task on the selected day, pull to refresh… Why: iPhone only.
- [n/a] `CAL-035` **iPhone only: swipe actions**: Done / Reopen, Date, Next day. Why: iPhone only.
- [n/a] `CAL-036` **iPhone only: CalendarsSheet**: rename alert, Colour menu, Refresh now, Remove (confirm and swipe). Why: iPhone only.
- [n/a] `CAL-037` **iPhone only: EventDetailSheet, AddTaskOnDaySheet, WeekStripView, MonthGridView, WeekGridView**. Why: iPhone only.

## Foli AI

- [x] `AI-001` **Availability gate**: when ai.capabilities says unavailable: "Foli AI is turned off" / "Set up Foli AI on this Mac" (Apple Intelligence or own OpenAI… Core: `Views/FoliAI/FoliAIScreen.swift` ChatView unavailable state (ai.capabilities).
- [x] `AI-002` **Routes**: `/ai` new chat, `/ai/<id>` a conversation; first question gives the chat its address in the same tab; tab title follows ("New… Core: `Model/Destination.swift` /ai and /ai/<id>; a new chat takes its id in place (window title stays "Foli AI").
- [x] `AI-003` **Threads list**: 264 pt column: New chat button, "Search conversations" field (native: system search field), Pinned then Recent headings (hidden… Core: FoliAIScreen conversations list (search, Pinned, Recent, empty).
- [x] `AI-004` **History off banner**: "History is off, so new conversations are deleted when you close them.". Core: closed after the grading (see "Since this grading").
- [x] `AI-005` **Thread row**: title ("New chat"), shared-with-workspace icon with tooltip, relative age that swaps to a "…" button on hover, active selection… Core: conversation row (title, shared icon, age, menu).
- [x] `AI-006` **Rename**: inline field, Return or blur saves, Escape cancels. Core: ChatActions.rename (ai.rename).
- [x] `AI-007` **Pin / Unpin**. Core: Pin / Unpin (ai.pin).
- [x] `AI-008` **Share with workspace…**: confirm dialog ("Members of this workspace can read … Files you uploaded stay private."), Stop sharing; disabled with reason in… Core: closed after the grading (see "Since this grading").
- [x] `AI-009` **Copy as Markdown**. Core: closed after the grading (see "Since this grading").
- [x] `AI-010` **Download Markdown**: NSSavePanel with the server's file name,.md. Core: Export as Markdown… (ai.exportMarkdown, save panel).
- [x] `AI-011` **Save as note**: (conversation or one answer). Core: Save as Note (ai.saveAsNote) for a chat or an answer.
- [x] `AI-012` **Delete…**: "Delete this conversation?" dialog, Cancel is the default (Return), Delete danger; deleting the open one returns to `/ai`; toast… Core: closed after the grading (see "Since this grading").
- [x] `AI-013` **Conversation options (header "…")**: same menu without Rename, Pin, Delete; native look puts it in the card's "…". Core: closed after the grading (see "Since this grading").
- [x] `AI-014` **Loading and missing states**: "Loading the conversation…", "This conversation isn't here anymore. Ask something to start a new one.". Core: closed after the grading (see "Since this grading").
- [x] `AI-015` **Intro "Meet Foli AI"**: lead text by context (folder, workspace, Personal), bullets (never changes a note without showing you; where data goes, local vs… Core: closed after the grading (see "Since this grading").
- [x] `AI-016` **Follow streaming, Jump to latest**: follows the answer unless you scroll up; "Jump to latest" button. Core: closed after the grading (see "Since this grading").
- [x] `AI-017` **Edit last question**: "Edit" on your last message, inline field, Cancel / Send, Escape cancels; re-asks. Core: closed after the grading (see "Since this grading").
- [x] `AI-018` **Pending question**: your text plus "Thinking…" until the message exists. Core: closed after the grading (see "Since this grading").
- [x] `AI-019` **Streaming answer**: phase status line with Stop (⌘.), progressive markdown, code blocks with Copy. Core: closed after the grading (see "Since this grading").
- [x] `AI-020` **Citations and sources**: [n] markers open the cited note or web page; Sources list (notes, web). Core: closed after the grading (see "Since this grading").
- [x] `AI-021` **Answer footer**: Copy / Copied (plain text), Regenerate (last answer), Export menu (Copy as Markdown, Download Markdown, Save as note for that… Core: closed after the grading (see "Since this grading").
- [x] `AI-022` **Failed answer**: "Try again" on the last one; "Stopped before it said anything.". Core: closed after the grading (see "Since this grading").
- [x] `AI-023` **Suggested follow-ups**: chips under the last answer. Core: suggestion chips.
- [x] `AI-024` **Agent mode: steps**: the run's step lines. Core: agent steps line.
- [x] `AI-025` **Agent mode: proposed changes card**: list of operations with tick boxes and a select-all toggle, "Nothing changes until you approve. A version of each note is saved… Core: `Views/FoliAI/FoliAIScreen.swift` AgentRunView (approve all or picked, discard).
- [x] `AI-026` **Agent mode: Undo**: Undo / Undoing… on applied runs. Core: AgentRunView Undo Changes (ai.agentUndo).
- [x] `AI-027` **Agent mode: Continue**: "Continue" when a run stopped, "Carries on from where it stopped.". Core: closed after the grading (see "Since this grading").
- [x] `AI-028` **Gap on Mac: undo conflict**: model sets `undoConflict` (notes changed after the edits) but only the iPhone shows "Undo anyway / Undo the rest / Cancel". Core: closed after the grading (see "Since this grading").
- [x] `AI-029` **Actions card**: Apply changes / Applying…, Not now, "Not applied."; toast "Changes applied.". Core: actions card (ai.actions).
- [x] `AI-030` **Memory card**: "Remember this for next time?" Save / Not now; "Saved to memory. You can change it in Settings > Foli AI.". Core: memory offer (ai.memory).
- [x] `AI-031` **Memory management**: list, edit, clear in Settings > Foli AI (MemoryCard), not on this screen. Core: closed after the grading (see "Since this grading").
- [x] `AI-032` **Research mode: progress**: "Researching…", steps, Cancel, "This can take a few minutes. You can leave; the report appears here when it's ready.". Core: `Views/Common/MoreSheets.swift` ResearchJobsView (ai.research steps, sources, Stop).
- [x] `AI-033` **Research mode: result**: Save as note / Open note, "Research cancelled". Core: ResearchJobsView Save Report as Note / Open Report (ai.researchSave).
- [x] `AI-034` **Gap on Mac: no Chat / Research switch and no Web toggle**: model has `mode` (persisted) and `web`; only the iPhone composer shows them; the Mac shows research copy only if the saved mode… Core: fixed in Core: mode picker (Auto, Ask, Agent, Research) and Web toggle.
- [x] `AI-035` **Problem notice**: error text, Buy more / Upgrade to billing. Core: closed after the grading (see "Since this grading").
- [x] `AI-036` **Credits low note**: "N left …", Buy more / Upgrade; account mode only. Core: closed after the grading (see "Since this grading").
- [x] `AI-037` **Context chips (attachments / what Foli AI reads)**: note chips, folder chip "In folder <name>", x removes. Core: closed after the grading (see "Since this grading").
- [x] `AI-038` **Add context menu**: Current folder (behind the floating chat), Recent notes (5), All notes / Workspace "Search everything here"; disabled once the… Core: closed after the grading (see "Since this grading").
- [n/a] `AI-039` **Gap on Mac: file attachments**: docs say chat uploads exist ( Attachments); no upload control in the Mac composer. Why: the engine has no chat upload command yet (ChatSendArgs.attachments has nothing to fill it from); it lands when the engine adds one.
- [x] `AI-040` **Composer**: grows 2 to 6 lines, Return sends, Shift-Return or Option-Return new line, placeholders ("Ask anything, or ask Foli AI to tidy or… Core: composer (1 to 8 lines, Return sends).
- [x] `AI-041` **Footnote**: "Foli AI can make mistakes." plus web and history-off notes, "AI policy" link. Core: closed after the grading (see "Since this grading").
- [x] `AI-042` **Ask Foli AI button (⌘J)**: floating button bottom-right on every page except a note and the AI page, tooltip "(⌘J)" / "Close Foli AI"; Go > Ask Foli AI ⌘J. Core: closed after the grading (see "Since this grading").
- [x] `AI-043` **Ask panel**: non-modal floating chat (max 640 pt), header "Foli AI", Conversation options, New chat, Open in full view (to `/ai/<id>`), Close… Core: closed after the grading (see "Since this grading").
- [x] `AI-044` **Model choice**: not on the chat; Settings > Foli AI provider select and own keys (local mode). Core: closed after the grading (see "Since this grading").
- [x] `AI-045` **Keep conversations switch**: Settings > Foli AI. Core: Settings > Foli AI "Keep chat history".
- [n/a] `AI-046` **Generate / drafts**: ai.generate and ai.saveDraft are used only by the iPhone/iPad templates "Generate with Foli AI" sheet (describe, Generate, Try… Why: iPhone/iPad only.
- [n/a] `AI-047` **iPhone only: FoliAIChatView**: header History/Back, New chat, Close; options menu Rename (alert), Save as note, Share… (ShareLink of transcript), Delete… Why: iPhone only.
- [n/a] `AI-048` **iPhone only: FoliHistoryView**: list with swipe Delete, context Rename / Delete. Why: iPhone only.
- [n/a] `AI-049` **iPhone only: composer**: Chat / Research segmented, Web chip, note picker search (FoliNotePicker), "Editing your question" banner with Cancel, Stop… Why: iPhone only.

## Foli DNA

- [x] `DNA-001` **Entry points**: sidebar row "Foli DNA" with saved views nested under it (`/graph?view=<id>`), Go > Foli DNA, ⌘K "Go to Foli DNA", note menu "Foli… Core: closed after the grading (see "Since this grading").
- [x] `DNA-002` **Not available state**: "Foli DNA isn't available here yet" (library on your devices). Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-003` **Route parameters**: `?note=` centre, `?depth=` 1 to 3, `?view=` applies a saved view. Core: closed after the grading (see "Since this grading").
- [x] `DNA-004` **Map / List switch**: remembered (`folevi.graph.view`); List shows NOTES and PEOPLE, PROJECTS AND TOPICS as rows, opens notes, "Nothing matches". Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-005` **Find in Foli DNA**: search field, "· N found" in the count, Return glides to the first match. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-006` **Count line**: "N notes, M more", plus found count. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-007` **Filter: folder**: "All folders" or one folder. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-008` **Filter: tag**: "Any tag" or one #tag. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-009` **Filter: edited**: any time, this week, this month, in 3 months (and longer). Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-010` **Colour by**: kind, folder, or tag (legend follows). Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-011` **Show menu**: "Show · N changed"; Foli AI's finds (on/off), "Similar and related lines", entity kinds with swatches (person, project… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-012` **Calm defaults**: fresh map hides unlinked notes and weak AI lines; banner notes "Showing the most recently edited notes." and the engine's note. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-013` **Empty states**: "No notes here yet", "Nothing matches these filters", "This note isn't on this map" with "Show the whole map". Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-014` **Play how it grew (time-lapse)**: play/stop button, disabled when all notes share a date. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-015` **Time-lapse bar**: play/pause ("Space"), track with ticks (weeks, months or years), date pill, first and last dates, "N of M notes", close (x); keys… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-016` **Layout panel**: Spacing (0.5 to 2) and "Pull to the middle" (0.25 to 3) steppers, "Reset layout" (also clears pins). Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-017` **Show the tips again**: "?" button restarts the three-step tour. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-018` **First-time tips**: "This is Foli DNA", "Move around and open notes", "Focus on one note"; Skip / Next / Got it; remembered. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-019` **Insights**: toggle (remembered); Hubs (top 10, click maps around), Clusters (click shows it, sparkles "Ask Foli AI to sum up <cluster>")… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-020` **Export menu**: Save as PNG, Save as SVG, Copy as Markdown ("Copied as Markdown"). Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-021` **Saved views menu**: "Save this view…" (prompt with name, "Around <note>" default, Cancel / Save), apply a saved view, "Remove <name>". Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-022` **Canvas gestures**: drag to pan, wheel or pinch to zoom, hover highlight, click a node opens its panel, double-click opens a note (⌘ for new tab) or… Core: drawn by the page; opening a note works when the engine page hosts it (an editor page's navigate.request isn't heard).
- [x] `DNA-023` **Zoom pill**: Zoom in, Zoom out, Fit to screen, Select notes / Stop selecting. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-024` **Keyboard on the map**: arrows move between nodes, + / = zoom in, - zoom out, 0 fit, Return opens (⌘Return new tab), Space shows the panel, Escape clears… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-025` **Multi-select**: Shift-click or Select mode, drag a box; bar with Move (Drafts or a folder), Bookmark, Tag (#tag menu), Ask Foli AI ("What… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-026` **Suggested link offer**: click a dashed suggested line: "Link A to B? Both mention … A Related: line goes at the end of the first note." Link them / Not… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-027` **Node panel**: why it's connected in words, connected notes listed, Open note, Map around this note, Show / Hide its connections, Close. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-028` **Around one note**: "Whole map" back button, "Around <note>" (click opens), "N connections, one step out. Click a note to see why."; Connections list… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-029` **Key (legend)**: dot colours, sizes and line styles actually drawn, foldable and remembered (narrow maps fold it). Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-030` **Map drawing**: clusters shaded and named with halo, bridges ringed, arrows optional, "New this week" glow, labels where room, entity shapes per… Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-031` **VoiceOver**: map summary label, each node named with kind and connection count. Core: drawn by the page's GraphView (web.show graph in `Views/Screens/LibraryScreens.swift` WebScreen).
- [x] `DNA-032` **Reviews page (spaced repetition)**: `/review` (or `/review?note=<id>` for one note's cards), Go to Reviews in ⌘K; facts "N to review" / "All caught up". Core: `Views/Screens/LibraryScreens.swift` WebScreen (web.show reviews); ?note= isn't passed.
- [x] `DNA-033` **Review card**: "Card X of N", "New" badge, front (title2), Show answer (Space or Return), back ("Nothing inside this card yet."), source note… Core: drawn by the page's ReviewView (web.show reviews).
- [x] `DNA-034` **Rate**: Again, Hard, Good (primary), Easy, each with its next interval; keys 1 to 4. Core: drawn by the page's ReviewView.
- [x] `DNA-035` **New cards a day**: No new cards, 10, 20, 30, 50, 100 (select in web look, pull-down in card). Core: drawn by the page's ReviewView.
- [x] `DNA-036` **Review empty states**: "Done for now" (reviewed count, later count), "Nothing to review", "This note isn't available". Core: drawn by the page's ReviewView.

## Vault

- [x] `VAULT-001` **Sidebar row**: shown only while vault.summary says a Vault exists here. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-002` **Sections**: Files & Notes, Passwords & Credentials, Health, Activity, People, Trash, Settings (icons per section); `/vault/<section>` links… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-003` **Tabs**: two main tabs as a capsule track, a section opened from "…" appears as a third pill with its close. Core: segmented section picker.
- [x] `VAULT-004` **Header**: "Locked" or "Open on this device · locks after N idle minutes", Lock button (tooltip "Lock the Vault"), "More in the Vault" menu… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-005` **No Vault here**: "This workspace's Vault is only for the people its owner or custodians add.". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-006` **Set up**: choose a passcode (PIN of 6, 8 or 12 digits; "Passcode length" choice, "Type it again", "The two don't match."). Core: closed after the grading (see "Since this grading").
- [x] `VAULT-007` **Passcode input**: digit boxes, autofocus, Return submits. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-008` **Unlock**: passcode field; errors inline. Core: VaultScreen unlock (vault.unlock), errors inline.
- [x] `VAULT-009` **Forgot passcode: recovery key reset**: "Vault recovery key" field plus a new passcode. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-010` **Ask a custodian**: "No recovery key? Ask a custodian". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-011` **Waiting for the key**: "You were added to this Vault. Its key reaches you when a custodian next opens the Vault…". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-012` **Finish passcode after a grant**: "A custodian shared the Vault's key with you. Choose the passcode…". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-013` **Passcode upgrade to PIN**: "Vault passcodes are now a PIN of 6, 8 or 12 digits…", old then new, Back. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-014` **Account encryption step (E2EE unlock)**: "Approve from another device", "Enter passphrase", "Enter recovery key", passkey note (use the browser), "Waiting for approval"… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-015` **Touch ID offer**: "Use Touch ID next time?" Use Touch ID / Not now. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-016` **Recovery key card**: shown until saved: the key, "Save as a file…", "I've saved it". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-017` **Files & Notes: browse folders**: folder list/cards, back button to the parent ("Files & Notes" at the top), item count in native look. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-018` **Files & Notes: Grid / Lines**: layout switch (remembered in the model). Core: closed after the grading (see "Since this grading").
- [x] `VAULT-019` **New folder**: prompt "Folder name", Cancel / Create. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-020` **New note**: prompt "Title". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-021` **Upload**: NSOpenPanel, "Encrypting…" while busy; also drag and drop files onto the section. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-022` **Files empty state**: "Nothing here yet / Upload files of any kind, or write a note. They're encrypted on this device before they leave it.". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-023` **Vault note dialog**: open, edit text, Save (only when changed), Share, Close. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-024` **File preview**: decrypted in memory: image, PDF (PDFKit), audio/video (AVKit), CSV table, text/code, else "This kind of file can't be shown… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-025` **Passwords list**: search field ("Search" title or detail), kind filter ("All kinds" plus kinds present), Add, rows with relative time, selection… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-026` **Passwords empty state**: "No passwords yet / Add logins, API keys, cards and other credentials…" or "Nothing matches". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-027` **Row right-click**: Open, Duplicate. Core: row menu Duplicate, Move to Trash (vault.item.duplicate, vault.item.remove).
- [x] `VAULT-028` **Item panel**: title, "<kind> · added by X, changed by Y", Earlier versions, Edit, Share, Move to the Vault's Trash; fields with label, secret… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-029` **TOTP (2FA code)**: code "123 456" refreshed each second with seconds left, Copy the code (logged "totp.copy"), "Not a 2FA secret Folevi can read.". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-030` **Add / Edit item dialog**: kind picker (Login, API key, Card, Bank account, Secure note, SSH key, Wi-Fi, Licence, Identity), Title "A name to find it by"… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-031` **Password generator**: Generate (random) and Memorable (passphrase) actions on password fields. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-032` **Strength meter**: live strength under the password. Core: closed after the grading (see "Since this grading").
- [x] `VAULT-033` **History / versions**: "Version N · editor · date", Bring back; empty "No earlier versions". Core: `Views/Common/MoreSheets.swift` VaultHistorySheet (vault.item.history, vault.item.restoreVersion).
- [x] `VAULT-034` **Share an item or note: with a person**: Email, duration for outsiders (1 day, 7, 30, 90 days, 1 year), Can view / Can edit, Share; list with Stop; local mode shows "Sign… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-035` **One-time link**: optional password (5+ chars), Works once / 2 / 3 / 5 / 10 times, for 1 hour / 1 day / 7 days / 30 days, Make link, Copy, list… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-036` **Health**: groups by issue (weak, reused, breached, expiring) with tone, count, body, items; "All healthy". Core: closed after the grading (see "Since this grading").
- [x] `VAULT-037` **Activity**: filter Everything / Unlocking and locking / Items / Files / Notes / People / Links / Sharing, "Failures only" toggle, rows actor… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-038` **People**: single-manager warning, Add (workspace member picker), "Everyone here should have access" (reviewed), rows with Owner label, role… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-039` **Trash**: rows with Restore, Empty Trash dialog "Everything in the Trash goes for good, for everyone in the Vault…" Cancel / Delete for… Core: closed after the grading (see "Since this grading").
- [x] `VAULT-040` **Settings**: Lock after 1, 2, 5, 10, 15, 30 minutes; Custodians can name custodians switch (owner); Change passcode… dialog (current then… Core: closed after the grading (see "Since this grading").
- [n/a] `VAULT-041` **Dialogs belong to a section**: switching section or leaving closes the open dialog. Why: native sheets close with their screen.

## Sharing, public links & invites

- [x] `SHARE-001` **Local mode gate**: "Sign in to Folevi to share and collaborate" dialog. Core: closed after the grading (see "Since this grading").
- [x] `SHARE-002` **Page Share dialog**: title "Share <note>", 480 pt, body scrolls when short, Loading… Core: closed after the grading (see "Since this grading").
- [x] `SHARE-003` **Invite by email**: email field, role select (Can view, Can comment, Can edit), Share (enabled with "@"). Core: closed after the grading (see "Since this grading").
- [x] `SHARE-004` **People with access**: avatar, name, Guest marker, role select, Remove (trash) for managers, Leave for yourself, "No one added directly."; toasts… Core: closed after the grading (see "Since this grading").
- [x] `SHARE-005` **Invited by email (page)**: pending rows with Revoke ("Invitation revoked"). Core: closed after the grading (see "Since this grading").
- [x] `SHARE-006` **Access mode**: Workspace ("Everyone in this workspace, by their role") or Only invited people ("Owners, admins, the creator and people added… Core: closed after the grading (see "Since this grading").
- [x] `SHARE-007` **Public link switch**: on makes a link, off revokes all; disabled when public links are off for Folevi ("Public links are temporarily turned off for… Core: closed after the grading (see "Since this grading").
- [x] `SHARE-008` **New link settings**: Expires (date field, "Never"), Password (optional, "None"), Look, "Let search engines find it" (off with a password or for… Core: closed after the grading (see "Since this grading").
- [x] `SHARE-009` **Link themes ("Look")**: Note (the note's own style), Article (serif, narrow), Docs (wide, contents beside), Minimal (plain paper, no cover); change on an… Core: closed after the grading (see "Since this grading").
- [x] `SHARE-010` **Existing links**: token hint "…/s/xxxx" when several, folded "Link settings (summary)", expiry and password shown read-only with tip "Set when the… Core: closed after the grading (see "Since this grading").
- [x] `SHARE-011` **Footer**: Copy link (the note's or folder's app link), Done. Core: closed after the grading (see "Since this grading").
- [x] `SHARE-012` **Folder Share dialog**: opened from the folder "…" menu "Share…", the folder page's Share button, People on a shared folder; what sharing reaches. Core: `Views/Sharing/SharingViews.swift` FolderSharingSheet from the folder menu and the folder page.
- [x] `SHARE-013` **Folder people**: role select, Remove, Leave ("You left the folder"); only folder owner and workspace owners/admins can share (else a note). Core: closed after the grading (see "Since this grading").
- [x] `SHARE-014` **Folder invite**: email and role. Core: FolderSharingSheet invite.
- [x] `SHARE-015` **From folders above**: read-only grants from parent folders ("From folder X"). Core: FolderSharingSheet inherited sections.
- [x] `SHARE-016` **Invited by email (folder)**: Revoke. Core: FolderSharingSheet Cancel invite.
- [x] `SHARE-017` **Open the shared folder**: link and "Public links are for single notes: share a note to make one.". Core: closed after the grading (see "Since this grading").
- [x] `SHARE-018` **Accept / decline invitations**: in the notifications panel (workspace, page, folder); see Notifications section. Core: `Views/Screens/PeopleScreens.swift` Accept and Decline (through notification.act).
- [x] `SHARE-019` **AI conversation sharing**: see Foli AI "Share with workspace…". Core: closed after the grading (see "Since this grading").
- [x] `SHARE-020` **Vault item sharing**: see Vault "Share an item or note". Core: closed after the grading (see "Since this grading").
- [x] `SHARE-021` **Gap on Mac: invite link landing**: no Mac screen for `/share-invite/<token>` (invite.preview, invite.acceptLink); only the iPhone InviteScreen ("Accept invitation"… Core: fixed in Core: `Views/Screens/LibraryScreens.swift` InviteScreen (invite.preview, invite.acceptLink, invite.decline).
- [n/a] `SHARE-022` **iPhone only: ShareScreen**: Who has access, Invite with role, People, Invited by email with Revoke, Public link (Expires, Look, search engines), view counts… Why: iPhone only.

## Templates

- [x] `TPL-001` **Templates list**: route `/templates`. File > "New Note from Template…" (⌥⇧⌘N) opens it. Core: `Views/Screens/LibraryScreens.swift` TemplatesScreen; File > New Note from Template (no ⌥⇧⌘N).
- [x] `TPL-002` **Built-in gallery**: "Built-in templates" in 1 to 3 columns, each with a pastel icon tile, name and description; a click creates and opens a note… Core: TemplatesScreen built-in strip (note.create with templateId).
- [x] `TPL-003` **Template icons**: 26 icon names with 10 tints. Core: closed after the grading (see "Since this grading").
- [x] `TPL-004` **"Your templates" heading**. Core: closed after the grading (see "Since this grading").
- [x] `TPL-005` **Count text**: "N built-in · N custom templates". Core: closed after the grading (see "Since this grading").
- [x] `TPL-006` **New template**: primary button (and a card control in the native look); creates and opens. Core: TemplatesScreen New Template (template.create) opens it.
- [x] `TPL-007` **Generate with Foli AI**: offered when the person can edit, AI is on and the device is online; button, or card "…" "Generate with Foli AI…". Core: closed after the grading (see "Since this grading").
- [x] `TPL-008` **Generate sheet**: "Generate a template", "What's the template for?", examples (Weekly team meeting, Project kickoff, Book notes, Trip planner)… Core: closed after the grading (see "Since this grading").
- [x] `TPL-009` **Template card and row "Use" button**: hidden in Trash. Core: closed after the grading (see "Since this grading").
- [x] `TPL-010` **Template menu**: New page from template, Edit template, Bookmark, Duplicate, Copy to…, Archive, Move to Trash. No Move to folder; no Select… Core: closed after the grading (see "Since this grading").
- [x] `TPL-011` **Templates empty**: "No templates of your own yet / Save any note as a template from its menu, or start from a built-in one above.". Core: empty state.
- [x] `TPL-012` **Save as template**: item in the note's own menu (iPhone note menu plan). Core: NoteMoreMenu Save as Template.

## Changes & proposals

- [x] `CHG-001` **Changes screen (Mac)**: header "Changes" with "N proposed · N notes changed since you last looked" or "Nothing new". Core: closed after the grading (see "Since this grading").
- [x] `CHG-002` **Local mode page**: the sign-in-to-collaborate page. Core: closed after the grading (see "Since this grading").
- [x] `CHG-003` **Proposed section**: heading plus "Changes connected apps want to make to your notes. Nothing changes until you accept.". Core: closed after the grading (see "Since this grading").
- [x] `CHG-004` **Proposal card**: title link (opens the note), "<source> proposed this <time>", summary, Accept (primary, hidden when there's a problem), Reject… Core: closed after the grading (see "Since this grading").
- [x] `CHG-005` **Proposal body**: the problem text (danger), or "You can't open this note, so its proposal isn't shown.", or the summary with a moss bar. Core: closed after the grading (see "Since this grading").
- [x] `CHG-006` **Proposal toasts**: "Added to "title"" and "Proposal rejected". Core: closed after the grading (see "Since this grading").
- [x] `CHG-007` **Mark all as seen**: shown when more than one note changed. Core: toolbar Mark All as Seen (changes.markSeen).
- [x] `CHG-008` **Changed note card**: title link, "who · time", counts, Open note, Mark as seen. Core: changed note rows (who, counts, open, Mark as Seen).
- [x] `CHG-009` **Inline diff (auto-loaded per note)**: up to 40 blocks; added text moss and underlined; removed text coral with strikethrough; word-level parts; headings sized; "Only… Core: closed after the grading (see "Since this grading").
- [x] `CHG-010` **Empty states**: "You're all caught up / When someone else changes a note you've opened…"; "Nothing else changed since you last looked." when only… Core: empty state.
- [x] `CHG-011` **Palette and sidebar entry**: "Go to Changes"; sidebar count. Core: closed after the grading (see "Since this grading").
- [n/a] `CHG-012` **iOS only: Show / Hide changes**: per-note toggle with a lazy diff query, spinner and error; swipe "Seen"; context menu Open / Mark as seen; optimistic removal… Why: iPhone/iPad only.
- [n/a] `CHG-013` **iOS only: ChangeDiffView**: +/−/~ marks, struck "before" text for changed blocks, who changed it, todo/bullet/number prefixes, "More changes are in the… Why: iPhone/iPad only.

## Drafts

- [x] `DRAFT-001` **Drafts list (`unsorted`)**: route `/drafts`; title "Drafts"; sidebar row with count. Core: `Views/Screens/NoteListScreen.swift` kind unsorted, route /drafts.
- [x] `DRAFT-002` **Drafts empty**: "No drafts / Everything has a folder. Nicely done." No New document button. Core: closed after the grading (see "Since this grading").
- [x] `DRAFT-003` **Manual order allowed**: Move up / Move down (and the iOS drag). Core: closed after the grading (see "Since this grading").
- [x] `DRAFT-004` **Leaves the list when moved into a folder**: `leavesList`. Core: the live list drops it.
- [x] `DRAFT-005` **Drafts as a move target**: shown first in every move picker; notes of a deleted folder go to Drafts. Core: `Views/Common/Menus.swift` MoveTargets lists Drafts first.

## Archive

- [x] `ARCV-001` **Archive list**: route `/archive`; List layout by default; sidebar row. Core: NoteListScreen kind archive.
- [x] `ARCV-002` **Archive / Unarchive**: from the menus or bulk; unarchiving inside Archive removes the note from the list. Core: NoteMenu and bulk Archive / Unarchive.
- [x] `ARCV-003` **Toasts with Undo**: "Archived (N notes)" / "Moved (N notes) out of Archive". Core: engine toasts with Undo (`Model/AppModel.swift` undo note.archive).
- [x] `ARCV-004` **Archive empty**: "Archive is empty / Archived notes rest here, out of your lists but never lost.". Core: empty state.
- [x] `ARCV-005` **No manual arrange in Archive**. Core: Manual is offered only for folders and Drafts.
- [x] `ARCV-006` **Search "Archived" filter**: archived notes are included only on request. Core: SearchScreen Archived toggle.

## Trash

- [x] `TRASH-001` **Trash list**: route `/trash`; List layout by default; sidebar row; palette "Open Trash". Core: NoteListScreen kind trash; palette Trash.
- [x] `TRASH-002` **Sort without Manual**: a saved Manual order becomes Last edited. Core: closed after the grading (see "Since this grading").
- [x] `TRASH-003` **Row time**: "Deleted <time ago>". Core: "Deleted …" on cards; the deletion date on rows.
- [x] `TRASH-004` **Trash row menu**: Restore, Select / Deselect, Delete permanently… Core: NoteMenu in Trash: Restore, Delete Immediately.
- [x] `TRASH-005` **Restore**: Undo puts the note back in Trash. Core: note.restore with the engine's Undo.
- [x] `TRASH-006` **Delete forever confirmation**: "Delete permanently?" / "Delete N notes permanently?" with the full warning text and a "Delete permanently" button (system alert… Core: `Views/Common/Menus.swift` deleteForever alert.
- [x] `TRASH-007` **Delete forever toast**: "N notes will be permanently deleted.", no Undo. Core: engine toast.
- [x] `TRASH-008` **Empty Trash button**: quiet button in the web toolbar; bordered "Empty Trash" in the native title row; "Empty Trash…" in the card "…" menu; shown only… Core: Empty Trash… toolbar button, off when empty.
- [x] `TRASH-009` **Empty Trash confirmation**: "Empty Trash? / N notes will be deleted for everyone…" with "Delete permanently". Core: `Views/Screens/NoteListScreen.swift` emptyTrash alert (trash.empty).
- [x] `TRASH-010` **Empty Trash toasts**: deleted; skipped ("couldn't be deleted. You may not have permission."); continuing ("being emptied in the background"). Core: engine toasts.
- [x] `TRASH-011` **Bulk in Trash**: Restore and Delete permanently… only. Core: selection menu in Trash: Restore, Delete.
- [x] `TRASH-012` **Trash empty state, and Move to Trash everywhere**: empty "Trash is empty / Deleted notes stay here for 30 days." Move to Trash shows "Moved to Trash" with Undo (`note.restore`)… Core: closed after the grading (see "Since this grading").

## Notifications / Inbox, Help & support

### Notifications / Inbox

- [n/a] `NOTIF-001` **Bell button**: "Notifications" in the tab strip (after the sync status), anchored panel; sidebar variant as a popover; badge from the live list. Why: replaced by the Notifications sidebar row with its badge.
- [x] `NOTIF-002` **Header**: "Notifications", Mark all read (dimmed when nothing unread), Notification settings (opens Settings > Notifications). Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-003` **Filter All / Unread**. Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-004` **Groups Today / Earlier**. Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-005` **Empty states**: "You're all caught up" / "No unread notifications", "Comments, replies, @mentions and pages shared with you show up here.". Core: empty state.
- [x] `NOTIF-006` **Row**: avatar initial, sentence by kind (comment / N comments, reply / N replies, mention, share, invite, share_change, else title)… Core: `Views/Screens/PeopleScreens.swift` NotificationLine (avatar, title, body, time, dot, icon); opening marks read.
- [x] `NOTIF-007` **Row "…" menu (hover)**: Mark as read / Mark as unread, Remove. Core: context menu Mark as Read / Unread, Remove.
- [x] `NOTIF-008` **Invitations in place**: Accept (workspace, page) or Accept and open (folder), Decline. Core: Accept and Decline (notification.act).
- [x] `NOTIF-009` **File-ready rows**: Download button in the shared content (sidebar popover). Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-010` **System notification actions**: reply / act from macOS notifications routed to the engine. Core: closed after the grading (see "Since this grading").
- [n/a] `NOTIF-011` **iPhone/sidebar content: swipe**: leading Read / Unread, trailing Remove, context menu. Why: iPhone/iPad only.

### Help & support

- [x] `NOTIF-012` **Help page**: Help > Folevi Help; card bar says "Help". Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-013` **Intro with links**: "folevi.com/docs" opens the guide (only the link words), support@ and security@ open mail. Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-014` **Support block**: account: "Your support requests" + "A person on the Folevi team reads every request…", button Contact support; local: "Support"… Core: `Views/Common/MoreSheets.swift` SupportSheet (support.topics, support.send) from Help > Contact Support.
- [x] `NOTIF-015` **Keyboard shortcuts table**: ⌘K search, ⌘N new note (Mac), ⌘⇧A quick add task, ⌘\ sidebar, ⌘⌥I inspector, ⌘⌥T Today, ⌘B/I/U, ⌘⇧X / ⌘E, ⌘⇧H, ⌘⌥0 to 3, ⌘⇧7/8/9… Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-016` **Help > Keyboard Shortcuts (⌘/)**: opens Help scrolled to the table. Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-017` **Save status meanings**: account (Saved, Saving…, Syncing…, Offline, Conflict, Not saved) and local library variants. Core: closed after the grading (see "Since this grading").
- [x] `NOTIF-018` **Help menu extras**: What's New, Send Feedback… Core: closed after the grading (see "Since this grading").

## Settings

### Window structure and sidebar order

- [x] `SET-001` **Window chrome**: its own NSWindow (SettingsNSWindow) with a transparent title bar, real traffic lights and an empty unified toolbar. Resizable… Core: SwiftUI Settings window (`Views/Settings/SettingsView.swift`).
- [x] `SET-002` **Layout**: a 220pt translucent sidebar holds the search field and the categories. Next to it is the page: a compact title in line with the… Core: sidebar of sections beside grouped forms (no search).
- [x] `SET-003` **Last category remembered**: stored in the defaults key `folevi.settings.section`. The default is "desktop" (General). Core: closed after the grading (see "Since this grading").
- [x] `SET-004` **Native page vs web fallback**: when the front main window has the native frame, the page is native: `MacSettingsShell` plus `MacSettingsNativePane` on that… Core: native panes; a few are the page's own (privacy, workspace, connected apps).
- [x] `SET-005` **Sidebar, account mode**: (and ). First group, no heading: General (desktop, moved to the top), Account, Foli AI, Plan & billing, Security, Privacy… Core: closed after the grading (see "Since this grading").
- [x] `SET-006` **Sidebar, local (library) mode**: General, Library, Foli AI, Appearance, Import & export. Core: closed after the grading (see "Since this grading").
- [~] `SET-007` **Workspace group**: (account mode, open space is a team workspace), headed by the workspace's name: General (page title "Workspace"), Members… Core: one web-drawn Workspace pane, not a group.
- [x] `SET-008` **Support group**: Help (an action, opens help), Contact support… (an action: in local mode it opens mailto:support@folevi.com, otherwise the help… Core: closed after the grading (see "Since this grading").
- [n/a] `SET-009` **App lock (this-device)**: iPad only. Inserted after Security when `frame.host.frameDeviceLock` exists. The Mac never lists it. Why: iPad only (Core has its own App Lock pane).
- [n/a] `SET-010` **Web-fallback sidebar**: (no native frame). Account mode: General, Account, Appearance, Notifications, Foli AI, Security, Privacy, Devices, Offline &… Why: Core never falls back to the web Settings sidebar.
- [x] `SET-011` **Section fallback**: asking for a section the current mode lacks shows Library in local mode, or the first section in account mode. A workspace's… Core: closed after the grading (see "Since this grading").
- [x] `SET-012` **Category SF Symbols**: desktop gearshape, account person.crop.circle, ai sparkles, billing creditcard, security checkmark.shield, privacy lock, devices… Core: Folevi's web icons per section (Foli AI keeps its mark).

### How the Settings window opens

- [x] `SET-013` **Folevi > Settings… (⌘,)**: menu command "app.settings". Core: SwiftUI Settings (⌘,).
- [x] `SET-014` **Menu bar icon > Settings…**. Core: closed after the grading (see "Since this grading").
- [x] `SET-015` **Any /settings route or link in a main window, plus the account menu and command palette**: these go through `frame.host.frameOpenSettings(section:)`. The main window shows "Settings are in their own window" with an "Open… Core: `Model/AppModel.swift` open(path:) sends /settings links to SettingsRouter.
- [x] `SET-016` **File > Import**: opens Import & export, or the workspace's Import & export when a workspace is open. Core: closed after the grading (see "Since this grading").
- [x] `SET-017` **Floating note window**. Core: ⌘, works from any window.
- [n/a] `SET-018` **iPad only**: a large form sheet with Done at the top (Escape or ⌘. also close it). Why: iPad only.

### Settings search

- [x] `SET-019` **Search field**: an NSSearchField with placeholder "Search", placed under the traffic lights. ⌘F focuses it. Return opens the active result, the… Core: closed after the grading (see "Since this grading").
- [x] `SET-020` **Results**: shown as a tree. Each category with matches is listed, with its matching cards and rows indented under it. When nothing matches… Core: closed after the grading (see "Since this grading").
- [x] `SET-021` **Index**: entries are tagged account-only (local false) or library-only (local true).. Searchable labels per section. Core: closed after the grading (see "Since this grading").
- [n/a] `SET-022` **Paragraph line breaks**: the web layout path (not the native look) asks the engine where the web wraps paragraphs. engine: run `text.lines` with args… Why: web layout path only.

### General (Mac app's own settings, id "desktop"; Mac only, both modes)

- [n/a] `SET-023` **Browser placeholder card "Folevi for Mac"**: shown when bridge is false. It says "You're using Folevi in a browser.". Why: browser only.
- [x] `SET-024` **Quick Add > Shortcut (recorder)**: click the pill, then press keys. While recording it shows "Press keys…" with an accent ring. Esc cancels. A key without ⌘, ⌥ or ⌃… Core: `Views/Settings/SettingsView.swift` ShortcutRecorder (Esc cancels; no hint for a bare key).
- [x] `SET-025` **Quick Add > Turn off**: shown when a shortcut is set. Clears it.. engine: run `desktop.set {quickAddShortcut: ""}`. Core: ShortcutRecorder Clear.
- [x] `SET-026` **Quick Add > Use <default>**: shown when the shortcut is not the default. Restores the default.. engine: run `desktop.set {quickAddShortcut: defaultShortcut}`. Core: closed after the grading (see "Since this grading").
- [~] `SET-027` **On this Mac > Open at login**: (switch, default on):. engine: run `desktop.set {openAtLogin: Bool}`. Core: This Mac > Open at login (LoginItem), off until you turn it on; today it starts on (left for the owner to decide for Core).
- [x] `SET-028` **On this Mac > Menu bar icon**: (switch, default on):. engine: run `desktop.set {menuBarIcon: Bool}`. Core: MacPane menu bar icon.
- [x] `SET-029` **On this Mac > Mac notifications**: (switch, default on): shows comments, mentions and reminders as notifications and puts a badge on the Dock icon.. engine: run… Core: MacPane Mac notifications.
- [x] `SET-030` **On this Mac > Show notes in Spotlight**: (switch, default on): only shown when the bridge reports spotlight. Locked and encrypted notes are never added.. engine: run… Core: MacPane toggle; `Host/Capabilities.swift` keeps Spotlight current.
- [n/a] `SET-031` **Failure toast**: "That setting couldn't be changed. Try again." and the switch reverts. Why: Core writes these settings locally; nothing to fail.

### Account (signed-in only)

- [x] `SET-032` **Profile picture: Upload… / Change…**: opens an NSOpenPanel for jpeg, png, webp or gif.. engine: command `settings.setAvatar(data: base64, mimeType, name)`. Core: AccountSettingsPane Change Picture (settings.setAvatar; webp and gif sent as jpeg).
- [x] `SET-033` **Profile picture: Remove**: shown only when there is an avatar.. engine: command `settings.removeAvatar`. Core: AccountSettingsPane Remove (settings.removeAvatar).
- [x] `SET-034` **Name**: (text field; Return or Save submits):. engine: command `settings.update(name:)`. Core: AccountSettingsPane name, Return saves (settings.update).
- [x] `SET-035` **Email**: (read-only, selectable): "Contact support to change it.". engine: view `settings.account`. Core: AccountSettingsPane email (no "contact support" hint).
- [x] `SET-036` **Time zone**: (searchable picker, saves at once): see the Time zone picker subsection.. engine: command `settings.update(timeZone:)`. Core: closed after the grading (see "Since this grading").
- [x] `SET-037` **Save**: (primary button): saves the name. Core: closed after the grading (see "Since this grading").
- [x] `SET-038` **Foli AI card**: (switch): disabled with a Core-plan message when AI is not included in the plan.. engine: view `settings.ai`, command… Core: closed after the grading (see "Since this grading").

### Time zone picker (Mac, Account > Time zone)

- [x] `SET-039` **Field**: a bordered pop-up-style button showing the zone's name and UTC offset (for example "Rio Gallegos, Argentina UTC−3"). It opens a… Core: closed after the grading (see "Since this grading").
- [x] `SET-040` **Popover**: a "Search time zones" field filters by city, area, region, offset (for example "+5:30") or id. The arrow keys move, Return picks… Core: closed after the grading (see "Since this grading").
- [n/a] `SET-041` **iPad and iPhone variant**: a plain select of identifiers. Why: iPhone/iPad only.

### Foli AI (account mode, signed-in)

- [x] `SET-042` **Foli AI**: (switch): the same AiSettingCard as Account. engine: command `settings.update(aiEnabled:)`. Core: AISettingsPane Foli AI switch.
- [x] `SET-043` **Conversations > Keep conversations**: . engine: command `settings.setAiPref(key: history)`. Core: AISettingsPane Keep chat history.
- [x] `SET-044` **How Foli AI works for you > Memory**: . engine: `settings.setAiPref(key: memory)`. Core: AISettingsPane memory.
- [x] `SET-045` **Suggestions**: . engine: `settings.setAiPref(key: suggestions)`. Core: AISettingsPane suggestions.
- [x] `SET-046` **Read attachments**: . engine: `settings.setAiPref(key: attachments)`. Core: AISettingsPane attachments.
- [x] `SET-047` **Web research**: (also turns on Research):. engine: `settings.setAiPref(key: webResearch)`. Core: AISettingsPane web research.
- [x] `SET-048` **Digests**: . engine: `settings.setAiPref(key: digests)`. Core: AISettingsPane digests.
- [x] `SET-049` **Search in images > Read text on your devices**: (on-device OCR, never disabled by plan):. engine: `settings.setAiPref(key: deviceText)`. Core: closed after the grading (see "Since this grading").
- [x] `SET-050` **Search in images > Read images with Foli AI**: (browser OCR, uses credits):. engine: `settings.setAiPref(key: readImages)`. Core: AISettingsPane read images.
- [x] `SET-051` **Memory card**: see the Memory card subsection. Core: closed after the grading (see "Since this grading").
- [x] `SET-052` **All AI pref keys**: (AiPrefKey): history, memory, suggestions, attachments, webResearch, digests, readImages, deviceText. EngineModels.swift:3867. Core: every AiPrefKey has a toggle.

### Foli AI (library mode)

- [x] `SET-053` **Foli AI**: (switch):. engine: convex.mutation `users.updateProfile {aiEnabled}`. Core: closed after the grading (see "Since this grading").
- [n/a] `SET-054` **On this device (not hosted)**: a message that the feature needs Folevi for Mac. Why: browser only.
- [x] `SET-055` **Checking spinner**: shown while not loaded. Core: ProgressView while loading.
- [x] `SET-056` **On <device> card**: Apple Intelligence on-device model status, read-only. Core: LocalAISettingsPane on-device card (settings.query localAi).
- [x] `SET-057` **Your own keys > per provider (OpenAI, Anthropic, Google) > Add key…**: shows a secure field "Paste your <provider> key" with Save, Cancel and a "Get a key from <provider>" link.. engine: run… Core: LocalAISettingsPane Add key (localAi.setKey).
- [x] `SET-058` **Your own keys > Test**: shown when a key is stored and can be tested. Shows "Your <provider> key works." or an error.. engine: run localAi.testKey… Core: LocalAISettingsPane Test Key (localAi.testKey).
- [x] `SET-059` **Your own keys > Remove**: . engine: run `localAi.removeKey {provider}`. Core: LocalAISettingsPane Remove Key (localAi.removeKey).
- [x] `SET-060` **Model > Provider**: (select): options are "Let Folevi pick" (auto) plus the usable providers among on-device, OpenAI, Anthropic and Google.. engine… Core: closed after the grading (see "Since this grading").
- [x] `SET-061` **Model > <Provider> model**: (select, with a note and an "Answering now: …" line):. engine: run `localAi.setChoice {provider, model}`. Models. Core: closed after the grading (see "Since this grading").
- [x] `SET-062` **Conversations > Keep conversations**: (switch):. engine: convex.mutation `users.updateProfile {aiPrefs:{history}}`. Core: closed after the grading (see "Since this grading").
- [x] `SET-063` **Memory card**: shown when the data's `memory` flag is true. Core: closed after the grading (see "Since this grading").

### Memory card (account and library Foli AI)

- [x] `SET-064` **Memory-off notice**: shown when memory is off. Core: closed after the grading (see "Since this grading").
- [x] `SET-065` **Add memory**: a kind select (Tone, Language, Length, Term, Instruction; default Instruction), a text field with a kind-specific placeholder and… Core: closed after the grading (see "Since this grading").
- [x] `SET-066` **Edit (pencil) and save (check)**: . engine: convex.mutation `aiMemory.update {id, kind, text}`. Core: closed after the grading (see "Since this grading").
- [x] `SET-067` **Delete (trash)**: . engine: convex.mutation `aiMemory.remove {id}`. Core: closed after the grading (see "Since this grading").
- [x] `SET-068` **Clear all**: (destructive confirm "Clear memory?"):. engine: convex.mutation `aiMemory.clear`. Core: closed after the grading (see "Since this grading").
- [x] `SET-069` **Item row**: shows "Only in <workspace>" when the memory is scoped to a workspace. Core: closed after the grading (see "Since this grading").

### Plan & billing (signed-in)

- [x] `SET-070` **Your plan > Plan, Storage, Devices**: (read-only terms). Tier names: Core, Pro, Pro AI, or "Free trial of …". Core: closed after the grading (see "Since this grading").
- [x] `SET-071` **Manage billing…**: only on paid plans, Mac only.. engine: convex.action `billing.portal`, then opens the returned URL. Core: closed after the grading (see "Since this grading").
- [x] `SET-072` **See plans…**: opens https://folevi.com/settings/billing in the browser. Mac only. Core: BillingPane opens settings/billing on the website.
- [n/a] `SET-073` **iPad**: shows "Plans are changed on the web, at folevi.com." in place of the buttons. Why: iPad only.
- [x] `SET-074` **Billing history**: (list of payments with dates): hidden in the iOS app. Core: closed after the grading (see "Since this grading").

### Security (signed-in)

- [x] `SET-075` **Sign-in methods**: (read-only): Password, Google, Apple, Passkey. Core: closed after the grading (see "Since this grading").
- [x] `SET-076` **Two-step verification > Status**: (On or Off), plus **Turn on / Manage two-step verification…**: shows a toast and opens https://folevi.com/settings/security.… Core: SecuritySettingsPane status and a button to the page's security screen.
- [x] `SET-077` **Passkeys**: (read-only list, or "No passkeys yet."). Core: closed after the grading (see "Since this grading").
- [x] `SET-078` **Delete account…**: (destructive). Confirm "Delete your account?" with the button "Schedule deletion" (7-day grace period).. engine: convex.mutation… Core: Delete Account… opens the page's delete screen in a window.

### Privacy (signed-in, Personal space)

- [x] `SET-079` **End-to-end encryption > Level**: (Standard or End-to-end encrypted) and **Status** (Locked or Open on this Mac), read from the session's spaces. Core: closed after the grading (see "Since this grading").
- [x] `SET-080` **Turn on end-to-end encryption… / Lock a folder…**: only navigates to /settings/privacy and shows a toast. It does not call any e2ee.* command. Core: Privacy is the page's own pane (web.show settings.privacy).

### Signed-in devices (signed-in)

- [x] `SET-081` **Connected devices > Devices connected**: ("n of limit"): read-only. Core: closed after the grading (see "Since this grading").
- [x] `SET-082` **Signed in > per session row**: label (" · This device" for the current one), client and last active time. Core: DevicesPane session rows.
- [x] `SET-083` **Signed in > Sign out**: (on sessions other than this one; no confirm):. engine: command `session.revoke(id:)`. Core: DevicesPane Sign Out (session.revoke).

### Connected apps (signed-in)

- [x] `SET-084` **Connected apps > Disconnect**: (per app, no confirm): engine: convex.mutation `mcp.revokeGrant {grantId}`. Core: the page's own Connected Apps pane (web.show settings.connectedApps).
- [x] `SET-085` **API tokens > Revoke**: (confirm "Revoke …?"): engine: convex.mutation `apiTokens.revoke {tokenId}`. Core: the page's own Connected Apps pane (web.show settings.connectedApps).
- [x] `SET-086` **API tokens > Token name + Create token**: scopes notes:read, notes:write, tasks:read, tasks:write; personal; no expiry. The token is shown once with a Copy button. engine… Core: the page's own Connected Apps pane (web.show settings.connectedApps).
- [x] `SET-087` **Webhooks > Enabled**: (switch per webhook): engine: convex.mutation `webhooks.setEnabled {webhookId, enabled}`. Core: the page's own Connected Apps pane (web.show settings.connectedApps).
- [x] `SET-088` **Webhooks > Send test**: engine: convex.mutation `webhooks.sendTest {webhookId}`. Core: the page's own Connected Apps pane (web.show settings.connectedApps).
- [x] `SET-089` **Webhooks > Remove**: (no confirm): engine: convex.mutation `webhooks.remove {webhookId}`. Core: the page's own Connected Apps pane (web.show settings.connectedApps).
- [x] `SET-090` **Webhooks > URL field + Add webhook**: the URL must start with https://. Events note.updated and task.updated. engine: convex.mutation `webhooks.create`. Core: the page's own Connected Apps pane (web.show settings.connectedApps).

### Appearance (both modes)

- [x] `SET-091` **Theme tiles**: Light ("Always light"), Dark ("Always dark"), System ("Matches macOS"; "Matches iPadOS" on iPad). Each tile is a thumbnail of the… Core: closed after the grading (see "Since this grading").
- [x] `SET-092` **Editor text size**: (slider): 0.85 to 1.35 in 0.05 steps (85% to 135%), labelled Smaller and Larger. Shows the % value and a "Notes read like this."… Core: AppearanceSettingsPane Note Text Size picker (editorZoom), no preview.

### Notifications (signed-in)

- [x] `SET-093` **Topic grid**: columns In app and Email, one switch each, per topic. engine: command settings.setNotificationTopic(topic, inApp:) or (topic… Core: NotificationSettingsPane topic toggles.
- [x] `SET-094` **Notifications on this Mac > Open General settings**: opens the General (desktop) section. Core: closed after the grading (see "Since this grading").
- [x] `SET-095` **Email delivery > Send comment emails**: (select): "As they happen" (off) or "In a daily digest" (daily).. engine: command settings.setNotificationEmails(digest… Core: closed after the grading (see "Since this grading").
- [n/a] `SET-096` **iPhone only**: a "News about Folevi" toggle. engine: `settings.setNotificationEmails(productEmail:)`.. The Mac has no such row. Why: iPhone only (Core shows it on the Mac too).

### Offline & sync (signed-in)

- [x] `SET-097` **This Mac > Connection, Changes waiting to sync, Notes kept, Space used, Downloading progress**: (read-only). Readings show "…" while measuring and "Unavailable" when they fail. Core: closed after the grading (see "Since this grading").
- [x] `SET-098` **Retry**: (shown when a reading is unavailable): re-watches `device.storage`. Core: closed after the grading (see "Since this grading").
- [x] `SET-099` **Keep all notes on this Mac**: (switch): hidden for an on-device library (available false), where a message says every note already opens offline.. engine… Core: closed after the grading (see "Since this grading").
- [x] `SET-100` **Download everything now**: . engine: command `device.download`. Core: OfflinePane Download Everything Now (device.download).
- [x] `SET-101` **Remove this Mac's copy…**: (destructive confirm, "Remove"):. engine: command `device.removeCopy(force: true)`. Core: closed after the grading (see "Since this grading").

### Library (local mode only)

- [x] `SET-102` **Where your library is > Syncs with, Location, Status, Last problem**: (read-only). Core: closed after the grading (see "Since this grading").
- [x] `SET-103` **Sync now**: . engine: run `library.syncNow`. Core: LibrarySection Sync Library Now (library.syncNow).
- [x] `SET-104` **Move library…**: a dialog of places. Options are Sync with iCloud, Sync with Dropbox, Sync with Google Drive (when available), Choose a folder and… Core: closed after the grading (see "Since this grading").
- [x] `SET-105` **Cloud connection > Connect**: (Dropbox or Google Drive), with a waiting spinner: engine: run `library.cloudConnect {provider}`. Core: closed after the grading (see "Since this grading").
- [x] `SET-106` **Cloud connection > Cancel**: (during sign-in): engine: run `library.cloudCancel`. Core: closed after the grading (see "Since this grading").
- [x] `SET-107` **Cloud connection > Sign out of <provider>…**: (confirm): engine: run `library.cloudSignOut`. Core: closed after the grading (see "Since this grading").
- [x] `SET-108` **Devices**: (read-only list of devices that open this library). Core: closed after the grading (see "Since this grading").
- [x] `SET-109` **Library health**: (read-only groups: Can't be read, Still downloading, Waiting for another device). Core: closed after the grading (see "Since this grading").
- [x] `SET-110` **Passphrase > Encrypt with a passphrase…**: dialog with Passphrase, Type it again and an "I understand" checkbox. The minimum length comes from the server. engine: run… Core: closed after the grading (see "Since this grading").
- [x] `SET-111` **Passphrase > Change passphrase…**: engine: run `library.changePassphrase {current, passphrase}`. Core: closed after the grading (see "Since this grading").
- [x] `SET-112` **Passphrase > Remove passphrase…**: (destructive): engine: run `library.removePassphrase {current}`. Core: closed after the grading (see "Since this grading").
- [x] `SET-113` **App lock > Lock with Touch ID**: (switch): disabled when unavailable. Turning it on or off prompts for Touch ID. engine: run `library.lock {lock: Bool}`. Core: `Views/Settings/SettingsView.swift` AppLockPane (MacAppLock in `Host/HostServices.swift`, started by shared Places).
- [x] `SET-114` **App lock > Ask again when you come back**: (select, shown when the lock is on): Right away, After 1 minute, After 5 minutes, After 15 minutes, After 1 hour (0, 60, 300… Core: AppLockPane Ask Again After (0, 60, 300, 900, 3600 s).
- [x] `SET-115` **Foli AI**: (link "Settings, under Foli AI"): opens /settings/ai. Core: Core has a Foli AI section in every mode.
- [x] `SET-116` **Folevi account > Sign in to Folevi…**: calls frameSignInAnotherAccount. Core: closed after the grading (see "Since this grading").
- [x] `SET-117` **Remove from this Mac (forget)**: (destructive confirm, "Remove"): engine: run `library.forget`. Core: closed after the grading (see "Since this grading").

### Import & export (both modes; Personal or workspace)

- [x] `SET-118` **Import into <space> > Choose files…**: accepts md, markdown, txt, zip, enex, docx, html, htm, csv, png, jpg, jpeg, gif, webp. Shows per-file results with warnings and… Core: the page's Import & Export screen in a window (SettingsWeb, web.show settings.data).
- [x] `SET-119` **Import a folder…**: recursive and keeps the folder paths (for example an Obsidian vault). Same engine call. Core: the page's Import & Export screen in a window (SettingsWeb, web.show settings.data).
- [x] `SET-120` **Supported sources**: (card text): Markdown, text, folder, ZIP, Obsidian vault, Notion export (Markdown & CSV ZIP), Evernote.enex, Word.docx, HTML, CSV. Core: the page's Import & Export screen in a window (SettingsWeb, web.show settings.data).
- [x] `SET-121` **Takeout > Import a takeout file…**: (zip): Personal only, not in the workspace variant. engine: run `takeout.import {files}`. Core: the page's Import & Export screen in a window (SettingsWeb, web.show settings.data).
- [x] `SET-122` **Export <space> (.zip)**: Markdown files, an assets folder and manifest.json, with a 400 MB cap. engine: convex.action exports.exportScope… Core: the page's Import & Export screen in a window (SettingsWeb, web.show settings.data).
- [x] `SET-123` **Workspace Import & export**: only when canManage. Same rows without Takeout. Core: Workspace Data… opens the page's screen (web.show settings.workspaceData).

### About (both modes)

- [x] `SET-124` **Version card title**: "Folevi <CFBundleShortVersionString>", with no build number. Core: UpdatesPane Version.
- [x] `SET-125` **Links**: (each opens folevi.com in the browser): What's new (/changelog), Privacy policy (/privacy), Terms of service (/terms), AI policy… Core: closed after the grading (see "Since this grading").
- [x] `SET-126` **Updates**: there is no update or "check for updates" row in Settings. Core: Core adds an Updates pane (Check for Updates).

### Support actions (both modes)

- [x] `SET-127` **Help**: frameOpenHelp, or /help in a main window. Core: closed after the grading (see "Since this grading").
- [x] `SET-128` **Contact support…**: mailto:support@folevi.com in local mode, otherwise the help or support form. No `support.send` call in these files. Core: closed after the grading (see "Since this grading").

### Workspace > General (workspace open)

- [x] `SET-129` **Workspace > Name + Save**: editable only with canManage. engine: convex.mutation `workspaces.rename {workspaceId, name}`. Core: the page's own Workspace pane (web.show settings.workspace in `Views/Settings/SettingsView.swift`).
- [x] `SET-130` **Leave workspace (owner)**: info only. The owner cannot leave and must transfer ownership first. Core: the page's own Workspace pane (web.show settings.workspace in `Views/Settings/SettingsView.swift`).
- [x] `SET-131` **Delete workspace…**: (owner only, destructive confirm, 7-day grace period): engine: convex.mutation `workspaces.scheduleDeletion {workspaceId}`. Core: the page's own Workspace pane (web.show settings.workspace in `Views/Settings/SettingsView.swift`).
- [x] `SET-132` **Leave workspace…**: (non-owner, destructive confirm "Leave"): engine: convex.mutation `workspaces.removeMember {workspaceId, profileId: self}`. Core: the page's own Workspace pane (web.show settings.workspace in `Views/Settings/SettingsView.swift`).

### Workspace > Members

- [x] `SET-133` **Invite people**: (admins only): an email field plus a role select with Admin, Member (member:edit, the default), Can comment and Can view.… Core: the page's own Workspace pane (web.show settings.workspace in `Views/Settings/SettingsView.swift`).
- [x] `SET-134` **Members > role select**: (admins only, not for the owner or yourself): engine: convex.mutation workspaces.changeRole {workspaceId, profileId, role… Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-135` **Members > Remove**: (confirm): engine: convex.mutation `workspaces.removeMember`. Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-136` **Invitations > Revoke**: (admins only): engine: convex.mutation `workspaces.revokeInvite {inviteId}`. Core: the page's own Workspace pane (web.show settings.workspace).

### Workspace > Privacy

- [x] `SET-137` **End-to-end encryption**: (Level, Status, and **Lock a folder… / Turn on…** only when the space's canLock is true): only navigates to… Core: the page's own Workspace pane (web.show settings.workspace).

### Workspace > Guests (canManage only)

- [x] `SET-138` **Make member**: engine: convex.mutation `workspaces.convertGuestToMember {workspaceId, profileId}`. Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-139` **Remove**: (no confirm): engine: convex.mutation `workspaces.removeGuest {workspaceId, profileId}`. Core: the page's own Workspace pane (web.show settings.workspace).

### Workspace > Plan & billing (owner only)

- [x] `SET-140` **Workspace plan > Plan, Members**: (billable seats), read-only. Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-141` **Manage billing…**: (Mac only): engine: convex.action `workspaceBilling.portal {workspaceId}`. Core: the page's own Workspace pane (web.show settings.workspace).

### App lock (this-device; iPad only, not Mac)

- [n/a] `SET-142` **Lock with Face ID / Touch ID / Optic ID / passcode**: (switch): uses `frameDeviceLock.set`. No engine call; it is a host-side setting. Why: iPad only.
- [n/a] `SET-143` **Ask again when you come back**: Immediately, After 1 minute, After 5 minutes, After 15 minutes. Uses `lock.setAfter`. Why: iPad only.
- [n/a] `SET-144` **AppLockSettings protocol**: (iPhone Privacy rows):. Its labels: Right away, After 1 minute, After 5 minutes, After 15 minutes. Why: iPhone only.

### Destructive flows (all sections)

- [x] `SET-145` **Delete account**: users.requestAccountDeletion. Core: Delete Account… opens the page's screen (web.show settings.deleteAccount).
- [x] `SET-146` **Delete workspace**: workspaces.scheduleDeletion. Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-147` **Leave workspace**: workspaces.removeMember on yourself. Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-148` **Remove member**: workspaces.removeMember. Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-149` **Remove guest**: workspaces.removeGuest. Core: the page's own Workspace pane (web.show settings.workspace).
- [x] `SET-150` **Remove this Mac's copy**: device.removeCopy(force: true). Core: closed after the grading (see "Since this grading").
- [x] `SET-151` **Remove library (forget)**: library.forget. Core: PlaceMenu forget (shared Places.forgetLibrary).
- [x] `SET-152` **Remove passphrase**: library.removePassphrase. Core: closed after the grading (see "Since this grading").
- [x] `SET-153` **Clear memory**: aiMemory.clear. Core: closed after the grading (see "Since this grading").
- [x] `SET-154` **Revoke API token**: apiTokens.revoke. Core: the page's own Connected Apps pane.
- [x] `SET-155` **Sign out other session**: session.revoke. Core: DevicesPane Sign Out.
- [x] `SET-156` **Sign out of cloud provider**: library.cloudSignOut. Core: closed after the grading (see "Since this grading").
- [x] `SET-157` **Confirm alert behaviour**: confirms are an NSAlert sheet. For destructive actions Cancel is the default. Core: closed after the grading (see "Since this grading").
- [x] `SET-158` **Sign out of this account**: not present in the Mac Settings window. The iPhone Account section has a "Sign out" button through host.signOut. The… Core: Core adds Sign Out of This Account (account.signOut) in Account.

### iPhone and iPad-only native settings (FoleviScreens, not the Mac window)

- [n/a] `SET-159` **Groups, account mode**: Account; General, Appearance, Notifications, Foli AI; Security, Privacy; Connected apps, Import & Export, Export Foli AI data… Why: iPhone/iPad only.
- [n/a] `SET-160` **Groups, local mode**: General, Appearance, Foli AI; Privacy; Import & Export; Help, About. Why: iPhone/iPad only.
- [n/a] `SET-161` **General > Review changes from connected apps**: (iPhone only, no Mac row): engine: view `settings.general`, command `settings.update(reviewAppEdits:)`. Why: iPhone only (Core shows it in General).
- [n/a] `SET-162` **Account > Plan, Storage, Devices**: (read-only), plus **Sign out**. Why: iPhone only.
- [n/a] `SET-163` **Notifications > Daily summary email**: (toggle) and **News about Folevi** (toggle). Why: iPhone only.
- [n/a] `SET-164` **Help > Folevi guides, Email support, save-status meanings, Keyboard shortcuts list**: (Mac or iPad). Why: FoleviScreens settings, not the Mac window.
- [x] `SET-165` **Connected apps, Data, AI export, Workspace data**: open as in-app web pages through `web.show`. Core: Core opens these with web.show (`Views/Settings/SettingsView.swift` WebSettingsPane, SettingsWebWindow).

## Quick Add

- [x] `QADD-001` **In-app Quick add task dialog**: File > Quick Add Task… ⌘⇧A, Tasks ⌘N / Add task; "Press Enter to add. Tasks without a page go to your Inbox page.". Core: closed after the grading (see "Since this grading").
- [x] `QADD-002` **In-app: title field**: "What needs doing?", empty submit says "Write the task first." (focus stays, VoiceOver announcement). Core: closed after the grading (see "Since this grading").
- [x] `QADD-003` **In-app: parsed date and repeat chips**: debounced 150 ms after 3+ chars; "Due tomorrow 9:00 from …", repeat label; x keeps the words as text. Core: closed after the grading (see "Since this grading").
- [x] `QADD-004` **In-app: fields**: Due date, Time (optional, only with a date), Priority, page picker (defaults to the current note when given). Core: closed after the grading (see "Since this grading").
- [x] `QADD-005` **In-app: Add task**: toast "Task added to <page or Inbox>" with Open. Core: closed after the grading (see "Since this grading").
- [x] `QADD-006` **Global floating panel**: File > Quick Add from Any App, menu bar "Quick Add Task…", global hotkey (default ⌥Space, configurable, Carbon… Core: `Views/QuickAdd/QuickAdd.swift` QuickAdd (Carbon hotkey, paused while recording; opens on the main screen, not the pointer's).
- [x] `QADD-007` **Panel field**: one growing field "New task", empty checkbox, destination at the end ("Inbox" or a page); first-use hint "Return adds it, ⌘Return… Core: closed after the grading (see "Since this grading").
- [x] `QADD-008` **Tokens as chips**: day/time, repeat, priority ("!high", "!!!", "!med", "!low", "!"), page ("#Atlas", `#"Two words"`); each chip has x to keep the… Core: closed after the grading (see "Since this grading").
- [x] `QADD-009` **Chip editors**: date (date and time fields), priority (segmented control), page (picker "Inbox, or search a page…"); Escape puts an editor away. Core: closed after the grading (see "Since this grading").
- [x] `QADD-010` **Place picker "Add to"**: pop-up of places (On this Mac library, accounts); choosing another reopens in that place. Core: closed after the grading (see "Since this grading").
- [x] `QADD-011` **Keys**: Return adds and closes, ⇧Return adds and stays for another, ⌘Return adds and opens its page in the main window, Escape closes. Core: closed after the grading (see "Since this grading").
- [x] `QADD-012` **Added confirmation**: "Added to <Inbox / page>" with Open for a moment. Core: closed after the grading (see "Since this grading").
- [x] `QADD-013` **Offline queue**: items that can't reach an engine wait in QuickAddQueue (JSON in Application Support, never from encrypted notes) and flush later… Core: closed after the grading (see "Since this grading").
- [n/a] `QADD-014` **Memory release**: panel page released 60 s after closing unless text or offline. Why: Core's panel is native, no page to release.
- [x] `QADD-015` **Menu bar status item**: Quick Add Task… (with the global shortcut), New Note, Search Folevi…, Recent Notes (⌘1 to ⌘8 while open, place subtitle), save… Core: closed after the grading (see "Since this grading").
- [n/a] `QADD-016` **iPhone only: QuickAddView**: Task / Note mode (⌘1 / ⌘2), ⌘Return open, ⇧Return keep open, Escape; graphical date picker, No date, time list, No time; priority… Why: iPhone only.

## System integrations

### URL scheme & deep links (list every folevi:// route and its handler)

- [x] `SYS-001` **folevi:// (empty)**: Opens `/documents`. Core: `Model/AppModel.swift` openLink (folevi-core:// opens Home).
- [x] `SYS-002` **folevi://new**: `showMain`, then the `new-note` command (handled natively by the frame as `FrameModel.newNote`). Core: closed after the grading (see "Since this grading").
- [x] `SYS-003` **folevi://quick-add**: `QuickAddPanel.toggle`, or the main window when Quick Add isn't set up. Core: closed after the grading (see "Since this grading").
- [x] `SYS-004` **folevi://d/<ULID or inbox-id>[#block-x | #comment-x | #x]**: Opens `/d/<ID>` with the hash kept. ULID `^[0-9A-Z]{26}$` (upper-cased); inbox `^inbox-[0-9a-z]{1,40}$`. Core: closed after the grading (see "Since this grading").
- [x] `SYS-005` **folevi://<page>[/a[/b]]**: Pages: documents, ai, tasks (for example tasks/today), calendar, inbox, settings, foli-ai, trash, templates, help, notes… Core: closed after the grading (see "Since this grading").
- [x] `SYS-006` **Link that launched the app**: Queued until launch finishes; the first link opens its own window directly. Core: closed after the grading (see "Since this grading").
- [x] `SYS-007` **folevi://auth/google**: The sign-in callback, consumed by the ASWebAuthenticationSession callback scheme `folevi` (not the Apple Event path). Core: shared ShellAuth (ASWebAuthenticationSession).
- [x] `SYS-008` **Website links (https://app.folevi.com/<app route head>)**: Open in the app. Heads: documents, notes, d, ai, graph, tasks, inbox, calendar, review, changes, daily, shared, vault, templates… Core: `Host/PageView.swift` Navigation and AppModel.openLink (Links.target).
- [x] `SYS-009` **app:// paths used internally**: `/native` (Page View), `/place-sync?place=<id>` (runner), `/quick-add?place=<id>` (web Quick Add)… Core: /native pages and shared runners; no /quick-add page (native panel).

### Services menu / Shortcuts & App Intents / Spotlight / Quick Look / Share / Drag & drop / Clipboard / Printing & PDF / Downloads / OCR / Call recorder / Login item / Notifications / App lock / Global hotkey & Quick Add / Floating notes

- [x] `SYS-010` **"New Folevi Note with Selection"**: Declared in Info.plist NSServices (NSMessage `newNoteWithSelection`; Debug title "New Folevi Dev Note with Selection"). Takes… Core: Info.plist NSServices and `Views/QuickAdd/QuickAdd.swift` ServicesProvider (text or RTF, not URLs).
- [x] `SYS-011` **NewNoteIntent "New Note"**: Parameter `text: String?`; openAppWhenRun. Empty text sends the `new-note` command; otherwise `new-note-with-text` (60 s timeout). Core: `App/Intents.swift` NewNoteIntent.
- [x] `SYS-012` **AddTaskIntent "Add a Task"**: Parameters `text: String` (prompt "What do you need to do?") and `due: Date?` (sent as YYYY-MM-DD). Sends `add-task` (engine… Core: `App/Intents.swift` AddTaskIntent (due date, "Added to …" dialog).
- [x] `SYS-013` **OpenNoteIntent "Open Note"**: Parameter `note: NoteEntity`; openAppWhenRun. Opens through `Spotlight.open(identifier:)`. Core: `App/Intents.swift` OpenNoteIntent.
- [x] `SYS-014` **NoteEntity and NoteQuery**: Entity `{ id, title, location }`. The query is an EntityStringQuery over the current place's Spotlight notes (title contains)… Core: `App/Intents.swift` NoteEntity and NoteQuery (search and recent of the open place).
- [x] `SYS-015` **FoleviMacShortcuts (AppShortcutsProvider)**: Phrases. Core: `App/Intents.swift` FoleviCoreShortcuts (plus Search Notes).
- [~] `SYS-016` **Capabilities.ask / answer**: Sends a command with a UUID id to the front main page (opening one if needed, waiting up to 30 s for load) and waits for… Core: `Host/Capabilities.swift` answers commandDone; there is no native ask yet.
- [x] `SYS-017` **What is indexed**: Every note of every place, archived included. Locked and E2EE notes are never indexed. CSSearchableItem with contentType text. Core: `Host/Capabilities.swift` indexSpotlight (the page leaves locked and encrypted notes out).
- [x] `SYS-018` **Domains and ids**: Domain `com.folevi.notes.[runTag.]<place>`. Identifier `<place>\u{1F}<noteId>`. indexVersion 2 (a change forces a full reindex).… Core: closed after the grading (see "Since this grading").
- [x] `SYS-019` **Sync protocol with the page**: `spotlightState` returns stamps. `indexSpotlight` takes at most 50 changed items, then `keep` (every id) for pruning, plus… Core: closed after the grading (see "Since this grading").
- [x] `SYS-020` **Forgetting**: On sign-out or forget-library (`forget(place:)`). Settings "Show notes in Spotlight" off runs `forgetAll`. `prune` runs on switch… Core: closed after the grading (see "Since this grading").
- [x] `SYS-021` **Opening a result**: `application(_:continue:)` for CSSearchableItemActionType goes to `open(identifier:)`, which waits for launch. Same place… Core: `App/FoleviCoreApp.swift` onContinue opens the note, switching place when needed.
- [x] `SYS-022` **quickLook**: Writes the page's file bytes (up to 20 files, 200 MB each) to tmp "Folevi Quick Look/<uuid>" and opens QLPreviewPanel. The web… Core: `Host/Capabilities.swift` quickLook.
- [x] `SYS-023` **share from the page**: NSSharingServicePicker next to a page rect, a point or the pointer. Objects: a URL, else the text as a file (`fileName`), else… Core: `Host/Capabilities.swift` share.
- [x] `SYS-024` **File > Share submenu**: Lists the services that take the key window's note. `setShareTarget` holds the per-view target. Asks the page for the `share`… Core: closed after the grading (see "Since this grading").
- [n/a] `SYS-025` **Fallback File menu**: Share and Print (⌘P) before MainMenu exists. Why: SwiftUI builds the menu bar.
- [x] `SYS-026` **dragFile (Export dialog)**: An NSFilePromiseProvider for one Markdown file, started from the last mouse event. Core: `Host/Capabilities.swift` dragFile.
- [n/a] `SYS-027` **dragNotes (web cards and rows)**: The page declares which notes a drag carries. When WebKit starts the drag, the items become file promises that also keep WebKit's… Why: Core draws note cards and rows natively (their drags carry Markdown files through NoteFiles); the page has no card or row drags of its own in Core.
- [x] `SYS-028` **Native list drags**: SwiftUI `NoteDragItem` (UTType `foleviNoteRef`). The drag pasteboard is watched while the mouse is down; outside Folevi's windows… Core: closed after the grading (see "Since this grading").
- [n/a] `SYS-029` **Drag image hook**: Swizzles `dragImage:at:offset:...` and `beginDraggingSession`. Why: a detail of today's drag path; Core starts its own drag sessions.
- [x] `SYS-030` **Drag and drop in**: No native drop handling; the page and WebKit take drops. The open panel is used for file inputs. Core: the page takes drops; `Host/PageView.swift` runOpenPanel for file inputs.
- [x] `SYS-031` **clipboardRead / clipboardWrite**: `{ text, html, image (PNG b64) }`, 20 MB each, for Folevi's own context menus (avoids WebKit's "Paste" bubble).… Core: `Host/Capabilities.swift` clipboard handlers.
- [x] `SYS-032` **window.print() hook**: Private WKUIDelegate `_webView:printFrame:pdfFirstPageSize:completionHandler:` and `_webView:printFrame:` use… Core: shared Printing.swift extends Core's Navigation with the print() hook.
- [x] `SYS-033` **File > Print (⌘P)**: Asks the page for the `print` command (its print layout). When not handled and not framed, `printPage`. Beeps unless a note is on… Core: File > Print (⌘P) on a note; disabled elsewhere.
- [x] `SYS-034` **WKDownload**: `<a download>` and blob/data/https/app links, non-showable MIME types and Content-Disposition attachment become downloads.… Core: shared Downloads.swift (Navigation extension, save panel).
- [x] `SYS-035` **recognizeText**: Vision `VNRecognizeTextRequest`, accurate, language auto-detected, language correction off for handwriting. One image at a time… Core: `Host/Capabilities.swift` recognizeText.
- [x] `SYS-036` **CallRecorder**: ScreenCaptureKit system audio (`capturesAudio`, `excludesCurrentProcessAudio`, picture discarded) plus AVAudioEngine microphone… Core: `Host/Capabilities.swift` call handlers over the shared CallRecorder.
- [x] `SYS-037` **Open at login**: `SMAppService.mainApp` register/unregister, only when the setting changes, on a utility queue. Never in Debug, FOLEVI_USER_DATA… Core: shared LoginItem, applied on change (`App/FoleviCoreApp.swift`); Core's default is off.
- [x] `SYS-038` **Categories and actions**. Core: closed after the grading (see "Since this grading").
- [x] `SYS-039` **Category mapping**: From the server kind: remind or due goes to reminder; assign or task goes to task; mention, comment or reply with a thread goes… Core: closed after the grading (see "Since this grading").
- [x] `SYS-040` **post**: Asks authorization on first use. Subtitle is the place label when there are several places. `threadIdentifier` is `note-<thread>`… Core: closed after the grading (see "Since this grading").
- [x] `SYS-041` **Foreground presentation**: Only reminders (`local-reminder` or the reminder category) show a banner, sound and list; activity goes to the in-app bell. Core: closed after the grading (see "Since this grading").
- [x] `SYS-042` **Responses**: The default action or "open" runs `Chrome.open(path, place)`, switching place if needed. Other actions send a `notification`… Core: `App/FoleviCoreApp.swift` NotificationDelegate opens the path, switching place (default action only).
- [x] `SYS-043` **MacAppLock**: `{ lock, lockAfter }` in the support folder. "Ask again" choices: 0, 60, 300, 900, 3600 s. Method: touchID, or none on a Mac… Core: `Host/HostServices.swift` MacAppLock (in defaults, not the support folder).
- [x] `SYS-044` **Triggers**: Windows open covered at launch. It locks on `NSWorkspace.willSleep`, `sessionDidResignActive` and the `com.apple.screenIsLocked`… Core: closed after the grading (see "Since this grading").
- [x] `SYS-045` **Cover**: LockCoverView (SwiftUI WebLockCover) over each window's content. It swallows hit tests and key equivalents; Return or Space… Core: closed after the grading (see "Since this grading").
- [x] `SYS-046` **AppLock.confirm(reason:)**: Called by E2eeKeys before encrypted notes open; a yes covers 30 s. Core: closed after the grading (see "Since this grading").
- [x] `SYS-047` **HotKey**: Carbon `RegisterEventHotKey` (no Accessibility permission), signature "FOLV". Electron accelerator syntax; default "Alt+Space"… Core: `Views/QuickAdd/QuickAdd.swift` Carbon hotkey "FOLV"; no "already in use" error.
- [x] `SYS-048` **QuickAddPanel**. Core: `Views/QuickAdd/QuickAdd.swift` QuickAddPanel.
- [x] `SYS-049` **Quick Add place and page**: The page loads `/quick-add?place=<id>`, or with the native frame a hidden `/native` Page View with its own EngineClient plus a… Core: closed after the grading (see "Since this grading").
- [x] `SYS-050` **Entry points**: The hotkey, the status item, the Dock menu, `folevi://quick-add`, and menu `file.quick-add-task`. Core: closed after the grading (see "Since this grading").
- [x] `SYS-051` **Float Note**: A note in its own NSPanel (380x480), its own Page View in native chrome mode and its own EngineClient (MacEngineTransport). The… Core: closed after the grading (see "Since this grading").
- [x] `SYS-052` **Spelling, Learn, Ignore, Look Up**: NSSpellChecker with a per-view document tag; the page's context paragraph is used to pick the language; up to 8 guesses. Learn… Core: closed after the grading (see "Since this grading").
- [x] `SYS-053` **DesktopSettings**: Defaults key `folevi.desktop.settings`. Fields: quickAddShortcut "Alt+Space", openAtLogin true, menuBarIcon true, notifications… Core: `Host/DesktopRouter.swift` DesktopSettings (same key; openAtLogin defaults to off).

### App lock screen

- [x] `SYS-054` **Lock cover**: logo, lock tile, "Folevi is locked", "Your notes stay covered until Touch ID says it's you.", "Unlock with Touch ID"., used at. Core: `Views/MainWindow.swift` LockCover (no logo or subtitle).
- [x] `SYS-055` **When it locks**: at launch when on; on sleep, screen lock and session resign; after being away longer than "Ask again" (0, 60, 300, 900, 3600 s)… Core: closed after the grading (see "Since this grading").
- [x] `SYS-056` **Unlock**: Touch ID with a "Use Password" fallback; one prompt at a time; uncovers by itself if Touch ID goes away. Core: closed after the grading (see "Since this grading").
- [x] `SYS-057` **Changing the lock**: turning it on or off asks for Touch ID; errors "unavailable" / "cancelled"; saved in. Core: MacAppLock.setSettings asks Touch ID.
- [x] `SYS-058` **Cover behaviour**: takes the keyboard (keys and shortcuts swallowed), can move the window, restores the keyboard owner afterwards. Core: closed after the grading (see "Since this grading").
- [x] `SYS-059` **Encrypted notes confirmation**: `AppLock.confirm(reason:)`; one yes covers 30 s. Core: closed after the grading (see "Since this grading").
- [n/a] `SYS-060` **Settings protocol and words**: `AppLockSettings` (method, enabled, after); `AppLockWords` (Face ID, Touch ID, Optic ID, Passcode; "Lock with …"; Right away /… Why: iPhone/iPad words.

## Context menus

- [n/a] `CTX-001` **Tab right-click**: (; none on Home): Pin tab / Unpin tab; Unjoin notes (2) or Unjoin all notes (3); Float note / Show floating note (Mac, single… Why: macOS tab menu.
- [n/a] `CTX-002` **Legacy tab strip menu**: (legacy, ): Close Tab, Close Other Tabs, Close Tabs to the Right, separator, Open in New Window. Why: legacy.
- [x] `CTX-003` **Folder menu**: ("…" and right-click in sidebar rows, folder cards, Folders page, folder page. Core: closed after the grading (see "Since this grading").
- [x] `CTX-004` **Tag menu**: : Edit tag…; Color: Cocoa / Moss / Marigold / Plum / Coral / Gray (excluding the current one); separator; Delete tag… (danger). Core: closed after the grading (see "Since this grading").
- [x] `CTX-005` **Sidebar folder sort menu**: : heading "Sort folders"; Manual; Name; Recent (checked). Core: closed after the grading (see "Since this grading").
- [n/a] `CTX-006` **Sidebar menu**: : Hide sidebar / Show sidebar (⌘\); Focus mode / Exit focus mode; on a note: separator, Show folders, Show document (checked). Why: native sidebar toggle.
- [x] `CTX-007` **Account menu**: (, system NSMenu ): # Places; the open account; its workspaces (indented, plan badge, check); New workspace…; other accounts… Core: closed after the grading (see "Since this grading").
- [x] `CTX-008` **Anywhere menu**: (right-click with no owner, not over the note page. Core: closed after the grading (see "Since this grading").
- [x] `CTX-009` **Text field menu**: : spelling guesses (up to 5) or "No guesses found"; Learn spelling; Ignore spelling; separator; Look up "word"; separator; Cut… Core: system menus on native fields; the page's menu gets spelling from DesktopRouter.
- [x] `CTX-010` **Note card menu**: ("…" and right-click. Core: closed after the grading (see "Since this grading").
- [x] `CTX-011` **Selection menu / bar**: (several selected. Core: closed after the grading (see "Since this grading").
- [x] `CTX-012` **List screen "…" (card controls)**: : Templates: Generate with Foli AI…, New template button; Trash: Empty Trash… (danger); Folder page: the folder menu. Engine… Core: closed after the grading (see "Since this grading").
- [x] `CTX-013` **Folder page path pull-down**: : current folder (checked, swatch); each ancestor (swatch); All folders. Core: closed after the grading (see "Since this grading").
- [x] `CTX-014` **Card controls Sort pull-down**: : heading "Sort by"; options (current ticked). Layout segments become a pull-down when space is short. Core: toolbar Sort menu.
- [n/a] `CTX-015` **Legacy sidebar row menus**: (legacy, ). Folder: Open in New Tab, Open in New Window, separator, New Note Here, New Folder Inside, Move to Top Level. Folders… Why: legacy.
- [n/a] `CTX-016` **Legacy note "..." menu**: (legacy, ): Bookmark/Remove bookmark; Move to…; Copy to…; Duplicate; separator; Export…; Version History…; Present; Print…; Find… Why: legacy.
- [n/a] `CTX-017` **iPhone note "..." menu**: (iPhone, ). Top: Bookmark/Remove bookmark (own notes), Info, Find in note… or Find and replace…, Review N cards in this note /… Why: iPhone only.

## Menus & keyboard shortcuts

### Folevi (app) menu

- [x] `MENU-001` **About Folevi**: `app.about`: standard About panel (`showAboutPanel:`). Core: standard About.
- [x] `MENU-002` **Check for Updates…**: `app.check-for-updates`: `Chrome.checkForUpdates` (Sparkle); disabled in Debug builds and while a check runs… Core: `App/AppCommands.swift` Check for Updates (shared Updater).
- [x] `MENU-003` **Settings…**: ⌘, `app.settings`: opens the Settings window (`SettingsWindow.shared.show`, MainMenu.swift:206). Core: SwiftUI Settings (⌘,).
- [x] `MENU-004` **Services**: submenu: system Services menu (Folevi registers "New Folevi Note with Selection", see Capabilities). Core: system Services menu.
- [x] `MENU-005` **Hide Folevi**: ⌘H `app.hide`, **Hide Others** ⌥⌘H `app.hide-others`, **Show All** `app.show-all`, **Quit Folevi** ⌘Q `app.quit`: standard. Core: standard app menu.

### File

- [x] `MENU-006` **New Note**: ⌘N `file.new-note`: `FrameModel.newNote`: creates in the folder on screen, else Drafts, opens in a new tab; engine `note.create`. Core: `App/AppCommands.swift` New Note (⌘N), in the folder on screen (same window).
- [x] `MENU-007` **New Note from Template…**: ⌥⇧⌘N `file.new-from-template`: opens the Templates list (`/templates`). Core: closed after the grading (see "Since this grading").
- [x] `MENU-008` **New Folder**: ⌃⌘N `file.new-folder`: `FrameModel.newFolder`: new folder dialog; engine `folder.create`. Core: closed after the grading (see "Since this grading").
- [x] `MENU-009` **Quick Add Task…**: ⇧⌘A `file.quick-add-task`: in-window Quick Add dialog over this window (`showQuickAdd(in:)`); engine `task.parse`, `task.create`. Core: closed after the grading (see "Since this grading").
- [x] `MENU-010` **Quick Add from Any App**: `file.quick-add-anywhere`: shows the global floating Quick Add panel; its key equivalent is the user's global shortcut from… Core: closed after the grading (see "Since this grading").
- [x] `MENU-011` **New Tab**: ⌘T `file.new-tab`: opens Home in a tab and focuses the sidebar search. Core: closed after the grading (see "Since this grading").
- [x] `MENU-012` **New Window**: ⇧⌘N `file.new-window`: a new main window (MainMenu.swift:209). Core: New Window (⇧⌘N).
- [x] `MENU-013` **Open Quickly…**: ⌘K `file.open-quickly`: focuses the sidebar search / command palette (same as Search All Notes and Go > Search…). Core: Edit > Command Palette… (⌘K).
- [x] `MENU-014` **Close Tab**: ⌘W `file.close-tab`: closes the active tab; on the Home tab it closes the window. Core: macOS Close Tab (⌘W).
- [x] `MENU-015` **Close Window**: ⇧⌘W `file.close-window`: `performClose:`. Core: macOS Close Window.
- [x] `MENU-016` **Reopen Closed Tab**: ⇧⌘T `file.reopen-closed-tab`: enabled only when the closed-tab stack is not empty. Core: closed after the grading (see "Since this grading").
- [n/a] `MENU-017` **Show All Tabs**: ⇧⌘\ `file.tab-overview`: toggles Tab Overview (needs window). Why: macOS Window > Show All Tabs (⇧⌘\).
- [x] `MENU-018` **Import…**: `file.import`: opens Settings > Import & export for the space open in this window. Core: closed after the grading (see "Since this grading").
- [x] `MENU-019` **Export…**: ⇧⌘E `file.export`: note open only: the note menu's export (`noteMenu(.export)`, web page export panel). Core: File > Export… (⇧⌘E).
- [x] `MENU-020` **Share**: submenu: system share menu (NSSharingServicePicker items for the open note; see Services). Core: closed after the grading (see "Since this grading").
- [x] `MENU-021` **Print…**: ⌘P `file.print`: prints the open note (enabled only when a note is shown, MainMenu.swift:212,:286). Core: File > Print… (⌘P).

### Edit

- [x] `MENU-022` **Undo**: ⌘Z, **Redo** ⇧⌘Z, **Cut** ⌘X, **Copy** ⌘C, **Paste** ⌘V, **Paste and Match Style** ⌥⇧⌘V, **Delete**, **Select All** ⌘A: standard… Core: standard Edit items.
- [x] `MENU-023` **Find > Find…**: ⌘F `edit.find`: note open: note find bar (`noteMenu(.find)`); elsewhere: focuses the sidebar search. Core: closed after the grading (see "Since this grading").
- [x] `MENU-024` **Find > Find Next**: ⌘G `edit.find-next` / **Find Previous** ⇧⌘G `edit.find-previous`: note only; steps the sidebar Find tab results if a search is… Core: Find Next / Previous (⌘G, ⇧⌘G).
- [x] `MENU-025` **Find > Use Selection for Find**: `edit.find-selection` (no key; ⌘E is inline code): note only. Core: closed after the grading (see "Since this grading").
- [x] `MENU-026` **Search All Notes**: ⇧⌘F `edit.search-all`: focuses the sidebar search / palette. Core: Search All Notes… (⇧⌘F).
- [x] `MENU-027` **Spelling and Grammar**: submenu: Show Spelling and Grammar ⌘:, Check Document Now ⌘;, Check Spelling While Typing, Check Grammar With Spelling, Correct… Core: closed after the grading (see "Since this grading").
- [x] `MENU-028` **Substitutions**: submenu: Show Substitutions, Smart Copy/Paste, Smart Quotes, Smart Dashes, Smart Links, Text Replacement (standard). Core: closed after the grading (see "Since this grading").
- [x] `MENU-029` **Transformations**: submenu: Make Upper Case, Make Lower Case, Capitalize (standard). Core: closed after the grading (see "Since this grading").
- [x] `MENU-030` **Speech**: submenu: Start Speaking, Stop Speaking (standard). Core: closed after the grading (see "Since this grading").

### Format (all need a window; disabled when the keyboard is in a native field, so ⌘B etc. reach that field)

- [x] `MENU-031` **Bold**: ⌘B `format.bold`: editor `format {mark: bold}`. Core: Format > Bold.
- [x] `MENU-032` **Italic**: ⌘I `format.italic`: editor `format {mark: italic}`. Core: Format > Italic.
- [x] `MENU-033` **Underline**: ⌘U `format.underline`: editor `format {mark: underline}`. Core: Format > Underline.
- [x] `MENU-034` **Strikethrough**: ⇧⌘X `format.strikethrough`: editor `format {mark: strike}`. Core: Format > Strikethrough.
- [x] `MENU-035` **Inline Code**: ⌘E `format.code`: editor `format {mark: code}`. Core: Format > Code (⌘E).
- [x] `MENU-036` **Highlight**: ⇧⌘H `format.highlight`: editor `format {mark: highlight}`. Core: closed after the grading (see "Since this grading").
- [x] `MENU-037` **Link…**: ⌥⌘K `format.link`: sent to the page (the web's link dialog). Core: Format > Link… (⇧⌘K, not ⌥⌘K).
- [x] `MENU-038` **Heading 1/2/3**: ⌥⌘1 / ⌥⌘2 / ⌥⌘3 `format.heading-1..3`: editor `format {block: heading1..3}`. Core: Format > Text Style headings (⌥⌘1 to ⌥⌘3).
- [x] `MENU-039` **Body Text**: ⌥⌘0 `format.body`: editor `format {block: paragraph}`. Core: closed after the grading (see "Since this grading").
- [x] `MENU-040` **Bulleted List**: ⇧⌘8 format.bulleted-list, **Numbered List** ⇧⌘7 format.numbered-list, **Checklist** ⇧⌘9 format.checklist: editor format… Core: Bulleted (⇧⌘8), Numbered (⇧⌘7), To-Do (⇧⌘L, not ⇧⌘9).
- [x] `MENU-041` **Indent**: `format.indent` / **Outdent** `format.outdent` (no menu keys; Tab and ⇧Tab stay the editor's): editor `indent` / `outdent`. Core: closed after the grading (see "Since this grading").
- [x] `MENU-042` **Move Block Up**: ⌥⇧↑ `format.move-up` / **Move Block Down** ⌥⇧↓ `format.move-down`: editor `block.move {dir}`. Core: Move Block Up/Down (⌥⌘↑, ⌥⌘↓).
- [x] `MENU-043` **Duplicate Block**: ⌘D `format.duplicate`: editor `block.duplicate`. Core: Duplicate Block (⌘D).
- [x] `MENU-044` **Style…**: `format.style`: editor `panel.open {panel: style}` (note style and theme panel). Core: Style and Theme….

### Note (all need a window and an open note)

- [x] `MENU-045` **Bookmark**: `note.star`: toggles the star; engine `note.star`. Core: Note > Star (⌥⌘S).
- [x] `MENU-046` **Archive**: `note.archive`: toggles archive; engine `note.archive`. Core: closed after the grading (see "Since this grading").
- [x] `MENU-047` **Move to…**: ⇧⌘M `note.move`: note menu move dialog; engine `note.move` (and `places.move` across places). Core: Note > Move To… (no ⇧⌘M).
- [x] `MENU-048` **Duplicate**: `note.duplicate`: engine `note.duplicate`. Core: Note > Duplicate.
- [x] `MENU-049` **Copy Link**: ⌃⌘C `note.copy-link`: copies `https://app.folevi.com/d/<id>`; toast "Link copied" (native, no engine call). Core: File > Copy Link (⌥⌘C).
- [x] `MENU-050` **Version History…**: `note.history`: note menu history panel (web page). Core: Note > Version History….
- [x] `MENU-051` **Lock**: `note.lock`: editor `note.lock`; enabled only when the note can be locked (`canLockNote`). Core: Note > Lock Note.
- [x] `MENU-052` **Move to Trash**: ⌘⌫ `note.trash`: engine `note.trash` with Undo toast; as a key press it only fires when nothing is being edited… Core: closed after the grading (see "Since this grading").

### View

- [x] `MENU-053` **Hide Sidebar / Show Sidebar**: ⌘\ `view.sidebar` (alternate ⌃⌘S): toggles the split view sidebar. Core: system sidebar toggle (⌃⌘S); no ⌘\.
- [x] `MENU-054` **Show Inspector**: ⌥⌘I `view.inspector`: note only: editor `panel.open {panel: info}` or `panel.close` if open. Core: View > Show Inspector (⌥⌘0) and Note Info (⌥⌘I).
- [x] `MENU-055` **Focus Mode**: ⌥⌘\ `view.focus`: editor `focus.toggle`. Core: View > Focus Mode (⌃⇧⌘F).
- [x] `MENU-056` **As Cards**: `view.cards` / **As List** `view.list`: list layout switch (known bug: writes a layout the Mac list never reads, see Gaps). Core: View > as List / as Cards (works in Core).
- [x] `MENU-057` **Appearance > Light / Dark / Match System**: `view.appearance-light|dark|system`: engine `settings.update {appearance}`; checked per the page's theme. Core: closed after the grading (see "Since this grading").
- [x] `MENU-058` **Actual Size**: ⌘0 `view.actual-size`, **Zoom In** ⌘+ (alternate ⌘=) `view.zoom-in`, **Zoom Out** ⌘- `view.zoom-out`: app-wide page zoom… Core: closed after the grading (see "Since this grading").
- [x] `MENU-059` **Enter Full Screen**: ⌃⌘F `view.full-screen`: `toggleFullScreen:`. Core: system Enter Full Screen.

### Go

- [x] `MENU-060` **Back**: ⌘[ `go.back` / **Forward** ⌘] `go.forward`: per-tab history; enabled per `history.canGoBack/canGoForward`. Core: closed after the grading (see "Since this grading").
- [x] `MENU-061` **Home**: `go.home` (no key; ⇧⌘H is Highlight). Core: closed after the grading (see "Since this grading").
- [x] `MENU-062` **Today's Tasks**: ⌥⌘T `go.today`: `/tasks` Today view. Core: Go > Tasks (⇧⌘T, not ⌥⌘T).
- [x] `MENU-063` **Calendar**: ⌥⌘C `go.calendar`. Core: Go > Calendar (⌃⌘K).
- [x] `MENU-064` **Inbox**: `go.inbox`: the Tasks Inbox view (not notifications). Core: closed after the grading (see "Since this grading").
- [x] `MENU-065` **Foli DNA**: `go.dna`: opens `/graph` as a web page; hidden/disabled when `capabilities.graph` is false. Core: closed after the grading (see "Since this grading").
- [x] `MENU-066` **Search…**: `go.search`: focuses the sidebar search / palette. Core: Go > Search.
- [x] `MENU-067` **Ask Foli AI**: ⌘J `go.ask-ai`: `FrameModel.askAI` (Foli AI page or note AI panel); disabled when `capabilities.ai` is false. Core: closed after the grading (see "Since this grading").
- [x] `MENU-068` **Next Tab**: ⌃Tab (alternate ⇧⌘]) `go.next-tab` / **Previous Tab** ⌃⇧Tab (alternate ⇧⌘[) `go.previous-tab`. Core: macOS window tab keys (⌃Tab, ⌃⇧Tab).
- [x] `MENU-069` **Go to Tab > Tab 1…Tab 9**: ⌘1…⌘9 `go.tab-1..9`: selects tab N (known clash: the Tasks screen also binds ⌘1 to ⌘6 for its views). Core: closed after the grading (see "Since this grading").

### Window

- [x] `MENU-070` **Minimize**: ⌘M, **Zoom**, **Bring All to Front**: standard. Core: standard Window items.
- [x] `MENU-071` **Float Note**: `window.float-note`: opens the open note in a floating always-on-top note window (`FloatingNotes`); enabled only when a note is… Core: Note > Float on Top (`Views/Note/NoteScreen.swift` NoteMoreMenu).

### Help

- [x] `MENU-072` **Folevi Help**: `help.help`: opens Help (`frameOpenHelp`, /help). Core: closed after the grading (see "Since this grading").
- [x] `MENU-073` **Keyboard Shortcuts**: ⌘/ `help.shortcuts`: /help scrolled to the shortcuts list. Core: closed after the grading (see "Since this grading").
- [x] `MENU-074` **What's New**: `help.whats-new`: opens https://folevi.com/changelog in the browser. Core: Help > What's New.
- [x] `MENU-075` **Send Feedback…**: `help.feedback`: mailto:support@folevi.com?subject=Folevi for Mac. Core: Help > Contact Support… (support.send) stands in for feedback.

### Debug (Debug builds only)

- [n/a] `MENU-076` **Reload Page**: ⌥⌘R `debug.reload`, **Reload All Windows** ⌥⇧⌘R `debug.reload-all`, **Show Support Folder in Finder** `debug.support-folder`. Why: Debug harness (Core uses MacEval scripts).

### Other menus and global keys (details in the sections named)

- [x] `MENU-077` **Dock menu**: New Note, Quick Add Task, New Window, up to 5 recent notes, Places submenu (see App & windows, ). Core: closed after the grading (see "Since this grading").
- [x] `MENU-078` **Status item (menu bar icon) menu**: see App & windows, includes "Search Folevi…" and "Settings…". Core: closed after the grading (see "Since this grading").
- [x] `MENU-079` **Global Quick Add hotkey**: Carbon hotkey, default ⌥Space, user-recordable in Settings > General. Core: Quick Add hotkey (see QADD-006).
- [x] `MENU-080` **Text context menu additions**: : see Context menus. Core: see CTX-009.
- [x] `MENU-081` **Screen-level keys**: lists (Esc clears selection, ⌘A select all), palette (↑/↓, Return, Esc), Settings (⌘F, ↑/↓, Return, Esc, ⌘W), Tasks (⌘1 to ⌘6… Core: closed after the grading (see "Since this grading").
- [x] `MENU-082` **Shortcut conflicts to resolve in Folevi Core**: palette hints ⌥⌘N for New document while the menu uses ⌘N (⇧⌘N is New Window); AppContextMenu also says ⌥⌘N; Tasks ⌘1 to ⌘6 vs Go… Core: closed after the grading (see "Since this grading").

## Updates (Sparkle)

- [x] `UPD-001` **Sparkle 2 controller**: `SPUStandardUpdaterController(startingUpdater: true)`, started after the first windows. Core: shared Updater started in `App/FoleviCoreApp.swift` CoreSetup.
- [x] `UPD-002` **Feed and keys (Info.plist)**: SUFeedURL `https://folevi.com/download/mac/appcast.xml`. SUPublicEDKey `F+N/necf9zCMzOTldJSKppxPoWCYn8rTANGly0mLbtA=` (the… Core: `Resources/Info.plist` Core's own feed (download/core/appcast.xml) and EdDSA key.
- [x] `UPD-003` **Enablement**: Release only. Debug, FOLEVI_USER_DATA and test runs are off. FOLEVI_UPDATES=on/off overrides. Core: shared Updater (release only).
- [~] `UPD-004` **Test channel**: FOLEVI_UPDATE_URL (https or localhost) + `/mac/appcast.xml` through `feedURLString(for:)`. No other channels. Core: shared code; the test channel appends today's /mac/appcast.xml path.
- [x] `UPD-005` **Install on quit and "Restart to Update"**: `willInstallUpdateOnQuit` keeps the immediate-install handler; the menu title becomes "Restart to Update to <version>", else… Core: menu title from Updater.menuTitle.
- [x] `UPD-006` **Version shown vs compared**: CFBundleShortVersionString is shown; CFBundleVersion is the hidden number Sparkle compares. Core: `Host/CorePaths.swift` version and build.
- [x] `UPD-007` **Signing and notarization (docs)**: Developer ID, hardened runtime, notarytool and stapler, EdDSA appcast, deltas. Core: `scripts/release.mjs` (Developer ID, hardened runtime, DMG) and `scripts/publish.mjs` (notarize, staple, appcast; the owner runs it).

## Offline, sync & device storage

- [x] `SYNC-001` **Runners (hidden place pages)**: A WKWebView in no window on `/place-sync?place=<id>` for each place no main window shows (other accounts; the library when it is… Core: shared Places and BackgroundSync.
- [x] `SYNC-002` **BackgroundPlan timings**: interval 600 s (one place at a time catches up), minAwake 15 s, maxAwake 120 s, maxAwakeWaiting 600 s, regularAtOnce 1, linger 3… Core: shared BackgroundSync.
- [x] `SYNC-003` **Wake reasons**: A place leaving the windows or a new account ("background"), the library folder changing (after a 3 s debounce, "folder"), new… Core: shared BackgroundSync.
- [x] `SYNC-004` **Tick pace**: 2 s while a runner is up; min(20, interval/2) when places are waiting; no timer when nothing is in the background. Core: shared BackgroundSync.
- [x] `SYNC-005` **Unread poll without a page**: Every 60 s (every 180 s while the app is inactive): POST `<convexUrl>/api/query` `{ path: "notifications:unreadCount" }` with the… Core: shared BackgroundSync.
- [x] `SYNC-006` **Page reports**: `placesDescribe` with `waiting` decides when a runner is done. Core: shared ShellRouter placesDescribe.
- [x] `SYNC-007` **Local reminders**: System-scheduled, so they fire with the app quit. Core: shared shell notifications.
- [x] `SYNC-008` **Library live updates**: `LibraryService.onChanges` resets the attachment cache, sends the `libraryChanges` event and runs `BackgroundSync.libraryChanged`. Core: shared LibraryService and BackgroundSync.
- [x] `SYNC-009` **Offline test switch (FOLEVI_OFFLINE=1)**: Content rule "folevi-offline" blocks http(s) and ws(s) in every view, plus URLProtocol RefuseNetwork swizzled into the default… Core: `Host/PageView.swift` prepareRules and shared Offline.
- [x] `SYNC-010` **Failed load page**: See /_folevi-offline. Core: `Host/PageView.swift` offline page.
- [x] `SYNC-011` **Memory pressure**: `DispatchSource.makeMemoryPressureSource([.warning,.critical])` runs relieve. Core: closed after the grading (see "Since this grading").
- [x] `SYNC-012` **Quick Add and Settings pages made on demand**: Memory plan, steps 1 and 2. Core: Quick Add and Settings are native; web Settings panes borrow a pool page on demand.
- [x] `SYNC-013` **Content process crash**: The view reloads, and the Page View client resubscribes (`PageLifecycle`). Core: `Host/PageView.swift` reloads the page and tells its engine client (PageLifecycle).
- [x] `SYNC-014` **Device storage and offline copies**: Engine view `device.storage` and commands `device.keepAll`, `device.download`, `device.removeCopy`, `device.removeFiles`, used by… Core: `Views/Settings/SettingsView.swift` OfflinePane (device.storage, keepAll, download, removeFiles, removeCopy).

## Migration

- [n/a] `MIG-001` **MigrationFlow.runAtLaunch**: Runs before any window. `cleanUpIfDue` first; when `isNeeded` (Electron data exists and the migration isn't finished) it shows… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-002` **MigrationWindow**: "Moving Folevi to its new engine": one row per step, Try Again or Continue Without on a failure, and an explanation before any… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-003` **Steps**: sessions ("Sign-ins"), keys ("Encryption keys"), library ("Library"), settings ("Settings"). Idempotent; recorded in. Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-004` **sessions**: `secrets/auth.session[.<user id>].bin`, `secrets/ai.*.bin`, `cloud-tokens.bin`, go to Keychain `com.folevi.shell-auth`… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-005` **keys**: `e2ee/device.{bin,json}`, `e2ee/accounts/<user id>/...` and `library-keys/<library id>.key` go to Keychain `com.folevi.e2ee`… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-006` **library**: becomes `{ kind, bookmark?, sub? }` (security bookmark). and the journal keep their format. "Cloud libraries" is renamed "Cloud… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-007` **settings**: gives quickAddShortcut, openAtLogin, menuBarIcon, notifications and the mode (`folevi.shell.mode`). bounds become the first… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-008` **SafeStorage (Chromium OSCrypt reader)**: Keychain generic password service "Folevi Safe Storage", account "Folevi Key". PBKDF2-HMAC-SHA1 (salt "saltysalt", 1003… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-009` **Sealer selection**: Release reads Folevi's item. Debug and FOLEVI_USER_DATA runs need FOLEVI_SAFE_STORAGE=mock (a `--use-mock-keychain` folder) or… Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-010` **Not migrated**: Chromium IndexedDB unsent edits (the 1.22 handover was dropped). Why: Electron migration: a brand-new app has nothing to migrate.
- [n/a] `MIG-011` **30-day cleanup**: Removes Chromium storage and caches (Partitions, Cache, Local Storage, Cookies, Service Worker, Crashpad… Why: Electron migration: a brand-new app has nothing to migrate.

## Bridge messages & capabilities

- [x] `BRIDGE-001` **ping**: `{ pong, version, echo }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-002` **setMode**: `{ mode: local|account }`, goes to `Places.setMode`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-003` **placesList**: `{ places }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-004` **placesSwitch**: `{ id, path }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-005` **placesSignIn**: `{ provider }`, returns the new place id. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-006` **placesDescribe**: Counts for the sender's place. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-007` **placesSignOut**: `{ id, next }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-008` **placesForgetLibrary**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-009` **placesConvexToken**: `{ id }`, signed-in page only. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-010` **placesQuickAdd**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-011` **placesSetQuickAdd**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-012` **libSetup**: and **libMove**: `{ kind: icloud|folder|device }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-013` **libInfo**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-014` **libList**: `{ root?, dir }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-015` **libRead**: `{ root?, path }`, returns `{ bytes b64, etag }` or `{ notDownloaded }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-016` **libWrite**: `{ root?, path, bytes, mode: create|match|any, ifMatch }`, returns `{ etag }` or `{ mismatch, etag }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-017` **libRemove**: `{ path, ifMatch }`. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-018` **libConflictVersions**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-019` **libResolveConflicts**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-020` **libStartDownload**: `{ paths }` (iCloud). Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-021` **libWatch**: and **libUnwatch**: No-ops; the watcher runs while the library is open. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-022` **libRescan**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-023` **journalAppend**: **journalRead**, **journalTruncate**: The library's journal. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-024` **libUnlock**: **libSetPassphrase**, **libChangePassphrase**: Encrypted library. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-025` **cloudStatus**: **cloudConnect**, **cloudCancel**, **cloudSignOut**, **cloudRequest**: Dropbox and Drive. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-026` **libSetCloud**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-027` **mirrorRead**: **mirrorWrite**, **mirrorDelete**, **mirrorPaths**, **mirrorLoadState**, **mirrorSaveState**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-028` **secretsHas**: **secretsSet**, **secretsDelete**: AI keys. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-029` **authSignIn**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-030` **authSignOut**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-031` **authFetch**: `{ path, method, headers, body }` to the website with the bearer token. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-032` **authConvexToken**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-033` **aiCapabilities**: **aiGenerate** (`{ id, req }`), **aiCancel**, **aiTestKey**. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-034` **lockGet**: **lockSet** (`{ lock, lockAfter }`). Core: shared ShellRouter answers it for every Core page, with Core's MacAppLock (`Host/HostServices.swift`).
- [x] `BRIDGE-035` **notifySchedule**: (`{ id, at ms, title, body, path }`), **notifyCancel**: Local mode only. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-036` **filesSave**: `{ name, bytes }`, through a save panel (ShellFiles). Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-037` **httpPreview**: `{ url }`, link preview. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-038` **httpCalendar**: `{ url, previous: { etag, lastModified } }`, local mode only. Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-039` **e2eeDeviceKeys**: **e2eeOpen** (`{ box, context }`), **e2eeSign** (`{ kind, body }`), **e2eeReset**, **e2eeSettings**, **e2eeSetTouchId** (`{ on }`). Core: shared ShellRouter answers it for every Core page.
- [x] `BRIDGE-040` **setBadge**: `{ count }`, per place. Core: `Host/DesktopRouter.swift` setBadge.
- [x] `BRIDGE-041` **notify**: `{ id, title, body, path, kind, thread, threadTitle, commentThread }`. Skipped when the app is active and the view has a native… Core: `Host/DesktopRouter.swift` notify (skipped while Core is in front).
- [x] `BRIDGE-042` **setRecent**: `{ notes: [{ id, title }] }`, main windows only, keeps 8. Core: `Host/DesktopRouter.swift` setRecent.
- [n/a] `BRIDGE-043` **setStatus**: `{ text }`, the save state. Why: accepted and ignored; Core reads sync.status from the engine.
- [x] `BRIDGE-044` **getSettings**: and **setSettings**: `{ patch }`, returns `{ settings, error }`. Core: `Host/DesktopRouter.swift` getSettings, setSettings.
- [n/a] `BRIDGE-045` **placeWindowButtons**: `{ x, y, height }`, traffic-light spot. Why: native title bar; accepted and ignored.
- [x] `BRIDGE-046` **pauseShortcut**: `{ paused }`. Core: `Host/DesktopRouter.swift` pauseShortcut.
- [n/a] `BRIDGE-047` **closeQuickAdd**. Why: Quick Add is native; accepted and ignored.
- [n/a] `BRIDGE-048` **sizeQuickAdd**: `{ height }`. Why: Quick Add is native; accepted and ignored.
- [x] `BRIDGE-049` **openInMain**: `{ path }`. Core: `Host/DesktopRouter.swift` openInMain.
- [x] `BRIDGE-050` **chromeHello**: Returns `{ fullscreen, active, keyboard, vibrancy, panel }`. Core: `Host/DesktopRouter.swift` chromeHello.
- [n/a] `BRIDGE-051` **dragRegions**: `{ drag, noDrag }`. Why: native title bar; accepted and ignored.
- [n/a] `BRIDGE-052` **setMenuState**: `{ disabled, checked, ai, sidebar, inspector, focus, find, locked, route }`. Why: Core reads editor.state events instead; accepted and ignored.
- [x] `BRIDGE-053` **pageTheme**: `{ theme, system }`. Core: closed after the grading (see "Since this grading").
- [x] `BRIDGE-054` **closeWindow**. Core: `Host/DesktopRouter.swift` closeWindow.
- [x] `BRIDGE-055` **spelling**: `{ word, context }`, returns `{ misspelled, guesses }`. Core: `Host/DesktopRouter.swift` spelling.
- [x] `BRIDGE-056` **learnWord**. Core: `Host/DesktopRouter.swift` learnWord.
- [x] `BRIDGE-057` **ignoreWord**. Core: `Host/DesktopRouter.swift` ignoreWord.
- [x] `BRIDGE-058` **lookUp**: `{ text, x, y }`. Core: `Host/DesktopRouter.swift` lookUp.
- [x] `BRIDGE-059` **signInInBrowser**: `{ url }`, returns `{ url | null }`. Core: shared DesktopRouter+SignIn registers it.
- [x] `BRIDGE-060` **recognizeText**: `{ data b64, handwriting }`, returns `{ text }`. Core: `Host/Capabilities.swift` recognizeText (shared TextRecognition).
- [x] `BRIDGE-061` **screenAccess**: Returns `granted` or `denied`. Core: `Host/Capabilities.swift` screenAccess.
- [x] `BRIDGE-062` **openSystemSettings**: `{ pane: "screen-recording" }` only. Core: `Host/Capabilities.swift` openSystemSettings (screen recording only).
- [x] `BRIDGE-063` **callStart**: **callPause**, **callResume**, **callStop**, **callCancel**. Core: `Host/Capabilities.swift` callStart, callPause, callResume, callStop, callCancel (shared CallRecorder).
- [x] `BRIDGE-064` **dragFile**: `{ name, text }`. Core: `Host/Capabilities.swift` dragFile (a Markdown file promise).
- [n/a] `BRIDGE-065` **dragNotes**: `{ notes, token }`. Why: the page's dragNotes is for its own card and row drags, which Core draws natively; Core's native drags carry the files (BRIDGE-079).
- [x] `BRIDGE-066` **dragNoteReply**. Core: closed after the grading (see "Since this grading").
- [x] `BRIDGE-067` **print**. Core: `Host/Capabilities.swift` print (shared Printing).
- [x] `BRIDGE-068` **share**: `{ title, text, url, fileName, rect | x,y }`, returns `{ shared }`. Core: `Host/Capabilities.swift` share (NSSharingServicePicker at the page's rect or point; text and https URLs, no file).
- [x] `BRIDGE-069` **setShareTarget**: `{ target: { title, url } }`. Core: closed after the grading (see "Since this grading").
- [x] `BRIDGE-070` **indexSpotlight**: `{ items, keep, remove }`. Core: closed after the grading (see "Since this grading").
- [x] `BRIDGE-071` **spotlightState**. Core: closed after the grading (see "Since this grading").
- [x] `BRIDGE-072` **clipboardRead**: **clipboardWrite**, **clipboardPaste**. Core: `Host/Capabilities.swift` clipboardRead, clipboardWrite, clipboardPaste (shared Clipboard).
- [x] `BRIDGE-073` **quickLook**: `{ files: [{ name, data }] }`. Core: `Host/Capabilities.swift` quickLook (temporary copies, QLPreviewPanel).
- [~] `BRIDGE-074` **commandDone**: `{ id, value }`, answers a native `ask`. Core: `Host/Capabilities.swift` answers commandDone, but nothing native asks yet.
- [x] `BRIDGE-075` **FoleviShell libraryChanges / cloudWant / cloudStatus**: Sent to library pages only. Core: shared Places events to library pages.
- [x] `BRIDGE-076` **FoleviShell placesChanged**: Sent to every view. Core: shared Places events.
- [x] `BRIDGE-077` **FoleviShell aiChunk**: `{ id, text }`. Core: shared ShellAI.
- [x] `BRIDGE-078` **FoleviDesktop callLevel / callEnded**. Core: sent by the shared CallRecorder (handlers in `Host/Capabilities.swift`).
- [x] `BRIDGE-079` **FoleviDesktop noteFile**: `{ request, token, id, folder }` (drag out). Core: closed after the grading (see "Since this grading").
- [x] `BRIDGE-080` **FoleviDesktop command**: Taken by the native frame first (`NativeFrame.handle`) when the view is a Page View. Core: `Host/PageView.swift` Events.command (Core has no frame to take it first).

## Debug & eval harness

- [n/a] `DBG-001` **MacEval**: Debug only. writes and posts a Darwin notification; the app writes. Built-in commands: eval, shot, open, appearance, windows… Why: Debug harness of today's app; Core has its own MacEval (`Host/MacEval.swift`, `scripts/core.mjs`).
- [n/a] `DBG-002` **ChromeEval**: menu (list, run, open), quickAdd, quickAddShot, settings, evalIn, titleBar, hitTest, chrome, restore, notifyAction. Why: Debug harness of today's app; Core has its own MacEval (`Host/MacEval.swift`, `scripts/core.mjs`).
- [n/a] `DBG-003` **Places eval**: places, runner-eval, forget-library-key, test-session, add-account, hide, lock-cover, wake, switch. Why: Debug harness of today's app; Core has its own MacEval (`Host/MacEval.swift`, `scripts/core.mjs`).
- [n/a] `DBG-004` **Memory eval**: quickAddType, typeKeys, gc, memoryPressure, memory; plus the script. Why: Debug harness of today's app; Core has its own MacEval (`Host/MacEval.swift`, `scripts/core.mjs`).
- [n/a] `DBG-005` **Capabilities eval**: printToFile, dragLog, printNote, shareAnswer, dragProbe, nativeDragProbe, downloadTo, service, intent, spotlight, openSpotlight. Why: Debug harness of today's app; Core has its own MacEval (`Host/MacEval.swift`, `scripts/core.mjs`).
- [n/a] `DBG-006` **FrameEval / MoreEval (native frame)**: `cmd frame {...}` (open, select, close, next, back, newNote, search, popover, menu, resize, scroll, demoVault, demoPictures)… Why: Debug harness of today's app; Core has its own MacEval (`Host/MacEval.swift`, `scripts/core.mjs`).
- [n/a] `DBG-007` **Debug-only switches**: FOLEVI_FAKE_AI (and _WAIT_MS), FOLEVI_FRAME_DEMO, FOLEVI_WEB_GATES, FOLEVI_TEST_FOLDER, FOLEVI_SYSTEM_SCROLLERS; `isInspectable`. Why: Debug harness of today's app; Core has its own MacEval (`Host/MacEval.swift`, `scripts/core.mjs`).
- [n/a] `DBG-008` **Tests**: FoleviTests (SchemeTests, RouterTests, BackgroundSyncTests, ChromeTests, LockLogic) and, which drives the app through mac.mjs. Why: Debug harness of today's app; Core has FoleviCoreTests and scripts/core.mjs.

## Capabilities

- [x] `CAP-001` **Bundle ids**: Release `com.folevi.mac` (product "Folevi"), Debug `com.folevi.mac.dev` ("Folevi Dev"), tests `com.folevi.mac.dev.tests`. Owner… Core: own ids app.folevicore.FoleviCore and .dev (`project.yml`).
- [x] `CAP-002` **Version**: MARKETING_VERSION 1.5.63, CURRENT_PROJECT_VERSION 78; one unified version across platforms, no build number shown in the UI. Core: `project.yml` 1.5.63 (78); release.mjs takes version.json.
- [x] `CAP-003` **Deployment target**: macOS 26.0; Swift 5 language mode, minimal strict concurrency (shared iOS code); hardened runtime; dead code stripping. Core: `project.yml` (macOS 26, Swift 5 mode, minimal concurrency, hardened runtime, dead code stripping).
- [x] `CAP-004` **Signing**: team 7K32QQ2FX8, manual signing; Release = Developer ID Application + provisioning profile "Folevi for Mac Developer ID iCloud"… Core: `project.yml` automatic signing (team 7K32QQ2FX8); release.mjs signs again with Developer ID.
- [x] `CAP-005` **URL scheme**: `CFBundleURLTypes` with scheme `$(FOLEVI_URL_SCHEME)`: `folevi` in Release, `folevi-dev` in Debug; also exposed as Info key… Core: Info.plist folevi-core / folevi-core-dev.
- [x] `CAP-006` **Dev shell dir**: Info key `FoleviDevShellDir` = `$(SRCROOT)/web` in Debug (serves the built-in web export from disk), empty in Release (bundled… Core: Info.plist FoleviDevShellDir.
- [x] `CAP-007` **NSServices**: one service, menu title "New Folevi Note with Selection", message `newNoteWithSelection`, port "Folevi", send types… Core: Info.plist NSServices.
- [x] `CAP-008` **Exported UTIs**: (in-app drag payloads): `com.folevi.note-ref` ("Folevi note") and `com.folevi.folder-ref` ("Folevi folder"), both conform to… Core: closed after the grading (see "Since this grading").
- [x] `CAP-009` **Document types**: none declared (no CFBundleDocumentTypes; the app does not open files from Finder; no `application(_:open:)`). Core: none, as today.
- [x] `CAP-010` **Privacy strings**: `NSMicrophoneUsageDescription` "Folevi records audio into your notes when you ask it to." (audio recording, call recorder). No… Core: NSMicrophoneUsageDescription.
- [x] `CAP-011` **App Transport Security**: `NSAllowsLocalNetworking` true and an insecure-HTTP exception for `localhost` (and subdomains) for development servers. Core: Info.plist ATS.
- [x] `CAP-012` **Termination**: `NSSupportsAutomaticTermination` false, `NSSupportsSuddenTermination` false (the app must flush its outbox and editor state). Core: Info.plist termination keys.
- [x] `CAP-013` **Category**: `public.app-category.productivity`; icon `AppIcon` from the shared Icon Composer file ``; accent colour asset `AccentColor`. Core: category, shared AppIcon, AccentColor.
- [x] `CAP-014` **Sparkle keys**: `SUFeedURL` https://folevi.com/download/mac/appcast.xml, `SUPublicEDKey` (EdDSA public key in the plist)… Core: `Resources/Info.plist` Core's own feed and key, automatic checks every 6 h.
- [x] `CAP-015` **Entitlements (Release)**: `com.apple.security.device.audio-input`; iCloud container `iCloud.com.folevi` (icloud-container-identifiers and… Core: closed after the grading (see "Since this grading").
- [x] `CAP-016` **Entitlements (Debug)**: `FoleviDev.entitlements` (audio input only; no iCloud or keychain group). Core: `FoleviCoreDev.entitlements`.
- [x] `CAP-017` **App Intents / Shortcuts**: declared in code, not in the plist: `OpenNoteIntent`, `NoteEntity`/`NoteQuery`, `FoleviMacShortcuts` (AppShortcutsProvider) in… Core: `App/Intents.swift` (App Intents and App Shortcuts).
- [x] `CAP-018` **Extensions**: none. No share extension, Quick Look extension, widget, Spotlight importer or login-item helper target; Quick Look is the in-app… Core: none, as today.
- [x] `CAP-019` **Shared Swift by path**: the Mac target compiles iOS shell files (E2eeKeys, EncryptedFS, Keychain, LibraryCrypto, LibraryFileHandler, LibraryFS… Core: `project.yml` builds the same shared files by path.
- [x] `CAP-020` **Resources**: (injected page bridge). Core: mac-bridge.js, capabilities.js, shell-bridge.js, folevi-cloud.js as resources.

## Stays web, WebPage values and the parity list

- [x] `WEB-001` **Stays web by plan**: ( section 5.13): the note page and everything in it (DocumentView, the editor, its panels: Format, Insert, Style and themes… Core: the note page, Reviews and Foli DNA stay web (`Views/Note/NoteScreen.swift`, WebScreen).
- [x] `WEB-002` **`web.show` editor command**: (`EditorCommands`, args `WebShowArgs {page: WebPage}`, ): pages the native app shows as an in-app web page… Core: Core shows every listed page with web.show (WebScreen, WebSettingsPane, SettingsWebWindow).
- [n/a] `WEB-003` **Generic web routes**: the frame's `.web("/path")` route shows any web page in the page view (used for `/graph`, `/review`, `/help` pieces and settings… Why: Core draws Help natively; the pages that stay on the web (Foli DNA, Reviews, a few Settings tables) have their own routes.
- [n/a] `WEB-004` **Parity list status**: (planned in NATIVE_APP_PLAN 5.14 as the list of every web user action with its native owner and status) does NOT exist in this… Why: reference note; this file is Core's parity list.

## Binding UX rules from owner memory

- [x] `RULE-001` **Plain note**: one flat page, no card, corners or shadow; centred text column. Core: the page draws the note.
- [x] `RULE-002` **Page breaks**: each page a white card on a light grey backdrop with a very soft shadow; styled notes keep their backdrop plus the page card with… Core: the page draws the note.
- [x] `RULE-003` **Padding**: round the page scales smoothly with window width (Craft-like), with no breakpoint jumps. Core: the page draws the note.
- [n/a] `RULE-004` **Mac tabs**: Safari rule; every tab the same width filling the bar; × on the open tab and on hover. Why: Core's design uses native window tabs.
- [n/a] `RULE-005` **Mac note layout = web**: the left sidebar shows the note tools (contents, comments, tasks, attachments, find) with a Folders switch beside the sidebar… Why: Core's design: native sidebar, note tools in the inspector, the page draws its panels.
- [n/a] `RULE-006` **Show All Tabs**: looks like Safari's (real pictures). iPhone/iPad flat-note rules come later. Why: macOS Show All Tabs.
- [x] `RULE-007` **Back always works**: tabs opened from a page remember their opener; Back with no history closes the tab and shows the opener. The sidebar and "+"/New… Core: closed after the grading (see "Since this grading").
- [n/a] `RULE-008` **Home's overview picture**: is drawn from data (Recent notes plus Recent folders rows, HomePicture), never a cropped screenshot; any screenshot picture is… Why: native window tabs have no pictures.
- [n/a] `RULE-009` **iPhone Home strips**: cards 176 pt wide, 12 pt apart, 12 pt under the folder row; a folder name drops to one line when needed. Why: iPhone only.
- [x] `RULE-010` **Folder style Frosted everywhere**: the back has an S-curve tab at 85% opacity; fanned notes behind a frosted front; name, counts and "Edited" on the front; "…" chip… Core: FoleviDesign WebFolderCard.
- [x] `RULE-011` **25% smaller folder and note cards**: in grids on Mac and web only. Core: closed after the grading (see "Since this grading").
- [x] `RULE-012` **Sidebar folder icon**: page inside / stack for subfolders / outline when empty. Core: `Views/Sidebar.swift` FolderMark kind (notes, stack, empty).
- [x] `RULE-013` **Back's bottom corners**: match the front (14 pt circles). Core: FoleviDesign WebFolderCard.
- [x] `RULE-014` **Final frost**: the whole front fully frosted; tint light 62 to 66%, dark 82 to 78%; 7 px blur. Core: FoleviDesign WebFolderCard.
- [x] `RULE-015` **Home spacing**: sections 8 px closer; the Mac carousel hugs smaller cards. Core: closed after the grading (see "Since this grading").
- [x] `RULE-016` **Every clickable control shows a hover**: (buttons, icon buttons, menu triggers, segments, row actions, chips, tabs, rows) on web, Mac and iPad with a pointer. Use the… Core: closed after the grading (see "Since this grading").
- [x] `RULE-017` **One native look**: no setting and no beta app. Core: one native look.
- [x] `RULE-018` **System chrome, Folevi content**: stock macOS 26 parts and SF Pro for window, sidebar, toolbar, menus, popovers, lists, Settings and dialogs; notes and editor keep… Core: `Views/Common/Style.swift` CoreType (SF Pro chrome, Spectral and Instrument Sans for notes).
- [n/a] `RULE-019` **Folevi tab model kept**: (joined, pinned, per-place, folder tabs) as a capsule track in the glass top bar; native window tabs rejected. Why: Core deliberately uses native window tabs instead.
- [x] `RULE-020` **macOS 26 minimum**. Core: macOS 26.
- [x] `RULE-021` **Accent is black and white**: #1F1F22 light, #F2F2F3 dark. Core: `Views/Common/Style.swift` foleviInk (#1F1F22, #F2F2F3) as the tint.
- [x] `RULE-022` **Settings in its own window**: with a category list and working search. Core: closed after the grading (see "Since this grading").
- [x] `RULE-023` **Sidebar always visible with no hide button; Focus mode still hides it.**: Note: this conflicts with the current hide button and ⌘\. Core: closed after the grading (see "Since this grading").
- [x] `RULE-024` **Owner's Mac UI guide**: applies to the window profile. Core: the guide applies to the sidebar scale, Settings and empty/loading states; the owner chose (21 November 2026) to keep native window tabs, so its main-window profile is not used.
- [n/a] `RULE-025` **Web-parity screenshot diffs**: cover note content only, not chrome. Why: a testing process, not a feature.
- [n/a] `RULE-026` **iPad uses the same layout as the Mac**. Why: iPad only.
- [x] `RULE-027` **Sidebar rows**: need more breathing space. Core: closed after the grading (see "Since this grading").
- [x] `RULE-028` **Liquid Glass**: wherever there is scope: on floating controls and the navigation layer, never on content. Core: glass on toasts, the palette and Quick Add only.
- [x] `RULE-029` **Consistent button size, thickness and font sizes**: (one control size via `macNativeChrome`). Core: closed after the grading (see "Since this grading").
- [x] `RULE-030` **System font everywhere**: except notes, folders and the editor. A note card keeps its Spectral title and the note-font preview, with system dates and chip.… Core: CoreType on cards and titles, system font elsewhere.
- [x] `RULE-031` **One New note**: a black "+ New note" pill in the title bar right after the tabs, before sync and bell (white in dark mode), native Liquid Glass.… Core: `Views/MainWindow.swift` the one New Note pill in the toolbar.
- [x] `RULE-032` **Section headings that open a page**: get a full-row hover. Core: closed after the grading (see "Since this grading").
- [x] `RULE-033` **No unnecessary or repeated buttons**: (no circle + on Home or a note, no extra floating Share on a note). Core: one New Note, no repeated buttons.
- [x] `RULE-034` **Icons**: Folevi's web icons wherever the web has one, and the Foli AI icon for Foli AI; this overrides SF Symbols in the chrome (MacSymbol). Core: closed after the grading (see "Since this grading").
- [n/a] `RULE-035` **Checklist**: of native, Liquid Glass and macOS UI use lives in. Why: reference document.
- [n/a] `RULE-036` **Verify with real window captures**: (`screencapture -l`), not the app's own windowShot. Why: a testing process, not a feature.
- [~] `RULE-037` **Follow `docs/MAC_NATIVE_LOOK.md`**: (row sizes, `macNativeChrome`, MacSymbol, no control twice). Core: reviewed on 22 November 2026: icons, hovers, row rhythm, no lines between rows, card sizes and Home spacing follow it; the window profile (custom title bar strip, one card, drawn sidebar) is not used, by the owner's choice of native tabs.
- [x] `RULE-038` **New note shortcut**: MenuModel binds ⌘N to New Note and ⇧⌘N to New Window, but AppContextMenu says ⌘⌥N on the Mac "(⌘N is a new window there)" and the… Core: resolved: ⌘N New Note, ⇧⌘N New Window, the palette says ⌘N.
- [n/a] `RULE-039` **Stale header comment**: CardControls says "New note is the sidebar's row", which contradicts the owner's pill rule. Why: today's code.
- [n/a] `RULE-040` **Dead code**: SidebarViewController, TabStripView and NoteMenu.build are compiled but never instantiated. Why: today's code.
- [x] `RULE-041` **Mac note "..." menu is web-drawn**: Folevi Core needs a native one; use NoteMenuPlan plus `editor.state.menu`. Core: `Views/Note/NoteScreen.swift` NoteMoreMenu (native, from editor.state.menu).
- [x] `RULE-042` **Lock contract is split**: `folder.lock` is in EngineAPI and also duplicated in PendingN7Commands. `folders.locks` and `changes.diff` are still pending. The… Core: closed after the grading (see "Since this grading").
- [n/a] `RULE-043` **frameDownloadFile is a stub**: (toast "Open Folevi on the web…"). Why: today's code.
- [x] `RULE-044` **Note Copy Link hardcodes the host**: `https://app.folevi.com/d/<id>`, while folders use FoleviLinks. Core: resolved: links use Paths.serviceURL (`Views/Common/Menus.swift`).

## iPhone and iPad only (skip)

- [n/a] `IOS-001` **FoleviPhone module**: (``): the whole iPhone UI. Why: iPhone/iPad only.
- [n/a] `IOS-002` **FoleviScreens views the Mac never instantiates**: HomeScreen, HomeToolbar, HomeNoteMenu, NotesListScreen, NotesListToolbar, SharedListScreen, ChangesScreen, GateScreen… Why: iPhone/iPad only.
- [n/a] `IOS-003` **iPad only in FoleviMac**: (device App lock), iPad Settings variants (plans note, time zone select). Why: iPad only.
- [n/a] `IOS-004` **iPhone only settings rows**: General > Review changes from connected apps, Notifications > Daily summary email and News about Folevi, Account > Sign out. Why: iPhone only.
- [n/a] `IOS-005` **Android**: paused, not relevant. Why: Android, paused.

## Gaps, bugs and contradictions

### Gaps, bugs and contradictions found while inventorying

- [x] `GAP-001` **New note shortcut disagrees**: the main menu binds ⌘N to New Note and ⇧⌘N to New Window, but AppContextMenu, the iPad bar and the command palette hint ⌥⌘N. Core: resolved in Core (⌘N everywhere).
- [n/a] `GAP-002` **Dead code**: `SidebarViewController`, `TabStripView` and `NoteMenu.build` are compiled but nothing creates them. Why: today's code.
- [x] `GAP-003` **Note "…" menu is the web page's**: the Mac note overflow menu is drawn by the web page; natively it only exists as the iPhone's `NoteMenuPlan`. Core: resolved: Core's note menu is native (NoteMoreMenu).
- [x] `GAP-004` **Lock contract split**: two folder.lock specs; folders.locks and changes.diff are still pending contracts; the sidebar folder menu passes locks… Core: closed after the grading (see "Since this grading").
- [x] `GAP-005` **Sidebar rule vs code**: an owner rule says the sidebar is always visible with no hide button, but the code has a hide button and ⌘\ (View > Hide Sidebar). Core: closed after the grading (see "Since this grading").
- [n/a] `GAP-006` **frameDownloadFile**: only shows a toast. Why: today's code.
- [~] `GAP-007` **Two-step verification**: no native flow; the row opens folevi.com/settings/security. Core: still the web screen (in a window of its own).
- [~] `GAP-008` **Unused in Mac Settings**: `e2ee.*`, `support.send`, `workspace.create`, `account.signOut`, `device.removeFiles` are never called from the Mac Settings… Core: Core uses account.signOut, device.removeFiles, workspace.create and support.send; still no e2ee.*.
- [x] `GAP-009` **No "Check for Updates" row**: in Settings (only the Folevi menu item). Core: resolved: Settings > Updates.
- [n/a] `GAP-010` **No accent colour or font family options**: theme is Light, Dark, System only. Why: today's app has no accent or font choice either (a gap in both); not part of parity.
- [x] `GAP-011` **No "Sign out of this account" in Mac Settings**: (it lives in the sidebar account menu). Core: resolved: Account > Sign Out.
- [x] `GAP-012` **Foli AI on Mac lacks**: a Chat/Research switch, the Web toggle, the undo-conflict dialog, AI file attachments, an invite-link screen. Core: closed after the grading (see "Since this grading").
- [x] `GAP-013` **Unused commands**: `ai.generate`, `ai.saveDraft` (only via the Templates generate sheet), `support.send`, `inbox.open`. Core: closed after the grading (see "Since this grading").
- [n/a] `GAP-014` **Vault import and export**: are stubbed. Why: Vault import and export are stubbed in the engine for every app; nothing to call yet.
- [x] `GAP-015` **Tasks ⌘1 to ⌘6**: clash with Go to Tab ⌘1 to ⌘9. Core: no clash in Core (Tasks has no number keys).
- [x] `GAP-016` **⌘K Foli DNA command**: is never hidden when the graph capability is off ("a:graph" vs "graph" key mismatch). Core: closed after the grading (see "Since this grading").
- [x] `GAP-017` **No app-level file drop-in or open-file handling**: no `application(_:open:)`, no `registerForDraggedTypes`; drops are left to WebKit and the page. Core: closed after the grading (see "Since this grading").
- [n/a] `GAP-018` **Shared iOS services**: (ShellAuth, ShellPlaces, LibraryService, E2eeKeys, ShellCloud, ShellAI, ShellNotify) live in `` and were not inventoried line by… Why: reference note.
- [n/a] `GAP-019` **`apps/web/src/lib/engine/parity.ts` is missing**: see "Stays web, WebPage values and the parity list". Why: reference note; this file stands in.

### Items in docs checklists not found in code (gaps)

- [x] `GAP-020` **No Recent notes list**: Home's "See all" opens All notes. Core: resolved: Recent screen.
- [x] `GAP-021` **View > As Cards / As List don't reach the Mac list**: they write `NotesListModel.layout`; the Mac reads `folevi.web.layout.*`, and its layouts are Grid, Compact and List. Core: resolved: View > as Cards / as List work.
- [x] `GAP-022` **No note drag reorder on Mac**: the status text says "drag to arrange", but only Move up / Move down work. `canRearrange` and `adoptOrder` are never called. Core: resolved: Core drags rows in Manual order (note.reorder).
- [n/a] `GAP-023` **"Ask Foli AI" floating pill never used**: `WebAskFoliPill` is defined but drawn nowhere. Why: Core's design has no floating pill.
- [x] `GAP-024` **Unused engine view**: `trash.summary` (plan's `trashSummary`). Core: resolved: Trash uses trash.summary.
- [x] `GAP-025` **Unused search argument**: `creatorId` has no filter in the UI. Core: closed after the grading (see "Since this grading").
- [n/a] `GAP-026` **`changes.undo` missing**: NATIVE_APP_PLAN 5.6 lists it; it is in neither the code nor the contract. Why: not in the engine contract.
- [x] `GAP-027` **Mac Changes drops the truncated note**: `diff.truncated` and "More changes are in the note's version history." are iOS only. vs. Core: closed after the grading (see "Since this grading").
- [n/a] `GAP-028` **iOS SharedListScreen ignores shared folders**: it never draws `folderRows`. Why: iPhone only.
- [x] `GAP-029` **No Add tag bulk action on Mac**: `bulkActions(tabs: true)` leaves out tags. Core: closed after the grading (see "Since this grading").
- [x] `GAP-030` **Tags page has no rename or delete**: those live only in the sidebar tag menu. Core: resolved: the Tags screen renames and deletes.
- [x] `GAP-031` **Mac E2EE setup**: no Copy, Save or Print for the recovery key. Core: closed after the grading (see "Since this grading").
- [x] `GAP-032` **Mac onboarding, migration and approval**: drawn as the generic card (no stepper, summary or compare-code block). Core: resolved: onboarding steps, migration summary and approval code are drawn.
- [n/a] `GAP-033` **Docs say no passkeys and no social sign-in**: PRODUCT.md (lines 113-121, 149) says so, but the code offers Continue with Apple / Google and "Sign in with a passkey". Why: documentation.
- [x] `GAP-034` **New note shortcut mismatch**: the palette hints ⌘⌥N, but the menu's New Note is ⌘N (⌥⇧⌘N is New from template). Core: resolved.
- [n/a] `GAP-035` **Parity checklist file missing**: NATIVE_APP_PLAN 5.14 names, which does not exist. Why: reference note; this file stands in.
- [~] `GAP-036` **Invite-accept and OAuth consent screens**: NATIVE_APP_PLAN 5.1 lists them; they are not in these modules. Core: invitation screen yes; no OAuth consent screen.
- [n/a] `GAP-037` **Swipes (plan 5.4)**: star, archive, long-swipe delete exist on iOS only; the Mac has no equivalent beyond menus. Why: touch gestures.
- [x] `GAP-038` **MAC_NATIVE_CHECKLIST 4, open**: empty states (about 32) as `ContentUnavailableView`. Core: EmptyScreen is ContentUnavailableView (`Views/Common/Style.swift`).
- [x] `GAP-039` **MAC_NATIVE_CHECKLIST 4, open**: list layouts (All notes, Folders, Shared, Changes) as `Table` with sortable columns. Core: closed after the grading (see "Since this grading").
- [~] `GAP-040` **MAC_NATIVE_CHECKLIST 6, open**: `WebGateScreen` still uses drawn buttons, fields and switch; wants `Form`, `SecureField` and the system Sign in with Apple button. Core: native fields and buttons; no system Sign in with Apple button.
- [x] `GAP-041` **MAC_NATIVE_CHECKLIST 1 and 3, open**: the card's search as an `NSSearchField`; the folder picker (Move folder) as `NSSearchField` plus `List` or `OutlineGroup`. Core: closed after the grading (see "Since this grading").
- [x] `GAP-042` **Mac Home has no counted rows, Tags, Templates, Archive or Trash**: they are in the sidebar instead, by design, unlike plan 5.3's Home. Core: Core's Home has counted rows and Tags.
- [n/a] `GAP-043` **HomeModel move flow unused on Mac**: `noteMenu`, `run`, `movingNotes` and `homeNoteSheets` serve iOS only; the Mac Home menu goes through `NotesListModel` (All notes)… Why: today's code.

## Gaps in priority order

Every `[ ]` and `[~]` item above, grouped into packages a developer can pick up, highest user impact first. Sizes are rough: S is up to two days, M up to a week, L more than a week.

### 1. Fix bugs found in Core's own code (S)

Wrong command ids, dead UI paths, wrong colours and words, and shortcut clashes; each is a few lines.

Covers (35): `AUTH-039`, `NOTE-017`, `VAULT-029`, `VAULT-030`, `VAULT-005`, `VAULT-011`, `FOLD-011`, `FOLD-019`, `FOLD-020`, `FOLD-021`, `TAG-006`, `TAG-007`, `CTX-004`, `TPL-003`, `SET-095`, `SET-110`, `SET-157`, `TRASH-002`, `NAV-032`, `SYS-056`, `MENU-036`, `MENU-039`, `MENU-041`, `MENU-060`, `MENU-061`, `MENU-082`, `TASK-016`, `MENU-064`, `SET-049`, `SET-099`, `SET-101`, `SET-150`, `SET-011`, `BRIDGE-053`, `SET-091`.

### 2. Note sharing and public links (M)

NoteSharingSheet exists but nothing opens it; File > Share and the note's Share should open it, plus link settings and themes.

Covers (16): `NOTE-031`, `SHARE-001`, `SHARE-002`, `SHARE-003`, `SHARE-004`, `SHARE-005`, `SHARE-006`, `SHARE-007`, `SHARE-008`, `SHARE-009`, `SHARE-010`, `SHARE-011`, `SHARE-013`, `SHARE-017`, `SYS-024`, `MENU-020`.

### 3. Move, copy and folder organising (L)

A folder picker sheet (search, keys, new folder in place) shared by Move, Copy to and Move Folder; folder moves, top level, other places, drop zones and spring-loading.

Covers (41): `FOLD-002`, `FOLD-004`, `FOLD-005`, `FOLD-006`, `FOLD-007`, `FOLD-008`, `FOLD-009`, `FOLD-010`, `FOLD-012`, `FOLD-013`, `FOLD-014`, `FOLD-015`, `FOLD-018`, `FOLD-022`, `FOLD-023`, `FOLD-024`, `FOLD-026`, `FOLD-027`, `FOLD-029`, `FOLD-031`, `FOLD-036`, `FOLD-037`, `HOME-017`, `HOME-018`, `HOME-019`, `LIST-017`, `LIST-018`, `LIST-048`, `LIST-049`, `LIST-050`, `LIST-051`, `LIST-052`, `LIST-053`, `CTX-003`, `CTX-013`, `AUTH-023`, `AUTH-065`, `AUTH-066`, `MENU-008`, `NAV-022`, `TAB-028`.

### 4. List selection, bulk actions and note menus (M)

The selection bar, bulk actions every item can take, the full note and card menus (Copy to, template items, Remove from Recent, Move up/down), optimistic changes.

Covers (17): `LIST-009`, `LIST-011`, `LIST-042`, `LIST-044`, `LIST-045`, `LIST-046`, `LIST-047`, `LIST-054`, `LIST-058`, `LIST-060`, `HOME-014`, `CTX-010`, `CTX-011`, `DRAFT-003`, `GAP-029`, `TAB-008`, `CTX-008`.

### 5. Commands on the open note (S)

Archive, ⌘⌫ Move to Trash, Foli DNA of This Note and the note's own trash flow.

Covers (9): `NOTE-026`, `NOTE-027`, `MENU-046`, `MENU-052`, `TRASH-012`, `NOTE-036`, `NAV-006`, `DNA-001`, `DNA-003`.

### 6. Window and tab behaviour (M)

Bring an open note's tab forward, reopen closed tab, tab by number, pinned and per-space tabs, background tabs, history restore.

Covers (18): `APP-011`, `APP-015`, `APP-024`, `APP-066`, `TAB-002`, `TAB-007`, `TAB-011`, `TAB-013`, `TAB-015`, `TAB-017`, `TAB-018`, `TAB-040`, `AUTH-070`, `MENU-011`, `MENU-016`, `MENU-069`, `NAV-018`, `RULE-007`.

### 7. Vault completion (L)

PIN set-up and upgrade, recovery and custodians, Files & Notes (folders, notes, upload, preview), Health, Activity, People, sharing, links, Settings, Touch ID.

Covers (35): `VAULT-001`, `VAULT-002`, `VAULT-004`, `VAULT-006`, `VAULT-007`, `VAULT-009`, `VAULT-010`, `VAULT-012`, `VAULT-013`, `VAULT-014`, `VAULT-015`, `VAULT-016`, `VAULT-017`, `VAULT-018`, `VAULT-019`, `VAULT-020`, `VAULT-021`, `VAULT-022`, `VAULT-023`, `VAULT-024`, `VAULT-025`, `VAULT-026`, `VAULT-028`, `VAULT-031`, `VAULT-032`, `VAULT-034`, `VAULT-035`, `VAULT-036`, `VAULT-037`, `VAULT-038`, `VAULT-039`, `VAULT-040`, `SHARE-020`, `AUTH-022`, `GAP-014`.

### 8. Calendar layouts and scheduling (L)

Week and Agenda, drag to reschedule with Undo, unscheduled tasks, event popover, arrow keys, subscription editing, the feed's workspace choice.

Covers (23): `CAL-001`, `CAL-002`, `CAL-003`, `CAL-006`, `CAL-010`, `CAL-011`, `CAL-012`, `CAL-013`, `CAL-014`, `CAL-016`, `CAL-017`, `CAL-018`, `CAL-019`, `CAL-020`, `CAL-021`, `CAL-022`, `CAL-023`, `CAL-024`, `CAL-026`, `CAL-027`, `CAL-028`, `CAL-030`, `CAL-033`.

### 9. Task editing (M)

The Edit task dialog (status, date, time, priority, assignee, reminder), Move to page with a page picker, filter, Undo toasts, task drag, view keys.

Covers (19): `TASK-004`, `TASK-006`, `TASK-007`, `TASK-010`, `TASK-011`, `TASK-012`, `TASK-013`, `TASK-014`, `TASK-015`, `TASK-017`, `TASK-019`, `TASK-020`, `TASK-021`, `TASK-022`, `TASK-023`, `TASK-024`, `TASK-025`, `TASK-027`, `TASK-028`.

### 10. Quick Add parity (M)

Priority and page chips with editors, the place picker, ⇧Return and ⌘Return, an offline queue, the in-window dialog and URL.

Covers (19): `QADD-001`, `QADD-002`, `QADD-003`, `QADD-004`, `QADD-005`, `QADD-007`, `QADD-008`, `QADD-009`, `QADD-010`, `QADD-011`, `QADD-012`, `QADD-013`, `SYS-049`, `SYS-050`, `MENU-009`, `MENU-010`, `AUTH-005`, `AUTH-014`, `AUTH-073`.

### 11. Foli AI chat (M)

Markdown answers with code blocks, linked citations, edit last question, Continue, context chips and attachments, share, copy, delete confirmation, credits and problem notices, memory list, model choice.

Covers (26): `AI-004`, `AI-008`, `AI-009`, `AI-012`, `AI-013`, `AI-014`, `AI-015`, `AI-016`, `AI-017`, `AI-018`, `AI-019`, `AI-020`, `AI-021`, `AI-022`, `AI-027`, `AI-028`, `AI-031`, `AI-035`, `AI-036`, `AI-037`, `AI-038`, `AI-039`, `AI-041`, `AI-044`, `SHARE-019`, `GAP-012`.

### 12. Search and command palette (M)

Recent searches and notes before typing, Updated filter and Clear, Folders and Tasks sections, keyboard through results, palette filters and scopes, capability gating, early keys.

Covers (28): `SRCH-002`, `SRCH-003`, `SRCH-008`, `SRCH-009`, `SRCH-010`, `SRCH-011`, `SRCH-013`, `SRCH-014`, `SRCH-016`, `SRCH-017`, `SRCH-018`, `SRCH-020`, `SRCH-022`, `SRCH-025`, `SRCH-026`, `SRCH-028`, `SRCH-030`, `SRCH-031`, `SRCH-032`, `SRCH-033`, `SRCH-034`, `SRCH-035`, `SRCH-037`, `GAP-016`, `GAP-025`, `MENU-023`, `MENU-025`, `MENU-065`.

### 13. Floating notes (S)

A pin toggle, a saved frame per note, a way back to its tab, the tab badge.

Covers (7): `APP-038`, `APP-039`, `APP-072`, `NOTE-039`, `SYS-051`, `TAB-024`, `TAB-042`.

### 14. Settings structure and search (M)

Today's order and names, a Library section, the Workspace group, Help and About, search with results tree, remembered section.

Covers (18): `SET-003`, `SET-005`, `SET-006`, `SET-007`, `SET-008`, `SET-014`, `SET-016`, `SET-019`, `SET-020`, `SET-021`, `SET-094`, `SET-116`, `SET-117`, `SET-125`, `SET-127`, `SET-128`, `MENU-018`, `RULE-022`.

### 15. Settings rows: account, AI, billing, security, devices (M)

Time zone popover, Save, AI switch in Account, memory card, local AI switch, provider and model, plan and billing, sign-in methods, passkeys, E2EE level, device limit, open-at-login default, offline readings.

Covers (33): `SET-026`, `SET-027`, `SET-036`, `SET-037`, `SET-038`, `SET-039`, `SET-040`, `SET-051`, `SET-053`, `SET-060`, `SET-061`, `SET-062`, `SET-063`, `SET-064`, `SET-065`, `SET-066`, `SET-067`, `SET-068`, `SET-069`, `SET-153`, `SET-070`, `SET-071`, `SET-074`, `SET-075`, `SET-077`, `SET-079`, `SET-081`, `SET-097`, `SET-098`, `GAP-007`, `GAP-008`, `GAP-010`, `MENU-057`.

### 16. Library settings (local mode) (M)

Location details, Dropbox and Google Drive connect, devices, health, passphrase change and removal, and an iCloud container so an iCloud Drive library works.

Covers (12): `SET-102`, `SET-104`, `SET-105`, `SET-106`, `SET-107`, `SET-108`, `SET-109`, `SET-111`, `SET-112`, `SET-152`, `SET-156`, `CAP-015`.

### 17. Gate screens per kind (M)

Today's per-kind layouts and words: mode choice, signed out with Apple and Google, offline, update, library setup and lock, E2EE unlock, approval, setup with the recovery key.

Covers (19): `AUTH-027`, `AUTH-028`, `AUTH-030`, `AUTH-031`, `AUTH-033`, `AUTH-034`, `AUTH-035`, `AUTH-036`, `AUTH-037`, `AUTH-038`, `AUTH-040`, `AUTH-041`, `AUTH-043`, `AUTH-044`, `AUTH-045`, `AUTH-046`, `GAP-031`, `GAP-036`, `GAP-040`.

### 18. Sidebar details (S)

Capability gating, Starred disclosure, Drafts and Reviews counts, heading links, folder sort menu, kept open folders, tag menu, hover "…".

Covers (14): `NAV-005`, `NAV-007`, `NAV-008`, `NAV-012`, `NAV-019`, `NAV-021`, `NAV-023`, `NAV-024`, `NAV-025`, `HOME-020`, `CTX-005`, `RULE-023`, `RULE-032`, `GAP-005`.

### 19. Places and accounts menu (S)

Plan badges, other accounts' workspaces and reminder dots, an unsynced check before sign-out, local-mode stand-in pages.

Covers (6): `AUTH-059`, `AUTH-064`, `AUTH-077`, `CTX-007`, `LIST-064`, `CHG-002`.

### 20. Links, URL scheme and launch routing (S)

Folevi-core://new, quick-add, search, #block, help and foli-ai routes, a queue for links before the first window, unknown paths.

Covers (13): `APP-035`, `APP-047`, `APP-053`, `APP-056`, `SYS-002`, `SYS-003`, `SYS-004`, `SYS-005`, `SYS-006`, `NAV-034`, `NAV-035`, `WEB-003`, `GAP-017`.

### 21. Mac notifications (S)

Notification categories and actions (reply, done, snooze), place subtitles, foreground rules.

Covers (6): `APP-029`, `NOTIF-010`, `SYS-038`, `SYS-039`, `SYS-040`, `SYS-041`.

### 22. Desktop capabilities follow-ups (S)

The bridge is in (Host/Capabilities.swift); left: note drags as Markdown file promises, Spotlight stamps and pruning, a native ask, share target, spelling details.

Covers (15): `BRIDGE-065`, `BRIDGE-066`, `BRIDGE-069`, `BRIDGE-070`, `BRIDGE-071`, `BRIDGE-074`, `BRIDGE-079`, `SYS-016`, `SYS-018`, `SYS-019`, `SYS-020`, `SYS-027`, `SYS-028`, `SYS-052`, `CAP-008`.

### 23. Changes, Shared with Me and shared folders (S)

The inline diff (changes.diff), headers with facts, proposal states, the People button and breadcrumb on shared folders.

Covers (15): `AUTH-079`, `AUTH-080`, `CHG-001`, `CHG-003`, `CHG-004`, `CHG-005`, `CHG-006`, `CHG-009`, `CHG-011`, `LIST-063`, `LIST-068`, `LIST-069`, `GAP-004`, `GAP-027`, `RULE-042`.

### 24. Home details (S)

Markdown brief with Refresh, the /catch-up page, Reviews card, empty states, carousel arrows, recent folders from folders.cards, card previews and image covers.

Covers (12): `HOME-005`, `HOME-006`, `HOME-007`, `HOME-008`, `HOME-010`, `HOME-011`, `HOME-012`, `HOME-015`, `HOME-016`, `APP-032`, `APP-033`, `NOTE-038`.

### 25. Lists, Folders page and Tags page (M)

Sort per view, compact cards, specific empty states, Folders page sort, layout, filter and search, Tags filter and sort, skeletons.

Covers (17): `LIST-007`, `LIST-021`, `LIST-023`, `LIST-031`, `LIST-033`, `LIST-036`, `LIST-037`, `LIST-038`, `LIST-040`, `LIST-061`, `FOLD-028`, `TAG-001`, `TAG-002`, `TAG-005`, `DRAFT-002`, `GAP-039`, `GAP-041`.

### 26. Note inspector details (S)

Outline scroll-to-top, comment segments and states, task counts and jumps, attachment jumps, prepare on touch-down.

Covers (5): `NOTE-002`, `NOTE-008`, `NOTE-009`, `NOTE-010`, `NOTE-011`.

### 27. Templates (S)

Your templates heading and count, Use button, New Page from Template, Generate with Foli AI.

Covers (8): `TPL-004`, `TPL-005`, `TPL-007`, `TPL-008`, `TPL-009`, `TPL-010`, `CTX-012`, `GAP-013`.

### 28. Notifications screen (S)

All / Unread filter, Today / Earlier groups, settings link, file-ready Download.

Covers (4): `NOTIF-002`, `NOTIF-003`, `NOTIF-004`, `NOTIF-009`.

### 29. Help, shortcuts and menu extras (S)

An in-app Help page with the shortcuts table, Keyboard Shortcuts, Dock and status item menus, Edit submenus, zoom, Foli AI keys, About.

Covers (28): `NOTE-045`, `NOTIF-012`, `NOTIF-013`, `NOTIF-015`, `NOTIF-016`, `NOTIF-017`, `NOTIF-018`, `MENU-007`, `MENU-027`, `MENU-028`, `MENU-029`, `MENU-030`, `MENU-058`, `MENU-067`, `MENU-072`, `MENU-073`, `MENU-077`, `MENU-078`, `MENU-081`, `APP-019`, `APP-050`, `APP-051`, `APP-061`, `APP-068`, `AI-042`, `AI-043`, `QADD-015`, `APP-069`.

### 30. App lock hardening (S)

Lock on session resign and screen lock, a cover that takes the keyboard, one prompt at a time, the 30 s grace.

Covers (6): `SYS-044`, `SYS-045`, `SYS-046`, `SYS-055`, `SYS-058`, `SYS-059`.

### 31. Performance and memory (S)

A launch snapshot, a memory-pressure source for PagePool.relieve, watches that end off screen.

Covers (3): `ARCH-015`, `SYNC-011`, `HOME-021`.

### 32. Design review against the owner's rules (S)

Hovers on every control, one control size, web icons in menus and toolbars, card sizes and spacing, the Mac UI guide.

Covers (10): `RULE-011`, `RULE-015`, `RULE-016`, `RULE-024`, `RULE-027`, `RULE-029`, `RULE-034`, `RULE-037`, `APP-023`, `APP-052`.

### 33. Release plumbing (S)

The update test channel's path for Core.

Covers (1): `UPD-004`.
