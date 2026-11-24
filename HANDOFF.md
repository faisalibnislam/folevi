# Folevi: handoff

> Read this first if you are a Claude (or any agent) picking this project up, on this Mac or another one. Then read `CLAUDE.md`, `docs/HANDOFF.md` (the long handoff: unfinished branches, release detail, what the owner is waiting on) and `docs/claude-context/memory/MEMORY.md` (the owner's standing rules). Keep this file current: after every change to the project, update "Current state", "Next steps" and "Change log", and commit it.

Last updated: 2026-11-23 · Written on: Faisal's MacBook Pro M5

## 1. What this is

Folevi is a calm writing and notes workspace ("a quieter place for ideas that keep growing"): block documents,
nested pages, tasks, calendar, collections, databases/tables, canvases (flowchart, mind map, whiteboard,
wireframe), comments, sharing, offline editing and sync, optional end-to-end encryption (the "Vault"), a
built-in assistant called **Foli AI**, and a free local mode ("Keep notes on my devices"). Each person has a
Personal space; teams share workspaces with their own plans, seats and billing.

Audience: individuals and small teams who want a quiet Notion/Craft-style notes app.

Platforms and status (as of 2026-11-20): **shipped and actively developed**, version **1.5.58** (tag `v1.5.58`)
on `origin/main`.

| Surface | Where it runs | Status |
| --- | --- | --- |
| Marketing site | `https://folevi.com` (`apps/web/src/app/(marketing)`) | Live (Vercel) |
| Web app (PWA) | `https://app.folevi.com` (`apps/web/src/app/(app)`) | Live (Vercel) |
| Admin console | `https://app.folevi.com/admin` | Live, needs TOTP 2FA |
| Backend | Convex, production deployment `fastidious-clownfish-123` | Live |
| Folevi for Mac | `apps/mac` (AppKit + native screens + one WKWebView for the editor), Developer ID, notarized, Sparkle updates from `folevi.com/download/mac/appcast.xml` | Shipped by direct download only (no Mac App Store build) |
| Folevi for iPhone and iPad | `apps/ios` (native SwiftUI/UIKit screens, web note editor), iOS 18+ | TestFlight internal group "Folevi team" only; never submitted to App Review |
| Android | `apps/android` (Capacitor) | Built, **paused** since 2026-10-23 by the owner: no Android work |
| Web Clipper | `apps/clipper` (Chrome/Edge extension, own lockfile) | Built and tested in CI; store listing status: see `apps/clipper/STORE.md` |
| MCP server listing | `mcp/` (`server.json`) | Folevi exposes an MCP endpoint through its OAuth provider |

Payments use Polar (personal and team plans, see `docs/BILLING.md`); the iOS app has no buying at all.

## 2. Where it lives

- GitHub: `https://github.com/faisalibnislam/folevi` (remote `origin`; the repo is **public** since
  2026-09-28, so never commit personal data or internal secrets). Default branch: `main`.
- Current branch on this Mac: `editor/rock-solid` (local only, no upstream; fully contained in `origin/main`,
  2 commits behind it).
- Path on this Mac: `/Volumes/Corsair/Github External/Airly Studio External/folevi` (external Corsair drive),
  also reachable as `~/Documents/GitHub/Airly Studio/folevi` (that folder is a symlink to the Corsair folder).
- On a new Mac: `git clone https://github.com/faisalibnislam/folevi.git` anywhere.
- Related: none outside this repo. Everything (web, backend, Mac, iOS, Android, clipper, shared packages) is
  this monorepo. Owner's saved decisions live in-repo at `docs/claude-context/memory/` (index `MEMORY.md`) and
  Apple rules at `docs/claude-context/APPLE_DEVELOPMENT.md`. An older handoff (2026-10-24) is at
  `docs/HANDOFF.md`; it is stale in places (see Gotchas) but its rules section is still true.

## 3. Setting up on a new Mac

Toolchain (versions from the repo; this Mac has Node 24.22.2, Xcode 27.2, macOS 27.2):
- Node **24** (`.nvmrc`; `engines` says >= 22.12), pnpm **10.34.5** (`packageManager`; `corepack enable`).
- Xcode 27 (26 also works per `apps/ios/README.md`), Swift Package Manager (no CocoaPods). XcodeGen is used for
  `apps/mac` (`apps/mac/project.yml` is the source; the generated `.xcodeproj` is committed).
- `gh` CLI. Pushes use the **faisalibnislam** GitHub account (the gh CLI's active account on this Mac may be a
  work account; for owner-level gh commands use `GH_TOKEN="$(gh auth token --user faisalibnislam)" gh ...`).
  The Mac's GitHub token lacked the `workflow` scope once, so pushes touching `.github/workflows` failed.
- `npx wrangler` logged in to the owner's Cloudflare account (Mac release uploads to R2).
- Optional: `graphify` (repo has `graphify-out/`, gitignored here, rebuilt with `graphify update .`).

Install:
```bash
git clone https://github.com/faisalibnislam/folevi.git && cd folevi
corepack enable
CI=true pnpm install --frozen-lockfile
(cd apps/ios && CI=true pnpm install --ignore-workspace)      # own lockfile, outside the workspace
(cd apps/clipper && pnpm install --ignore-workspace)          # own lockfile
```

Config needed (names only; values are NOT in git):
- `apps/web/.env.local` (copy from the owner's old Mac or recreate): `CONVEX_DEPLOYMENT`, `CONVEX_URL`,
  `CONVEX_SITE_URL`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` and the web variables in
  `.env.example`. A repo-root `.env.local` also exists on this Mac with `CONVEX_DEPLOYMENT`, `CONVEX_URL`,
  `CONVEX_SITE_URL` (written by `npx convex dev`).
- Fully local alternative needing no accounts: `CONVEX_AGENT_MODE=anonymous npx convex dev` then
  `node scripts/setup-local.mjs` (README "Quick start").
- Convex dev deployment: `peaceful-mockingbird-196`; production: `fastidious-clownfish-123`. Run
  `npx convex login` with the owner's Convex account.

Signing / Apple:
- Team **7K32QQ2FX8** is already set (`DEVELOPMENT_TEAM` in `apps/mac/project.yml` and the iOS project),
  automatic signing. The new Mac needs the team's certificates in the login keychain (Apple Development,
  Apple Distribution, Developer ID Application) and Xcode signed in with the owner's Apple Account.
- Notary keychain profile used by the Mac publish script: **`folevi-notary`** (overridable with
  `FOLEVI_NOTARY_PROFILE`; the global convention's `airly-notary` should work too:
  `FOLEVI_NOTARY_PROFILE=airly-notary`).
- App Store Connect API key `HS88CK5RQF` (issuer `9479ebb4-e44a-45b4-bfef-e625408057ae`) at
  `~/.appstoreconnect/private_keys/AuthKey_HS88CK5RQF.p8` for TestFlight uploads. Never read or print it.
- Sparkle EdDSA private key: login Keychain, account "folevi" (the owner was asked to keep a backup in the
  password manager). Move it with `generate_keys --account folevi -x <file>` / `-f <file>` on the new Mac.

Accounts the machine must be signed into: GitHub (faisalibnislam), Convex, Vercel (project
`faisalibnislam/folevi`), Cloudflare via wrangler (R2 bucket `folevi-updates`), Xcode Apple Account (team
7K32QQ2FX8).

## 4. Architecture

Stack: pnpm + Turborepo monorepo; Next.js 16 (App Router) + React 19 + Tiptap/ProseMirror on the web; Convex
(queries, mutations, actions, crons, HTTP) as the only backend; Better Auth running inside Convex
(`@convex-dev/better-auth`: email + password, verified email, optional TOTP, passkeys, Sign in with Apple and
Google, an OAuth provider for MCP); Resend for email; Polar for billing; Gemini for Foli AI; Cloudflare R2 for
Mac downloads (and, on a pending branch, file storage).

Key directories:
- `apps/web/`: Next.js app: `src/app/(marketing)`, `src/app/(app)`, `src/app/admin`, `src/components/`
  (editor in `components/doc/`, Foli AI in `components/ai/`, iPhone web layout in `components/iphone/`),
  `src/lib/sync/` (sync engine, device copy), `src/lib/engine/protocol.ts` (the native bridge contract),
  `e2e/` (Playwright), `test/` (Vitest), `scripts/build-shell.mjs` (bundled "shell" export the native apps load),
  `vercel.json` (build + `ignoreCommand`).
- `convex/`: schema (`schema.ts`), auth (`auth.ts`, `betterAuth/`), sync (`sync.ts`), sharing, admin, billing,
  email webhooks, crons, `http.ts`.
- `packages/editor-schema` (canonical block schema, fractional ranks, Markdown/HTML, sync reducer),
  `packages/design-tokens` (tokens to CSS + TS), `packages/email` (templates, Resend sender, inbound parsing),
  `packages/ai-prompts`, `packages/local-store`, `packages/cloud-folders`, `packages/config`.
- `apps/native-kit/`: shared Swift package: `FoleviEngine` (bridge client; models generated by
  `pnpm engine:gen` into `Sources/FoleviEngine/Generated/`), `FoleviDesign`, `FoleviScreens`, `FoleviMac`,
  `FoleviPhone`; snapshot tests in `Tests/FoleviScreensTests/__Snapshots__`.
- `apps/mac/`: Folevi for Mac: `Folevi/` sources, `project.yml`, `scripts/` (`build.mjs`, `mac.mjs`,
  `publish.mjs`, `match.mjs`, `gates.mjs`), `signing/`.
- `apps/ios/`: iPhone/iPad host (`ios/App/Native/Host`, no Capacitor runtime since 2026-10-24, but the page
  stays at `capacitor://localhost` so installs keep their data), share extension, widgets, `scripts/`
  (`release.mjs`, `simulator.mjs`, `upgrade-test.mjs`).
- `tests/`: repo-level Vitest projects: `convex`, `contract` (API snapshot), `e2ee`, `parity`.
- `scripts/version.mjs`: the only way versions change; `scripts/check-prod-env.mjs`: production env guard.

Data flow: browsers and the native apps talk to Convex directly (live queries). Native screens on Mac/iOS do not
have their own data layer: one WKWebView per window runs the web data layer ("engine") and the note editor;
native screens subscribe to typed live views and send commands over the bridge (`protocol.ts`). Offline edits
queue on the device and sync through `convex/sync.ts` (normative contract in `docs/SYNC_PROTOCOL.md`); a full
on-device copy of every note is kept (`apps/web/src/lib/sync/deviceCopy.ts`). Local mode stores a library as
files (iCloud, a folder, or on device).

Read next: `docs/ARCHITECTURE.md`, `docs/SYNC_PROTOCOL.md`, `docs/EDITOR_SCHEMA.md`, `docs/NATIVE_APP_PLAN.md`,
`docs/IOS.md`, `docs/DESKTOP.md`, `docs/E2EE_DESIGN.md`, `docs/SECURITY.md`.

## 5. Build, run, test

Local web (dev Convex, the owner's usual setup; see `.claude/launch.json`):
```bash
npx convex dev                          # dev deployment peaceful-mockingbird-196 (or CONVEX_AGENT_MODE=anonymous for a local one)
pnpm --filter @folevi/web dev           # marketing http://localhost:3000, app http://app.localhost:3000
```
The owner's sessions usually run the web on port 3002 (`web-3002` in `.claude/launch.json`:
app at `http://app.localhost:3002`) and the bundled shell on 3003 (`web-shell-3003`), because port 3000 is often
another project.

Checks (from the repo root):
```bash
pnpm typecheck                          # run alone, not in parallel with lint
pnpm lint
pnpm test                               # turbo tests + Convex tests
pnpm test:contract                      # API snapshot (pnpm contract:update to refresh)
pnpm --filter @folevi/web test
pnpm --filter @folevi/editor-schema test
cd apps/web && E2E_BASE_URL=http://app.localhost:3002 E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 npx playwright test <spec> --workers=1
```
Generated files CI checks: `pnpm tokens`, `pnpm schema:gen`, `pnpm engine:gen`, `pnpm icons:gen`, `pnpm styles:gen`.

The e2e suite exactly as CI runs it (a local, account-free Convex backend with no AI key, so the "isn't set up"
specs pass too; its data stays in the worktree's `.convex/local/`; needs ports 3000, 3210 and 3211 free):
```bash
export TMPDIR=/private/tmp/claude-501/fvx/      # any short folder: see Gotchas
CONVEX_AGENT_MODE=anonymous npx convex dev --once --typecheck=disable </dev/null
(CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck=disable </dev/null > convex.log 2>&1 &)
node scripts/setup-local.mjs
for flag in e2ee vault; do CONVEX_AGENT_MODE=anonymous npx convex run testSupport:setFeatureFlag "{\"key\":\"$flag\",\"enabled\":true}"; done
NEXT_PUBLIC_FOLEVI_TEST_HOOKS=1 pnpm --filter @folevi/web build && (cd apps/web && npx next start --port 3000 &)
cd apps/web && CI=1 E2E_NO_SERVER=1 npx playwright test <spec> --project account --workers 1
```

Mac app (Debug "Folevi Dev", own data, `folevi-dev://` links, never installed):
```bash
node apps/web/scripts/build-shell.mjs && node apps/mac/scripts/build.mjs && node apps/mac/scripts/mac.mjs launch
```
iOS app (from `apps/ios`): `pnpm shell` (dev export into `web/`), `pnpm sync`, `pnpm build` / `pnpm start`
(Simulator via `scripts/simulator.mjs`), `pnpm upgrade-test` (installs an old shipped build with data then the
new one over it: a release gate). Swift tests: `swift test` in `apps/native-kit` (see Gotchas).

## 6. Release / deploy

**A push to `main` deploys production.** Vercel (project `faisalibnislam/folevi`, root `apps/web`) builds
`main` and its build runs `scripts/check-prod-env.mjs` then `npx convex deploy --cmd 'pnpm --filter @folevi/web build'`,
so the website AND production Convex go out together. `scripts/vercel-ignore.sh` skips preview builds entirely
and skips production builds when nothing the web or Convex depends on changed. GitHub Actions `ci.yml` runs
checks on PRs and pushes to `main`, plus a "Record deployment" job (`admin:recordDeployment`) when
`CONVEX_DEPLOY_KEY` is set as a repo secret; `backup.yml` runs a daily encrypted Convex export to R2.

Owner rules: never push `main`, deploy, notarize or upload to TestFlight without the owner's explicit OK in chat.
Batch work into few pushes (each push is a paid Vercel build).

Versioning (`docs/claude-context/memory/version-releases.md`): MAJOR.UPDATE.PATCH shared by every platform,
PATCH at least two digits, no rollover. Only when the owner asks for a release:
```bash
node scripts/version.mjs prepare
node scripts/version.mjs release patch|update --plan --summary "..." --added "..." --improved "..." --fixed "..."
node scripts/version.mjs release patch|update ...      # writes version.json, CHANGELOG.json/.md and every project
node scripts/version.mjs tag                           # tag v<version>, never moved
```
Major only on the owner's explicit word (`release major --authorize-major <v>`). Never edit `version.json` by hand
and never show a build number in the UI. Release from a clean worktree of the commit being shipped.

Then, each with the owner's OK:
1. Web + Convex: push `main`; watch the Vercel status with
   `gh api repos/faisalibnislam/folevi/commits/<sha>/statuses`.
2. Mac: `node apps/mac/scripts/publish.mjs --plan`, then `node apps/mac/scripts/publish.mjs` (universal build,
   notarize with `folevi-notary`, staple, DMG + ZIP, signed Sparkle appcast with deltas from
   `apps/mac/release-archive/`, upload to R2 `folevi-updates`, served at `folevi.com/download/mac/...`). Let the
   owner's Mac update through Sparkle; don't use `--install`. Details: `docs/MAC_RELEASE.md`.
3. iOS: `cd apps/ios && pnpm release` (`scripts/release.mjs`: production export, archive, TestFlight upload with
   key HS88CK5RQF). App Store Connect app id 6825699028. Details: `docs/IOS.md` "Release and TestFlight".

## 7. Secrets and accounts (locations only, never values)

| Secret | Where it lives | Moving to a new Mac |
| --- | --- | --- |
| Convex production env (`BETTER_AUTH_SECRET`, `FOLEVI_SERVER_SECRET`, `FOLEVI_HASH_SALT`, `FOLEVI_FILE_URL_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_*`, `VAPID_*`, `UNSPLASH_ACCESS_KEY`, `GOOGLE_CLIENT_ID/SECRET`, Sign in with Apple `APPLE_SIGNIN_*`, `SUPPORT_NOTIFY_EMAIL`) | Convex deployment env (dashboard or `npx convex env list --deployment fastidious-clownfish-123`) | Nothing to move; log in to Convex |
| Vercel env (`CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_*` URLs, `FOLEVI_SERVER_SECRET`, same value as Convex) | Vercel project settings | Nothing to move |
| GitHub Actions secrets/vars (`CONVEX_DEPLOY_KEY`, `BACKUP_CONVEX_DEPLOY_KEY`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, vars `BACKUP_AGE_RECIPIENT`, `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`, `FOLEVI_DEPLOY_ENVIRONMENT`) | GitHub repo settings | Nothing to move. The backup age private key is kept offline by the owner |
| Local dev env (`apps/web/.env.local`, root `.env.local`) | This Mac only, gitignored | Copy by hand (AirDrop/password manager) or regenerate with `npx convex dev` + `node scripts/setup-local.mjs` |
| Notary profile `folevi-notary` | macOS keychain | Re-create: `xcrun notarytool store-credentials folevi-notary --team-id 7K32QQ2FX8 ...` (or use `airly-notary`) |
| App Store Connect API key HS88CK5RQF | `~/.appstoreconnect/private_keys/AuthKey_HS88CK5RQF.p8` | Copy the folder securely; never print it |
| Sign in with Apple key BNZC6FGWJC | `.p8` in `~/.appstoreconnect/private_keys/`; already loaded into Convex env | Only needed to rotate the client secret |
| Sparkle EdDSA key | login Keychain, account "folevi" (backup with the owner) | Export/import with Sparkle's `generate_keys` |
| Developer ID / Apple Distribution certs (team 7K32QQ2FX8) | login keychain | Export as .p12 from Keychain Access or let Xcode re-create |
| Cloudflare (R2 `folevi-updates`) | wrangler OAuth login | `npx wrangler login` |
| Mac provisioning profile | `apps/mac/signing/Folevi.provisionprofile` (committed) | Comes with the clone |
| Owner's real data (do not touch) | `~/Documents/Folevi Library`, `~/Library/Application Support/Folevi`, Keychain item "Folevi Safe Storage" | Not part of the project |

The owner sets secrets themselves (`--from-file` / `"$(pbpaste)"` style); never ask for or echo values.

## 8. Rules and conventions

Read `CLAUDE.md` (root), `docs/claude-context/memory/MEMORY.md` and `docs/claude-context/APPLE_DEVELOPMENT.md`.
The ones most likely to be broken:
- Pushing `main` is a production deploy (web + Convex). Never push, deploy, notarize or upload without the
  owner's OK. Never use `npx convex ... --prod` (in this checkout it can hit the wrong backend); production is
  `--deployment fastidious-clownfish-123`.
- Commit only your own files: `git commit <paths>` (other sessions often have WIP in the same tree). Never
  force-push. Never permanently delete (move to Trash).
- Never touch the owner's real library or app data; tests use scratch folders and dev test accounts.
- No em dashes anywhere (code comments, copy, commits). The assistant is always "Foli AI". Website copy follows
  the humanizer voice (plain, US English, sentence case).
- UI: custom controls (no OS-default selects on web), neutral chrome where notes carry colour, radius and type from
  design tokens, a visible hover on every clickable control. Every iPhone fix also applies to iPad; every web
  change ships to the Mac app. No buying, prices or upgrade links in the iOS app.
- The version changes only in an owner-requested release via `scripts/version.mjs`.
- Snapshot tests: re-record only your own snapshots; never clear `__Snapshots__` wholesale.
- Give before/after screenshots for UI work and ask the owner with clear options when a decision is theirs.

## 9. Current state (as of 2026-11-23)

**iPhone and iPad redesigned after the Mac's window (1.5.65, TestFlight):** branch
`claude/ios-native-redesign-f4a8be` (worktree `.claude/worktrees/ios-native-redesign-f4a8be`), built on the Mac
redesign branch `claude/folevi-core-529dbe`. The owner's answers: `docs/claude-context/memory/ios-redesign-decisions-2026-11-23.md`.

- **iPhone** (FoleviDesign/Phone, FoleviPhone, apps/ios Rebuild): every screen on the frame's grey
  (`PhoneLook.frame`), its sections and lists on rounded opaque cards (`.phoneCard()`, `PhoneLook`), no row lines
  (rounded press highlights). Each top bar ends in the Mac's order: the screen's actions in one glass capsule, the
  main action (+) in Folevi's ink (`PhoneRootCreateItem`), then a search capsule (a screen's filter where it has
  one, else the app's Search, `phoneOpenSearch`). Interface text in four sizes (`NativeChrome.fourSize`: 15, 17,
  20, 28), sentence-case headings. Home in the Mac's order (places, Catch me up, Recent, Bookmarks, Folders, Tags
  as chips, the rest). Tasks, Calendar and Search group rows on cards. The note keeps its drawn bars; its place
  chip is 44 pt. Tab bar unchanged: Home, Tasks, Calendar, Foli AI, search.
- **iPad, second round (2026-11-24, replaces the bullet below):** `IPadFrame` is a system split view;
  `IPadToolbar.swift` fills the system toolbar; tabs sit in a Safari-style row under it; `IPadInspector.swift` is
  the system inspector holding the iPhone's native Style, Format and Insert panels and the Ask Foli AI chat. Under
  700 pt the phone layout takes over. Owner's call: the inspector's Foli AI tab is the Ask chat, not the web
  panel's Write/Ask/Study actions.
- **iPad, first round** (FoleviMac, merged from `claude/ipad-redesign`): a top bar per screen inside the card
  (`IPadScreenBar`: Back/Forward, title, actions capsule, New note ink pill, search; 44 pt controls), screens start
  below it; the note's tools panel is the Mac's flat inspector (`data-ipad-native` in `globals.css`); 228 pt
  sidebar, 44 pt rows; card corners 12 pt; tabs stay on the strip.
- **Checked:** Simulators "Folevi Redesign iPhone", "Folevi Redesign iPad", "Folevi Redesign iPad 11" (scratch
  local libraries), light and dark; native-kit iOS tests (all pass after the iOS snapshots were recorded again: the
  references were stale on Xcode 27.2), the iOS app's tests, the macOS package build.
- **Not checked:** a real iPhone or iPad, signed-in screens (Shared with Me, Changes, notifications with data),
  Dynamic Type at the largest sizes in the app itself (the snapshot tests cover xxxl for some screens).
- **Released:** 1.5.65 (build 80) cut on this branch (tag `v1.5.65`, local, not pushed) and uploaded to TestFlight
  with the owner's OK (delivery 953a8af0, internal group once Apple has processed it).
  Web and Mac are not released; `main` is not pushed.

**Folevi for Mac is now the native app (in progress, not released):** branch `claude/folevi-core-529dbe`
(worktree `.claude/worktrees/folevi-core-529dbe`), `apps/mac`; pushed to GitHub 2026-11-23 with the owner's OK (not merged). The iPhone/iPad
redesign (`claude/ios-native-redesign-f4a8be`) opens its pull request into this branch, not `main`.

- **What happened (2026-11-23):** "Folevi Core", the native macOS 26 app, replaced the AppKit Folevi for Mac (the
  owner's choice). The AppKit app was removed from `apps/mac`; its last release, 1.5.64, is at the git tag
  `archive/mac-appkit`. Core moved from `apps/mac-core` into `apps/mac`. Its Xcode project and module are still
  named `FoleviCore`; the product is "Folevi".
- **Seamless update:** it carries the AppKit app's identity unchanged:
  - `com.folevi.mac`, `Application Support/Folevi`, Keychain `com.folevi.*`, `folevi://`
  - the Sparkle feed `download/mac/appcast.xml` with the EdDSA key at account "folevi"
  - Developer ID signing with the committed profile `apps/mac/signing/Folevi.provisionprofile`
- **What it takes over on first launch:**
  - the app lock (`lock.json`)
  - Spotlight (the old entries are cleared, then indexed again)
  - the Electron migration, which runs at launch as before
- **Trial Release build:** it met the Keychain items' designated requirement ("same designated requirement as the
  installed Folevi").
- **Shared host files:** the UI-free files moved into `apps/mac/FoleviCore/Host/Shared`.
- **Editor and data layer:** SwiftUI around the web editor, which runs in pooled warm web views. The data layer is
  the web export through FoleviEngine and the iOS shell services, compiled by path.
- **Read first:** `apps/mac/README.md`, then `apps/mac/PARITY.md`.
- **Parity on 2026-11-23:** 1,114 of 1,343 there, 4 partly, 0 missing, 225 n/a. The 4 partly stay web pages on
  purpose, by the owner's choice: two-step verification, end-to-end encryption on/off, OAuth consent and the
  workspace settings group. LIST-053 (Folders page drag gap) and NOTE-036 (Foli DNA of a note, which needed the
  engine's `web.show` query, contract revision 34) were closed and tried by hand.
- **Checked:**
  - the Debug "Folevi Dev" runs on the demo engine and on a scratch "on this Mac" library
  - its 38 tests pass
  - the web tests pass
- **Not checked yet:**
  - the update in place over a real installed Folevi, with real data
  - signing in to a real account
  - iCloud and folder libraries
  - drag-out to Finder
  - notification actions


**Live: Folevi 1.5.63** (tag `v1.5.63`, PR 46 merged with PR 47 in it, `main` = `3258f12b`): Mac published (feed and
DMG at folevi.com/download/mac show 1.5.63), iPhone and iPad uploaded to TestFlight. Vercel skipped the web build
(Ignored Build Step: only native code changed), so the web is still 1.5.62's build. 1.5.63 carries PR 45's Liquid
Glass motion pass, card strips that no longer clip their shadows, iPhone search at the foot above the keyboard, and
Quick add's Task/Note in Foli AI's switch style. 1.5.62 (PR 44) shipped on all three before it. 1.5.60 and 1.5.61 are tags only (each was superseded before shipping; tags never move). 1.5.59
(PR 43) shipped earlier the same day on all three.

This session's wrangler login lives in the app's own `XDG_CONFIG_HOME` (not `~/.wrangler`); `npx wrangler whoami`
there shows the account that owns `folevi-updates`. Decisions: `docs/claude-context/memory/tab-back-and-overview-2026-11-21.md`
and `frosted-folders-decision-2026-11-20.md`.

**Also in progress:** branch `claude/native-perf-pass` (worktree `.claude/worktrees/recursing-dijkstra-48aa7c`, off
`main` at `d617d60b`, not released): a native performance pass, report in `docs/NATIVE_PERFORMANCE_2026-11-21.md`.
Folder cards at rest are drawn once into a picture (`FoleviDesign/Web/CardPicture.swift`; live while hovered, on whole
pixels, a capped cache let go on memory warnings, `FOLEVI_CARD_PICTURES=0` draws them live): a 60-folder Mac grid
missed 321 to 347 of about 360 frames in a 3 s scroll, now 13 to 37; Home 52 to 166, now 0 to 11. Window captures
match the live cards. Note cards are unchanged (pictures thrashed the cache on All notes); iPhone numbers need the
owner's phone (the Simulator shows no difference).

**Also in progress:** branch `claude/note-card-shadow-pictures` (off `claude/native-perf-pass`, so it carries PR 48;
rebase onto `main` once PR 48 merges; not released): a note card's shadow (and a stack's sheets, a divider's tabs) is
one shared picture per card size and look, and the card's face is drawn live and no longer flattened (the
`drawingGroup` RenderBox redrew on every frame of a scroll was the real cost, more than the blurs). Mac All notes, 3 s
scroll: 175 to 232 missed frames down to 67 to 135 in quiet alternating pairs (median of every run 296 to 197; the
slowest 5% of frames 151 to 60 ms). Shadows match pixel for pixel in window captures; cards at fractional places
round their words half a point differently (0.5 to 0.6% of pixels). Hover lifts the shadow as before. Report in
`docs/NATIVE_PERFORMANCE_2026-11-21.md`.

**Also in progress:** branch `claude/phone-all-folders-route` (not released): on the iPhone, Home's Folders "…" >
All folders opened All notes. That Home and menu belong to the older UIKit phone frame (`PhoneFrameController`,
`Native/Phone/`), which Debug builds run unless `FOLEVI_REBUILD=1` or the `folevi.rebuild` default is set; Release
builds run the rebuild (`RebuildFrame`), where All folders is a row in More and already opened the grid. The old
frame now pushes `AllFoldersScreenController` (the shared `AllFoldersScreen` with its "…": New folder, View as, Sort
by). The Mac's `FrameNavigation` also sent `.allFolders` to Home; it now opens `/folders` (nothing on the Mac calls
it today). Checked in the Simulator (iPhone 17 Pro, Debug, a fresh local library).

**Also in progress:** branch `claude/liquid-glass-animations-b1d70e` (worktree
`.claude/worktrees/liquid-glass-animations-b1d70e`, off `main` at `d752bb0d`, PR 45, not released): a Liquid Glass
motion pass on the Mac, iPhone and iPad apps, keeping the owner's playful springs (FoleviSpring, 2026-11-01). Shared
motion in `apps/native-kit/Sources/FoleviDesign/Web/WebMotion.swift`: named springs for every repeated interaction
(`pressIn`/`press(_:)`, `glassRelease`, `reorder`, `appear`, `menu`, `bar`, `settle(velocity:distance:)`), `projected`
(a flick's coast) and `glassArrival` (floating glass materializes instead of fading flat). Changes: the Mac card's
search is one glass capsule that grows into the field (it swapped two capsules, a cut); toasts, the selection bars,
the Foli AI chat and the iPhone note bars materialize their glass; the Foli AI chat no longer drags its button in
from the corner while it opens (the overlay's host resizes at once; the button's move is now unanimated); presses go
down without wobble and spring back; the iPhone's glass circles no longer double the system glass's own swell; seven
iOS button styles use the one `pressDip`; swipe rows open on a quick flick and carry its speed; the iPhone toast and
the graph's camera move respect Reduce Motion. A Debug-only `frame` eval action `toast` drives toasts from scripts.
Checked: native-kit `swift test` (all pass), Mac and iOS builds, the Mac dev app driven on a scratch library (search
opening and closing, rapid toggles, toasts in and out, the chat open and close and rapid toggles), the iPhone
simulator (Home, All notes, Select, a note's bars). Not checked: Reduce Motion on (a system setting), real devices,
the iPad live.

What shipped in the last week, newest first (detail in `CHANGELOG.md`):
- 1.5.62: Back goes to the tab a page came from (closing it, Safari's rule); Show All Tabs draws Home on web, Mac
  and iPad; iPhone Home cards 176 pt and folder cards never cut their date off (PR 44).
- 1.5.59: Folder cards' corners line up, the front fully frosted, tighter Home rows (PR 43).
- 1.5.58: Frosted folder cards, desktop and Mac cards 25% smaller, a new folder glyph (PR 42, branch
  `design/frosted-folders`, from the card design session). Design pages the owner reviewed (private artifacts):
  https://claude.ai/artifact/SaZdm3uekCoRpGPkwcDCBn (27 note and folder ideas) and
  https://claude.ai/artifact/LxPzWN9JNK4FKuiqWDQgUD (folder states, Frosted / Paper). Decision:
  `docs/claude-context/memory/frosted-folders-decision-2026-11-20.md`.
- 1.5.57: Offline & sync fixed on iPhone, iPad and Mac (Notes kept and Space used stayed "…": the engine sent
  `attachmentLimitBytes` as a fraction and the apps, decoding an integer, dropped the whole `device.storage` update;
  `apps/web/src/lib/engine/viewsDevice.ts` `whole`, test in `apps/web/test/device-usage.test.ts`); Download everything
  now confirms and shows progress; Settings renamed ("This device" -> "App lock", next to Security; "Devices" ->
  "Signed-in devices"); Catch me up page redesigned (`CatchUpScreen` in `FoleviMac/Views/Screens.swift`, used on
  iPhone, iPad and Mac); iPhone sync details sheet (`apps/ios/ios/App/Native/Rebuild/RebuildSync.swift`); Foli AI
  composer as a raised card (`PhoneComposerSurface`); Quick add's full-width Task/Note switch; Send buttons hidden
  until there's text; 8 pt between a sheet bar's round buttons; quieter Home count badges.
- 1.5.56: iPhone notes keep Folevi's own bars, drawn by the frame where the tab bar is (`PhoneNoteBarsSlot.swift`), so
  the tab bar and the note's bars swap in place instead of the bars riding the page. (1.5.55 tried iOS's own bars; the
  owner rejected that look the same day: never switch notes to system bars.)
- 1.5.54: iPad fixes and speed, New note as a black pill in the Mac and iPad title bars (gone from the sidebar), the
  iPad account in the title bar's top left, iPhone sync status on Home, PR 41's e2e and app fixes.

**Branches** (GitHub): `main`; Dependabot's; `chrome-extension` and `pricing-decisions` (both pushed, both a little
behind `main`, both merge cleanly as of 2026-11-20). Every older branch was archived on 2026-11-19 as an
`archive/<name>` tag (27 tags; `git checkout -b <name> archive/<name>` restores one). Local worktrees under
`.claude/worktrees/` (gitignored) are mostly merged leftovers; `mac-native` is one of them (a Stop hook asks for its
own HANDOFF.md every turn: it needs none).

**Paused by the owner** (don't resume without being asked):
- Chrome extension, `apps/clipper` on `chrome-extension`: 1.1.0 (quick note, a note on a clip, keyboard shortcuts) and
  an unfinished, untested search that asks to read notes only when first used. Plan and checklist:
  `apps/clipper/PLAN.md`; store listing: `apps/clipper/STORE.md`.
- iPhone Duo beyond what shipped: `docs/claude-context/memory/iphone-duo-decisions.md`.

**Waiting on the owner:** `pricing-decisions` (new plans, fair-use downloads, files on R2: `docs/PRICING_PROPOSAL.md`
there; tests pass; the owner's decisions are still open). Backup secrets (`backup-setup-half-done.md`). Items in
`docs/HANDOFF.md` section 7.

**The owner's design rules** are in `docs/claude-context/memory/` (index `MEMORY.md`); read these before any UI work:
`ios-native-look-decisions.md`, `mac-native-look-decisions.md`, `mac-polish-rules-2026-11-18.md`,
`note-page-and-tabs-rules-2026-11-18.md`, `iphone-duo-decisions.md`, `frosted-folders-decision-2026-11-20.md`,
`folevi-web-copy-voice.md`. Short version: native iOS 26 / macOS 26 look with Liquid Glass on controls (never on
content); the tab bar's scroll collapse stays iOS's own; a disabled Send or Add button is hidden until there's text,
not faded; one New note on Mac and iPad (the black pill after the tabs); settings named for what they hold.

**Tests** (2026-11-20, on 1.5.57's code): web 2,121 passed; Mac 234 passed (the old
`TabPreviewStateTests.enteringTheNextTabBeforeLeavingThisOneStillShowsIt` failure is intermittent: it passed twice
today); iOS package 390 passed. Every UI change this week was checked in the iPhone or iPad simulator, not on a device.

**Not verified on a real device:** the 1.5.56 note bar swap, 1.5.57's Download everything now progress with a
signed-in account, 1.5.58's frosted folders with a large library, and the iPad changes in a resizable window (the
account button should move past iPadOS's window buttons).

## 10. Next steps / open work
- iPhone and iPad redesign (`claude/ios-native-redesign-f4a8be`): the owner tries 1.5.65 from TestFlight; PR 52
  (https://github.com/faisalibnislam/folevi/pull/52) into `claude/folevi-core-529dbe` (the owner's choice) is
  open for review. The `v1.5.65` tag is local only (pushing it was not asked for).
  Owner's calls from the 2026-11-23 HIG audit: Foli AI is a tab that opens a sheet (the HIG says tabs navigate,
  never act); section headings stay sentence case (Apple uses title case); dark mode keeps a pure black frame.
  Known gaps: the notifications sheet's rows are not on cards yet; screens borrowed from the iPad (Foli DNA,
  Reviews) keep their own white page under the system bar.
- Folevi for Mac (native, `apps/mac`, branch `claude/folevi-core-529dbe`), the owner's order of 2026-11-23:
  1. Done 2026-11-23: the owner's Mac UI guide (`docs/design/macloving-mac-ui.md`) as the **full window
     redesign**:
     - hidden title bar
     - an always-visible sidebar (still a List)
     - an opaque rounded content card whose glass top bar is drawn from each screen's `.screenActions` /
       `.screenSearch` / `.screenSubtitle` (`FoleviCore/Views/Common/ScreenBar.swift`)
     - a flat rounded inspector panel and capsule choices
     - Folevi's ink kept
     - native window tabs kept (the content starts below macOS's tab bar when shown)

     The iPad already had this profile; its card margin is now 12 pt. Not yet looked at on the iPad itself; its
     layout tests pass.
  2. Done 2026-11-23: a signed, notarized, stapled, universal test DMG at
     `apps/mac/release-dist/test-1.5.64/Folevi-1.5.64.dmg` (git-ignored, in the Core worktree). It has the
     production web build and the same designated requirement as the installed Folevi. The owner tries it over
     the installed Folevi with real data. It says 1.5.64 like the live feed, so Sparkle offers no update; the
     next real release must be 1.5.65 or later.
  3. Publish to the `mac/` feed only with the owner's OK. That update reaches every Mac user.
  4. Merge into `main` (pushing `main` deploys the website).
  5. The Mac App Store build: not now.
- Folevi for Mac Debug with a fresh data folder (no places yet): the bundled dev web page fails at once with "The
  operation is insecure" from its Convex WebSocket (seen 2026-11-22), so the first-run gates can't be walked in
  Debug that way; a scratch "on this Mac" library never opens Convex and works. Check the dev bundle's Convex URL
  against the app:// page's content security rules before a real-account test. `core.mjs cmd fakegate` shows a
  gate screen from JSON instead.
- `claude/phone-all-folders-route`: review and merge with the next release (Debug-only bug; no user-visible change in
  Release builds).
- Liquid Glass motion branch (`claude/liquid-glass-animations-b1d70e`): the owner's look on a real Mac and iPhone, then
  merge with the next release. Known left: the Mac's Foli AI chat closes at once, with no exit animation (its host
  view shrinks before SwiftUI can animate the chat out; older than this branch).
0. On real devices: Back after Home's See all (Mac, iPad, web), Show All Tabs' Home picture, iPhone Home's folder
   and note strips (1.5.62).
1. On a real iPhone, iPad and Mac with the owner's library: the note bar swap (1.5.56), Offline & sync's Download
   everything now with an account (1.5.57), frosted folders' scrolling in long grids (1.5.58; on
   `claude/native-perf-pass` folder cards scroll from pictures, and on `claude/note-card-shadow-pictures` note cards'
   shadows: compare with `FOLEVI_CARD_PICTURES=0` on the phone).
2. iPad audit leftovers (found 2026-11-19, not fixed): the tab strip leaves a cut-off empty slot at its start once
   the tabs overflow; database table rows are far too tall on iPad (cause not found: inspect the note page); note
   text cuts off hard at the card's top on scroll. Unprofiled speed ideas: card line layout re-measured at every
   width, the route parsed on every read, the Debug tab-frame mirror.
3. The Foli AI chat's "Working on it…" row with Stop (the owner circled it on 2026-11-20 with the composer): not
   restyled yet.
4. Any one failed query takes a whole web page to "Something went wrong" (`useQuery` throws to
   `app/global-error.tsx`); treat a failed non-essential query as still loading and retry.
5. Paused work (Chrome extension, iPhone Duo) and `pricing-decisions`: only when the owner asks.
6. Mac App Store build (sandboxed, no Sparkle) doesn't exist; only Developer ID. Folevi keeps its `com.folevi.*`
   bundle IDs (the owner's choice, `folevi-keeps-com-bundle-ids.md`): don't rename.
7. Owner items carried from October (status unverified): SPF record for Sign in with Apple's email relay, export
   compliance and App Review, Dropbox app and Google iOS client, Sparkle key backup. Developer ID certificates expire
   2027-02-01: remind the owner in January 2027.
8. Clean up the leftover worktrees under `.claude/worktrees/` (owner's call) and the stale `phone-home*.failed.png`
   files in `apps/native-kit/Tests/FoleviScreensTests/__Snapshots__` (the tests pass; those are old diffs).

## 11. Gotchas

- `docs/HANDOFF.md` sections 1 to 8 are from 24 October (1.0.04, the `native-app-snapshot` branch, Capacitor-era
  work; the native rebuild has since shipped on `main`): use them for history, the owner's open items and release
  detail. Its section 0 is current for the editor audit and pull request 40. State lives in this file.
- The repo sits on an external drive (`/Volumes/Corsair/...`). A test host launched by xcodebuild could not open
  files under `~/Documents` until macOS privacy allowed it ("test runner hung before establishing connection");
  run tests with derived data outside `~/Documents` (`docs/MAC_RELEASE.md` section 6).
- `--prod` with the Convex CLI does not mean production here; always `--deployment fastidious-clownfish-123`.
- Port 3000 is often taken by another project; use 3002/3003 for e2e.
- Notes open with the Foli AI panel since 2026-11-18 (`a989411b`); e2e locators that assumed a closed panel or a
  single "New note" button break. Use `openFoliAi()` and `closeToolsPanel()` from `apps/web/e2e/helpers.ts`.
- `pnpm typecheck` in parallel with lint has given false failures; run it alone. About 9 known lint errors existed
  in untouched files (2026-10-24 note; may have changed).
- Known Swift test issues: Mac `RouterTests.testDebugIdentity` expects a version from a stale build; a full
  `swift test` may fail in `DragTypeTests`; the Vision OCR test times out on some Macs.
- `apps/ios`, `apps/mac`, `apps/clipper`, `apps/android` are outside the pnpm workspace (own lockfiles). Vercel
  only builds `apps/web`.
- `FOLEVI_WEB_FRAME=1` restores the old web frame in both apps; `FOLEVI_FRAME_DEMO=1` (Mac Debug) runs on a demo
  engine.
- The iOS page must stay on `capacitor://localhost` or existing installs lose their data; `pnpm upgrade-test` guards it.
- Sending email through Resend was blocked in October by pending SPF records (memory note); check before relying on it.
- Notary profile name differs from the global convention (`folevi-notary`, not `airly-notary`).
- `pnpm audit` ignores four better-auth GHSAs on purpose (`pnpm-workspace.yaml`); upgrade better-auth and
  `@convex-dev/better-auth` together when supported, then drop the ignores.
- zsh doesn't word-split a variable of file names: use `git diff --name-only -z | xargs -0 git commit ...`.
- Debug iPad: `FOLEVI_IPAD_TOOL=style|format|insert|ai` opens that tool in the inspector at launch.
- Driving a simulator headlessly: `FOLEVI_REBUILD_OPEN=/notes` (via `SIMCTL_CHILD_`), the `folevi.rebuild` default
  for the rebuilt frame in Debug, and `scripts/gates.mjs`'s `simulator()` helper (press, engine commands) to make a
  scratch local library.
- Snapshot tests re-record with `FOLEVI_RECORD_SNAPSHOTS=1` (Mac) or `TEST_RUNNER_FOLEVI_RECORD_SNAPSHOTS=1` (iOS); recording rewrites every image, so restore the ones that didn't really change.
- CI's local Convex backend stops a query after 1 second, and a timed-out query takes the page to its error screen
  ("Something went wrong"). On a cold backend the first chat message of a shard can trip it: that is
  `e2e/ai-attachments.spec.ts` in shard 8, flaky on `main` and failing twice in a row once. A failure whose
  screenshot is that error screen is this, not the feature; `convex.log` in the shard's artifact shows the timeouts.
- Rate limits (`convex/lib/rateLimit.ts`) count within fixed clock windows. A test that calls up to a limit must
  hold the clock (`vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime`), or it fails when it runs across
  a window's edge. Other per-minute limit tests have not been checked for this.
- CI's first step runs `node scripts/icons-codegen.mjs --check`: regenerate `Icons.swift` after adding a web icon.
- A local Convex backend (`CONVEX_AGENT_MODE=anonymous`) started from a Claude session hangs on its first push with
  no output: its Node executor's socket lives under `$TMPDIR`, and the app's long TMPDIR makes the path too long
  (`listen EINVAL ... .executor.sock`, a 500 on `start_push`, retried forever). Export a short `TMPDIR` first.
- CI's e2e runners have 2 CPUs. Just after a sign-in a page opens 20 or more queries at once, and on CI each one's
  wall-clock time nears the local backend's 1 second limit; one past it fails the page (next step 2). It is not
  only the first chat message (above): native-lift and others hit it too. `ci.yml` now sets
  `DATABASE_UDF_USER_TIMEOUT_SECONDS=4` for that backend. Bursts show in `convex.log` as "took a long time".

## 12. Change log
- 2026-11-24: iPad rebuilt natively and merged (`claude/ipad-native`): system split view, system toolbar (Back/Forward, title, items, ink New note, sync, bell, search), Safari-style tabs row, the note's Style/Format/Insert/Foli AI in the system inspector; Debug iPad launch with FOLEVI_REBUILD_OPEN fixed; all iOS package tests pass on the iPhone simulator.
- 2026-11-24: Owner chose native like the Mac for iOS: iPhone lists and Settings on iOS's own List (rows unlined, native swipe actions); the iPad's native split-view rebuild runs on `claude/ipad-native` (helper, not merged yet).
- 2026-11-23: iPhone/iPad audited with apple-hig, liquid-glass, liquid-glass-motion and axiom-design (owner's ask): + is the system's prominent glass, search button titled, 44 pt tag chips and iPad history buttons; owner's calls listed in PR 52.
- 2026-11-23: PR 52 opened (iPhone and iPad redesign into `claude/folevi-core-529dbe`).
- 2026-11-23: iPhone and iPad redesigned after the Mac's window (owner's checkbox answers saved in memory); 1.5.65 cut on `claude/ios-native-redesign-f4a8be` and uploaded to TestFlight; not merged.
- 2026-11-23: `claude/folevi-core-529dbe` pushed to GitHub with the owner's OK (a337b65b) so the iPhone/iPad redesign can open its pull request into it; `main` untouched.
- 2026-11-23: Folevi for Mac: the owner's main-window profile (hidden title bar, sidebar, content card, glass top bar from each screen, flat inspector panel, capsule choices; ink kept, native tabs kept below the tab bar); iPad card margin 12 pt; a notarized test DMG built for the owner (1.5.64, not published).
- 2026-11-23: Folevi for Mac: "Folevi Core" replaced the AppKit app as an update in place (same bundle id, data, Keychain, scheme, Sparkle feed and key, Developer ID profile); `apps/mac-core` became `apps/mac`; the AppKit app is at tag `archive/mac-appkit`; it takes over lock.json, Spotlight and the Electron migration; publish.mjs follows the AppKit flow (universal, changelog notes); LIST-053 drag gap and NOTE-036 Foli DNA of a note done (engine contract revision 34: `web.show` query); a dark-mode accent that kept selected rows unreadable fixed. Next: the full Macloving window redesign on Mac and iPad, then a test DMG.
- 2026-11-22: Folevi Core: Liquid Glass motion pass: one named motion set (`Motion` in `Views/Common/CoreLook.swift`) taken from the family's FoleviSpring/WebMotion (the owner's playful springs: panels grow from what opened them with a visible overshoot, selection slides, bars arrive firmly, Mac presses darken and never scale), each with a Reduce Motion substitute; floating glass (toasts, selection bars, the Ask button, carousel arrows, the folder menu, the palette) materializes instead of fading, in containers that never merge stacked toasts; the Ask panel and palette animate the same from every way in (persistent animation contexts); presses dim instead of scaling with Reduce Motion.
- 2026-11-22: Folevi Core: web screens made native where safe (library passphrase step, system Sign in with Apple button, Touch ID for encryption keys, test feed folder, ink primary gate buttons); two-step, workspace group, e2ee on/off and OAuth consent kept on the web on purpose; owner kept ⌘T, Open at login and native tabs (1,112 there, 6 partly); saved windows per data folder.
- 2026-11-22: Folevi Core: last native items (1,108 there, 15 partly): card grid keys and ⌘A, one intent dispatcher, views paused off screen, notes prepared on press, a billing history list, the large control size; Core's 36 tests pass.
- 2026-11-22: Folevi Core: third finishing round (1,102 of 1,343 there, 21 partly, 0 missing): launch snapshot wired (sidebar, Home, counts drawn at once; nothing kept for encrypted spaces), card previews with the page's line breaks (text.layout), spelling from the word's paragraph with 8 guesses and Learn/Ignore clearing WebKit's underline (core-page.js), Dock badge for places not open, plan badges and reminder marks in the account menu, inline diffs on Changes, a Folders tree, File > Share off a note, early keys after ⌘K, early link handler; design pass (web icons, hovers, no small controls, no row lines, cards 25% smaller, Home spacing); sidebar picks now navigate and start fresh.
- 2026-11-22: Folevi Core: second finishing round (1,041 of 1,343 there, 81 partly, 3 missing): demo mode fixed (one shared demo client), tabs per space, file import, empty-space menu, middle-click, mixed moves, Add Tag, Foli DNA of a note, folder drop zones and spring-loading, optimistic list changes. Drag behaviours and Foli DNA centring are built and unit-tested but not yet tried by hand.
- 2026-11-21: Folevi Core: finishing round toward full parity (1,027 of 1,343 there, 83 partly, 17 missing): lists, folders, tags, tasks, calendar week grid, sharing, templates, changes, notifications, Help window, Settings search and rows, menus, move between places, gate screens, links, App Lock, sidebar rule, inspector. The owner's Mac UI guide (macloving-mac-ui.md) is applied to the sidebar scale and Settings; the owner chose to keep native window tabs, so its main-window profile is not used.
- 2026-11-21: Folevi Core: tabs (trashed notes leave history, background tabs, ⌘T at Search) and Home (catch-up Markdown and sources, reviews card, carousels, all folders with menus and drops); fixed a launch crash restoring windows saved by earlier builds; PARITY.md: 688 there, 290 partly, 155 missing.
- 2026-11-21: Folevi Core: the Vault complete, Quick Add parity, Foli AI chat details and a floating Ask Foli AI panel (⌘J), search and palette, Settings in today's order with a Library pane, About and Support, sidebar details; ready follows the engine client (no more stuck starting screen); PARITY.md recounted: 672 there, 301 partly, 160 missing, 210 n/a.
- 2026-11-21: Folevi Core: draft PR 51; parity checklist (595 of 1,343 present, 343 partial, 195 missing, 210 n/a at first grading) and the first work packages closed (bugs, sharing, folder picker, tabs, task editor, calendar views); Developer ID release with iCloud verified (not notarized).
- 2026-11-21: Folevi Core started in `apps/mac-core` (branch `claude/folevi-core-529dbe`): native app, release and publish scripts, tests, parity checklist. FoleviKit's demo engine is its own target `FoleviEngineDemo` (files unmoved, re-exported by FoleviMac).
- 2026-11-21: Note cards' shadows as shared pictures, faces live and unflattened, on `claude/note-card-shadow-pictures` (Mac All notes 175-232 missed frames to 67-135); not released.
- 2026-11-21: Native performance pass on `claude/native-perf-pass`: folder cards scroll from a picture (Mac Folders 321-347 missed frames to 13-37); report in `docs/NATIVE_PERFORMANCE_2026-11-21.md`; not released.
- 2026-11-21: iPhone (old UIKit frame, Debug builds): Home's Folders "…" > All folders opens the folders grid, not All notes; the Mac's `.allFolders` route opens `/folders` instead of Home; on `claude/phone-all-folders-route`.
- 2026-11-21: 1.5.63 released on Mac and TestFlight (PR 46 + 47 + PR 45's motion pass); the web build was skipped (native-only).
- 2026-11-21: iPhone Home's folder strip no longer cuts its cards' shadow off in a straight line (`scrollClipDisabled`), on `claude/phone-strip-shadows`.
- 2026-11-21: iPhone search's field and close button at the foot above the keyboard (iOS 26), chips just above it; Quick add's Task/Note switch matches Foli AI's Chat/Research, full width; on `claude/phone-search-bottom`.
- 2026-11-21: PR 45 opened for the Liquid Glass motion pass.
- 2026-11-21: Liquid Glass motion pass on `claude/liquid-glass-animations-b1d70e` (shared springs, glass materializing, Mac search morph, swipe velocity, Reduce Motion gaps); not released.
- 2026-11-21: 1.5.62 released on web, Mac and TestFlight (PR 44).
- 2026-11-21: Mac 1.5.59 uploaded (wrangler signed in). CI's type-scale test fixed (Home picture headings use Title 2); 1.5.62 cut on PR 44.
- 2026-11-21: iPhone folder cards fixed (176 pt strips, one-line name fallback), web Show All Tabs draws Home; 1.5.61 cut on PR 44.
- 2026-11-21: 1.5.59 released (web, TestFlight; Mac waiting on the R2 upload). Back-to-opener and the drawn Home picture built on `claude/tab-back-and-overview`.
- 2026-11-21: Folder fronts fully frosted (strong tint and 7 px blur across the whole front), on all platforms.
- 2026-11-21: Folder fronts frosted only behind their words (name, counts, Edited), clear between, on all platforms.
- 2026-11-21: Folder corners match the front, frost 30% lighter, Mac Home carousel gaps and section spacing tightened, on `claude/folder-design-refinements-cd77e4`.
- 2026-11-20: Handoff rewritten for another Claude: sections 9 and 10 as a clean snapshot; the owner's design decisions copied into `docs/claude-context/memory/`.
- 2026-11-20: Frosted folder cards, 25% smaller desktop cards and the new folder glyph built on `design/frosted-folders` (not released).
- 2026-11-20: PR 42 e2e fixes (Created date contrast, the folder name back directly in the front); CI green.
- 2026-11-20: Released 1.5.58 (PR 42 merged).
- 2026-11-20: Released 1.5.57.
- 2026-11-20: Settings sections renamed and reordered (App lock, Signed-in devices).
- 2026-11-20: Offline & sync readings fixed on iPhone, iPad and Mac (whole numbers from the engine); Download gives feedback.
- 2026-11-20: iPhone Home tile counts as quiet badges (branch `catch-up-redesign`).
- 2026-11-20: iPhone sheet bars keep 8 pt between round buttons (branch `catch-up-redesign`).
- 2026-11-20: iPhone Foli AI composer on its own card (branch `catch-up-redesign`).
- 2026-11-20: iPhone sync details sheet redesigned (branch `catch-up-redesign`).
- 2026-11-20: Catch me up page redesigned (branch `catch-up-redesign`).
- 2026-11-20: Quick add polish on iPhone and iPad (branch `ios-quick-add-polish`).
- 2026-11-20: Released 1.5.56: Folevi's own iPhone note bars, trading places with the tab bar in place.
- 2026-11-20: Reverted iPhone notes to Folevi's own bars (owner's call); not yet released.
- 2026-11-20: Released 1.5.55: iPhone notes use iOS's own bars.
- 2026-11-20: `chrome-extension` and `pricing-decisions` brought up to date with `main` (tests pass on both) and pushed; every other branch is already in `main`.
- 2026-11-20: Pushed `chrome-extension` and `pricing-decisions` to GitHub as a backup.
- 2026-11-19: Archived the merged and old branches as `archive/*` tags.
- 2026-11-19: Released 1.5.54 (web, Mac, iPhone and iPad).

- 2026-11-19: pull request 41 (`claude/reverent-leakey-c9bd25`, into `main`): onboarding no longer scrolls sideways
  at phone width while a step slides in (app), closing the tools panel leaves the caret where it is (app,
  `DocumentView.tsx` `closeInspector`), tab-switch also waits for the tab it switches to to be warm, CI's local
  backend gets a 4 second query limit. Local CI-like run and two gotchas added.
- 2026-11-19: pull request 40 merged into `main` as `ce420649` on a fully green CI run (44556502512); production deploy
  completed and CI on `main` green (44562664255). These notes are on `editor/rock-solid`, not yet on `main`.
- 2026-11-19: pull request 40, CI run 44547866717: 7 of 8 browser shards green. `e2e/tab-switch.spec.ts` watched for
  a loading placeholder while the note opened just before was still loading its own lines; it waits for them now.
- 2026-11-19: pull request 40, CI run 44538632686: 6 of 8 browser shards green. Fixed the mind map phone spec (its
  full canvas is checked at 390 again); `e2e/ai-attachments.spec.ts` gets 3 retries on CI (see Gotchas).
- 2026-11-19: `tests/convex/organize.test.ts` holds the clock in its rate limit test: the limit counts per clock
  minute and a CI run that straddled the turn of a minute failed it (pull request 40, run 44537137363).
- 2026-11-19: the two root handoff files (the handoff session's on `editor/rock-solid`, the release session's on
  `main`) merged into this one while bringing 1.5.53 into pull request 40.
- 2026-11-19: Released 1.5.53 (Foli AI tab, iPhone Duo, shorter first-launch copy, marketing pages).
- 2026-11-19: Shorter first-launch copy (where notes live, where the library lives, the passphrase card) on web, Mac, iPhone and iPad, on branch `claude/iphone-duo-18adb4`.
- 2026-11-19: iPhone Duo support on branch `claude/iphone-duo-18adb4` (PhoneColumns, PhoneSideBars, NotePageSlot).
- 2026-11-19: `CLAUDE.md` says to read this file first and keep it current (the owner's OK in chat).
- 2026-11-19: committed on `editor/rock-solid` with pull request 40; next step 1 and the e2e gotcha brought up to
  date (the edits they called uncommitted are in the pull request).
- 2026-11-19: Git state updated: editor/rock-solid pushed as pull request 40; docs/HANDOFF.md section 0 noted.
- 2026-11-19: Handoff created. 1.5.50, 1.5.51 and 1.5.52 released (iPhone and iPad native look, Home and filter fields,
  Filter notes on Mac and web); Foli AI tab on branch `ios-ai-tab`.
