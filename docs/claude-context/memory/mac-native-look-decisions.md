---
name: mac-native-look-decisions
description: "Owner's 2026-11-18 choices for the Mac app's move from web-matched look to stock macOS look (mockups stage)"
metadata:
  node_type: memory
  type: project
  originSessionId: 268f5a8a-585a-47a3-bd85-16826be58f9a
  modified: 2026-11-17T23:40:39.545Z
---

On 2026-11-18 the owner asked for the Mac app to keep every feature and the same layout but look like a native macOS app. Choices made in the picker:
- Replace the current look in the normal Mac app. No setting to switch looks, and no separate beta app.
- System chrome, Folevi content: window, sidebar, toolbar, menus, popovers, lists, Settings and dialogs use stock macOS 26 parts and SF Pro. Notes and the editor keep Instrument Sans and Spectral.
- Tabs: Folevi's tab model kept (joined, pinned, per-place, folder tabs), drawn as a capsule track in the glass top bar. Native window tabs were rejected: each would be its own window and engine.
- macOS 26 minimum, up from 15.
- Accent: Folevi is black and white, not brown (owner's correction): #1F1F22 light, #F2F2F3 dark.
- Settings: its own window with a left category list and a working search field, per the owner's Mac UI guide.
- Sidebar: always visible, with no hide button; Focus mode still hides it.
- The owner's Mac UI guide (macloving-mac-ui.md) applies to Folevi's window profile, but its Macloving-only rules (About, bundle IDs, releases) don't.
- Built on branch mac-native-look (docs/MAC_NATIVE_LOOK.md). Released 2026-11-18 as Folevi 1.4.44 (Big update, Mac only, main pushed, published through Sparkle; macOS 26 minimum, older Macs stay on 1.3.44).
- Mockups first. Canvas: https://claude.ai/artifact/APeXiBDiWzZ4WnKFKQ8hCW
- iPad: decided 2026-11-19, see [[ios-native-look-decisions]] (same layout as the Mac).

**Why:** This reverses the October 2026 "pixel match with the web" rule (docs/MAC_REBUILD_PLAN.md) for the Mac chrome.

**How to apply:** The look is live; new Mac UI work follows docs/MAC_NATIVE_LOOK.md. When building, the web-parity screenshot diffs can only cover note content, not the chrome.
