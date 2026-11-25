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

1. **The local library copied every row on every read.** `LibraryStore.get`, `list` and `blocksOfTypes`
   (`lib/local/store/libraryStore.ts`) returned `structuredClone` of each row, so a `list("documents")` copied
   all 5,000 notes with their search text on each query: 865 ms of a Calendar click (profile), most of Tasks and
   Home, and the start's list. Rows are now frozen once when they enter the store (loaded or written) and handed
   out as they are; nothing in the local functions changed a row it read (the full unit suite passes with frozen
   rows, where any such write would throw). Applies to every local-mode library: Mac, iPhone, iPad, Android,
   Windows.
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

### What's left (in order)

- Desktop CLS 0.114 on All notes (before too): find the shifting element.
- Desktop Home click (~500 ms) and All notes (~300 ms): mostly style and layout of the new view (note cards with
  container queries and color-mix) plus each card measuring its lines (`useFitLines`).
- Listeners grow by about 8 per note opened and closed.
- From the web audit, not done yet: the sync engine keeping every opened note's blocks (memory), validators for
  every block kind in the start (`editor-schema` 233 KB), browsers' warm start without waiting for `me`, the
  note page's whole-note work per save echo, the first list read of the whole scope from IndexedDB.
