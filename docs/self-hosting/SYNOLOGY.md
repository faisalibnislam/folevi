# Folevi Server for Synology (native DSM 7 package)

Started 2026-11-24 (plan: `docs/SELF_HOSTING_PLAN.md` §5.8; spike: `docs/self-hosting/PHASE0.md`). Status: first
test build (`0.1.0-0001`) made for both chips, tested on this Mac as far as possible, not yet installed on a NAS.

## What it is

One self-contained server bundle, wrapped as a DSM 7 package. No Docker and no Container Manager.

| Piece | What it does |
| --- | --- |
| `bin/folevi-server` | Launcher (`scripts/self-host/server/folevi-server.sh`). Tests how this NAS can run the Linux programs, then starts the supervisor |
| `bin/convex-local-backend` | Convex's backend program (`precompiled-2026-11-21-cf39368`), on `127.0.0.1:38510` and `:38511` |
| `node/bin/node` | Node.js 24.22.2 for the supervisor, the web app and the backend's node actions |
| `lib/cxx`, `lib/glibc` | Ubuntu 22.04's libstdc++ 12 and glibc 2.35, used only when the NAS's own are too old |
| `web/` | The web app's standalone server (server edition build), on `127.0.0.1:38512` |
| `functions/push-request.json.br` | Folevi's functions, bundled at build time, so the NAS needs no npm |
| `supervisor/` | `supervisor.mjs` and `pages.mjs` |

The supervisor serves everything on **port 8810**:

| Path | Goes to |
| --- | --- |
| `/convex/*` (and its WebSocket) | the backend's client API |
| `/convex-site/*` | the backend's HTTP actions (auth, signed file links) |
| `/folevi-server/` | the setup, status and diagnostics pages |
| `/.well-known/folevi.json` | the server's name, version, addresses and features (plan §5.1) |
| everything else | the web app |

### Data folder (the shared folder picked at install, default `folevi`)

| Folder | Holds |
| --- | --- |
| `secrets/` (mode 700) | `secrets.json` (instance secret, Better Auth secret, hash salt, file URL secret, server secret, setup key), `admin_key`, `settings.json` (name, address, AI key) |
| `convex/` | `convex.sqlite3` and `storage/` |
| `backups/` | `folevi-backup-<date>.zip`, a Convex export with files, nightly at 03:30, newest 14 kept |
| `logs/` | `launcher.log`, `supervisor.log`, `backend.log`, `web.log` (5 MB each, then `.1`) |
| `state.json` | which bundle version's functions are deployed, the last backup |

Temp files and the `node` wrapper live in the package's var folder (`/var/packages/folevi-server/var`), which keeps
the backend's socket paths short (Phase 0's `TMPDIR` breakage).

### Start, in order

1. Secrets made once (never printed; diagnostics redact them).
2. Port 8810 opens at once, so the setup and diagnostics pages work even if a later step fails.
3. Leftovers from a crashed run are ended (only process groups whose every member runs from the bundle or var
   folder), and the three loopback ports must be free.
4. The backend starts with Phase 0's low-memory limits and `--disable-beacon`, on loopback addresses only.
5. The backend's environment is set: `FOLEVI_EDITION=server`, `SITE_URL`/`FOLEVI_APP_URL` (the address from
   setup, or a guess from the NAS's LAN address), `FOLEVI_PUBLIC_SITE_URL` (`<address>/convex-site`, for signed
   file links), `FOLEVI_PUBLIC_CONVEX_URL=/convex` (uploads), `FOLEVI_TRUSTED_ORIGINS`, the secrets, and
   `GEMINI_API_KEY` when the owner gave one.
6. When the bundle's version differs from the last deploy: the prebuilt push request is sent with the admin key
   (`start_push`, `wait_for_schema`, `finish_push`, as the Convex CLI does). About 5 s on this Mac.
7. The web app starts; the server is ready.

### Server edition code (Folevi Cloud unchanged)

Web build flag `NEXT_PUBLIC_FOLEVI_EDITION=server`, Convex env `FOLEVI_EDITION=server` (`apps/web/src/lib/serverEdition.ts`):

- The browser reaches Convex on the page's own origin (`/convex`); server code uses `FOLEVI_INTERNAL_CONVEX_URL`.
- `output: "standalone"`; no HSTS or `upgrade-insecure-requests`, so plain HTTP on a LAN works.
- `/` and marketing pages go to `/documents`. Share links and "copy link" use the page's own address.
- No billing: everyone has the top plan with no trial (`convex/lib/plans.ts`), Plan & billing and stock photos are
  hidden. Foli AI (and semantic search) show only when `/.well-known/folevi.json` says an AI key is set.
- No email verification when there's no email provider (`convex/auth.ts`); sign-up signs straight in.

## Building

Downloads (approved by the owner 2026-11-24) live in `~/Library/Caches/folevi-server-build/downloads/` and are
checked against the SHA-256 values pinned in `build-bundle.mjs`: Convex's two Linux zips and `LICENSE.md` (GitHub
release digests), Node's two tarballs (nodejs.org `SHASUMS256.txt`), and Ubuntu 22.04's `libc6`, `libstdc++6`,
`libgcc-s1` debs (hashes from `jammy-updates` `Packages`, whose own hash matched `InRelease`; no GPG tool on this
Mac, so the signature itself wasn't checked).

```bash
node scripts/self-host/build-bundle.mjs --arch x86_64 --build 1
```

```bash
node scripts/self-host/build-bundle.mjs --arch aarch64 --build 1 --skip-web-build
```

```bash
node scripts/self-host/build-spk.mjs --bundle ~/Library/Caches/folevi-server-build/out/folevi-server-0.1.0-0001-linux-x86_64
```

Raise `--build` for every test build, or DSM won't offer it as an update. `--arch darwin-arm64` makes a bundle
for testing on a Mac (this Mac's node and the cached macOS backend). Run one with scratch data:

```bash
FOLEVI_DATA=/tmp/fv-data FOLEVI_VAR=/tmp/fvv FOLEVI_PORT=8810 FOLEVI_BIND=127.0.0.1 ~/Library/Caches/folevi-server-build/out/folevi-server-0.1.0-0001-darwin-arm64/bin/folevi-server
```

## The package

- `INFO`: `folevi-server`, `os_min_ver="7.0-40000"`, `arch="x86_64"` or `arch="aarch64 armv8 rtd1296 rtd1619b
  armada37xx"`, `adminport=8810`, `adminurl=/folevi-server/`, `dsmuidir="ui"`, `beta="yes"`.
- `conf/privilege`: `run-as: package` (its own user, never root).
- `conf/resource`: `data-share` with the wizard's `{{wizard_shared_folder}}` (rw for the package user), and
  `port-config` from `conf/folevi-server.sc` (8810/tcp, shows in the firewall and port lists).
- Wizard: the shared folder name (default `folevi`; a new name creates it).
- `scripts/start-stop-status`: starts the launcher with `nohup`, data from `/var/packages/folevi-server/shares/<name>`
  (falls back to `/volume*/<name>`), stops with TERM then KILL after 25 s.
- Main menu: `ui/config` adds a "Folevi Server" icon that opens `http://<nas>:8810/folevi-server/`.

## Tested on this Mac (2026-11-24)

| Check | Result |
| --- | --- |
| Bundle layout with the macOS backend and node, scratch data | Pass: ready in about 6 s on first start (functions deployed in 4.5 s), 4 s after |
| First run in a browser: setup page, setup key, sign-up, welcome steps | Pass |
| Phase 0 walk (`smoke.mjs`): sign-in, notes, folders, search, image upload and reload, public link signed out, Foli AI | All pass, no console errors, Foli AI hidden with no key |
| CSP over plain HTTP | No `upgrade-insecure-requests`, no HSTS, `ws://` allowed |
| Backup now | Pass: a zip with data and files in `backups/` |
| Diagnostics | Pass; locked to the owner's browser or the setup key after setup |
| DSM scripts (`postinst`, `start-stop-status start/status/stop`) on an extracted package | Pass |
| Hard crash, then start | Pass: the leftover web server is ended, the server comes back |
| Memory (Mac, one person) | backend 270 MB, web 115 MB, supervisor 72 MB |
| Linux binaries | ELF for the right chip; need at most `GLIBC_2.35` and `GLIBCXX_3.4.30` (backend) and `GLIBC_2.28` (node), which the bundled libraries cover |

**Not tested yet:** the Linux programs actually running (a throwaway Linux VM on this Mac was refused by the
permission check), DSM itself (arch matching, the wizard variable in `conf/resource`, the `shares/` link, the
package user's rights on the share, the main-menu icon), and the `cxx`/`glibc` fallbacks.

## Known gaps in test build 1

- No email (SMTP comes next), no push notifications, no image resizing (`sharp` is left out).
- The native apps can't sign in to a server yet (plan §5.2).
- Anyone who can reach port 8810 can sign up. An invite-only switch should come before sharing it beyond the owner.
- Signed file links use the main address; opened from a second address, images may not load.
- The onboarding's Foli AI step still shows when the server has no AI key.
- DSM's own HTTPS and reverse proxy aren't set up by the package yet (plan §4).
