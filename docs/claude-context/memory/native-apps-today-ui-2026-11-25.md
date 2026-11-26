---
name: native-apps-today-ui-2026-11-25
description: "Owner's 2026-11-25 decision: iOS and Android go native (SwiftUI / Jetpack Compose) except the note writing area, matching today's web UI, one big switch"
metadata:
  type: project
---

On 2026-11-25 the owner found the Capacitor iOS app "finicky" (UI and UX fine, the HTML app's feel not) and decided:

**iOS (native SwiftUI, `apps/ios` + `apps/native-kit`):**
- Everything native except the note's writing area (the web editor stays, in a web view).
- Match today's UI (the web phone layout in `apps/web/src/components/iphone/*` and the tablet Shell as of PR 83,
  1.5.78 build 101) screen by screen; this replaces the 2026-11-23 Mac-profile redesign
  ([[ios-redesign-decisions-2026-11-23]]) where they differ.
- But use Liquid Glass and iOS's own elements wherever they work: buttons, sheets and modals, floating bars, menus,
  navigation, motion and animation. "Don't be shy."
- iOS 26 and later only (no pre-glass fallbacks).
- The note page's chrome is all native: top bar, floating bottom bars, keyboard bar, tool sheets (Format, Style,
  Insert, Comments), menus.
- Foli AI chat native SwiftUI.
- Settings native, except the technical sections (Webhooks, API tokens, Connected apps, AI export, workspace Data),
  which open as in-app web pages.
- iPhone first, then iPad and iPhone Duo.
- One big switch: the Capacitor app (`apps/mobile`) keeps shipping until every screen is native. Until then native
  builds are checked on the Simulator only (no native TestFlight builds before the switch).
- TestFlight uploads (internal testers) may go up without asking each time; App Store submission still needs the OK.
- Meanwhile the Capacitor apps get only serious bugs fixed (crashes, data problems, blockers); polish goes native.
- Skills to use for this work: apple-hig, apple-design, axiom-swift, axiom-design, liquid-glass,
  liquid-glass-motion, axiom-performance.

**Android:** the same shape in Jetpack Compose (handed to the Android session): today's UI with Material 3
(Expressive) elements, motion and predictive back; web editor only for writing; one big switch; emulators until
done; no Play upload without the OK.

**Follow-up picks (same day, after comparing the native app on `main` with today's app on the Simulator):**
- Screen titles in Folevi's serif (Spectral), as today, still collapsing into the bar natively.
- Bottom: iOS 26's Liquid Glass tab bar (Home, Tasks, Calendar, Foli AI) with + as a floating glass control beside
  it and Search as iOS's separate search button.
- Lists (Calendar, Tasks and the like): plain rows on the screen's background, as today, not cards on grey.
- Home in today's order: search field, recent notes, Catch me up, All notes / Drafts, Bookmarks, Folders.
- iPhone Duo upright (open, 669 pt) shows the phone layout, as today's 700 pt rule (replaces "across or upright" from [[iphone-duo-decisions]]); open across stays the wide layout.
