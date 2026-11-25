# Backend performance results (Convex), 2026-11-25

Part of the performance pass (`docs/perf/PERF_PASS_2026-11-25.md`, "Backend findings"). This file records what
the hot backend functions read for a large library, before and after each fix.

## Method

- Library: `convex/lib/fakeLibrary.ts`, generated and deterministic: 5,000 notes (about 600 in Drafts, the
  rest in 200 folders, skewed so the biggest folder holds 300), 200 folders (some nested), 2,000 tasks on 500
  notes (about 30% done), 50 long notes (about 32,000 characters and 5 images each), 30 tags, 60 stars. Seeded
  into the Personal of a test account through `createDocument`, so derived text, tasks and counts are real.
- Seeding a deployment: `convex/devSeed.ts` (internal functions, refused on production and for any address that
  isn't `@example.com`). On a development or local deployment, sign in once as e.g. `perf@example.com`, then
  `npx convex run devSeed:seedLibrary '{"email":"perf@example.com"}'`.
- Measuring: `tests/convex/perf/library.test.ts` (`FOLEVI_PERF=1 pnpm vitest run --project convex
  tests/convex/perf/library.test.ts`). It seeds the library into convex-test with Convex's transaction limits
  on, then calls each function once as the library's owner and records convex-test's transaction metrics:
  documents read, bytes read (document sizes as Convex counts them) and index ranges. A function over a limit
  (16 MiB or 32,000 documents read) fails there as it would in production.
- What these numbers are: reads per call, which is what Convex bills and what limits a query. They are not wall
  time on a deployment: the "ms" column is the in-memory test backend's time, useful only to compare runs on
  this Mac. A function that is a live subscription runs again whenever anything it read changes, so its cost
  is paid again on every change to those rows ("re-runs" below).
- Not measured here: a deployment's own timings (insights, logs). The dev deployment is shared with other
  sessions and this worktree has no Convex link; production is read-only and holds no test data.

## Baseline (main at 59c2d117, 5,012 notes: the library plus the welcome notes)

| Function | Docs read | Bytes read | Index ranges | ms (convex-test) | Result |
|---|---:|---:|---:|---:|---|
| organization.sidebar | 237 | 66.8 KB | 5 | 59 | ok |
| organization.index (folders) | 4584 | 13.01 MB | 206 | 2461 | ok |
| organization.index (tags) | 752 | 146.1 KB | 36 | 275 | ok |
| organization.recentFolders (6) | 952 | 2.33 MB | 212 | 2489 | ok |
| organization.draftCount | 630 | 1.62 MB | 4 | 46 | ok |
| documents.list all (50) | 227 | 202.0 KB | 132 | 428 | ok |
| documents.list unsorted (50) | 149 | 160.7 KB | 56 | 497 | ok |
| documents.list starred (50) | 238 | 201.1 KB | 190 | 394 | ok |
| documents.list folder (300 notes, 50) | 405 | 992.8 KB | 59 | 423 | ok |
| documents.list tag (50) | 213 | 107.0 KB | 99 | 221 | ok |
| tasks.list inbox | 1365 | 1.44 MB | 366 | 61 | ok |
| tasks.list today | 1316 | 1.28 MB | 317 | 63 | ok |
| tasks.list upcoming | 1003 | 390.9 KB | 4 | 39 | ok |
| tasks.list all | 1476 | 1.75 MB | 477 | 63 | ok |
| tasks.list completed | 328 | 451.9 KB | 130 | 42 | ok |
| tasks.range (a month) | 136 | 217.6 KB | 68 | 30 | ok |
| changes.list | 3 | 986 B | 4 | 24 | ok |
| search.documents 'project' | 188 | 423.9 KB | 31 | 208 | ok |
| sync.manifest (first page) | 733 | 1.08 MB | 434 | 11085 | ok |
| documents.get (long note) | 11 | 37.5 KB | 12 | 44 | ok |
| blocks.list (long note) | 169 | 140.6 KB | 5 | 80 | ok |
| documents.get (short note) | 9 | 5.0 KB | 11 | 46 | ok |
| blocks.list (short note) | 13 | 7.5 KB | 5 | 64 | ok |

What it confirms from the static audit:

- `organization.index` (always on in the sidebar with the "Recent" folder sort, the Folders page, iPhone Home)
  reads every listed note of every folder: 13 MB per run at 5,000 notes, 81% of Convex's 16 MiB read limit.
  A library a little larger, or with longer notes, fails outright. It runs again on any edit in any folder.
- `organization.recentFolders` (Home) 2.3 MB and `organization.draftCount` (always on) 1.6 MB: whole note rows
  for a count.
- Task lists read a full note row per task's note (`present()`): 1,300 to 1,500 documents and up to 1.75 MB per
  view. The "upcoming" view stops at 1,000 open tasks (`take(1000)`), so lists and counts are wrong past that.
- Most of those bytes are note text (`searchText`, up to 32,000 characters) that the lists never show.
- `changes.list` is cheap here because a Personal has no other editors; its cost is in shared notes (it reads
  the 60 most recently opened notes and their changed lines). See the Changes section below.
- Opening a note (`documents.get` plus `blocks.list`) is small even for the longest notes (under 200 KB).

## Fixes

(Each fix adds its before/after numbers here.)
