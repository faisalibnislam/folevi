# How the app feels signed in, 2026-11-26

The owner found the web app and the Mac app sluggish. The 2026-11-25 pass (`web-results.md`, `apple-results.md`)
measured local mode with a 5,000-note library in Chromium at a quarter of the CPU. This pass measures the other half:
an account (Convex over a WebSocket) with a small library, at full speed, with the backend near and far, which is
how the owner uses Folevi.

## What the network looks like from the owner's Mac (2026-11-26, curl)

| Request | Time to first byte |
| --- | --- |
| Convex (`fastidious-clownfish-123.convex.cloud`) | 280 to 370 ms |
| A website page (`app.folevi.com/signin`, `/documents`) | 440 to 770 ms (rendered per request in iad1, served via bom1) |
| The website's auth routes (`/api/auth/*`, Vercel to Convex) | 590 to 1,010 ms |

So every wait on the server is a third of a second or more, and the website's own pages and auth calls two to three
times that. This is the sluggishness: the code mostly waits on the network, not on the CPU.

## How it's measured

- `apps/web/perf/feel.spec.ts` (`npx playwright test -c perf/feel.config.ts`, from `apps/web`): headless Chromium,
  nothing on the desktop. A new test account on the local Convex backend (never the owner's data) with 300 seeded
  notes, 12 folders, 8 tags, then per distance: three reloads of All notes, sidebar clicks (each view twice), three
  task check-offs, and three notes opened by keyboard and closed with Back, twice. For each input: the first change on
  the page, the frame its answer shows, and when the page goes quiet; `late` names what changed more than 80 ms after
  the input.
- `apps/web/perf/latency-proxy.mjs`: a relay in front of the local backend that adds a fixed delay each way. 130 ms
  each way = a 260 ms round trip, about what the owner has to Convex. Set at run time (`?ms=`), so one build is
  measured near and far. Setup is in the spec's header.
- The Mac app itself (owner's OK, 2026-11-26): `apps/mac/scripts/perf-feel.mjs`, the Debug app before and after
  (same Swift and web code as `main` at 135a99af, and this branch), each on a scratch data folder, signed in to a
  test account with 300 notes on the development deployment (a session from `perf/test-account.ts` handed over with
  the Debug `test-session` command; Debug Keychain items only, removed afterwards). Everything was driven through
  the page, no mouse or keyboard. Real network: the development deployment answers in about 270 ms from this Mac, like
  production. A local backend can't be used here: the app's page is a secure page and WebKit refuses it a plain
  `ws://` connection.

## Results (Chromium, full speed, 300 notes; before = `main` at 135a99af, after = this branch)

| At a 260 ms round trip | Before | After |
| --- | --- | --- |
| Reload of All notes to the first note on screen (3 runs) | 1,185 / 1,030 / 1,047 ms | 907 / 745 / 781 ms |
| Check a task off, click to the box showing it | 404 / 346 / 346 ms | 229 / 15 / 14 ms |
| Open a note, keypress to its editor | 10 to 13 ms | 10 to 13 ms (already instant) |
| Sidebar: Tasks, Home, Calendar (second visit) | 13 to 31 ms | 12 to 31 ms (already instant) |

Next to the backend (no delay): reload 262 to 415 ms before, 254 to 334 after; task check-off 96 to 163 ms before,
12 to 13 after. The first check-off after opening Tasks (229 ms) still waits: the list on screen is the copy kept on
this device until the live one arrives, and an optimistic change can only be made to the live one.

### The Mac app (WebKit, signed in, real network, 3 runs each)

| | Before | After |
| --- | --- | --- |
| Check a task off, click to the box showing it (9 clicks) | 708 to 1,113 ms | 3 to 9 ms |
| The app handing a page its Convex token (9 asks) | 483 to 745 ms | 1 to 11 ms |
| A new window's token (what its live data waits for) | 574 to 671 ms | 2 to 82 ms |
| A new window, to its first note on screen | 415 to 429 ms | 423 to 649 ms (from the device's copy both times; noise) |
| Launch to the first note on screen (warm) | 976 to 1,163 ms | 981 to 1,355 ms (unchanged: drawn from the device's copy) |
| Scrolling All notes, frame gaps p95 / slowest | 18 to 19 / 55 to 66 ms | 18 / 56 to 59 ms (60 fps both) |

The check-off is slower in the Mac app than in the Chromium run (about 0.7 s, not 0.35 s) because the real
development deployment is further than the relay's 260 ms. Scrolling was measured on a short list (one screen and a
half of cards) and shows no difference either way: the blur change is not shown to matter there. Launch and a new
window's first note don't change because both already draw from the device's copy; what the kept token changes is
how soon that window's data goes live (about 0.6 s sooner).

Already instant before this pass, so nobody needs to look again: opening a note (blocks come from the engine and the
device copy, warmed on hover), sidebar views (kept answers), creating a note, typing, folder changes and note moves
(the outbox). On All notes the count line ("24 notes") is the one thing that changes a round trip later.

## What changed

1. **Clicks that waited for the server now show at once** (`lib/convex/optimistic.ts`, `test/optimistic.test.ts`).
   Checking a task off or reopening it (Tasks, Calendar, the iPhone screens, the desktop menu), bookmarking and
   unbookmarking, archiving, trashing, restoring and deleting notes (a card's menu, multi-select, a note's own menu)
   change the lists and the note on screen at the click, as Convex optimistic updates: the server's answer replaces
   them, and a refusal takes the change back by itself. Before, each one changed only after a round trip (350 to
   400 ms from the owner's Mac).
2. **One round trip less on every start** (`AccountGate.tsx`): the workspaces list is asked for with `me` instead
   of after it (AppStateProvider needs both before the app shows).
3. **No backdrop blur on the content panel** (`globals.css` `.ui-content`): it's 90 % opaque over the ambient
   light, which is already a blur, so blurring it again changed nothing visible, while making the browser keep a
   blurred copy of everything under the largest surface in the window (with the tab bar's blur nested inside). The
   saving should be largest in WebKit (Safari and the Mac app) while scrolling; not measured (see above). Menus,
   popovers, the sidebar and the tab bar keep their glass.
4. **Mac and iPhone/iPad: the Convex token is kept for the next page** (`ShellAuth.convexToken`, `shell-bridge.js`,
   `lib/convex/provider.tsx`). Every window, floating note and Quick Add page asked the website for a token as it
   opened (two hops, about 0.7 s from the owner's Mac) before its live data could start. A token got in the last few
   minutes is handed to the next page while it has more than 5 minutes left; Convex's own renewals (`fresh`) always
   ask the website; signing out forgets it. Hosts that predate it ignore the flag.
5. **Mac: no main-thread disk and Keychain work twice per save** (`PlacesReporter.tsx`). The page told the app how
   many edits wait to sync as the number changed, 0 to 1 to 0 on every save; each time the app wrote its places
   file, mirrored it to the Keychain and messaged every window, on its main thread. The number is now reported once
   it has held for 2 s (edits that really wait still show).
6. **Mac: switching places no longer boots a second copy of the app at the same moment** (`BackgroundSync.setWanted`):
   the place just left starts its background runner 3 s later, after the page in front has had its start.
7. **Mac: Quick Add opens warm for 10 minutes after it closes** instead of 1 (`QuickAddPanel.releaseAfter`); memory
   pressure still lets its page go at once (`Memory.relieve`).

## Not done, in order of what it would give

- **The website's pages are rendered per request in Washington** (iad1) because their security policy carries a
  per-request nonce (`proxy.ts` `NONCE_ROUTES`), so each load or reload of the website waits 0.45 to 0.75 s for its
  HTML from the owner's location before anything starts. Serving the app's pages statically from Vercel's edge with a
  hash-based policy would cut most of that; it changes how the Content Security Policy works, so it needs its own
  careful change and review. The apps are not affected (their pages are on the device).
- **Browsers block on `me` at every start** ("Opening your folio…"); the Mac and iPhone apps already start from the
  saved snapshot. Allowing the snapshot in a browser tab whose pinned account matches the last one would remove the
  wait; it needs care for several accounts in one browser.
- More clicks could show at once the same way: tags on a note, a manual reorder, marking notifications read.
- The sidebar keeps about 30 live queries; `documents.recentNotes` is subscribed with four different limits and
  `changes.list` starts a new subscription for every note opened (`exclude: route.id`). Sharing them would cut
  server work per save.
- A spare, already started web view for the next Mac window (each new window or floating note starts the whole
  web app); the note sheet's 240 ms settle animation on every note open; one ResizeObserver per note grid instead of
  per card.
