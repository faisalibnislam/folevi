# Folevi for Mac: the native look (2026-11-18)

The owner asked for the Mac app to keep every feature and the same layout, but look and behave like a native macOS
app. This replaces the October rule that the Mac frame matches the web pixel for pixel (`docs/MAC_REBUILD_PLAN.md`)
for the window's chrome. Note content still matches the web.

Mockups: https://claude.ai/artifact/APeXiBDiWzZ4WnKFKQ8hCW (they predate the owner's Mac UI guide. Where they
differ, this page and the guide win: the frame is translucent rather than a floating glass sidebar, Settings has a
category list, and the accent is black and white rather than brown).

Branch: `mac-native-look`. Not released: the owner approves the look first.

## Owner decisions (picker, 2026-11-18)

| Topic | Decision |
| --- | --- |
| Delivery | Replaces the current look in the normal Mac app. No setting to switch looks, and no separate app |
| How native | System chrome, Folevi content: window, sidebar, top bar, menus, popovers, lists, Settings and dialogs are stock macOS parts in the system font. Note titles, note text, note cards and the editor keep Instrument Sans and Spectral |
| Polish pass (later on 2026-11-18) | The sidebar gets more breathing room; Liquid Glass wherever it fits; buttons one size and weight, none small; the system font throughout the app outside the editor; no unnecessary or repeated buttons (the card's New note and a note's floating Share went); icons are Folevi's web icons wherever the web has one, the Foli AI flower for Foli AI |
| Tabs | Folevi's tab model unchanged (joined, pinned, per-place, folder tabs, Back/Forward per tab, previews, overview), drawn the macOS way: capsules in the title bar strip, the open one in Liquid Glass |
| macOS | 26 and later (was 15). The appcast's minimum system version follows `LSMinimumSystemVersion`, so Macs on 15 stay on 1.3.44 |
| Accent | Folevi's black and white (`.ui-neutral-chrome`): #1F1F22 light, #F2F2F3 dark, ink #FFFFFF / #101011. Not the system accent, and not brown |
| Sidebar | 240 pt. Hidden by its title bar button, ⌘\ and View > Hide Sidebar (the owner's layout, later on 2026-11-18); Focus mode hides it too |
| Settings | Its own window (⌘,) with a left category list and a working search field, a compact leading page title, grouped native controls |
| iPad | Unchanged for now: the owner decides after seeing the Mac. FoleviMac's SwiftUI views also build the iPad's wide layout, so every change here is `#if os(macOS)` or Mac-only files |

## The window profile (the owner's Mac UI guide, then the owner's layout and polish pass of 2026-11-18)

- **Two layers.** The window is one translucent surface (`NSVisualEffectView`, `.sidebar` material, behind window,
  follows the window's active state): the title bar strip, the sidebar and the card's margins, with no divider
  between them. Everything else is one opaque card: `controlBackgroundColor`, 12 pt continuous corners, 8 pt margin
  trailing and bottom, shadow black 2%, radius 5, y 1.
- **Title bar strip** (52 pt): the traffic lights, the sidebar's button at the sidebar's trailing end; then, from
  the card's leading edge, Back and Forward (always there, dimmed with nowhere to go), and the tab bar drawn as
  Finder's (the owner, 2026-11-18): Home in a round button, the tabs in a grey capsule track (34 pt, `MacLook.Colors.track`)
  with a hairline between two tabs that have no fill, each tab a 28 pt capsule of its own width (90 to 180 pt)
  with its icon and title centred, the open one a Liquid Glass capsule inset 3 pt in the track, and Show All Tabs
  in a round button right after Home. A tab narrower than 90 pt keeps its own width (the same padding as every tab). No + (the sidebar's New note; ⌘T opens a tab). With only Home open there is
  no track. The track clips its tabs, the list fades out before the scroll
  arrows (`EdgeFade(trailingInset:)`), and hovering a tab's × hides the tab's picture so the × keeps its tooltip.
  The sync status, the bell and (on a note) the inspector's button are at the strip's end.
- **The card's controls** float in Liquid Glass at a screen's top (`CardControls`), 36 pt, 12 pt in, 8 pt apart, in
  one `GlassEffectContainer`: the screen's title, the screen's own controls (`CardItems`), search. Screens leave
  their room (60 pt). **Nothing floats over a note**, so a note's page keeps no band for controls: the sheet starts
  12 pt from the card's top (`MacLook.notePageTop`), its least gap at the sides.
- **No control twice.** Nothing in the card repeats a control already on screen: New note is the sidebar's row (its
  row, ⌘N and File > New Note), a note's Share is in the note's own bar, Tasks has no shortcut to Calendar.
- **Sidebar** (240 pt, hidden by its button, ⌘\ and Focus mode): drawn directly in a scroll view (not `List`, not
  `NavigationSplitView`), 12 pt side inset. Rows are 32 pt with 2 pt between them, 8 pt corners, 13 pt labels,
  15 pt symbols in a 20 pt column, 10 pt content inset, 8 pt gap; folders indent 16 pt a level. Section headings
  are 11 pt semibold secondary with 22 pt above and 6 pt below; a heading that opens a page hovers as a whole row. The account's picture and the rows' symbols share one
  column. No footer (the owner, 2026-11-18): Settings and Help are the menu bar's (⌘, and the Help menu), and the
  sync status (a cloud with the real state's coloured dot) sits in the title bar before the bell.
- **Glass** on the navigation layer and on small controls floating over content: the open tab, the card's controls,
  Ask Foli AI's button, the multi-select bar, toasts. Never on content (cards, rows, panels in the card, sheets'
  bodies). Panels inside the card are a flat fill.
- **Type** (the owner, 2026-11-18): the system font for the whole app, but for notes, folders and the editor.
  Interface text is the system font in four sizes: 11 (`.subheadline`), 13 (`.body`, `.headline`), 15 (`.title3`),
  22 (`.title`); this covers the card's screens, dialogs, popovers, Quick Add, the floating Foli AI chat and its
  answers, the Tab Overview, Foli DNA's map labels, the Vault, the sign-in and lock screens, and Settings. What
  keeps Folevi's fonts: the note page (title and body in the note's own fonts); a note card's title (Spectral) and
  its preview (the note's fonts); a folder card's name (Spectral) and the notes pictured in it. A card's dates,
  folder or tag chip and a folder's count line are the system font (`WebTextStyle.cardInterface`). Text set
  straight in a font goes through `WebFont.interface(chrome, ...)`.
- **Controls**: one size everywhere (`MacLook.controlSize`, the system's large: 28 pt push buttons and pop-up
  buttons, 13 pt labels; text fields are 32 pt, see "One text field") and one shape for push buttons (a capsule). A compact action inside a row is 24 pt,
  never the system's small or mini. Icon-only buttons are 28 pt with a 15 pt symbol outside the glass controls.
  `macNativeChrome()` sets both the native chrome and the control size; a new hosted view tree needs it.
- **Icons**: Folevi's own, the web app's set, so the Mac and the web match (the owner, 2026-11-18); the Foli AI
  flower stands for Foli AI. `MacSymbol` draws Folevi's icon for an SF Symbol name and the system's symbol only
  where Folevi has none (a filled status mark, a key cap); rows and tabs that have a web counterpart use the web's
  own icon for it (`WebTopBar.icon(for:)`, `FolderGlyph`, the tag's coloured hash).
- **Colour**: system semantic colours (window, control background, separator, label levels, quaternary for hover
  and tracks), Folevi's accent for selection emphasis, switches, checkboxes and the one prominent action. A raised
  selection in a track is `MacLook.Colors.raised` (white in light, a lighter grey in dark). Status colours are the
  system's green, orange and red. No custom palettes, tints or gradients in the chrome.
- **A screen in the other theme** (the Vault: dark in a light window, light in a dark one): the card's own chrome
  over it (fill, scroll edge effect, glass controls, Ask Foli AI, toasts) takes that theme too
  (`ContentViewController.syncChromeAppearance`).
- **One light shadow scale** (the owner, 2026-11-18: "shadows are inconsistent ... I prefer less shadows"). A
  surface is told apart by its hairline edge first and its shadow second. Four levels, the same on both sides:
  `NativeShadow` in `FoleviDesign/Web/NativeChrome.swift` (`.nativeShadow(.card)`) and `--mac-shadow-*` in
  `globals.css`:

  | Level | For | Light window |
  | --- | --- | --- |
  | raised | a chosen pill in its track, a knob | black 12%, blur 1.5, y 0.5 |
  | card | content on the page: a thumbnail, a tab's picture | black 5%, blur 4, y 1.5 |
  | floating | a control over content: the note's bar, a dragged tab, a tooltip | black 9%, blur 9, y 4 |
  | overlay | a menu, popover, dialog, the floating chat | black 13%, blur 20, y 9 |

  The web's own drawn shadows (a note card's lift, a web-styled dialog's drop) are kept at half strength
  (`MacLook.webShadowScale`, the `nativeShadowScale` environment). Never write a shadow's numbers by hand
  (`NativeShadowTests` fails on one heavier than the overlay level).
- **The Vault** follows the same look: its sections are a pill track (a section from the ⋯ menu is a third pill
  with its close), its view switch a pill, its Settings a status header (what the Vault is doing now, with Lock now) over named groups of rows in cards, each
  row its icon in a 32 pt tile, its name, a line about it and one control,
  and a section never repeats its tab's name as a heading.
- **One segmented design, the pill** (the owner, 2026-11-18: the left tools were pills, the right panel's tabs
  rounded rectangles): a capsule track 34 pt tall (`MacLook.segmentHeight`, the title bar's tab track's height) with
  a 28 pt pill 3 pt inside it, the chosen one raised and semibold, no edge on the track. Native: `CapsuleTrack`
  (the note's tools), the system's segmented picker, and the hand-drawn ones (Notifications' All / Unread, Foli
  DNA's Map / List). The note page: `:root[data-mac-native] .ui-seg` in `globals.css`. The web-matched look and
  the iPad keep the web's rounded segments (so the pill is chosen at run time by `nativeChrome`, not `#if`).
- **A choice of look is shown, not named**: Settings > Appearance > Theme is three pictures of the window across
  the card (`ThemeTiles`), as System Settings shows its appearances, never a small segmented control.
- **Settings groups** read as System Settings': the group's name (13 pt semibold), what it is for in small
  secondary words under the name, then one rounded surface holding only the rows and controls
  (`NativeSettingsCard`). A row is its name and helper leading, its control trailing. The category list shows no
  focus ring, and the window doesn't open with the cursor in the search field.
- **Foli AI's answers** in the native look are the system font laid out by the system (never snapped to the web's
  line height, which set paragraphs over each other), in a quiet filled bubble; the floating chat is a Liquid Glass
  panel; the composer has a hairline focus and a round accent send button.
- **Menus and popovers** are the system's (`NSMenu`, `NSPopover`), not Folevi's own drawn menus.
  Every pop-up and context menu is comfortable (the owner, 2026-11-18: "too compressed"): `NativeMenu.comfortable`
  makes each row 32 pt, as the note's own menu, shows its icon (macOS 27 hides menu pictures unless a row sets
  `preferredImageVisibility`), draws Folevi's own icon at 16 pt (not the nearest SF Symbol), and gives a row built
  without an icon one by what it says. A new `NSMenu` built by hand must pass through it; the menu bar doesn't.
- **What floats over a note is Liquid Glass** (the owner, 2026-11-18: the note's menu was "pure white"): the page's
  menus, its floating bar (a capsule) and its popovers share one material in `globals.css`
  (`:root[data-mac-native] .ui-pop`): a cool tint at 66% that blurs and saturates what's behind, a sheen from the
  top edge, a bright rim inside, a hairline and two soft shadows outside; menus have 14 pt corners and 8 pt rows.
  Dialogs stay nearly opaque (glass is never content). Reduce Transparency makes them solid.
- **Other windows** (Settings, Quick Add, floating notes, sheets, alerts) keep their own native presentation and are
  never wrapped in the main window's shell.

Traps the guide records: never set `isMovableByWindowBackground`; the system toolbar can't live inside the card
(draw the bar in the view); keep ⌘F and search scopes when moving search; `.accessibilityIdentifier` on a root
needs `.accessibilityElement(children: .contain)` before it; don't force fixed text colours on selected rows;
check the narrowest window. Traps from the polish pass: a raised shape inside a clipped scroller needs room for
its shadow inside the clip; a mask is the only way to keep scrolled content out from under an overlaid control; the
card's fill reads as a hole when used for a selection on the window's material in dark mode.

What is native, what could be, and what can't: `docs/MAC_NATIVE_CHECKLIST.md`.

## Where the numbers live

`apps/native-kit/Sources/FoleviMac/Look/MacLook.swift` (metrics, type, colour roles, the window material) and
`MacLookComponents.swift` (TopBar, BarGroup, BarButtonStyle, BarIconButton, BarSearchField, CapsuleTrack,
SidebarRow, SidebarHeading, SidePanel, FormGroup, FormRow, EdgeFade). Use them; don't restate a number. Add a
component there when a second caller needs it.

## The note page (the one web part) follows the same rules

The note, its bar and its panels (Foli AI, Insert, Format, Style) are the web page inside the card; everything else
is native. Rules added in the 2026-11-18 audit (the owner: "text pushing too far left to the hover", "spacing is
uneven"):

- **A hover never touches its words.** A full-width row's words and its swatch sit at least 8 px inside the row's
  hover fill, and still line up with the section's heading: the hover reaches past the words (`-mx-1 px-2`), the
  words don't move in. A control that is only an icon keeps 3 px.
- **One row, one rhythm.** The Style panel's rows (the theme, Blur background, Document colour, Text colour) are one
  shared row (`STYLE_ROW_BOX` in `Inspector.tsx`), 36 px, the height of the segmented controls under them, so every
  section is the same distance from the next heading.
- **One look for the chosen tile** in the Format panel (`CHOSEN_TILE`): Text, Groups and Decorations alike, the icon
  before the words.
- **The panel sits beside the note** whenever the note keeps a writable width. The page's own width decides
  (`narrowWindowQuery` in `panelLayout.ts`: the Mac's page is the card, without the web's sidebar), so a 1280 pt
  window docks it; only a small window lays it over the note.
- **Push buttons in the page are capsules** (a dialog's Done, "Use your own image…"), as the native dialogs' are.
- **One text field** (the owner, 2026-11-18: "form fields look tiny and weird", then "the selected active field ...
  very poorly done"): `NativeField` in `FoleviDesign/Web/NativeChrome.swift`, used with `.nativeTextField()` on a
  `TextField` or `SecureField` and `NativeFieldBox` round a text area or a menu that sits in a form. 34 pt tall (a
  segmented control's height), 8 pt continuous corners, 12 pt before its words, 13 pt text. Three states: at rest
  a quiet well with a hairline edge; under the pointer the edge firms up; with the cursor in it the well lifts,
  the edge is a crisp 1.5 pt line in the ink's colour and a soft 3 pt halo sits outside it (so the field never
  changes size). A label is `NativeFieldLabel` (12 pt medium), 6 pt over its field, fields 16 pt apart. The system's
  `.roundedBorder` field is not used. A secret is the same field in the fixed-width font. Search fields keep their
  own shapes.
- **A dialog** in the native look (`WebDialog`): one plain panel with 14 pt corners and a hairline edge, 24 pt at
  its sides, a 15 pt semibold title with a line under it saying what the dialog is for, the form, then the actions
  on a quiet band behind a hairline. A form's small actions (Generate) are 24 pt capsules under their field, never
  floating over a label. A scroller round a form keeps 4 pt at its sides so a focused field's halo isn't cut.

## Tasks and the Calendar

Rules from the 2026-11-19 pass (the owner: "polish Tasks and Calendar next"):

- **Every dialog is the frame's sheet.** Edit task, Move task, Quick add and Subscribe are presented by
  `PlannerSheet.present`, which is `FrameSheets.present` on the Mac, inside `WebSheetDialog`. Drawn by themselves
  over the window (`PlannerPanel.dialog`) they had no panel at all on the Mac: the sheet is the surface there, so
  their fields sat straight on the task list. `PlannerPanel` is for popovers only on the Mac.
- **One control for one job in a task dialog.** A choice is the system's pop-up button (`PlannerSelect` is a
  `Picker`), a date or a time is the system's push button holding the value (the calendar or the list of times
  opens under it), words go in `NativeField`, and a label over a control is `NativeFieldLabel`. Edit task and Quick
  add no longer mix web selects, white date wells and pop-up buttons.
- **A box whose only fill is a gradient keeps a flat fill** (`WebBoxModifier.nativeStyle`). The native look drops
  the web's gradients, and a done task's box is nothing but one: it drew a white tick on the page. A gradient that
  fades to clear is a fade, not a fill, and still goes.
- **A floating list has the panel's material under its fill** (`WebMaterial`, as the date's calendar): the fill
  alone is see-through, and the dialog's controls showed between the times.
- **A list of tasks**: a separator starts where the rows' words start (past the box) and ends 12 pt short of the
  row; the facts under a title each follow a dot with the same room on both sides; a group's heading is
  `NativeHeading` on the boxes' own edge, in Tasks' Upcoming and the Calendar's Agenda alike; only Overdue is in
  the warning colour.
- **A filter is a field with a magnifier** (`PlannerFilterField`: `NativeFieldBox`, Clear once there are words).
- **The month fits the window** (`MonthFit`): the six weeks share the height under the weekday header, never
  shorter than the web's row (a short window scrolls) nor taller than 172 pt, and a taller week shows more of its
  day before "+N more". The day's tasks and the unscheduled ones scroll beside it in a list of their own, so a
  task far down that list can still be dragged onto a day.
- **A choice of colour is a row of dots**, the chosen one ringed and named after the label (`ColorSwatch`), never
  named chips that wrap.
- **A repeated action under every row is quiet** (the Calendar's "Schedule for today": 12 pt, the secondary
  colour, the label's colour under the pointer).

## Checks before calling a part done

Real pictures and two automatic checks (2026-11-18):

- `node apps/mac/scripts/screens.mjs --look [--only note,help]`: every screen of the native frame in light and dark
  as real window captures (`screencapture -l`, so glass, materials and shadows show), into
  `apps/mac/screens-report/look`. A popover, menu or second window open over the screen is its own picture.
- `node apps/mac/scripts/look.mjs shot|windows|hover <user-data> ...`: one capture of the running Debug app, its
  windows, or the pointer over a point of it. A system menu (`NSMenu`) holds the app until it closes: picture it
  from outside, then send Escape.
- `node apps/mac/scripts/mac.mjs eval @apps/mac/scripts/hover-lint.js`: the controls of the page on screen whose
  words or icon sit against the edge of their own hover fill. It must answer `[]` with each panel of a note open.
- `node apps/mac/scripts/mac.mjs eval @apps/mac/scripts/font-lint.js`: interface text of the page that isn't in the
  system font. It must answer `[]` too (the note's own text and theme previews aren't counted).
- `apps/web/test/note-panels-polish.test.ts` and `TabStripTests.theOpenTabClearsTheArrowsWhenTheyFirstAppear` hold
  the same rules in CI; `PlannerPolishTests` holds the task dialogs' sheet, the done box's fill and the month's rows.
- A click inside a dialog or a popover it opened: `mac.mjs cmd menus '{"do":"click","sheet":true,"x":..,"y":..}'`
  (or `"child":true`), points from that window's top left. A pointer event posted to the app from outside never
  reaches a sheet. `frame {"do":"post","name":"folevi.planner.show","value":"quick"|"edit"|"move"|"menu"}` opens
  the task dialogs on the Tasks screen.


Build with no new warnings; unit tests pass (update tests that encoded the old web-matched chrome and say which);
screenshots of every affected screen in light and dark from the Debug app on the scratch library
(`apps/mac/scripts/screens.mjs`, `docs/MAC_SCREEN_PLAYBOOK.md`), looked at; narrowest window; active and inactive
window; keyboard focus; the iPad snapshot tests unchanged.
