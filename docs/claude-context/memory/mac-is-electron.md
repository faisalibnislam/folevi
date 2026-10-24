---
name: mac-is-electron
description: "Since 2026-10-09 the Mac app is an Electron shell (apps/desktop) loading app.folevi.com, signed with the user's Apple Development cert, installed to /Applications and relaunched after every build; native Swift app archived"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-10T08:30:15.093Z
---

**SUPERSEDED 2026-10-23:** Electron is gone (apps/desktop deleted, app trashed). Folevi for Mac is the native AppKit + WKWebView app in apps/mac ([[mac-webkit-shell]], [[unified-version]]). The notes below are history.

2026-10-09 decisions (user, via questions):
- Mac app = Electron in `apps/desktop`, loading **https://app.folevi.com** (production; web deploys update it, offline via the site's own service worker + IndexedDB). Not bundled.
- Extras: global Quick Add (default ⌥Space, changeable in Settings), menu bar icon, open at login, native notifications + Dock badge. Seamless title bar (traffic lights inside the app's top area).
- Signing (superseded 2026-10-22 by [[apple-developer-account]]: Developer ID, team 7K32QQ2FX8): user's **free personal team** "Apple Development: abumohammadfaisal@icloud.com" (team 558GMKM4KY, cert valid to 2027-10). Can't notarize or share; local use only. Signing with this stable identity is what stops macOS re-asking for permissions (ad-hoc "-" signatures changed every build).
- Every Mac build: sign, replace **/Applications/Folevi.app**, relaunch from there. Production build only (no dev copy in Applications).
- Versioning (user, 2026-10-10): every build bumps the number after "1." (1.1.0, 1.2.0, …). `pnpm release` in apps/desktop does it (scripts/bump-version.mjs); commit the bumped package.json locally after each build.
- Native Swift app (`apps/macos`, ~60k lines) archived on a local git tag/branch with the old Mac WIP stash, then removed from main.
- The user said not to ask about Mac accessibility prompts any more; signing is the fix.

**Why:** a 100% web-matching Mac app ([[mac-follows-web]]) by hand-porting was always behind; Electron gives parity for free.

**How to apply:** Mac features come from the web app; desktop-only bits go through the preload bridge (`window.foleviDesktop`). Test the shell against the local dev server (env override), never by signing into production with the user's password. [[web-only-until-told]] and the native-port rules are superseded.

2026-10-16: the user dropped the Windows desktop app ("Drop windows app"). apps/desktop is Mac-only again: no Windows builds, installer, CI job or Windows-specific web code. Don't reintroduce Windows desktop support unless asked. (Web users on Windows PCs still get Ctrl key labels; that's the web, not the desktop app.)
