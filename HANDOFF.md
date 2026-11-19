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
- `main` = `6099b01e` (Release 1.5.52), tag `v1.5.52`.
- Branch `ios-ai-tab` (worktree `ios-native`): Foli AI as an iPhone tab-bar item, + alone at the top. Committed, tested, not released; the owner is deciding whether to ship it as 1.5.53 or with the iPhone Duo work.
- Sessions at work: iPhone Duo optimization (worktree `iphone-duo-18adb4`), landing and marketing pages (worktree `marketing-pages-091dac`), and the note editor (main checkout, `editor/rock-solid`).
- Known: one Mac test fails every time (`TabPreviewStateTests.enteringTheNextTabBeforeLeavingThisOneStillShowsIt`), in code no recent change touched. The Mac filter field hasn't been typed into in the real app.
- Many older worktrees under `.claude/worktrees/` hold merged or abandoned work; see `docs/HANDOFF.md` section 2 before removing any.

## 10. Next steps / open work
- Release `ios-ai-tab` when the owner says.
- Merge the iPhone Duo and marketing branches when their sessions finish and the owner approves.
- The owner's open items: `docs/HANDOFF.md` section 7.

## 11. Gotchas
- zsh doesn't word-split a variable of file names: use `git diff --name-only -z | xargs -0 git commit ...`.
- Snapshot tests re-record with `FOLEVI_RECORD_SNAPSHOTS=1` (Mac) or `TEST_RUNNER_FOLEVI_RECORD_SNAPSHOTS=1` (iOS); recording rewrites every image, so restore the ones that didn't really change.
- CI's first step runs `node scripts/icons-codegen.mjs --check`: regenerate `Icons.swift` after adding a web icon.

## 12. Change log
- 2026-11-19: HANDOFF.md written. 1.5.50, 1.5.51 and 1.5.52 released (iPhone and iPad native look, Home and filter fields, Filter notes on Mac and web); Foli AI tab on branch `ios-ai-tab`.
