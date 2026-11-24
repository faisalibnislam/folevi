---
name: android-native-decisions-2026-11-23
description: "2026-11-23 owner resumed Android as a native Compose app like iPhone: Googlebook + phones/foldables/tablets, API 33, Material 3 Expressive with Folevi colors, everything in the first build"
metadata:
  type: project
---

2026-11-23 the owner asked for a native Android app "just like iPhone" for phones, tablets and "Google Book"
(= Googlebook, Google's Android laptops). Checkbox answers (plan: docs/ANDROID_NATIVE_PLAN.md):
- Devices: Googlebook laptops, phones and foldables, tablets. Not older Chromebooks.
- Minimum Android 13 (API 33). Package stays `com.folevi.android`.
- Look: **Material 3 Expressive with Folevi's colors**, but Folevi's own icons (Lucide), typefaces (Instrument
  Sans, Spectral), note cards, frosted folders and note colors. Material for bars, nav, buttons, menus, sheets,
  search, dialogs, motion. (Changes the 2026-10-22 "not Material You" rule in [[android-app]].)
- Layouts: phone like iPhone, tablet like iPad, Googlebook like the Mac app, foldable list beside note.
- Phone tabs: Home, Tasks, Calendar plus **Foli AI as its own tab** and a floating New note button.
- First build: everything (notes core, Tasks/Calendar, Foli AI/Settings, local mode, Vault, Android extras).
- The paused Capacitor app is **replaced**; its Kotlin services move into the native app; Capacitor goes.
- Builds: emulators now, Play internal testing soon (owner does console and keys).

**Why:** the owner wants Android to be first-class like the iPhone app and to run on Googlebooks.
**How to apply:** Android is no longer paused. Native screens talk to the web engine through the Kotlin
bridge generated from protocol.ts (`pnpm engine:gen:kotlin`); keep it current with every contract change.
