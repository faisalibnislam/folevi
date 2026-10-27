---
name: mac-rebuild-decisions
description: "2026-10-27 owner decisions for the native Mac rebuild: native everywhere but the editor, pixel match with the web, account-free local mode first-class"
metadata:
  type: project
---

2026-10-27 the owner resumed the Mac app only (iPhone/iPad paused, Android paused completely) and asked for a
full native rebuild: "Native as much as Possible ... looks must match 100% with the web app". The Mac app must
also work with no account, "just like obsidian: Free without limits".

Picker answers (full list in docs/MAC_REBUILD_PLAN.md section 0): start from the `native-app` branch; web data
engine via the bridge (bundled, offline); web editor in WKWebView; SwiftUI + AppKit; pixel match, Mac behaviour
kept; solid sidebar; Folevi menus drawn natively; everything native except the note editor (Vault, Foli AI,
all Settings, Graph, Reviews); `.fnote` library + Markdown export; first launch two equal choices; local Vault
without sharing; local sync and Foli AI as in October; macOS 15; direct download only; Sparkle update as 1.1.00;
automatic screenshot diffs; one release; order frame, local mode, lists, Tasks/Calendar/Settings, Foli AI,
Vault, rest; same-round parity enforced in CI after release; share Swift with iOS where cheap; keep every Mac
extra.

**Why:** a native-feeling Mac app identical to the web, usable as a free standalone notes app.
**How to apply:** supersedes the translucent sidebar and "technical Settings, Graph, Reviews stay web" from
[[mac-webkit-shell]] and [[native-ui-decisions]] for the Mac. Wait for the owner's go before building.
