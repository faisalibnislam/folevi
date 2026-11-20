---
name: ios-native-look-decisions
description: "Owner's 2026-11-19 picks for the iPhone/iPad native look (shipped 1.5.50), plus the iPhone rules from the device review that shipped in 1.5.51"
metadata:
  node_type: memory
  type: project
  originSessionId: 268f5a8a-585a-47a3-bd85-16826be58f9a
  modified: 2026-11-19T09:44:34.612Z
---

On 2026-11-19 the owner asked to apply what was learnt on the Mac app (docs/MAC_NATIVE_LOOK.md) to iOS. Picks:
- iPad: the same layout as the Mac (tabs along the top, floating Liquid Glass card controls, sidebar and note panel on the translucent material), with iPadOS 26 controls and touch sizes.
- iPhone: native iOS 26 chrome (system font, system tab bar and toolbars in Liquid Glass, native menus, sheets and fields, Folevi's black-and-white accent). Notes and note cards keep Folevi's fonts.
- Carry over all of: the Vault, Tasks and Calendar redesigns, the Settings redesign, the Mac's performance fixes, and the note page changes.
- Shipped as 1.5.50 (Big update) on all platforms the same day, then 1.5.51.

The owner's rules from reviewing 1.5.50 on a real iPhone (shipped 1.5.51):
- No glass around the account avatar (`sharedBackgroundVisibility(.hidden)`); a workspace logo's badge ring is the screen's own colour.
- No bar over the tab bar: Foli AI must be present but not the focus (not everyone has it). Foli AI is a tab-bar item (after Calendar, before Search, only when Foli AI is on) that opens its sheet; + stays alone in each tab's first screen's top bar (owner's follow-up 2026-11-19, after 1.5.52).
- Things in sight, not in menus: All folders and Foli DNA are rows on Home; no New folder on Home or in +; no Folders "…" menu.
- A field that filters a list is "Filter notes" / "Filter folders" / "Filter tags" with the funnel icon, always visible (no pull), on every platform.
- Search's close button returns to the screen Search was opened from. Notifications has no settings button.
- A note on iPhone keeps Folevi's own drawn bars (the place pill, the tools group, Foli AI and the black + circle). iOS's own bars were tried in 1.5.55 and the owner rejected them 2026-11-20 ("previous design was much better; animation was the problem"): the transition is fixed by the frame drawing the note's bars where the tab bar is (PhoneNoteBarsSlot) so they swap in place; never switch to system bars.
- The tab bar's collapse on scroll stays iOS's own (the owner, 2026-11-19, after its ~130 ms crossfade was traced to iOS 27 itself): no custom bar to slow the morph.
- Home shows the sync status (a cloud before the bell, signed in only), as the web does.
- Dark-mode switches are graphite (#8C8C90) when on, since the knob is always white.

**Why:** It supersedes [[mac-native-look-decisions]]'s "iPad undecided"; the review rules are the owner's corrections.

**How to apply:** Follow these for new iPhone screens. Each TestFlight upload and each push of main still needs the owner's OK for that release.
