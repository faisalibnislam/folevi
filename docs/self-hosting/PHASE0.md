# Folevi Server, Phase 0: Folevi on a standalone Convex backend

Done 2026-11-24 on an Apple silicon Mac (18 cores, Node 24.22.2), no Docker, everything on localhost. Goal: prove
that Folevi runs on Convex's ready-made backend program the way a native Synology or QNAP package would run it
(see `docs/SELF_HOSTING_PLAN.md` §5.8). Scripts are in `scripts/self-host/`.

## Summary

- **It works.** The real Folevi backend (about 80 modules, 30 crons, the Better Auth component, text search, file
  storage, HTTP routes) deploys to a bare `convex-local-backend` process with SQLite and local file storage, and
  the production web build runs against it: sign-in, notes, folders, full-text search, image upload and reload,
  public share links, crons and scheduled functions all passed.
- **One origin works.** A 90-line Node proxy serves the web app at `/`, the Convex client API and its WebSocket at
  `/convex` and HTTP actions at `/convex-site`, so the browser needs one origin and one port. Every step above
  passed through it.
- **What broke:** sign-up needs email verification even with no email provider (code change needed); node actions
  fail when `TMPDIR` is long (fixed in the start script); Foli AI is advertised with no key; the billing trial
  banner shows; and three things assume the server can reach its own public address.
- **Memory is the risk.** With Convex's defaults on this 18-core Mac the backend peaked at 1.3 GB for one person's
  session. With four concurrency knobs turned down it peaked at 570 MB and settled at 260 MB. The web server adds
  about 150 MB.
- **Linux builds:** Convex publishes `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu` only (no musl).
  Since 2026-10-28 they are built on Ubuntu 22.04 and CI enforces at most `GLIBC_2.35` and `GLIBCXX_3.4.30`.
  QTS 5 reportedly has glibc 2.21, so neither Convex's binary nor official Node.js runs there as is.

## 1. Start the backend

Binary: `~/.cache/convex/binaries/precompiled-2026-11-21-cf39368/convex-local-backend` (the newest one cached here;
2026-11-16, 11-20 and 11-21 were all present). It is a single 170 MB Mach-O file; `--version` prints
`local_backend unknown`.

`scripts/self-host/start-backend.sh` runs it as a service would. It generates a 32-byte hex instance secret and
the admin key once into `$DATA/secrets/` (mode 700, never printed), then execs:

```sh
convex-local-backend "$DATA/convex.sqlite3" \
  --db sqlite --interface 127.0.0.1 --port 3510 --site-proxy-port 3511 \
  --convex-origin "$CLOUD_ORIGIN" --convex-site "$SITE_ORIGIN" \
  --instance-name folevi-server --instance-secret "$SECRET" \
  --local-storage "$DATA/storage" --disable-beacon --redact-logs-to-client
```

- Admin key: `convex-local-backend keygen admin-key --instance-name <name> --instance-secret <secret>` prints it.
  No running server is needed.
- `--disable-beacon` (or `DISABLE_BEACON=1`) turns off the phone-home beacon.
- `--convex-site` help text: when there's no separate HTTP actions address, `<convex-origin>/http` works, because
  the main port also serves HTTP actions under `/http`. Confirmed: `/convex/http/api/auth/convex/jwks` answered 200
  through the proxy. So a package could expose a single backend port.
- Usage:

```sh
DATA=/path/folevi-data BACKEND=/path/convex-local-backend BACKEND_TMPDIR=/tmp/fv0 \
  CLOUD_ORIGIN=http://localhost:3580/convex SITE_ORIGIN=http://localhost:3580/convex-site \
  scripts/self-host/start-backend.sh
```

### Breakage: node actions and a long TMPDIR (fixed in the script)

The first deploy failed with `500 InternalServerError` from `/api/deploy2/start_push`. The log showed
`listen EINVAL ... /.tmpXXXX/.executor.sock`. The backend runs node actions, and the analyze step of every deploy,
in a `node` child process reached over a Unix socket in `$TMPDIR`. Socket paths are limited to about 104 bytes,
and this Mac's `TMPDIR` was longer. `start-backend.sh` now sets `TMPDIR` to `$DATA/tmp` (or `BACKEND_TMPDIR`) and
refuses to start if it's over 80 characters.

**For the NAS package:** the backend needs `node` on its `PATH` (it spawns `node local.cjs --ipc-path ...`). The
package must ship Node.js anyway for Next.js, so put that Node first on the backend's `PATH`. Keep the temp folder
short, such as `/var/packages/folevi/var/tmp`.

## 2. Deploy Folevi's functions

`scripts/self-host/deploy.sh` sets the environment and runs `npx convex deploy --yes --typecheck=disable` with
`CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` (and unsets `CONVEX_DEPLOYMENT`/`CONVEX_DEPLOY_KEY`).
It never uses `--prod`. `scripts/self-host/convex.sh` runs any other Convex CLI command the same way (for example
`env list`, `logs`, `run`) and refuses `--prod`.

```sh
DATA=/path/folevi-data APP_URL=http://localhost:3580 scripts/self-host/deploy.sh
```

Result: all indexes created, `Installed component betterAuth.`, `Deployed Convex functions`. About 5 seconds once
the TMPDIR fix was in. No code changes were needed for the deploy.

### Backend environment used (all throwaway, generated into `$DATA/secrets/folevi.env`)

| Variable | Value | Why |
| --- | --- | --- |
| `FOLEVI_ENV` | `production` | A server is production: no dev mailbox, no `testSupport`, real rate limits, secrets required |
| `SITE_URL`, `FOLEVI_APP_URL` | the web origin (`http://localhost:3500`, then `http://localhost:3580`) | Better Auth base URL and trusted origin, links in email, file CORS |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Better Auth |
| `FOLEVI_HASH_SALT` | `openssl rand -hex 16` | keyed hashes (production refuses to run without it) |
| `FOLEVI_FILE_URL_SECRET` | `openssl rand -hex 32` | signed `/files/` URLs |
| `FOLEVI_SERVER_SECRET` | `openssl rand -hex 32` | shared with the web server |
| `FOLEVI_REQUIRE_VERIFIED_EMAIL` | `false` | no email provider (see the sign-up breakage below) |

Left unset on purpose: `RESEND_*` (no email), `GEMINI_*` (no AI key), `VAPID_*`, `APNS_*`, `FCM_*`, `POLAR_*`,
`GOOGLE_*`, `APPLE_SIGNIN_*`, `UNSPLASH_ACCESS_KEY`, `SUPPORT_NOTIFY_EMAIL`. `CONVEX_SITE_URL` and
`CONVEX_CLOUD_URL` come from the backend's `--convex-site`/`--convex-origin` flags, not from `env set`.

## 3. The web app as a production build

`next build` in `apps/web` with these build-time variables, then `next start -H 127.0.0.1` with
`FOLEVI_SERVER_SECRET` at run time:

```sh
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3510 NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3511 \
NEXT_PUBLIC_APP_URL=http://localhost:3500 NEXT_PUBLIC_MARKETING_URL=http://localhost:3500 npx next build
FOLEVI_SERVER_SECRET=... npx next start --port 3500 -H 127.0.0.1
```

App and marketing URLs on the same host work: `src/proxy.ts` skips a cross-host redirect when the target host is
the request's host. Public links use `NEXT_PUBLIC_MARKETING_URL` (`SHARE_ORIGIN` in `src/lib/env.ts`), so a server
build must set it to the server's own address.

### The walk (`scripts/self-host/smoke.mjs`, Playwright, a throwaway `phase0-<time>@example.com` account)

```sh
cd apps/web && APP=http://localhost:3580 SHOTS=/some/folder node ../../scripts/self-host/smoke.mjs signup signin notes search upload share ai
```

| Step | Result |
| --- | --- |
| Sign up | **Fails.** The form ends on "Check your inbox", and sign-in then says "Verify your email address first" (403). See below |
| Sign in | Passes after marking the address verified by hand. Lands on onboarding, then `/documents` |
| Notes | Passes: new note, typed text, "Saved", text still there after a reload |
| Folders | Passes: new folder, still there after a reload |
| Search (text) | Passes: a word from the body is found by ⌘K in about 200 ms |
| Upload and load back | Passes: `/image` uploads a PNG, `src` becomes a signed `<site>/files/<id>?exp=&sig=` URL, it decodes after a reload, direct GET is 200 `image/png` |
| Share link | Passes: the public link switch makes `<app>/s/<token>`, which opens signed out with the note's title and its image |
| Crons and scheduled functions | Pass: `convex logs --success` shows `tasks:processReminders` and `e2ee/reminders:process` (1-minute crons) every minute, and scheduled work (`email:sendTemplate`, `files:finalize`, `documents:settleEdits`) running |
| Rate limits | Work: a sixth sign-in in a minute got 429 (stored in the database, as in the cloud) |
| Foli AI with no key | The button, panel and onboarding ("Foli AI: On") all show. Asking returns "Foli AI isn't set up on this server yet." and the console logs `[CONVEX A(ai:write)] Server Error`. Nothing crashes |

### Breakage found, with causes

1. **Sign-up can't finish without email.** `convex/auth.ts` sets `emailAndPassword.requireEmailVerification: true`
   and `emailVerification.sendOnSignUp/sendOnSignIn: true`. With no `RESEND_API_KEY`, `email:sendTemplate` logs
   `email.not_configured` and returns, so the link never arrives. `FOLEVI_REQUIRE_VERIFIED_EMAIL=false` only
   relaxes Folevi's own check (`convex/lib/auth.ts`), not Better Auth's.
   - Workaround used: `scripts/self-host/convex.sh run --component betterAuth adapter:updateOne
     '{"input":{"model":"user","where":[{"field":"email","value":"<email>"}],"update":{"emailVerified":true}}}'`.
   - Needed (Phase 1, §5.3): drive `requireEmailVerification` and the send flags from "an email provider is set up"
     (SMTP or Resend), and give the setup page the owner account and invite links instead.
2. **The backend fetches its own public address.** `getAuthConfigProvider()` (from `@convex-dev/better-auth`)
   tells Convex to fetch the JWKS from `${CONVEX_SITE_URL}/api/auth/convex/jwks`. Behind Tailscale, Cloudflare or a
   NAS reverse proxy, the backend must be able to reach its own public URL (hairpin). Needed: pass the static
   `jwks` option (the library supports it and turns it into a `data:` URL), or an internal URL.
3. **The web server also calls Convex at the public URL.** Server code reads `NEXT_PUBLIC_CONVEX_URL` and
   `NEXT_PUBLIC_CONVEX_SITE_URL` (`src/lib/auth/server.ts`, `src/app/s/[token]/page.tsx`, `src/app/api/*`,
   `src/proxy.ts` and others). Needed: an internal address for server-side calls (for example
   `FOLEVI_INTERNAL_CONVEX_URL=http://127.0.0.1:3510`), falling back to the public one.
4. **Foli AI shows with no key.** The plan (§5.5) says hide it. Needed: a "configured" flag from the backend that
   the onboarding step, the toolbar button and the panel respect.
5. **Billing shows.** The sidebar says "Pro AI trial · 7 days left · Choose plan". Needed: the server edition
   (§5.1) turns billing and trials off.
6. **CORS on a cached image (small, also in the cloud).** With app and backend on different origins, a `fetch()`
   of a `/files/` URL that was first loaded by an `<img>` fails CORS: the no-Origin response has no `Vary: Origin`
   (`corsFor` in `convex/lib/cors.ts` returns no headers then), and Chrome reuses it. Fix: always send
   `Vary: Origin`. It disappears with one origin. Not changed here.
7. **Plain HTTP on a LAN address will break.** The production CSP has `upgrade-insecure-requests`, which upgrades
   every `http://` request (and `ws://`) to https on a non-localhost origin. Localhost is exempt, which is why this
   test passed. Also `Strict-Transport-Security` is sent. The server edition must drop both when served over HTTP.
8. **Build-time addresses.** As the plan says (§5.1), the Convex URLs, app URL and CSP are inlined at build time.
   Confirmed: the single-origin test needed a second build. Also `next build` peaked at 3.4 GB RSS, so it must
   happen in our CI, never on the NAS.
9. **No `output: "standalone"`.** `next.config.ts` doesn't set it, so `next start` needs the whole workspace and
   `node_modules`. Needed for the bundle (§5.8).

## 4. One origin and one port

`scripts/self-host/proxy.mjs` (plain Node, no dependencies) on `127.0.0.1:3580`:

| Path | Goes to | Prefix |
| --- | --- | --- |
| `/convex/*` (HTTP and WebSocket upgrade) | backend `:3510` | removed |
| `/convex-site/*` | backend HTTP actions `:3511` | removed |
| everything else | `next start` `:3501` | kept |

Setup: backend started with `--convex-origin http://localhost:3580/convex --convex-site
http://localhost:3580/convex-site`; Convex env `SITE_URL=FOLEVI_APP_URL=http://localhost:3580`; web built with
`NEXT_PUBLIC_CONVEX_URL=http://localhost:3580/convex`, `NEXT_PUBLIC_CONVEX_SITE_URL=http://localhost:3580/convex-site`
and `NEXT_PUBLIC_APP_URL=NEXT_PUBLIC_MARKETING_URL=http://localhost:3580`.

**Result: everything works through one origin.** The Convex client builds its WebSocket as
`ws://<address>/api/<version>/sync` from the full address, so a path prefix is fine, and the sync socket ran
through the proxy. The whole walk passed on `:3580`: sign-in, notes, folders, search, upload (file URLs became
`http://localhost:3580/convex-site/files/...`), the public link (`http://localhost:3580/s/...`, opened signed out)
and the AI message. Better Auth's issuer became `http://localhost:3580/convex-site`. The CORS error in item 6 went
away, since everything is same-origin. The CSP needs no change, because the Convex origin is the page's own.

Caddy isn't installed here, so it wasn't tried. The same rules are three `handle_path` blocks. Because the backend
also serves HTTP actions at `<origin>/http`, `--convex-site http://host/convex/http` would let the proxy forward
everything under `/convex` to one backend port (the route answered 200; a full walk on that layout wasn't run).

## 5. Numbers

Measured on an 18-core M-series Mac with 48 GB, so expect a NAS to be slower. RSS from `ps`.

### Memory (RSS)

| Process | State | Defaults | Low knobs |
| --- | --- | --- | --- |
| Backend | just started, empty database | 58 MB | |
| Backend | just started, deployed, with data | 88 to 173 MB | 86 MB |
| Backend | peak during one person's walk | 1,250 to 1,295 MB | **569 MB** |
| Backend | 60 s after the walk | 816 MB | **262 MB** |
| Node executor child (`node local.cjs`) | after deploy / later | 42 MB / 18 MB | |
| `next-server` | idle / during the walk | 137 to 163 MB / 151 MB | |
| `npm exec next start` wrapper | | 45 to 99 MB | avoid: run `node server.js` (standalone) |

"Low knobs" = `APPLICATION_MAX_CONCURRENT_QUERIES=4 APPLICATION_MAX_CONCURRENT_MUTATIONS=4
APPLICATION_MAX_CONCURRENT_V8_ACTIONS=4 APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=2 ISOLATE_IDLE_TIMEOUT_SECONDS=30`
in the backend's environment. All checks still passed with them. macOS `footprint` on the default backend showed
815 MB in one VM tag (V8 heaps) plus 203 MB malloc, so the memory is in JavaScript isolates, which these knobs
bound. Other knobs exist (`MAX_ISOLATE_WORKERS`, `FUNRUN_MODULE_CACHE_SIZE`, `FUNRUN_CODE_CACHE_SIZE`,
`ISOLATE_MAX_USER_HEAP_SIZE`) and weren't tuned. **For a 2 GB NAS:** ship the low knobs, and measure a family's real
use on the hardware in Phase 4.

### Cold start

| What | Time |
| --- | --- |
| Backend, empty database, to `/version` | 0.48 to 0.72 s |
| Backend with Folevi deployed, to `/version` / to first HTTP action (JWKS, runs Folevi code) | 0.14 s / 0.40 to 0.46 s (3 runs) |
| `npx convex deploy` of all functions | about 5 s |
| `next start` to first page | 0.55 to 0.70 s |
| `next build` | 46 to 58 s, 3.4 GB peak RSS |

### Disk

| What | Size |
| --- | --- |
| Backend binary (macOS arm64, unzipped) | 170 MB |
| Linux backend zips (cf39368) | x86_64 65.0 MB, aarch64 63.0 MB |
| `.next` after build | 523 MB, of which `cache` 380 MB (not needed at run time), `server` 116 MB, `static` 26 MB |
| Data after the tests (one account, a few notes, 4 tiny images) | SQLite 9.0 MB, file storage 7.7 MB (mostly the deployed module bundles) |

## 6. Linux builds for the NAS

From the GitHub releases of `get-convex/convex-backend` (`precompiled-*` tags; the newest is
`precompiled-2026-11-24-f1ff8e5`), each release has:

- `convex-local-backend-x86_64-unknown-linux-gnu.zip` (about 65 MB)
- `convex-local-backend-aarch64-unknown-linux-gnu.zip` (about 63 MB)
- macOS (x86_64, aarch64), Windows x86_64, `dashboard.zip`, `LICENSE.md`
- **No musl builds** and no 32-bit ARM.

glibc: `.github/workflows/precompile.yml` builds both Linux targets in an `ubuntu:22.04` container (commit
`d1fcbea`, 2026-10-28, "build Linux local backends against glibc 2.35"). A CI step runs `objdump -T` and fails the
release if any symbol needs more than **`GLIBC_2.35`** or **`GLIBCXX_3.4.30`**. So the binary links `libstdc++`
dynamically and needs a GCC 12 era `libstdc++.so.6`. Releases before 2026-10-28 were built on the runner image
and may need newer glibc.

I didn't download the Linux zips (that needs the owner's OK). The limits above come from Convex's own release check;
`objdump -T` on the zip would confirm them.

Node.js 24.22.2 (the repo's `.nvmrc` is 24), official builds from nodejs.org (sizes from HTTP HEAD):

| File | Size |
| --- | --- |
| `node-v24.22.2-linux-x64.tar.xz` | 32.0 MB |
| `node-v24.22.2-linux-arm64.tar.xz` | 31.0 MB |
| `node-v24.22.2-linux-x64.tar.gz` | 58.3 MB |
| `node-v24.22.2-linux-arm64.tar.gz` | 58.0 MB |

The `node` binary alone is about 120 MB unpacked (the macOS arm64 one is 122.6 MB). Official Linux builds of Node
24 need glibc 2.28 or newer.

What that means for the NAS boxes (to verify with `ldd --version` over SSH on real hardware):

- **Synology DSM 7.2:** likely fine. DSM 7.2.2 shipped a fix for CVE-2023-4911, which only affects glibc 2.34 and
  newer, so DSM 7.2's glibc is at least 2.34 and probably 2.36. The `libstdc++` version is unknown: bundle our own
  `libstdc++.so.6` with the package and point `LD_LIBRARY_PATH` at it. DSM 7.0 and 7.1 are older and likely too old.
- **QNAP QTS 5.x:** a user report gives glibc 2.21 (QTS 5.2.9), and QNAP's advisory for a glibc 2.27 to 2.38 bug
  lists QTS 5.x as unaffected, which fits. **Neither Convex's binary (2.35) nor official Node.js (2.28) will run
  there as is.** Options: ship a private glibc and loader with the package (run both programs through our own
  `ld-linux` with `--library-path`), or build a musl or fully static backend ourselves (the plan's fallback in
  §5.8). QuTS hero may differ; check.

## 7. Work this adds to the plan

- Phase 1: email-optional sign-up (item 1), static JWKS (item 2), an internal Convex URL for the web server
  (item 3), hide Foli AI with no key (item 4), billing off in the server edition (item 5), `Vary: Origin` on files
  (item 6), a CSP and HSTS that suit plain HTTP when the server is on HTTP (item 7), `output: "standalone"` and
  runtime addresses (items 8 and 9).
- Packaging: ship Node.js on the backend's `PATH`, a short `TMPDIR`, the low-memory knobs, our own
  `libstdc++.so.6`, and for QNAP either a private glibc or our own static backend build.
- One origin is the default layout: the supervisor's proxy (or DSM's reverse proxy, or Caddy) maps `/`,
  `/convex` and `/convex-site`. It removes the need for a second port and for cross-origin rules.

## Files

- `scripts/self-host/start-backend.sh`: start the backend as a service (secrets, admin key, TMPDIR check)
- `scripts/self-host/deploy.sh`: set the backend's environment and deploy the functions
- `scripts/self-host/convex.sh`: any Convex CLI command against the self-hosted backend (refuses `--prod`)
- `scripts/self-host/proxy.mjs`: the one-origin proxy
- `scripts/self-host/smoke.mjs`: the browser walk

Sources: [Convex releases](https://github.com/get-convex/convex-backend/releases),
[precompile.yml](https://github.com/get-convex/convex-backend/blob/main/.github/workflows/precompile.yml),
[Node.js 24.22.2 downloads](https://nodejs.org/dist/v24.22.2/),
[QNAP QSA-25-18](https://www.qnap.com/en-us/security-advisory/qsa-25-18),
[Roon forum, QTS glibc 2.21](https://community.roonlabs.com/t/qnap-qts-does-not-support-new-minimum-system-requirements-to-run-roon-server-20-april-2026/318027),
[DSM 7.2.2 update notes](https://www.blackvoid.club/dsm-7-2-2-72803-update/),
[Synology toolchains](https://help.synology.com/developer-guide/compile_applications/download_dsm_tool_chain.html).
