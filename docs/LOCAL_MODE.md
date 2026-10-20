# Local mode: Phase 0 decision record (2026-10-20)

This records the Phase 0 spikes from `docs/LOCAL_MODE_PLAN.md` §7: what was built, what ran, what it proved, and
what changed in the plan as a result. The plan stays the design; this file is the evidence behind it.

**Scope change during Phase 0:** the owner paused the iPhone and iPad apps. S3 (Capacitor) and the iOS halves of
S4 and S6 were not run and are deferred (see "Deferred"). `apps/ios` was not changed.

## Summary

| Spike | Question | Result |
|---|---|---|
| S1 | `pageExtensions` static export; deep links under an SPA fallback | **Worked.** No fallback project needed. |
| S2 | `app://folevi` in Electron on `persist:folevi` | **Worked with one change** (Better Auth's client needs an explicit base URL off http(s)). |
| S3 | `capacitor://localhost` in the iOS Simulator | **Deferred** (iOS paused). |
| S4 (Mac) | Bearer sign-in, Convex WebSocket and storage uploads from the shell origin | **Worked with one change** (bearer POSTs still need a trusted `Origin`). |
| S5 | A duck-typed `LocalClient` under the real `convex/react` hooks | **Worked with changes** (`logger`, explicit function kinds, pinned page ends). |
| S6 (Mac) | The iCloud container from the Mac | **Blocked** by the paid Developer Program, as expected. A plain iCloud Drive folder needs no entitlement. |

Recommendation: start Phase 1 as planned (WP1, WP5, WP6, WP7-pre, WP8a), with the plan edits listed below.

## Where the spikes live

Everything is behind the shell build flag or in spike folders. The website, Folevi for Mac and the iOS app behave
exactly as before.

- `apps/web/next.config.ts`: a `FOLEVI_BUILD=shell` branch (static export, `distDir: out-shell`,
  `pageExtensions: ["shell.tsx", "shell.ts"]`, `images.unoptimized`, no `headers()` or `redirects()`,
  `NEXT_PUBLIC_FOLEVI_SHELL=1`). Without the flag the config is the same object as before; the dev server's CSP
  header and the `/foli` redirect were checked after the edit.
- `apps/web/src/app/layout.shell.tsx`, `page.shell.tsx`: the shell's root layout (fonts, theme boot script, CSP
  meta) and its one page. Only the shell build reads them.
- `apps/web/src/lib/auth/client.ts`: a `baseURL` for shell builds only (S2 below).
- `apps/web/spikes/`: `s1-shell/` (probe component, SPA-fallback server, Chromium check), `s4-bearer/`
  (Playwright spec), `s5-local-client/` (LocalClient and its jsdom tests), plus `vitest.config.ts`,
  `playwright.config.ts` and `tsconfig.json` for them. None of it is in the app's test runs.
- `apps/desktop/spikes/app-scheme/`: a separate Electron entry point with its own `userData`. `apps/desktop/src`
  is untouched.
- `.gitignore`: `out-shell/`. `apps/web/eslint.config.js`: ignores `out-shell/**`, globals for spike scripts.

How to run them:

```sh
cd apps/web
FOLEVI_BUILD=shell npx next build                       # S1: writes out-shell/ (about 12 s)
node spikes/s1-shell/serve.mjs 4319 & node spikes/s1-shell/check.mjs http://127.0.0.1:4319
npx vitest run --config spikes/vitest.config.ts         # S5
S4_OUT=/tmp/s4-tokens.json E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
  npx playwright test --config spikes/playwright.config.ts   # S4, dev deployment only
cd ../desktop
SPIKE_USER_DATA=/tmp/folevi-s2 S4_TOKENS=/tmp/s4-tokens.json npx electron spikes/app-scheme/main.js write
SPIKE_USER_DATA=/tmp/folevi-s2 npx electron spikes/app-scheme/main.js read   # after a restart
```

`next build` rewrites `apps/web/next-env.d.ts`; restore it afterwards (it's never committed).

## S1: the shell build

**Built:** the config branch, the two `*.shell.tsx` files, and a page that renders today's `<ProductApp/>` plus a
probe (`spikes/s1-shell/ShellProbe.tsx`) that reports `usePathname()`, hydration and platform APIs on
`window.__shellProbe`. A small Node server serves `out-shell/` with the SPA fallback the hosts will use (a file if
it exists, 404 for `/api/*` and `/_next/*` misses, `index.html` for everything else).

**Result: worked.**
- `next build` with the flag compiles in about 10 s and prerenders exactly two routes, `/` and `/_not-found`. No
  admin, marketing, `/api`, `/s/[token]`, auth page, metadata route or `proxy.ts` output. The bundle has no admin
  or marketing code: strings from `components/admin` dashboards and the marketing title are absent from every
  chunk. The only admin trace is the "Admin console" menu item's `window.location.href = "/admin"`.
- Deep links hydrate at the right route in Chromium: `/d/01JABCDEFGHJKMNPQRSTVWXYZ0`, `/tasks/today`,
  `/settings/appearance?x=1` and `/documents` each report `usePathname()` equal to `location.pathname`, with no
  hydration warnings. `history.pushState` afterwards updates `usePathname()` (checked with `/calendar/2026-10`).
- Fonts and Tailwind work: `--font-instrument-sans` resolves, Instrument Sans and Spectral load from `/_next/static/media`,
  the Tailwind stylesheet is applied, and the page renders styled (the product shows its "You're offline" card,
  since there is no `/api/auth` in the shell: the expected account-mode behaviour without a server).

**Settles:** `pageExtensions` is the shell mechanism. The `apps/shell` sibling project fallback is not needed.

**Found along the way (all small, for WP1):**
- `out-shell/` is 103 MB, almost all `public/`: `covers/` 76 MB, `marketing/` 3.1 MB, plus `sw.js` and the Google
  verification file. The JavaScript and CSS are 15 MB, fonts 8.6 MB. `build-shell.mjs` should drop `marketing/`,
  `sw.js` and `google*.html`, and decide on covers (bundle a small set, or fetch the rest on demand in account mode).
- Next always emits its own viewport meta, so the shell layout uses `export const viewport` (with `viewportFit: "cover"`)
  instead of a second `<meta name="viewport">`.
- Turbopack warns that it can't parse `::highlight(folevi-find)` in `components/editor/editor.css`. It's a warning,
  not an error, and the build succeeds. Not checked whether the website build shows the same warning.
- `ServiceWorkerRegistration` registers `/sw.js` whenever `NODE_ENV` is production, which the shell build is, and
  `navigator.serviceWorker` exists on `app://folevi`. The plan's `isShell()` guard is needed, not optional.

## S2: `app://folevi` in Electron

**Built:** `apps/desktop/spikes/app-scheme/main.js`. It registers `app` as privileged (`standard`, `secure`,
`supportFetchAPI`, `corsEnabled`, `stream`) before `ready`, and calls `session.fromPartition("persist:folevi").protocol.handle("app", …)`
to serve `apps/web/out-shell` with the SPA fallback, `/_files/<name>` from a fixtures folder with Range support,
and a strict CSP header on a test path. Windows are sandboxed with context isolation, like the real app.

**First run failed:** the page threw on load, `BetterAuthError: Invalid base URL: app://folevi. URL must include
'http://' or 'https://'`. `createAuthClient()` without `baseURL` derives it from `location`, and that throws at
module evaluation off http(s), which takes the whole bundle down. Fix: in shell builds `lib/auth/client.ts` passes
`baseURL: NEXT_PUBLIC_APP_URL + "/api/auth"` (only when `NEXT_PUBLIC_FOLEVI_SHELL` is set, so the website is
unchanged). WP4 keeps a base URL and adds the native `customFetchImpl`.

**Result after that: worked.** Electron 44.4.5, Chromium 152:
- Origin `app://folevi`, `isSecureContext: true`.
- IndexedDB read and write; **persisted across a full restart** (written in the `write` run, read back in the `read`
  run). It lives in `Partitions/folevi/IndexedDB/app_folevi_0.indexeddb.leveldb`, apart from today's
  `https_app.folevi.com_0`, which confirms risk R2: the origin change strands existing queues unless WP2 hands them over.
- Web Locks: granted in window A; window B with `ifAvailable` sees it busy; B's queued request is granted when A
  closes. That is the `lib/local/host.ts` leader handover, proven.
- `BroadcastChannel` delivers from window A to window B.
- `crypto.subtle` (AES-GCM round trip, SHA-256), OPFS (`navigator.storage.getDirectory`), `storage.persisted()` true,
  quota about 172 GB.
- Deep links `/d/<id>` and `/tasks/today` hydrate with the right `usePathname()`; `pushState` works.
- `/_files/sample.bin` with `Range: bytes=2-5` returns 206, `content-range: bytes 2-5/10` and the right bytes; an
  `<img>` from `/_files/` loads. `/api/auth/get-session` on the scheme is a clean 404.
- From the page to the dev Convex deployment: the WebSocket opens and answers `settings:status` without auth, and
  `users:me` after `Authenticate` with a JWT from S4. A storage upload `fetch` from the page succeeds (200, a
  `storageId`), so CORS allows `app://folevi`.
- A page served with the local-mode CSP header (`connect-src 'self'`) can't reach `https://app.folevi.com` (fetch
  blocked) or the Convex WebSocket (blocked). The header CSP and the page's meta CSP both apply.

**Settles:** the Electron hosting design in plan §1 and §4.2 stands. Header CSP from the protocol handler works for
the local-mode lockdown. The `webRequest` block in the plan stays as the second layer.

## S3: Capacitor (deferred)

Not run. The iPhone and iPad apps are paused. `apps/ios` is unchanged. When iOS resumes, S3 runs as written in the
plan (both runtimes, `folevi-file://` with CORS and Range), plus the iOS half of S4 (WebSocket and upload from
`capacitor://localhost` inside WKWebView) and S6.

One thing already known for that work: `convex/http.ts` `corsFor` allows any `localhost` hostname outside
production, so `capacitor://localhost` would pass on the dev deployment by accident and fail in production. Tests
for `/files/:id` must not rely on dev behaviour there.

## S4 (Mac side): bearer sign-in from native

**Built:** `apps/web/spikes/s4-bearer/bearer.spec.ts`, using the e2e helpers to make a throwaway account on the dev
deployment. It approves the existing `folevi-mac` client on `/connect`, exchanges the code at
`/api/auth/native/token` from a cookie-less request context (no `Origin`, like Electron `net.fetch`), then probes.

**Results:**
- `/api/auth/native/token` returns a bearer session token to a cookie-less client. GET `/api/auth/convex/token` and
  GET `/api/auth/get-session` with `Authorization: Bearer` return 200 and the right person, with no `Origin`, with
  `Origin: app://folevi` and with `Origin: capacitor://localhost`. Also straight to `convex.site` (no Next proxy).
- **POSTs with a bearer still go through Better Auth's origin check, cookies or not.** Straight to `convex.site`:
  no `Origin` gives 403 `MISSING_OR_NULL_ORIGIN`; `app://folevi` and `capacitor://localhost` give 403
  `INVALID_ORIGIN`; the trusted origin gives 200. Sign-out behaves the same.
  Through the dev proxy, `app://folevi` appears to pass, but only because the dev server sets
  `FOLEVI_DEV_AUTH_ORIGIN`, which rewrites any `Origin` to the trusted one (`lib/auth/server.ts`). Production's proxy
  forwards `Origin` untouched, so the direct result is the production behaviour.
- The Convex WebSocket accepts both origins: opened, authenticated with the JWT, and `users:me` answered
  `QueryUpdated` with `Origin: app://folevi` and `Origin: capacitor://localhost` (Node, with the header set), and
  from the real `app://folevi` page in S2.
- Storage upload CORS: the preflight for a real upload URL answers 200 with `access-control-allow-origin` echoing
  `app://folevi` or `capacitor://localhost`, and a POST uploads (200, a `storageId`). From the Electron page too.
- After sign-out the bearer gets 401 from `/convex/token`.

**Settles:**
- Plan §1 "Signed-in mode" stands, with one change: native `shell.auth.fetch` sends `Origin: SERVICE_URL` on
  POSTs (it's native code holding a bearer, so there is nothing for CSRF protection to protect). The alternative,
  adding the shell origins to `trustedOrigins`, is not needed. Step 5's "if S4 shows the origin check firing" is now
  answered: it fires; the native layer handles it.
- No Convex-side change is needed for the WebSocket or for storage uploads.
- `corsFor` (`/files/:id` pixel reads) still needs `app://folevi` (and later `capacitor://localhost`) added in WP4;
  not run, read from the code.
- WP4's tests must call `convex.site` directly, or unset `FOLEVI_DEV_AUTH_ORIGIN`, or the origin rule is invisible.

Not tested: a new `folevi-shell` client id (a server change, left to WP4; the existing `folevi-mac` client exercised
the same endpoints).

## S5: `LocalClient` under the real hooks

**Built:** `apps/web/spikes/s5-local-client/localClient.ts`, an in-memory `LocalClient` with a query cache (one entry
per function and canonical args, read tracking, microtask re-runs, results replaced only when `canonicalJson`
changes, five-second eviction like Convex), serial mutations, actions and connection state. The test drives the real
`ConvexProvider`, `useQuery`, `usePaginatedQuery`, `useMutation`, `useAction` and `useConvexConnectionState` from
`convex/react` 1.46 in jsdom, with handlers registered against real `api.*` references.

**Result: worked, 6 of 6 tests pass:**
- `useQuery` is `undefined` while loading, then the result; a write re-runs only queries that read what changed; an
  unchanged result keeps the same object.
- `usePaginatedQuery`: `LoadingFirstPage`, `CanLoadMore` with 3 rows, `loadMore(3)` gives 6, an insert at the top
  then shows 7 with nothing duplicated or skipped, and the last `loadMore` reaches `Exhausted`.
- `useAction`, `client.mutation`, and `useConvexConnectionState` work.
- An unported function throws `ConvexError({ code: "local_unsupported" })` into the error boundary.
- Mutations run in call order.
- The handlers' return types are checked against the server's: the first draft returned `undefined` for
  `titles[].cover` and `style` and `tsc` refused it.

**Changes it forced (now in the plan, §0 and §2.1):**
1. `convex/react`'s `usePaginatedQuery` reads `client.logger.warn` (on a stale cursor), so `LocalClient` needs a
   `logger`. The plan's method list missed it.
2. `api.x.y` references carry only their name at runtime (`_type` exists in the types only), so the registry can't
   tell a query from a mutation by the reference. `defineLocal` takes the kind explicitly (or there are
   `defineQuery`, `defineMutation` and `defineAction`).
3. A paginated page must keep its end once loaded, or an insert above it shifts rows into the next page. Convex does
   this with its query journal. `queryCache` pins each page's first `continueCursor` and re-runs it with that
   `endCursor`; handlers use sort-key cursors, not offsets.
4. `watchPaginatedQuery` is only called by `usePaginatedQuery_experimental`. The app uses the stable hook, so
   `LocalClient` can throw there. QueriesObserver makes a fresh watch on every render without subscribing, so a
   watch must be a cheap view that only starts its cache entry.

**Absorbed (WP5, 2026-10-20):** the spike grew into `apps/web/src/lib/local/` (`client.ts`, `queryCache.ts`,
`registry.ts`, `backend.ts`, `host.ts`, `functions/`), and its tests into `apps/web/test/local-client.test.tsx`, the
hook conformance suite. `spikes/s5-local-client/` is removed.

## S6 (Mac side): the iCloud container

**Checked without the Developer Program:**
- This Mac is signed in to iCloud (`FileManager.ubiquityIdentityToken` is present) and has an iCloud Drive folder.
- `url(forUbiquityContainerIdentifier:)` returns nil for both `nil` and `iCloud.com.folevi` from an ad hoc signed
  helper.
- Signed with the personal "Apple Development" certificate and the iCloud container entitlements, the same helper
  is killed at launch (exit 137): restricted entitlements need a provisioning profile, and a personal team can't
  have iCloud containers.

**Blocked:** the `iCloud.com.folevi` container on the Mac (and so a container shared with the iPhone) needs the
paid Developer Program, an App ID with iCloud, a provisioning profile and the Developer ID build. Risk R7 stands.

**Available now:** Folevi for Mac isn't sandboxed, so "Choose a folder" can point at a folder in iCloud Drive
(`~/Library/Mobile Documents/com~apple~CloudDocs/…`) with no entitlement. Not tried, so nothing was written to the
owner's real iCloud Drive; macOS may ask for permission to access iCloud Drive the first time. Until the program
is in place, "Sync with iCloud" on the Mac can be offered as that folder, labelled as such, and moved into the
container later with `library.move`.

## Deferred

- S3 entirely, and the iOS halves of S4 (WebSocket and upload from `capacitor://localhost` in WKWebView) and S6
  (the container from the iOS Simulator).
- The `folevi-shell` native client id, `corsFor` additions and `trustedOrigins` (not needed): WP4.

## Changes made to `docs/LOCAL_MODE_PLAN.md`

- §0: the `convex/react` surface now lists `logger`, and notes that `watchPaginatedQuery` is only for the
  experimental hook.
- §1 "Signed-in mode", steps 3 and 5: native fetch sends `Origin: SERVICE_URL` on POSTs; the `trustedOrigins`
  fallback is dropped; the Better Auth client needs a base URL in every shell build.
- §1 "What breaks": a row for Better Auth's base URL, and the service worker row made firm.
- §2.1: `logger`, explicit kinds in `defineLocal`, pinned page ends.
- §7: Phase 0 marked done, with S3 and the iOS halves deferred, and S6 blocked.

## Recommendations for Phase 1

1. **WP1** starts from the files already here: keep `next.config.ts`'s shell branch and the two `*.shell.tsx`
   files, replace the spike page with `<ShellRoot/>`, write `build-shell.mjs` (with the `public/` pruning above),
   and turn `spikes/s1-shell/check.mjs` into the planned Playwright test. Add the `ServiceWorkerRegistration` guard.
2. **WP5** grows `spikes/s5-local-client` into `lib/local/{client,queryCache,registry}.ts`, keeping its tests as the
   hook conformance suite. Pin `convex` at 1.46.0 and re-run that suite on every upgrade (R4).
3. **WP2** (Phase 2) can lift `apps/desktop/spikes/app-scheme/main.js`'s handler into `src/protocol.ts` nearly as is.
   Plan the IndexedDB handoff early; S2 showed the two origins' stores side by side.
4. **WP4** adds `Origin: SERVICE_URL` in the native auth fetch and tests against `convex.site` directly.
5. Before "Sync with iCloud" is promised on the Mac, decide whether the interim iCloud Drive folder is acceptable or
   whether the option waits for the Developer Program.
6. Delete the spike folders once WP1, WP2 and WP5 have absorbed them.

## Phase 1, WP1: the shell build (2026-10-20)

S1 is absorbed: `apps/web/spikes/s1-shell/` (the probe, the SPA-fallback server and the check script) is gone, and its
checks are now tests. `s4-bearer/` and `s5-local-client/` stay until WP4 and WP5 cover them.

- **Build:** `pnpm --filter @folevi/web build:shell` (`apps/web/scripts/build-shell.mjs`): `next build` with
  `FOLEVI_BUILD=shell`, then it prunes what only the website uses from the export (`marketing/`, `sw.js`,
  `google*.html`, the PWA and tab icons, `brand/email/`, the Open Graph mark), moves the CSP meta tag to the top
  of `<head>` (Next writes its script tags first), snapshots admin-managed data, checks the export and copies it to
  `apps/desktop/web/` (git-ignored). `--no-copy` skips the copy; `--required` fails when the deployment can't be
  reached instead of shipping an empty snapshot (for releases).
- **Snapshot** (`scripts/snapshot-themes.mjs`): `themes.list` and `settings.disabledBuiltInTemplates` from the build's
  `NEXT_PUBLIC_CONVEX_URL`, written to `/shell/snapshot.json`, with admin-uploaded theme images copied to
  `/shell/themes/` so nothing is fetched from Convex storage at run time. `lib/shell/snapshot.ts` loads it. The
  templates' content ships as code (`BUILT_IN_TEMPLATES` in `@folevi/editor-schema`); the local `settings` handler
  filters it by `templates.disabled`.
- **Size** (dev deployment, 2026-10-20): 83 MB. JavaScript and CSS 11.8 MB, fonts 7.0 MB, note covers 64.1 MB.
  The covers are already WebP at effort 6 (`packages/design-tokens/scripts/covers.mjs`) and the app asks for all
  three sizes by fixed paths, so they ship as they are. Fewer sizes (a Mac only needs the 2x and thumbnails on a
  Retina screen) would save about 25 MB (the 1x files; the 2x are 36 MB, thumbnails 3.7 MB); not done, since an external 1x display uses the 1x files.
- **Root:** `page.shell.tsx` renders `components/app/ShellRoot.tsx`. It reads `initialMode` from the bridge
  (`lib/shell`, types in `lib/shell/types.ts` from plan §4.1) on the first client render (`useSyncExternalStore`,
  so the prerendered loader hydrates cleanly) and opens `ModeChoice` (a placeholder until WP10), or
  `<ProductApp backend="local" | "account"/>`. Without a bridge it's account mode. `shell()` is null on the website;
  development builds also honour the e2e FakeShell (`window.__foleviTestShell`).
- **Guards:** `isShell()` is a build-time constant, so website builds drop every shell branch. The service worker
  is never registered in the shell, the web push card hides there (`serviceWorker.ready` would never settle), and
  Admin console opens the website in the browser.
- **Dev server:** `pnpm --filter @folevi/web dev:shell` (port 3003, its own `.next-shell` folder, an SPA fallback
  rewrite) serves the shell under `next dev`, for local-mode e2e at `E2E_LOCAL_BASE_URL=http://localhost:3003`.
  Point its `NEXT_PUBLIC_APP_URL` at the running dev server, as the `web-shell-3003` launch configuration does.
- **Tests:** `test/shell.test.tsx` (the config switch, the accessor, the CSP, ShellRoot); `pnpm test:shell`
  builds and runs `playwright.shell.config.ts`: `e2e/shell/export.spec.ts` (one page, no route-handler, admin or
  marketing output, no admin or marketing strings in any file, the CSP first in `<head>`, the snapshot) and
  `e2e/shell/routes.spec.ts` (deep links hydrate at their address, pushState, no service worker, IndexedDB, Web
  Locks, `crypto.subtle`, BroadcastChannel and OPFS, the first-launch choice; and, with
  `E2E_BASE_URL=http://app.localhost:3002`, the real product signed in at `/d/<id>`, `/tasks/today` and
  `/settings/appearance`, navigating from the sidebar).
- **Left for WP4:** in account mode the bundled shell can't sign in yet: its CSP doesn't allow the service's
  `/api/auth` (by design; native bearer fetch replaces it), and signing out or `/signin` redirects go to pages
  the shell doesn't have. The signed-in test answers `/api/*` from the dev server to stand in for that.
- **Electron spike:** `apps/desktop/spikes/app-scheme/main.js` waited for the S1 probe, which no longer ships; its
  hydration checks need rewriting against the real page when WP2 lifts the handler.

## WP2: the Mac app hosting the bundled interface (2026-10-20)

**Off by default.** The installed Mac app still shows the website. The bundled interface is on only with
`FOLEVI_SHELL=1` or `"bundledShell": true` in the app's `settings.json` (`~/Library/Application Support/Folevi`);
the page can never set either. `FOLEVI_SHELL=0` forces it off.

- **`apps/desktop/src/protocol.ts`:** `app://folevi` (privileged before `ready`, only when switched on) on
  `persist:folevi`, serving `Contents/Resources/web` (development: `FOLEVI_SHELL_DIR`, else `apps/desktop/web`), with
  the SPA fallback (missing `/_next/*`, `/api/*` and anything with a file extension stay 404s), traversal, encoding
  and symlink checks, and a header CSP by mode: `local` and the first-launch `unset` allow `connect-src 'self'`
  only; `account` adds the website, `*.convex.cloud` (https and wss) and `*.convex.site` (plus
  `FOLEVI_SHELL_CONNECT`). `/_files/<sha256>` goes through a `LibraryFiles` reader (stubbed: every file is a 404
  until WP9), with Range, `nosniff`, a type allowlist (HTML and SVG go out as bytes) and a sandboxing CSP.
- **Development against `next dev`:** `FOLEVI_SHELL_DEV_URL=http://localhost:3003` (the `dev:shell` server) makes
  the windows load it instead of `app://folevi`.
- **`urls.ts`:** `SERVICE_URL` is the website (sign-in, links); `APP_URL` becomes `app://folevi` when switched on.
  Origins are compared by scheme and host, since Node gives every custom-scheme URL the origin `"null"`.
  `linkTarget()`: a link to one of the product's pages on the website opens in the app; every other website page
  (sign-in, `/s/` share links, `/connect`) opens in the browser.
- **`preload.ts`:** `foleviShell` only on the bundled interface's pages, with `initialMode` read synchronously
  (`shell:bootstrap`, from `settings.json`), `setMode` (saves, switches the local-mode network block, then reloads
  the app's windows so the CSP header matches), `library.fileUrl`, and "isn't in this build of Folevi for Mac
  yet" rejections for the rest. `foleviDesktop` is unchanged and works on the new origin.
- **Local mode:** `ses.webRequest.onBeforeRequest` cancels `folevi.com`, `*.folevi.com`, `*.convex.cloud`,
  `*.convex.site` and the website's host, over http, https, ws and wss.
- **The handoff (R2):** `handoff.ts` and `handoffKit.ts`. Before any window opens on the first bundled launch, if
  the website origin's IndexedDB folder exists, two hidden blank pages (`/_folevi-handoff` on each origin; the old
  one is answered locally through `ses.protocol.handle("https")` for that path only, everything else on that host
  goes to the network as usual) copy every `folevi-<account>` database with unsent work (sync ops, outbox, uploads,
  or a localStorage journal with ops), whole and with its schema, plus that account's journals and the other
  `folevi…` localStorage entries the new origin lacks. Values travel as tagged JSON (Blobs, Dates, typed arrays,
  Maps). Counts are checked; nothing on the old origin is changed and nothing on the new one is overwritten. The
  web app then finds the queue where it always looks, and sends it after sign-in. `handoff.json` in `userData`
  records it (`done`, or `retry` up to three launches). An existing account (any database on the old origin)
  starts in account mode instead of the first-launch choice.
- **Builds:** both electron-builder configs ship `web/**` as `extraResources`; `pnpm shell` runs
  `apps/web/scripts/build-shell.mjs --required` (which copies the export to `apps/desktop/web`, git-ignored), and
  `pnpm release` and `scripts/publish.mjs` run it first.
- **Tests:** `src/shell.test.ts` (paths, traversal, SPA fallback, CSP by mode, `/_files`, ranges, the local-mode
  block, the addresses), `src/handoff.test.ts` (a fixture of the website's database on one fake-indexeddb factory
  copied to another, through the kit's source text), and `apps/web/e2e/desktop-shell.spec.ts` (today's app writes
  offline on the website's origin and quits; the bundled build then starts with every network request cancelled
  (`e2e/fixtures/electronOffline.cjs`), hands the queue over, opens the note offline in account mode, and checks
  `foleviShell`, the window buttons, the Quick Add window, link routing and the local-mode block).
- **Not covered yet:** the old origin's database version must not be newer than the bundle's `DB_VERSION`, or the
  bundled app can't open it (a website ahead of an older app build). Adding a task from Quick Add while offline
  waits for the network, as on the website (`tasks.quickAdd` is a server call). `/_files` from the dev-server
  origin would need CORS.

## WP9b: Sync with Dropbox and Sync with Google Drive on the Mac (2026-10-20)

**Built:** `apps/desktop/src/library/cloud/`. The provider logic is platform neutral (fetch, WebCrypto and plain
data), so the iPhone and iPad app can reuse it later; only `loopback.ts`, `nodeMirror.ts`, `tokenStore.ts` and
`electron.ts` are Node or Electron. Everything runs in the Mac's main process: the page gets the connection's
status and the library's files, never a token.

- **`DropboxFs`** (`dropbox.ts`): the library is the root of Folevi's app folder (`Dropbox › Apps › Folevi`).
  `files/list_folder` (recursive) once, then `list_folder/continue` with the stored cursor, and
  `list_folder/longpoll` (sent without the access token, as Dropbox requires) to wait for changes. The etag is the
  file's `rev`. `ifMatch: <rev>` uploads in `update` mode with `strict_conflict`, which Dropbox checks atomically,
  so a concurrent change or a delete is a conflict and never an overwrite; `ifMatch: null` uploads in `add` mode;
  no autorename. Files above 8 MiB go up in an upload session and resume at Dropbox's `correct_offset`. Removes
  use `files/delete_v2` with `parent_rev`. A `reset` cursor lists everything again.
- **`DriveFs`** (`drive.ts`): `drive.file` scope, a `Folevi` folder in My Drive marked with an app property, the
  library tree as real folders, ids cached in the index. `changes.list` from a start page token taken before the
  first full listing; the watch loop polls every 30 seconds (Drive has no long poll for installed apps). The etag is
  `<fileId>.<headRevisionId>`. Multipart or media uploads below 5 MiB, resumable ones above (resuming from Drive's
  `Range`). Deletes go to the Drive trash. A 403 `rateLimitExceeded` or `userRateLimitExceeded` is a rate limit.
- **Both** (`cloudFs.ts`, `http.ts`): an index kept current from the change feed, so a sync only asks what
  changed; 429 and 503 wait for `Retry-After`, other 5xx back off exponentially with jitter, a dropped connection
  is retried, then reported as `CloudError` "offline". A copy of every file read or written is kept on the Mac
  (`nodeMirror.ts`, under `Application Support/Folevi/Cloud libraries/<provider>`, the same layout as the cloud
  folder), so unchanged files are never downloaded twice, attachments open offline, and signing out leaves a
  library on the Mac. `CloudFs` is also a `LibraryFs` (`startDownload` copies files here), so the main process's
  `EncryptedNodeFs` wraps it for an encrypted library exactly as it wraps a folder.
- **Signing in** (`oauth.ts`, `loopback.ts`, `connection.ts`): OAuth 2 authorization code with PKCE (S256) in the
  default browser, ending on a one-shot listener on `127.0.0.1` (RFC 8252 loopback redirect) that checks `state`.
  Google allows any port for desktop clients and no longer supports custom URI schemes for them. Dropbox matches
  redirect URIs exactly, port included, so the Mac uses one of three fixed ports (41753, 41754, 41755), all
  registered. Access tokens are refreshed a minute before they expire, or once after a 401 (one refresh for many
  requests). A refused refresh (`invalid_grant`: access revoked, or the grant expired) deletes the tokens and
  shows "Reconnect Dropbox" or "Reconnect Google Drive"; connecting again keeps the library and its copy.
- **Tokens** (`tokenStore.ts`): one file, `cloud-tokens.bin` in Application Support, encrypted with Electron's
  `safeStorage` (a key in the login Keychain), written atomically with mode 0600. Without `safeStorage` Folevi
  refuses to connect rather than store a token in plain text.
- **Signing out:** the grant is revoked at the provider (best effort), the tokens are deleted, watching stops, and
  the copy on the Mac stays where it is.
- **One provider per library:** connecting Google Drive while the library syncs with Dropbox says "Sign out of
  Dropbox first."
- **Offline:** nothing is queued in the provider layer. The page journals every edit before acknowledging it
  (`shell.library.journal`), a sync while offline fails with "offline" and writes nothing, listings and reads
  answer from the copy on the Mac, and the first sync back online flushes the journalled edits by read-merge-write.
- **The page's side:** `foleviShell.library.cloud` (preload.ts; types in `apps/web/src/lib/shell/types.ts`,
  `ShellCloud`): `status()`, `connect(provider)`, `cancel()`, `signOut()`, `onStatus(cb)`. The main process
  answers on `cloud:*` (`ipc.ts`) for the bundled interface's own pages only. `startCloud()` in `main.ts` restores
  the last connection at launch.
- **Client ids** come from the build, never the repository: `pnpm build` runs `scripts/cloud-config.mjs`, which
  writes `dist/cloud-config.json` from `FOLEVI_DROPBOX_APP_KEY`, `FOLEVI_GOOGLE_DESKTOP_CLIENT_ID` and, optionally,
  `FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET`. The same variables at run time override the file (development). A
  provider without an id is left out of `status().available`, and the log says which variable is missing.

### Google Drive's race window

Drive has no compare-and-swap. A conditional write reads the file's head revision, compares it with `ifMatch`,
and only then uploads. The window is the time from that check to the upload landing: one request plus the upload,
well under a second for a note. If another device uploads inside it, the later upload replaces the earlier one.
Three things cover that:

1. After each conditional upload Folevi lists the file's revisions. A revision between the one it checked and its
   own is another device's write that was replaced; it is offered back as a conflict version
   (`conflictVersions`), which local-store merges and then resolves.
2. Anti-entropy (LOCAL_MODE_PLAN.md §3.6): the device whose write was replaced still has the edit in its replica,
   sees that the file's `seen` doesn't cover it, and writes it again on its next sync.
3. Merges are idempotent and commutative, so an edit that arrives twice changes nothing.

Creating the same new file on two devices at once is the same race. The later device notices the earlier file
with a name query right after its create and trashes its own; if Drive's index hasn't caught up, the extra file is
listed as a numbered copy (`<id>(1).fnote`), which local-store merges and removes like any provider's copy. Two
`Folevi` folders made at the same moment both count as the library (every folder that resolves to the same path
is that path), and new files go into the older one. Dropbox doesn't have this window: its `update` mode is atomic.

### Tests

All in `apps/desktop/test/cloud/`, against in-process fake Dropbox and Drive servers (`fakeDropbox.ts`,
`fakeDrive.ts`) that model revs, cursors and page tokens (with paging and resets), strict write modes, revisions,
same-name twins, lagging listings (eventual consistency; a read by path or id is current), 429 and 403 rate limits,
5xx answers, dropped connections, cut-off chunks and downloads, short-lived access tokens and revocation.

- `dropbox.test.ts`, `drive.test.ts`: a LocalFs contract (`contract.ts`) for both, plus each provider's own rules.
- `shared-contract.test.ts`: local-store's `fixtures/fs-contract.json` (the one every file layer runs) on both,
  plain and under `EncryptedFs`. One step is relaxed for Dropbox: rewriting identical bytes keeps the `rev`, as
  Dropbox documents ("If the target path refers to a file with identical contents, nothing gets written").
- `convergence.test.ts`: local-store's convergence and no-loss property runs (`packages/local-store/test/sim.ts`,
  which now takes any cloud) with 2 to 4 devices on each fake provider, plain and encrypted, with faults and token
  refreshes along the way; plus a Drive run where every device syncs at the same moment with requests interleaved
  at random, which hits the race window above and recovers from it. Before committing, 300 seeds per provider (and
  60 encrypted) were run without a failure.
- `tokens.test.ts`: PKCE (RFC 7636's vector), refresh before expiry and after a 401, revocation and reconnecting,
  offline during a refresh.
- `offline.test.ts`: journalled edits while offline, a restart while offline, the flush when back online, the
  journal truncated by what the file holds.
- `connection.test.ts`: the whole sign-in through the real loopback listener, the encrypted token file, restoring
  after a restart, "Reconnect", one provider per library, sign-out, the `cloud:*` IPC, the config, the copy on the Mac.

### Not done yet

- The library service (`src/library/service.ts`) knows the folder kinds only. Offering "Sync with Dropbox" and
  "Sync with Google Drive" in `library.setup` means a library kind per provider whose files are
  `CloudLibrary.fs()` (wrapped in `EncryptedNodeFs` when the manifest says so), `CloudLibrary.prepare()` for the
  library file, and `CloudLibrary.watch()` for change batches. The first-run chooser and Settings also need the
  two options, a "Connected as" line, "Reconnect" and "Sign out of Dropbox".
- Nothing has run against the real Dropbox or Google APIs yet: that needs the owner's app and client below. The
  fakes follow the documented behaviour, but the first real run should watch the log.
- iPhone and iPad: paused. The platform-neutral files can run there unchanged; the token store, the redirect
  (ASWebAuthenticationSession with a custom scheme for Dropbox, the iOS client's reversed client id for Google) and
  the copy on the device need iOS versions.

### Owner setup checklist

**Dropbox** (dropbox.com/developers/apps):

1. Create app: "Scoped access", then "App folder". Name it `Folevi` (the folder people see is `Apps/Folevi`).
2. Permissions tab: tick `files.metadata.read`, `files.metadata.write`, `files.content.read`,
   `files.content.write` (and keep `account_info.read`, for "Connected as"). Submit.
3. Settings tab, OAuth 2:
   - Redirect URIs: add exactly `http://127.0.0.1:41753/`, `http://127.0.0.1:41754/` and `http://127.0.0.1:41755/`.
   - "Allow public clients (Implicit Grant & PKCE)": Allow.
   - Leave the app secret unused; Folevi never needs it.
4. Copy the App key into `FOLEVI_DROPBOX_APP_KEY` for builds.
5. Branding tab: the icon and description people see when connecting.
6. A new app is in development status. Once more than 50 people have connected, Dropbox gives two weeks to apply
   for production status (Settings tab, "Apply for production").

**Google Drive** (console.cloud.google.com, the existing Folevi project):

1. APIs & Services, Library: enable the **Google Drive API**.
2. Google Auth Platform, Branding: app name `Folevi`, support email, logo, home page `https://folevi.com`, the
   privacy policy and terms links, and `folevi.com` as an authorized domain.
3. Audience: External, and **publish the app (In production)**. While it is in Testing, only listed test users
   can connect and their refresh tokens expire after 7 days, so everyone would see "Reconnect Google Drive" weekly.
4. Data access: add the scope `https://www.googleapis.com/auth/drive.file` ("See, edit, create, and delete only the
   specific Google Drive files you use with this app"). It is a non-sensitive scope, so no security assessment;
   Google may still ask to verify the brand before it shows the name and logo.
5. Clients: create an OAuth client of type **Desktop app**, named `Folevi for Mac`. Desktop clients take no
   redirect URIs: any `http://127.0.0.1:<port>/` is accepted.
6. Copy the client id into `FOLEVI_GOOGLE_DESKTOP_CLIENT_ID` for builds. Google also shows a client secret for
   desktop clients; it isn't confidential in an installed app and PKCE protects the exchange. Set
   `FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET` only if the first real sign-in fails with "client_secret is missing".
7. Later, for iOS: a separate iOS client in the same project (its reversed client id is the redirect scheme).

**Building:** `FOLEVI_DROPBOX_APP_KEY=… FOLEVI_GOOGLE_DESKTOP_CLIENT_ID=… pnpm release` (or `pnpm publish-mac`)
in `apps/desktop`. The build prints `cloud-config.json: Dropbox yes, Google Drive yes`. A build without them hides
both options and logs `"Sync with Dropbox" is hidden: this build has no Dropbox app key …`.
