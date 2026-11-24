# iPhone Duo plan (third pass, 2026-11-23)

The owner rejected the first pass (a custom tab sidebar beside the list and the note) and the second (iOS's split
view: Home squeezed into a 320 pt column beside the note, the tab bar in the side column). On 2026-11-23 they asked for
a fresh audit, deep research and a full revamp, and picked the layout below from two working options tried on the
iPhone Duo simulator (screenshots in `docs/iphone-duo/`).

## The design

- **Open (the inner screen, across or upright): the iPad's wide layout.** The same window the iPad has (PR 52's
  design, after Folevi for Mac's new window): the strip along the top (sidebar button, Home, Show All Tabs, the tabs,
  sync status, the bell), the sidebar (it floats over the card below 1000 pt, as on an iPad in portrait), and the
  content card with its own bar (Back and Forward, the title, the screen's controls, New note, search). A note's page
  shows the iPad's look and its floating dock (Foli AI, Insert, Format, Style, Share, the note's "…").
- **Closed (the outer screen) and a Split View half: the iPhone layout**, its tab bar and the note's buttons in iOS's
  column at the side (iOS 27.1 vertical bars), as before.
- **Decided by size, never by the device:** an iPhone window of regular width and at least 600 pt
  (`RebuildIPad.isWide`), so a Split View half (compact) gets the phone's layout and the inner screen upright (669 pt)
  the wide one.
- **Continuity:** the open screen carries across a fold or unfold (the desk and the phone frame hand the route over,
  as when an iPad window crosses 700 pt). Mid-sentence, the keyboard comes back in the other layout with the caret
  where it was, and the caret is scrolled into sight.
- **The fold (partly closed, book pose):** nothing interactive sits in the crease (`FoldSpan`, iOS 27.1 reserved
  regions): the strip's tabs end before it while sync and the bell stay at the far end; the card's bar keeps Back,
  Forward and the title before it and moves its controls past it; the note's dock moves to the part past the fold,
  icons only (Apple's book-pose rule: controls go where they'll be when the phone opens flat). Scrolling content runs
  on across the fold, as Apple's guidance says it should.

## Update (2026-11-24): on the native iPad window, then Apple's Duo rules

The owner then chose a native iPad window (system split view, the system toolbar in Liquid Glass, Safari-style tabs in
a row under it, the note's tools in the system inspector). Branch `claude/iphone-duo-native-ipad` = PR 53's work merged
with `claude/ios-native-redesign-f4a8be`, then a pass against Apple's "Designing for iPhone Duo" page (the owner's ask:
"make the best duo app possible"). The open Duo now:

- **One column of controls, as when closed.** iOS puts a split view's toolbar in the column at the side (iOS 27.1
  vertical bars); every item now goes there (`IPadToolbar`, `sideBars` from `readVerticalBars`, the system's
  `toolbarVerticalEdge`): Back and Forward on top, New note as a black + (words keep an item horizontal), the sync
  status and the bell (opted in with `axisBehavior(.verticalPreferred)`), search at the foot.
- **The note's tools where the closed phone has them.** On a note the column's foot holds Comments, Style, Format,
  Foli AI and Insert (the closed screen's order and icons); Share; the note's "…" in iOS's own overflow menu
  (`ToolbarOverflowMenu`, `NoteMenuPlan`). The page drops its floating dock (marker `sideTools`, lib/iphone.ts
  `isNativeSideTools`). Style, Format, Insert and Foli AI open the inspector, again closes it.
- **One more level of the hierarchy (Mail, Notes).** The sidebar stays beside the content instead of floating (it
  floats under 1000 pt on an iPad); while the inspector is open it steps aside, as the three don't fit.
- **The book pose.** Partly folded, the sidebar reaches the fold, so the list and the note each have a side. The tabs
  row ends before the fold, or starts past it when there isn't room before it.
- **Narrow windows** (the inner screen upright, 669 pt; an iPad mini in portrait): New note shows its symbol alone so
  the title isn't cut to a letter.
- **Fixed on the way:** the sidebar no longer stays hidden after a fold (the split view reports "detail only" as the
  window changes size; the frame controller now says when a resize starts, `FrameModel.windowResizedAt`, and those
  reports are ignored).
- Checked on the simulator: open across (Home, a note, the Style panel), half open at 110 degrees, tabletop (upright
  and half open), closed, and fold and unfold mid-sentence (note, text, caret and keyboard carried both ways). iOS
  shortens the column while the keyboard is up (New note and the writing tools stay; the rest go into "…").

## Why this layout (the research)

Apple's sources (HIG "Designing for iPhone Duo", "Preparing your app for iPhone Duo", tech talks 111461 to 111466, the
Group Lab notes; summarised by a research pass on 2026-11-23):

- "You don't want just a stretched out iPhone app." The inner screen should show more of the app: a split view, a
  two-column rearrangement, or a sidebar for information-dense apps. Folevi's iPad window is exactly that, and it's the
  design the owner chose for the Mac and the iPad the same day.
- Only system bars go to the side column. Folevi's iPad window draws its own bars, so on the inner screen they stay
  at the top, inside the safe area (the status bar's column on the right is left alone). Custom bars must avoid the
  fold themselves, with reserved regions: done (`FoldSpan`).
- Keep functionality and state the same between displays: every feature is in both layouts, and the open note,
  typed text, caret and keyboard carry over.
- Use size classes, not the model: done.

What the second pass got wrong, from the audit: Home in a 320 pt column was a cramped iPhone screen; with nothing open
the right column was a large empty pane; the tab bar collapsed to one Home button beside the note's tools; upright,
the split view drew the list over a dimmed note.

## Checks (iPhone Duo simulator, 2026-11-23)

- Open across: Home and a note in the wide layout; the note's dock and the iPad's keyboard bar while typing.
- Half open at 110 degrees: the strip, the card's bar and the dock clear of the fold.
- Closed: the note with iOS's side column (Back, the place, Share, "…", then the tools).
- Fold and unfold with a note open, with and without the keyboard: the note, typed text, caret and keyboard carry
  over both ways.
- Not checked: Split View halves and tabletop (the simulator has no control for them), a real device.
