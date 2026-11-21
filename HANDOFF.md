# Folevi: handoff

> Read this first if you are a Claude (or any agent) picking this project up, on this Mac or another one. Then read `CLAUDE.md`, `docs/HANDOFF.md` (the long handoff: unfinished branches, release detail, what the owner is waiting on) and `docs/claude-context/memory/MEMORY.md` (the owner's standing rules). Keep this file current: after every change to the project, update "Current state", "Next steps" and "Change log", and commit it.

Last updated: 2026-11-21 (Folevi Core) · Written on: Faisal's MacBook Pro M5

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

## 9. Current state (as of 2026-11-21)

**Live: Folevi 1.5.63** (tag `v1.5.63`, PR 46 merged with PR 47 in it, `main` = `3258f12b`): Mac published (feed and
DMG at folevi.com/download/mac show 1.5.63), iPhone and iPad uploaded to TestFlight. Vercel skipped the web build
(Ignored Build Step: only native code changed), so the web is still 1.5.62's build. 1.5.63 carries PR 45's Liquid
Glass motion pass, card strips that no longer clip their shadows, iPhone search at the foot above the keyboard, and
Quick add's Task/Note in Foli AI's switch style. 1.5.62 (PR 44) shipped on all three before it. 1.5.60 and 1.5.61 are tags only (each was superseded before shipping; tags never move). 1.5.59
(PR 43) shipped earlier the same day on all three.

This session's wrangler login lives in the app's own `XDG_CONFIG_HOME` (not `~/.wrangler`); `npx wrangler whoami`
there shows the account that owns `folevi-updates`. Decisions: `docs/claude-context/memory/tab-back-and-overview-2026-11-21.md`
and `frosted-folders-decision-2026-11-20.md`.

**Folevi Core (new app, in progress):** branch `claude/folevi-core-529dbe` (worktree
`.claude/worktrees/folevi-core-529dbe`), `apps/mac-core`. A new, fully native macOS 26 app beside today's Folevi
(owner's decisions of 2026-11-21: its own name, bundle id `app.folevicore.FoleviCore`, data folder, Keychain
names `app.folevicore.*`, URL scheme `folevi-core://`; same accounts; today's app keeps shipping). SwiftUI with
AppKit where it matters; the web editor stays for note pages in a pool of warm web views (one hidden engine page
per place, which is also the first window's editor, plus up to three editors for other windows). The data layer
is reused by path, never copied: the web export in native chrome mode through FoleviEngine, the iOS shell
services, and the Mac host's UI-free files (app:// scheme, routers, Places, background sync, Updater, printing,
OCR, call recorder). The owner asked mid-build (2026-11-21) to keep the main app's coloured icon, its icon set and
its black and white buttons: done (shared AppIcon.icon, web icons, Folevi ink whatever the Mac's accent).
Read `apps/mac-core/README.md`; parity item by item in `apps/mac-core/PARITY.md`. Checked: Debug build runs on
the demo engine and on the real engine with a scratch "on this Mac" library (gates, Home, lists, a note in the
editor, Tasks, Calendar, Foli AI screens), 21 Core test suites pass, FoleviMac's 243 tests still pass, today's Mac
app still builds; `scripts/release.mjs` makes a Developer ID signed, checked DMG (not notarized). Core has its own
Sparkle key (login Keychain, account `folevi-core`; the owner should back it up). Not checked: signing in to a
real account in Core, iCloud/folder libraries, every parity item (see PARITY.md's gaps).

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
- Folevi Core (`apps/mac-core`, branch `claude/folevi-core-529dbe`): close the remaining gaps in
  `apps/mac-core/PARITY.md` (672 of 1,343 there, 301 partly, 160 missing; "Gaps in priority order" lists what's
  left: tabs, Home details, notes lists and folders pages, tasks views, calendar, notifications, Settings search,
  time zone picker, Foli AI memory), then the owner tries it with a real account. Publishing
  (`apps/mac-core/scripts/publish.mjs`, R2 `folevi-updates` under `core/`) only with the owner's OK. The release
  build already carries iCloud (`iCloud.com.folevi`) on its Developer ID profile. Known issue: launched with
  `core.mjs launch --demo` (FOLEVI_DEMO=1) the windows get no values (Home spins); the real engine with the
  scratch library works.
- Liquid Glass motion branch (`claude/liquid-glass-animations-b1d70e`): the owner's look on a real Mac and iPhone, then
  merge with the next release. Known left: the Mac's Foli AI chat closes at once, with no exit animation (its host
  view shrinks before SwiftUI can animate the chat out; older than this branch).
0. On real devices: Back after Home's See all (Mac, iPad, web), Show All Tabs' Home picture, iPhone Home's folder
   and note strips (1.5.62).
1. On a real iPhone, iPad and Mac with the owner's library: the note bar swap (1.5.56), Offline & sync's Download
   everything now with an account (1.5.57), frosted folders' scrolling in long grids (1.5.58).
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
- 2026-11-21: Folevi Core: the Vault complete, Quick Add parity, Foli AI chat details and a floating Ask Foli AI panel (⌘J), search and palette, Settings in today's order with a Library pane, About and Support, sidebar details; ready follows the engine client (no more stuck starting screen); PARITY.md recounted: 672 there, 301 partly, 160 missing, 210 n/a.
- 2026-11-21: Folevi Core: draft PR 51; parity checklist (595 of 1,343 present, 343 partial, 195 missing, 210 n/a at first grading) and the first work packages closed (bugs, sharing, folder picker, tabs, task editor, calendar views); Developer ID release with iCloud verified (not notarized).
- 2026-11-21: Folevi Core started in `apps/mac-core` (branch `claude/folevi-core-529dbe`): native app, release and publish scripts, tests, parity checklist. FoleviKit's demo engine is its own target `FoleviEngineDemo` (files unmoved, re-exported by FoleviMac).
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
