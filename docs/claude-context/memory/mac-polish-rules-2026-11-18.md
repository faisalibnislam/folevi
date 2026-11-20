---
name: mac-polish-rules-2026-11-18
description: "Owner's Mac app polish rules given 2026-11-18 while reviewing the native look build (spacing, glass, buttons, fonts, icons, no duplicate controls)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 95c9cb15-1f8c-4eb8-9272-93d7db7e0935
  modified: 2026-11-18T04:12:41.161Z
---

Given by the owner (Faisal) in chat on 2026-11-18, while reviewing the `mac-native-look` build of Folevi for Mac. They add to [[mac-native-look-decisions]].

- The left sidebar looked too compressed: every row needs more breathing space.
- "I love Liquid Glass": use it wherever there is scope (my reading: on controls floating over content and the navigation layer, never on content itself, per Apple's rule).
- Buttons were too small in many places: button size and thickness must be consistent, font sizes consistent.
- System font throughout the Mac app except notes, folders and the editor. Confirmed in the picker: a note card keeps its title (Spectral) and preview (the note's fonts), its dates and chip go system; a folder card keeps its name (Spectral) and the notes pictured in it, its count line goes system; the note page is left as it is (title and body in the note's fonts, its tools system).
- New note (owner's final pick 2026-11-19): one New note on Mac and iPad, a black "+ New note" pill in the title bar right after the tabs, before sync and bell (white in dark mode), native Liquid Glass; no New note row in the sidebar, no round + in the tab track. Show All Tabs must stay visible.
- Sidebar section headings that open a page need a full-row hover like the rows, not a thin one.
- No unnecessary or repeated buttons (named: the circle + on Home and on a note, the extra floating Share on a note). "Rethink and make the best decision."
- Icons: use Folevi's web icons wherever the web has one so Mac and web match, and the Foli AI icon for Foli AI; otherwise as few differences as possible. This overrides SF Symbols in the Mac chrome.
- The owner wants a checklist of where native SwiftUI, Liquid Glass and macOS UI is used, could be used and can't: `docs/MAC_NATIVE_CHECKLIST.md` on branch `mac-native-look`.

**Why:** The redesigned Mac app felt raw: misaligned, clipped shadows, cramped, inconsistent controls. "UI will have to be first class."

**How to apply:** On any Mac UI work, check against `docs/MAC_NATIVE_LOOK.md` (it holds these as rules: row sizes, one control size via `macNativeChrome()`, `MacSymbol` for icons, no control twice). Verify with real window captures (`screencapture -l <window id>`), since the app's own `windowShot` can't draw glass, materials or shadows.
