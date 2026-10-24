---
name: android-app
description: "2026-10-22 owner decisions for the Folevi Android app (Capacitor + Kotlin extras, API 33+, phones/tablets/foldables, local mode, Play)"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-22T05:54:56.194Z
---

2026-10-22 the owner (a full Android developer) asked for an Android app again, reversing the 2026-10-16 drop ([[platforms-mac-ios-web-only]]). Decisions:
- **Approach:** Capacitor shell like the iPhone app ([[ios-app]]), the web app inside (full parity incl. local mode and encryption), Kotlin for native extras. Lives in apps/android.
- **Devices:** phones, tablets and foldables, one adaptive app (tablet/foldable gets the sidebar layout like iPad). **Minimum Android 13 (API 33).** No Chromebook or Wear OS work.
- **Payments:** no buying in the app (no prices, buy buttons or upgrade links); subscribe on folevi.com and the app unlocks.
- **Local mode:** yes, synced through Google Drive and Dropbox (the Mac's backends), interoperable with the Mac library; on-device Foli AI with Gemini Nano where supported, else the person's own key. No arbitrary-folder (SAF) option chosen.
- **Native v1:** share target (offline to Inbox), Quick Settings Quick Add tile and app shortcuts, Glance home screen widgets (today's to-dos, recent notes, Quick Add), FCM push (reminders, mentions, comments with reply/mark done), ML Kit document scanner with text, biometric lock, Google Assistant/Gemini app actions.
- **Look:** Folevi's own design (same as the iPhone app) with Android behaviour: back gesture and predictive back, edge-to-edge, ripples, haptics, system share sheet. Not Material You restyle.
- **Distribution:** Google Play; the owner has a Play Console account. Internal testing track, then closed, then production; Play App Signing.
- **Timing:** right after the encryption build, alongside resuming iOS (shared web-layer work done once for both).

**Why:** the owner wants every major platform and can maintain Android personally.
**How to apply:** web stays the source of truth ([[mac-follows-web]]); once Android exists, web changes ship to Android too. Ask the owner for Play Console steps (they do console work and secrets).

2026-10-23: owner said "pause the android for now". Android is built (apps/android) but paused: no new Android builds, releases or Android-specific work until the owner resumes it; web changes don't need an Android rebuild meanwhile.
