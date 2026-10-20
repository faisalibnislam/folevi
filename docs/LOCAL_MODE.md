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
