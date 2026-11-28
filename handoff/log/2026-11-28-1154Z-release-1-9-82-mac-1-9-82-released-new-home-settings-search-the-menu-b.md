# Mac 1.9.82 released: new Home, Settings search, the menu bar quick note

- Date: 2026-11-28 11:54 UTC
- Area: release
- Branch: claude/release-1.9.82

By the PR manager session.

The owner's words, in this session on 2026-11-28: "Yes, release Mac", to "Publish Mac 1.9.82 now (notarize, upload, version PR)?". Before that the web app session relayed "all done, is so please release" and "release Mac, TestFlight and Folevi Server" from its own session; those relays were used only to prepare the build. TestFlight and Folevi Server have not been approved in this session and nothing was done for them.

Version: 1.9.82, build 113, Small update, cut with `node scripts/version.mjs release patch --notes-file`. Released for the Mac and the web. iPhone and iPad stay on 1.9.80 (111).

What the build is: `79cfe52e`, which is main at PR 205's merge (`e02b3c1e`) plus the version commit. Since Mac 1.9.81 it gains the shadow levels (PR 196, tests in PR 200), the menu bar quick note (PR 199, in place of 1.9.81's panel), the platform pause copy (PR 201), the web card polish, Home redesign and Settings search (PR 190), folder cards drawn with real note cards (PR 192) and the native port of Home, Settings, sidebar, lists and tasks (PR 205).

Checks before publishing, on PR 205's head `a0b5e24b` (the same tree as `e02b3c1e`): `swift build --build-tests` and `swift test`, every suite passed (257 screen, 278 Mac, 36 design, 28, 20, 14 menu bar note). On `79cfe52e`: `release.mjs --out <scratch> --universal` dry run passed (designated requirement, Resources/web production, Sparkle key, arm64 and x86_64).

Publish (`apps/mac/scripts/publish.mjs`): notarization Accepted for the app and the DMG, both stapled. After it: hosted `mac/Folevi-1.9.82.dmg` and `mac/Folevi.dmg` match the local DMG (120,868,893 bytes, SHA-256 `8853c82fbb12e9bbee234f246c3086addea360a829902cd274729c155732a5db`); hosted `mac/Folevi-1.9.82.zip` matches the local ZIP and the copy in release-archive (110,265,836 bytes, SHA-256 `4ec798a70e926a44053a35074283284ecab6de9d9ab6e68a887543d1d9734119`); stapler validate and spctl say Notarized Developer ID, Abu Mohammad Faisal (7K32QQ2FX8), for the DMG and the app; the app is 1.9.82 (113), x86_64 and arm64; the feed has six items, the first 1.9.82 (113) with deltas from 112, 111 and 110, each returning 200; a ranged request for the first 100 bytes of `Folevi.dmg` returns 206 with 100 bytes and the full download is the full length. Tag `v1.9.82` at `79cfe52e`, local only.

CI note for PR 205: its first job failed once with all 1,688 root tests passing, on a vitest teardown error in `tests/convex/backend.test.ts` ("Closing rpc while onUserConsoleLog was pending", after a scheduled `documents:autoVersion` logged an error). The suite passed four times locally on the same commit and the re-run passed. If it comes back, that test file needs its scheduled functions settled before the worker closes.

Not done by anyone: the published build opened on a Mac; a Sparkle update from 1.9.81; the quick note, the new Home and Settings search in a Release build; the Screen Recording prompt for screenshots; the app-hosted `FoleviTests`; any real iPhone or iPad.
