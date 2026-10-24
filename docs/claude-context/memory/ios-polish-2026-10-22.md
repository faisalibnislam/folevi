---
name: ios-polish-2026-10-22
description: "2026-10-22 owner said the iPhone UI feels amateur; decisions for the first-class polish pass (Folevi look, native menus/sheets/haptics, Craft as reference, everything incl. iPad)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-22T13:21:10.783Z
---

2026-10-22, after using the TestFlight build on a real iPhone: "iPhone UI doesn't feel like a polished UI. It feels amateur." Reported details: folder tiles with no names, finicky long press (text selection, menu item fired on release, folder opened under the menu, stuck "..." button), ring-in-a-ring "..." icon, tiny "Mark all read"/gear in the Notifications sheet, dark focus ring on tap.

Decisions (AskUserQuestion):
- Look: **Folevi's own look, more polish** (keep Folevi's fonts everywhere, as decided 2026-10-16; polish spacing, sizes, motion, details). Not SF Pro chrome.
- Building blocks (menus later narrowed by D1 below): **native iOS menus (UIMenu context menus with lifted preview), native sheets/action sheets, native haptics, swipe actions, pull to refresh, keyboard toolbar**; pages stay web so features stay in step with the website.
- Reference: **Craft**.
- Scope: everything, iPhone and iPad (Home, folders, lists, the note editor and its panels, sheets, menus, settings, search, tasks, calendar, Foli AI, sign-in, empty states).

Follow-up answers (docs/IOS_POLISH_PLAN.md §6): D1 menus stay **web menus in Folevi's fonts** styled to the iOS spec (native only for the lifted preview, haptics, action sheets/alerts, pickers); D2 **iPad keeps the tab strip**, restyled; D3 **keep rounded-square checkboxes** everywhere; D4 calendar = **week strip with pull-down month**. Owner also said: when the in-flight work (iOS fixes, polish, multiple accounts) is done, push everything and deploy, then Mac release + TestFlight.

2026-10-22 later: asked whether to go native (SwiftUI) or native chrome; owner chose **keep it hybrid (web screens in Capacitor) and polish it**. Don't propose a SwiftUI rewrite or native tab bar/nav bars unless the owner asks.

**Why:** the owner judges the iOS app against first-class iOS apps; web-feeling details read as amateur.
**How to apply:** test on a real device or the Simulator with touch before calling iPhone work done: 44 pt targets, no text selection/callouts on chrome, no visible focus rings on tap, menus that never fire on the opening press's release, labels always visible. Related: [[ios-app]], [[no-os-default-controls]] (native iOS menus/sheets are allowed in the iOS app by this decision), [[neutral-chrome-notes-carry-color]].
