---
name: ios-app
description: 2026-10-15 decisions for Folevi's iOS app: Capacitor shell loading app.folevi.com, iPhone+iPad, iOS 17+, no in-app buying, native extras list
metadata:
  type: project
---

On 2026-10-15 the user asked for an iOS app ("an important part") and decided (AskUserQuestion):
- **Approach:** Capacitor shell + native Swift extras, like the Mac Electron shell ([[mac-is-electron]], [[mac-follows-web]]): loads **https://app.folevi.com**, cached offline by the service worker (WKAppBoundDomains). Not a bundled copy, not SwiftUI/RN rewrites.
- **Devices:** universal iPhone + iPad. **Minimum iOS 26.**
- **Apple account:** (superseded 2026-10-22: paid Developer Program, team 7K32QQ2FX8, see [[apple-developer-account]]) none yet (no paid Developer Program). Build and test in the iOS Simulator only (Xcode 27, iOS 27 sims on this Mac); no device builds, TestFlight or App Store until the user joins.
- **Payments:** no buying inside the app (no prices, buy buttons or upgrade links in the iOS app, App Store guideline 3.1.1); people subscribe on folevi.com (Polar) and the app unlocks.
- **Native v1:** share sheet (save to Inbox, offline), widgets (Home + Lock Screen: today's tasks, recent notes, Quick Add), Siri/Shortcuts/Control Center (App Intents), document scanner (VisionKit + OCR), push notifications (APNs, wired now, enabled after joining), Face ID lock (optional), Spotlight (recent/starred notes), haptics + native feel. Audio: mic recording only (no call capture on iOS).
- Same workflow rules: local commits, push only when told ([[push-after-changes]]).

**iPhone UX revamp (2026-10-16):** the user said the app "feels like a mobile website poorly acting as an iOS app" and shared Craft iOS screenshots as inspiration (large titles, floating glass tab bar, glass back/action pills, search under the title, recent-doc carousel, iOS list rows with counts, folder tiles, full-screen notes with floating bottom toolbars, bottom sheets, a + menu). Decisions: applies to the **iOS app on iPhone only** (phone browsers keep the mobile web layout; iPad keeps the sidebar layout with its own polish); **Folevi's own fonts everywhere** (not SF); tab bar **Home, Tasks, Calendar** plus a separate pill with **Foli AI and +** (new note, from template, new folder, quick task), search at the top of Home; **Liquid Glass** (frosted translucent floating chrome in Folevi's neutral colours, done in the web layer so it works from iOS 17).
