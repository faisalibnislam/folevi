# iPhone Duo plan (2026-11-19, second pass)

The owner reviewed the first pass and called it a mess. Their notes: the list column had empty space down its right
side, the note left a wide empty band, the two top bars crowded the screen, the sidebar squeezed the list, and the
controls should sit on the right side, vertically. This plan follows Apple's guidance instead.

## What Apple says (sources)

- HIG, "Designing for iPhone Duo" (2026-09-09), and the overview "Preparing your app for iPhone Duo".
- Tech talks 111461 to 111466 (September 2026), and Apple's Group Lab notes (forum thread 847644).
- Main points:
  - Design for two size classes, compact on the outer screen and regular on the inner one, not a layout per pose.
  - Don't stretch the iPhone layout. On the inner screen, show one more level of hierarchy: Mail and Notes show
    the list and the item side by side, using the system split view.
  - Toolbars, the Back button and the tab bar sit in one column down the side of the screen everywhere except the
    inner screen held upright. Order, top to bottom:
    - Back or Close, then the prominent action (Done).
    - The top bar's groups, then a gap, then the bottom bar's groups.
    - The tabs, aligned to the bottom.
  - Only system bars move: bars from NavigationStack, NavigationSplitView and TabView. Hand-built bars stay put.
  - In a split view, only the detail column's items go to the side. The list keeps its controls above it (Mail).
  - Use the system overflow menu, not an app's own "...". Rank items with visibility priorities.
  - A task-focused screen minimizes the tab bar to keep its toolbar (toolbarVerticalCompressionBehavior).
  - Split views rebalance on the fold by themselves. Scrolling documents don't displace for the fold.
  - Keep view identity stable across opening and closing. Swapping containers loses state. The system keeps
    text input and scroll position.

## The design

- **Tabs.** iOS's own tab bar, so the tabs are in the side column on the outer screen and on the inner screen
  across, and at the bottom with the inner screen upright. No sidebar.
- **Home tab: a system split view.** The list (Home and what opens from it) is in the leading column, at about a
  phone's width, with its own controls above it. The open note is in the detail column.
  - Closed, the split view collapses: the note is pushed over its list, with Back.
  - Open with no note on show, the detail column shows the last note the person opened, kept between launches (as Notes does; the owner's pick). Folding
    closes it again if it was never written in, so the outer screen shows Home.
- **Tasks and Calendar:** one full-width stack. Their screens use the inner screen's width; a note opened there
  is pushed full width.
- **The note's controls** are iOS toolbar items wherever iOS puts bars at the side:
  - Back (closed); Done while writing (pinned).
  - The note's place and Share.
  - Comments, Style, Format, Foli AI and Insert. These are kept visible longest, and the tab bar minimizes for
    them.
  - The note's menu goes in the system overflow menu.
  - Upright on the inner screen, and on other iPhones, the note keeps Folevi's own bars.
- **The keyboard bar** stays on the keyboard.

## Checks

On the iPhone Duo simulator: closed, open across, open upright, and half open. Fold and unfold with a note open,
with and without the keyboard, checking for no leftover glass, no empty bands, and that the side column's order
is right. On a plain iPhone, nothing changes.
