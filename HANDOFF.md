# Folevi: handoff

> Read this first if you are a Claude (or any agent) picking this project up, on this Mac or another one. Then read `CLAUDE.md`, `docs/HANDOFF.md` (the long handoff: unfinished branches, release detail, what the owner is waiting on) and `docs/claude-context/memory/MEMORY.md` (the owner's standing rules). Keep this file current: after every change to the project, update "Current state", "Next steps" and "Change log", and commit it.

Last updated: 2026-11-24 · Written on: Faisal's MacBook Pro M5

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

## 9. Current state (as of 2026-11-25)

**Read this first: everything open on 2026-11-25 is merged and released as 1.6.78 (build 102).** PR 109
(`claude/integration-2026-11-25`, merge commit `e0183862`) merged PRs 104, 96, 92, 89, 78, 97, 98, 81, 82, 69 (with
66), 83, 65, 99, 107, 100, 105, 103, 106 and 93 at once; the change log's first entry says why and what was resolved.
Where the paragraphs below say a branch or PR is "not merged" or "open", it is merged now. Tag `v1.6.78` is local
only (not pushed). What is live:

| Platform | 1.6.78 | Checked |
| --- | --- | --- |
| Web and Convex | Deployed by the merge (Vercel status success) | Production answers `server:info` and `aiConfig:overview`; `/signin` shows "Sign in to your own server"; `/downloads` is up; no console errors on either |
| Mac | Published with `apps/mac/scripts/publish.mjs`: notarized, stapled, feed and `mac/Folevi.dmg` on R2, deltas from builds 83, 86 and 88 | Feed's first item is 1.6.78 (102); the DMG is "Notarized Developer ID". Not opened on a Mac |
| iPhone and iPad | TestFlight, internal "Folevi team", delivery `7120ad6e-d96e-4265-be53-67bdd079ce3e` (the Capacitor app, `apps/mobile`) | Upload accepted. Not opened on a device |
| Windows | `windows/Folevi_1.6.78_x64-setup.exe` and `_arm64-setup.exe` plus the two stable names, from CI run 45580647007. Unsigned, as before | Links answer with the new sizes. Not installed on Windows |
| Linux | Six packages and `SHA256SUMS` (`upload-release.sh`); apt and rpm repositories rebuilt in the VM with 1.5.75 and 1.6.78 and uploaded (`upload-repos.sh`) | Both AppImages pass `smoke-test.sh` in the VM; the live `InRelease` verifies with the Folevi key |
| Snap Store | arm64: revision 5 (1.6.78) on stable, built in the VM (`sg lxd -c "packaging/linux/scripts/snap-build.sh ..."`: a plain `limactl shell` lacks the lxd group). amd64: revision 6 (1.6.78) on stable, built on Launchpad (`snapcraft remote-build` in the VM's `~/snap-remote`, about an hour) | `snapcraft status folevi` in the VM shows what is live per architecture |
| Android | NOT on Play yet. The signed bundle (upload key, push values from the owner's `google-services.json`) is at `~/Downloads/Folevi 1.6.78 Android/Folevi-1.6.78-102.aab`; the owner drags it into Play Console's internal testing | Signer checked. Not run on a device or emulator |

Not done, and why:
- **Android on Play:** needs the owner's drag-in (files this size can't be attached from here).
- **`migrations:narrowDocumentText` on production (PR 93's last step):** the owner ran it on 2026-11-25 after the
  release (first answer `{ cleared: 100, done: false }`; it schedules its own next pages until the notes run out, so
  one run is enough). Not checked afterwards: that every page finished. From here, rolling PR 93 back also needs the
  text copied back from `documentText`.
- **Folevi Server packages and stores:** not part of this release. The server code and "Your own server" in every
  app are in; publishing the NAS and Linux server packages stays with the Folevi Server session.
- **Flathub:** needs a person (Flathub's AI policy, docs/LINUX.md).
- **Real hardware:** QR scan on real phones, foldable fold marks and the Android back gesture, real-iPhone swipes,
  the Mac's server sign-in sheet in the app itself, and whether Chromium's click hold-back after a swipe also
  happens on real Android (the swipe rows now close on touch either way).
- **Android security trade-off to review (PR 103):** `network_security_config` allows cleartext because it can't name
  private address ranges; `net/Http.kt` refuses http to hosts that aren't home addresses, and each place has its CSP.
- Mac XCTest and Swift package tests were not run for this release (the Debug build and the universal Release
  build with its signing checks were).

How the backlog was merged, for next time: when several PRs are open, don't merge `main` into each in turn (every PR
edits this file, so each merge restarts the others' CI). Merge them into one integration branch, resolve once, run CI
once. `gh pr merge <n> --disable-auto` and cancelling queued runs keeps them from landing piecemeal meanwhile.

**Foli AI on Gemini, OpenAI and Anthropic (branch `claude/foli-ai-openai-anthropic-8112bb`, 2026-11-25, PR open, not
merged).** Owner's decisions: `docs/claude-context/memory/foli-ai-multi-provider-decisions.md`. Admin > Foli AI
(`/admin/foli-ai`, `convex/aiConfig.ts`, `components/admin/FoliAiView.tsx`) picks a provider per feature (chat,
agent, writing, research, attachments, digests, routines, knowledge graph, other) and three models per provider
(Fast, Main, Heavy; Heavy = tools, web search, files, prompts over ~50k tokens). Keys are saved by the owner,
sealed in `aiProviderKeys` (AES-GCM from `FOLEVI_HASH_SALT`), shown only as set + last 4; env vars still work.
Adapters: `lib/ai/gemini.ts` (as before, model and key now from the route), `lib/ai/openai.ts` (OpenAI SDK,
Responses API), `lib/ai/anthropic.ts` (Anthropic SDK, Messages API), shared bits in `lib/ai/common.ts`, routing in
`lib/ai/config.ts`. Transcription and search embeddings always use Gemini; no cross-provider fallback; credits follow
each provider's list price (cache reads/writes and web search priced per provider in `capabilities.ts`).
**Behaviour change on merge:** the owner chose "cheap first" defaults, so Gemini's Main becomes Flash-Lite
(`GEMINI_FAST_MODEL`) and 3.8 Flash (`GEMINI_MODEL`) moves to Heavy; every feature stays on Gemini until an admin
switches it. Tests: `tests/convex/ai-providers.test.ts` (19, fetch stubbed); full convex suite 1,150 pass. Not run
locally: the e2e suite and a visual check of the admin page (this Mac's local Convex backend refused pushes with a
500, with or without the change); CI runs both on the PR.


**Apple shells performance pass (2026-11-25, `docs/perf/apple-results.md`).** Mac (`claude/perf-apple-3eaf61`, PR into
`main`): content rules looked up from WebKit's store and in parallel with the library opening, runners start after the
first page loads (or 5 s), WebKit's private no-throttling switches for runners only, the Keychain read off the main
thread, the bridge script assembled once, an XCTest host that never takes focus, `PerfTests` (XCTest `measure`), and
`perf.mjs` / `perf-scroll.mjs` rewritten for the web-view app. Also fixes `main`'s Mac build (the regenerated icon set
renamed `calendar` to `calendarDays`). iPhone and iPad (`claude/perf-ios-3eaf61`, PR into `claude/ios-feedback-b1307a`):
the Keychain read off the main thread at launch; note-page memory measured and not leaking; `_bridge` route, splash
change and `capacitor://` caching measured and not worth changing.
## 9. Current state (as of 2026-11-24)

**Mac feedback, 2026-11-25 (branch `claude/mac-feedback-8652d2`, the owner's Mac feedback session).** Three fixes in the
web UI the Mac shows (so every platform gets them): (1) Home's rows of note cards blocked scrolling the page in the
Mac app: `globals.css`'s Mac no-bounce rule held both axes on every `.overflow-x-auto`; each region now holds only
along the way it scrolls (`test/mac-scroll-axes.test.ts`). (2) Folders 35% less round: radius token `folder` (9 px,
`rounded-folder`) for the folder card and `FolderGlyph`'s corners. (3) Show all tabs redesigned (owner's picks):
`TabOverview.tsx` + `TabPictures.tsx`; a note tab is its Home card, a split tab two cards (double-wide tile), a
folder tab its folder card, Home and other views a small drawing; names under the cards; it fills the page's panel
below the top bar (no clash with the window buttons); arrow keys by position (`test/tab-overview.test.ts`); also on
the iPad's tab bar now. Then an interface-polish pass (owner's "fix MEDIUM and LOW", conflicts by Folevi's rule):
Mac buttons don't shrink on press, overlays fade out (`ui/closing.ts`, Popover's copy fade), Reduce Motion keeps
fades, no hover lift on the Mac except folders, state icons cross-fade (`ui/SwapIcons.tsx`), concentric corners,
image outlines (`ui-img-outline`), steady-width counters, tab pin/close no longer overlap. Checked headlessly in an offscreen WKWebView harness (real NSEvent wheel events, a
`FOLEVI_BUILD=shell` dev server with the e2e FakeShell, scratch OPFS library); not yet seen in a Mac release build.
**Folevi Server on iPhone and iPad (Capacitor app, branch `claude/ios-server-signin`, 2026-11-25).** "Your own server"
works end to end in `apps/mobile`: the address (typed, or a QR code read with VisionKit's DataScannerViewController,
`apps/mobile/ios/App/App/ServerCodeScanner.swift`, exposed as PR 100's `foleviShell.places.scanCode()` only where the
device can scan; with camera access off it refuses with a reason the page shows), `addServerPlace`, the server's own sign-in
page in the sign-in sheet, and the account becoming a place on that server. The Capacitor host now passes
`places.server` to the page, loads that sign-in screen in account mode (even on first launch or from the library),
runs ServerReach (best connection, re-checked on network changes) and keeps the share sheet's REST base on Folevi
Cloud. The web sign-in screen and scan button are PR 100's (a800051c). Checked on the Simulator: the page at
`capacitor://localhost` (a secure context) can fetch and open ws:// to a plain-http private address (WKWebView doesn't
block it as mixed content), and the Capacitor app sets no policy header, so no-place sign-in pages keep the export's
meta policy (the paused native host in apps/ios would give them ShellPolicy.cloudNarrowing). Server sessions are Keychain items per account (`session.<user id>` in `com.folevi.shell-auth`,
as for Cloud), never in places.json (new `ServerTests.testAServerPlacesTokenStaysInTheKeychain`). Info.plist has
`NSLocalNetworkUsageDescription`, `NSBonjourServices` `_folevi._tcp` and `NSAllowsLocalNetworking`. Checked on the
Simulator against the local test server (http://localhost:8460) as 1.6.0: add, member sign-in, cold restart into the
server place. This branch also carries PR 83 (`claude/ios-feedback-b1307a`), since `apps/mobile` exists only there.

**Folevi Server, app side on `main` (server lead session, 2026-11-25, branch `claude/server-apps-base`).** "Your own
server" sign-in (address, QR, home network, linked servers), the server edition of the web app (`FOLEVI_EDITION=server`:
setup page, server admin panel, `/.well-known/folevi.json`, runtime addresses), Connect's cloud pages
(`/connect/approve`, `connect:myServers`), the backend's server edition (`convex/server*.ts`, `connect.ts`, SMTP, own AI
key, invites, roles), the Mac and iPhone/iPad `ShellServer` places, and `lib/server-edition/connection.ts` (best
connection for the web-based shells). Folevi Cloud is unchanged when `FOLEVI_EDITION` is unset (tests). The supervisor,
Connect service and packages stay on `claude/sleepy-goodall-3cg4e7` / `claude/server-connect`. Contract:
`docs/self-hosting/CONTRACT.md`. Local test server and how apps test against it: shared notes `folevi-server-apps.md`.
Rule for all Folevi Server work: mark every fake test token `// gitleaks:allow` (CI's secret scan reads every branch).

**iOS feedback session, release 1.5.78 (build 93), the Capacitor mobile app, 2026-11-25** (branch
`claude/ios-feedback-b1307a`, worktree `.claude/worktrees/ios-feedback-b1307a`; the owner's own words in chat:
"fix all the issues, push to testflight"). The branch holds `main` plus PR 66 (`claude/mobile-capacitor-f41734`, the
Capacitor app), PR 79 (failed queries keep pages up) and PR 80 (one set of sync words). On top:
- Widgets, the Control Center control, Siri and Shortcuts intents, and Spotlight carried into `apps/mobile` (a
  `FoleviWidgets` target, `com.folevi.ios.widgets`, App Group `group.com.folevi`; sources used in place from
  `apps/ios`; account mode fed by `AppServices.swift`, local mode by the page through `FoleviNative`'s
  `setWidgetSnapshot` / `takeLocalActions` / `finishLocalAction` / `indexSpotlight`). Not checked: a widget drawn on
  the Home Screen, running an intent or Shortcut end to end, account mode. See `docs/MOBILE.md`.
- `mobile-bridge.js` fell back to nothing when `Capacitor.registerPlugin` wasn't there yet, so the page got no native
  events (deep links from widgets and Shortcuts, app foreground and background); it now uses `Capacitor.Plugins`.
- iPhone Duo partly open: `FoldMarks.swift` (UIHingeInteraction plus the web view's `.division` reserved region,
  iOS 27.1) sets `<html data-fold>`, `--fold-start`, `--fold-end` as the native Duo app did. Checked on the Duo
  Simulator: half open the page gets 455 to 496 px and the sidebar reaches the fold; open and closed unchanged.
- The phone sync sheet redesigned (owner's feedback with a screenshot: "needs a huge UI improvement on phone"):
  `components/iphone/SyncStatusTouch.tsx`, a fitted sheet with a coloured status badge, the status and one
  sentence, and a card with Last synced, Waiting on this device, Connection and where it saves. Checked in the
  Simulator light and dark with the button shown temporarily in local mode (not committed); not seen signed in.
- The starter note (`packages/editor-schema/src/seed.ts`) no longer names only Mac shortcuts.
- iPhone top bar (owner's feedback, twice: cards cut off hard under it, then "too pushed to the icon, needs more
  spacing"): `.iphone-bar` in `globals.css` is a soft scroll edge on every screen (solid through the buttons and 8
  pt below them, then a 32 pt cosine fade, no hairline, no blur); the bar's buttons sit 8 pt under the status bar
  (was 4) and content starts 8 pt lower (`Screen.tsx`, Calendar's sticky header, banners, pull to refresh).
- A note's small title laid out mid slide-in could sit over Back; `Screen.tsx` lays it out again after the move and
  when it comes in.
- Uploaded to TestFlight on the owner's "push to testflight", internal "Folevi team": 1.5.78 build 93 (delivery
  45243ea1-b324-41f0-a07d-c8c2126386df), build 94 with the soft edge (2a7f351b-688c-4304-ba19-d6ada2ba8a13),
  build 95 with the spacing and title fix (f11a09ac-9c54-4f2a-8ecc-1e142a4a5dec), build 96 with the Foli AI and
  pop-in fixes below (b948ddf3-c4eb-4eb8-b34b-2941c6ae6cc0). No tag pushed.
- Foli AI (owner's screen recording): the composer went behind the keyboard because the Capacitor app sent no
  keyboard moves and the page's fallback (the visual viewport) reads 0 once the web view shrinks. `KeyboardBridge.swift`
  is now built into `apps/mobile` and `mobile-bridge.js` has `onKeyboard` / `keyboard`. Not checked with an on-screen
  keyboard: the Simulator has a hardware keyboard attached (toggle it in the Simulator pane to check). Also: the chat's
  preloaded code draws in the same turn (`AskAiChat.tsx`, a settled thenable for `lazy`), the stand-in is shaped like
  the composer, capabilities are kept per account (`ChatThread.tsx useLastKnown`), + Add shows while loading.
- Pop-ins: Home's counts, Reviews and Vault, the bell dot, Calendar's tasks and Tasks' counts use `useOfflineQuery`.
  Measured in local mode: no late DOM insertions on All notes, Tasks, Calendar. Account mode not checked (no account).
- Seen in the recording, not fixed: Home's lower half blank for a frame after the keyboard closes (WebKit repaint after
  the resize).
- Phone polish pass (owner: "the app feels finicky, a lot of small things load when I go to the page"), build 97
  (delivery d20d43f0-5651-4156-ae39-72d39011864a). Cause found by an audit: the iPhone remounts each screen on every
  push, pop and tab switch (`IphoneShell.tsx key`), so anything not cached loads again. Fixed: note lists keep their
  first page per list in memory (`DocumentBrowser.tsx firstPages`), Tasks use `useCachedQuery` (now with
  `failed`/`retry`), theme images keep their signed URL and palette for 50 minutes (`coverImage.ts`), calendar events
  and backlinks use `useOfflineQuery`, the list header and Select show while loading, Catch me up reads its brief
  before the first frame, Changes and Reviews hold their last answer, Settings/Changes/Shared/Reviews/Vault preload
  on the phone and draw in the same turn (`RouteView.tsx soon`), the note bar takes the page's tone in
  `useLayoutEffect`, press feedback waits 70 ms, and a note no longer fades and tilts in on top of the zoom.
- The rest of the audit, build 98 (delivery 6ce7ce3e-efa3-4ac1-aeca-0ba594e74920; the first upload try failed when a
  cleanup removed altool's temporary copy, the retry with the same .ipa succeeded): leaving rows (checked tasks, swipe
  to Trash/Archive) slide, fade and fold away (`components/iphone/exit.tsx`, `Swipe.tsx` `removes`, `Tasks.tsx`);
  SwipeRow uses passive Pointer Events with `touch-action: pan-y` (no touchmove listener holding up scrolls); the
  week-to-month strip moves with transforms only (`WeekStrip.tsx`); the tab bar moves on the push's spring when the
  move starts (`transitions.ts onMoveStart`); `READY_WAIT_MS` 50 (was 150); Reduce Motion keeps opacity-only fades
  (150 ms); Spectral uses `display: fallback`. Checked in the Simulator: the Foli AI composer above a real on-screen
  keyboard (it stays at 292 of 374 pt), the month opening and closing, a checked task folding away after about 0.9 s.
- Build 99 (delivery cea3add5-fcd0-4340-b6bc-5a8ceefb2abe): the keyboard leaves cleanly. Recorded in the Simulator
  (`simctl io recordVideo --display=1`, frames at 30 fps): closing Foli AI, the keyboard stayed up about 0.45 s after
  the sheet had gone, then Home showed blank where it had been for about 150 ms. Cause, measured: Capacitor's Keyboard
  plugin gives the web view its height back at keyboardWillHide, and WebKit takes about 90 ms (the page's own resize
  handlers take 0 ms) to lay the page out and draw it at the new size while the keyboard moves. Fix: a sheet closing
  with its field in focus lets the keyboard go as it starts to close, through `letKeyboardGo` (`lib/native/ui.ts`),
  which first calls the app's new `foleviNative.keyboardWillLeave` (`FoleviNativePlugin.swift`: the web view back to
  full height under the keyboard) and blurs once the page has re-laid out and drawn (resize plus two frames, at most
  300 ms); the sheet's own move starts a frame earlier. Done over a note and Hide keyboard use it too (blur after
  126 ms, measured). After: no blank frames as the keyboard uncovers Home. A keyboard dismissed by the user's own
  gesture (dragging it down) still goes the Capacitor way.
- Swipe axis lock checked in the Simulator with real touch drags (List layout of All notes): a sideways swipe opens
  Archive and Trash without scrolling; a vertical drag starting on a row scrolls the list 184 pt and opens nothing.
- iPad polish pass, build 100 (delivery e0d350bc-6c0e-4517-ba54-7b8cb39076b6; owner: "do the same polish pass for
  iPad"). The tablet layout (Shell, Sidebar, TabStrip, HomeDashboard, PageDock), audited then fixed:
  - Sidebar: unmounted on close and when a note opens, so its counts and rows loaded again each time; all its queries
    and the unread badge use `useOfflineQuery` (clock-moving ones held, as on the phone). It slides in and out with the
    page (transform only, 260 ms; `Shell.tsx`), checked on the iPad Simulator: hide 8 to -320 over about 270 ms, show
    with an ease-out. 44 pt targets for the folder chevron, Bookmarks toggle and pane buttons.
  - Home: Today's reviews held, Recent folders measure columns before paint. Settings, Foli AI, Changes, Shared,
    Reviews and Vault preload on the iPad too (`RouteView.tsx`). Tab titles keep known titles (`TabStrip.tsx`).
  - Touch: sidebar rows, tabs and sidebar buttons show a press (they only had hover), after the 70 ms beat.
  - Keyboard: the note's tool bar and overlay panels ride the keyboard (`rideKeyboard` in `lib/native/ui.ts`, the lift
    is `max(0, keyboard - (screen - 100dvh))` in CSS so the web view's resize can't leave it a frame out of place;
    measured: no more off-screen frame). Closing the floating chat, the command palette, prompts and popovers with a
    field in focus lets the keyboard go first (`afterKeyboardGoes`).
  - Motion: menus and popovers open on one 150 ms rise (`POP_IN`) and fade out (`popOut`); the note's floating side
    panel fades out on Close panel (`Inspector.tsx`).
  - Not changed, on purpose: `FolderDropLayer.tsx`'s document-wide non-passive touchmove (it lets press-and-hold drag
    stop the page scrolling; WebKit decides at touchstart, so it can't be added mid-drag).
  - Checked in local mode on a new "Folevi Feedback iPad" Simulator (iPad Air 11-inch): no late DOM insertions on Home,
    All notes, Tasks, Calendar or a folder. Not checked signed in or on a device.
- iPhone Duo polish pass, build 101 (delivery 1add5ccd-2e5c-4ae5-bb55-0266131abb81; owner: "do the same polish pass
  for iPhone Duo"). Audited, then fixed:
  - Folding and unfolding rebuilt the note page (phone and tablet layouts are different trees): the caret, scroll and
    keyboard were lost, against the owner's carry-over rule. `lib/app/noteCarry.ts` keeps the note's selection, focus and
    scroll anchor for 1.5 s across a layout switch and `DocumentView` restores them; Capacitor already lets focus()
    raise the keyboard (`CAPBridgeViewController` keyboardShouldRequireUserInteraction false). Checked on the Duo
    Simulator both ways: same note, caret at the same offset, editor focused, keyboard up.
  - App-wide pieces (Foli AI chat, Quick Add, runners) stay mounted across folds (`<Fragment key="globals">`).
  - The iPad sidebar slide ran on unfold (it saw the layout switch as an open): it now only slides on the user's
    toggle (`Shell.tsx sidebarLayout`); half open it follows the hinge with a width transition, its toggle and the menu's
    Hide sidebar aren't offered, and the layout switch fades in over 150 ms.
  - Half open, nothing in the fold: dialogs and the search window sit past it (`pastFoldFrame`), toasts too, menus and
    popovers keep to their anchor's side (`popupSpan`, the editor's menus included), the note dock's old fold rule
    (which crushed it) is gone. Closed and open, the side status column (84 pt) is kept clear: phone sheets, toasts, the
    palette, the banner, menus (`sideInsets()` in `lib/iphone.ts`; `safeInsets()` answers only in the phone layout).
  - Not checked: a real Duo; a horizontal fold (upright inner screen) by eye.
- Android polish pass (owner: "do the same polish pass for Android"), no Play upload. Two parts:
  - Web side, on this branch (3c8fb728 plus the keyboard bar fix after it): keyboard riding through the app's own
    frames, ripples in sheets and menus, one press feedback (no ripple plus :active together), no text selection on a
    long hold, `data-back` on Back buttons for the native back gesture. `NoteBars.tsx`: the plugin's
    `keyboardWillHide` no longer drops the bar on the keyboard when the app sends its own frames (it landed just
    before the app's frame and the bar vanished, then came back at the bottom), a bar drawn during a hide rides down
    from the keyboard's last height, and a hide already under way when writing stops (Android's Back) is followed.
  - Native side: PR 108 (`claude/android-polish-pass`, based on PR 69's `claude/android-capacitor-197cf4`): keyboard
    frames from the decor view (web view shrinks at the end of the show, grows back as the hide starts,
    `keyboardWillLeave`), the back watcher, predictive back with no page peek on phone, the saved launch colour, a
    cover while reloading, fold marks via WindowInfoTracker (not checkable on the emulator), overscroll off, and the
    font size following the system on a configuration change.
  - Measured on the phone emulator (combined build, post-paint frames): opening, the bar leaves the bottom at about
    150 ms and settles at 587 by 450 ms (before: held 0.9 s, then flew in); Back and Hide keyboard both ride it down
    to 923 with no gap or jump. Tablet and foldable emulators show the tablet layout; fold marks not checked.
  - The Capacitor app id on Android is `com.folevi.android` (launch `com.folevi.android/.MainActivity`).
  - Known: this branch's own `apps/mobile/android` is incomplete (its `web/` Kotlin package is caught by the unanchored
    `web/` in `.gitignore`); build Android from PR 69's branch. Whichever of PR 83 and PR 69 merges second reconciles
    `apps/mobile`. Glass blur on Android held as is (owner: same look as iPhone).
- Memory re-check (the open item): Duo closed, 20 opens of "Welcome to Folevi": 126 MB, 200 MB, 130 MB after
  `org.WebKit.lowMemory`; nothing kept per open.
- The three failing e2e specs listed in section 10 were already fixed on `main` by PR 77.
- Version history: 1.5.77's entry taken from tag `v1.5.77` (the Windows release) so this is 1.5.78.

**Release 1.5.76 (build 91), the Capacitor mobile app, 2026-11-25:** the iPhone note memory fix (PR 74, merged into
`main` as 85574054, then `main` merged here; PR 74's `transitions.ts` replaces 1.5.75's change); release commit
`83a4f3fc`, tag `v1.5.76` local; uploaded to TestFlight under the owner's "mobile to testers" approval (relayed by the
main session), delivery bc805158-7281-477d-923c-970475668b7e, internal "Folevi team". iOS only. Next free: 1.5.77.

**Release 1.5.75 (build 90), the Capacitor mobile app, 2026-11-24:** the iPhone screen moves empty their screen copy
afterwards (part of the memory growth, docs/mobile/ios-review-2026-11-24.md experiments G to P); release commit
`21c40255`, tag `v1.5.75` local; uploaded to TestFlight under the owner's standing OK ("release everything when ready",
relayed by the main session: internal "Folevi team" only, App Store submission still asked), delivery
13e2530f-5ba1-4952-9fbe-2989389f7657. iOS only.

**Release 1.5.74 (build 89), the Capacitor mobile app, 2026-11-24:** the iOS review's fixes (44 pt hit areas, local
mode's rules from the first request), cut after 1.5.73's history entry (tag `v1.5.73`, the Mac release); release
commit `e86fbbca`, tag `v1.5.74` local. Uploaded to TestFlight on the owner's "Release it" (delivery
9fe1d590-737b-47d1-a14c-fa4968d94428), internal group "Folevi team". iOS only; Android was not rebuilt.

**Release 1.5.72 (build 87), the Capacitor mobile app, 2026-11-24:** owner's OK, relayed by the main session ("release
all ready apps for all platform", "Mobile to testers": TestFlight and Play internal testing only). Cut on
`claude/mobile-capacitor-f41734` after 1.5.71's history entry (from tag `v1.5.71`); release commit `d153ae34`, tag
`v1.5.72` local. iOS: `apps/mobile/scripts/release.mjs --skip-shell --no-upload` made `apps/mobile/release/Folevi.ipa`
(84 MB, App Store profiles, production push, production backend), **uploaded to TestFlight on the owner's own
"Release it" in chat (delivery 58636ca8-bf67-4fb5-bcb9-6ce7ec46059c)**, internal group "Folevi team" once Apple has
processed it. That build predates the local-mode note-style rules (commit 2aa79b97). Android: the Android session builds the same commit for Play internal testing. The Windows session takes 1.5.73.
Sign-in on the simulator reached iOS's "Folevi wants to use app.folevi.com to sign in" prompt (no account used further).

**One mobile app with Capacitor (2026-11-24, branch `claude/mobile-capacitor-f41734`, PR 66 https://github.com/faisalibnislam/folevi/pull/66 into `main`, not merged):**
the owner's "one web app everywhere" plan for phones and tablets. `apps/mobile` is one Capacitor 8 project for
iPhone, iPad, iPhone Duo and Android around the web app's shell export (`build-shell.mjs --platform mobile`), with
no native screens. Details: `docs/MOBILE.md`.
- **iOS** (`com.folevi.ios`, same App Group, Keychain group, iCloud container and `capacitor://localhost` origin as
  the native app): XcodeGen project `apps/mobile/ios/App/project.yml`; the shell services shared with the Mac app are
  built in place from `apps/ios/ios/App/Native/Shell` behind one Capacitor plugin, `FoleviHost`
  (`App/Host/HostBridge.swift`); `bridge/mobile-bridge.js` gives the page `foleviNative` and `foleviShell` with
  Capacitor's Haptics, StatusBar, Share, Clipboard, ActionSheet, App and SplashScreen plugins. Share extension in;
  widgets, Siri/Shortcuts and Spotlight not carried over yet.
- **Android** (`com.folevi.android`): the Capacitor project as it was before the native rewrite (`7a4155c0~1`) with
  its Kotlin plugins and `folevi-bridge.js`, now on Capacitor 8.6.2, R8 in release, splash/insets/start-page fixes.
- **Layouts** (`apps/web/src/lib/platform.ts`, from PR 61): under 700 px the phone layout, wider the sidebar layout
  (iPhone Duo open is 951 pt wide, so the sidebar); tests in `apps/web/test/platform.test.ts`. `scripts/version.mjs` now writes the mobile app's version (1.5.70, 85).
- **Checked** (simulators "Folevi Mobile iPhone/iPad/Duo", emulators `Folevi_Mobile_Phone/Tablet/Foldable`):
  first launch, a library on the device, Home, the editor (an edit lands in the `.fnote` file), tabs on iPad and
  Android tablet, the share inbox (a queued share becomes a note), dark mode, Duo closed, foldable open; updating
  in place over the native iOS and Android apps keeps the library. Release builds: iOS 94 MB vs native 182 MB;
  Android 125 MB vs native 128 MB (86 MB of each is the web export, 64 MB of that note covers). Memory at Home:
  iOS about 183 MB vs native 172 MB; Android about 227 MB vs native 205 MB (PSS).
- **Not checked:** a real device; signing in end to end (on Android it reached the browser, which wanted its own
  terms accepted on the emulator; iOS's sign-in sheet couldn't be tapped from scripts); iPhone Duo open and
  folding (the simulator's hinge couldn't be moved from scripts on this Mac); push delivery.
- Nothing uploaded; native releases stay paused (a release would be 1.5.71 or later via `node scripts/version.mjs`).
**Folevi for Linux (branch `claude/linux-tauri-02790e`, worktree `.claude/worktrees/linux-tauri-02790e`, PR 73 https://github.com/faisalibnislam/folevi/pull/73 into `claude/desktop-tauri`, not merged; 1.5.75 published as downloads at `https://folevi.com/download/linux/`, latest links `Folevi-x86_64.AppImage`, `Folevi-aarch64.AppImage`, `Folevi-amd64.deb`, `Folevi-arm64.deb`, `Folevi-x86_64.rpm`, `Folevi-aarch64.rpm`, `SHA256SUMS.txt`; docs/LINUX.md "Releasing"):**
the shared Tauri 2 desktop shell (WebKitGTK) packaged for Linux, per the owner's 2026-11-24 "one web app
everywhere, system web views" direction. The shell itself comes from the Windows session (`claude/desktop-tauri`,
`apps/desktop/src-tauri`, merged into this branch 2026-11-24); Linux adds only Linux config, `src-tauri/src/linux.rs` and packaging.
Committed so far: `packaging/linux/` (desktop template, AppStream metadata, icons, `tauri.linux.conf.json` staged
for the shell, Flatpak manifest on GNOME 51, optional Snap, apt and dnf/zypper repo scripts), build scripts (Lima
VM on this Mac: Ubuntu 22.04 arm64 + a Rosetta amd64 root), Linux jobs in `.github/workflows/desktop.yml`,
`apps/desktop/src-tauri/src/linux.rs` and `tauri.linux.conf.json`, `docs/LINUX.md`, `docs/LINUX-TESTING.md`. Not on Flathub, Snap or apt/dnf (each needs the owner's OK); no in-app updates (no signing key). Untested on real Linux hardware: Wayland Quick Add, tray, notifications, file dialogs, browser sign-in, NVIDIA, Fedora/openSUSE installs, the Flatpak.

**Folevi for Windows and Linux (branch `claude/desktop-tauri`, PR 65 https://github.com/faisalibnislam/folevi/pull/65 into `main`, not merged; Windows 1.5.73 unsigned test installers published at `folevi.com/download/windows/Folevi_1.5.73_<arm64|x64>-setup.exe`):** the owner chose "one
web app everywhere" and the Mac app's approach (small, light), so the desktop app is now **Tauri 2** in the system
web view (WebView2, WebKitGTK), replacing the same day's Electron build (PR 58, `claude/windows-electron-4ed862`,
kept in history; the main session closes PR 58 when the Tauri PR supersedes it). Rust shell with the Mac's
ShellRouter method names behind the shared shell-bridge.js: library (FLV1), sign-in, places, E2EE keys, Foli AI own
keys, calendars, reminders, tray, Quick Add (Ctrl+Alt+Space), notifications, badge, folevi:// links, single
instance, window state, own spelling, printing, Windows caption buttons. Builds: `.github/workflows/desktop.yml` on
GitHub's native Windows x64/ARM64 and Linux x64/ARM64 machines (owner's pick), with memory measured against Electron.
141 Rust tests, bridge tests and a local smoke run (`apps/desktop/scripts/smoke.mjs`) pass. Updater off until an
update signing key is approved. Details and the owner's checklist: `docs/DESKTOP_APP.md`. First CI results (Windows
x64): NSIS 78 MB and MSI 79 MB against Electron's 182 MB installer; memory about the same as Electron's on Windows
(214 vs 207 MB private, run 45418586764; an earlier lower figure measured a page that never loaded). Windows ARM64 lost an increment in a
concurrent-write test (NTFS creation-time tunneling made etags repeat); fixed by using the NTFS file index
(bb8c25a1). Rerun 45361580640 passed every job (Windows x64 and ARM64, Linux x86_64 and aarch64, Flatpak); its
Windows test builds are in the owner's Downloads ("Folevi for Windows 1.5.68 Tauri test"), measurements in
`docs/DESKTOP_APP.md`. Since 2026-11-24 this session is **Windows only**: a Linux session
(`claude/linux-tauri-02790e`) takes Linux packaging (the Linux CI jobs and `apps/desktop/flatpak/`) on top of this branch.
**Folevi Server plan, version 2 (2026-11-25).** `docs/SELF_HOSTING_PLAN.md` rewritten for the owner's new brief:
native packages on Synology, QNAP, ASUSTOR and TerraMaster (UGREEN once they authorize us), a native Unraid plugin,
one-click catalog apps where only containers are allowed (TrueNAS, ZimaOS/CasaOS, Umbrel), a one-command native
Linux installer plus DigitalOcean 1-Click for hosted servers, one Go supervisor (`folevid`) wrapping the same
bundle everywhere, Plex-like Folevi Connect (server listed in the apps, `folevi.app` HTTPS names including LAN,
pass-through relay), owner/admin/member/guest roles, a full server admin panel, and relays for email, push, AI and
sign-in. Plan only; Phase 0 is still the only built part.
**Folevi Server, app side on `main` (server lead session, 2026-11-25, branch `claude/server-apps-base`).** "Your own
server" sign-in (address, QR, home network, linked servers), the server edition of the web app (`FOLEVI_EDITION=server`:
setup page, server admin panel, `/.well-known/folevi.json`, runtime addresses), Connect's cloud pages
(`/connect/approve`, `connect:myServers`), the backend's server edition (`convex/server*.ts`, `connect.ts`, SMTP, own AI
key, invites, roles), the Mac and iPhone/iPad `ShellServer` places, and `lib/server-edition/connection.ts` (best
connection for the web-based shells). Folevi Cloud is unchanged when `FOLEVI_EDITION` is unset (tests). The supervisor,
Connect service and packages stay on `claude/sleepy-goodall-3cg4e7` / `claude/server-connect`. Contract:
`docs/self-hosting/CONTRACT.md`. Local test server and how apps test against it: shared notes `folevi-server-apps.md`.
Rule for all Folevi Server work: mark every fake test token `// gitleaks:allow` (CI's secret scan reads every branch).

**Folevi Server on the Mac (session for the Mac, 2026-11-25, branch `claude/focused-brahmagupta-639148`).** Verified
against the local test server (`http://localhost:8460`) with headless tests, `apps/mac/FoleviTests/ServerFlowTests.swift`:
adding the address (this 1.5.73 build gets `app_outdated`, a 1.6.0 build gets the server), its sign-in screen (the
sheet's `/connect` sends a signed-out visitor to the server's `/signin`), signing in through the sheet's PKCE path
(`/api/auth/native/authorize` then `ShellAuth.exchange`) and through the native email form, a Convex token from the
server, the place switcher listing the server place next to a Folevi Cloud account and the library, and sign-out
ending the server's session. Also covered: Bonjour entries (`LocalServers.entry`), the version gate, `ServerReach`
(home name first, back to the added address when leaving home, no sign-out, `probe` injectable, `networkChanged()`),
and each server place's token in the Keychain only (`session.<user>` for place `acct:<user>`, never in places.json,
the run folder or the settings). The live tests skip without the server or `~/FoleviServerTest/test-accounts.env`;
the real Bonjour browse runs only with `FOLEVI_LIVE_BONJOUR=1` (it can ask for Local Network access; with the
owner's OK it ran and passed on this Mac on 2026-11-25, headless, `TEST_RUNNER_FOLEVI_LIVE_BONJOUR=1`). The server
rate-limits sign-ins: run the two live sign-in tests a minute apart if they get 429. Also fixed: the Mac build was
broken on `main` since the icon regeneration dropped `WebIcon.calendar` (now `.calendarDays`).
The sign-in screen (account mode, no place yet: `AppScheme.signInOf`) gets `https: http:` in its connect-src so the
page's own `lookUpServer` can read any server's folevi.json; account pages and local mode are unchanged.
`ServerPageTests` checks it in an offscreen web view with the real scheme handler and a listener on the Mac's LAN
address: an `app://` page fetching a home http server is not blocked as mixed content on the Mac (WebKit lets it
through although `app://` is a secure context), a Folevi Cloud page and local mode can't reach it, and a server
place on that http address can. That test needs the Mac's firewall off, or `FOLEVI_LIVE_LAN=1`.

**Backend performance pass (session `perf-backend`, 2026-11-25).** A generated 5,000-note test library
(`convex/lib/fakeLibrary.ts`, seeded by `convex/devSeed.ts` into an `@example.com` test account, refused on
production) and a read-cost harness (`tests/convex/perf/`, run with `FOLEVI_PERF=1`). Baseline and every fix's
before/after numbers: `docs/perf/backend-results.md`. At 5,000 notes `organization.index` reads 13 MB per run (the
limit is 16 MiB) and task lists read up to 1,476 documents.
Step 2: every mutation is now built from `convex/lib/functions.ts` (not `_generated/server`), whose db wrapper reports
writes to `documents` and `folders` to `lib/listStats.ts`. That keeps `listStats` (per folder: page count, last edit,
5 newest previews; per scope: the Drafts count) in step, and `organization.index`, `recentFolders` and `draftCount`
read it instead of the pages. A folder or scope without a row is counted from its pages as before until
`migrations:backfillListStats` runs (production run waits for the owner's OK). Task rows carry their note's public
id, title and icon (`syncTaskLabels`, cleared when a note is sealed), so task lists read no notes. Writing straight
to the db in a test (`t.run`) skips the wrapper: use `watchedDb(ctx)` from `lib/functions.ts` there.

**A failed query no longer takes a page down (branch `claude/project-thread-u99yc5`, open PR, 2026-11-24).** Components
read queries through `apps/web/src/lib/convex/queries.ts` (`useQuery`, `usePaginatedQuery`, `useQueryState`), never
convex/react's (an eslint `no-restricted-imports` rule says so). A failed query reads as still loading (keeping its
last good result), is dropped and asked again after 1, 2, 5, 10 and then every 30 seconds (shared by every hook on the
same query and arguments), and says `failed` with a `retry()`. Lists that failed show `components/ui/LoadFailed.tsx`
("Couldn't load your notes", Try again) in place of their placeholder: note lists (desktop and iPhone), Tasks (both),
Shared with Me, Changes, the Foli AI chat history. Local mode's query cache re-runs a failed entry when it's watched
again. Still thrown on purpose: E2eeGate's `e2ee_locked_session` (`throwsToBoundary`), and `useQueryOrThrow` where a
component's own boundary handles the failure (the admin gate's whoami, a chart's collection source). Tests that mock
convex/react keep working: `test/setup.ts` hands the app's hooks over to the mock's.

**One web app everywhere: the web side (branch `claude/web-everywhere-0e2975`, 2026-11-24).** The web app is now the
interface on every platform (browser, Mac, Windows, Linux, iPhone, iPad, Duo, Android, Folevi Server). Layout rule
(owner, 2026-11-24, `docs/claude-context/memory/web-everywhere-layout-rules-2026-11-24.md`): width decides on every
device. `apps/web/src/lib/platform.ts` answers `formFactor()` (phone under 700 px, else tablet when used by touch,
else desktop), `shell()` and `os()`, and marks `<html data-form data-shell data-os data-touch data-fold>` (first paint:
`lib/theme/bootScript.ts`). `lib/iphone.ts` reads it: a phone's browser and a narrow computer window now get the
phone interface with the bottom bar; an open iPhone Duo gets the tablet layout (it got a stretched phone layout,
because the phone was picked from the iPhone user agent); Android tablets and touch browsers get the iPad's touch
look (CSS moved from `:root[data-ipad]` to `:root[data-tablet]`). A vertical fold keeps the sidebar left of the
fold and the page past it; the fold is read from the marks the native Duo app already sets (`data-fold`,
`--fold-start`, `--fold-end`) or Chromium's viewport segments, and an app's own marks are never cleared. The contract for shells is in the shared notes (`web-everywhere-platform-contract.md`).
**Web everywhere, landed on `main` 2026-11-25 (PRs 61, 62, 63, 64, 68, 70, 71, 72, 74, 75).** Besides the layout rule
above: shortcuts read the way each system writes them (`lib/shortcuts.ts` `useMacKeys`, `useKeyLabels`; Ctrl+ off
Apple's); the owner's platform touches (Instrument Sans everywhere, the web's springs kept except the Mac's no-bounce
motion, Android's press ripple `lib/android/ripple.ts`); one wording set and one icon per thing on phone and desktop;
touch hit areas of at least 44 pt (`.ui-hit`); the app counts as a touch device only with touch points; boards ignore
presses from their own sheets (`canvas/pointers.ts pressIsElsewhere`); the iPhone layout lets go of closed notes in
WebKit (`components/iphone/transitions.ts`, about 5 MB per open before); the tools panel picks its tool before a note
draws; `/apps` lists Folevi for Windows and Linux; note styles sync into the apps (`GET /note-styles`,
`lib/shell/styleSync.ts`, local mode's one anonymous request) and the privacy policy says so.
**Folevi for Mac back to the web view (owner, 2026-11-24, branch `claude/mac-webview`, PR 67): released as 1.5.73**
(build 88, tag `v1.5.73` local, live on the Mac feed, notarized, universal; the owner said "Release it"; 1.5.72 was
already the Capacitor mobile app's, recorded from tag `v1.5.72`). the owner
chose to bring back the AppKit WKWebView app (`archive/mac-appkit`, 1.5.64) showing the web app's own UI (sidebar,
tabs, top bar, Mac window buttons in the page's top bar), as on Windows and Linux, keeping the menu bar, Quick Add
and the menu bar icon, Spotlight, Shortcuts, Share and Services. Done: `apps/mac` restored from the tag and the
native frame (N8) removed (Frame/, floating notes, the native Settings window: ⌘, opens the web's /settings in the
main window; Quick Add is the web panel). The SwiftUI app is at tag `archive/mac-swiftui` (= v1.5.71, local).
Carry-over from 1.5.71 checked on scratch data: same bundle id, support folder, Keychain names, web storage and
desktop settings key; the SwiftUI app's "Lock Folevi" defaults (`folevi.lock`) are written back to lock.json once.
111 Mac tests pass; the Release build passes release.mjs's checks; 1.5.71 then the new build on one scratch
library opens the same notes. The owner kept this look (window buttons in the web's top-left corner). Not done: a signed-in Release
run (twice the owner answered "notes appear" but the test copy's scratch folder recorded no sign-in: do it with the
owner at the Mac, the installed Folevi quit first), which the owner chose to skip by releasing. Debug scripts that compared "web" and "native" frames (screens, menus, quickadd, gates) still take a kind;
only "web" means anything now.

**1.5.70 on TestFlight (2026-11-24, owner's OK):** build 85, cut on `claude/ios-release-1.5.70` from the iPhone Duo
branch (PR 55, which holds all of `main`), so testers keep the Duo window that 1.5.69 had; uploaded (delivery
e18198df), tag `v1.5.70` local only. No visible change from 1.5.69: it lines TestFlight up with the merged code
(engine contract revision 35). Its PR into `main` holds only the version commit once PR 55 merges. **Owner's
decision the same day: "one web app everywhere"** (Electron for desktop, Capacitor for iPhone, iPad, Duo and
Android); native releases and new native UI work are paused until the owner says otherwise. This pauses the
native apps only: Android itself is active as the Capacitor app (owner, 2026-11-25).

**Release, 2026-11-24 (branch `claude/folevi-core-529dbe`, PR 51 merged into `main` as 7e2080e9):**
- **1.5.66** (tag `v1.5.66`, local): the native Mac app replacing the AppKit one, plus PR 52's iPhone/iPad redesign.
  Published to Sparkle and uploaded to TestFlight with the owner's OK. **It broke signed-in Macs:** the window stayed
  on the loading screen. Cause: the app never set `AppScheme.modeOf`, so every page got the local
  Content-Security-Policy, which blocks Convex; a signed-in place's engine page threw on its first WebSocket.
  Local libraries were fine.
- **Mitigation (owner's OK):** the 1.5.66 item was removed from `mac/appcast.xml` and `mac/Folevi.dmg` points at
  1.5.64 again, so Macs on 1.5.64 get no update. Macs already on 1.5.66 stay stuck until 1.5.68.
- **1.5.68 is live on the Mac feed** (tag `v1.5.68`, local; build 83): the fix (`WebViewFactory.scheme` sets
  `modeOf`; `SchemeModeTests`), 70 Mac tests pass. The owner installed it by hand and confirmed their signed-in
  account opens; then it was published (feed and `Folevi.dmg` show 1.5.68, notarized). With a fake account place and
  no token, the Release build has no page errors but still waits. 1.5.67 is the iPhone/iPad release that
  `claude/ios-native-redesign-f4a8be` cut; its code reaches `main` through PR 56.
- **PR 51 merged** (7e2080e9). After it: the Android session merges PR 54 (owner: "merge PR 54 after PR 51"); the
  iPhone/iPad session opened PR 56 into `main`.
- **Tabs (owner, 2026-11-24):** everything opens in a new tab exactly like the web on Mac, iPad, and Android
  tablets/Googlebooks (`docs/claude-context/memory/tabs-match-web-2026-11-24.md`). iPad and Android were forwarded
  to their sessions (the iPad already matched). **Mac: done on branch `claude/mac-web-tabs`** (off the release
  branch, pushed, no PR yet, not released): the rule is `AppModel.placement` (`Destination.tabKind`,
  `TabRuleTests`), `WindowModel.go` routes, `step(to:)` moves inside a tab. Checked in the demo app.
- **Mac best-native pass (owner, 2026-11-24), same branch:** three read-only skill audits (HIG/macOS, motion,
  SwiftUI performance), then the fixes: no-bounce motion, Bookmark wording, Ask Foli AI in the toolbar, New
  Folder ⇧⌘N, menu and performance fixes (commit dc6b33ed). Owner's picks:
  `docs/claude-context/memory/mac-best-native-pass-2026-11-24.md`. 77 Mac tests pass; demo screenshots checked.
  **Released as 1.5.71 (build 86, tag `v1.5.71`, local) and live on the Mac feed, 2026-11-24**, with the owner's
  OK ("Release Mac 1.5.71"), from branch `claude/mac-app-d228e2` (the Mac session's worktree; it merged
  `claude/mac-web-tabs` and main at PR 56, 546f6aa4). 1.5.69 and 1.5.70 (TestFlight, other branches) were recorded
  from tag `v1.5.70`. Release build checked: signed, universal, production export, same Keychain requirement; on a
  scratch folder with an account place and no token it reaches the first-launch screen (no hang). The owner said
  "publish" after being asked to sign in on that test copy, but no sign-in showed up in its data folder, so a real
  signed-in Release run was **not** observed; the Mac host and shell code is unchanged since 1.5.68 (the
  `modeOf` fix), and web changes since then are Android-only. Owner's strategy (2026-11-24): the Mac keeps this
  web-view app; Windows/Linux get a Tauri shell and mobile Capacitor (other sessions). Not done from the audits: toolbar customization
  (`.toolbar(id:)`), menu-bar items for every toolbar action (Sort By, Empty Trash, Enclosing Folder), click
  semantics (select vs open) across lists, Recent/Shared selection, cover image downsampling, card picture
  invalidation, Settings search.

**iPhone Duo, third pass (owner's pick, 2026-11-23; was PR 53, now in PR 55 below):** branch
`claude/iphone-duo-ipad-layout` (worktree `.claude/worktrees/iphone-duo-18adb4`), on top of PR 52's branch
`claude/ios-native-redesign-f4a8be`. Open (the inner screen, across or upright) the Duo shows the iPad's wide
layout; closed, and in a Split View half, the iPhone layout with iOS's side column (`RebuildIPad.isWide`: an iPhone
window of regular width, 600 pt or more). The note page follows (`RebuildPageLayout` sets `wide` on the page's
marker; `lib/iphone.ts`), the open note, caret and keyboard carry across folds both ways, and partly folded nothing
sits in the crease (`FoldSpan`: the strip's tabs, the card's bar, the note's dock). The second pass's split view
(PhoneColumns, the last note in the empty column) is gone: Home is one stack on every iPhone again. Plan, research
and screenshots: `docs/IPHONE_DUO_PLAN.md`, `docs/iphone-duo/`. Decisions:
`docs/claude-context/memory/iphone-duo-decisions.md`.

**iPhone Duo on the native iPad window, Apple's Duo rules applied (2026-11-24; PR 55,
https://github.com/faisalibnislam/folevi/pull/55, branch `claude/iphone-duo-native-ipad` into
`claude/ios-native-redesign-f4a8be`; replaces PR 53, closed; released as 1.5.69 build 84 to TestFlight, tag
v1.5.69 local only):** PR 53's Duo work merged with `claude/ios-native-redesign-f4a8be` (the
native iPad window), then a pass against Apple's "Designing for iPhone Duo" (owner: "make the best duo app possible").
Open, the whole toolbar sits in iOS's side column (`IPadToolbar` with `sideBars`, read by `readVerticalBars`), the
note's tools sit at its foot where the closed phone has them and the page drops its dock (marker `sideTools`), the
sidebar stays beside the content and reaches the fold when partly closed, and it steps aside while the inspector is
open. `FrameModel.windowResizedAt` (set by RebuildFrame's viewWillTransition) keeps a fold from hiding the sidebar.
Details and checks: `docs/IPHONE_DUO_PLAN.md`, "Update (2026-11-24)".

**iPhone and iPad redesigned after the Mac's window (1.5.65, TestFlight):** branch
**iPhone and iPad redesigned after the Mac's window (1.5.65 and 1.5.67, TestFlight):** branch
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
  with the owner's OK (delivery 953a8af0, internal group once Apple has processed it). Its first round reached
  `main` through PR 52 into `claude/folevi-core-529dbe` and PR 51.
- **1.5.67** (build 82, tag `v1.5.67`, local): the second round (native iPad window, iPhone system lists) on
  TestFlight with the owner's OK. **PR 56** (https://github.com/faisalibnislam/folevi/pull/56) brings it into
  `main`, with `main` (1.5.68) merged in; native-kit iOS tests, the macOS build and the Mac app's 39 tests pass.
  Merging is the owner's call (it deploys the web, though no web code changed).

**Folevi for Mac is now the native app (in progress, not released):** branch `claude/folevi-core-529dbe`
(worktree `.claude/worktrees/folevi-core-529dbe`), `apps/mac`; pushed to GitHub 2026-11-23 with the owner's OK (not merged). The iPhone/iPad
redesign's first round came in through PR 52; its second round goes straight to `main` (PR 56).

- **What happened (2026-11-23):** the native macOS 26 app (built as "Folevi Core" from 2026-11-21) replaced the
  AppKit Folevi for Mac (the owner's choice). The AppKit app was removed from `apps/mac`; its last release, 1.5.64,
  is at the git tag `archive/mac-appkit`. The owner then said there is no separate Core version any more: the
  project, target and module are `Folevi` (`apps/mac/Folevi`, `apps/mac/FoleviTests`, `Folevi.xcodeproj` generated
  from `project.yml`), and `scripts/app.mjs` runs the Debug app (was `core.mjs`). The product is "Folevi" ("Folevi
  Dev" in Debug). Only the branch and worktree keep the old name (`claude/folevi-core-529dbe`), because PR 52 targets
  it. "Folevi Core" elsewhere in the repo is the pricing plan, unrelated.
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
- **Shared host files:** the UI-free files moved into `apps/mac/Folevi/Host/Shared`.
- **Editor and data layer:** SwiftUI around the web editor, which runs in pooled warm web views. The data layer is
  the web export through FoleviEngine and the iOS shell services, compiled by path.
- **The window (2026-11-23, latest):** the owner set the Macloving guide aside ("do the UI your way, pixel
  perfect, as good as Finder and Apple Notes, UX like the web, every feature"). The window is now built the way
  Finder and Notes are: a system `NavigationSplitView` (sidebar can be hidden, View > Hide Sidebar), a unified
  Liquid Glass toolbar (Back and Forward, title and subtitle, New Note as the ink pill, the screen's items, the
  screen's search as the toolbar search field), the system `.inspector`, native window tabs laid out by the system.
  Screens still declare their bar with `.screenActions` / `.screenSearch` / `.screenSubtitle` / `.screenLeading` /
  `.screenTitle` (`Views/Common/ScreenBar.swift`); those now feed the system toolbar. The custom card, glass top
  bar and `WindowMetrics` are gone. `docs/design/macloving-mac-ui.md` no longer applies to the Mac window.
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

**Android native app (2026-11-23):** branch `claude/android-native-622675` (worktree
`.claude/worktrees/android-native-622675`, off `e12fb272`), not merged or pushed. Owner's answers:
`docs/ANDROID_NATIVE_PLAN.md` section 1 and `docs/claude-context/memory/android-native-decisions-2026-11-23.md`.
What's there (checklist in the plan, section 4):
- Kotlin bridge codegen (`scripts/engine-codegen-kotlin.mjs`; `pnpm engine:gen` writes Swift and Kotlin; CI
  `--check`), Lucide icons (`scripts/icons-codegen-kotlin.mjs`), the engine module (client, stores, WebView
  transport; test round-trips every fixture).
- **Contract revision 34** (on this branch): `"android"` in the marker's and `AppInfo`'s platforms; Swift and
  Kotlin regenerated (hash `bbfa6dca`); web host posts big batches straight to `foleviEngineHost`.
- The Capacitor app is **removed**; its Kotlin services moved into `apps/android/app` behind a host bridge
  (`bridge/`: a `window.Capacitor` stand-in over a WebMessageListener). 38 service tests and 133 parity tests pass.
- Screens: adaptive frame (bar / rail / Googlebook sidebar, list beside note, note stays on fold), Home, notes
  lists, Drafts, Shared, Changes, search, Tasks with quick add, Calendar month, Foli AI chat, Settings, Vault,
  generic gate screen (first-launch choice, sign-in, library setup, E2EE). Googlebook: shortcuts helper,
  right-click menus, new windows, drag out. Release build with R8 and upload-key signing.
- Checked on emulators: local mode end to end, the editor in the note pane, share target, Vault set-up/lock/
  unlock, Googlebook-size window, fold/unfold, an R8 release build, and (2026-11-24) signing in to a test account
  on the dev backend (`peaceful-mockingbird-196`) by tapping Sign in to Folevi, Sign in with email and Continue,
  landing on the account's Home and notes. The test account is in `apps/android/.e2e-account.json` (git-ignored);
  `node apps/android/scripts/e2e/signin.mjs` makes a new one.
- **Not verified:** push (needs Firebase settings), Drive/Dropbox (need client ids), widgets and the tile on a home screen, a Back press
  that once left the app on the desktop emulator (not reproduced).
- Emulators: Taskeni's emulators (another project) use ports 5554-5558 now; this app's AVDs are Folevi_Phone,
  Folevi_Tablet, Folevi_Foldable, Folevi_Desktop (1920x1200 @160). Boot them on free ports.

**Android as Capacitor (2026-11-24, replaces the native app above; owner: one web app everywhere):** branch
`claude/android-capacitor-197cf4` (worktree `.claude/worktrees/android-capacitor-197cf4`), **PR 69**
(https://github.com/faisalibnislam/folevi/pull/69, contains PR 66 and `main` up to PR 60; merging it deploys the web). Folder
`apps/mobile/android`: the Android half of the one Capacitor mobile app; the shared setup (`apps/mobile`,
`capacitor.config.ts`, `package.json`, `scripts/`) is the iOS session's `claude/mobile-capacitor-f41734`, merged
into this branch. Both sessions had restored the same Android app; the merge keeps this branch's Kotlin and
manifest fixes and their shared cloud-kit bundling (`apps/mobile/scripts/bundle-bridge.mjs`), R8 rules and bridge
additions. The only shared-config line Android adds is `android.includePlugins: []`.
- Restored from the paused Capacitor app (`e12fb272`) on Capacitor 8.6.2; same package, storage names, Keystore
  and `https://localhost` origin as the native app, so it updates in place. Version and versionCode from
  `version.json`, upload-key signing, R8. Android takes no stock Capacitor plugins (`android.includePlugins: []`,
  the one line it needs in the shared config; reasons in `apps/mobile/android/README.md`).
- Fixed on the way: `env(safe-area-inset-*)` never reached the WebView (the inset listener replaced its handling;
  the phone top bar sat under the status bar), and wide windows' Back used browser history instead of the web's
  tab rule (one Back from a note could leave the app). Back now presses the page's Back, then Home, then leaves.
- Checked on emulators (debug unless noted): installed over the native app (debug and release builds) it opens
  the same library; editor, keyboard and its bar; Back on phone and tablet (a tab opened from Home closes back to
  Home); share target into the Inbox; signing in to a scratch dev account through the Custom Tab (tablet, sidebar
  layout, account notes open); fold/unfold switches phone/sidebar layout with no reload; Googlebook-size window
  with Ctrl+Shift+N opening a second window; light and dark. Kotlin unit tests, cloud bridge tests (27), parity
  tests (133, now on this app's bridge), version test.
- **On Play internal testing: 87 (1.5.72), published 2026-11-24 19:05** with the owner's OK (relayed by the main
  session, "release all ready apps for all platform", mobile to testers), replacing 83 (the native app). Built from
  `d2ef501c` (this branch with the mobile session's release commit `d153ae34` merged): production web export
  (`build-shell.mjs --platform mobile --production --required`), `FOLEVI_RELEASE=1 npx cap sync android`,
  `bundleRelease` with the upload key and Firebase push values (`FOLEVI_FIREBASE_*` from the owner's
  `~/Downloads/google-services.json`, project `folevi-9b8a5`; never committed). The owner dragged the AAB into Play
  Console; Claude added it from the library, wrote the release notes and published. Only warning: no native debug
  symbols. Checked on an emulator with that exact build: first launch, local mode Home, editor, Back, no crash.
  Not tested: production sign-in, push arriving, Drive/Dropbox, widgets and tile, a real device, Android 13, the
  update from build 83 with release keys (checked with debug-key builds only).
- Size and memory vs the native app: AAB 96.6 vs 100.8 MB; memory on Home 205.7 vs 199.3 MB (table in the README).
- Not checked: push arriving (Firebase is set up as of 1.5.72), Drive/Dropbox, widgets and the tile, a real device, Android 13.
  On a Googlebook the device words say "tablet" (the web knows only phone and tablet for Android).
- Native app (`apps/android`) stays in the tree as the reference; CI's Kotlin codegen checks still point at it.

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
- After 1.6.78 (2026-11-25), in order: the owner drags the Android bundle into Play internal testing; the
  hardware checks listed at the
  top of section 9; Folevi Server packages (the Folevi Server session). `migrations:narrowDocumentText` already ran on production (the owner,
  2026-11-25). Next free version: 1.6.79 (or 1.7.79 for a
  Big update). Mac deltas need `apps/mac/release-archive/Folevi-1.6.78.zip` (kept in the main checkout).
- Shell performance (2026-11-25): merge PRs 84, 85, 86 into their shell branches; check PR 85 on a Windows PC with two
  accounts and a library; Android launch time needs the SDK and an emulator (owner's OK).
- Apple performance: the Mac launch run (owner's OK, 2026-11-25) showed no measurable difference at a load average
  of 43; re-run `perf.mjs` (and `perf-scroll.mjs`) on a quiet Mac with a generated 5,000-note library (`--library`);
  confirm the iOS launch and memory numbers on a Release build on a device.
- Foli AI providers (PR from `claude/foli-ai-openai-anthropic-8112bb`): check CI's e2e and the admin page, then the
  owner merges. After deploy, the owner adds the OpenAI and Anthropic keys in Admin > Foli AI (or sets
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in Convex) and switches features. Possible follow-ups: a "Test key" button
  (one cheap call), a local-mode equivalent is already there (own keys), Anthropic's server-side refusal fallback
  (left out: the owner chose no fallback), and audio attachments in a chat routed to OpenAI or Claude are refused
  by the adapter rather than up front.
- Mac feedback branch (`claude/mac-feedback-8652d2`): the owner checks Home scrolling, folder corners and the new Show
  all tabs in the next Mac build (needs "release it"); a split-view tab in the overview was not drawn in the
  headless check (no split tab in the scratch library).
- Android own server (`claude/android-own-server`, PR 103): merge after PR 69 and PR 100, then merge main into it.
  Still open: Android's other windows don't reload when a server is added (only the one that added it); reading a
  real QR code and a full sign-in on a server are untested.
- Android emulators: the android-36 image is still kernel-only (no `system.img`), and `Folevi_Phone` (the
  `phone` AVD in `apps/mobile/android/scripts/emulator.mjs`) uses it. Boot it on the 37.0 image with
  `-sysdir ~/Library/Android/sdk/system-images/android-37.0/google_apis_playstore/arm64-v8a -read-only -wipe-data`,
  or move the AVD to 37.0. Android 37 debug builds log "unable to find plugin : SplashScreen" for the page's
  `SplashScreen.hide` calls (`includePlugins: []`); harmless, but the page could skip that call on Android.
- iPhone/iPad Folevi Server (`claude/ios-server-signin`): not yet checked: QR scanning on a real device (the Simulator
  has no camera), switching names on a network change (the test server has no Connect hostnames), two server places in
  the switcher, the "found on your home network" list (bridge `listLocalServers` exists; no web UI uses it yet), an
  invite QR's token (reduced to the server's origin, not yet carried to its sign-up), and a per-place
  page policy header (the Capacitor app serves pages through Capacitor's own handler, so the meta policy applies alone).
  `apps/mobile` `pnpm sync` names `scripts/prepare-web.mjs`, which was never committed (run `pnpm bundle && npx cap sync`).
  Server side: the server's "Use another account" page in the sign-in sheet fails with "Invalid callbackURL", so a second
  account on the same server can't be added there yet. A pending server sign-in screen has no way back to the open
  place except `places.switchTo`.
- Folevi Server: DS223 install of the ARM64 `.spk` (owner gives SSH user and address), memory on 2 GB (the backend
  reached 1.9 GB RSS after seeding 5,000 notes on an 8 GB VM), Connect on Fly.io (owner's OK per deploy; Cloudflare
  DNS token for folevi.app; `connect.folevi.com` records at folevi.com's DNS), then each app session adds server
  sign-in to its shell (Mac, iPhone/iPad, Android, Windows, Linux). minAppVersion is 1.6.0.
- iOS feedback session (`claude/ios-feedback-b1307a`): 1.5.78 on TestFlight; the branch's PR into `main` carries PRs
  66, 79 and 80 too. Open: on a real iPhone, iPad and Duo, sign in, push, the widgets on the Home Screen, a Shortcut
  run and a Spotlight tap; the new sync sheet signed in; `BackgroundRefresh.swift` not carried over (needs
  Info.plist background task entries). Done here: widgets/Shortcuts/Spotlight, the memory re-run, Duo's fold marks,
  sync words, the starter note's shortcuts.
- Mobile app (`apps/mobile`, PR 66 from `claude/mobile-capacitor-f41734`): note covers stay bundled (owner, 2026-11-24) and styles sync from the server when they change (docs/MOBILE.md "Note styles and covers": signed-in offline caching to build in `apps/web` with the web session; local mode may check for new styles too (owner, 2026-11-24): iOS network rules allow `convex.site/note-styles` and Convex storage images only, copy updated; the endpoint and the page's fetch and cache are the web session's); the owner reviews and merges (merging
  deploys the web, which has the layout change in `lib/iphone.ts`); then check sign-in, push and iPhone Duo folding
  on real devices; carry over widgets, Siri/Shortcuts and Spotlight; one bridge script for both platforms; from the iOS review (docs/mobile/ios-review-2026-11-24.md), the web session's iPad touch targets and the note page's memory growth; release
  scripts for TestFlight and Play (only with the owner's OK).
- Android polish (owner asked 2026-11-25): PR 108 waits on PR 69; then check fold marks and predictive back on a real
  foldable, and a Play build only with the owner's OK.
- Folevi for Linux, changelog at the sync with `main` (main session's ask, 2026-11-25; PR 73 merges last, after PR 65):
  combine Linux into the existing 1.5.75 entry (iOS's, from `claude/mobile-capacitor-f41734` / tag v1.5.75, build
  90) in CHANGELOG.json and CHANGELOG.md rather than adding a second one. Proposed: summary "Folevi on iPhone uses
  less memory as you open and close notes, and Folevi for Linux is here."; added: "Folevi for Linux: AppImage,
  .deb and .rpm for Intel/AMD and ARM computers, at folevi.com/download/linux."; keep iOS's improved line. Tags
  already go to v1.5.76, so nothing new is cut for this.
- Folevi for Linux stores (PR 99 `claude/linux-stores`, owner's OK 2026-11-25; docs/LINUX.md): apt and rpm
  repositories LIVE at `folevi.com/download/linux/apt` and `/rpm` (1.5.75), checked by installing from the live
  addresses on Ubuntu 24.04, Debian 12, Fedora 41, openSUSE Tumbleweed (arm64 containers). Snap: LIVE at
  snapcraft.io/folevi, 1.5.75 stable for amd64 (revision 4, Launchpad remote-build) and arm64 (revision 3), new icon. Flathub: blocked, its AI policy forbids
  AI-written manifests and AI-opened submissions (docs/LINUX.md "Flathub"); only the owner can do it by hand. The
  owner should copy `~/.folevi-linux-signing/folevi-repo-secret.asc` into their password manager. From the next
  Linux release the .deb and .rpm add the repositories on install; each release also runs the repo scripts.
- Folevi for Linux (`claude/linux-tauri-02790e`, 1.5.75 published): the owner tries it on real Linux (docs/LINUX-TESTING.md, files in `~/Downloads/Folevi for Linux 1.5.75 test/`); PR 73 into `claude/desktop-tauri` waits on the owner's review and merge (it reaches `main` with PR 65); record 1.5.75 in version.json/CHANGELOG/tag at merge (main session); the blank-window fix reached Windows (c150ba78); Linux memory (docs/LINUX.md "Memory"): the web export as files beside the program landed (6269a7ff) and is merged here: Linux 355 MB PSS in the VM; later, each with an OK: Flathub, Snap, apt/dnf repositories, an update signing key. Earlier notes:
  check the Linux compile and tests of the merged shell in the VM, build AppImage/.deb/.rpm for x86_64 and
  aarch64 in the Lima VM `folevi-linux`, smoke-test, put test builds in `~/Downloads/Folevi for Linux <version> test/`.
  Owner decisions pending: Linux signing key and repositories on R2, Flathub/Snap submission (all need an OK).
- iPhone and iPad redesign (`claude/ios-native-redesign-f4a8be`): PR 56 into `main` waits on the owner's review
  and merge; the owner tries 1.5.67 from TestFlight. The `v1.5.65` and `v1.5.67` tags are local only (pushing them
  was not asked for). Open question: should the iPad inspector's Foli AI tab get back the web panel's ready-made
  actions (Summarize, Continue...) next to the Ask chat?
  Owner's calls from the 2026-11-23 HIG audit: Foli AI is a tab that opens a sheet (the HIG says tabs navigate,
  never act); section headings stay sentence case (Apple uses title case); dark mode keeps a pure black frame.
  Known gaps: the notifications sheet's rows are not on cards yet; screens borrowed from the iPad (Foli DNA,
  Reviews) keep their own white page under the system bar.
- Folevi for Windows and Linux (`claude/desktop-tauri`, Tauri): the owner tries the CI test builds (checklist in
  `docs/DESKTOP_APP.md`); the Web session adds Windows to folevi.com's download page (stable links above) and the main
  session records 1.5.73; when PR 65's turn comes (after PR 66), merge main and, if the Mac PR merged first,
  combine the two 1.5.73 CHANGELOG entries into one (version.json stays 1.5.73 / 88); fix what testers find; open the Tauri PR into `main` (supersedes PR 58, which the main session
  closes); then, each with the owner's OK: an update signing key (turns the updater on), Windows signing, uploads to
  R2, a download page entry, Flathub (manifest ready), Dropbox/Google Drive sign-in on this platform, a `windows`
  and `linux` minimum in `convex/lib/shellVersions.ts`. Mac keeps its own app (no Mac target here).
- Web everywhere: PRs #61 (platform model, `claude/web-everywhere-0e2975`), #62 (shortcut labels), #63 (Mac no-bounce,
  Android ripple) and #64 (one wording set) are open and wait on CI and the owner's merge (merging deploys). Next PRs: shortcut labels per OS (about 40 files still write ⌘ by hand; `lib/shortcuts.ts keyLabel` exists),
  Windows/Linux/Android accents behind `data-shell`, one motion/empty/loading style, mobile web view performance,
  the "Your own server" sign-in with the Synology session. The starter "Welcome to Folevi" note names Mac shortcuts.
- Folevi Server (`docs/SELF_HOSTING_PLAN.md` v2, `docs/self-hosting/CONTRACT.md`): built on branch
  `claude/sleepy-goodall-3cg4e7` (backend server edition, web server edition with setup and admin panel, `folevid`
  in `server/`, Folevi Connect in `services/connect/`, every package in `packaging/`, Mac/iOS server places, the
  folevi.com/server download page). Owner approved (2026-11-25) merging to main after CI passes and uploading
  packages to R2 (`folevi-updates`, `server/<version>/` and `server/latest.json`): Linux/container after the full
  server run passes, each NAS package after its first real install (Synology on the owner's DS223). Open: the
  Mac/iOS build check on the owner's Mac; Connect deploy (Fly.io, folevi.app DNS on Cloudflare, keys); store
  developer accounts; Convex license confirmation; real icons; email-to-note on servers; guests' limits; owner
  Google keys and covers on servers; dialog closing on resize in the admin panel; invite tokens in `next dev` logs.
- Folevi Server: DS223 install of the ARM64 `.spk` (owner gives SSH user and address), memory on 2 GB (the backend
  reached 1.9 GB RSS after seeding 5,000 notes on an 8 GB VM), Connect on Fly.io (owner's OK per deploy; Cloudflare
  DNS token for folevi.app; `connect.folevi.com` records at folevi.com's DNS), then each app session adds server
  sign-in to its shell (Mac, iPhone/iPad, Android, Windows, Linux). minAppVersion is 1.6.0.
- Folevi Server on the Mac, still to do with the owner: one run of the real sign-in sheet against the test server in
  a 1.6.0 Debug build on scratch data (GUI, needs the owner's OK), and a check with the real bundled export that a server place's data loads over
  `http://localhost:8460/convex` (the header policy and mixed content are covered; the export's own meta CSP must
  also allow `http:`/`ws:`). Optional: `places.scanCode()` on Macs with a camera (left out for now). Possible
  hardening: the Mac's Keychain items use the login keychain, which keeps no "this device only" class; moving
  them to the data protection keychain needs a migration of existing items.
- Backend performance pass, owner's OK needed for production: run `migrations:backfillListStats` (optional, speeds
  up existing folders) and `migrations:backfillDocumentText` (required before the note text switch PR merges).
- Backend performance pass, production: `migrations:backfillDocumentText` ran on 2026-11-25 (373 notes copied, 0
  failed). Next, with the owner's OK: merge #93 (the note text switch), let it deploy, then run
  `npx convex run --prod migrations:narrowDocumentText` from the main checkout. Optional at any time:
  `migrations:backfillListStats` (speeds up existing folders).
- Backend performance pass (`docs/perf/backend-results.md`): kept folder and Drafts counts, task rows that carry
  their note's title, a cheaper `changes.list`, then note text (`searchText`) split out of `documents`
  (widen, backfill, narrow; the owner approves each production backfill).
- Web everywhere (all landed 2026-11-25). Open: the iOS simulator `footprint` re-run of the iPhone memory fix (mobile
  session); there are four empty-state components; lists not yet given `LoadFailed` still load until a retry answers
  (settings lists, Calendar, Graph, pickers);
  splitting the phone interface out of every page's bundle (measure with a production build first); "Your own server"
  sign-in for the apps, planned in the shared notes (`web-everywhere-own-server-plan.md`), after the Synology branch
  lands; the starter "Welcome to Folevi" note names Mac shortcuts. Known failing e2e on `main` (not from this work):
  `iphone-local-settings` switch size, `local-mode` Insert panel, `iphone-chrome` theme bar colour (PR 77 fixes the
  three specs) and `multi-select-local` rubber band (fixed on `claude/project-thread-8numex`).
- Dependencies (2026-11-25 triage): tiptap 3.32 breaks the Markdown list shortcuts ("1. " and "- " stay text;
  `editor-core-edges` and `editor-core-keys` unit tests), so tiptap stays on 3.31.3 until that is understood; bump all
  four `@tiptap/*` together. @types/node stays on 24 to match `.nvmrc` (Dependabot now skips its majors). TypeScript 7
  (Dependabot PR 22, `apps/ios` only) waits for a whole-repo move. The Actions majors (checkout, setup-node,
  upload-artifact v7, pnpm/action-setup v6) are open as Dependabot PRs 19, 20, 21, 27: take them together, since runners
  already force the v4 actions onto Node 24.
- Folevi for Mac on the web view: 1.5.73 is live. PR 67 (`claude/mac-webview`) merges after PR 60. Watch for reports
  of signed-in Macs stuck on loading after updating (no signed-in Release run was observed); the fix path is
  `AppScheme.modeOf` / WebViewFactory. Push the `v1.5.69` to `v1.5.73` and `archive/mac-swiftui` tags if the owner asks. Ask the web session (through the main session) for the Mac's no-bounce motion when
  `inMacApp()`.
- Folevi for Mac 1.5.71 is live. Its PR 60 (`claude/mac-app-d228e2` into `main`, main at bda71bcd merged in) is merged by the main
  session when CI is green. Push the `v1.5.69` to `v1.5.71` tags only if the owner asks. Watch for reports of signed-in Macs
  stuck on loading after updating (see section 9).
- iPhone Duo: PR 55 (https://github.com/faisalibnislam/folevi/pull/55, `claude/iphone-duo-native-ipad` into
- Android native: PR 54 merged into `main` on 2026-11-24 (289b11af), after PR 51 as the owner asked. Native Android is paused (owner, 2026-11-24: one web app everywhere): no Play releases, no new Compose UI.
- Android tabs and polish (`claude/android-tabs`, PR 57 https://github.com/faisalibnislam/folevi/pull/57): web-style tabs on large screens and the
  android-skills audit fixes (`docs/ANDROID_POLISH_2026-11-24.md`). The owner reviews and merges. Its "Not done
  yet" list is the next Android work. Then the owner's Play steps (`apps/android/README.md` "Steps only the owner can do").
- Google Play (2026-11-24): app **Folevi** (`com.folevi.android`) in the Airly.io Play Console account. Internal
  testing is live with release 83 (1.5.68, built from `claude/android-tabs`), tester list "Involets testers"; join link
  https://play.google.com/apps/internaltest/4701659242250904528. Testers see the temporary name "com.folevi.android
  (unreviewed)" until the store listing and app content are done. Next uploads need a higher `build` in `version.json`;
  bundles over 10 MB must be dragged in by the owner (the browser tools can't attach them). No native debug symbols yet.
- iPhone Duo: PR 55 merged into `main` (3fd6cf52); it was PR 55 (https://github.com/faisalibnislam/folevi/pull/55, `claude/iphone-duo-native-ipad` into
  `main`, retargeted after PR 56 merged), replacing PR 53 (closed). 1.5.69 (build 84) from this branch is on TestFlight
  (owner's OK; the branch has 1.5.68's release line merged in). The owner tries it on TestFlight. PR 51 is in main;
  PR 56 (the iPad redesign) is merged into main (546f6aa4); PR 55 now targets main and is merged when its CI is green. Not checked: Split View
  halves, a real device. Next free version: 1.5.70.
- iPhone and iPad redesign (`claude/ios-native-redesign-f4a8be`): PR 56 merged into `main` (546f6aa4);
  the owner tries 1.5.67 from TestFlight. The `v1.5.65` and `v1.5.67` tags are local only (pushing them
  was not asked for). Open question: should the iPad inspector's Foli AI tab get back the web panel's ready-made
  actions (Summarize, Continue...) next to the Ask chat?
  Owner's calls from the 2026-11-23 HIG audit: Foli AI is a tab that opens a sheet (the HIG says tabs navigate,
  never act); section headings stay sentence case (Apple uses title case); dark mode keeps a pure black frame.
  Known gaps: the notifications sheet's rows are not on cards yet; screens borrowed from the iPad (Foli DNA,
  Reviews) keep their own white page under the system bar.
- Android **89 (1.5.74) is live on Play internal testing** (published 2026-11-24 21:51, owner: "release everything
  when ready"), replacing 87. Built from `b5b4b4a3` (this branch with the mobile release `e86fbbca` merged), upload
  key, Firebase push on; on an emulator it updated over the signed 1.5.72 release keeping the library. Testers
  update and report; the next Android upload needs a `build` above 89. Native debug symbols could go up later.
- Android as Capacitor (`claude/android-capacitor-197cf4`, `apps/mobile/android`, with the iOS session's
  `claude/mobile-capacitor-f41734` merged in): open a PR with the owner's OK; it and the iOS branch should land
  together (or this one alone, since it contains the other). Web session: "This Googlebook" device words for Android laptops (FEATURE_PC).
  No Play upload until the owner says so (native releases paused); the upload needs a versionCode above 83.
- Android native (PR 54, merged into `main` as 289b11af): superseded by the Capacitor app above. Its next steps were the owner's Play steps (`apps/android/README.md` "Steps only the owner can do"), and the
  plan's remaining phase 2 items (Credential Manager sign-in, onboarding, sharing sheet, templates).
- Folevi for Mac (native, `apps/mac`, branch `claude/folevi-core-529dbe`), the owner's order of 2026-11-23:
  1. Done 2026-11-23: the owner's Mac UI guide (`docs/design/macloving-mac-ui.md`) as the **full window
     redesign**:
     - hidden title bar
     - an always-visible sidebar (still a List)
     - an opaque rounded content card whose glass top bar is drawn from each screen's `.screenActions` /
       `.screenSearch` / `.screenSubtitle` (`Folevi/Views/Common/ScreenBar.swift`)
     - a flat rounded inspector panel and capsule choices
     - Folevi's ink kept
     - native window tabs kept (the content starts below macOS's tab bar when shown)

     The iPad already had this profile; its card margin is now 12 pt. Not yet looked at on the iPad itself; its
     layout tests pass.

     Superseded the same day: the owner set the guide aside and the window is now native (see "The window" in
     Current state; commit 4a2f2031).

     Then a HIG and Liquid Glass pass (2026-11-23, the owner's "/apple-hig /liquid-glass /liquid-glass-motion
     /axiom:axiom-design" ask): content scrolls under the glass bar (a `safeAreaBar` placeholder, with a soft fade
     drawn behind the bar because macOS draws its own scroll edge effect only under system toolbars); split screens
     (`Destination.isSplit`: Foli AI, Calendar, Vault) start below the bar since AppKit's split view drops SwiftUI's
     safe area; the tab bar state is re-read when a window's tab group changes (restored tabs had left content under
     the tab bar). Left for the owner: the HIG asks for a way to hide the sidebar, but the owner's rule is an
     always-visible sidebar, so none was added. Running `xcodebuild test` into `build/dd` relinks the Debug app with
     the engine twice and it no longer starts: delete `build/dd/Build/Products/Debug/Folevi Dev.app` and run
     `build.mjs` again.
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
  against the app:// page's content security rules before a real-account test. `app.mjs cmd fakegate` shows a
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
4. Failed queries retry instead of reaching `app/global-error.tsx` (open PR from `claude/project-thread-u99yc5`); after it
   merges, give `LoadFailed` to the lists that don't have it yet, and check the e2e shard 8 timeout flake (Gotchas).
5. Paused work (Chrome extension) and `pricing-decisions`: only when the owner asks.
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

## 12. Change log
- 2026-11-25: **Background sync in Folevi for Windows and Linux** (branch `claude/desktop-background-sync`, item 4 of
  docs/DESKTOP_PARITY.md): hidden runner windows for places not on screen, woken and closed by the Mac's
  BackgroundSync plan, and a native unread count per background account. Rust tests pass (152). Not run end to end
  (needs two signed-in accounts on a test machine).
- 2026-11-25: **1.6.78 released** from PR 109's merge (`e0183862`): web and Convex deployed; Mac published
  (notarized, Sparkle feed); iPhone and iPad on TestFlight (delivery 7120ad6e); Windows installers and Linux packages
  uploaded, apt and rpm repositories rebuilt and uploaded; the Android bundle built and left for the owner's Play
  drag-in. CI needed two more fixes before the merge (dialog closing fade, swipe rows) and one re-run of a flaky
  shard (`tab-switch.spec.ts` timed out once, passed on the re-run). Dependabot PRs 19, 20, 21 and 27 were asked to
  rebase with auto-merge on.
- 2026-11-25: **Integration branch `claude/integration-2026-11-25`** (the owner: "check and resolve [the merging issues]
  and release all apps and platforms, I approve everything"). The backlog could not drain PR by PR: every PR edits
  this file, so each merge made the others conflict and restart CI, and the PRs also conflicted in code. PRs 104, 96,
  92, 89, 78, 97, 98, 81, 82, 69 (with 66), 83, 65, 99, 107, 100, 105, 103, 106 and 93 are merged here once, with one
  CI run and one production deploy. Resolutions worth knowing:
  - Foli AI: Folevi Cloud keeps PR 81's per-feature routes and native adapters (`convex/lib/ai/openai.ts`); a Folevi
    Server takes its provider from the server's settings (`provider()` in `convex/lib/ai/provider.ts`), and its
    OpenAI-compatible adapter moved to `convex/lib/ai/openaiCompatible.ts`. `aiConfig.ts` route readers answer from
    `serverRoute` on a server.
  - PRs 100 and 107 were two copies of the server work: merged file by file from the 107 commit each PR 100 file was
    copied from. `convex/auth.config.ts` is main's (107's fix); the server bundle has its own.
  - Folevi Server's repo scripts are `packaging/linux/repo/build-server-apt-repo.sh` and `build-server-rpm-repo.sh`;
    `build-apt-repo.sh` and `build-rpm-repo.sh` are the Linux desktop app's (PR 99).
  - `build-shell.mjs` takes `--platform mobile` and `--platform windows`. Version files follow PR 83 (1.5.78, build 101).
  - Dialog and command palette: the keyboard leaves first (PR 83), then the 150 ms fade (PR 82).
  - The Downloads and Apps pages' pills use `rounded-control` (the corner test refuses `rounded-full`).
  - Auto-merge was turned off on those PRs; they close as merged when this lands.
  - Found by building the apps and by CI's e2e run, and fixed on this branch: PRs 66, 69 and 83 carried the
    SwiftUI-era `apps/mac/project.yml` (the Mac app did not build; main's file is back, with `ShellServer.swift`);
    PR 82's 150 ms closing fade left the page inert, so typing right after a dialog closed was lost
    (`ui/closing.ts` now closes the dialog first and fades its picture as an inert manual popover); PR 83's
    pointer-event swipe rows stayed open after a quick tap elsewhere in Chromium on Linux (they also close on a
    touch `pointerdown` outside the list).
  - Released from this branch as **1.6.78** (build 102), a Big update cut with `scripts/version.mjs release update`
    (the owner asked for 1.6.0; a Big update keeps the patch number, and 1.6.78 meets Folevi Server's
    `minAppVersion` 1.6.0).
- 2026-11-25: CI secret scan reads only the history HEAD reaches (`--log-opts=HEAD`, owner's OK), not every fetched
  branch: test tokens on unmerged branches (Folevi Server, Linux stores) had failed the required check on every PR.
- 2026-11-25: Notes say Android is active (the Capacitor app, PR 69, Play internal testing); only the native Compose
  app is paused. An Android SDK is installed at `~/Library/Android/sdk` (not on PATH), so Android builds can run on
  this Mac.
- 2026-11-25: Performance pass, Android and Windows/Linux shells (`docs/perf/android-windows-results.md`). PRs into
  each shell's branch: #86 Android (Firebase and legacy session off the main thread, one resize per keyboard slide,
  a new Android CI workflow), #84 Tauri (library and reminders open after the window, lighter asset serving and
  scans, launch time in `measure.mjs`), #85 Electron (Quick Add on first use, runners on demand, throttling back
  on). Electron uses about 28% less memory on Windows x64 (CI). Android not measured (no SDK).
- 2026-11-25: Apple shells performance pass (`docs/perf/apple-results.md`). Mac: rules lookup in parallel with the
  library, runners after the first page, private throttling switches for runners only, Keychain off the main thread,
  bridge script cached (2.3 to 0.68 ms per view), test host never activates, `PerfTests`, perf scripts for the web-view
  app, `calendarDays` build fix. iOS (`claude/perf-ios-3eaf61`): Keychain off the main thread. Measured: note-page
  memory flat after warm-up (162 MB Home, about 223 MB after 60 opens, 190 MB under memory pressure). Mac tests: 117
  of 119 pass (the Vision OCR test timed out under load, passes alone). The launch run found and fixed a crash (WebKit's
  default rule store first touched off the main thread through an `async let` default argument).
- 2026-11-25: New Downloads page (`/downloads`, owner's request): every download in one list (Mac, Windows x64 and
  arm64, the six Linux packages and checksums, App Store, Android coming soon, web), in the site nav after Apps and
  in the sitemap. The page is `/downloads` because `/download/*` is rewritten to the R2 download bucket.
- 2026-11-25: Apps page (`/apps`): an Android card, "coming soon to Google Play" with the web app meanwhile (owner's
  choice while Play is internal testing only). Mac, Windows and Linux download links checked (all 200).
- 2026-11-25: Foli AI providers branch: main merged in again (backend performance pass); `convex/aiConfig.ts` now
  builds its mutations from `lib/functions.ts` like every other mutation.
- 2026-11-25: Foli AI on OpenAI and Anthropic too (`claude/foli-ai-openai-anthropic-8112bb`): Admin > Foli AI with
  sealed keys, a provider per feature and Fast/Main/Heavy models; OpenAI (Responses API) and Anthropic (Messages
  API) adapters through their SDKs with native streaming, tools, JSON, web search and prompt caching; credits priced
  per provider; "cheap first" defaults (Gemini Main is now Flash-Lite). 19 new tests; 4 existing tests updated for
  the new default (3 metering tests pin Main to Flash).
- 2026-11-25: Interface-polish pass on the whole web UI (review by typography, surfaces and motion; owner chose to fix
  every MEDIUM and LOW finding): see the commit "Interface polish pass". Checked: typecheck, lint, full unit suite,
  WebKit harness (dialog, command palette and Show all tabs fade out; Mac fades only), screenshots.
- 2026-11-25: Mac feedback: Home's card rows no longer block page scrolling in the Mac app (overscroll held per axis);
  folders 35% less round (`folder` radius token, 9); Show all tabs redesigned (cards of what each tab holds, below
  the top bar, names under cards, on iPad too). How scrolling was checked: a Swift harness puts a WKWebView in an
  offscreen window and calls `scrollWheel(with:)` with CGEvent-made wheel events (location = window coordinates,
  since the event has no window); Playwright's wheel bypasses macOS's scrolling path and can't show this bug.
- 2026-11-25: Android own server, part 2 (PR 103): merged PR 100's a800051c (the sign-in names the server, the
  version check uses the app's version, `places.scanCode`). Added `scanCode` with Google's code scanner
  (`play-services-code-scanner`, no camera permission; the module is installed on first use), only on devices with
  a camera. Emulator: the server's sign-in screen says "Sign in with your account on localhost:8460" with one Sign in
  button; the scanner opens and closing it answers null (Play services reports Back as error 13 there). Reading a
  real QR code wasn't tested (the emulator's camera shows a virtual scene).
- 2026-11-25: Android "Your own server" (Folevi Server places, CONTRACT §6.1) on `claude/android-own-server`, built on
  PR 69 with PR 100 (`claude/server-apps-base`) merged in: `server/ShellServer.kt` (address rules, folevi.json
  check, CSP, the Kotlin twin of ShellServer.swift), `server/LocalServers.kt` (NsdManager `_folevi._tcp`), Places
  accounts carry `server`, AuthBridge sends each account's calls to its own website, `places.server`,
  `addServerPlace`, `listLocalServers` in the bridge, the best connection through connection.ts bundled as
  `assets/folevi-server.js`, per-place CSP header, mixed content only for http server places and sign-in pages,
  cleartext allowed in network_security_config but enforced to home addresses by `net/Http.kt`. Server accounts
  are left out of the share sheet, Quick Add and the outbox (Folevi Cloud's REST API only). 46 unit tests pass
  (8 new). On the emulator against the test server (`adb reverse tcp:8460`; its folevi.json says
  `http://localhost:8460`, so 10.0.2.2 doesn't work): add, refusals, reload bound to the server, CSP and the
  own-server lookup UI checked; sign-in not completed (no test password used). No QR scan: the contract has no
  bridge call for it.
- 2026-11-25: CI secret scan fix for PR 69: gitleaks scans every branch (`git log --all`), so false positives on
  `claude/sleepy-goodall-3cg4e7` (the certificate key type line in folevid's `acme.go`, and made-up tokens in three
  folevid and Connect tests) failed the check on every PR. Their fingerprints are now in `.gitleaksignore`. New test
  values on any branch should carry a `gitleaks:allow` comment, or every open PR fails again.
- 2026-11-25: PR 69 checked on this Mac (Android session): the Android SDK is at `~/Library/Android/sdk` (set
  `ANDROID_HOME`, put `platform-tools` and `emulator` on PATH; JDK is Homebrew `openjdk`). `apps/android` compiles
  (`:app:compileDebugKotlin`, so `CALENDAR_DAYS` is fine); `apps/mobile/android` `:app:assembleDebug` builds and
  `:app:testDebugUnitTest` passes (38 tests, 11 suites). Fixed `pnpm sync` in `apps/mobile`: it ran
  `scripts/prepare-web.mjs`, which never existed (build-shell `--dest ../mobile/web` already copies the export).
  Emulator not run: both installed system images (android-36, android-37.0 google_apis_playstore arm64) are only
  the kernel, without `system.img`; re-downloading android-37.0 is about 2.0 GB and waits for the owner's OK.
- 2026-11-25: Owner OK'd the image download: `system-images;android-37.0;google_apis_playstore;arm64-v8a` reinstalled
  (about 2 GB). PR 69's debug APK installed on `Folevi_Phone` (headless, read-only, 37.0 image, port 5560): MainActivity
  resumed in 2.5 s, no crash, the first-launch screen ("Where should your notes live?") renders.
- 2026-11-25: PR 69 build fix: `Routes.kt:61` and `Tabs.kt:88` used `WebIcon.CALENDAR`, which the icon regeneration
  (c3ce5640) removed; both now use `WebIcon.CALENDAR_DAYS` (owner's pick, matching the web's command palette). Not
  compiled locally (no Android SDK on this Mac).
- 2026-11-25: Merged `main` (e35a97d3, the backend performance pass and the sync status words) into
  `claude/android-capacitor-197cf4` for PR 69 (owner's OK); only HANDOFF.md conflicted, both sides kept.
- 2026-11-25: Merged `main` (4d22880f, the web PRs) into `claude/android-capacitor-197cf4` for PR 69: versions stay 1.5.74 / 89; the web layout files take main's width-decides version (formFactor).
- 2026-11-25: Android polish pass: web side on `claude/ios-feedback-b1307a` (3c8fb728, keyboard bar fix), native side in PR 108 on PR 69's branch; measured on the phone emulator; no Play upload.
- 2026-11-25: iPhone/iPad "Your own server" in the Capacitor app (`claude/ios-server-signin`, PR 106): VisionKit QR
  scan as `places.scanCode`, server places wired into the mobile host, Keychain test for server tokens, Info.plist
  local network keys; PR 100's web sign-in and scan button taken over this branch's; with an account open, adding a
  server no longer reopens that account instead of the server's sign-in (startPlaces skips a pending sign-in, mobile
  and apps/ios hosts). Swift 86/86 (5 ServerTests).
- 2026-11-25: Folevi Server, app side split onto `main` (`claude/server-apps-base`): web server edition, admin panel,
  Your own server sign-in, Connect pages, backend server edition, Mac/iOS server places, best-connection module; server
  functions registered for E2EE routing and local mode; server fallback origin is 127.0.0.1 so shell exports pass.
- 2026-11-25: iOS feedback session: PRs 66, 79 and 80 merged into `claude/ios-feedback-b1307a`; widgets, Shortcuts, Spotlight in the Capacitor app; Duo fold marks; phone sync sheet redesigned; starter note wording; 1.5.78 (build 93) cut for TestFlight.
- 2026-11-25: `main` (4d22880f, all web PRs) merged into `claude/mobile-capacitor-f41734` for PR 66: `lib/iphone.ts`, NotificationsButton and DocumentView taken from `main` (PR 61's width rule, `lib/platform.ts`, replaces this branch's iPhone Duo 600 x 600 rule; `test/mobile-layout.test.ts` removed, `test/platform.test.ts` covers it); HANDOFF both sides kept. Checks: typecheck, lint, all 2,161 web tests, version check and the iOS build pass. 1.5.76 unchanged.
- 2026-11-25: 1.5.76 (build 91) with PR 74's iPhone memory fix uploaded to TestFlight (delivery bc805158); `main` (85574054) merged into `claude/mobile-capacitor-f41734`.
- 2026-11-24: PR 74 plus 1.5.75's change measured: 140 MB after the low-memory signal against a 130 MB start, the same as PR 74 alone; nothing left of the memory growth. 1.5.75 is one shared release with Linux (published untagged by the Linux session first): when PR 66 merges, combine the Linux notes into the 1.5.75 changelog entry. Next free version 1.5.76.
- 2026-11-24: PR 74's fix for the iPhone note memory growth measured on the simulator: after 20 opens and WebKit's low-memory signal, 138 MB against a 136 MB start (before: 232 to 241 MB). Goes into the next TestFlight build once PR 74 merges; when merging main here, keep PR 74's `transitions.ts` (my 1.5.75 change is superseded).
- 2026-11-24: Memory growth traced further: about 60% is the screen copy shown during iPhone moves (kept by WebKit after removal), the rest elsewhere in the iPhone layout; emptying the copy recovers a third of it, shipped as 1.5.75 (build 90) to TestFlight (delivery 13e2530f). A Safari heap snapshot is still needed for the rest.
- 2026-11-24: Mobile memory growth narrowed (docs/mobile/ios-review-2026-11-24.md follow-up): only in the iPhone layout under WebKit, about 5 MB kept per note open; not the bridge, logging, close path or WebKit caches; none on iPad. Needs a Safari Web Inspector heap snapshot next.
- 2026-11-24: 1.5.74 (build 89), the mobile app with the iOS review's fixes, uploaded to TestFlight with the owner's OK (delivery 9fe1d590); tag local.
- 2026-11-24: iOS review of the mobile app (design/HIG, polish, performance; docs/mobile/ios-review-2026-11-24.md): 44 pt hit areas for Calendar's grabber, a note's place chip and Foli AI's Add; local mode's network rules now apply from the first request and compile once. Open for the web session: iPad touch targets under 44 pt and about 4 MB of web memory kept per note open and close.
- 2026-11-24: 1.5.72 (build 87), the Capacitor mobile app, uploaded to TestFlight with the owner's OK (delivery 58636ca8); internal testing only.
- 2026-11-24: Owner: local mode may check Folevi for new note styles. iOS local-mode rules allow only `<deployment>.convex.site/note-styles` and Convex storage images (checked on the simulator: everything else still blocked); features and docs pages say notes never leave the device and the app only checks for new styles.
- 2026-11-24: 1.5.72 (build 87) cut on `claude/mobile-capacitor-f41734` (tag local) for the Capacitor mobile app; iOS IPA exported, TestFlight upload pending a permission; Android build handed to the Android session. PR 66: main merged again; its one failing e2e (vault-team) had passed on the same code the run before.
- 2026-11-24: Owner: keep note covers inside the mobile app and sync note styles when the server changes them. Plan in docs/MOBILE.md; local mode's part asked of the owner.
- 2026-11-24: PR 66 opened for the Capacitor mobile app (`claude/mobile-capacitor-f41734` pushed); open question to the owner: note covers.
- 2026-11-24: `apps/mobile`: one Capacitor app for iPhone, iPad, iPhone Duo and Android around the web app (no native screens), reusing the shared Swift and Kotlin services; window-size layouts in `lib/iphone.ts`; `version.mjs` covers it; checked on simulators and emulators, size and memory compared (docs/MOBILE.md). Branch `claude/mobile-capacitor-f41734`, PR not merged.
- 2026-11-25: Linux icons: every package now uses the desktop icon (`apps/desktop/build/icon-1024.png`, sizes from `icons.mjs`) instead of the web's full-bleed icon-512; Snap `folevi` registered, shipped without the D-Bus slot (owner's pick) so it needs no manual review; arm64 revision 3 uploaded, amd64 building on Launchpad.
- 2026-11-25: Linux apt/rpm repositories published (owner's OK, after the owner's Cloudflare sign-in) and install-tested from the live addresses; Flathub stopped by Flathub's Generative AI policy (no AI-written manifests or AI-opened submissions), recorded in docs/LINUX.md.
- 2026-11-25: Linux stores prepared (owner's OK): signed apt and rpm repositories for 1.5.75 at
  `folevi.com/download/linux/apt` and `/rpm` (built and install-tested in the VM on Ubuntu 24.04, Debian 12, Fedora 41,
  openSUSE Tumbleweed; upload waits on a Cloudflare sign-in), new signing key AEF1 4472 8549 A0B5 9ADC 3A77 67F3 C502
  BF6A 5D42, the .deb and .rpm add the repositories on install from the next release; Flathub manifest on the
  published 1.5.75 .debs, lint clean except screenshots not yet online, real-app screenshots in
  `packaging/linux/screenshots/`; snap built for arm64 and run in the VM (first-launch screen, single instance via
  `com.folevi.Folevi.SingleInstance`).
- 2026-11-25: Windows session: PR 84 (Tauri perf: library opens after the window, lighter asset serving and scans) merged into `claude/desktop-tauri`, then `main` (e35a97d3, backend perf PRs 87, 88, 91 and the safe-queries work) merged in for PR 65; HANDOFF.md conflicts only, both sides kept. version.json stays 1.5.77 / 92 (1.5.77 not published; folevi.com still serves Windows 1.5.73).
- 2026-11-25: PR 73: merged `claude/desktop-tauri` (Windows 1.5.77, main 1a1ca06f); `apps/desktop/RELEASE_VERSION` removed (version.json is 1.5.77), so the next Linux build is 1.5.77 or later unless stamped. CHANGELOG now has iOS's 1.5.75 entry; Linux joins it at the sync after PR 65.
- 2026-11-25: PR 73: merged `claude/desktop-tauri` (now carrying main 4d22880f, the web PRs); HANDOFF conflict only. The web download page's Linux links (apps/web/src/components/marketing/site.ts) match the uploaded latest names.
- 2026-11-25: Main session: PR 73 merges last (after PR 65); its 1.5.75 changelog lines join iOS's 1.5.75 entry at the sync with main (proposed text in Next steps). PR 73 e2e shard 7 (tab-switch.spec) failed twice, then passed on rerun (flaky; the branch changes no web code); all PR 73 checks green. Merge order (main session): 66, 69, 65, then 73.
- 2026-11-24: PR 73: merged `claude/desktop-tauri` again (HANDOFF conflict only); Flatpak CI chose the sandboxed builder on Ubuntu 24.04 (flatpak-builder 1.4.2) and it couldn't find the SDK; the version check in `flatpak-bundle.sh` now parses robustly and logs what it found.
- 2026-11-24: PR 73 conflict (HANDOFF only) resolved by merging `claude/desktop-tauri` (interface installed as files, 6269a7ff; ready marker for measurements). On Linux in the VM: .deb puts the interface at /usr/lib/Folevi/web, the Flatpak at /app/lib/Folevi/web, AppImage inside; all three open; memory 355 MB PSS (main 101).
- 2026-11-24: First Flatpak: ARM bundle from the 1.5.75 .deb built in the VM, installed system-wide and opens to the first-launch screen (tray library loads); copy in `~/Downloads/Folevi for Linux 1.5.75 test/`. Not on Flathub or folevi.com. AppStream release set to 1.5.75.
- 2026-11-24: Flatpak in the VM: the inlined tray modules and the Folevi module build; Ubuntu 22.04's flatpak-builder 1.2 then fails on appstream-compose (gone from GNOME 51), so `flatpak-bundle.sh` uses Flathub's org.flatpak.Builder below 1.3.
- 2026-11-24: `install-build-deps.sh --test-tools` adds elfutils (flatpak-builder needs eu-strip).
- 2026-11-24: PR 73 CI: both Flatpak jobs failed (Flathub's shared tray module puts ayatana-ido in /app/lib64 with the GNOME 51 SDK); the tray modules are now inlined in `packaging/linux/flatpak/com.folevi.Folevi.yml` with `-DCMAKE_INSTALL_LIBDIR=lib` and their patches.
- 2026-11-24: Windows session takes on the web-export-as-files memory idea for Windows and Linux; Linux merges it when it lands and re-measures.
- 2026-11-24: Linux memory measured in the VM (docs/LINUX.md "Memory"): 1.5.75 as published 446 MB PSS; with the merged Quick Add-on-first-use change (e75ac156) 369 MB (Electron on CI: 348). Folevi's own process: 27 MB program file (web export compiled in), 23 MB software renderer (no GPU). Merged `claude/desktop-tauri` (e75ac156, d5283c55) into PR 73.
- 2026-11-24: 1.5.75 is one shared release: Linux downloads and the iPhone/iPad TestFlight build (mobile session tagged v1.5.75); the Linux files keep their names. Next version on any platform: 1.5.76 or later, check the tags first.
- 2026-11-24: PR 73 CI: gitleaks flagged the made-up Vault demo login in apps/mac/scripts/screens.mjs (from the Mac web-view work); added main's same `.gitleaksignore` entry.
- 2026-11-24: PR 73 opened (owner's OK): `claude/linux-tauri-02790e` into `claude/desktop-tauri`, after merging its two newest commits (the cherry-picked blank-window fix, smoke.mjs `--embedded`); the `--embedded` smoke walk passes 7/7 on Linux.
- 2026-11-24: Folevi for Linux 1.5.75 published (owner's OK in chat): 14 files at R2 `folevi-updates/linux/` (versioned AppImage, .deb, .rpm for x86_64 and aarch64, SHA256SUMS-1.5.75.txt, and no-cache latest names), all checked live (sizes, types, a downloaded .deb's checksum). 144 Rust tests pass on the merged code.
- 2026-11-24: Linux 1.5.75 built (AppImage, .deb, .rpm for x86_64 and aarch64) and smoke-tested in the VM: installed .deb and AppImage of both architectures render the first-launch screen (x86_64 through Rosetta); test copies in `~/Downloads/Folevi for Linux 1.5.75 test/`; upload next.
- 2026-11-24: Linux release 1.5.75 under way (owner in chat: upload the Linux builds now; Flathub, Snap, apt/dnf still need an OK): merged the latest `claude/desktop-tauri` (Windows 1.5.73 recorded), `apps/desktop/RELEASE_VERSION` = 1.5.75, `packaging/linux/scripts/upload-release.sh` added; building in the VM, upload to `folevi.com/download/linux/` after the smoke tests.
- 2026-11-24: Desktop app fix found on Linux: release builds showed a blank window because a built-in page was served under the asked-for name ("documents" as application/octet-stream, no boot script); `asset()` in lib.rs now takes exact names only. Likely affects Windows release builds too (told the Windows session). On Linux: release renders from its built-in files, 144 Rust tests and all 7 smoke-walk checks pass; AppImage, .deb, .rpm built for aarch64 and x86_64 with `build-in-lima.sh`.
- 2026-11-24: Linux on the shared shell: merged `claude/desktop-tauri` (ed8a4c17) into `claude/linux-tauri-02790e`; added `apps/desktop/src-tauri/src/linux.rs` with cfg(linux) hooks, the Linux dialog/portal dependencies, `tauri.linux.conf.json`; one Flatpak manifest (`packaging/linux/flatpak`, GNOME 51, tray module) replaced `apps/desktop/flatpak`; `desktop.yml` builds Flatpaks for both architectures. Linux compile and tests running in the VM.
- 2026-11-24: The merged shell compiles on Linux (Ubuntu 22.04 arm64 VM) and 143 of 144 Rust tests pass, the new Linux ones included; `reminders::survive_a_restart_and_late_ones_show_within_a_day` failed once under heavy load and passes 3 of 3 alone (timing). `build-in-lima.sh` now also copies the iOS shell-bridge.js and the local-store fixtures and keeps macOS `._` files out.
- 2026-11-24: Linux probe (a small Tauri app with `linux.rs`, scratch only) passed on X11 in the VM: window renders, tray, notification sent, global shortcut registered, `folevi://new` from a second launch reaches the running app, Secret Service store and read back, desktop dark mode through the portal turns the page dark (WebKitGTK 2.50 does that by itself; the hook keeps GTK's title bar and menus in step). Smoke test fixed (inner part re-invokes the script; test keyring password; portals get the display).
- 2026-11-24: Linux build root fix: the amd64 root is Ubuntu's own 22.04 base image (debootstrap unmounts /proc mid-way and Rosetta can't run x86_64 programs without it); `setup-amd64-root.sh` and `install-build-deps.sh` (no sudo needed as root) updated. The build scripts live in `packaging/linux/scripts/` (the repo's .gitignore drops any `build/` folder, so the first commit missed them).
- 2026-11-24: Folevi for Linux started on `claude/linux-tauri-02790e`: packaging, docs, build scripts and CI workflow committed (34cc11fe); waiting on the shared Tauri shell from `claude/desktop-tauri`.
- 2026-11-25: Merged main (4d22880f, the web PRs incl. the Windows download page, PR 70) into `claude/desktop-tauri` for PR 65; 1.5.73's Mac and Windows changelog entries combined into one release (build 88, tag v1.5.73); web 2,169, Rust 141, bridge 4 tests and the Windows smoke walk pass.
- 2026-11-24: Desktop CI measurements now require the page to have started (the app prints "FOLEVI READY" with FOLEVI_REPORT_READY; measure.mjs --expect-ready fails otherwise). Verified run 45443908032 (every Tauri page started) with both memory changes: Windows x64 151 MB private (375 MB working set) vs Electron's 207 (433), ARM64 149 MB, Linux x86_64 365 vs 349 MB PSS. Not in the published 1.5.73 yet.
- 2026-11-24: Desktop memory work (not in the published 1.5.73 yet): Quick Add's window made on first use (e75ac156; Linux measured 446 -> 369 MB PSS) and the web export installed as files beside the app instead of compiled in (6269a7ff; frontendDist is `apps/desktop/shell-stub`, the pages read from `<resources>/web`); CI run measuring both on Windows pending.
- 2026-11-24: The published Windows 1.5.73 installers opened a blank window (built-in pages served under the asked-for name, so as application/octet-stream without the boot script; the Linux session found it, fix bb9906f0 cherry-picked as c150ba78). Replaced in place with the fixed build from CI run 45418586764 (owner's choice; same names and version; sha256 arm64 4a651ed1..., x64 326d03ba...). Memory corrected: with the page loaded Tauri is about Electron's on Windows (214 vs 207 MB private) and higher on Linux; the earlier "a third lighter" measured the blank page. Quick Add's window is now made on first use. `smoke.mjs --embedded` covers built-in assets.
- 2026-11-24: Release 1.5.73 (build 88) recorded on `claude/desktop-tauri` (untagged: the Mac session's own 1.5.73 on `claude/mac-webview` took tag v1.5.73 three minutes earlier; the main session decided: one release 1.5.73 / build 88 for both, the Mac's tag v1.5.73 (b972616a) stays, no rebuild; whichever of PR 65 and the Mac PR merges second merges main and combines the two CHANGELOG entries into one 1.5.73 entry) with the 1.5.69 to 1.5.72 history from tag v1.5.72; PR 66 (1.5.72) merges first, take the higher version on conflict.
- 2026-11-24: Owner: "release it", on folevi.com: stable latest links live (folevi.com/download/windows/Folevi-arm64-setup.exe and Folevi-x64-setup.exe, no-cache, now 1.5.73); the download page entry (Web session) and the 1.5.73 version record and tag on main (main session) requested.
- 2026-11-24: Folevi for Windows 1.5.73 test download published (owner's OK, after v1.5.72): unsigned NSIS installers at https://folevi.com/download/windows/Folevi_1.5.73_arm64-setup.exe (sha256 72f39313...2f4c) and .../Folevi_1.5.73_x64-setup.exe (sha256 a54b07bf...c241), R2 `folevi-updates` windows/, from CI run 45392111016; no update feed (no signing key); version.json/CHANGELOG/tag for 1.5.73 still to record at merge.
- 2026-11-24: Owner (directly): build Folevi for Windows 1.5.73 test installers now and upload them unsigned to `folevi.com/download/windows/` once tag v1.5.72 exists; `apps/desktop/RELEASE_VERSION` stamps 1.5.73 on this branch (version.json and CHANGELOG still to record it at merge).
- 2026-11-24: PR 65 opened (Tauri desktop app into `main`, supersedes PR 58); merge `main` in when its turn comes (after PRs 55 and 57).
- 2026-11-24: Desktop CI: Windows x64 builds (NSIS 78 MB, MSI 79 MB) and is lighter than Electron (139 vs 204 MB private); Windows etags now use the NTFS file index (concurrent writes lost an update on ARM64); the workflow's binary lookup fixed for Linux.
- 2026-11-24: Folevi desktop moved to Tauri 2 for Windows (ARM64, x64) and Linux (x86_64, aarch64) on `claude/desktop-tauri` (owner: "one web app everywhere", small and light like the Mac app); CI builds and memory measurements; Electron PR 58 superseded, not merged.
- 2026-11-24: Merged `main` (PR 56, iPhone/iPad second round, and the e2e and secret-scan fixes) into `claude/windows-electron-4ed862` to clear PR 58's conflict; only HANDOFF.md conflicted (both sides kept). Owner decided "one web app everywhere": this Electron app becomes the desktop app for Windows, Mac and Linux (Mac and Linux targets wait for the plan).
- 2026-11-24: Folevi for Windows: branch pushed and PR 58 opened into `main` with the owner's OK; not merged.
- 2026-11-24: Folevi for Windows built on `claude/windows-electron-4ed862` (Electron `apps/desktop` revived, Mac parts removed, web `windows` platform); unsigned arm64 and x64 test installers handed to the owner; not merged or published.
- 2026-11-25: Folevi Server built (branch `claude/sleepy-goodall-3cg4e7`): backend and web server editions, setup
  and admin panel walked end to end on a real backend, `folevid` supervisor (encrypted backups, Connect client,
  memory profiles), Folevi Connect service, packages for Synology/QNAP/ASUSTOR/TerraMaster/UGREEN/Unraid/Linux/
  container/TrueNAS/CasaOS/Umbrel, Mac/iOS server places, folevi.com/server. Server domain `folevi.app` (owner
  bought it); owner's test NAS is a DS223 (ARM64, 2 GB).
- 2026-11-25: Self-hosting plan version 2 (`docs/SELF_HOSTING_PLAN.md`): native packages on every NAS that allows
  them, catalog apps on TrueNAS and the container-only systems, native Linux installer for DigitalOcean/Hetzner,
  Folevi Connect for Plex-like access, roles and admin panel, email and other services through optional relays.
- 2026-11-25: the live Bonjour browse (`testAServerAdvertisedOnThisNetworkIsFound`) ran on this Mac with the owner's
  OK and passed: it advertised `_folevi._tcp` and found it with its TXT name, version and url.
- 2026-11-25: Mac sign-in screen may look up any server (`https: http:` in its connect-src, `ShellPolicy.csp`
  `signIn`); `ServerPageTests` (offscreen web view) shows home http servers aren't mixed content on the Mac.
- 2026-11-25: Folevi Server on the Mac: `ServerFlowTests` (end to end against the local test server, Bonjour entries,
  version gate, best connection on a network change, Keychain only); `ServerReach.probe`/`networkChanged()`,
  `LocalServers.entry` (TXT values checked), `ShellAuth.exchange` split out of the sheet; Mac build fixed for the
  regenerated icons (`calendar` is `calendarDays`).
- 2026-11-25: Folevi Server, app side split onto `main` (`claude/server-apps-base`): web server edition, admin panel,
  Your own server sign-in, Connect pages, backend server edition, Mac/iOS server places, best-connection module; server
  functions registered for E2EE routing and local mode; server fallback origin is 127.0.0.1 so shell exports pass.
- 2026-11-25: The owner ran `migrations:backfillDocumentText` on production (373 notes copied, 0 failed); #93 is
  ready to merge, then `migrations:narrowDocumentText`.
- 2026-11-25: Backend performance pass, step 4 (draft PR, waits for the owner and the production backfill): search,
  Foli AI and Spotlight read note text from `documentText`; `documents.searchText` is no longer written, emptied by
  `migrations:narrowDocumentText`, and its search index dropped. Tests read text through `textOf` (tests/convex/helpers.ts).
- 2026-11-25: Backend performance pass, step 3 (widen): `documentText` table holds each note's search text and search
  fields, kept in step by the write hook; `migrations:backfillDocumentText` copies older notes (production run waits
  for the owner). Readers are unchanged until the switch PR.
- 2026-11-25: Backend performance pass, step 2: kept folder and Drafts stats (`listStats`, through the new
  `lib/functions.ts` write hook), task rows with their note's title and icon, `changes.list` reads a note only once it
  has unseen changes, a folder by last edit pages through its index. Numbers in `docs/perf/backend-results.md`.
- 2026-11-25: Backend performance pass, step 1: a generated 5,000-note test library (`convex/devSeed.ts`, test
  accounts only, refused on production), a read-cost harness with Convex's limits on (`tests/convex/perf/`), and the
  baseline in `docs/perf/backend-results.md`.
- 2026-11-25: One set of sync status words on every screen (owner's pick: the desktop's): the phone and iPad's sync
  button (`components/iphone/SyncStatusTouch.tsx`) now reads `SYNC_LABELS` from `components/app/SyncStatus.tsx`
  (Saved, Saving…, Syncing…, Offline, Conflict, Not saved) instead of Synced / Waiting to sync / Edited in two places,
  and its accessible name is the desktop's `sync.button.label` ("Sync status: Offline, 2 changes waiting").
  `offline-notes.spec.ts` follows. Help, docs and marketing already used these words. The paused native apps'
  `SyncStatus.swift` was left as it is. Web unit tests: 2161 pass; e2e not run locally.
- 2026-11-25: PR 79 review fix: a paginated list that failed emptied and swapped "Couldn't load" for the loading
  placeholder on every retry (the retry starts the query over from its first page, and that first load read as
  "ok"). `usePaginatedQuery` now keeps the loaded results and `failed` until the restarted query answers; new
  regression test in `test/safe-queries.test.tsx` (fails on the old hook). Pages loaded with "load more" before the
  failure still go back to the first page once it recovers. Web unit tests: 2167 pass.
- 2026-11-24: Failed queries keep the page: `lib/convex/queries.ts` hooks (retry with backoff, last good result,
  `failed` and `retry()`), used in every component with an eslint rule; `LoadFailed` error state on the main lists;
  local query cache re-runs failed entries; `test/safe-queries.test.tsx`.
- 2026-11-25: Main green pass (`claude/project-thread-8numex`): `multi-select-local` draws its rectangle from under
  Birch (the smaller desktop cards of 2026-11-20 put Alder, Birch and Cedar on one row, so a rectangle from the right of
  Cedar crossed Cedar); `e2ee-approve` waits for the first dialog to close and for the second request's code before
  "They don't match" (failed twice on `main` after PR 76, which changed only docs); safe dependency bumps (katex 0.19.1,
  typescript-eslint 8.72.2, the clipper's @types/chrome 0.3.7 and jsdom 30.1.3, lockfiles regenerated); Dependabot
  groups `@tiptap/*` and skips @types/node majors.
- 2026-11-24: Android 89 (1.5.74) published to Play internal testing (owner dragged the AAB in; Claude added it from the library, notes, published).
- 2026-11-24: Android 1.5.74 (89) built from the merged mobile release for Play internal testing; upload waits on the owner's drag-in.
- 2026-11-24: PR 69 opened for the Android Capacitor app (contains PR 66); mergeable with `main`, not merged.
- 2026-11-24: Merged `main` (PR 60, Mac 1.5.71) into `claude/android-capacitor-197cf4` for its PR: versions stay 1.5.72 / 87, both changelog entries kept.
- 2026-11-24: Android 87 (1.5.72), the Capacitor app, published to Play internal testing with the owner's OK (built from `d2ef501c`, Firebase push on); replaces 83.
- 2026-11-24: Android release prepared for Play internal testing (owner's OK via the main session): dry-run AAB with Firebase push built, signed with build 83's upload key; waiting for the mobile session's 1.5.72 commit.
- 2026-11-24: Merged the iOS session's `claude/mobile-capacitor-f41734` into the Android branch: both had restored the same Capacitor Android app into `apps/mobile/android`; kept this branch's Kotlin and manifest fixes and their shared cloud-kit bundling, R8 rules and bridge additions; `apps/mobile/.gitignore` now ignores only `/web/` (a bare `web/` had hidden the app's `com/folevi/android/web/` Kotlin from their commits).
- 2026-11-24: Android as Capacitor: safe areas reach the WebView, wide-window Back follows the web's tab rule; checked on phone, tablet (signed in), foldable and desktop emulators; size and memory measured against the native app (README). Pushed, no PR.
- 2026-11-24: Android as Capacitor on `claude/android-capacitor-197cf4`: `apps/mobile/android` restored from the paused Capacitor app on Capacitor 8.6.2, updating in place over the native app (same package and storage); version from version.json, upload-key signing, R8, multi-window, no stock plugins on Android; unit, bridge, parity and version tests pass; not pushed.
- 2026-11-24: 1.5.74 (build 89), the mobile app with the iOS review's fixes, uploaded to TestFlight with the owner's OK (delivery 9fe1d590); tag local.
- 2026-11-24: iOS review of the mobile app (design/HIG, polish, performance; docs/mobile/ios-review-2026-11-24.md): 44 pt hit areas for Calendar's grabber, a note's place chip and Foli AI's Add; local mode's network rules now apply from the first request and compile once. Open for the web session: iPad touch targets under 44 pt and about 4 MB of web memory kept per note open and close.
- 2026-11-24: 1.5.72 (build 87), the Capacitor mobile app, uploaded to TestFlight with the owner's OK (delivery 58636ca8); internal testing only.
- 2026-11-24: Owner: local mode may check Folevi for new note styles. iOS local-mode rules allow only `<deployment>.convex.site/note-styles` and Convex storage images (checked on the simulator: everything else still blocked); features and docs pages say notes never leave the device and the app only checks for new styles.
- 2026-11-24: 1.5.72 (build 87) cut on `claude/mobile-capacitor-f41734` (tag local) for the Capacitor mobile app; iOS IPA exported, TestFlight upload pending a permission; Android build handed to the Android session. PR 66: main merged again; its one failing e2e (vault-team) had passed on the same code the run before.
- 2026-11-24: Owner: keep note covers inside the mobile app and sync note styles when the server changes them. Plan in docs/MOBILE.md; local mode's part asked of the owner.
- 2026-11-24: PR 66 opened for the Capacitor mobile app (`claude/mobile-capacitor-f41734` pushed); open question to the owner: note covers.
- 2026-11-24: `apps/mobile`: one Capacitor app for iPhone, iPad, iPhone Duo and Android around the web app (no native screens), reusing the shared Swift and Kotlin services; window-size layouts in `lib/iphone.ts`; `version.mjs` covers it; checked on simulators and emulators, size and memory compared (docs/MOBILE.md). Branch `claude/mobile-capacitor-f41734`, PR not merged.
- 2026-11-25: Web everywhere queue landed (61, 62, 63, 64, 70, 75, 71, 72 after 68 and 74); this is their combined entry:
  PR 62 shortcuts per system (and documents.spec:187 waits for the bar's Share and the panel's focus instead of racing
  them); PR 63 Mac no-bounce motion and Android press ripple, the owner's picks in the web-everywhere memory; PR 64 one
  wording set, Tasks and Calendar icons, Calendar's loading placeholder (native and Android icon files regenerated);
  PR 70 and 75 Windows and Linux downloads on `/apps` (pickers by user agent, every package listed, unsigned-build notes);
  PR 71 note styles sync (`/note-styles`, Cache Storage, newer `updatedAt` wins; the local e2e guard answers the check);
  PR 72 the privacy policy's "Using the apps without an account" paragraph. While queued, these PRs left HANDOFF.md
  alone so each merge didn't conflict the rest.
- 2026-11-25: PR 61 CI fixes: the app counts as a touch device only with touch points (real iPhones, iPads and Android devices report them; the e2e suite's desktop "iOS app" keeps the desktop layout); a tab's 44 pt hit area moved onto its link (the wrapper's layer took the link's taps); the iOS purchase check no longer matches Choose profile picture. Local: ios-app, ios-native, tab-strip-overflow and iphone-app pass (11).
- 2026-11-24: Web everywhere PR 1: touch hit areas of at least 44 pt (`.ui-hit`, `.ui-seg > *`, `:root[data-tablet|data-iphone]`) for the small chrome controls the iOS review measured, no change to the look. Note-page memory growth (iOS review): no web leak found; in Chromium the growth is V8 optimizing existing functions (decelerating) and in desktop WebKit the web process has no trend; waiting on the mobile session's repro details or a Web Inspector heap snapshot.
- 2026-11-24: Web everywhere PR 1 fixes from CI: boards (flowchart, stickies, wireframe, mind map) ignored nothing React handed up from their sheets, so a sheet's buttons never worked with a mouse (`pressIsElsewhere`); the phone layout no longer hides the note's tools while typing on a computer; phone-width e2e steps go through the phone layout. Local CI-style run: 79 + 4 affected account specs pass.
- 2026-11-24: Web everywhere PR 1 merged with `main` (PR 55, iPhone Duo); `lib/platform.ts` now uses the Duo app's fold marks (`data-fold`, `--fold-start`, `--fold-end`) instead of its own; 12 platform unit tests.
- 2026-11-24: Web everywhere PR 1: `lib/platform.ts` (form factor, shell, OS, fold, `<html>` marks), width decides the phone layout on every device (owner's pick), the open Duo gets the tablet layout, every touch tablet gets the iPad's touch look; e2e specs updated for the phone browser's bottom bar; 11 new unit tests.
- 2026-11-24: PR 74's memory spec is tagged @local too and skips outside WebKit (CI's account project had run it signed in, with no local library).
- 2026-11-24: PR 74 also empties the move's screen picture when it ends (`leaving.replaceChildren()`, the iOS review's TestFlight 1.5.75 change): with it a WebKit probe keeps 0 of 10 pictures and 0 of 5 editors in every run. The iOS review's remaining ~2 MB per open (no-copy runs) was the real note screen held by finished animations, which the first PR 74 commit releases; the mobile session re-measures on iOS.
- 2026-11-24: iPhone layout memory fix (branch `claude/web-iphone-note-memory`): the push/pop/zoom moves' finished animations kept every note that slid in reachable in WebKit (about 5 MB per open on iOS); `transitions.ts` now drops their element and handlers when a move ends. Regression spec `e2e/iphone-note-memory.spec.ts` (tagged @local and @mac, skipped outside WebKit) runs in the mac-webkit project against the shell dev server; CI's account project leaves it out. How it was found: a WeakRef probe in Playwright WebKit; note that locators mark what they touch (`__playwright_target__`), which keeps elements alive, so such probes must find elements from inside the page.
- 2026-11-24: Intermittent e2e fix (`claude/web-e2e-flakes`): the note tools panel chose its tool only after a note's details loaded and forgot a tool picked on the previous note, so clicks raced a late switch (documents.spec:187, ai-study.spec:60). Now decided before the note's first draw, and a picked tool stays from note to note. Local stack: both specs 8/8, 42 panel-related account specs pass. Local runs need the stack's GEMINI_API_KEY removed for the "isn't set up" specs (CI has none).
- 2026-11-24: `apps/web/test/version.test.tsx` checks the AppKit app's About panel again (AppDelegate.swift, MenuModel.swift) instead of the SwiftUI app's AppCommands.swift.
- 2026-11-24: Secret scan: the Mac screenshot script's made-up Vault demo values (brought back in 8ebce629) marked `gitleaks:allow` and fingerprinted in `.gitleaksignore`.
- 2026-11-24: Folevi for Mac 1.5.73 (build 88) released to the Mac feed with the owner's OK ("Release it"): the AppKit web-view app with the web's own UI; 1.5.72 (Capacitor mobile) recorded from its tag.
- 2026-11-24: Folevi for Mac back to the AppKit web-view app on `claude/mac-webview` (owner's pick): web's own UI, native frame removed, Mac extras kept; SwiftUI app tagged `archive/mac-swiftui`; 111 Mac tests pass; not released.
- 2026-11-24: Merged `main` (PR 57, bda71bcd) into the Mac branch for PR 60; versions stay 1.5.71 / 86.
- 2026-11-24: Merged `main` (PRs 55 and 59, f7893e54) into the Mac branch for PR 60; versions stay 1.5.71 / 86, changelogs kept.
- 2026-11-24: Folevi for Mac 1.5.71 (build 86) released to the Mac feed with the owner's OK: web-style tabs and the best-native pass; main (PR 56) merged into the Mac branch, 46 Mac tests pass, notarized and stapled.
- 2026-11-24: All branches synced with main (289b11af): PR 56 `claude/ios-native-redesign-f4a8be` (da225a57), PR 55 `claude/iphone-duo-native-ipad` (9642b0f7: Android version read from version.json, `isIphoneApp` keeps the Duo and Android rules), PR 57 `claude/android-tabs`, PR 58 `claude/windows-electron-4ed862`, and `claude/mac-web-tabs` (Phase 0 added). A trial merge of all five onto main in that order is clean except HANDOFF.md change-log lines (keep both); result 1.5.69 build 84. Merge order: 56, then 55 (retarget to main), 57, 58, then the Mac branch's PR. Leftover branches `claude/iphone-duo-ipad-layout`, `claude/ipad-native` and `claude/handoff-2026-11-23` hold nothing new.
- 2026-11-24: Synology native Folevi Server started. Phase 0 passed on branch `worktree-agent-a21c347ca995aad59` (commit 0b4dd44e, not pushed; `docs/self-hosting/PHASE0.md`, `scripts/self-host/`): Folevi deploys to a standalone Convex backend unchanged; single-origin proxy works; memory about 570 MB peak tuned. Fixes needed: optional email verification, internal URLs, LAN http, hide AI/billing, standalone build. Waiting on the owner's OK to download the Linux Convex and Node binaries, and their NAS models.
- 2026-11-24: Self-hosting plan updated with the owner's decision: native Synology `.spk` and QNAP `.qpkg` apps (no Docker), containers elsewhere; the owner also wants a Windows app (options given: revive the Electron app from 7cb6ddda^, Tauri, PWA, native).
- 2026-11-24: Self-hosting plan written for the owner (`docs/SELF_HOSTING_PLAN.md`): Folevi Server on NAS boxes and hosts, apps sign in to any server; plan only, decisions in its section 7.
- 2026-11-24: PR 51 (native Mac app, 1.5.66 to 1.5.68 line) merged into main and deployed; PR 54 freed.
- 2026-11-24: Mac tabs open as on the web and the Mac best-native pass (skills audits + owner picks) on `claude/mac-web-tabs`; not released.
- 2026-11-24: Merged `main` (PR 59, 1.5.70 build 85) into `claude/android-tabs` for PR 57; only the change log conflicted (both sides kept), main's version.json kept.
- 2026-11-24: 1.5.70 (build 85) cut on `claude/ios-release-1.5.70` (off PR 55's branch, all of `main` plus iPhone Duo) and uploaded to TestFlight with the owner's OK (delivery e18198df); tag local. Native releases then paused by the owner (one web app everywhere).
- 2026-11-24: Merged `main` (PR 55, iPhone Duo, 1.5.69) into `claude/android-tabs` to clear PR 57's conflicts; only HANDOFF.md conflicted (both sides kept).
- 2026-11-24: Merged `main` (PR 56, iPhone and iPad second round) into `claude/android-tabs` to clear PR 57's conflicts; only HANDOFF.md conflicted (both sides kept). PR 57's secret scan fixed: it tripped on the Windows branch's placeholder Dropbox key (the scan reads every branch); same ignore line as main.
- 2026-11-24: Play internal testing live: release 83 (1.5.68) published to the internal track with the owner's OK.
- 2026-11-24: Android upload key created (outside the repo) and a signed release bundle built; Folevi created in Play Console with an internal testing track (owner's OK, declarations ticked with the owner's OK); first upload waits on the owner.
- 2026-11-24: PR 54 (Android native app) merged into `main` (289b11af) once CI passed; `main` merged into `claude/android-tabs`, opened as PR 57.
- 2026-11-24: Android tabs on tablets, foldables and Googlebooks with the web's rules, links inside notes, and an android-skills polish pass (security, edge-to-edge, widgets, ANRs, Back, keys) on `claude/android-tabs` (976a7172); pushed, no PR yet.
- 2026-11-24: PR 56 merged into `main` (546f6aa4); PR 55 retargeted to `main` and `main` merged into the Duo branch (no conflicts).
- 2026-11-24: PR 55 caught up again with its base (the iPad branch's test notes and the secret scan's known false positive in `.gitleaksignore`), which clears PR 55's failing secret scan.
- 2026-11-24: PR 56's conflicts with `main` fixed (main's PR 54 merged into the iPad branch, HANDOFF only), then the iPad branch merged into the Duo branch for PR 55: Android's Gradle version comes from version.json (main's), and `isIphoneApp` keeps the Duo's `wide` check next to main's Android phone check.
- 2026-11-24: PR 55's merge conflict with its base (which took main's PR 51) resolved: versions stay 1.5.69 (build 84), changelogs merged.
- 2026-11-24: 1.5.69 (build 84) cut on `claude/iphone-duo-native-ipad` (1.5.68's release line merged in first; 1.5.68 was the Mac fix) and uploaded to TestFlight with the owner's OK (delivery 5facce96): Folevi on iPhone Duo. Tag v1.5.69 local only.
- 2026-11-24: PR 55 opened for the iPhone Duo on the native iPad window (owner: replace PR 53); PR 53 closed, its branch kept.
- 2026-11-24: iPhone Duo made to Apple's Duo page on `claude/iphone-duo-native-ipad` (owner's ask): whole toolbar and the note's tools in iOS's side column, page dock dropped there, sidebar beside the content and to the fold, inspector makes room; fold no longer hides the sidebar.
- 2026-11-24: iPhone Duo put on the native iPad window (local branch `claude/iphone-duo-native-ipad`: PR 53 + the iPad redesign branch; fold handling on the tabs row); PR 53 caught up with the 1.5.66 release branch (HANDOFF conflict only); tabletop checked.
- 2026-11-24: PR 53 held until the 1.5.66 release (PR 51) merges, at the main session's request; then retarget it to main.
- 2026-11-24: PR 52 merged into `claude/folevi-core-529dbe` (owner's OK; no required checks, so it merged before its lint run, which PR 53 had already passed on a superset); PR 53 retargeted to `claude/folevi-core-529dbe`.
- 2026-11-24: iPhone Duo branch pushed with the owner's OK; PR 53 opened into `claude/ios-native-redesign-f4a8be` (PR 52's audit commits merged in first).
- 2026-11-23: iPhone Duo resumed and redone (third pass, owner's pick): the iPad's wide layout when open, the iPhone layout closed; branch `claude/iphone-duo-ipad-layout` on PR 52's branch, not pushed.
- 2026-11-24: Merged `main` (PR 54, Android native) into `claude/ios-native-redesign-f4a8be` to clear PR 56's conflicts; only HANDOFF.md conflicted (next steps and change log, both sides kept). All native-kit iOS tests (274, 31, 38, 28, 31), the macOS build and 39 Mac app tests pass (one earlier run timed out 19 checks in FoleviScreens while the machine's load average was about 40; the rerun passed).
- 2026-11-24: PR 56 opened (iPhone and iPad second round, 1.5.67, into `main`) after merging `main` (PR 51, 1.5.68) into `claude/ios-native-redesign-f4a8be`; all native-kit iOS tests, the macOS build and 39 Mac app tests pass.
- 2026-11-24: Owner confirmed links inside a note stay in the same tab, like the web (saved in `ios-redesign-decisions-2026-11-23.md`); no code change.
- 2026-11-24: iPad tabs audited against the web's rule (owner, 2026-11-24: everything opens in a new tab like the web): already matching, no change. Lists, cards, See all, folder cards, search, palette and Foli AI/notification links open a new tab with an opener (FrameModel.open default); sidebar items and the toolbar's New note open fresh tabs; links inside a note follow in the same tab (FrameModel:694, as tabs.tsx); Back with nothing left closes the tab and returns to its opener (TabsModel.travel). Checked on the iPad simulator.
- 2026-11-24: 1.5.67 (build 82) cut on `claude/ios-native-redesign-f4a8be` (after merging the released 1.5.66) and uploaded to TestFlight with the owner's OK (delivery f33671ae): the native iPad window and the iPhone's system lists. Tag `v1.5.67` local; web and Mac not released; a PR into `main` follows once PR 51 merges.
- 2026-11-24: iPad rebuilt natively and merged (`claude/ipad-native`): system split view, system toolbar (Back/Forward, title, items, ink New note, sync, bell, search), Safari-style tabs row, the note's Style/Format/Insert/Foli AI in the system inspector; Debug iPad launch with FOLEVI_REBUILD_OPEN fixed; all iOS package tests pass on the iPhone simulator.
- 2026-11-24: Owner chose native like the Mac for iOS: iPhone lists and Settings on iOS's own List (rows unlined, native swipe actions); the iPad's native split-view rebuild runs on `claude/ipad-native` (helper, not merged yet).
- 2026-11-24: PR 51 merged, so `main` was merged into the Android branch (PR 54): main's version kept (1.5.68, build 83, read from `version.json`; the old Capacitor `build.gradle.kts` stays deleted); both sides had used contract revision 34, so Android's platform became revision 35 (Swift, Kotlin and fixtures regenerated).
- 2026-11-24: PR 54 CI fix: the version test checked the removed Capacitor project; it now checks that Android's Gradle build reads version.json.
- 2026-11-24: Android native branch pushed and opened as PR 54 (14 commits, merges cleanly with main); not merged.
- 2026-11-24: Android: signing in from the first-launch screen opened an empty Home ("The message names no place.") until a restart; the page's place marker now refreshes when the open place changes. Sign-in checked on an emulator with a dev test account; on `claude/android-native-622675`, not merged.
- 2026-11-23: Android first build on `claude/android-native-622675`: host bridge and services moved in, Capacitor removed, all first-build screens, Vault, Googlebook keys/menus/windows, contract revision 34, R8 release build; not merged.
- 2026-11-23: Android resumed as a native Compose app (owner's answers, research, Kotlin bridge codegen, engine module, app skeleton verified on phone/tablet/foldable/desktop emulators) on `claude/android-native-622675`; not released.
- 2026-11-24: 1.5.68 confirmed by the owner and published to the Mac feed; Mac web-style tabs started on `claude/mac-web-tabs`; Taskeni Mac polish started in its own session.
- 2026-11-24: 1.5.66 released (Mac on Sparkle, TestFlight) and pulled from the Mac feed after it left signed-in Macs on the loading screen (page policy never knew the place's mode); fix in 1.5.68, notarized DMG handed to the owner, not on the feed yet; tabs-match-web rule saved and forwarded.
- 2026-11-23: Folevi for Mac: no more Core naming; `apps/mac/FoleviCore` became `apps/mac/Folevi` (project, target, scheme, module, tests), `core.mjs` became `app.mjs`, internal Core* types became App*; identity, data and update feed unchanged; 38 Mac tests and the web version test pass.
- 2026-11-23: Folevi for Mac: the window rebuilt the native way (system split view, unified Liquid Glass toolbar with each screen's items and search, system inspector, segmented controls, sidebar can be hidden); the Macloving card design dropped at the owner's word; 38 tests pass.
- 2026-11-23: Folevi for Mac: HIG and Liquid Glass pass (content under the glass bar with a soft edge, split screens below it, tab bar state after restored tabs, no shadow on the palette's glass, Jump to Latest materializes, hover on bar choices); iPhone/iPad pass handed to the redesign session (PR 52).
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
