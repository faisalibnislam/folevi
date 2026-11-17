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
| Tabs | Folevi's tab model unchanged (joined, pinned, per-place, folder tabs, Back/Forward per tab, previews, overview), drawn the macOS way: a capsule track in the top bar with a capsule selection |
| macOS | 26 and later (was 15). The appcast's minimum system version follows `LSMinimumSystemVersion`, so Macs on 15 stay on 1.3.44 |
| Accent | Folevi's black and white (`.ui-neutral-chrome`): #1F1F22 light, #F2F2F3 dark, ink #FFFFFF / #101011. Not the system accent, and not brown |
| Sidebar | Always visible, 228 pt, no hide button and no View > Hide Sidebar. Focus mode still hides it |
| Settings | Its own window (⌘,) with a left category list and a working search field, a compact leading page title, grouped native controls |
| iPad | Unchanged for now: the owner decides after seeing the Mac. FoleviMac's SwiftUI views also build the iPad's wide layout, so every change here is `#if os(macOS)` or Mac-only files |

## The window profile (the owner's Mac UI guide)

- **Two layers.** The window is one translucent surface (`NSVisualEffectView`, `.sidebar` material, behind window,
  follows the window's active state): the sidebar and the card's margins, with no divider between them. Everything
  else is one opaque card: `controlBackgroundColor`, 12 pt continuous corners, 12 pt margin top, trailing and
  bottom, shadow black 2%, radius 5, y 1.
- **Top bar** inside the card, first thing in it: 14 pt top and sides, 10 pt bottom; controls are 36 pt glass
  capsules, 10 pt apart, in one `GlassEffectContainer`. Leading: Back/Forward capsule. Then the tab track
  (flexible). Trailing: grouped actions (New note), then search. Every icon button has a tooltip and an
  accessible name. The note page's top inset is the bar's height (60 pt).
- **Sidebar**: drawn directly in a scroll view (not `List`, not `NavigationSplitView`), content starts 46 pt from
  the top under the traffic lights, 12 pt side inset. Rows 28 pt, 8 pt corners, 13 pt labels, 14 pt symbols in an
  18 pt column, 8 pt gap; headings 11 pt semibold secondary. The account and sync status are pinned at the bottom
  in a safe-area inset, and the list scrolls behind them with its last row reachable.
- **Glass** only on the top bar's controls and small floating controls. Panels inside the card (the note's
  inspector) are a flat fill, `quaternaryLabelColor` at about 60%, 18 pt corners: no glass, no shadow.
- **Type**: the system font in four sizes for interface text: 11 (`.subheadline`), 13 (`.body`, `.headline`), 15
  (`.title3`), 22 (`.title`). No custom font in interface text. Note content keeps its fonts.
- **Colour**: system semantic colours (window, control background, separator, label levels, quaternary for hover
  and tracks), Folevi's accent for selection emphasis, switches, checkboxes and the one prominent action. Status
  colours are the system's green, orange and red. No custom palettes, tints or gradients in the chrome.
- **Menus and popovers** are the system's (`NSMenu`, `NSPopover`, SwiftUI `Menu`), not Folevi's own drawn menus.
- **Other windows** (Settings, Quick Add, floating notes, sheets, alerts) keep their own native presentation and are
  never wrapped in the main window's shell.

Traps the guide records: never set `isMovableByWindowBackground`; the system toolbar can't live inside the card
(draw the bar in the view); keep ⌘F and search scopes when moving search; `.accessibilityIdentifier` on a root
needs `.accessibilityElement(children: .contain)` before it; don't force fixed text colours on selected rows;
check the narrowest window.

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
