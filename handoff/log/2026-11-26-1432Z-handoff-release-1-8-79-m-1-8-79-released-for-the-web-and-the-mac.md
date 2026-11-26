# 1.8.79 released for the web and the Mac

- Date: 2026-11-26 14:32 UTC
- Area: release, mac
- Branch: claude/handoff-release-1.8.79-mac

The owner asked for the spell check fixes live on the web and the Mac, and said "Yes, release Mac" in the PR manager session. Cut as a Small update, 1.8.79 (build 109), with `node scripts/version.mjs release patch`; PR 160 merged as `96674713`.

What went out:

- Web and Convex: Vercel built `96674713` and its production deployment finished with success.
- Mac: `node apps/mac/scripts/publish.mjs` from a clean checkout of `96674713`. Universal build, notarized, stapled, ZIP and DMG, appcast signed with the Sparkle key, deltas from builds 108, 103 and 102, uploaded to `folevi-updates`.

What was checked, and how:

- Before publishing: `node apps/mac/scripts/release.mjs --out <dir>` dry run passed its checks (designated requirement, production web bundle and Convex address, Sparkle key). `swift test --filter FoleviMacTests` in `apps/native-kit` passed, 250 tests in 50 suites. It needed PhoneWritingSettingsTests.swift guarded with `#if os(iOS)` locally; PR 161 made that guard permanent.
- After publishing: the live feed lists 1.8.79 (109) first. The hosted `Folevi.dmg` and `Folevi-1.8.79.zip` were downloaded and match the local builds by SHA-256. `spctl` says "Notarized Developer ID" for the DMG and for the app in the ZIP, `stapler validate` passes for both, the app is 1.8.79 (109), x86_64 and arm64.

What was not done:

- The app-hosted Mac unit tests (`xcodebuild test`, scheme Folevi) were not run: they launch Folevi Dev in the owner's desktop session.
- Nobody opened the published app or watched a Mac update from 1.8.78 through Sparkle.
- The web was checked by Vercel's deployment status only, not in a browser.
- iPhone, iPad, Android, Windows and Linux stay on 1.8.78. The tag `v1.8.79` is local, not pushed.

The Mac release archive lives in the main checkout (`apps/mac/release-archive/`). A worktree that publishes links to it first (`ln -s <main checkout>/apps/mac/release-archive apps/mac/release-archive`), so deltas are made and the new ZIP is kept for the next release.
