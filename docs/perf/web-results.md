# Web app performance, 2026-11-25

The web part of the performance pass (docs/perf/PERF_PASS_2026-11-25.md): the web app the browser, Mac, iPhone,
iPad, Android and Windows apps all show (`apps/web`).

## How it's measured

- **`apps/web/perf/web-perf.spec.ts`** (`npx playwright test -c perf/playwright.config.ts`, run from `apps/web`):
  headless Chromium only, nothing on the desktop. It serves the production shell export (`node
  scripts/build-shell.mjs --no-copy`, `out-shell/`; the same components the website shows) the way the apps serve
  it, in local mode: the test FakeShell keeps the library in the browser profile, so no backend or account is
  involved, and the network guard fails the run if the page contacts Folevi or Convex.
- **The library** (`perf/library.ts`): 5,000 notes in 200 folders, 2,000 open tasks with due dates, links between
  notes, 20 long notes (about 420 blocks each, with images). Imported once through Settings > Data in batches of
  400 (the importer's limit) into a Chromium profile kept in `PERF_STATE` (outside the repository), so every run
  measures the same library. Never the owner's library.
- **CPU slowed 4×** (CDP), at two widths: desktop 1440 × 900 and phone 390 × 844 (touch, the phone interface).
- **What each run records**, per width: start on All notes (LCP, CLS, FCP, long tasks; cache cleared, then warm);
  note open (click in All notes to the opened note's editor taking keys with text, 10 notes); INP from Event
  Timing (typing in a note; clicking Tasks, All notes, Home, Calendar in the sidebar, each click reported on its
  own); rAF frame gaps while scrolling All notes and Tasks; JS heap, DOM nodes and listeners before and after
  opening and closing 20 notes (after two garbage collections); JavaScript downloaded by a cold load of each route.
  `PERF_OUT=<file>` saves the JSON.
- **Why the start JavaScript is what it is**: `perf/startup-js.mjs` attributes the chunks a page's HTML lists to
  source files through source maps (`FOLEVI_SOURCEMAPS=1` builds), for the shell export or, with `--html` and
  `--static`, a website page from `next start`. `perf/import-chain.mjs <entry> <target>` prints the static import
  chain that puts a module in a bundle. `PERF_PROFILE=1` saves CPU profiles of the starts and the sidebar clicks;
  `perf/profile-summary.mjs` maps them to source files and functions.
- **Guard**: `test/startup-imports.test.ts` fails if the app page's static imports reach local mode's backend,
  the library move code, the phone interface's shell or the note editor again.
- **Caveats**: one Mac, with other sessions' builds and tests running at times, so times vary by about ±10 % run
  to run; byte counts don't. Headless Chromium's frame timing (software compositing) is a trend, not a device
  figure. Nothing here was measured on real hardware.

## Results

Times in ms at 4× CPU slow-down with 5,000 notes; "before" is the export of main at 59c2d117, "after" the same
library on this branch, measured back to back. Other sessions' builds ran on this Mac during both runs (load
average 13 to 50), so single times move by 20 % or more between runs; the direction and the byte counts are
solid. Before figures come from the clean re-run (`base3`); the very first baseline run, on a quieter machine, had
desktop LCP 3.4 s, phone 2.5 to 2.7 s.

### PR 1: start-up code and the local library's reads

| Target | Desktop before | Desktop after | Phone before | Phone after |
| --- | --- | --- | --- | --- |
| LCP < 2.5 s (cold / warm) | 3,152 / 3,360 | 2,692 / 3,104 | 4,240 / 3,988 | 1,852 / 1,548 |
| Long tasks during start (ms) | 2,358 | 1,756 | 2,546 | 754 |
| CLS < 0.1 | 0.114 | 0.114 | 0 | 0 |
| Note open < 300 ms, keyboard (p50 / p95) | 688 / 726 | 251 / 305 | 801 / 1,066 | 223 / 303 |
| Note open, mouse (p50) | 9 | 7 | 10 | 11 |
| INP, typing in a long note (p95 / max) | 104 / 1,040 | 96 / 128 | 24 / 56 | 32 / 56 |
| INP, sidebar: Tasks | 520 | 152 | 1,128 | 128 |
| INP, sidebar: Home | 920 | 512 | 296 | 128 |
| INP, sidebar: Calendar | 1,432 | 320 | 2,472 | 216 |
| INP, sidebar: All notes (worst) | 440 | 304 | n/a | n/a |
| Scrolling All notes / Tasks (average fps) | 37 / 40 | 46 / 51 | 58 / 60 | 60 / 60 |
| Heap after opening and closing 20 notes | +2.2 MB | +3.9 MB | +2.9 MB | +5.2 MB |
| Website app page, start-up JS (raw / gzip) | 2,813 KB / 902 KB | 2,165 KB / 698 KB | same | same |

Website "before" bytes are the coordinating session's audit build of main; "after" is `next build` of this branch,
the chunks `/documents` lists (`perf/startup-js.mjs --html`). Mouse note opens are near zero both times: the
pointer hovering a card warms its note before the click, so the keyboard figure is the honest one. Heap growth
was higher after in this one pair of runs (+3.9 and +5.2 MB against +2.2 and +2.9 MB); DOM nodes stay flat both
times and listeners grow by about 8 per opened note both times. Not explained yet: rechecked in the next PR.

What changed and why:

1. **The local library copied every row on every read.** `LibraryStore.list` and `blocksOfTypes`
   (`lib/local/store/libraryStore.ts`) returned `structuredClone` of each row, so a `list("documents")` copied
   all 5,000 notes with their search text on each query: 865 ms of a Calendar click (profile), most of Tasks and
   Home, and the start's list. Rows are now frozen once when they enter the store (loaded or written) and the
   whole-table reads hand them out as they are; nothing that lists rows changes them (the web unit suite and the
   repository's parity and Convex suites pass with frozen rows, where any such write would throw). `get` still
   copies its one row: the library move fills its saved progress in place (the parity suite caught it). Applies
   to every local-mode library: Mac, iPhone, iPad, Android, Windows.
2. **Local mode's backend was back in the website's start** (a regression of the 2026-10-29 fix):
   `DesktopCapabilities` imported one event emitter from `lib/engine/viewsSettings.ts`, which imports takeout
   import, migration targets and through them `lib/local/backend` (functions, store, AI prompts, about 590 KB).
   The emitter is in its own file (`lib/engine/desktopChanged.ts`).
3. **Moving notes between places** (`components/places/MovePlaces.tsx`, on every start through `AccountGate`
   and `Shell`) brought `lib/migrate` (copy, targets) and the local store's crypto. The start keeps only opening
   the dialog and the gate; the dialog and the move (`MovePlacesDialog.tsx`) load when one opens or runs.
4. **The phone interface was in every window's start** (about 100 KB). Its screens are one module
   (`components/iphone/phone.ts`) loaded through `components/iphone/lazy.tsx`: a narrow window starts it at once
   (module load), a wide one never downloads it. Its shell, Quick Add and search scopes show nothing for the moment
   the code takes to arrive the first time a window turns narrow; screens inside the shell render synchronously as
   before. Shared pieces (Sheet, Glass, SettingsKit, Grouped, Swipe) stay where they were.
5. **Guard**: `test/startup-imports.test.ts` (fails on the old code).

### PR 2: the sidebar's layout shift, memory checked

Same library and settings, a quieter machine (load average 8 to 16), so this run's times are lower across the board;
compare the CLS and memory rows, which don't depend on load.

| Target | Desktop | Phone |
| --- | --- | --- |
| LCP < 2.5 s (cold / warm) | 1,696 / 1,532 | 1,720 / 1,444 |
| CLS < 0.1 | 0.114 → 0.001 | 0 |
| Note open < 300 ms, keyboard (p50 / p95) | 211 / 226 | 208 / 272 |
| INP, typing in a long note (p95 / max) | 32 / 48 | 48 / 56 |
| INP, sidebar clicks (Tasks, Home, Calendar, All notes worst) | 120, 280, 200, 304 | 112, 104, 176, n/a |
| Scrolling All notes / Tasks (average fps) | 57 / 59 | 60 / 60 |
| Heap, opening and closing notes 1 to 20 / 21 to 40 | +3.8 / +3.4 MB | +4.9 / +3.4 MB |

1. **CLS 0.114 on desktop, every start**: the sidebar drew Templates, Folders, Tags, Archive and Trash before the
   rows above them were known; when the Vault row and the folder list arrived they all moved down 34 px (and the
   folder section grew from its "No folders yet" line). Those rows now wait for the Vault query and the folder
   tree, at most 1.5 s (`useSettled` in `components/app/Sidebar.tsx`), so new rows appear instead of old ones
   moving. Visible change: the lower sidebar appears a moment after the top on a cold start.
2. **Memory**: heap grows by about 3.4 MB per 20 notes opened and closed, at the same rate from 20 to 40, while
   DOM nodes and listeners stay flat. Heap snapshots after 20 and 40 notes (`PERF_HEAP=1`, `perf/heap-diff.mjs`)
   put the growth in V8's compiled code (each code path compiled once, bounded) and in about 2,900
   `FileSystemFileHandle`s held by the test FakeShell's OPFS reads (the harness; the apps' native shells don't use
   OPFS); strings went down. No per-note leak found in the app's code in local mode. Not measured: account mode
   (the sync engine's block cache, from the web audit), which needs a backend.

### PR 3: All notes and Home clicks

A Chromium trace of each sidebar click (`PERF_TRACE=1`) splits it: the click's own task (React rendering the new
view synchronously, since the router reads the address with `useSyncExternalStore`) was 190 to 290 ms at 4×, with
style, layout and paint after it. Inside the script, React itself and each card measuring its lines were the
biggest app-side parts; on Home also the local `recentFolders` query.

1. **The note grid draws the first 24 cards with the click** and the rest of the page (48) in a transition right
   after (`DocumentBrowser.tsx`, `FIRST_CARDS`); per list, so going from All notes to a folder starts over. 24 is
   more than a large screen shows before scrolling.
2. **Home draws 7 cards per row with the click** (a wide screen shows about 6 of the 10) and the recent-folder
   cards, its last section, right after (`HomeDashboard.tsx`). Nothing sits below the folders, so nothing moves.
3. **Cards stop rendering twice.** Each card started at 12 lines, measured the room for its text and drew again;
   it now starts from what the last card with that title measured (else the last of any), so the measure usually
   finds the same number and React skips the second render (`useFitLines`, `DocumentCard.tsx`).
4. **Local folder queries**: `organization.index` and `recentFolders` filtered every note once per folder (200 ×
   5,000); notes are grouped by folder in one pass (`lib/local/functions/organization.ts`).

Desktop sidebar clicks, INP in ms at 4× CPU (before is PR 2's run):

| Click | PR 2 | PR 3 |
| --- | --- | --- |
| Tasks | 120 | 136 |
| All notes (worst of three) | 304 | 168 |
| Home | 280 | 152 |
| Calendar | 200 | 224 |

Same run, load average about 15: desktop LCP 1,628 / 1,556 ms (cold / warm), phone 1,692 / 1,716; keyboard note
open 245 ms desktop, 233 ms phone (p50); phone clicks Tasks 160, Home 152, Calendar 224. Calendar (not changed
here) stays just over 200 ms at 4× on both widths; typing stayed under 70 ms at p95 (one 288 ms key on desktop).

### What's left (in order)

- The rest of each click is style, layout and paint of the new view (note cards with container queries and
  color-mix); lowering it further would mean changing how cards are drawn.
- From the web audit, not done yet: the sync engine keeping every opened note's blocks (memory), validators for
  every block kind in the start (`editor-schema` 233 KB), browsers' warm start without waiting for `me`, the
  note page's whole-note work per save echo, the first list read of the whole scope from IndexedDB.
