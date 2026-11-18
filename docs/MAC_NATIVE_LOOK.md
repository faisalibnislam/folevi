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
  in a round button after the track. No + (the sidebar's New note; ⌘T opens a tab). With only Home open there is
  no track. The track clips its tabs, the list fades out before the scroll
  arrows (`EdgeFade(trailingInset:)`), and hovering a tab's × hides the tab's picture so the × keeps its tooltip.
  The bell and (on a note) the inspector's button are at the strip's end.
- **The card's controls** float in Liquid Glass at a screen's top (`CardControls`), 36 pt, 12 pt in, 8 pt apart, in
  one `GlassEffectContainer`: the screen's title, the screen's own controls (`CardItems`), search. Screens leave
  their room (60 pt). **Nothing floats over a note**, so a note's page keeps no band for controls: the sheet starts
  12 pt from the card's top (`MacLook.notePageTop`), its least gap at the sides.
- **No control twice.** Nothing in the card repeats a control already on screen: New note is the sidebar's row (its
  row, ⌘N and File > New Note), a note's Share is in the note's own bar, Tasks has no shortcut to Calendar.
- **Sidebar** (240 pt, hidden by its button, ⌘\ and Focus mode): drawn directly in a scroll view (not `List`, not
  `NavigationSplitView`), 12 pt side inset. Rows are 32 pt with 2 pt between them, 8 pt corners, 13 pt labels,
  15 pt symbols in a 20 pt column, 10 pt content inset, 8 pt gap; folders indent 16 pt a level. Section headings
  are 11 pt semibold secondary with 22 pt above and 6 pt below; a heading that opens a page hovers as a whole row. The account's picture, the rows' symbols and the
  footer's first button share one column. The footer (sync, Settings, Help) is pinned at the bottom in a safe-area
  inset; the sync dot is the real state's colour.
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
- **Controls**: one size everywhere (`MacLook.controlSize`, the system's large: 28 pt push buttons, pop-up buttons
  and fields, 13 pt labels) and one shape for push buttons (a capsule). A compact action inside a row is 24 pt,
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
- **Settings groups** read as System Settings': the group's name (13 pt semibold), what it is for in small
  secondary words under the name, then one rounded surface holding only the rows and controls
  (`NativeSettingsCard`). A row is its name and helper leading, its control trailing. The category list shows no
  focus ring, and the window doesn't open with the cursor in the search field.
- **Foli AI's answers** in the native look are the system font laid out by the system (never snapped to the web's
  line height, which set paragraphs over each other), in a quiet filled bubble; the floating chat is a Liquid Glass
  panel; the composer has a hairline focus and a round accent send button.
- **Menus and popovers** are the system's (`NSMenu`, `NSPopover`), not Folevi's own drawn menus.
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

## Checks before calling a part done

Build with no new warnings; unit tests pass (update tests that encoded the old web-matched chrome and say which);
screenshots of every affected screen in light and dark from the Debug app on the scratch library
(`apps/mac/scripts/screens.mjs`, `docs/MAC_SCREEN_PLAYBOOK.md`), looked at; narrowest window; active and inactive
window; keyboard focus; the iPad snapshot tests unchanged.
