# Folevi Server: the self-hosting plan

Written 2026-11-24 for the owner. Status: plan only, nothing built yet. Research sources are listed at the end.

## The short version

**Owner's decision (2026-11-24): Synology and QNAP get real native apps** (`.spk`, `.qpkg`) with no Docker and no
Container Manager: the backend program and the web app (with its own Node.js) run as an ordinary NAS service.
Everything else (UGREEN, TrueNAS, Unraid, hosts) uses the container. Both come from one self-contained server
bundle, so there is one server, packaged two ways (see §5.8).

Anyone can run their own **Folevi Server** at home or on a rented server, and every Folevi app (web, Mac, iPhone,
iPad, Android) can sign in to it instead of Folevi Cloud.

- **For the person installing it:** paste one file into their NAS's Docker app (Synology, QNAP, UGREEN, TrueNAS) or
  click one "Deploy" button on a host (Railway, Fly, Coolify). Then they open a setup page in the browser, create the
  first account, and turn on the features they want.
- **For the person using the apps:** on the sign-in screen, choose **Your own server**. Then scan a QR code from the
  server's setup page, or type its address. Everything else works as it does with Folevi Cloud.
- **For us:** about 10 to 13 weeks of work in five phases. The hardest part isn't the server. Today the apps have
  Folevi's own server address built into them, and they must learn to take one at sign-in.

## 1. What Folevi is made of today

| Piece | Today (Folevi Cloud) | In Folevi Server |
| --- | --- | --- |
| Web app | Next.js 16 on Vercel (`apps/web`); marketing site, product and admin console in one build | Same app as a Docker image, product and admin only |
| Backend and database | Convex Cloud (`convex/`): about 80 modules, 30 scheduled jobs, 6 text search indexes, 1 vector index, file storage, HTTP routes | The open-source Convex backend in Docker, with its database on the server's disk |
| Sign-in | Better Auth inside Convex: email and password, passkeys, two-step codes, Google, Sign in with Apple | Email and password, passkeys and two-step codes work as they are. Google is optional with the owner's own keys. Sign in with Apple is off |
| Email | Resend | Any email account via SMTP (Gmail, iCloud, Fastmail, the NAS's mail server), or no email at all |
| Foli AI | Google Gemini (`GEMINI_API_KEY`) | The server owner's own key. Later, any OpenAI-compatible service, including a local model (Ollama) |
| Push notifications | APNs and FCM keys held by Folevi | Through a small **Folevi push relay** that we run (Bitwarden does the same; see §5.4) |
| Billing | Polar | Off |
| Cover photos | Unsplash | Optional, with the owner's key |
| Mac updates | Sparkle feed on R2 | Unchanged: apps keep updating from Folevi. Only the server is self-hosted |

"On this device" mode (local libraries with no account) already exists and needs no server at all. Folevi Server
is for people who want **sync and sharing on hardware they own**.

## 2. What the person installing it will see

1. **Install.** On a NAS: open Container Manager (Synology), Container Station (QNAP), Docker (UGREEN) or Apps
   (TrueNAS), choose *Create project / Install via YAML*, and paste Folevi's `compose.yaml`. On a host: click
   *Deploy on Railway* (or Fly, Coolify, Dokploy).
2. **Open the setup page** at `http://<nas-address>:8080`. It walks through:
   - the server's name
   - the first (owner) account
   - how people will reach it (§4: Tailscale, Cloudflare, or the NAS's own HTTPS)
   - email (optional)
   - a Foli AI key (optional)
   - nightly backups (on by default)
3. **Connect the apps.** The setup page shows a QR code. In any Folevi app, choose *Sign in > Your own server >
   Scan code* (or type the address). Then sign in as usual.
4. **Updates:** a banner in the admin console says when a new server version is out. On a NAS, people update the
   project's image tag; hosts have an Update button. Apps tell people when their server is too old for the app.

## 3. The server package

One public repository folder, `server/`, with a release-pinned `compose.yaml` and an `example.env`, like Immich.
The containers:

| Container | Image | Job |
| --- | --- | --- |
| `folevi` | `ghcr.io/faisalibnislam/folevi-server:<version>` | The Next.js standalone server, the setup page, and on start the deploy of Folevi's backend functions to `convex` (with the admin key, `npx convex deploy`) |
| `convex` | `ghcr.io/convex/convex-backend:<pinned>` | Database, sync, files, search, scheduled jobs |
| `proxy` (optional) | Caddy | One address and one port for everything, with automatic HTTPS when the server has a public name |
| `backup` | Same `folevi` image, another command | A nightly `convex export` into `./backups`, keeping 14, plus a copy of the files folder |

- **Disk layout:** one folder, such as `/volume1/docker/folevi`, holding `data/` (database and files), `backups/` and
  `.env`. Backing up that folder backs up everything.
- **Hardware:** a 64-bit NAS (x86-64 or ARM64; Convex publishes both) with 2 GB of RAM free, 4 GB recommended.
  32-bit ARM models can't run it. Most current Synology Plus, QNAP, UGREEN DXP and TrueNAS boxes qualify.
- **Database:** SQLite on disk by default, which is plenty for a family or small team. Postgres is an option in
  `example.env` for larger teams.
- **Secrets:** generated on first start and kept in `data/`, so nobody types random strings. That covers the
  Convex instance secret, the Better Auth secret, `FOLEVI_SERVER_SECRET`, the file URL secret and the web push keys.
  The Convex admin key is shown once in the setup page for people who want the dashboard.

## 4. Reaching the server safely (HTTPS)

The apps need HTTPS. Passkeys, encryption in the browser, iPhone and Android security rules and the web app's
offline mode all refuse plain `http://` once you leave the home network. The setup page offers these, in this
order:

1. **Tailscale** (recommended for families). Install Tailscale on the NAS and on each phone or Mac; the server gets
   `https://folevi.<name>.ts.net` with a real certificate, and nothing is open to the internet. The catch: every
   device needs the Tailscale app.
2. **Cloudflare Tunnel** (recommended for teams and sharing links). The server gets a public address on the owner's
   own domain, with no router changes and WebSockets supported on the free plan. The catch: it needs a domain on
   Cloudflare, and Cloudflare sees the traffic. Folevi's encrypted spaces stay encrypted end to end.
3. **The NAS's own reverse proxy** with a Let's Encrypt certificate and the maker's free name (Synology's
   `*.synology.me`, QNAP's myQNAPcloud). This needs port forwarding on the router. On Synology, the WebSocket
   header must be added in the reverse proxy rule; the guide shows exactly where.
4. **Built-in Caddy** on a VPS or any machine with ports 80 and 443 open: automatic certificates.

At home, the apps can also connect over the local network with plain HTTP. This needs a small app change on iOS
(`NSAllowsLocalNetworking`) and on Android (a network security rule for local addresses), and passkeys won't work
there.

## 5. What we have to build

### 5.1 One web build for any server (Phase 1)

- Today `NEXT_PUBLIC_CONVEX_URL`, the app URL and the content security policy are **baked in at build time**
  (`apps/web/src/proxy.ts`, `app/layout.shell.tsx`, `lib/shell/csp.ts`). For one image that works on every server:
  - the server reads its addresses from the environment when it starts
  - it serves them at `/.well-known/folevi.json`: the server name, version, Convex URLs, sign-in methods, features
    on, and the minimum app version
  - the web app reads them at runtime. Next.js's own guidance is a root-layout provider; avoid `next-runtime-env`,
    which doesn't support Next 16.
- A `FOLEVI_EDITION=server` build leaves out the marketing site, billing and Folevi-only admin pages. It keeps the
  product, sharing, the admin console's user list and the setup page.
- Better Auth takes its base URL and trusted origins from the server's address. Passkeys use the server's host as
  their relying party.

### 5.2 The apps learn to sign in to any server (Phase 2, the biggest piece)

Today the Mac, iPhone, iPad and Android apps carry the Folevi Cloud addresses in their bundled web export and
their security policies (`AppScheme.csp` allows only `*.convex.cloud`). The plan:

- **Sign-in screen:** *Folevi Cloud* (default) or *Your own server*, with a field for the address and a *Scan code*
  button. The app fetches `/.well-known/folevi.json`, shows the server's name, and refuses `http://` outside the
  local network.
- **Places carry their server:** an account place (`acct:<user id>`) gains a server field, and you can be signed in
  to Folevi Cloud and your own server at the same time, side by side in the place switcher, as the apps already do
  for two Folevi accounts.
- **Security policy per place:** the app's page server allows the place's own server origins instead of a fixed
  list. On the Mac this is `AppScheme.csp` with the place's origins. iOS and Android need the same change in their
  shells.
- **Bundled web export:** the Convex address comes from the place's bootstrap at runtime instead of
  `NEXT_PUBLIC_CONVEX_URL`.
- **Version check:** when a server is older than the app needs, the app says "Ask the person who runs this server to
  update it" instead of failing.

### 5.3 Email without Resend (Phase 1)

Add an SMTP sender beside Resend. With no email set up, the server skips email verification and the owner invites
people with a link or code from the admin console.

### 5.4 Push notifications (Phase 3)

Apple and Google only accept pushes signed with Folevi's own keys, which can't go to every server. So each server
registers once with a tiny **Folevi push relay** (`push.folevi.com`). It gets an installation id and key, and the
relay forwards its notifications. Only the device token and a short notice pass through the relay, never note
content, and encrypted spaces send generic text, as they do today. Bitwarden runs its self-hosted push the same
way. Servers without the relay still work; they just don't wake phones.

### 5.5 Foli AI (Phase 1 and later)

- **Phase 1:** the server owner pastes their own Gemini key in the setup page.
- **Later:** any OpenAI-compatible endpoint, which covers OpenRouter, a local Ollama or LM Studio on the NAS.
  Embeddings need a matching model.
- With no key, Foli AI is hidden, as it is for people who turned it off.

### 5.6 Backups, updates and moving in (Phase 3)

- **Backups:** a nightly export plus files, kept 14 days, and a *Restore* button in the admin console (Immich's
  pattern).
- **Updates:** the `folevi` container deploys its matching backend functions on start, and Folevi's existing
  migrations run as they do in the cloud. The Convex image is pinned per Folevi release, so the two always match.
  Before an update the server takes a backup.
- **Moving from Folevi Cloud to your own server:** the existing account-to-account move and takeout ("move a note to
  the other account" and the takeout import) are reused. Sign in to both in the app, then *Move everything to this
  server*.

### 5.7 Packaging for each platform (Phase 4)

| Platform | How people install | What we ship |
| --- | --- | --- |
| Synology DSM 7.x | **Native app**: Package Center from Folevi's package source, or Manual Install of the `.spk`. No Container Manager | `Folevi-Server-<version>-x86_64.spk` and `-aarch64.spk`, a Folevi package source, and later an application to Synology's official Package Center |
| QNAP QTS/QuTS | **Native app**: App Center from Folevi's repository, or a manual install of the `.qpkg`. No Container Station | `.qpkg` for x86_64 and ARM64; note that 32-bit ARM models aren't supported |
| UGREEN UGOS Pro (DXP series) | Docker > Project > Create | Guide |
| TrueNAS Community Edition (25.10+, the old SCALE) | Apps > Discover > Custom App > Install via YAML; use host paths, not ixVolumes | Guide; later a listing in the TrueNAS community catalog |
| TrueNAS CORE | Reached end of life; jails and VMs are unsupported | Advise moving to Community Edition, or a Linux VM |
| Unraid | Community Apps template, or a compose plugin | A CA template |
| Umbrel, CasaOS/ZimaOS, Runtipi | Their app stores | Store submissions |
| Any Linux box or VPS (Hetzner, DigitalOcean) | `curl` the compose file, `docker compose up`, or Coolify / Dokploy | Guide and a Coolify/Dokploy template |
| Railway | Deploy button (about $10 to $20 a month) | A Railway template |
| Fly.io | `fly launch` from our `fly.toml` (about $7 to $10 a month) | `fly.toml` |
| Render | Blueprint button (needs a paid disk) | `render.yaml` |
| DigitalOcean App Platform, Vercel, Netlify | Not suitable alone (no lasting disk for the backend) | Docs say so |

### 5.8 The native NAS apps (Synology and QNAP)

- **One bundle, two packagings:** the release builds `folevi-server-<version>-linux-<arch>`, which holds:
  - the Convex backend program for that chip (Convex already builds it to run without Docker; if the NAS's system
    libraries are too old for it, we build a fully self-contained version ourselves)
  - the Next.js standalone server with its own Node.js
  - a small supervisor that starts both, runs the function deploy and the nightly backup, and writes logs
- **Synology `.spk`:**
  - runs as its own package user (DSM 7 doesn't let packages run as root)
  - keeps data in a shared folder the person picks during install (default `folevi`), so DSM's Hyper Backup and
    snapshots cover it
  - registers its address with DSM's web server, so it works through the NAS's HTTPS and reverse proxy without
    extra setup
  - opens the setup page from a Folevi icon in the DSM main menu
  - Folevi's own package source (an address added once under Package Center > Settings > Package Sources) gives
    one-click installs and normal update buttons
- **QNAP `.qpkg`:** the same bundle as an App Center app, with a Folevi repository for updates.
- **Builds:** two chips (x86_64, ARM64) per brand per release. Tested on at least one real Synology and one QNAP of
  each chip before a release.
- **To check in Phase 0:** whether Convex's ready-made backend program runs on DSM 7 and QTS as is; memory use on a
  2 GB model.

## 6. Phases and effort

| Phase | What | Rough effort |
| --- | --- | --- |
| 0. Spike | Run Folevi's real backend on a self-hosted Convex, fix what breaks (Better Auth component, crons, vector search, file URLs), measure RAM on a Synology and an ARM box | 1 week |
| 1. Server and web | `folevi-server` image, runtime config and `/.well-known/folevi.json`, server edition build, setup page, SMTP, generated secrets, own AI key, `compose.yaml` and `example.env` | 2 to 3 weeks |
| 2. Apps | Server choice and QR at sign-in, server per place, per-place security policy, runtime Convex address in the bundled export, version check: Mac, iPhone/iPad, Android | 3 weeks |
| 3. Running it | Backups and restore, update flow, push relay, moving in from Folevi Cloud, admin console server page | 2 weeks |
| 4. Packaging | Native Synology `.spk` and QNAP `.qpkg` with their package sources, NAS guides with screenshots, Railway/Fly/Render/Coolify templates, Unraid/Umbrel/CasaOS/TrueNAS listings, help pages on folevi.com | 3 to 4 weeks |

A first private beta is possible after Phases 0 to 2: about 6 to 7 weeks.

## 7. Decisions for the owner

1. **Price.** Is Folevi Server free for everyone? Or free for personal use with a paid license for businesses (a key
   entered in the setup page)? Or included with a paid plan?
2. **Code openness.** Is the server image published publicly (free to run, code private), or is the code
   open-sourced too?
3. **Push relay.** Is it free for every server, or part of a paid tier (it costs us a little to run)?
4. **AI.** Is Gemini enough at first, or is "any OpenAI-compatible service" (including local models) needed for
   launch? Privacy-minded NAS owners will ask for local models.
5. **Support.** Self-hosters can only be helped with their logs. Do we offer a "send diagnostics" button that
   uploads a redacted log?

## 8. Risks

- **Convex license (FSL-1.1, Apache-2.0 after two years).** Bundling it in Folevi Server looks allowed, since we
  aren't selling a Convex competitor. We must keep Convex's license and notices in the package. Ask Convex to
  confirm in writing before launch.
- **Self-hosted Convex has no backup button,** so we build our own (§5.6).
- **One backend version per Folevi version:** we must test each upgrade path, which adds release work.
- **Memory:** the backend can use 1 to 4 GB. Low-end NAS models (2 GB total) will struggle; the requirements must
  say so plainly.
- **Support load:** network and HTTPS problems are where most self-hosters get stuck. The setup page's guided
  Tailscale or Cloudflare choice is the main defense.
- **Two backends to keep compatible:** every Convex schema or function change must work on both Folevi Cloud and
  servers that update late. The version check (§5.2) makes the gap visible.

## Sources

- Convex self-hosting: https://github.com/get-convex/convex-backend/tree/main/self-hosted (compose, Postgres/MySQL,
  S3 storage, upgrading, disabling the beacon, Fly and Railway templates), https://docs.convex.dev/self-hosting,
  license https://github.com/get-convex/convex-backend/blob/main/LICENSE.md
- Coolify https://coolify.io/docs/services/convex; Dokploy https://docs.dokploy.com/docs/templates/convex
- Next.js self-hosting https://nextjs.org/docs/app/guides/self-hosting; standalone output
  https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Synology Container Manager https://www.synology.com/en-us/releaseNote/ContainerManager; Synology Docker Project
  worker https://help.synology.com/developer-guide/resource_acquisition/docker-project.html
- QNAP Container Station https://www.qnap.com/en/how-to/tutorial/con_show.php?cid=510
- UGREEN Docker https://nas.ugreen.com/blogs/how-to/set-up-navidrome-on-nas
- TrueNAS custom apps https://www.truenas.com/docs/scale/27/apps/installcustomappscreens/; CORE migration
  https://www.truenas.com/docs/scale/25.10/gettingstarted/migrate/
- Unraid templates https://ca.unraid.net/submit/help/repository-xml; Umbrel https://github.com/getumbrel/umbrel-apps;
  CasaOS https://github.com/IceWhaleTech/CasaOS-AppStore
- Tailscale Serve https://tailscale.com/kb/1312/serve, Funnel https://tailscale.com/kb/1223/funnel; Cloudflare
  WebSockets https://developers.cloudflare.com/network/websockets/; Caddy https://caddyserver.com/docs/automatic-https
- iOS local networking https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking;
  Android network security config https://developer.android.com/privacy-and-security/security-config
- Railway pricing https://railway.com/pricing; Fly pricing https://docs.fly.io/about/pricing; Render disks
  https://render.com/docs/disks
- Patterns: Immich install and backups https://docs.immich.app/install/docker-compose,
  https://docs.immich.app/administration/backup-and-restore; Bitwarden self-hosted server URL
  https://bitwarden.com/help/change-client-environment/

Not verified yet: exact Convex memory use, QNAP and UGREEN HTTPS tooling, TrueNAS catalog submission steps, current
Hetzner prices. Phase 0 settles the first one.
