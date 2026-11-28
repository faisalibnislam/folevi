# Mac 1.9.81 released with the menu bar note panel (PR 195); the quick note waits for 1.9.82

- Date: 2026-11-28 07:17 UTC
- Area: release, mac
- Branch: claude/handoff-mac-1.9.81

The owner's words, in the PR manager session on 2026-11-28: "Yes, release Mac" (to "Release Mac 1.9.81 as a small update once PR 195 is in main?"; the menu bar session had relayed "release Mac as a small update"), and later "Ship 195 now" (to "Which menu bar note should Mac 1.9.81 ship?", the other choice being to wait for PR 199).

Version: 1.9.81, build 112, Small update, cut with node scripts/version.mjs release patch in PR 197 (merged as e1c35d2e). Mac only; iPhone and iPad stay on 1.9.80 (111).

What the build is: b16cba0f, which is main at PR 195's merge (491f6f56) plus the version commit. It is not PR 197's merge commit. Between cutting the branch and publishing, main gained PR 196 (shadows), 198 (CI), 199 (quick note), 200 (native test fix) and 201 (platform pause); the owner chose the tested commit with the panel over waiting. So the published Mac app has the real-note panel and none of those five.

Checks on b16cba0f before publishing: swift test --filter FoleviMenuBarNoteTests 17 pass, --filter FoleviMacTests 266 pass, release.mjs dry run passed. The panel snapshot test opens a borderless window at (-20000, -20000) with orderFrontRegardless; it takes no focus.

Publish (apps/mac/scripts/publish.mjs): notarization Accepted for the app and the DMG, both stapled. After it: hosted mac/Folevi-1.9.81.dmg and mac/Folevi.dmg match the local DMG (119,716,513 bytes, SHA-256 85c87b45c4dc21e0738165276e278974d0df5ade3e394a1713adb2c639ebf766), hosted mac/Folevi-1.9.81.zip matches the local ZIP and the copy in release-archive (109,743,948 bytes); stapler validate and spctl say Notarized Developer ID, Abu Mohammad Faisal (7K32QQ2FX8), for the DMG and the app; the app is 1.9.81 (112), x86_64 and arm64; the feed's first item is 1.9.81 (112) with deltas from 111, 110 and 109, each returning 200; two ranged requests return 206 with 100 bytes and a plain request the full length. Tag v1.9.81 at b16cba0f, local only.

Not done by anyone: the published build opened on a Mac; the panel in a Release build (the owner tried it in Folevi Dev); the Screen Recording prompt for screenshots; a Sparkle update from 1.9.80; the app-hosted FoleviTests.

The same hour the Linux session removed the Windows, Linux and Android files from the same bucket (PR 202). Checked before and after: everything under mac/ was untouched.

For 1.9.82 (the owner has not asked for it): main has the quick note (PR 199), which the owner asked for in place of the panel, and the shadows change. The quick note's release notes, from its session:
- Summary: The Mac app gets a quick note in the menu bar: write a thought from any app and save it to Folevi.
- Added: A quick note under the menu bar icon or with Option+Space, as on Home: write, then Save (Command+Return) makes a note in Drafts or the folder you pick, its first line the title, with Open and Undo. Add as a task (Shift+Command+Return), screenshots saved with the note (Shift+Command+5), pin on top, open as a window.
On the release branch merged with main and PR 199 (before PR 201 landed): FoleviMenuBarNoteTests 14, FoleviMacTests 266, FoleviDesignTests 36 passed, and a dry run passed.

Two things that went wrong on the way, for whoever releases next:
- PR 196 merged with two native test files that no longer compiled, so swift test failed for every target on main until PR 200. CI builds no Swift. The PR manager now runs swift build --build-tests and the Mac and design suites on any pull request that touches apps/native-kit before turning on auto-merge (it caught 21 failing snapshots on PR 190 that way the same day).
- The folevi.com changelog page has no 1.9.81 entry; its entries are written by hand by the Landing Page session.
