---
name: iphone-duo-decisions
description: "Owner's 2026-11-19 picks for iPhone Duo: tab sidebar + list beside note inside, note stays the focus on fold/unfold, note bars join iOS's side bars"
metadata:
  type: project
---

On 2026-11-19 the owner asked for a good iPhone Duo experience in every posture and answered these in a question dialog:

- **Inner screen (open):** the iPhone's tabs (Home, Tasks, Calendar, Search, Foli AI) become a sidebar, and the open note shows beside its list. Same structure inside and out (not the iPad's Mac-style layout, not the iPhone layout stretched).
- **Fold/unfold with a note open:** the note stays the focus. Folding shows it full screen on the outer screen with Back to its list; unfolding puts the list back beside it. Caret, typed text, scroll and keyboard carry over.
- **Note bars:** on iPhone Duo the note's top bar and tool buttons become iOS bars, so they join iOS's side column like every other screen. The bar on the keyboard stays on the keyboard. Other iPhones keep today's note bars.

- **Second pass, same day:** the owner called the first build a mess (empty space, crowded bars, sidebar squeezing the list) and asked for controls on the right side, vertically, after deep research. Redone per Apple's HIG and tech talks: iOS's split view for Home, iOS's tab bar and toolbar items in the side column, no custom sidebar (docs/IPHONE_DUO_PLAN.md). This replaces the sidebar pick above.
- **Right column with nothing open (2026-11-19):** the owner picked "Last note I opened" (as Notes does), not an empty page or the newest edited note.

- **Paused (2026-11-19):** the owner said "pause duo app". Do no more iPhone Duo work until they ask again. Branch `claude/iphone-duo-18adb4` holds it all (last commit `8850c330`), unpushed and unreleased.

**Why:** Apple's iPhone Duo guidance (keep the hierarchy identical inside and out, use system bars so they move to the side and avoid the fold).

**How to apply:** decide layout by size class and width, never by device model. The iPad keeps its own Mac-style layout (see ios-native-look-decisions).
