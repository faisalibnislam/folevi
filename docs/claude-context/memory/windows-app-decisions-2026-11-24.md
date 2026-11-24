---
name: windows-app-decisions-2026-11-24
description: "Owner's 2026-11-24 Windows app picks: Electron, native arm64 + x64, unsigned for now, folevi.com download with auto-update (R2), Windows 10 22H2 + 11, Folevi's own top bar with Windows caption buttons"
metadata:
  type: project
---

On 2026-11-24 the owner asked for Folevi for Windows ("it can be electron app or any other quick solution"), chose
Electron, and said: "Windows app must support Windows on ARM and Windows on Intel natively." Their answers to the
setup questions (AskUserQuestion):
- **Signing:** unsigned for now (SmartScreen warns). Azure Trusted Signing (~$10/month) was the recommended option;
  ask again before any public release.
- **Distribution:** a download from folevi.com with automatic updates from the same R2 bucket as the Mac
  (`folevi-updates`, `folevi.com/download/windows/<arch>/`). Microsoft Store maybe later.
- **Windows versions:** Windows 10 22H2 and Windows 11.
- **Title bar:** Folevi's own top bar, with Windows' real caption buttons (Window Controls Overlay), not the
  standard title bar.

Built in `apps/desktop` (the revived Electron app, Mac parts removed), docs in `docs/WINDOWS.md`. Tabs follow
[[tabs-match-web-2026-11-24]] for free: it is the web app's tab strip. This reverses "Windows dropped 2026-10-16"
in [[platforms-mac-ios-web-only]].

**Why:** the owner wants Windows users, quickly, without a second native codebase.
**How to apply:** two native builds (never x64 under emulation on ARM); no upload, publish or signing purchase
without the owner's OK; Quick Add defaults to Ctrl+Alt+Space on Windows (Alt+Space is the window menu).
