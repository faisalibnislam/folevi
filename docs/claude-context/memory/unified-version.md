---
name: unified-version
description: "Since 2026-10-23 every platform shares one version number #.#.## starting at 1.0.00; no build number shown anywhere"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-22T23:11:07.543Z
---

2026-10-23 owner: one unified version for all platforms (web, native Mac, iPhone/iPad, Android), format `#.#.##` = biggest release . big change . minor release, starting at **1.0.00**. Minor releases 1.0.01, 1.0.02 ... ; a big change bumps the middle and resets to 00 (1.1.00); biggest release bumps the first (2.0.00). Shown as plain "Folevi 1.0.00", never with a build number like "(111)" (Apple/Android hidden build numbers still exist internally).

Same day: release the native Mac app now as 1.0.00 (not 2.0.0, not after two weeks of Electron 1.22), install on this Mac and publish the download; check nothing is unsynced before switching; then remove Electron completely: the app from this Mac (Trash), its data folder (~/Library/Application Support/Folevi, Trash, after migration is confirmed; never the library in Documents), the apps/desktop code, and point the old Electron update feed at the native app. iOS TestFlight, Android and the website all show 1.0.00.

**Why:** one simple, consistent version across Folevi.
**How to apply:** bump every platform together; supersedes the "bump the number after 1." rule in [[mac-is-electron]] and the 2.0.0 plan in [[mac-webkit-shell]].
