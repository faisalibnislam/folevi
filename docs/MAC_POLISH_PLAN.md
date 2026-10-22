# Mac polish plan (2026-10-22)

The goal: Folevi for Mac should feel like a first-class Mac app, at the level of Craft for Mac, Things 3 and Apple
Notes, while keeping Folevi's own look. This is the audit and the build plan. Nothing in it is built yet.

Owner decisions this plan follows (fixed):

- **Folevi's own look, polished**, the same decision as iOS (`docs/IOS_POLISH_PLAN.md`): Folevi's fonts stay
  (Spectral for display and note text, Instrument Sans for the interface), neutral chrome, notes carry colour.
  The hybrid stays: pages are web, native pieces where only native can do it.
- **The Mac app moves to WebKit** (`docs/MAC_WEBKIT_PLAN.md`, option A, built now): a thin AppKit app with
  WKWebView. So every native piece in this plan (menu bar, context menus, title bar, windows, Quick Add, menu bar
  icon, Dock, Settings window, notifications) is designed for the AppKit app, **not built in Electron**. The
  web-layer items are shared: they land in the web app, improve today's Electron app at once and carry over
  unchanged.

How the audit was made: Folevi for Mac from source (`apps/desktop`, Electron 44, the bundled interface at
`app://folevi` from the development shell export, `FOLEVI_USER_DATA` in the session scratchpad, never the
owner's), driven by a Playwright script (`_electron`), each window captured with `screencapture -l` (so the
traffic lights and the window's own corners show), light and dark, at 1280 × 820: the first-launch choice, the
library setup, Home, a note, the slash menu, the editor and tab right-click menus, the sidebar hidden, the
command palette, the account menu, Tasks, Calendar, Settings, Settings > Desktop app, a dialog (New folder), Quick
Add, and every menu of the menu bar. Sizes, fonts, colours, hover and cursor states were read from the live DOM.
The screenshots are in the session scratchpad (`mac-audit/shots/`), not in the repository; the scripts
(`mac-audit/audit.mjs`, `measure.mjs`) recreate them. Not captured: the menu bar icon's menu and Mac
notifications (Electron offers no way to open them from a script; read from `main.ts` instead), account-only
screens (signing in from the bundled interface goes through the browser), and the canvas (the starter library
has no canvas page).

---

## 1. What keeps it from feeling like a Mac app today (the short list)

In order of how much each one costs:

1. **The text menu is missing.** Right-click on text gives Folevi's block menu; Shift-right-click, which the
   editor keeps for "the browser's own menu (spelling suggestions live there)", shows nothing, because Electron
   has no default context menu and `main.ts` adds none. So spelling suggestions, Look Up, Translate, Writing
   Tools, Services and Speech are unreachable anywhere in the app, while `spellcheck: true` underlines words.
2. **The menu bar is a browser's.** View has Reload (⌘R), Force Reload and Toggle Developer Tools; there's no
   Format menu, no Find, no Note menu, no tab commands, no View > Show Sidebar, no Print. The app's real
   shortcuts (⌘K, ⌘\, ⌥⌘I, ⌘J, ⇧⌘A, ⌥⌘T, ⌥⌘1 to 3, ⌘B / ⌘I / ⌘U, ⇧⌘X, ⌘E, ⇧⌘H) live only in the page and
   appear in no menu. ⌘W closes (hides) the window although the window has tabs.
3. **Every control shows the pointing hand** (`cursor: pointer` on sidebar rows, toolbar buttons, menu items).
   Mac apps show the arrow for controls; the hand is for links.
4. **The chrome is selectable text** (`user-select: auto` on the sidebar, tab strip and toolbars): a drag across
   the sidebar selects its labels.
5. **Quick Add is a web form in a borderless window**: a title, a help line, three labelled fields, a "None ⌄"
   select and Cancel / Add task buttons (Things' Quick Entry and Raycast are one field that grows). Electron has
   to switch the whole app to a background app and back to float it over full-screen apps.
6. **No Dock menu, no state restoration beyond the first window, Settings inside the main window**, every
   window titled "<page> · Folevi", nothing in the Window menu but Minimize, Zoom and Bring All to Front.
7. **Menus are sized for touch-and-web, not pointer**: 32 pt rows, 224 wide, 14 radius, opened on click (Mac
   menus open on mouse-down and select on release).
8. **Focus rings and selection don't know about the Mac**: the ring stays on a button after a menu closes from
   the keyboard; the sidebar's selected row doesn't dim when the window is in the background.

What already works well: the seamless title bar with the traffic lights placed in the sidebar's top bar and
moving with it, the Craft-style inset content panel, Spectral headings, the neutral palette in both themes, the
command palette, the light and dark themes following the system.

---

## 2. The specs (what "polished" means on the Mac, in numbers)

Points are macOS points (CSS px at 100 % zoom). Measured today in brackets.

### 2.1 Layout

| Thing | Spec |
| --- | --- |
| Window minimum | 800 × 480 (unchanged: below 768 the web switches to its phone layout) |
| New window default | 1280 × 820, centred on the screen with the pointer; first launch 920 × 640 (the choice screen needs no more) |
| Top bar | 52 tall, the page's bar and the traffic space share one centre line [the traffic space is 60 × 52 at 20, 8] |
| Traffic lights | 14 pt buttons, 20 apart, first at x 20, centred on the top bar's centre line, always (resize, full screen exit, appearance change) |
| Sidebar | 264 default [264], resizable 220 to 360, rows 32 [32], 13.5 / 21 Instrument Sans [13.5], 8 inset, radius 6 (chip) [6], icon 18 in a 20 box |
| Sidebar section headers | 11.5 / 16, 600, uppercase, 0.06em, muted, 20 above, 6 below |
| Toolbar buttons | 28 × 28 hit area 32 × 32 [32 × 32], icon 16 at stroke 1.75, radius 6 [6] |
| Search field (sidebar) | 32 tall [36], radius 8 (small) [10], 13 text, ⌘K hint 11.5 in a 4-radius keycap |
| Tabs (tab strip) | 32 tall, 12 / 8 padding, 13 text, radius 8, active tab the content colour with a 1 pt edge, close button 16 on hover only (always on the active tab) |
| Content panel | inset 8 from the window edge and the sidebar, radius 14 (panel) at the top corners and the window's own corner radius at the bottom (macOS 26: 16), 1 pt edge `--color-line` in dark only |
| Note column | unchanged (the editor's own measure) |
| Scroll insets | content scrolls under the top bar with a 12 pt fade mask, never under the traffic lights |

### 2.2 Type (Folevi fonts, Mac sizes)

The Mac reads smaller than the phone: Mac body text is 13 pt where iOS is 17.

| Role | Font | Size / line | Weight |
| --- | --- | --- | --- |
| Page title (Home, Tasks) | Spectral | 28 / 34 | 600 |
| Section title ("Recent notes") | Spectral | 22 / 28 [22 / 34] | 600 |
| Interface body (rows, menus, fields, buttons) | Instrument Sans | 13.5 / 20 | 400 |
| Secondary (subtitles, sidebar captions, dates) | Instrument Sans | 12 / 16 | 400 |
| Small caps headers | Instrument Sans | 11.5 / 16 | 600, uppercase, 0.06em |
| Keyboard hints in menus | Instrument Sans | 12.5 / 16 | 400, muted, tabular |
| Note text | Spectral | the editor's own sizes (unchanged) | |

### 2.3 Materials, colour, radii

- **Radii** only from the token scale (`tiny 4, chip 6, small 8, control 10, panel 14, container 18`; sheet,
  float and capsule stay iPhone-only): menu 10 (control), menu item 6 (chip), dialog 14 (panel), Quick Add 18
  (container), tooltip 6, button 8, field 8, keycap 4.
- **Sidebar**: decision M3. Proposed default: Folevi's neutral solid (today's `--color-sidebar`), which follows
  the "neutral chrome" rule; with M3 "vibrancy", the AppKit app puts an `NSVisualEffectView` (`.sidebar`
  material, `.behindWindow`, `.followsWindowActiveState`) behind the web view and the page draws the sidebar
  transparent under `:root[data-vibrancy]`.
- **Menus and popovers** (web): `backdrop-filter: blur(24px) saturate(1.8)` over light rgb(255 255 255 / 0.82),
  dark rgb(40 40 44 / 0.86) [white 0.8, no saturation], a 0.5 pt edge rgb(0 0 0 / 0.12) light,
  rgb(255 255 255 / 0.10) dark, shadow `0 10px 30px rgb(0 0 0 / 0.16), 0 0 0 0.5px rgb(0 0 0 / 0.08)`.
- **Selection**: the active sidebar row's fill is rgb(0 0 0 / 0.07) light, rgb(255 255 255 / 0.09) dark
  [white 0.85 on the grey sidebar]; in an inactive window it drops to 60 % (Notes and Things do this).
  Selected cards: 2 pt `--color-ink` ring in the key window, `--color-line-strong` in an inactive one.
- **Hairlines**: 1 pt `--color-line` (separators, the tab strip's bottom edge), 0.5 pt only on Retina for
  menus.
- **Reduce Transparency** (`prefers-reduced-transparency`): menus and popovers solid
  (`--color-surface-raised`), no blur. **Increase Contrast** (`prefers-contrast: more`): edges `--color-line-strong`,
  muted text one step darker.

### 2.4 Pointer, hover, press

| State | Spec |
| --- | --- |
| Cursor | `default` (the arrow) for every control in the chrome: rows, buttons, tabs, menu items, cards [`pointer`]; `pointer` only for links in note text and Help; `text` in fields and the editor; `col-resize` on the sidebar's edge [already]; `grab` / `grabbing` on block handles |
| Hover | fill rgb(0 0 0 / 0.05) light, rgb(255 255 255 / 0.06) dark [0.05 light], no transition on enter, 120 ms fade on leave; no hover effects while a mouse button is down elsewhere |
| Press | fill rgb(0 0 0 / 0.09) light, rgb(255 255 255 / 0.10) dark while held; no scale effects on the Mac |
| Disabled | 40 % opacity, arrow cursor, no hover |
| Tooltips | after 700 ms of rest, 0 ms once one has shown (until 1 s passes with none), 12 / 16 text, 6 radius, the shortcut in a keycap; never on touch |

### 2.5 Keyboard and focus

- Focus rings only after keyboard input: `:root[data-desktop="mac"]` gets the iPhone's `data-input="key"` rule
  (set on the first Tab, arrow or shortcut, cleared on the next mouse-down), so `:focus-visible` rings never
  show after a click or after a menu closes from a click. Ring: 2 pt `--color-focus`, 2 pt offset [already
  the shape].
- Full keyboard access: with macOS "Keyboard navigation" on, Tab reaches every control in the chrome (sidebar
  rows, toolbar, tabs, menus) in reading order; without it, Tab moves between fields and lists only (the Mac
  rule). The AppKit app tells the page (`data-keyboard-navigation` from
  `NSApp.isFullKeyboardAccessEnabled`).
- Every command reachable from the keyboard has its shortcut in the menu bar (3.1), and in tooltips.
- Type-to-select in lists (sidebar, note lists, menus): typing a name's first letters moves the selection.

### 2.6 Motion

| Motion | Spec |
| --- | --- |
| Menu open | instant (0 ms) on mouse-down; close 150 ms fade, as AppKit |
| Popover | 120 ms fade and 4 pt rise; close 100 ms |
| Sheet-style dialog | slides 8 pt down from under the top bar with a fade, 180 ms ease-out; no dim behind it (Mac sheets don't dim); close 150 ms |
| Sidebar show / hide | 220 ms ease-in-out width, the content panel follows in the same frame |
| Tab open / close | 160 ms width ease-out |
| Reduce Motion | every movement becomes a 120 ms fade |

---

## 3. Findings and specs by area

### 3.1 The menu bar (native, AppKit app)

Today (`main.ts` `buildMenu`): Folevi (About, Check for Updates, Settings ⌘,, Services, Hide, Hide Others, Show
All, Quit), File (New Note ⌘N, Quick Add Task ⌥Space, New Window ⇧⌘N, Close Window ⌘W), Edit (Electron's role:
Undo, Redo, Cut, Copy, Paste, Paste and Match Style ⌥⇧⌘V, Delete, Select All, Substitutions, Speech), View
(Reload ⌘R, Force Reload ⇧⌘R, Toggle Developer Tools ⌥⇧⌘I, Actual Size, Zoom In, Zoom Out, Toggle Full Screen
⌃⌘F), Go (Back ⌘[, Forward ⌘], Notes, Tasks, Calendar), Window (Minimize ⌘M, Zoom, Bring All to Front), Help
(Folevi Help).

Findings: browser items in a notes app (⌘R reloads the whole interface mid-edit); no Format, Note or Find; no tab
commands; the page's shortcuts aren't in any menu; Go's items have no shortcuts; ⌘W closes the window instead
of the tab; the Window menu doesn't list windows by note; Help has no shortcuts list.

Spec (every item sends a command to the key window's page through `desktop.onCommand`, except the system roles;
items the page can't do right now are disabled through `desktop.setMenuState({ ... })`, which the page sends on
route and selection change):

| Menu | Items (shortcut) |
| --- | --- |
| **Folevi** | About Folevi; Check for Updates…; separator; Settings… (⌘,); separator; Services ▸; separator; Hide Folevi (⌘H), Hide Others (⌥⌘H), Show All; separator; Quit Folevi (⌘Q) |
| **File** | New Note (⌘N); New Note from Template… (⌥⇧⌘N); New Folder (⌃⌘N); Quick Add Task… (⇧⌘A), with "Quick Add from Any App" (⌥Space, the global shortcut) shown as its own line; separator; New Tab (⌘T); New Window (⇧⌘N); Open Quickly… (⌘K, the palette); separator; Close Tab (⌘W, closes the window when it has one tab); Close Window (⇧⌘W); Reopen Closed Tab (⇧⌘T); separator; Import…; Export… (⇧⌘E); separator; Share ▸ (the `NSSharingServicePicker` services); Print… (⌘P) |
| **Edit** | Undo "…" (⌘Z), Redo (⇧⌘Z); separator; Cut (⌘X), Copy (⌘C), Paste (⌘V), Paste and Match Style (⌥⇧⌘V), Delete, Select All (⌘A); separator; Find ▸ (Find… ⌘F, Find Next ⌘G, Find Previous ⇧⌘G, Use Selection for Find with no shortcut, since ⌘E is inline code); Search All Notes (⇧⌘F); separator; Spelling and Grammar ▸; Substitutions ▸; Transformations ▸; Speech ▸; then AutoFill, Start Dictation and Emoji & Symbols, which macOS adds |
| **Format** | Bold (⌘B), Italic (⌘I), Underline (⌘U), Strikethrough (⇧⌘X), Inline Code (⌘E), Highlight (⇧⌘H); Link… (⌥⌘K); separator; Heading 1, 2, 3 (⌥⌘1 / 2 / 3); Body Text (⌥⌘0); Bulleted List (⇧⌘8), Numbered List (⇧⌘7), Checklist (⇧⌘9); separator; Indent (Tab), Outdent (⇧Tab); Move Block Up (⌥⇧↑), Move Block Down (⌥⇧↓); Duplicate Block (⌘D); separator; Style ▸ (the note's style panel) |
| **Note** | Star; Archive; Move to… (⇧⌘M); Duplicate; Copy Link (⌃⌘C); Version History…; Lock or Unlock (encrypted spaces); separator; Move to Trash (⌘⌫) |
| **View** | Show / Hide Sidebar (⌘\ as today, and ⌃⌘S, Apple's standard, as an alternate); Show / Hide Inspector (⌥⌘I); Focus Mode (⇧⌘\); separator; As Cards, As List (⌘1, ⌘2 in a note list); separator; Actual Size (⌘0), Zoom In (⌘+), Zoom Out (⌘-); separator; Enter Full Screen (⌃⌘F, the system item) |
| **Go** | Back (⌘[), Forward (⌘]); separator; Home; Today's Tasks (⌥⌘T); Calendar (⌥⌘C); Inbox; Search… (⌘K); Ask Foli AI (⌘J, hidden when AI is off); separator; Next Tab (⌃Tab and ⇧⌘]), Previous Tab (⌃⇧Tab and ⇧⌘[); Tab 1 to 9 (⌘1 to ⌘9, except while a note list has focus, where ⌘1 and ⌘2 pick the view) |
| **Window** | Minimize (⌘M), Zoom, Fill, Centre (macOS 15 tiling items, added by the system); separator; Folevi windows by title (the note's title, not "· Folevi"); separator; Bring All to Front |
| **Help** | the system search field; Folevi Help; Keyboard Shortcuts (⌘/); What's New; Send Feedback… |

Shortcut conflicts settled: ⌘E stays inline code (the web's), so "Use Selection for Find" has none; ⌘J stays Foli
AI; ⇧⌘H stays Highlight, so Home has none; ⌥⌘N stays the web's new note; ⌘S does nothing (Folevi saves itself). Developer items (Reload, Force Reload, Developer Tools)
move to a Debug menu that exists only in Debug builds.

### 3.2 Context menus: native for text, Folevi's for objects

Today: Folevi's web context menus everywhere (`AppContextMenu.tsx` for the app, `EditorContextMenu.tsx` for the
note, plus tab, card, folder and whiteboard menus); measured 224 wide, 32 pt rows, 13.5 text, menu radius 14,
item radius 8, white 0.8. No native menu anywhere, so the text services are unreachable (section 1, item 1).

Spec for the AppKit app (decision M1):

- **Object menus stay Folevi's web menus** (cards, rows, folders, tags, tabs, blocks' handle, links' "…",
  whiteboard strokes), consistent with the iOS decision (Folevi fonts), restyled to 3.14.
- **Text gets the native menu** (`NSMenu` from WKWebView, adjusted in `willOpenMenu(_:with:)` by
  `TextMenu.swift`): right-click on selected text, on a misspelt word, or in a text field shows macOS's menu
  (spelling suggestions at the top, Look Up, Translate, Search with Google removed, Cut / Copy / Paste,
  Writing Tools per M5, Services, Speech) with Folevi's items added in one group at the top: Ask Foli AI about
  this (AI on), Turn into Link…, Copy Link to Block, Comment. The page tells the host what's under the pointer on
  `contextmenu` (`desktop.contextTarget({ kind: "text" | "object", items })`) before WebKit asks for the menu,
  and calls `preventDefault()` only for objects.
- Right-click on a link in note text: Folevi's link menu (it has Open, Open in New Tab, Copy Link, Edit Link);
  the native one's "Open Link in New Window" can't be honoured. ⌃-click equals right-click everywhere.
- Electron (until it's retired): add the missing text menu with Electron's `context-menu` event
  (`dictionarySuggestions`, `replaceMisspelling`, Look Up through `showDefinitionForSelection`) only if the
  switch-over slips past a month; otherwise leave Electron as it is.

### 3.3 Title bar and traffic lights (native)

Today: no title bar; the page keeps `.ui-traffic-space` (60 × 52) in the sidebar's top bar or the tab strip and
reports it (`placeWindowButtons`); `-webkit-app-region: drag` on `.ui-drag` and an 8 pt (36 pt outside canvases)
drag strip across the top (`body::before`). Findings: in full screen the page isn't told, so the 60 pt traffic
space stays empty where there are no buttons; double-clicking the top bar ignores the system setting (zoom or
minimise); the window title is "<page> · Folevi".

Spec:

- `NSWindow` with `.fullSizeContentView`, `titlebarAppearsTransparent`, `titleVisibility = .hidden`, and an empty
  `NSToolbar` (`.unifiedCompact` is not used: its height fights the page's 52 pt bar); traffic lights placed by
  `TitleBar.swift` from the page's report (`docs/MAC_WEBKIT_PLAN.md` §6.4), first button at x 20, centred on the
  bar's centre line.
- Dragging by the top bar through reported drag regions (§6.3 there); double-click follows
  `AppleActionOnDoubleClick`.
- Full screen: `data-fullscreen` on `<html>`; the traffic space collapses to 0 with the 220 ms sidebar curve; the
  top bar's content moves left; the system shows the buttons on hover at the top edge.
- `window.title` = the note's or page's own title (no "· Folevi"), so the Window menu, Mission Control and ⌘`
  name windows; `representedURL` stays nil (notes aren't files), `isDocumentEdited` stays false (Folevi saves
  itself).
- Inactive window: `data-window-active="false"` on `<html>` (from `didBecomeKey` / `didResignKey`); the page dims
  selection (2.3) and its toolbar icons to 70 %.

### 3.4 Toolbar, sidebar and materials (web, shared)

Findings: chrome text is selectable (`user-select: auto`); the active sidebar row is a white pill on grey (reads
as a button, Notes and Things use a quiet fill); toolbar icons are 32 pt boxes with 16 pt icons (fine) but the
search field (36) is taller than the rows (32); the "New note" button is a heavy black pill in the top right
(Craft keeps a quiet "+" in the toolbar; Things the "+" at the bottom); the floating "Ask Foli AI" pill covers
content at the bottom right of every page; the "Sign in to Folevi to share and collaborate" line sits above the
account row in local mode on every screen.

Spec: `user-select: none` and `-webkit-user-select: none` on every chrome region (sidebar, tab strip, top bar,
menus, dialogs' chrome, Quick Add's labels), `text` only in content and fields; the sidebar per 2.1 and 2.3; the
search field 32; "New note" as a 28 pt "+" icon button with the tooltip "New Note ⌘N" (the label can return as a
setting); "Ask Foli AI" as a toolbar button (sparkle icon, ⌘J) instead of a floating pill on the Mac; the
sign-in line moves into the account menu ("Sign in to share and collaborate…"). Materials per 2.3 and M3.

### 3.5 Windows (native)

Today: one remembered frame (the first window's, `window.json`), other windows open at the same size with no
position; macOS restoration switched off (`ApplePersistenceIgnoreState`) because of a "reopen windows?" alert
after forced quits; closing the first window hides it; ⇧⌘N opens a window at /documents; full screen works;
native window tabs not offered.

Spec:

- **Restoration**: every main window's frame, its tab set and active tab (the page sends `desktop.windowState({
  tabs, active })` on change) saved in `windows.json`; on launch all come back where they were, in the place that
  was open. No macOS restoration alert (the AppKit app doesn't use `NSQuitAlwaysKeepsWindows` restoration).
- **Closing**: ⌘W closes the tab, the window when it's the last tab; closing the last window keeps the app
  running (Quick Add, menu bar icon) as today; the Dock icon or ⌘N opens a window again.
- **New windows** cascade 24 pt from the key window; "Open in New Window" in object menus (cards, rows, tabs)
  and ⌥-click on a note link.
- **Native window tabs** off (`allowsAutomaticWindowTabbing = false`; decision M4): Folevi's tab strip is the tab
  model.
- **Full screen** per 3.3; **Split View and tiling**: the 800 pt minimum width allows half of a 1600 pt-wide
  screen; below 1000 pt wide the sidebar auto-hides (as Notes).
- **Sizes**: minimum 800 × 480; Quick Add fixed width; Settings window fixed width.

### 3.6 Keyboard (web and native)

Findings: the page's shortcuts aren't in menus (3.1); ⌘1 to ⌘9 unused; no ⌘T / ⇧⌘T / ⌃Tab for tabs; no ⌘F in
a note (the palette searches everything, a note has no find bar); no ⌘/ for the shortcuts list; arrow keys in the
sidebar don't move the selection; Return on a selected card doesn't open it; Escape doesn't always leave a field
(Quick Add yes, the palette yes, the sidebar search no). Focus ring remains after a keyboard-closed menu (1, item
8).

Spec: the menu bar of 3.1 is the complete shortcut map; in the page:

- Lists (sidebar, note lists, card grids, Tasks): ↑ ↓ (and ← → in grids) move the selection, Return opens,
  Space previews (Quick Look style panel of the note), ⌘⌫ moves to Trash, type-to-select.
- A note: ⌘F opens a find bar under the top bar (32 tall, matches highlighted with `--color-selection`, ⌘G / ⇧⌘G
  step, Escape closes); ⇧⌘F searches all notes (the palette in search mode).
- Focus per 2.5.

### 3.7 Hover and pointer (web, shared)

Findings: `cursor: pointer` on every control (measured on sidebar rows, buttons, menu items); hover fills exist
(0.05) but some controls have none (tabs when inactive, the tab strip's back / forward arrows); "…" buttons on
cards and folders show only on hover (fine on the Mac, keep); tooltips use the browser's `title` delay in places
and the app's own in others.

Spec: 2.4, applied by the Mac CSS block (cursor and hover) and one tooltip component everywhere.

### 3.8 Quick Add (native panel, web form)

Today: a 520 × 320 borderless, always-on-top window (`frame: false`, `alwaysOnTop`, visible on all workspaces,
which forces `setActivationPolicy` back and forth), placed at 28 % from the top of the screen with the pointer,
hidden on blur; the page is the full web form "Quick add task" with Due date, Priority (a Select showing
"None ⌄"), "Add to" (Inbox or a page), Cancel and Add task buttons, and the line "Tasks without a page go to your
Inbox". In dark it's a black card with grey fields.

Spec (Things' Quick Entry and Raycast are the references):

- **Native**: `QuickAddPanel`, an `NSPanel` with `.nonactivatingPanel`, `.titled` hidden, `.fullSizeContentView`,
  level `.floating`, `collectionBehavior` `.canJoinAllSpaces` + `.fullScreenAuxiliary` + `.transient`,
  `becomesKeyOnlyIfNeeded = false` (it takes the keyboard without activating Folevi, so the app in front stays in
  front and full-screen Spaces don't switch); an `NSVisualEffectView` `.hudWindow` material under a transparent
  page; corner radius 18 (container); 640 wide; placed at 28 % from the top of the screen with the pointer;
  Escape or a click outside closes it (150 ms fade); the global shortcut through Carbon `RegisterEventHotKey`
  (⌥Space default, changeable, off allowed) with no Accessibility permission.
- **Web form** (`DesktopQuickAdd.tsx`, Mac variant): one 56 pt row: a 20 pt checkbox outline, the title field
  (17 / 24 Instrument Sans, placeholder "New task"), and on the right the place it goes as a quiet chip ("Inbox");
  as the person types, natural-language tokens become chips inline ("tomorrow 9am" → a date chip, "!high" →
  priority, "#Project" or "in Project" → the page, "@Sam" in a workspace → assignee), each removable; a second
  48 pt row appears only once there is something to show (the chips' editors: date, priority, page) with
  keyboard access (Tab moves into it); Return adds and closes, ⌘Return adds and opens the task in the main window,
  ⇧Return adds and keeps the panel open for another; the panel grows with its content (`sizeQuickAdd`), 56 to
  160 tall. No title, no help line, no Cancel or Add buttons (Return and Escape, with a 12 pt hint line on first
  use only). The place picker of `docs/MULTI_ACCOUNT_PLAN.md` §6 becomes the chip's menu when more than one place
  exists.
- After adding: a 1.2 s confirmation in the panel ("Added to Inbox", with Open) instead of a Mac notification
  (today a notification says where it went).

### 3.9 Menu bar icon and Dock (native)

Today (from `main.ts` `updateTray`): a template "F" icon; its menu: Quick Add Task… (the shortcut shown), New
Note, separator, "Recent notes" (disabled header) and up to 8 notes, separator, the save state line (disabled),
separator, Open Folevi, Settings…, separator, Quit Folevi. No Dock menu. The Dock badge shows the unread count
summed over places.

Spec:

- **Status item** (`NSStatusItem`, 18 pt template image, `button.toolTip = "Folevi"`): a left click opens the
  menu: Quick Add Task… (⌥Space shown), New Note, Search Folevi… (opens the palette in the key window);
  separator; recent notes (up to 8, with the note's icon and its place when there are several places, ⌘1 to ⌘8
  while the menu is open); separator; the save state with a coloured status dot (saved, saving, offline,
  error); when more than one place: a Places ▸ submenu (the open place checked; choosing one switches);
  separator; Open Folevi, Settings… (⌘,); separator; Quit Folevi (⌘Q). An option to hide it stays in Settings.
- **Dock menu** (`applicationDockMenu`): New Note, Quick Add Task, New Window; separator; up to 5 recent notes;
  separator; Places ▸ when more than one. The badge as today.

### 3.10 Settings window (native window, web content; decision M2)

Today: Settings is a page in the main window (`/settings/...`), with its own section list and the main sidebar
and tab strip still around it; ⌘, opens Settings > Desktop app in the main window.

Spec if M2 is "a Settings window" (proposed, the Mac convention):

- ⌘, opens (or brings forward) one Settings window: `NSWindow` 720 wide, height fitting the section (480 to
  720), not resizable horizontally, titled with the section's name; an `NSToolbar` with `.preference` style and
  one item per section, SF Symbols in the system's style (the one place in the app the native toolbar draws;
  symbols, not Folevi's icons, since it is native chrome): General (the Mac app's own settings, today's "Desktop
  app"), Appearance, Library or Account, Foli AI (hidden when AI is off), Import & Export, Shortcuts, and the
  account sections when signed in (Profile, Devices, Workspace, Billing on the website only).
- Content: its own `WKWebView` at `/settings/<section>?window=1`; the page renders the section alone (no
  sidebar, no tab strip, no section list), 32 pt side insets, grouped rows per 3.14.
- The window remembers its last section and position. Escape closes it; ⌘W closes it.
- If M2 is "keep it in the main window": ⌘, opens Settings in a new tab of the key window, and the section list
  gets the 2.1 sidebar row style.

### 3.11 Notifications (native)

Today: `new Notification({ title, body })` for mentions, comments and reminders while Folevi isn't in front,
labelled "Work · …" when from another place; clicking opens the page; reminders in local mode are timers in the
running app (`reminders.ts`), so they don't fire while Folevi is quit. No actions, no grouping, no reply.

Spec (`UNUserNotificationCenter`, from iOS `ShellServices` plus Mac categories):

- Categories: **mention / comment**: actions Reply (text input, sent as a comment reply), Mark as Read;
  **reminder**: Complete, Snooze ▸ (1 hour, This Evening, Tomorrow); **task assigned**: Open, Complete.
- `threadIdentifier` per note (they group under the note), `subtitle` the place's label when there are several
  places (multi-account plan §5.2), `summaryArgument` the note title.
- Reminders are scheduled with the system, so they fire with Folevi quit.
- Shown while Folevi is in front only for reminders (banner), never for activity in the note being viewed.
- The Dock badge clears per place as notifications are read; Settings > General keeps the switch for Mac
  notifications.

### 3.12 Scrolling and selection (web, shared)

Findings: the scrollbars follow the system (overlay or always, fine); content doesn't fade under the top bar;
the home page's horizontal card row ("Recent notes") scrolls with a "›" button that sits over the last card's
text; text selection works in notes; selection colour neutral.

Spec: overscroll bounce only in the scrolling region that has it (`overscroll-behavior: contain` on scrollers;
the window itself never bounces); a 12 pt fade mask under the top bar; horizontal card rows scroll with a
trackpad's horizontal swipe and Shift + wheel, with edge fades 24 pt and the arrow buttons outside the cards
(28 pt round, on hover only); scroll position kept per tab when switching tabs; ⌥-click on a scrollbar jumps (a
system behaviour WebKit keeps).

### 3.13 Drag and drop with Finder (native and web)

Today: dropping files from Finder onto a note works (web `DataTransfer`); dragging out works only from the Export
dialog (a temporary Markdown file through `startDrag`, with a quit hang worked around in `main.ts`).

Spec (WM5):

- Drag a note card, row or tab to Finder, Mail or another app: a Markdown file named after the note
  (`NSFilePromiseProvider`, written when dropped, with its attachments in a folder beside it when it has any);
  to another Folevi window or tab strip: moves the tab.
- Drag an attachment, image, audio or PDF block out: the original file.
- Drag files or a folder from Finder onto the sidebar or a folder: import into that folder (Markdown, text,
  images, PDFs; a folder keeps its structure); onto a note: attachments at the drop point (as today).
- Drag feedback: the dragged item lifts with a 0.9 opacity snapshot; drop targets get a 2 pt `--color-ink` ring
  and a 0.04 fill.

### 3.14 Web menus, dialogs and the palette (web, shared)

Findings: menus 224 wide with 32 pt rows (touch-sized), open on click, close on click; separators 1 pt with
little air; dialogs (New folder) are centred panels with no dim and a heavy grey disabled button; the command
palette is good (filters, recents, actions with shortcuts).

Spec:

- **Menus on the Mac** (`:root[data-desktop="mac"]` and the website on a Mac with a mouse): minimum width 200,
  rows 26 tall, 13.5 / 18 text, icon 16 at 8 inset (or no icons in menus that have none), the shortcut right
  aligned 12.5 muted, container padding 5, separators 1 pt with 5 above and below and 10 inset; submenu arrow
  10 pt; open on mouse-down, select on mouse-up after a drag (press, drag, release picks an item), type-to-select,
  ← → for submenus, Escape closes one level; material per 2.3; radius 10 / item 6; checked items with a 12 pt
  check in the leading 16; destructive items in `--color-danger` text only (no red background).
- **Dialogs**: forms (New folder, Rename, Share) as sheet-style panels per 2.6 (attached under the top bar, 480
  wide, radius 14, no dim, the window's content inert behind); confirmations (delete, empty Trash, sign out)
  as native `NSAlert` sheets in the AppKit app (system font, like Craft's; through
  `desktop.confirm({ title, message, actions })` with the web Dialog as the fallback); default button on Return,
  Cancel on Escape and ⌘.; destructive default only when the action can be undone.
- **Buttons**: 28 tall (fields 28), radius 8, primary `--color-ink` fill, secondary 1 pt edge, disabled 40 %
  (not grey fill).
- **Palette**: keep; 640 wide, rows 36, the shortcut column per menus.

### 3.15 Accessibility (both)

Findings: landmarks exist (the sidebar is `nav` "Folio"); WebKit's accessibility tree is the system's own in
the AppKit app (VoiceOver rotor, item chooser, Hover Text work without extra work), Chromium's in Electron;
menus are `role="menu"` with `menuitem`; the traffic space is an empty `div` (whether VoiceOver skips it is
unverified; WM4 checks); Quick Add's fields are labelled.

Spec: every icon button has an accessible name that matches its tooltip and menu item; window titles per 3.3
(VoiceOver reads them); `aria-keyshortcuts` on controls with shortcuts; Reduce Motion, Reduce Transparency,
Increase Contrast and the system text size (the app's zoom, ⌘+ / ⌘-, remembered) all honoured; full keyboard
access per 2.5; a VoiceOver pass on the main window, a note, Quick Add, Settings and the menus before sign-off.

### 3.16 First run, sign-in, the library and several places (web, plus the native sign-in sheet)

Findings: the first-launch choice ("Where should your notes live?") and the library setup ("Where should your
library live?": Sync with iCloud, Choose a folder, This device only) are clean and centred, but open in a
1280 × 820 window for 520 pt of content; "Sign in to Folevi" sends the person to the default browser and back
through a `folevi://` link (Electron can't host the sign-in page); switching places reloads every window with a
white flash; the account menu at the sidebar's bottom works.

Spec: first-launch window 920 × 640 (2.1); the choice buttons 64 tall with 14 radius and the hover of 2.4;
sign-in through `ASWebAuthenticationSession` as a sheet on the window (passkeys, Google and Apple work there,
`docs/MAC_WEBKIT_PLAN.md` §5.1, WM1); "Choose a folder" opens `NSOpenPanel` as a sheet with "Use This Folder";
switching places cross-fades (the old page stays on screen until the new one paints its first frame,
`WKWebView` `isLoading` then a 150 ms fade); with several places the Window menu names each window's place
("Welcome to Folevi (Work)") while the window title stays the note's.

---

## 4. Native or web, piece by piece

| Piece | Where | Why |
| --- | --- | --- |
| Menu bar, Dock menu, status item menu | native `NSMenu` | only native exists there |
| Text context menu (spelling, Look Up, Writing Tools, Services) | native `NSMenu` (WKWebView's, adjusted) | the services can't be rebuilt in web |
| Object context menus, popovers, the palette | web, Folevi fonts | the iOS decision (D1), feature parity with the web |
| Confirmations | native `NSAlert` sheet, web fallback | Mac users expect them; system font accepted for alerts (as Craft) |
| Form dialogs | web, sheet-style | they hold Folevi's own controls |
| Title bar, traffic lights, window drag | native, placed by the page | |
| Sidebar material | per M3 (native `NSVisualEffectView` behind a transparent web sidebar, or web solid) | |
| Quick Add | native `NSPanel`, web form | only a panel can float without activating |
| Settings | native window and toolbar, web content (M2) | |
| Notifications | native | |
| Sign-in | native `ASWebAuthenticationSession` sheet | passkeys and providers |
| Find in a note | web find bar | it's the editor's content |
| Print | native `printOperation`, web print layout | |

---

## 5. Work packages

These are the packages of `docs/MAC_WEBKIT_PLAN.md` §10; this table says which polish items each one builds and
how each is verified. WM4 (web) can start today and improves the Electron app until the switch-over; the native
items wait for WM0.

| Package | Builds | Owns (polish files) | Verified by |
| --- | --- | --- | --- |
| **WM2 Mac chrome** (AppKit) | 3.1 menu bar, 3.2 native text menu, 3.3 title bar, 3.5 windows, 3.8 the panel, 3.9 status item and Dock, 3.10 Settings window, 3.11 notifications, 3.14 native alerts | `apps/mac/Folevi/Chrome/*`, `DesktopRouter.swift`, `Services/Notifications.swift`; additive edits in `DesktopBridge.tsx`, `lib/desktop.ts` (commands, menu state, drag regions, `data-fullscreen`, `data-window-active`, `contextTarget`, `confirm`) | XCTest for the menu model (every item has a command, shortcuts unique and matching the page's); `apps/mac/scripts/mac.mjs shot` of every menu, the panel, the status item menu, the Dock menu and Settings in light and dark; scripted checks: Quick Add over a full-screen app without activating Folevi, three windows restored after quit, ⌘W closing a tab then the window, a notification's Reply action reaching the dev server |
| **WM4 Web-layer Mac polish** (shared) | 2.1 to 2.6 in the page, 3.4, 3.6, 3.7, 3.8 the form, 3.12, 3.14 web menus, dialogs and buttons, 3.15, 3.16 page parts | the marked `:root[data-desktop="mac"]` block in `globals.css`; Mac styles in `components/ui/{Menu, Dialog, Popover, Tooltip}.tsx` (coordinated with the iOS WP3 owner); `components/app/{DesktopQuickAdd, AppContextMenu, TabStrip, CommandPalette, ModeChoice, LibrarySetup}.tsx` Mac variants; `components/views/settings/DesktopSection.tsx` and the `?window=1` settings layout; `lib/desktop/commands.ts`; Sidebar styles only through the CSS block (the multi-account builder owns `Sidebar.tsx`) | the audit script (`mac-audit/audit.mjs`) before and after on Electron, light and dark, and the same screens with `mac.mjs shot` once WM0 lands; e2e: `desktop-app.spec.ts`, `desktop-windows.spec.ts` still pass; new specs for keyboard-only focus rings (click then Escape: no ring; Tab: ring), cursor and `user-select` on chrome, menu open on mouse-down and press-drag-release, list keyboard navigation, the find bar; the website unchanged on Chrome and Safari (screenshot diff of Home and a note at 1440 wide) |
| **WM5 Mac capabilities** | 3.13 drag and drop, print, Share, Services, Spotlight, call recording, text recognition | `apps/mac/Folevi/Services/{DragOut, Sharing, ServicesProvider, Spotlight, Intents, CallRecorder, TextRecognition, Clipboard}.swift`; the drag hooks in the page | XCTest; drag a card into a scratch Finder folder and check the file; the "New Folevi Note with Selection" service in TextEdit's Services menu; ⌘P on a note produces a PDF through the print panel's Save as PDF |
| **WM1 places and sign-in** (the polish parts) | 3.16 sign-in sheet, place switching cross-fade, folder picker sheet | `ShellRouter.swift`, `Places.swift` | scripted sign-in to the dev deployment with a test account; a recording of a place switch (no white frame) |

Shared rules for every package: no em dashes, "Foli AI", Folevi's fonts, neutral chrome (notes carry colour),
radii from the token scale only (`apps/web/test/radius.test.ts`), custom controls in the page (the app's Select,
Menu, Dialog, Switch); native AppKit controls only where section 4 says; before and after screenshots light and
dark for every screen touched; the website and the iPhone and iPad apps don't change unless a finding says so
(Mac rules sit under `:root[data-desktop="mac"]`, which the website on a Mac never has).

---

## 6. Decisions for the owner

The engine decisions are in `docs/MAC_WEBKIT_PLAN.md` §13 (M1 to M10). Two of them shape this plan most:

- **M1** Native text menu for text, Folevi's menus for objects (3.2)?
- **M2** A separate Settings window (3.10)?

And four that are polish only:

- **P1** "New note" as a quiet "+" toolbar button on the Mac (3.4), or keep the black "New note" pill?
- **P2** "Ask Foli AI" as a toolbar button on the Mac instead of the floating pill (3.4)?
- **P3** Quick Add as one growing field with natural-language chips (3.8), or keep today's labelled form, restyled?
- **P4** Confirmations as native Mac alert sheets in the system font (3.14), as Craft does, or Folevi-font web
  dialogs styled as sheets (as decided for iOS menus)?

## 7. Found during the audit, outside polish

- The bundled export carries 64 MB of cover images (`web/covers`), most of the app's download once Electron is
  gone (`docs/MAC_WEBKIT_PLAN.md` §12).
- `docs/DESKTOP.md` still says the app "loads https://app.folevi.com"; packaged builds have shown the bundled
  interface since local mode WP2. Update it when the WebKit app lands (phase 5 of the WebKit plan).
- In the audit, pressing Enter from the slash-menu step split the starter note's first word ("Folev" / "i") in
  the scratch library: a script artefact, not an app bug, noted so nobody chases it.
