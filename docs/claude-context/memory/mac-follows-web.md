---
name: mac-follows-web
description: "Folevi rule: every web app change goes to the Mac app too (rebuild and install the Mac app with it); iOS/iPadOS paused since 2026-10-20"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-20T13:48:29.930Z
---

The web app is the single source of truth and the Mac app must match it 100% (features, behaviour, visuals). Today the Mac app is an Electron shell loading app.folevi.com ([[mac-is-electron]]); once the built-in interface ships (local mode plan, [[local-mode-decisions]]) parity is no longer automatic.

2026-10-20 instruction: "from now on, whenever I update the web app, please sync the feature with macapp too". So whenever web changes are pushed, also rebuild and install the Mac app (`pnpm release` in apps/desktop, which bumps the version, signs and installs) and make sure the feature works there, including any Mac-specific bits (title bar, window buttons, menus, Quick Add). The iPhone and iPad apps are paused for now: don't rebuild or extend apps/ios, and defer iOS parts of the local mode plan, until the owner says to resume.

**Why:** the user repeatedly found gaps between platforms and wants zero differences on the Mac; iOS waits for the Apple Developer Program and their go-ahead.

**How to apply:** build features in the web app, then ship them to the Mac app in the same round (rebuild after each push, and check desktop behaviour); keep desktop-only code in apps/desktop minimal. Related: [[no-os-default-controls]], [[neutral-chrome-notes-carry-color]], [[ios-app]].

2026-10-22: the owner said "resume iOS and set up iCloud sync after encryption". Once the E2EE build is done, the iPhone and iPad apps resume (team 7K32QQ2FX8, [[apple-developer-account]]): web changes then ship to iOS too, and local mode's iCloud sync moves to the real `iCloud.com.folevi` container shared by Mac and iPhone.

2026-10-22 (later): iOS/iPadOS resumed and the Android app started (owner: "start iOS, iPadOS and Android app"). From now on web changes ship to the Mac, iOS/iPadOS and (once it exists) Android apps.
