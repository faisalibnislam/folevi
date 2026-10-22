# iOS polish plan (2026-10-22)

The owner's verdict on the iPhone app: it "doesn't feel like a polished UI, it feels amateur". The goal is a
first-class iPhone and iPad app at Craft for iOS's level, in Folevi's own look. This plan is the audit and the
build plan. Nothing in it is built yet.

Owner decisions this plan follows (fixed):

- **Folevi's own look, much more polish.** Folevi's fonts stay everywhere (Spectral for display and note
  text, Instrument Sans for the interface; not SF Pro chrome). Spacing, type sizes and weights, alignment,
  materials, icons, motion and details get the polish.
- **Native building blocks inside the iOS app**: real iOS context menus with the lifted preview for long
  press (tiles, rows, blocks, links), native action sheets and alerts, native-feeling sheets (detents, drag to
  dismiss, rubber banding; a real `UISheetPresentationController` where the content allows), native haptics
  (`UIFeedbackGenerator`), swipe actions on rows, pull to refresh where it makes sense, and a polished keyboard
  toolbar for the editor. Pages stay web so features stay in step with the website. This overrides "custom
  controls only, no OS-default controls" inside the iOS app for these pieces.
- **Reference**: Craft for iOS. **Scope**: everything, iPhone and iPad.

How the audit was made: the current main (23c4c002 plus build 3) in the Simulators, iPhone 18 Pro (local
mode, the starter library) and iPad Pro 13-inch (local mode), light and dark, every screen driven by a
script (`apps/ios/scripts/screens.mjs`, added with this plan) and screenshotted. The account-only screens
(Notifications, comments, sharing, workspaces) come from the owner's device screenshots of today. The
screenshots are in the session scratchpad (`mobile-shots/ios/audit/`), not in the repository; rerun the
script to get them again.

---

## 1. What makes it read as "amateur" today (the short list)

In order of how much each one costs the app's feel:

1. **No material behind the top bar or the tab bar.** Content scrolls under a transparent top bar (the
   compact title "Home" floats over a faded row) and under the floating tab bar with no blur or fade. iOS and
   Craft put a blurred material behind both once content passes under them.
2. **Menus are web popovers, not iOS menus.** No lifted preview on long press; a menu opens at the finger
   or from a hidden "…" and can cover what was pressed; separators are 6 pt grey bars everywhere; menus carry
   desktop items ("Open in new tab", "Open in new browser tab", Back / Forward / Reload).
3. **Desktop controls inside phone screens.** Bordered web buttons ("Sync now", "Move library…", "Add
   key…"), web form fields with dropdown chevrons in Quick add task (Due date, Priority "None ⌄"), bordered
   filter chips in Search, a desktop table toolbar on collections ("Export", "View", "+ View ⌄").
4. **Focus rings after taps.** A heavy black ring stays on a "…" button after its menu closes (All notes),
   on the first notification when the sheet opens (fixed in 23c4c002 for that sheet only). Touch never
   shows a ring on iOS.
5. **Inconsistent sizes.** Sheet close buttons are 30 pt circles (below the 44 pt target), header actions
   were 28 pt, menu text is 16 pt (iOS: 17), row heights vary between 50, 62 and 70 pt, section headers mix
   22 pt Spectral, 13 pt uppercase and 15 pt mixed case ("You" on Settings).
6. **The iPad gets the desktop web layout.** A Mac-style tab strip with back and forward arrows, "⌘K" in the
   search field, a dark "New note" button, a floating "Ask Foli AI" pill, and "…" buttons always showing on
   every card and folder (big white squares on dark folder tiles). It reads as a website on an iPad.
7. **Motion is uniform and web-like.** Everything eases on one curve (`cubic-bezier(0.32, 0.72, 0, 1)`,
   420 ms pushes); nothing is interruptible; no spring on sheets, menus or swipes; haptics on 11 call sites.
8. **Empty space and duplicated information.** Note cards print "3 hours ago" twice (under the title and in
   the footer); a collapsed Tags section leaves a 60 pt hole; the Starred empty box is 88 pt of grey; Settings
   paragraphs sit inside cards instead of as footers.

---

## 2. The specs (what "polished" means here, in numbers)

Every work package builds to these. Points are iOS points (CSS px in the web view).

### 2.1 Layout and touch

| Thing | Spec |
| --- | --- |
| Touch target | 44 × 44 minimum, everything tappable (hit area may be larger than the drawing) |
| Screen side inset | 20 (rows, titles, section headers); cards and grouped lists 16 |
| Large title | Spectral 600, 34/41, -0.02em, 20 inset, 6 above the content's first element |
| Compact title (scrolled) | Instrument Sans 600, 17/22, centred, fades in over the last 12 pt of the large title's scroll |
| Top bar material | appears after 4 pt of scroll: `backdrop-filter: blur(20px) saturate(1.8)` over `--liquid-fill-strong`, 0.5 pt hairline `--iphone-separator`, 180 ms fade |
| Tab bar | 64 tall floating pill, 16 from the screen edges, 8 above the home indicator; material always on; content behind gets a 24 pt fade-out mask above it |
| Glass circle button | 44 × 44, icon 22 to 24 at stroke 2.0 to 2.2, optically centred (the ellipsis and the chevron the same size) |
| List row, one line | 52 tall, icon 22 in a 28 box at 20 inset, label 17/22 regular `--color-ink`, detail 17 muted, chevron 13 wide stroke 2.4 faint, 0.5 pt separator inset to the label |
| List row, two lines | 64 tall, title 17/22, subtitle 15/20 muted, 2 between |
| Grouped list (Settings) | 16 inset, radius 26 (concentric with the 38 sheet radius at 12 inset), rows 52, header 13/18 600 uppercase 0.04em muted at 20 inset, 8 above the group; footer 13/18 muted, 8 below; groups 28 apart |
| Section header (Home) | Spectral 600 22/28, 28 above, 8 below, chevron 15 stroke 2.4 |
| Cards (notes) | 2 columns, 14 gap, 16 inset; radius 18; one date line only (the footer); title Spectral 600 17/22, 2 lines max |
| Folder tiles | 142 wide on Home (3 visible: 16 + 142 + 12 + 142 + 12 + a peek), name Spectral 20/24 on the front, count and date on the front, readable on every colour in light and dark (contrast 4.5:1, dark mode uses the darker tone of the folder colour) |
| Empty state | one line, 15/20 muted italic Spectral, 56 tall box, or a centred block (icon 44, title 17 600, body 15 muted, 280 wide) for whole screens |

### 2.2 Type scale (Folevi fonts)

| Role | Font | Size / line | Weight |
| --- | --- | --- | --- |
| Large title | Spectral | 34 / 41 | 600 |
| Title 2 (section) | Spectral | 22 / 28 | 600 |
| Title 3 (sheet title) | Instrument Sans | 17 / 22 | 600 |
| Body (rows, menus, fields) | Instrument Sans | 17 / 22 | 400 |
| Callout (secondary rows) | Instrument Sans | 16 / 21 | 400 |
| Subheadline (subtitles) | Instrument Sans | 15 / 20 | 400 |
| Footnote (footers, captions) | Instrument Sans | 13 / 18 | 400 |
| Caption caps (group headers) | Instrument Sans | 13 / 18 | 600, uppercase, 0.04em |
| Note text | Spectral | the editor's own sizes (unchanged) | |

Dynamic Type keeps working as it does now (`--ios-text-scale`, 80 to 150 %).

### 2.3 Materials, colour, radii

- **Materials**: three levels only. `glass` (bars, buttons: blur 20 saturate 1.8 over `--liquid-fill`),
  `glass-strong` (menus, sheets: blur 30 saturate 1.8 over `--liquid-fill-strong`), `solid`
  (`--iphone-solid`, under the keyboard and when Reduce Transparency is on). No other ad-hoc blurs.
- **Radii**: sheet 38 (inset 8 from the screen edges, concentric with the display), menu 16, card 18,
  grouped list 26, field 12, chip 999, button circle 999. Concentric rule: inner radius = outer radius minus
  the inset.
- **Hairlines**: 0.5 pt `--iphone-separator` (light rgb(60 60 67 / 0.16), dark rgb(84 84 88 / 0.5)).
- **Dark mode**: cards get a 0.5 pt rgb(255 255 255 / 0.08) edge (they disappear on the canvas today);
  folder tiles use the folder colour's dark tone; glass in dark is rgb(36 36 40 / 0.84).
- **Focus**: no visible focus ring after touch, anywhere. Rings only for `:focus-visible` from a keyboard
  (iPad with a keyboard), 2 pt `--color-focus` with a 2 pt offset.

### 2.4 Motion (curves and durations)

| Motion | Spec |
| --- | --- |
| Push / pop | spring, response 0.42 s, damping 1.0 (critically damped), the screen below moves 30 % with a 0 to 0.12 black dim; interruptible by the edge swipe, which tracks the finger 1:1 and finishes with the release velocity |
| Sheet present | spring response 0.4, damping 0.92 from below; dim 0 to 0.25 (large detent) or 0 to 0.1 (medium) |
| Sheet drag | 1:1 with the finger; past the top detent rubber-bands: `offset = (1 - 1 / (x * 0.55 / d + 1)) * d` with d = 120; release picks the detent by position plus velocity × 0.2 s; dismiss below 30 % height or at a downward velocity over 800 pt/s |
| Menu open | from the anchor (the button's corner or the lifted preview): scale 0.5 to 1 and opacity 0 to 1, spring response 0.32, damping 0.82; close 160 ms ease-in to scale 0.9 |
| Long-press lift (web fallback) | press-in scale 0.97 at 0 to 450 ms (linear, so it reads as "about to"), then lift to 1.04 with a 18 pt shadow, spring response 0.25, damping 0.7 |
| Swipe actions | 1:1 tracking; settle spring response 0.3, damping 0.86; full-swipe at 60 % of the row's width |
| Checkbox | 180 ms: the box fills, the tick draws (stroke-dashoffset), row text fades to muted over 250 ms |
| Reduce Motion | every spring becomes a 150 ms opacity cross-fade |

### 2.5 Haptics

| Moment | Generator |
| --- | --- |
| Long press opens a menu (web fallback; native menus do their own) | `UIImpactFeedbackGenerator(.medium)` |
| Picking a choice (segmented control, a radio row, a sort) | `UISelectionFeedbackGenerator` |
| Toggle a switch, check a task | `.light` impact |
| A swipe crosses its full-swipe threshold | `.rigid` impact |
| Drag lifts / lands (blocks, tiles) | `.light` / `.soft` |
| Pull to refresh triggers | `.medium` |
| Something destructive done (deleted, moved to Trash) | `UINotificationFeedbackGenerator(.warning)` |
| Something failed | `.error` |
| Sheet snaps to a detent | none (as iOS) |

---

## 3. Per-screen findings

P0: looks broken or unfinished. P1: clearly below Craft level. P2: detail polish.

### Home (iPhone)

- P0 Top bar: no material when scrolled; the compact "Home" title sits over faded content.
- P0 Content under the tab bar shows through without a fade (folder tiles peek under it).
- P1 "Personal" as a subtitle under the large title wastes a line; Craft shows the space in the avatar
  button. Move the place to the avatar's menu and a small caption above the large title only when in a
  workspace.
- P1 Recent cards: the date is printed twice; card radius 14 (spec 18); dark cards have no edge.
- P1 "Catch me up" row: two lines with a long subtitle; make it a one-line row "Catch me up" with the
  Foli AI mark, subtitle only in its sheet.
- P1 Starred empty box 88 pt of grey italic text: a 56 pt one-liner.
- P1 Collapsed "Tags" leaves a 60 pt gap; collapsed sections are 44 pt rows.
- P2 Section "…" menus at 22 pt faint: align to the 20 pt inset and the 44 pt target (hit area exists,
  drawing is off-centre by 4 pt).
- Fixed today (23c4c002): folder names hidden at rest, long-press selection, stuck "…", menus over the tile.

### Lists: All notes, Drafts, Starred, Templates, Archive, Trash, a folder, Folders

- P0 The "…" button keeps a black focus ring after its menu closes (All notes, list view).
- P1 List view rows are 62 tall with 17 pt title and 15 pt "3 hours ago · Draft": per spec 64 with a 15 pt
  subtitle; the file icon is the same for every note (use the note's icon or the folder colour dot).
- P1 Long-press menu on a note: web menu at the finger, items include "Open" and "Open in new tab"
  (meaningless in the app). Native context menu with the card or row as the lifted preview; items: Star,
  Move to folder…, Duplicate, Share…, Archive, then Move to Trash (destructive) in its own section.
- P1 No swipe actions on note rows (Tasks has them). Leading: Star; trailing: Archive, Move to Trash.
- P1 Select mode: checkboxes are web circles; the bottom bar of bulk actions should be the glass tab bar's
  place (Move, Archive, Trash).
- P1 A folder's page: the folder colour tint fills the whole background (good, Craft does this), but the
  top bar material must take the tint.
- P1 Pull to refresh on lists in account mode (the sync engine's "fetch now"), not in local mode (nothing to
  fetch) except a folder in iCloud (asks the provider to download).
- P2 Empty states (Archive, Starred): one centred block per 2.1.

### Search

- P1 The filter chips ("Any folder ⌄", "Any tag ⌄", "Any time ⌄") are bordered web dropdowns with a stray
  "Personal" label at the end of the row. iOS scope bar: borderless capsules (`glass`), 32 tall, 15 pt, the
  chosen one filled; each opens a native menu.
- P1 Results rows: per 2.1 two-line rows; section headers caps per 2.2.
- P2 Cancel: 17 pt, `--color-heading`, 44 tall.

### Note (editor)

- P0 The block drag handle (⠿) is drawn half off the left edge on the phone.
- P0 Tables overflow the screen with no horizontal scroll affordance; "+ Row" and "+ Column" are 13 pt text
  links under the table.
- P0 Collections (Reading Shelf): the desktop table with 70 pt rows, truncated columns and a desktop toolbar
  ("Export", "View", "+ View ⌄"). On the phone a collection shows as a list (title, two properties as a
  subtitle) or gallery cards, with the view switcher as a glass segmented control and the rest in a "…"
  menu.
- P1 Block long press: web menu at the finger with a Paste item at the top. Native context menu with the
  block as the lifted preview; sections: Turn into ▸, Insert below ▸ (submenus), Duplicate, Copy link to
  block, Ask Foli AI…, then Delete block.
- P1 Top bar: the breadcrumb pill ("Drafts ›") and the share/more pill are fine; add the material on scroll
  (as lists) and hide the bars while typing (Craft keeps only the keyboard toolbar).
- P1 The bottom bar (comments, style, format | Foli AI, +): fine shape; icons 24 at stroke 2.0 and equal
  optical weight (the brush reads heavier than the speech bubble).
- P1 Keyboard toolbar: see 4.6. Today a web bar positioned from `visualViewport`, a frame behind the
  keyboard when it animates.
- P2 Date chips and task due pills: fine; the overdue pill's "!!!" reads as an error; use a red dot.

### Insert, Format, Style panels and Foli AI in the note (sheets)

- P1 Insert: 4-column grid of grey tiles with grey line art; labels 15 pt. Craft's insert is a list with
  coloured icons and the most-used first. Keep the grid (it's Folevi's), but tiles 76 tall, icon art in
  the block's own colours, labels 13/16, search field in the sheet header (not below the hint text); drop
  "Drag and drop any item to the document" on the phone (dragging from a sheet isn't possible there).
- P1 Format: mixed controls in one sheet (text style buttons with different weights, groups, icon button
  rows, an alignment segmented control with a bordered selection, "Focus" and a white "Block" chip, a
  "More: …" disclosure). One system: text styles as a horizontal scroller of 72 × 56 preview tiles; then
  icon rows of 44 pt buttons in `glass` capsules; the selected state filled (not bordered); "More" items
  as rows.
- P1 Style: the theme preview is good; the rows below ("Plain" with an empty swatch, "Document color" with a
  white square) look unfinished. Swatches 28 round with a 0.5 pt edge; theme picker as a horizontal
  scroller of themes (as the preview); separator style as a glass segmented control (exists, fine).
- P1 Foli AI sheet: good structure; the send button is a grey square (should be a 34 round button in the
  heading colour, disabled at 30 % opacity); the hint text with "↵ to send" means nothing on a phone;
  quick actions as 2-column tiles are fine, 52 tall.
- P1 All sheets: close button 30 pt circle: 32 drawn in a 44 hit area, placed 12 from the top-right
  corner of the sheet; title 17 600 centred, 56 tall header.

### Tasks, Quick add task, Calendar

- P1 Task view chips show only an icon and a count for Inbox, Upcoming and All ("6", "5", "17"), so which is
  which is unclear. iOS segmented scope: icon and name for the chosen one, icon and count for the others is
  fine only with accessible names and a 1 s tooltip-free design; make them icon + short name + count, the
  row scrolls.
- P1 Checkboxes are 24 rounded squares in grey; Craft uses round. Keep squares (Folevi), 22 with a 1.5 pt
  stroke and the fill animation in 2.4.
- P1 Quick add task: a web form card (bordered field, "No date" field, "None ⌄" select, "Inbox, or
  search a page…" field, Cancel / Add task buttons). Native-feeling: a sheet at the keyboard's top with the
  text field, then a row of glass chips (Date, Priority, Note) that open a native date picker
  (`UIDatePicker` inline in a sheet) and native menus; the Add button is the keyboard's return key ("Add")
  plus a round send button.
- P1 Calendar: "Oct 22" as a large title with a list; no month or week strip. Add a week strip under the
  title (7 day capsules, today filled, dots for days with items, swipe for weeks), and a month view behind a
  pull-down (Craft-style).
- P2 Day headers: "Oct 23  Tomorrow · Friday" in grey: one style for every day header.

### Foli AI (the tab bar's button)

- P1 Opens as a sheet; the chat composer and conversation list follow the sheet spec; message bubbles:
  the person's on the right in `glass-strong`, Foli AI's as plain text (Craft style), 17/24.

### Account sheet, Notifications

- P1 Account sheet: fine structure; the avatar row "You" with no detail in local mode; "Appearance" group
  cut by the sheet's bottom: medium detent must end on a whole group or show the grabber's drag hint.
- Fixed today: Notifications' "Mark all read" and settings at 44 pt, no ring on the first notification.
- P1 Notification rows: the "…" on every row is noise; actions belong in the row's long-press menu and
  swipe actions (Mark read / Delete).

### Settings

- P1 Section headers: "You" in 15 pt mixed case vs "WHERE YOUR LIBRARY IS" caps elsewhere; use 2.2's caption
  caps everywhere.
- P1 Long explanations inside the cards (Library, AI): move them to group footers (13/18 muted), keep rows
  as rows.
- P1 Key/value rows ("Syncs with: This iPhone only") wrap and misalign; iOS value rows: label left, value
  right in muted, one line, the full value in a pushed screen when it's long.
- P1 Bordered web buttons ("Sync now", "Move library…", "Add key…"): tinted text rows in the group (17 pt,
  `--color-link` or heading), like iOS Settings' action rows.
- P1 Switches: the black pill switch beside a paragraph (AI) is misaligned and not iOS-sized: 51 × 31, track
  `--color-heading` when on (Folevi's neutral, not green), thumb 27 with the iOS shadow; in a row of its own.
- P2 A footer with the app's version and build at the bottom of the root Settings screen.

### Sign-in, first run, onboarding

- P1 "Where should your notes live?" and "Where should your library live?": large Spectral titles are good;
  the option cards are 2 different styles (filled black for the first, outlined for the rest). One style
  (glass cards, the recommended one with a "Recommended" caption, not a black card).
- P1 "Your library is ready": the switch row and the big black button are fine; "Choose another place" as a
  17 pt text button.
- P1 Sign in (account): the native Sign in with Apple button (done), email and Google as full-width 50 pt
  buttons, 12 apart.

### iPad

- P0 The iPad shows the desktop web layout: Mac tab strip, back and forward arrows, "⌘K", a "New note"
  button, a floating "Ask Foli AI" pill. iPadOS layout: a sidebar (the current Sidebar, restyled as an
  iPadOS sidebar: 320 wide, `glass`, rows 44 with 17 pt text, selection as a filled capsule), a content
  column with the iPhone's large titles, top bar and glass buttons (sized for iPad), and the note in the
  detail. No tab strip by default (tabs as an option in Settings for keyboard users).
- P0 Card and folder "…" buttons always visible on touch (white squares, worst in dark). Hidden as on the
  iPhone; long press opens the native context menu; with a pointer (trackpad) they show on hover.
- P0 Menus on the iPad are the desktop's (32 pt rows, 14 pt text) under a finger: 44 pt rows and 17 pt text
  on touch, native context menus for long press (WP0).
- P1 The note's floating toolbar (Foli AI, Insert, Format, Style, Share, …) is the desktop's; on the iPad it's
  a 52 tall glass bar with 22 pt icons and labels, and the side panel's tabs (contents, comments, tasks,
  files, search) become an iPadOS segmented control.
- P1 Keyboard shortcuts stay (KeyCommands.swift already maps them); the "⌘K" hint shows only while a
  hardware keyboard is attached (`GCKeyboard.coalesced != nil`, sent to the page).
- P1 Split View and Slide Over: the compact iPhone layout below 700 pt (done), the sidebar layout above.
- P1 Pointer: hover states and the iPadOS pointer effect (`UIPointerInteraction` is native only; the web
  gets `:hover` with a 6 pt highlight radius).

### Android (same phone layout)

Every web change in sections 2 and 3 applies to Folevi for Android too. The native pieces (section 4) get
Android equivalents behind the same `foleviNative` calls: `PopupMenu` / a Material 3 menu for context
menus, `AlertDialog` / bottom sheets for action sheets and alerts, `HapticFeedbackConstants` for haptics,
`MaterialDatePicker`. Where Android has none, the web fallback runs. The Android builder owns
`apps/android`.

---

## 4. The native pieces

All of them go through `window.foleviNative` (bridge.js), typed in `apps/web/src/lib/nativeApp.ts`, optional
(older builds and the website fall back to the web version), and wrapped once in a new
`apps/web/src/lib/native/ui.ts` so screens call `nativeMenu()`, `confirmAction()`, `pickDate()`,
`feel()`, never the bridge directly.

### 4.1 Context menus with the lifted preview (`UIContextMenuInteraction`)

A context menu can only be opened by a touch that begins on a view with a `UIContextMenuInteraction`, and its
configuration must be returned synchronously. So the page arms the menu ahead of time:

1. On `touchstart` on anything with a menu (`data-menu-key`), the page builds that thing's menu (the same
   item lists the web menus use today, from a registry in `lib/native/menus.ts`) and calls
   `foleviNative.armContextMenu({ key, rect, radius, items })` (fire and forget; it arrives well within the
   ~500 ms before iOS asks).
2. `Native/UI/ContextMenus.swift` installs one `UIContextMenuInteraction` on the web view. Its delegate's
   `configurationForMenuAtLocation` returns a configuration only when the touch is inside an armed rect that
   is under 1 s old; otherwise nil (no menu; WebKit's own link preview stays off, as now).
3. The preview: `UITargetedPreview` of a snapshot of that rect (`webView.resizableSnapshotView(from:
   afterScreenUpdates: false, withCapInsets: .zero)`), `visiblePath` a rounded rect with the page's radius,
   background clear; dismissing animates back to the same rect.
4. The menu: `UIMenu` built from the JSON: sections (`displayInline`), submenus, `.destructive`,
   `.disabled`, checked state (`.on`), SF Symbol names mapped from Folevi's Lucide names (a table in
   `lib/native/menus.ts`, about 60 icons used in menus today).
5. A choice is sent back as `foleviNative.onCommand({ type: "menu", key, id })`; the page runs the item's
   `onSelect`. The web long-press path (`lib/touchContextMenu.ts`) steps aside when the native one is armed.

Font note for the owner (decision D1): `UIMenu` draws its items in the system font (SF Pro), as Craft's
menus do; Folevi's fonts can't be used inside a real iOS menu. Everything else stays in Folevi's fonts.

Tap menus ("…" buttons): a `UIButton` with `showsMenuAsPrimaryAction` placed over the web button gives a
real menu from a tap. The top bar's buttons are fixed on screen, so `Native/UI/BarButtons.swift` overlays
native glass buttons there (`setBarButtons({ trailing: [{ id, symbol, label, menu? }] })`, positions from the
page's layout); everywhere else (a section's "…" in a scrolling list) the web menu stays and is restyled to
the menu spec in 2.4 (17 pt rows, 0.5 pt separators within a section, 8 pt gaps between sections,
destructive in red, icons trailing as iOS).

### 4.2 Action sheets and alerts (`UIAlertController`)

- `foleviNative.actionSheet({ title?, message?, actions: [{ id, title, style }], anchor? })` →
  `Promise<id | null>`; on iPad it's a popover from `anchor`.
- `foleviNative.alert({ title, message?, actions, field?: { value, placeholder } })` →
  `Promise<{ id, text? } | null>`: confirmations ("Delete "Brainstorming"?"), renames (Rename folder with
  a text field), errors.
- Web call sites: every `Dialog` used as a confirmation (delete folder, empty Trash, sign out, remove a key,
  leave a workspace) and every one-field rename. `lib/native/ui.ts` `confirmAction()` / `askText()` fall
  back to the existing Dialog.

### 4.3 Sheets

- Web content stays in web sheets (`components/iphone/Sheet.tsx`): it can't move into a native sheet
  without a second web view. They get the physics in 2.4 exactly (spring, detents, rubber band, velocity,
  dim), measured against a native sheet side by side in a Simulator recording.
- Native sheets (`UISheetPresentationController`, `.medium()` / `.large()`, grabber, `prefersEdgeAttached`
  off) for native content: the date and time picker (`UIDatePicker` `.inline`), the share sheet
  (`UIActivityViewController`, `foleviNative.share({ title, text, url, files? })`), the colour picker
  (`UIColorPickerViewController` for custom colours), the document scanner (exists).
- `foleviNative.pickDate({ value, mode: "date" | "time" | "dateAndTime", min?, max? })` →
  `Promise<string | null>` (ISO day or time).

### 4.4 Haptics

`foleviNative.haptic(kind)` grows to the table in 2.5 (`"selection"`, `"rigid"`, `"soft"` added to today's
light / medium / heavy / success / warning / error), with generators kept warm (`prepare()` on
`touchstart` of a control that will fire one). `lib/native/ui.ts` `feel(moment)` maps moments to kinds so
screens say what happened, not which generator.

### 4.5 Swipe actions and pull to refresh

Both stay web (the rows and the scrolling are web) with native haptics: `components/iphone/Swipe.tsx` gets
the 2.4 spring and full-swipe haptic and is used on note rows, notification rows and settings lists that
can be deleted; a new `components/iphone/PullToRefresh.tsx` (64 pt threshold, the iOS spinner drawn in CSS,
`.medium` haptic) on lists that fetch.

### 4.6 The keyboard toolbar

- Hide WKWebView's own accessory bar (the "‹ › Done" bar) with Capacitor Keyboard's `hideFormAccessoryBar`
  (it's an existing, App Store-accepted override) and keep `inputAssistantItem` groups empty on iPad.
- `Native/UI/KeyboardBridge.swift` sends the keyboard's frame, animation duration and curve
  (`UIKeyboardAnimationCurveUserInfoKey`, the keyboard's spring) to the page on `keyboardWillChangeFrame`, so
  the web toolbar (`components/iphone/NoteBars.tsx` `KeyboardBar`) moves with the keyboard in the same
  frame, with `keyboardDismissMode = .interactive` on the web view's scroll view and the bar following the
  interactive drag.
- The bar: 48 tall, `glass`, 8 from the keyboard, items 44 wide with 22 pt icons: + (Insert), Aa
  (Format), checklist, indent, outdent, link, @, image, and the keyboard-down button at the end; the row
  scrolls horizontally when it doesn't fit; active styles filled.

### 4.7 Files

| File | What |
| --- | --- |
| `apps/ios/ios/App/Native/UI/ContextMenus.swift` | the armed context menu interaction, previews, UIMenu from JSON |
| `apps/ios/ios/App/Native/UI/BarButtons.swift` | native glass bar buttons with menus over the top bar |
| `apps/ios/ios/App/Native/UI/Alerts.swift` | action sheets, alerts, text-field alerts |
| `apps/ios/ios/App/Native/UI/Pickers.swift` | date and time picker sheet, colour picker, share sheet |
| `apps/ios/ios/App/Native/UI/Haptics.swift` | generators, warm-up |
| `apps/ios/ios/App/Native/UI/KeyboardBridge.swift` | keyboard frame and curve to the page, interactive dismiss |
| `apps/ios/ios/App/Native/UI/Symbols.swift` | Lucide name to SF Symbol fallbacks the page doesn't map |
| `apps/ios/ios/App/App/FoleviNativePlugin.swift`, `bridge.js` | method registration, events |
| `apps/ios/ios/App/Tests/NativeUITests.swift` | menus built from JSON, alert results, symbol mapping |
| `apps/web/src/lib/nativeApp.ts` | types |
| `apps/web/src/lib/native/ui.ts`, `lib/native/menus.ts` | the wrappers with web fallbacks, the menu registry and icon table |

---

## 5. Work packages

Six packages. WP0 lands first (a day of work) with the wrappers' web fallbacks, so WP1 to WP5 can call the
new APIs from the start and get the native behaviour as WP0's Swift lands. Each package owns its files;
shared files are edited only by the package named, others ask.

### WP0: Native UI layer

- Owns: everything in 4.7, `lib/touchContextMenu.ts` (the step-aside for armed menus), Capacitor Keyboard
  config in `apps/ios/capacitor.config.ts`.
- Delivers: 4.1 to 4.6 with web fallbacks; the menu registry with the existing menus registered by key
  (note card, note row, folder, block, link, task row, notification).
- Verify: XCTest (`NativeUITests`); `screens.mjs` long-press scripts on the iPhone and iPad Simulators
  (touch_path holds, release over items, scroll during press, dismiss by tap outside), screenshots of each
  menu with its preview; e2e with a stand-in bridge that records `armContextMenu` calls.

### WP1: Shell, navigation, lists and Home

- Owns: `components/iphone/{Screen, chrome, TabBar, Glass, RootBar, Rows, Grouped, IphoneHome, NoteList,
  Organize, transitions, tabStacks, Swipe}`, new `PullToRefresh.tsx`, the iPhone rules in `globals.css`
  (one block, marked), `components/views/{FolderCard, FolderCardArt, DocumentCard}` (phone variants only).
- Delivers: 2.1 to 2.4 for the shell (top bar and tab bar materials, large-title collapse, push spring
  and edge swipe), Home, all lists, cards, folder tiles, empty states, swipe actions, pull to refresh, the
  global no-focus-ring-after-touch rule, adoption of WP0's context menus on cards, rows and tiles.
- Verify: `screens.mjs` before/after sets in light and dark; e2e (`iphone-app.spec.ts`,
  `iphone-long-press.spec.ts` extended: materials appear on scroll, no focus ring after a menu, swipe
  actions); a Simulator recording of push / pop / edge swipe checked against the spring numbers.

### WP2: The note editor on the phone

- Owns: `components/iphone/{NoteBars, NoteChrome}`, `components/doc/{InsertPanel, FormatPanel, Inspector}`
  phone variants, the editor's phone CSS (drag handle, tables, collections on the phone), block menus'
  adoption of WP0's context menus, the keyboard toolbar (web side of 4.6).
- Delivers: section 3's Note and Insert / Format / Style findings; collections as a phone list or gallery;
  tables that scroll sideways with a fade and a 44 pt "+" at the end of the last row and column.
- Verify: `screens.mjs` note screens with the keyboard up (Simulator: `I/O > Keyboard > Toggle Software
  Keyboard` on, scripted focus); e2e on the editor's phone layout (`touch-long-press.spec.ts`,
  new `iphone-editor.spec.ts`: keyboard bar actions, Insert from the sheet, table scroll); Simulator
  recording of the keyboard and toolbar moving together.

### WP3: Sheets, menus and dialogs

- Owns: `components/iphone/{Sheet, AccountSheet, NewFolderSheet}`, `components/ui/{Menu, Dialog, Popover}`
  (their iPhone styles and the switch to WP0's alerts and action sheets), `components/app/{FolderMenu,
  NotificationsButton, QuickAddTask}` phone variants.
- Delivers: the sheet physics in 2.4, the 44 pt header controls on every sheet, web menus restyled to the
  menu spec, confirmations and renames as native alerts, Quick add task as described in 3, notification
  rows with swipe actions and no row "…".
- Verify: unit tests for the sheet's detent and velocity maths; e2e for each dialog's native path (stand-in
  bridge) and fallback; Simulator recordings of a sheet drag next to a native `UISheetPresentationController`
  (WP0's date picker sheet) to compare.

### WP4: Tasks, Calendar, Foli AI and Search

- Owns: `components/iphone/{Tasks, Agenda}`, `components/app/CommandPalette.tsx` (phone variant),
  `components/ai/chat/*` phone styles, the calendar's week strip (new).
- Delivers: section 3's Tasks, Calendar, Foli AI and Search findings; native date picker in task details;
  swipe actions on tasks (exist) tuned to 2.4.
- Verify: `screens.mjs` sets; e2e for task views, Quick add from Tasks, the week strip, search scopes.

### WP5: Settings, sign-in and onboarding, and the iPad layout

- Owns: `components/iphone/SettingsKit.tsx` and the settings sections' phone variants,
  `components/app/{ModeChoice, LibrarySetup, ShellSignIn}` styles, the iPad layout's shell pieces.
- Coordinate: the multiple-accounts work owns `Sidebar`, the account menu, `AccountGate`, `ShellRoot` and
  `lib/shell`; WP5 restyles the sidebar for iPadOS only after that lands (or through that builder), and
  doesn't change their logic.
- Delivers: section 3's Settings, sign-in and iPad findings: grouped lists per 2.1, iOS switches, action
  rows, footers; one style for first-run choices; the iPadOS sidebar layout without the desktop tab strip,
  hidden "…" on touch, keyboard-only hints.
- Verify: `screens.mjs` on the iPad Simulator (portrait, landscape, Split View at 1/3, 1/2, 2/3) in light
  and dark; e2e (`iphone-settings.spec.ts`, `iphone-app.spec.ts` iPad cases); VoiceOver pass on Settings.

### Shared rules for every package

- No em dashes, "Foli AI", Folevi's fonts, neutral chrome (notes carry colour), 44 pt targets, no buying in
  the app, Reduce Motion and Reduce Transparency respected, Dynamic Type 80 to 150 %.
- Before and after screenshots with `screens.mjs` for every screen touched, light and dark, iPhone and iPad.
- The website and the Mac app don't change unless a finding says so (phone variants are behind
  `:root[data-iphone]` or `nativeApp()`).
- Android: every web change ships there too; the Android builder adds the native equivalents of WP0.

---

## 6. Decisions for the owner

- **D1** Native context and tap menus draw their text in the system font (SF Pro), as in Craft. Accept for
  menus only, or keep Folevi-font web menus (styled to the iOS spec) and use native menus only for the
  lifted preview?
- **D2** iPad: drop the desktop tab strip by default (keep it as a setting for keyboard users)?
- **D3** Task checkboxes: keep Folevi's rounded squares, or round as iOS Reminders and Craft?
- **D4** Calendar: a week strip with a pull-down month (proposed), or a month grid at the top?

### Owner's answers (2026-10-22)

- **D1: Folevi-font menus.** Menus stay web menus in Folevi's fonts, styled exactly to the iOS spec (sizes,
  blur material, separators, radii, physics). Native code is used only for the lifted preview on long press and
  for haptics, not for the menu text.
- **D2: Keep the tab strip on iPad**, restyled to match iPad (no Mac-style look), with the rest of the iPad
  polish.
- **D3: Keep Folevi's rounded-square task checkboxes** on every platform.
- **D4: Calendar is a week strip with a pull-down month** on iPhone.

## 7. Found during the audit, outside polish

- The iPad Simulator's tab strip keeps tabs for pages that no longer exist ("Folder not found", "Untitled"),
  opened from links into another library; closing them should be automatic when a page is gone.
- Menus in the app still offer "Open in new tab" and "Open in new browser tab", and the generic link menu
  offers Back, Forward and Reload; none of these make sense in the iPhone app.
