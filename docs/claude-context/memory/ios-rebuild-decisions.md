---
name: ios-rebuild-decisions
description: "2026-10-30 owner resumed iPhone/iPad as a native rebuild with the Mac rule: everything native but the editor, pixel match with the web's phone layout"
metadata:
  type: project
---

2026-10-30 the owner: "let's start the iOS app, same native rule as mac app." Picker answers (full list in
docs/IOS_REBUILD_PLAN.md section 0): iPhone matches the web's phone layout pixel for pixel (glass top bar, tab
bar, Foli AI and + pill) with iOS behaviour kept; iPad together with iPhone (web's iPad layout, sidebar and tab
strip); start from the Mac rebuild code only (`native-app` iPhone work is reference only); account-free local
mode like the Mac; only the note editor is web; minimum iOS 18; one build at the end (no TestFlight builds on
the way, the upload asked first).

**Why:** the iOS app should feel first-class and look exactly like the web, as the Mac app now does.
**How to apply:** supersedes "keep it hybrid" in [[ios-polish-2026-10-22]] and the iOS pause in
[[mac-rebuild-decisions]]. Android stays paused. Related: [[iphone-feedback-applies-to-ipad]].
