# Handoff, 2026-10-24

Written at the end of a long Claude Code session on the owner's Mac, so work can continue on another
computer and another Claude Code account. Read this first, then `docs/claude-context/` (the owner's saved
decisions and rules), then the plan docs named below.

## 1. Where things stand

**Released and live (version 1.0.04, build 8, origin/main `f5f00a26`):**
- Website and production Convex (deployed by Vercel on every push to `main`).
- Native Mac app (AppKit + WKWebView, `apps/mac`), notarized, published through Sparkle at
  `https://folevi.com/download/mac/appcast.xml`. The owner's Mac runs 1.0.04 and updates itself through
  Check for Updates (verified for 1.0.01 to 1.0.04).
- iPhone/iPad app (Capacitor shell, `apps/ios`) on TestFlight, group "Folevi team". Not submitted to the
  App Store yet (owner's decision, and the export compliance question is still open).
- Android (`apps/android`) is built but PAUSED: no builds, releases or Android work until the owner says.

**What 1.0.01 to 1.0.04 shipped:** Mac memory work, folder drag and drop, open tab always visible, flowchart
connector fixes, Sign in with Apple (configured on dev and prod Convex), apps' Google/Apple sign-in straight
to the provider, folevi.com opening the app when signed in (with a fallback check, `/api/signed-in`),
iPhone speed and chrome work (neutral top bar, full-width notes, Done while writing, Craft-style zoom from
cards, no bottom fade, header overlap fix), redesigned iPhone sheets, offline notes that show and sync, a
sync status on iPhone/iPad, big-note Foli AI (outline, paged reading, batched edits, Continue), the
"invalid rank" data-loss fix (deployed as a hotfix), and a full on-device copy of every note (R1:
`convex/sync.ts` manifest/pullDocs/pullAll, `apps/web/src/lib/sync/deviceCopy.ts`, Settings > Offline &
sync).

## 2. Branches and checkouts

| Branch | What | Deploys? |
| --- | --- | --- |
| `main` (origin) | 1.0.04 as released | Pushing to `main` deploys the website AND production Convex. Never push `main` without the owner's explicit OK. |
| `wip/handoff-2026-10-24` | `main` + 3 finished commits not yet released (`0df7309c` themed note cover corners 18 pt on iPhone, `88b0057c` and `dd73d298` iPhone sheets reach the bottom edge with 28 pt top corners) + one WIP snapshot commit `4e9271b6` of unfinished work (section 3) | No (Vercel skips previews, see `scripts/vercel-ignore.sh`) |
| `native-app` | The native Swift app project (section 4). Based on `main` at 1.0.04. Last commit `e04b1b5e` is a WIP snapshot. | No |

On the owner's Mac the native branch was checked out as a second worktree at
`../folevi-native` (sibling of this repo). On a new computer: clone, then
`git worktree add ../folevi-native native-app` (or just check the branch out).

Setup on a fresh machine:
- `CI=true pnpm install --frozen-lockfile` at the root; in `apps/ios` run
  `CI=true pnpm install --ignore-workspace` (it has its own lockfile, outside the workspace).
- Copy `apps/web/.env.local` from the owner (not in git). Convex dev deployment is
  `peaceful-mockingbird-196`; production is `fastidious-clownfish-123`.
- Dev servers: `.claude/launch.json` has `web-3002` (app.localhost:3002) and `web-shell-3003`
  (localhost:3003, the apps' bundled shell build). E2E:
  `E2E_BASE_URL=http://app.localhost:3002 E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 npx playwright test <spec> --workers=1`
  from `apps/web` (port 3000 may be another app).
- Full checks: `pnpm typecheck` (run alone, not in parallel with lint) and `pnpm test`. Known lint
  errors (9) exist in untouched files; nothing else should fail.

## 3. Unfinished work on `wip/handoff-2026-10-24` (all stopped mid-task on a usage limit)

Nothing here is tested as a whole. Before merging into `main`: run `pnpm typecheck`, `pnpm test`, the
related e2e specs, then release as 1.0.05 (section 6).

1. **Text and spacing scale pass (app-wide).** Owner: text too small in places (example: Foli AI tools
   sheet, "Decide" / "Explore ideas" group labels smaller than their rows); wants a proper standard type
   hierarchy everywhere, nothing too small or too big; and proper spacing everywhere (example: a themed
   note's cover sat flush under the iPhone top bar; wants about 12 pt neutral gap). In progress:
   `packages/design-tokens` (type and spacing tokens), many components switched to role classes,
   `apps/web/test/type-scale.test.ts` and `spacing-scale.test.ts` guards (new, may not pass yet),
   `apps/web/e2e/zz-type-shots.spec.ts` (a screenshot helper; delete before merging). Targets: iPhone/iPad
   follow Apple HIG default sizes (Large Title 34, Title 28/22/20, Headline 17 semibold, Body 17, Callout
   16, Subheadline 15, Footnote 13, Caption 12/11; group labels never smaller than rows); desktop/Mac a
   compact scale; 4-pt spacing grid; add "Native type scale" and "Native spacing scale" sections to
   `docs/DESIGN_SYSTEM.md`; before/after screenshots for the owner. The cover gap under the iPhone bar is
   part of this item and may not be done yet.
2. **Folder sharing (owner approved).** Share a folder with people and roles (viewer/commenter/editor);
   notes and subfolders inside inherit (including notes added later); moving a note in/out changes access
   with a warning; highest of note and folder grant wins; Shared with Me lists folders; the device copy
   feed must include folder-shared notes and drop them on revoke. Files so far: `convex/folderSharing.ts`,
   `convex/schema.ts` and the access helpers (`convex/lib/auth.ts`, `documents.ts`, `scope.ts`),
   `convex/sharing.ts`, `convex/sync.ts`, `apps/web/src/components/app/FolderShareDialog.tsx`,
   `components/views/SharedFolderView.tsx`, `FolderInviteView.tsx`, `lib/app/folderSharing.ts`,
   `tests/convex/folder-sharing.test.ts`, `apps/web/test/folder-sharing.test.ts`. Schema must stay backward
   compatible (no destructive migration). Then: e2e with two test accounts on the dev deployment, docs
   (`docs/SHARING.md`), and the native bridge views/commands (folder people, invite, role, remove,
   invitation accept/decline) for the native app.
3. **Declining invitations.** `tests/convex/decline-invites.test.ts` and server code in this WIP; the
   native branch's bridge agent was also adding decline. Reconcile into one implementation when merging.
4. **iPhone 120 Hz and dropped frames.** Owner: opening a note and going back feel like 20 to 30 fps.
   Done: `CADisableMinimumFrameDurationOnPhone` added to `apps/ios/ios/App/App/Info.plist`. In progress:
   moving every transition (push/pop, zoom, back swipe, sheet settle) to compositor-only CSS/Web
   Animations on transform/opacity, rendering the next screen before animating, deferring heavy work until
   after; `apps/web/src/components/iphone/transitions.ts`, `IphoneShell.tsx`, `Sheet.tsx` (a drag-settle
   change there broke the 375x667 drag-to-medium check in `e2e/iphone-ai-sheet.spec.ts`; fix it). No
   private WebKit APIs. Needs a real-device profile (section 5).

## 4. The native app (`native-app` branch)

Owner decisions (2026-10-24, final): everything except the editor/note page becomes native Swift on iPhone,
iPad and Mac; native screens get data from the existing web layer through a bridge (one source of truth for
sync, offline, E2EE, multi-account); one big release as 1.1.00; technical Settings sections (Webhooks, API
tokens, Connected apps, AI export, workspace Data) open as in-app web pages; Reviews and Graph stay web
inside native bars; background sync for every plan including Free; attachments 2 GB or 10% of free space,
Wi-Fi only; keep improving the web phone layout. Plan: `docs/NATIVE_APP_PLAN.md`. Contract requests and
their status: `docs/NATIVE_CONTRACT_REQUESTS.md` (on `native-app`).

Architecture in one paragraph: one WKWebView per window runs the web data layer ("engine") and is also the
note editor; native screens subscribe to typed live views and send commands over the bridge. The contract is
`apps/web/src/lib/engine/protocol.ts` (protocol 1, revision 10 committed, revision 11 work in the WIP
commit); Swift models are generated by `pnpm engine:gen` (`scripts/engine-codegen.mjs`) into
`apps/native-kit/Sources/FoleviEngine/Generated/`; CI checks they're current. Shared Swift package
`apps/native-kit`: `FoleviEngine` (bridge client), `FoleviDesign` (tokens, fonts, components),
`FoleviScreens` (screens), `FoleviMac` (Mac frame). The iOS app no longer uses Capacitor on this branch
(`apps/ios/ios/App/Native/Host`), but keeps the page at `capacitor://localhost` so installs keep their data;
`pnpm upgrade-test` (`apps/ios/scripts/upgrade-test.mjs`) installs shipped 1.0.02 with data then the new
build over it (passed 15/15). This is a release gate.

Work package status:
- Done: N0 package + codegen, N1 iOS host without Capacitor, N2 web bridge + content-only mode, N3 Swift
  bridge client, N4 design system, N5 iPhone frame + N6 editor glue (keyboard toolbar, Done, zoom, native
  sheets, native email sign-in `PhoneAuthService`), N7 Home and lists, N8 Mac frame, N9 folders, N10 Tasks
  and Calendar, N11 search, notifications and places, N13 Settings, N14 sign-in gates, sharing, Quick Add.
- In progress: N12 native Foli AI chat (`apps/native-kit/Sources/FoleviScreens/FoliAI/`, WIP, not wired);
  N16 remaining bridge items (revision 11: R5.1 slash menu insert kind, R5.3 iPhone note full width in
  content-only mode, R5.4 caret in title for a new note, R5.5 editor.state on focus, R5.6 first-launch
  gate reports `loading` instead of `signedOut` so native sign-in never appears (important), R5.7 a note
  prepared right after cold launch sometimes ends on "This page couldn't load", R9.1 to R9.4 folder lock,
  changes.diff, folders.cards, ai.generate/saveDraft, invitation decline, support form route).
- Not started: N15 iPad pass, N17 tests and performance budgets, N18 migration and release; R2 native
  background sync (silent push with APNs key 5PG87M528M, BGAppRefreshTask/BGProcessingTask).
- Known issues: Mac app `RouterTests.testDebugIdentity` expects a version from a stale build; a full
  `swift test` build may fail in `DragTypeTests`; the Vision OCR test times out on some Macs; shared
  `__Snapshots__` must not be cleared wholesale (re-record only your own).
- `FOLEVI_WEB_FRAME=1` brings back the old web frame in both apps; `FOLEVI_FRAME_DEMO=1` (Mac Debug) runs on
  the demo engine.

## 5. Real-iPhone profiling (unfinished)

The owner's iPhone 16 Pro Max (iOS 27.0.1) has Developer Mode on now, and a **profiling build of 1.0.04
(Release config, development-signed) is installed over the TestFlight app** (same bundle id; data kept).
To return to TestFlight, install the next TestFlight build (or reinstall 1.0.04 from TestFlight). Instruments
saw the phone as offline until Xcode's Devices window was opened once; then
`xcrun xctrace list devices` listed it online. No trace was captured yet. Next: record 'Animation Hitches'
and 'Time Profiler' (UDID 00008140-0002199401E0801C) while the owner opens a note from Home and goes back
3 times, then zoom from a card and back swipe 3 times; export with `xcrun xctrace export`; fix the top
causes (section 3 item 4).

## 6. How to release (each release needs the owner's explicit OK)

- Version: `#.#.##` on every platform (next: 1.0.05, build 9). `node scripts/version.mjs set 1.0.05`, then
  `sync` and `check`. Never show a build number in the UI.
- Release from a clean git worktree of the commit being shipped (so others' WIP never ships). Push to
  `main` deploys web and Convex (Vercel runs `npx convex deploy`). Poll the Vercel status:
  `gh api repos/faisalibnislam/folevi/commits/<sha>/statuses` (gh account `faisalibnislam`).
- Mac: `node apps/mac/scripts/publish.mjs --plan`, then the real publish (notarizes with keychain profile
  `folevi-notary`, staples, DMG + ZIP + signed appcast, uploads to R2 bucket `folevi-updates` with
  wrangler; previous ZIPs in `apps/mac/release-archive/` for deltas, untracked). Don't use `--install`; let
  the owner's Mac update through Sparkle. Needs on the new machine: Developer ID Application cert (team
  7K32QQ2FX8), the notary profile, the Sparkle EdDSA private key (login Keychain account "folevi"; the owner
  has a backup), wrangler logged in to the owner's Cloudflare.
- iOS: `node apps/ios/scripts/release.mjs` (archive + TestFlight upload with the App Store Connect API key
  HS88CK5RQF, issuer 9479ebb4-e44a-45b4-bfef-e625408057ae, file `~/.appstoreconnect/private_keys/`; never
  read or print it). App Store Connect app id 6825699028.
- See `docs/MAC_RELEASE.md`, `docs/DEPLOYMENT.md`, `docs/claude-context/APPLE_DEVELOPMENT.md`.

## 7. Waiting on the owner

- Add a TXT record `v=spf1 include:amazonses.com ~all` at `@` for folevi.com (Namecheap) so Apple's Sign in
  with Apple email relay check passes; then press verify in Apple's portal.
- Export compliance answer for App Store submission; whether to submit to App Review.
- Dropbox app (redirects for Mac and iOS) and Google iOS client; store the Sparkle key backup in the
  password manager.
- Test 1.0.04 on the real iPhone (speed, sheets, offline, sync status, native-like zoom).

## 8. Rules the owner set (full list in `docs/claude-context/memory/`)

- Never push `main` or deploy, notarize or upload to TestFlight without the owner's OK in chat. Never use
  `npx convex ... --prod`; production is `--deployment fastidious-clownfish-123`. Never print secrets; the
  owner sets secrets with `--from-file`.
- Never touch the owner's real data: `~/Documents/Folevi Library`, `~/Library/Application Support/Folevi`,
  the "Folevi Safe Storage" Keychain item; tests use scratch folders and dev test accounts.
- No permanent deletion (move to Trash). Commit only your own files with `git commit <paths>`.
- No em dashes anywhere. The assistant is "Foli AI". Custom controls only (no OS-default selects), neutral
  chrome (notes carry colour), radius and type from the design tokens.
- Every iPhone feedback also applies to iPad. Every web change ships to the Mac app.
- No buying in the iOS app (no prices, buy buttons or upgrade links).
- Ask the owner with clear options when a decision is theirs; give before/after screenshots for UI work.
