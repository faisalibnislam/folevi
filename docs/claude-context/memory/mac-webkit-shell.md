---
name: mac-webkit-shell
description: 2026-10-22 owner chose to replace the Electron Mac app with a thin native AppKit + WKWebView shell reusing the iOS Swift bridge (option A)
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-22T16:42:04.673Z
---

2026-10-22: asked how to drop Electron's bundled Chromium without a Swift rewrite, the owner picked **option A**: a thin native AppKit shell with WKWebView, the same web interface inside, reusing the iPhone app's Swift bridge code (library files, Keychain, E2EE keys, on-device AI, notifications, places) plus Mac-only pieces (menu bar, Quick Add panel, tray, Dock badge, login item, Touch ID, Sparkle updates, multiple windows). Rejected: Tauri, Mac Catalyst, keeping Electron. Plan: docs/MAC_WEBKIT_PLAN.md; Mac polish audit: docs/MAC_POLISH_PLAN.md (native pieces designed for the new shell).

Owner's answers (docs/MAC_WEBKIT_PLAN.md §13): Folevi's own menus everywhere (spelling/Look Up added via native); separate Settings window; system translucent sidebar (Mac exception to neutral chrome); macOS window tabs off; Writing Tools off; minimum macOS 15; bundle id com.folevi.mac, Developer ID only, v2.0.0; Claude makes the provisioning profile and Sparkle key. Mac polish: only Quick Add as one growing field (keep New note button, Foli AI pill, Folevi dialogs).

Release setup (WM3, 2026-10-23): Developer ID profile for com.folevi.mac at apps/mac/signing/Folevi.provisionprofile; Sparkle EdDSA key in the owner's login Keychain (account "folevi"; public key in Info.plist; owner must back it up with generate_keys -x); migration from Electron proven (reads "Folevi Safe Storage" with no prompt under the same bundle id/team); order: ship Electron 1.22 (handover of unsent edits) for 2 weeks, then native 2.0.0; updates.folevi.com must resolve to the R2 bucket (not yet). xcodebuild tests hang on a pending "Folevi Dev wants to access Documents" prompt (repo is in ~/Documents).

2026-10-23 owner approved a memory plan for the native Mac app, in this order: measure with Instruments in a real setup; after the 1.0.00 release (1) one shared background page for all places or timed wake instead of a hidden page per place, (2) Quick Add and Settings web views created on demand; then (3) unload hidden tabs and restore from state, (4) lazy-load heavy blocks, (5) memory-pressure handling (drop caches).

**Why:** ~350 MB Electron app with its own Chrome vs a small, native-feeling app; the web layer already runs in WKWebView on iOS.
**How to apply:** supersedes the Electron parts of [[mac-is-electron]] once the new shell ships; keep Electron working until the switch, with data migration for existing Mac users. Still hybrid: web screens, native shell ([[ios-polish-2026-10-22]], [[mac-follows-web]]).
