# Website performance (2026-10-29)

The owner's brief: make the web app faster, lighter and smoother, above all on low-spec computers (dual-core or
older CPUs, 4 to 8 GB of memory, integrated graphics) and slow networks, while it stays exactly the same app: no
feature, look, animation, effect or behaviour changes, no lower quality, no new delays, nothing traded against
security, reliability or accessibility, and no low-quality mode. Branch `perf/web-audit` (from `main` 613b97e9).
The iPhone app's own pass is docs/IOS_PERFORMANCE.md.

## How it's measured

- **A production build**, served by `next start` on port 3000 (the origin the development backend trusts for
  signing in): `NEXT_DIST_DIR=.next-perf FOLEVI_SOURCEMAPS=1 pnpm exec next build`, then the `perf-web-3000` entry
  of .claude/launch.json (git-ignored).
- **`e2e/web-perf.spec.ts`**: a scratch account on the development backend with a library of 240 short notes in
  12 folders (to-dos with dates, links) and three long ones (70 sections, about 420 blocks each), imported from a
  ZIP once (`PERF_SEED=1`). Each run then measures, in Chromium at 1366 × 768 with the CPU slowed 4× (CDP):
  - signing in (password and authenticator code) to a usable Home, in a fresh browser;
  - a cold start on a slow network (150 ms latency, 1.6 Mbit/s down) with nothing cached, then a warm start;
  - opening notes from Home and from All notes (each adds a tab), switching tabs, a tab's hover preview, Tab
    Overview, three notes joined side by side, typing in a long note and in a joined pane, scrolling, Tasks,
    Calendar, Graph and Home;
  - for each: input to the first frame that shows the answer, until nothing animates, long tasks, React commits
    and the components each one rendered (a devtools hook, production builds too), style and layout work, script
    time, Convex socket messages; what runs while nothing happens; heap, DOM nodes and listeners; FCP, LCP, CLS,
    the JavaScript read at start and requests.
  ```
  PERF_STATE=<dir outside the repo> PERF_SEED=1 E2E_BASE_URL=http://app.localhost:3000 E2E_NO_SERVER=1 \
    npx playwright test e2e/web-perf.spec.ts --project account --workers=1          # once
  PERF_STATE=<same dir> PERF_OUT=<file.json> E2E_BASE_URL=http://app.localhost:3000 E2E_NO_SERVER=1 \
    npx playwright test e2e/web-perf.spec.ts --project account --workers=1          # each run
  ```
- Startup JavaScript per source: the chunks the app page's HTML lists, attributed through the build's source maps.
- Three runs before and three after, medians compared. Caveat: other sessions' builds and tests ran on this Mac
  throughout (load average 8 to 90), so times vary run to run by about ±10 %; counts (commits, components,
  bytes, listeners) don't.
- Visual check: 18 screens (Home light and dark, All notes, a card's menu, Move to folder opened twice, a folder's
  menu and Rename, a long note, its menu and Export, a tab's preview, Tab Overview, Tasks, Calendar, Graph, the
  app's and the site's 404) captured on the baseline build and on the final one with the clock fixed and
  animations finished, then compared pixel by pixel.

## What was found, and why

1. **The website loaded the native apps' and local mode's code at every start (3.4 MB, 45 files).** Two import
   chains, both through barrel modules:
   - `E2eeGate` → `components/e2ee/hooks.ts` re-exported from `@/lib/e2ee/router`, `migrate`, `features` and
     `links`. Those indexes bring the E2EE router client, the migration runner, the feature workers and the links,
     which share the local-mode functions: so every Standard account downloaded and ran the whole local-mode
     backend (`lib/local`, 264 KB), the AI prompts (78 KB) and the router, though `provider.tsx` was built so
     "Standard accounts never download the router".
   - `Shell` → `lib/engine/host.ts` (for one constant, `WEB_SETTINGS_SECTIONS`) → the native bridge's registry of
     every live view and command → Settings import, migration (`takeout` → local store), Vault keys.
   - `AccountGate` → `MigrationGate` (moving a library between the apps and an account) → fflate and the local
     store, though only the apps' built-in interface ever moves a library.
2. **A cold start on a slow network kept the CPU busy for its whole download.** While the rest of the code
   arrives, React re-renders the root from the top and suspends on the next missing piece, over and over
   (31,000 commits, about 3 s of script at 4× in a 4.5 s window, in Next's app router). React decides that, but the
   window lasts exactly as long as the start's JavaScript takes to arrive, so it shrinks with item 1.
3. **Home jumped after its first frame (CLS 0.25 on a warm start).** "Catch me up" was a lazy component with an
   empty fallback: Home painted without it, then everything below moved down 76 px when its code came.
4. **Closed dialogs everywhere.** Each note card's menu mounted its own Move to folder and Delete dialogs (closed),
   each folder's menu its Rename, New folder inside and Delete: about 300 dialog components on All notes and
   about 220 on Home, all rendered again whenever their row did; an open note re-rendered its Share, Delete, Move
   and Export dialogs with every update, and the editor its link, bookmark and image-search prompts.
5. **Every save re-rendered the whole note.** `DocumentView` subscribed to whether this note had saves on their
   way (`pendingForDoc`), which flips true and false with every save, only to time the idle version: the page, its
   header, editor, menus and sidebar (about 80 components) drew twice per save. It also subscribed to the whole
   outbox list, as did the folder tree hook and comments, for facts that only change with folder or comment
   actions.
6. **Smaller:** the block grip re-rendered on every mouse move over a note even on the same line; tab previews
   remounted up to six hidden preview frames at once each time the pointer came back to the strip; every date in a
   list built a new `Intl.DateTimeFormat`; in notes with page breaks, every Mermaid diagram and code preview drew
   again whenever the page-break mask moved (while typing above a break); `users.registerSession` rewrote the
   profile row on every app load, which re-runs every query that reads it (nearly all of them).

Checked and fine: idle CPU (no commits, timers or animation frames while nothing happens in any view), scrolling
(60 fps in long notes and lists at 4×), heavy libraries (Mermaid, KaTeX, pdf.js, mammoth, QR, chrono are all
loaded on demand), the tooltip layer, typing (no long tasks; keystroke to frame 23 ms median at 4×), the AI chat's
stream (a row per message, the list isn't re-sent per flush). The Calendar's idle layout work seen in one run
didn't reproduce, and Home's idle socket traffic is the device copy filling a new browser profile (intended).

## What changed

| Change | Files |
| --- | --- |
| E2EE hooks import leaf modules; the feature workers, migration runner and encrypted links load when an encrypted space first uses them. The consent dialog's store is its own module. | components/e2ee/hooks.ts, lib/e2ee/features/consent.ts (new), lib/e2ee/features/ai.ts |
| The native bridge host loads only in native chrome mode, starting with Shell's module there (no wait in the apps); `WEB_SETTINGS_SECTIONS` moved to its own module. | components/app/Shell.tsx, lib/engine/webSettings.ts (new), lib/engine/host.ts |
| The move-between-modes screens load only in the apps' built-in interface, starting with the module there. | components/migrate/MigrationGate.tsx (thin gate), MigrationMove.tsx (the screens, moved) |
| Catch me up is in Home's first frame; its Markdown drawing loads when a brief is asked for or one was kept this session. | components/ai/CatchUp.tsx, components/views/HomeDashboard.tsx |
| Rows' and the note's dialogs are drawn once each first opens, and kept after (`useOpenedOnce`): opening, closing and opening again work and animate exactly as before. | lib/hooks/useOpenedOnce.ts (new), views/DocumentBrowser.tsx, app/FolderMenu.tsx, doc/DocumentView.tsx, editor/EditorMenus.tsx |
| The idle version is timed outside rendering (`useIdleSnapshot`, same timing); the note reads single facts from the outbox (`useOutboxSelect`); the folder tree and comments only folder and comment changes (`useOutboxEntriesOf`). | lib/hooks/useIdleSnapshot.ts (new), lib/sync/queryCache.ts, doc/DocumentView.tsx, lib/app/folders.ts, doc/Comments.tsx |
| The block grip keeps its state while the pointer stays on the same line. | editor/EditorMenus.tsx |
| Tab previews forget their hidden pictures when the strip's preview closes. | app/TabStrip.tsx |
| One `Intl.DateTimeFormat` per set of options. | lib/format.ts |
| Diagrams draw again for the note's look (colours, palette, theme), not for its page-break mask. | editor/richRender.ts |
| `registerSession` refreshes "last active" at most once a minute, as `heartbeat` already did. | convex/users.ts |

Tried and taken back (no gain): loading the marketing 404 page with `next/dynamic` (Next keeps the root
not-found boundary's client code and `marketing.css`, 41 KB, in every page anyway), and loading the phone shell and
its Home on demand (8 KB: the desktop Tasks, Calendar and list views import most of the phone components).

## Before and after (measured)

Medians of three runs each, Chromium, CPU 4× slower, 1366 × 768, production build. "After" is the build with
every change but the last two (the diagram watcher and lint fixes, which the measured flows don't exercise).

Start:

| | Before | After | |
| --- | --- | --- | --- |
| JavaScript read at start (app page, raw / gzip) | 3,383 / 1,084 KB, 45 files | 2,192 / 709 KB, 39 files | −35 % |
| Cold start, slow network: FCP | 7,684 ms | 5,576 ms | −27 % |
| Cold start: LCP | 9,944 ms | 7,732 ms | −22 % |
| Cold start: Home usable | 12,156 ms | 9,979 ms | −18 % |
| Cold start: script time | 4,090 ms | 2,358 ms | −42 % |
| Cold start: bytes transferred (JS) | 1,062 KB | 684 KB | −36 % |
| Cold start: React commits | 31,119 | 19,039 | −39 % |
| Warm start: CLS | 0.253 | 0.007 | −97 % |
| Warm start: FCP / LCP | 1,204 / 3,028 ms | 1,000 / 2,768 ms | −17 % / −9 % |
| Warm start: script time / long tasks | 603 / 565 ms | 424 / 392 ms | −30 % / −31 % |
| Sign in to Home: script time | 576 ms | 409 ms | −29 % |

By area, startup JavaScript: local-mode library 264 → 11 KB, E2EE 230 → 68 KB, native bridge 169 → 11 KB, AI
prompts 78 → 0, Vault 21 → 0, import 17 → 0, local store 66 → 26 KB.

Interactions (input to the first frame that shows it; components rendered):

| | Before | After |
| --- | --- | --- |
| Open a note from Home | 369 ms, 878 | 303 ms (−18 %), 769 (−12 %) |
| Home tab from a note | 241 ms, 2,375 | 177 ms (−27 %), 1,735 (−27 %) |
| All notes | 217 ms, 1,791 | 155 ms (−29 %), 1,327 (−26 %) |
| Open a note from All notes | 132 to 266 ms | 117 to 267 ms (up to −21 %), −10 to −29 % components |
| Switch tabs (4 switches) | 109 to 209 ms | 93 to 176 ms (−10 to −16 %), −10 to −21 % components |
| Open three joined notes | 337 ms, 1,761 | 288 ms (−15 %), 1,296 (−26 %) |
| Tasks / Calendar | 54 / 74 ms | 39 / 59 ms |
| Graph, tab preview, Tab Overview | unchanged within noise | |

Typing (48 keys in a long note; 29 in a joined pane): components rendered per key 18.9 → 14.1 (−25 %) and 22.7 →
12.7 (−44 %), script per key 7.5 → 6.4 ms and 6.4 → 5.3 ms; keystroke to frame unchanged (23 ms median, 31 ms
95th percentile). Memory: Home's event listeners 1,281 → 822 (−36 %), at the end of the run 1,613 → 1,084 (−33 %),
heap −1 to −1.5 MB (−5 to −10 %). Idle: no commits, timers or frames in any view before and after. Scrolling:
unchanged (60 fps).

Not measured, expected: the diagram watcher saves a Mermaid redraw (tens to hundreds of ms on a slow CPU) each
time a line is added above a page break in a note with diagrams; the date formatters save about 0.1 to 0.5 ms
per older note per list render; `registerSession` saves every signed-in query running a second time at each app
load (server time, and other people's views that read this profile).

## What helps low-spec computers

- A third less JavaScript to download, parse and compile at every start, and none of the native apps' or local
  mode's: on a slow CPU, parse and compile time is what you wait for, and on a slow link the download is.
- The cold-start spin (React retrying while code arrives) lasts as long as the download, so it's shorter too.
- Fewer components rendered per action and per keystroke, and about 450 fewer event listeners on Home: less
  script per frame on a dual-core CPU, and less memory held.
- Home no longer moves under the pointer after it appears.

## Regression checks

- `pnpm test` (all workspaces): web 1,378 passed (1 skipped), Convex and root 1,120, editor-schema 464, local-store
  172, email 198, cloud-folders 78, ai-prompts 33. New: test/idle-snapshot.test.tsx, test/rich-render-theme.test.ts,
  test/format-dates.test.ts.
- `tsc --noEmit` clean; ESLint clean on every changed file (the warnings it prints are on lines not touched).
- Visual: 18 screens, 0 differing pixels between the baseline and final builds.
- e2e on the final production build (account mode, development backend): e2ee-setup, e2ee-switches (the consent
  dialog, the feature workers now loaded on demand, mirrors, apps, email to note), e2ee-unlock, e2ee-link,
  version-history, copy-to, comments-tab, documents, a11y (axe, light, dark and the iPhone app), tab-strip-overflow
  and the second tab-switch test: all pass. Four tests fail the same way on the untouched baseline build in this
  setup, so they aren't from this pass: home-editor (a production build's `/api/signed-in` check counts as an
  outside request), both tab-menu tests (the Home tab's empty text in a production build) and tab-switch's
  placeholder check (the loading placeholder shows during a switch, on both builds).
- On the shell's development server (`FOLEVI_BUILD=shell`): native-chrome (the bridge host, now loaded on demand:
  live views, commands, the note page, the first-launch gate) and local-mode (6 tests, with axe) pass. New unit test
  test/migration-gate.test.tsx covers the move-between-modes gate.

## Follow-up (same day, after the Mac 1.2.04 release landed on main)

- **Foli AI chat**: the messages are a memoised list whose actions go through a ref, so typing in the box draws
  the box only (before: every message per letter; `test/chat-thread-typing.test.tsx`).
- **Tab strip**: each tab is a memoised row of plain values (the tabs are parsed afresh from storage on every
  change, so the objects are always new); its actions go through a ref.
- **Joined notes**: each note's context comes from a memoised `PaneBody` in `NotePanes`, so a resize or a pane
  dragged past it doesn't draw it again. Dragging the divider over 8 pointer moves: 1,184 components drawn before,
  24 after.
- **Tabs context**: `useDocTab` and `useViewTab` read a context of stable actions and the shell's warm notes their
  own, so a tab change no longer draws every open note and view again; the provider re-applies each page's
  `place()` when the tabs change, as the page's effect did (`test/tabs.test.tsx`). `NativeTabsProvider` provides
  the actions too; `useTabs()` is unchanged.

Measured as before (medians of three, 4x CPU, the old and new builds run alternately), components drawn:

| Interaction | Before | After |
| --- | --- | --- |
| All notes | 1,327 | 946 (−29 %) |
| Switch tab (four notes) | 932 to 1,506 | 843 to 1,131 (−2 to −26 %) |
| Tab preview (hover) | 59 | 23 |
| Tasks, Calendar, Graph, Home | 515, 679, 1,307, 2,234 | 428, 490, 686, 1,384 |

Timings moved within the runs' noise (the slow run followed run order, not the build), except All notes (204 to
170 ms to first frame) and opening notes from it (up to 29 ms sooner).

Looked at and left: the answer stream re-reads the whole answer at each step of the reveal, but that is 0.27 ms
for an 8 KB answer (about 1 ms at 4x) and only the one answer draws; the stream's rewrite of the whole text is
about 90 KB over a long answer. The Convex reads below need new indexes (built on production data when deployed),
so they wait for the owner.

## Still to do

- **The root 404 page's code and styles in every page** (marketing shell, art and `marketing.css`, about 80 KB).
  `global-not-found.js` alone doesn't help: `(app)/[...path]` matches every address and calls `notFound()` for an
  unknown one, so nearly every 404 (both hosts) goes through the root `not-found.tsx`, never "no route matched".
  Taking the marketing shell out of it needs either explicit product routes (a folder per `APP_ROUTE_HEADS` entry,
  about 30, instead of the catch-all, so unknown addresses reach `global-not-found`) or the proxy sending the
  marketing host's unknown addresses to a marketing page that calls `notFound()`. Both change routing; the
  owner's call.
- **Convex reads**: All notes and Home's recent notes walk `by_*_trash` and filter (no index for listed notes by
  last edit); Starred loads every starred note to show 8; Graph reads about 9,600 rows per run; the sidebar's
  Changes list re-subscribes with each note opened. None showed in this library's timings; they grow with
  libraries.
- Remaining startup weight: `editor-schema`'s validation brings every block kind's validator (flowchart, chart,
  wireframe, stickies: about 150 KB) to the start; the E2EE key session and noble crypto (about 130 KB) come for
  the unlock check.
