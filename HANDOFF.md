# Folevi: handoff

> Read this first if you are a Claude (or any agent) picking this project up, on this Mac or another one. Then read `CLAUDE.md`, `docs/HANDOFF.md` (the long handoff: unfinished branches, release detail, what the owner is waiting on) and `docs/claude-context/memory/MEMORY.md` (the owner's standing rules). Keep this file current: after every change to the project, update "Current state", "Next steps" and "Change log", and commit it.

Last updated: 2026-11-19 · Written on: Faisal's MacBook Pro M5

## 1. What this is
Folevi, a notes app with Foli AI (the assistant's name). Free native apps for Mac, iPhone and iPad with no account needed, optional cloud plans, and a web app. Shipped: version 1.5.52 (19 November 2026) is live on the web (folevi.com, app.folevi.com), as a direct-download Mac app with Sparkle updates, and on TestFlight for iPhone and iPad. Android is paused.

## 2. Where it lives
- GitHub: `faisalibnislam/folevi`, default branch `main` (gh account `faisalibnislam`).
- This Mac: `/Volumes/Corsair/Github External/Airly Studio External/folevi`. The main checkout is on `editor/rock-solid` (the editor session's work); other work happens in worktrees under `.claude/worktrees/`. On a new Mac: clone from GitHub.
- Monorepo: `apps/web` (Next.js 16, marketing site and app), `convex/` (backend), `apps/mac` (AppKit shell), `apps/ios` (iPhone and iPad), `apps/native-kit` (shared Swift packages: FoleviDesign, FoleviPhone, FoleviScreens, FoleviMac, FoleviEngine), `apps/android` (paused), `packages/`.

## 3. Setting up on a new Mac
Node with pnpm (`pnpm install` at the root), Xcode 27 with the iOS 26+ SDKs, graphify on the PATH. `apps/web/.env.local` holds the web app's settings (names in `docs/DEPLOYMENT.md`; the owner moves the values). Apple team `7K32QQ2FX8` with automatic signing; Folevi keeps its `com.folevi.*` bundle IDs. Signed in: gh (`faisalibnislam`), Vercel, Cloudflare wrangler (for Mac updates), Xcode with the Apple account. Full list in `docs/HANDOFF.md` section 6 and `docs/claude-context/APPLE_DEVELOPMENT.md`.

## 4. Architecture
Convex is the cloud backend; every app also works on its own local library. The web app is the reference UI. The Mac app is AppKit with native SwiftUI screens (FoleviMac) and a WKWebView for the note page. The iPhone app is native SwiftUI (FoleviPhone, iOS 26 system chrome), and the iPad uses the Mac's wide layout (FoleviMac views on iOS). The shared engine is FoleviEngine. Details: `docs/IOS_REBUILD_PLAN.md`, `docs/MAC_NATIVE_LOOK.md`, and graphify (`graphify query "<question>"`).

## 5. Build, run, test
- Web: `pnpm --filter @folevi/web dev` (configs in `.claude/launch.json`); tests `npx vitest run` in `apps/web`; `npx tsc --noEmit -p .` and `npx eslint <files>` there.
- Mac: `pnpm --filter @folevi/web build:shell`, then `node apps/mac/scripts/build.mjs`; drive it with `node apps/mac/scripts/mac.mjs launch|open|cmd|quit --user-data apps/mac/build/run/check`. Package tests: `swift test --filter FoleviMacTests` in `apps/native-kit`.
- iPhone: `node apps/ios/scripts/simulator.mjs build "Folevi Native iPhone"`, `xcrun simctl install`, launch with `SIMCTL_CHILD_FOLEVI_REBUILD=1`. Package tests: `xcodebuild test -scheme FoleviKit-Package -destination 'platform=iOS Simulator,id=<sim>'` in `apps/native-kit`.
- Run heavy builds one at a time: a memory guard kills any compiler over 8 GB.

## 6. Release / deploy
Pushing `main` deploys production (Vercel builds the web app and runs the Convex deploy). Every release needs the owner's OK in chat. Steps: `node scripts/version.mjs release patch --notes-file <notes>` and `check`, commit the version files, `node apps/ios/scripts/release.mjs` (TestFlight), `node scripts/version.mjs tag`, `git push origin HEAD:main` and the tag, then `node apps/mac/scripts/publish.mjs` (notarize, DMG, appcast; needs `apps/mac/release-archive/` for deltas). Never submit for App Review. Full detail: `docs/HANDOFF.md` section 6, `docs/MAC_RELEASE.md`, `docs/DEPLOYMENT.md`.

## 7. Secrets and accounts (locations only, never values)
- App Store Connect API key HS88CK5RQF: `~/.appstoreconnect/private_keys/` (never read or print it).
- Notarization: a keychain profile in the login keychain (the one `publish.mjs` names).
- Sparkle EdDSA private key: login Keychain, account "folevi" (the owner has a backup).
- Web and Convex settings: `apps/web/.env.local` and the Vercel and Convex dashboards.
- Cloudflare R2 bucket `folevi-updates`: wrangler's login.
The owner moves secrets between Macs; never copy their values into files or chat.

## 8. Rules and conventions
`CLAUDE.md` and `docs/claude-context/memory/`. The ones most often broken:
- Never push `main`, deploy, notarize or upload to TestFlight without the owner's OK.
- Never use `--prod` with the Convex CLI.
- Never touch the owner's real library or app data.
- No em dashes.
- Commit with `git commit <paths>`.
- Other sessions share this repo and can move `main`: check HEAD and the remote before releasing.

## 9. Current state (as of 2026-11-19)
- `main` = Release 1.5.53, tag `v1.5.53`: the Foli AI tab on iPhone (branch `ios-ai-tab`), iPhone Duo support and the shorter first-launch copy (branch `claude/iphone-duo-18adb4`), and the marketing pages brought up to date (branch `claude/marketing-pages-091dac`), merged on `release-1.5.53`.
- iPhone Duo: on the inner screen the tabs are a sidebar and the open note shows beside its list (half open, split on the fold); folding keeps the note open with Back to its list, and the caret, text and keyboard carry over; on iPhone Duo the note's buttons are iOS's side-bar items. Checked on the iPhone Duo simulator in every posture except Split View halves and tabletop. Owner's picks: `docs/claude-context/memory/iphone-duo-decisions.md`.
- Branch `ios-sync-status` (not merged, not released): the sync status on iPhone Home, a cloud before the bell in the top right pill (signed in only), with its details in a sheet (`apps/ios/ios/App/Native/Rebuild/RebuildSync.swift`). The bell stays after it in the same pill and opens Notifications. Checked in the simulator with `FOLEVI_REBUILD_SYNC=1` (the signed-in pill on a local library); not yet seen signed in.
- Branch `ipad-polish` (on top of `ios-sync-status`; not merged, not released): New note moved from the sidebar to a black "+ New note" pill in the title bar after the tabs, before the sync status and the bell, on Mac and iPad (white in dark mode; the owner's final pick 2026-11-19); iPad sync popover fixed (it was a see-through panel that also ate the next tap); no focus ring or tooltip after a tap on the note page's panels; card "..." as a Liquid Glass circle on iPad; speed: the iPad frame reads its width alone, sidebar actions made once, covers decoded off the main thread at card size. Checked in the iPad simulator; iOS package tests 390 passed, Mac tests only the known failure. The Mac Debug app was run on its scratch library: the pill shows; light mode on the Mac not seen (only the iPad's).
- iPad title bar corner (`ipad-polish`): with the sidebar beside the card, the account button sits at the strip's leading end (the owner's pick 2026-11-19) and the sidebar starts with its page; a resizable window's own window buttons push it right (`WindowControlsProbe`, the safe area adapted to the window's corner). Full screen checked in the simulator; a resizable window with window buttons not yet seen.
- iPad audit, still open: the tab strip leaves a cut-off empty slot at its start when scrolled; database table rows are far too tall on iPad (cause not found: needs the note page inspected); Home has a tall band above Catch me up (the bar room plus the page's padding, same on the Mac); note text cuts off hard at the card's top. The owner's "note has no rounded top corner" didn't reproduce in the simulator (asked for a screenshot). Unprofiled speed ideas: card line layout re-measured at every width, the route parsed on every read, the Debug tab-frame mirror.
- The tab bar's collapse on scroll is iOS 27's own (about 130 ms, checked frame by frame on the owner's recording, the simulator and a bare SwiftUI app; no 1.5.53 change affects it). The owner chose to keep iOS's (2026-11-19).
- The note editor session works in the main checkout on `editor/rock-solid` (pull request 40).
- Known: one Mac test fails every time (`TabPreviewStateTests.enteringTheNextTabBeforeLeavingThisOneStillShowsIt`), in code no recent change touched. The Mac filter field hasn't been typed into in the real app. Nothing in 1.5.50 to 1.5.53 has been tried on a real iPhone Duo.
- Many older worktrees under `.claude/worktrees/` hold merged or abandoned work; see `docs/HANDOFF.md` section 2 before removing any.

## 10. Next steps / open work
- Merge and release `ios-sync-status` and `ipad-polish` when the owner says so; the open iPad audit items above.
- iPhone Duo follow-ups: Folevi's own menus (PhoneMenuLayer) don't avoid the fold yet; check Split View halves on a real device.
- The failing Mac tab preview test.
- The owner's open items: `docs/HANDOFF.md` section 7.

## 11. Gotchas
- zsh doesn't word-split a variable of file names: use `git diff --name-only -z | xargs -0 git commit ...`.
- Snapshot tests re-record with `FOLEVI_RECORD_SNAPSHOTS=1` (Mac) or `TEST_RUNNER_FOLEVI_RECORD_SNAPSHOTS=1` (iOS); recording rewrites every image, so restore the ones that didn't really change.
- CI's first step runs `node scripts/icons-codegen.mjs --check`: regenerate `Icons.swift` after adding a web icon.

## 12. Change log
- 2026-11-19: iPad: the account moves into the title bar's corner.
- 2026-11-19: New note is a black pill in the title bar on Mac and iPad, gone from the sidebar.
- 2026-11-19: iPad fixes and + in the tab bar on Mac and iPad (branch `ipad-polish`).
- 2026-11-19: Checked the bell beside the new sync status on iPhone Home.
- 2026-11-19: The owner keeps iOS's tab bar collapse.
- 2026-11-19: Sync status on iPhone Home (branch `ios-sync-status`); the tab bar collapse traced to iOS itself.
- 2026-11-19: Released 1.5.53 (Foli AI tab, iPhone Duo, shorter first-launch copy, marketing pages).
- 2026-11-19: Shorter first-launch copy (where notes live, where the library lives, the passphrase card) on web, Mac, iPhone and iPad, on branch `claude/iphone-duo-18adb4`.
- 2026-11-19: iPhone Duo support on branch `claude/iphone-duo-18adb4` (PhoneColumns, PhoneSideBars, NotePageSlot).
- 2026-11-19: HANDOFF.md written. 1.5.50, 1.5.51 and 1.5.52 released (iPhone and iPad native look, Home and filter fields, Filter notes on Mac and web); Foli AI tab on branch `ios-ai-tab`.
