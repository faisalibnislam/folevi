---
name: iphone-duo-decisions
description: "iPhone Duo (owner, 2026-11-23, third pass): open = the iPad's wide layout, closed = the iPhone layout with iOS side bars; note, caret and keyboard carry across folds; nothing in the crease"
metadata:
  type: project
---

**Current (2026-11-23, third pass):** the owner rejected the first two passes (a custom tab sidebar; then iOS's split view with Home in a 320 pt column and the tabs in the side column) and, after a fresh audit and research, picked from two working options on the Duo simulator:

- **Open (inner screen, across or upright):** the iPad's wide layout (PR 52's iPad window: strip with tabs, sidebar, the content card and its bar, the note's floating dock). Not a phone layout stretched or split.
- **Closed (outer screen) and a Split View half:** the iPhone layout, its tab bar and the note's buttons in iOS's side column (iOS 27.1 vertical bars).
- **Decided by size class and width, never the model:** an iPhone window of regular width and at least 600 pt (`RebuildIPad.isWide`).
- **Fold/unfold:** the note stays the focus (the owner's 2026-11-19 rule, still in force): the open screen, typed text, caret and keyboard carry over both ways.
- **Partly folded:** nothing interactive in the crease (`FoldSpan`): tabs end before the fold, the card bar's controls and the note's dock sit past it.
- Earlier picks this replaces: the tab sidebar + list beside the note (2026-11-19), the split view and "Last note I opened" in its empty column (2026-11-19). The "pause" of 2026-11-19 was lifted when the owner said "resume" on 2026-11-23.

**Why:** Apple's guidance is to show more of the app on the inner screen, not a stretched iPhone layout; the iPad window is the owner's chosen large-screen design (Mac and iPad, 2026-11-23), and it looked right on the Duo in the comparison.

**2026-11-24:** the iPad window became native (system split view, toolbar, inspector; owner's pick), so the Duo's open screen is that window now (branch `claude/iphone-duo-native-ipad`); only the tabs row needs fold handling, iOS places the system toolbar's items in the side column.

**How to apply:** design changes to the iPad window apply to the Duo's inner screen too, so check them at 951x669 and 669x951 and half open. Keep the phone layout working on the outer screen with iOS's side column. Plan and screenshots: `docs/IPHONE_DUO_PLAN.md`, `docs/iphone-duo/`.
