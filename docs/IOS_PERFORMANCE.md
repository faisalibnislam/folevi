# iPhone and iPad app performance (2026-10-24)

The owner, on an iPhone 16 Pro Max: "the app on iPhone feels sluggish ... everything actually" (opening the app,
tapping buttons, scrolling, typing, switching notes, menus and sheets). The phone is fast, so the causes are
systemic. The phone couldn't be connected for this pass: everything below was measured on this Mac, in the iOS
Simulator (the real app, WKWebView) and with Playwright against the export the app carries. What still needs the
real phone is at the end.

## How it's measured

- **The export the app carries**, not `next dev`: `node scripts/build-shell.mjs --platform ios --no-copy`, served
  the way the app serves it (`node scripts/serve-shell.mjs 4320 .next-shell-ios`).
- **`e2e/iphone-perf.spec.ts`** drives the iPhone interface in local mode (a FakeShell, the starter library, the
  iPhone 16 Pro Max's 440 × 956 window, the app's markers and bridge) and records, in the page: tap (pointerdown)
  to the first frame that shows the answer, until no animation runs, late frames while it moves, Event Timing for
  every input, long tasks, React commits and the components each rendered (a devtools hook, production builds
  too), Chromium's style and layout counters, frame gaps while scrolling, and everything that runs while nobody
  touches the page. A long note is made by pasting 420 blocks.
  - Chromium with the CPU slowed 4× (CDP) and WebKit (the app's engine, unthrottled; no CDP counters there).
  - `PERF_OUT=<file>` saves the numbers, `PERF_CSS=<css>` adds CSS for experiments (what an effect costs),
    `PERF_BUDGETS=0` skips the budgets.
  ```
  E2E_LOCAL_BASE_URL=http://127.0.0.1:4320 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
    npx playwright test e2e/iphone-perf.spec.ts --project local          # Chromium, 4× slower CPU
    npx playwright test e2e/iphone-perf.spec.ts --project iphone-webkit  # WebKit
  ```
- **The Simulator** (iPhone 18 Pro Max, iOS 27, Debug build): `simctl launch` timing, the page's navigation and
  paint timing read back through the Debug eval hook (`node apps/ios/scripts/simulator.mjs eval`), and the native
  bridge calls from Capacitor's console.
- Caveat: other work ran on this Mac at the same time (load average 8 to 15), so single runs vary by ±20 %. The
  counts (commits, components, layouts) don't vary; the times are best read as several runs.

## Baseline (main at 7defc211)

How the app loads: **bundled** (the shell export in the app, served from `capacitor://localhost` by Capacitor's
scheme handler), not app.folevi.com, so no navigation goes to the network. 3.4 MB of JavaScript (uncompressed) is
read at start.

| Interaction | Chromium 4×: first frame / settled (ms) | WebKit: first frame / settled (ms) |
| --- | --- | --- |
| Open a note from Home | 296 / 932 (long tasks 321) | 201 / 754 |
| Back to Home | 112 / 749 | 113 / 673 |
| Push All notes | 78 / 714 | 89 / 658 |
| Open the + menu | 46 / 481 | 24 / 460 |
| Open the account sheet | 63 / 498 | 90 / 457 |
| Switch tab (Tasks, Calendar, Home) | 62, 94, 45 | 29, 54, 92 |
| Open a long note (420 blocks) | 194 / 832 | 182 / 723 |
| Second launch to a usable Home | 327 | 177 |

| Typing in the long note (48 keys) | Chromium 4× | WebKit |
| --- | --- | --- |
| React commits per key | 3 | 2.8 |
| Components drawn per key | 49 | 49 |
| Script per key | 6.7 ms | |
| Layouts per key | 1.5 | |

| While nothing happens (5 s) | Commits / components |
| --- | --- |
| Home | 0 / 0 |
| A note just opened | 3 to 5 / 350 to 470 |
| Just after typing (4 s) | 7 / 688 |

Scrolling (programmatic in WebKit, a synthetic touch fling in Chromium) kept 60 fps in every view: the scrolling
itself is the compositor's. Startup in the Simulator (Debug build): `simctl launch` to the page's navigation start
2.2 to 2.9 s (mostly the Simulator spawning a Debug process; the app makes its web view about 70 ms after its
first log line), navigation start to the first paint of Home 545 to 790 ms, Home's cards about 100 ms after. 34
native bridge calls during a launch in local mode (library info, list, reads, places, AI capabilities).

## What made it slow, ranked

1. **Painting effects again for every new screen and every picture of one** (WebKit). With every box-shadow,
   filter, mask and backdrop blur turned off, the first frame of a push came 45 % sooner (98 to 53 ms) and Back to
   Home 109 to 80 ms; blur alone made no difference, shadows about 20 %, filters most (the folder tiles' double
   `drop-shadow` filter). The push's picture of the screen leaving (a clone of its DOM) paid it all again.
2. **Waiting on the server to show anything** (signed in): "Opening your folio…" until the Convex token, the
   socket and `users.me` answered, on every launch, though the last-known folio is on the device.
3. **Navigation rendered twice and late.** The router read Next.js's `usePathname`, which follows `pushState` in a
   transition (a render React may put off), while our history store updated at once: one render with the old
   address (every `useAppRouter` consumer: all the links), then the new screen a render or two later.
4. **Per-keystroke work in the note**: the keyboard bar re-rendered on both `transaction` and `selectionUpdate`
   (twice a key, every icon, two `editor.can()` dry runs), the block grip re-rendered on every update and scroll
   even when it stayed put, and the note's title effect (no dependency list) set `height: auto` and read
   `scrollHeight` on every render of the header, a forced layout of the whole note after each save.
5. **Whole-app re-renders from the library's status**: LocalGate (above everything) and the lists' pull to refresh
   subscribed to the whole status object, so each sync step and save drew the whole app again (688 components in
   the 4 s after typing).
6. **Push and pop animated `box-shadow` and `filter: brightness()` on whole screens**, which WebKit repaints every
   frame, and cloned the whole screen, long notes included.
7. Smaller: no `touch-action: manipulation` (the viewport already turns off double-tap zoom, so likely no 350 ms
   delay today, now guaranteed); the small title was positioned while its screen was mid-slide, so in a note it
   sat off screen.

Not causes: idle CPU on Home (nothing runs), scrolling, style recalculation (a whole-document style and layout of
Home is 10 ms in WebKit; the 27 `:has()` rules cost nothing measurable), the native side (haptics generators are
cached, the bridge calls are few).

## What changed

| Commit | Change |
| --- | --- |
| 8be306bd | Router follows the address at once (lib/app/historyNav.ts `subscribeLocation`; Next's own address only outside the app's routes and before hydration). Title fit only when it changes. Keyboard bar state read once a frame and drawn only on change; grip only when it moves. LocalGate and pull to refresh pick single library facts (`useLibraryStatusPick`). Push and pop: a dimming layer and a shadow strip (opacity and transform only) instead of filter and box-shadow; the picture trimmed to what's on screen. `touch-action: manipulation` in the iOS app. Owner's chrome requests (below). |
| 9513cfb8 | Warm start in the apps: the last-known folio (the account snapshot on the device, lists from the query cache) shows at once while the session is checked and Convex connects; the server's answer takes over in place. Only for the place the host opened. The loading screen is blank for its first 500 ms (the launch screen is blank too), so a quick load never flashes "Opening your folio…". |
| 5195882b | e2e: the folio shows before a slow (8 s) Convex token arrives. |
| 74611d99 | A note zooms out of its card (Craft's open), Back shrinks it into the card. The picture of the screen behind is drawn without shadows, filters or glass. |
| 4193c9dc | The zoom waits on the card (at most 150 ms) for the note's words; LocalGate reads sync progress only while setting up or joining. |
| 0319bd1e | Budgets in e2e/iphone-perf.spec.ts. |

## After

Same runs, the same export with the changes (WebKit numbers are the steadier ones; the Chromium after-run had the
Mac at a load average of 15):

| Interaction | WebKit before: first frame / settled | WebKit after |
| --- | --- | --- |
| Open a note from Home (now the zoom) | 201 / 754 | 166 to 225 / 540 (worst frame during it 74 to 122 ms before the picture was flattened, 21 to 24 after) |
| Open a long note | 182 / 723 | 146 to 148 / 528 |
| Push All notes | 89 / 658 | 57 to 114 / 662 |
| Back to Home | 113 / 673 | 101 to 152 / 522 to 675 |
| New note | 122 / 707 | 79 to 114 / 680 |
| Tabs, menus, sheets | unchanged within noise | |

| Typing in the long note | Before | After |
| --- | --- | --- |
| React commits per key | 3 | 0.3 |
| Components drawn per key | 49 | 12.9 |
| Mutations per key | 3.9 | 2.9 |

| While nothing happens | Before | After |
| --- | --- | --- |
| A note just opened (WebKit, 5 s) | 5 commits / 464 components | 0 / 0 |
| A long note (WebKit, 5 s) | 5 / 468 | 0 / 0 |
| Just after typing (4 s) | 7 / 688 | 3 / 171 |

Startup: the second launch to a usable Home stayed at about 180 to 200 ms in WebKit (local mode never waited on a
server). Signed in, the warm start removes the wait for the server entirely (the e2e shows the folio within the
6 s budget while the token is held back 8 s; before, nothing showed until the token came). First contentful paint
is now later on purpose (the loader stays blank for 500 ms).

## Budgets (e2e/iphone-perf.spec.ts)

Checked on every run (any build): at most 1 React commit and 30 components per keystroke in a 420-block note; no
commits on Home or in a note while nothing happens. Against an export in Chromium at 4×: Home usable on a second
launch within 1.5 s, a note's first frame within 600 ms and a list's within 250 ms of the tap.

## The owner's chrome requests in the same pass

- No white fade over the bottom: content scrolls under the tab bar at full strength; the capsules are glass at
  72 % (light) or 72 % near-black (dark). e2e: nothing but the capsules covers the bottom 140 points.
- The top bar's material is solid neutral (no blur) and the large title fades out as it goes under the bar, so it
  never shows behind the avatar or the "…" pill; the small title is centred in the bar's own coordinates. e2e:
  15 scroll offsets, light and dark.
- A note with a theme fills the width under the neutral bar, its colour starting below the bar (the backdrop
  around the page is gone on the iPhone; the iPad and Mac keep their centred page). e2e: the page's edges are the
  screen's, the bar and the area above the page are the canvas colour.
- Writing keeps the top bar: Back (puts the keyboard away first) and Done (in place of Share and "…"); the bar on
  the keyboard gains Foli AI. e2e in iphone-editor.spec.ts.
- The zoom from cards and rows (Reduce Motion: a cross-fade). The colour stays out of the bar, unlike Craft's.

## Second pass (same day)

- **Folder tiles' shadow** (7d223b7d): the double `drop-shadow` filter over each tile is now the same two
  shadows as the back's own `box-shadow` (its tab and body); it looks the same (close-ups before and after,
  light and dark, in the session's scratchpad). WebKit, interleaved runs with the Mac under heavy load: Home's tab
  93 and 160 ms to its first frame with the filter, 46 and 54 without; Back to Home 126 and 215 against 83 and
  121; push All notes 100 and 166 against 79 and 90.
- **"JS Eval error" at launch** (c71efd23): an accessibility notification posted as the app launches (the
  Simulator's hardware keyboard) sent `folevi:accessibility` before `window.Capacitor` existed
  (`TypeError: undefined is not an object (evaluating 'window.Capacitor.triggerEvent')`). It now waits for a
  loaded page; the page reads the settings itself at start.
- **Startup code** (5b4c2096): the JavaScript run before the first screen went from 3.43 MB to 2.97 MB
  (`FOLEVI_SOURCEMAPS=1` builds with source maps; what each source adds was counted from them). Out of it:
  tiptap and prosemirror-view (the Mac bridge's comment actions pulled them in; now `commentActions.ts`), the
  read-only drawing of every block (Foli AI's template dialog and catch-up card on desktop Home), chrono-node
  (Quick add loads on first open; the parser itself when the browser is idle, and its callers draw again once
  it's in), the export module, the Mac's Quick Add window, and the rare pages (Changes, Reviews, Shared with
  Me, Help, invitations). Six launches each: Chromium 4×, usable Home 870 to 745 ms and script 435 to 342 ms;
  WebKit, usable Home 330 to 297 ms.
  Still in it: Next.js (440 KB), Convex (97 KB), the editor schema's flowchart, table formula and markdown code
  (about 150 KB, through its index), E2EE's crypto (72 KB), fflate, ts-fsrs, and the block drawings again
  through the iPhone Home's catch-up card (IphoneHome.tsx was another agent's work in progress, left alone).
- **Back to the first screen** (e3db3767): an entry without Next.js's state made Back reload the page; it now
  stays in the page, online and offline (e2e/history-back-first.spec.ts).

## Still to measure on the phone

- Real launch: native start to first paint in a Release build (the Simulator's Debug numbers are inflated), and
  the warm start on the owner's account (how fast the snapshot and the query cache read on device).
- Instruments (Time Profiler, Animation Hitches) on the device during push, zoom and typing; the GPU cost of the
  remaining backdrop blurs (6 to 8 on screen).
- The keyboard bar riding on the real keyboard (the Simulator here had a hardware keyboard attached), and the
  edge swipe after a zoom (WebKit's own back gesture still slides).
- Startup code: 2.97 MB is still read at every launch (above, "Second pass"); the editor schema's index and the
  iPhone Home's catch-up card are the next splits.
