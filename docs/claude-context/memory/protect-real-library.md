---
name: protect-real-library
description: "~/Documents/Folevi Library is the owner's real local library; builders and tests must never open or write it"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-22T20:01:24.807Z
---

`~/Documents/Folevi Library` is the owner's real local-mode library (device "Faisal's MacBook Pro M5", libraryId 01M5E0HM04KKPXVPYBK9GPYRQX, created 2026-10-21). Electron's "This device only" library defaults there, so an Electron-from-source test run on 2026-10-23 added device records and catalogs to it (notes untouched; I moved the leftovers to the scratchpad). Also real: `~/Library/Application Support/Folevi` (Electron user data) and the "Folevi Safe Storage" Keychain item.

**Why:** test runs must never touch the owner's notes or devices list.
**How to apply:** every builder brief says: libraries and FOLEVI_USER_DATA only in scratch folders; never test or migrate against the real library, support folder or Keychain items; stop and report if a run touches a folder that isn't yours. Related: [[local-mode-decisions]], [[mac-webkit-shell]].
