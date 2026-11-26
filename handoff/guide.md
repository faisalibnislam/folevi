# Folevi: the guide

What rarely changes about Folevi: what it is, where it lives, setup, architecture, build and test, release,
secrets, rules and gotchas. These are `HANDOFF.md`'s numbered sections 1 to 8 and 11, with their numbers kept, so
"HANDOFF.md section 5" in older notes means section 5 here. The current state, next steps and change log (the old
sections 9, 10 and 12) are not here: read `handoff/state/<area>.md` and `node scripts/handoff.mjs show`, and
`handoff/archive/` for everything written before 2026-11-26. How the folder works: `handoff/README.md`.

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
| Android | The Capacitor app on branch `claude/android-capacitor-197cf4` (PR 69); `apps/android` on `main` still holds the native Compose app (Gradle root `apps/android`, modules `engine`, `app`) | **Active** (owner, 2026-11-25: "we need Android"): 1.5.74 (build 89) on Play internal testing, PR 69 not merged yet. Only the native Compose app is paused (owner, 2026-11-24: one web app everywhere) |
| Android | `apps/android`: a native Compose app (Gradle root `apps/android`, modules `engine`, `app`); the Capacitor app is gone | **Resumed 2026-11-23** as a native app "just like iPhone" for phones, foldables, tablets and Googlebooks; first build complete on branch `claude/android-native-622675` (not merged, not on Play; `docs/ANDROID_NATIVE_PLAN.md`) |
| Folevi for Windows and Linux | `apps/desktop` (Tauri 2, system web view): Windows ARM64/x64 (NSIS, MSI), Linux x86_64/aarch64 (AppImage, deb, rpm, Flatpak); `docs/DESKTOP_APP.md` | **Built 2026-11-24** on branch `claude/desktop-tauri` (replaces the Electron PR 58): CI test builds only; not merged, not published |
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
| Convex production env (`BETTER_AUTH_SECRET`, `FOLEVI_SERVER_SECRET`, `FOLEVI_HASH_SALT`, `FOLEVI_FILE_URL_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `GEMINI_API_KEY` (optional since 2026-11-25: keys can be saved in Admin > Foli AI), `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (optional, same), `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_*`, `VAPID_*`, `UNSPLASH_ACCESS_KEY`, `GOOGLE_CLIENT_ID/SECRET`, Sign in with Apple `APPLE_SIGNIN_*`, `SUPPORT_NOTIFY_EMAIL`) | Convex deployment env (dashboard or `npx convex env list --deployment fastidious-clownfish-123`) | Nothing to move; log in to Convex |
| Vercel env (`CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_*` URLs, `FOLEVI_SERVER_SECRET`, same value as Convex) | Vercel project settings | Nothing to move |
| GitHub Actions secrets/vars (`CONVEX_DEPLOY_KEY`, `BACKUP_CONVEX_DEPLOY_KEY`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, vars `BACKUP_AGE_RECIPIENT`, `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`, `FOLEVI_DEPLOY_ENVIRONMENT`) | GitHub repo settings | Nothing to move. The backup age private key is kept offline by the owner |
| Local dev env (`apps/web/.env.local`, root `.env.local`) | This Mac only, gitignored | Copy by hand (AirDrop/password manager) or regenerate with `npx convex dev` + `node scripts/setup-local.mjs` |
| Notary profile `folevi-notary` | macOS keychain | Re-create: `xcrun notarytool store-credentials folevi-notary --team-id 7K32QQ2FX8 ...` (or use `airly-notary`) |
| App Store Connect API key HS88CK5RQF | `~/.appstoreconnect/private_keys/AuthKey_HS88CK5RQF.p8` | Copy the folder securely; never print it |
| Sign in with Apple key BNZC6FGWJC | `.p8` in `~/.appstoreconnect/private_keys/`; already loaded into Convex env | Only needed to rotate the client secret |
| Sparkle EdDSA key | login Keychain, account "folevi" (backup with the owner) | Export/import with Sparkle's `generate_keys` |
| Windows/Linux update key (Tauri updater, minisign) | `~/.folevi-desktop-signing/folevi-updater.key` (chmod 600, no password; public key in `apps/desktop/src-tauri/tauri.conf.json`) | Copy the folder securely; keep a copy in the password manager. Without it, Windows and AppImage users must download the next version by hand |
| Developer ID / Apple Distribution certs (team 7K32QQ2FX8) | login keychain | Export as .p12 from Keychain Access or let Xcode re-create |
| Cloudflare (R2 `folevi-updates`) | wrangler OAuth login | `npx wrangler login` |
| Mac provisioning profile | `apps/mac/signing/Folevi.provisionprofile` (committed) | Comes with the clone |
| Android upload key (alias `folevi-upload`, SHA-1 25:A4:2E:A7:...:98:75) | Keystore `~/.android-upload-keys/folevi-upload.jks`; its passwords in `~/.gradle/gradle.properties` (`folevi.upload*`, chmod 600) | Copy both securely; without them, ask Play support for an upload key reset (Play App Signing holds the app signing key) |
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
- The handoff is the `handoff/` folder: after every change add a log entry (`node scripts/handoff.mjs log "<what
  changed>" --area <area>`) and update your area's `handoff/state/<area>.md`. Never add to `HANDOFF.md` (a pointer;
  CI fails a pull request that changes it) and never edit another session's log entry (`handoff/README.md`).
- Several pull requests open at once: land them through one integration branch rather than merging `main` into each
  (`handoff/state/repo.md`).

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
- CI's local Convex backend stops a query after 1 second, and a timed-out query took the page to its error screen
  ("Something went wrong"; since `lib/convex/queries.ts` it retries instead, so this may be gone). On a cold backend the first chat message of a shard can trip it: that is
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
