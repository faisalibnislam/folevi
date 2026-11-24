---
name: windows-app-decisions-2026-11-24
description: "Owner's 2026-11-24 desktop picks: first Electron for Windows, then Tauri 2 (system web view) for Windows ARM64/x64 and Linux x86_64/aarch64; unsigned, folevi.com + R2 updates, Win10 22H2 + 11, own top bar, CI builds"
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

**Later the same day** the owner chose "one web app everywhere" and asked to keep the Mac app's approach ("small in size and run smoothly, use less ram") for every platform: the desktop app became **Tauri 2** with the system web view, for Windows (ARM64, x64) and Linux (x86_64, aarch64: AppImage, deb, rpm, Flatpak). Builds run on GitHub Actions' native machines (owner's pick), kept 7 days as workflow artifacts. The Electron build stays in history (PR 58, `claude/windows-electron-4ed862`). Mac keeps its own app.

Built in `apps/desktop` (Tauri), docs in `docs/DESKTOP_APP.md`. Tabs follow
[[tabs-match-web-2026-11-24]] for free: it is the web app's tab strip. This reverses "Windows dropped 2026-10-16"
in [[platforms-mac-ios-web-only]].

**Why:** the owner wants Windows users, quickly, without a second native codebase.
**How to apply:** two native builds (never x64 under emulation on ARM); no upload, publish or signing purchase
without the owner's OK; Quick Add defaults to Ctrl+Alt+Space on Windows (Alt+Space is the window menu).
