---
name: ios-redesign-decisions-2026-11-23
description: "Owner's 2026-11-23 picks for redesigning the iPhone and iPad apps the way the Mac was (Macloving window profile), in three checkbox dialogs"
metadata:
  type: project
---

On 2026-11-23, right after the Mac's Macloving main-window redesign (branch `claude/folevi-core-529dbe`), the owner
asked to "completely redesign the iPhone app natively, just like you did for the Mac app... also for iPad". Answers:

**iPhone look:** the iOS-native version of the Mac profile, not a literal inset card. Screens run edge to edge;
each screen's top bar is the Mac's (title, its actions grouped in one glass capsule, then search); content sits in
rounded opaque cards on the grey frame colour.

**iPhone scope (all allowed):** every screen restyled; Home may be reorganized; navigation may change; the note
page is included (its drawn bars get the new look).

**Earlier iPhone rules ([[ios-native-look-decisions]]):**
- Kept: a note keeps Folevi's own drawn bars where the tab bar is (PhoneNoteBarsSlot), never iOS's system bars.
- Kept by a later answer: Foli AI stays a tab-bar item (only when Foli AI is on).
- Dropped: "Filter ... fields always visible", "+ alone in the top bar", "iOS's own tab bar unchanged".

**Navigation:** the tab bar has fewer items: Home, Tasks, Calendar, Foli AI (when on), plus iOS 26's separate
round search button at its end. Search is also a glass capsule in each screen's top bar.

**Colour and type (iPhone and iPad):** keep Folevi's black-and-white ink (not the system accent); interface text in
the Mac guide's four sizes scaled to iOS (notes and note cards keep Folevi's fonts); no row lines (rounded
highlights instead). Capsule choices were NOT picked: segmented controls stay iOS's own.

**iPad:** a glass top bar drawn per screen inside the card (the Mac's ScreenBar); the note's side panel becomes the
Mac's flat rounded inspector (quiet grey fill, 18 pt corners, no glass); the Mac's 228 pt sidebar scale (still
floating in portrait); tabs stay on Folevi's strip above the card.

**Release:** open a PR into `claude/folevi-core-529dbe`; when done, cut a new patch (1.5.65) on the branch and
upload iPhone and iPad to TestFlight without asking again (web and Mac not released, main not pushed).

**Why:** the owner wants the three Apple apps to share the Mac's new window design, adapted to each platform.

**How to apply:** follow these for any iPhone/iPad screen work after 2026-11-23. Related:
[[iphone-feedback-applies-to-ipad]], [[editor-quality-bar-2026-11-19]].

**Second round (2026-11-24): native like the Mac.** After the Mac dropped the Macloving guide for a system-native
window (commit 4a2f2031: split view, unified Liquid Glass toolbar, system inspector, native tabs), the owner chose
the same direction for iOS, replacing the iPad and list parts above:
- **iPad:** a system split view (sidebar column) with the system toolbar in Liquid Glass (Back/Forward, title,
  New note ink pill, the screen's items, search); Folevi's tabs kept but drawn the system way (Safari on iPadOS 26
  style); the note's tools (Style, Format, Insert, Foli AI) in the system inspector as native panels, not the web
  panel.
- **iPhone:** lists and Settings become iOS's own List (inset grouped, system grouped background, native swipe
  actions) with row lines hidden (the owner ticked both "system lists" and "keep cards, no lines"); Home keeps
  its note and folder cards, recent strip and tiles; the note keeps Folevi's drawn bars.

**Tabs (2026-11-24):** the iPad opens pages in tabs exactly as the web does (checked, no change needed). The owner
confirmed links inside a note stay in the same tab, like the web (only pages opened from lists, cards, See all,
folder cards, search, the palette and Foli AI or notification links get a new tab with an opener).
