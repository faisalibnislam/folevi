# Folevi for Mac: parity and performance pass (2026-10-31)

Branch `mac/parity-perf` (worktree `../folevi-mac-parity`), from `main` at 22a4cf4c (1.2.07). Nothing pushed,
deployed or released. Owner's answers before starting: parity first, then speed; "matches" means the screenshot
diffs (under 1% of pixels, light and dark) plus the same menu items, order, shortcuts and behaviour; measure on
this Mac only; where the web itself looks wrong, match the web and list it.

## Part 1: matching the web

### How it was checked
- `apps/mac/scripts/screens.mjs`: 49 screens, light and dark (98 shots), web frame vs native frame.
- New: `apps/mac/scripts/menus.mjs`. The same right click or click in both frames; each menu's rows compared as
  text (title, shortcut, check, separators, off, destructive), the panel diffed as a picture. The Debug app's eval
  hook got a `menus` command (right click, click, read the open menu, draw it).
- A read-only audit of every web menu against its Mac counterpart (about 25 differences found).

### Results
- **Menus:** rows identical to the web on every menu tested (note card on Home, note card in All notes, folder in
  the sidebar, folder card, the sidebar menu, a tab, empty space, a task), light and dark. One tab row differs only
  because the test's tabs were in another order. Panel heights equal; widths within half a point (the web's
  228.5 pt vs the Mac's 229). Pixel differences 2 to 5%: the web frame's own capture can't draw its blur.
- **Screens:** 20 to 25 of 98 shots under 1% (21 before). Nearly every other shot is between 1 and 3%. Single real
  window captures (`screencapture -l`) show most of that is the capture method, not the app: the app's own snapshot
  (`windowShot`) leaves out SwiftUI shadows and live blur on the native side and `backdrop-filter` on the web side,
  and the two frames had different tabs open. Bulk real captures were not used: they once hung WindowServer and
  restarted the Mac (2026-10-28).

### What changed (Mac, unless marked)
- Menus drawn as the web's on the Mac: at least 200 pt and as wide as the longest row (were fixed widths), placed
  at the button's end edge 8 pt below or above it as room allows, kept inside the window (`ui/Menu.tsx place()`),
  16 pt icons, a destructive row's icon stays muted, the checkmark drawn (it never was: sort and choice menus showed
  no tick), second-line descriptions, the Foli AI flower, colour swatches, the web's blurred and saturated backdrop.
- Selects are the web's `ui/Select.tsx` list (chosen option semibold with its check, opens on it, 6 pt below, at
  least the trigger's width): All notes' sort, Settings, Quick Add, the palette, Reviews, Vault, Tasks.
- The app-wide right-click menu (`AppContextMenu.tsx`): empty space gets New note, Search or jump to…, Ask Foli AI,
  Back, Forward, Reload; text fields get Cut, Copy, Paste, Select all with the Mac's spelling guesses, Look Up and
  Share. Before: nothing, or the system's menu.
- One folder menu for the sidebar, cards and the Folders page, exactly the web's `FolderMenu.tsx` (adds Change
  color…, Always fully encrypted, Share…; removes the extra "Open in new tab" and separator; right icons). "Ask Foli
  AI about this folder…" now opens the chat about the folder (it opened an empty chat). Rename, delete and encrypt
  from a card used the system's alerts; now the web's dialogs.
- Sidebar: hover "…" on folders and tags; the tag menu (Edit tag…, Color: …, Delete tag…); Focus mode in the
  sidebar menu, and the menu in the tab strip while the sidebar is hidden; folders start open and the closed ones
  are remembered (`useOpenFolders`), the open folder's parents always open.
- Tags page: page counts on each tag and a working sort (Name, Most used, Newest).
- Home: Catch me up opens in place as the web's "Your week" card (it went to an older screen); no Move up / down on
  Home's cards; card previews wrap as the web's `text-wrap: pretty`, breaking after hyphens too.
- Foli AI: Share with workspace / Stop sharing work, with the web's reasons when they can't ("Personal
  conversations can't be shared.", "History is off…"); Copy and Download Markdown make the web's file; an agent's or
  research answer has the web's Export menu; the Add menu offers the current folder.
- Notifications: the web's hover "…" (no icons) instead of a right-click menu. Calendar chips no longer open the
  task menu. Tab icons for Folders and Tags; the web's CheckSquare icon; Trash's Select only where selecting works.
- Vault dialogs presented as every other dialog (under the bar, centred on the window, page not dimmed) and closed
  when the section changes.
- Bridge (web engine, contract revision 21, fixtures added): `tag.update`, `tag.delete`, `ai.share`,
  `ai.exportMarkdown`, the `tags.index` view.

### Kept on purpose, or for the owner
- The pinned Home tab (the owner, 2026-10-30): the web has none, so the tab strip scrolls differently.
- Web: the Markdown export says "Folevi AI" (`packages/ai-prompts/src/chat.ts`), not "Foli AI". The Mac copies it.

### Still different
- "New workspace…" opens Settings on the Mac, a dialog on the web.
- The account limit line ("Up to N accounts in one browser") isn't shown.
- Links and selected text outside fields don't get the web's link and selection menus (the native screens have
  almost none).
- The tag chips on the Tags page have no hover fill.
- The folder card's front sits about 2.5 pt lower than the web's.
- The screen diff can't see native shadows or either side's blur (see Results); a capture that draws them safely
  would make the numbers meaningful again.

## Part 2: performance

### How it was measured
This Mac only (Apple M5 Pro, 48 GB, macOS 27.2, on power): not measured on an M1 or 8 GB Mac. The existing
scripts on a scratch library of 2,000 notes and three places, Debug build (the scripts drive its eval hook):
`perf.mjs` (launch, memory, idle energy), `perf-interact.mjs` (open a note, switch tabs, type), `perf-scroll.mjs`
(Home, Folders, All notes scrolled by the display link at 120 Hz). Instruments' Time Profiler for causes. `main`
was built in its own worktree (`../folevi-perf-main`) and measured the same way. In the afternoon other sessions
loaded this Mac (load average 10 to 14: Swift builds, a Simulator), so the last comparison alternated `main` and
the branch back to back.

### Bottlenecks found and fixed
1. **Every text redraw made a new font.** `WebFont.ctFont` built a variable Core Text font with its features and
   fallback list on every call, and every `.webText(...)` called it on every redraw; a new font object each time also
   kept SwiftUI from reusing text layout. Now each font is made once and reused (`WebText.swift`). Same fonts, so
   nothing looks different.
2. **Card previews measured every word on every layout** (the pretty wrapping added here). Word widths and wrapped
   lines are remembered (`WebPrettyText.swift`). This had made All notes scroll badly (p95 frame 8 to 45 ms); fixed.
3. **Folder cards blurred their frosted front on every frame** while Home or Folders scrolled (Time Profiler: about
   97% of the main thread in drawing and waiting for the GPU; our own code under 5%). The whole card is now drawn
   once into one picture (`WebNoteCard.swift`). Real window captures, light and dark, show it as the web draws it.
   Tried and reverted: removing the inner pictures (Home got worse again).
4. Smaller: one Core Image context reused for every backdrop blur (was made each time); menus blur only their own
   region.

### Results
Scrolling, quiet Mac (p95 frame time, missed frames per run; the budget at 120 Hz is 8.3 ms):

| Screen | `main` | This branch |
| --- | --- | --- |
| Home | 52 to 66 ms, about 230 | 8.3 ms, 2 to 3 |
| Folders | 78 to 89 ms, about 285 | 17 to 21 ms, 40 to 107 |
| All notes | 8.3 ms, 2 to 17 | 8.3 ms, 2 to 17 |

Under load, alternating (missed frames, four runs added up): Home 418 vs 162, Folders 690 vs 320, All notes 101 vs
116 (no real difference).

Unchanged within noise (quiet runs): opening a note 155 vs 157 ms median, switching tabs 132 vs 139 ms, typing 17 ms
frames with no frame over 33 ms, idle energy impact 0.8 vs 0.9, launch 1.71 vs 1.56 s to the window's page and
2.23 vs 2.08 s until ready. Memory was 467 MB on `main` and 345 to 369 MB here, but the two scratch libraries were
made separately, so this is not claimed as an improvement.

### Not improved, and why
- **Launch** (slower than 2026-10-28's 0.92 s on `main` too): mostly WebKit starting its processes and loading the
  engine page. On the main thread, the first window takes about 280 ms: about 375 ms of samples are the Swift runtime
  working out SwiftUI's generic view types for the first layout (much heavier in Debug than in Release), and about
  110 ms macOS making the window's display link. No change made without a Release measurement.
- **Folders** still misses frames: each folder card's picture is drawn again as it moves while scrolling.

### Recommended next
1. A Release profiling build (signed for this Mac) with an eval hook or `signpost`s, to measure launch and scrolling
   as shipped.
2. Folders: keep the card's picture from being drawn again on each scroll step (whole-point offsets, or one shared
   picture per card that only moves).
3. Launch: create the first window's native screen after the window shows, and load the engine page in parallel
   with it; measure first.
4. A screen-diff capture that draws native shadows and both sides' blur safely (one window at a time).
5. Measure on an 8 GB Apple silicon Mac.

### Checks run
`pnpm --filter @folevi/web exec vitest run test/engine` (156 passed, fixtures regenerated), `tsc --noEmit` in
apps/web (clean), `swift test` for WebPrettyWrapTests, PlannerWrapTests, NoteSidebarTests and the 331 contract
fixtures (passed), the Debug app built, the menu and screen diffs above. Not run: the full `swift test`, `pnpm test`,
the e2e suites.

## Files
New: `apps/mac/scripts/menus.mjs`, `FoleviMac/Views/AppContextMenu.swift`, `FoleviMac/Views/WebFolderMenu.swift`,
this report. Changed: `FoleviDesign/Web/WebComponents.swift`, `WebNoteCard.swift`, `WebPrettyText.swift`,
`WebText.swift`; `FoleviMac` `WebMenus.swift`, `WebSidebar.swift`, `WebTopBar.swift`, `WebNoteScreens.swift`,
`Screens.swift`, `FrameViews.swift`, `Model/FrameModel.swift`, `More/FrameSheets.swift`, `More/NotificationsPanel.swift`,
`More/CommandPalette.swift`, `More/MoreKit.swift`, `Settings/SettingsKit.swift`, `WebQuickAdd.swift`, `Planner/*`,
`Vault/*`, `FoliAI/*`; `apps/mac/Folevi/Frame/FrameEval.swift`; the engine (`protocol.ts`, `commandsAi.ts`,
`commandsMore.ts`, `viewsMore.ts`, fixtures) and the generated Swift models.

## Visual pass (2026-10-31, later)

The owner: menus "too compact, compressed", then "check everything and fix". Every screen of `screens.mjs` and
every menu of `menus.mjs` looked at side by side, web and native, light and dark.

- **Menus:** 32 pt rows (were AppKit's 26), 6 and 10 pt padding, 10 pt between a row's icon and its words, 12 pt
  corners, 6 pt around separators: in the web's Mac CSS (`globals.css`, `data-desktop="mac"`), measured again into
  the native menus (`menu.*`) and the palette. `menus.mjs`: every menu's rows the same as the web's and every panel
  the web's height.
- **Dialogs:** a description long enough to wrap made `WebPrettyText` lay out on one line at that width, and the
  dialog with it: Move folder showed half its contents, cut off on the left. Fixed for every dialog (the width it's
  placed in, never its own). Native dialogs get the web's Close button and the Mac's 480 pt medium width; scroll
  views in dialogs are only as tall as what's in them.
- **The Vault's Add:** full-width Kind, every field, the web's text area heights, Close; secrets in the web's mono.
- **Settings › Appearance:** Editor text size as the web's slider (were five tiles).
- **Sidebar:** the open item's count inverted; a place's every view selects it (Tasks on any list, the Calendar on
  any day, the Vault on any section; the web's sidebar never lit the Vault: fixed there too); a section's header lit
  while its page is open; Reviews listed while open.
- **Tabs:** a tab's picture under its tab (it showed a sidebar's width to the right); Foli AI's tab has its flower.
- **Text:** card previews and any text set the web's pretty or balanced way take the page's own line breaks
  (`text.layout`), on the Mac as on the iPhone.
- **Help, Graph, Reviews, Shared with Me, Changes:** on the card's white, as the web's (the note page waiting
  behind showed its grey through).
- **Tags:** chips never cut their count.

`screens.mjs`: 35 of 98 shots under 1% (21 before); Graph, Reviews, Shared and Changes pass in both themes; Move
folder 3.0% to 1.3%, the palette 2.7% to 1.4%, Calendar 2.96% to 1.27%. The rest are the capture's known limits
(blur, SwiftUI shadows, different tabs open, a web toast in one shot) more than the app; the Vault's Add stays high
because the web capture can't draw its frosted panel.
