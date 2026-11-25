# Folevi Server: the self-hosting plan (version 2)

Version 2, written 2026-11-25 for the owner. It replaces version 1 (2026-11-24, in git history). Phase 0 is done
and passed (`docs/self-hosting/PHASE0.md`). Everything else is a plan; nothing below is built yet.

## The short version

Folevi Server is one program that anyone can run on a NAS or a rented server. It works like Plex Media Server:

- **Install like any NAS app.** On Synology, QNAP, ASUSTOR and TerraMaster it is a real native package from the
  NAS's own app store (or a downloaded installer). No Docker, no Container Manager, no command line, no other
  apps to install first. On Unraid it is a native plugin. On a Linux server (DigitalOcean, Hetzner and others) it
  is one command that installs a normal system service, or a 1-click image.
- **Open it, own it.** A Folevi icon in the NAS menu opens the setup page and then the **admin panel**: people,
  roles, storage, sign-in methods, email, Foli AI, remote access, backups, updates and logs.
- **Members use the normal apps.** Mac, iPhone, iPad, Android and the web sign in to the server the way they sign
  in to Folevi Cloud. If the server is linked to a Folevi account, it simply appears in the apps, like a Plex
  server does. At home and away, with a real HTTPS certificate, without router setup.
- **Email, notifications and Foli AI work out of the box** through small Folevi relays that never see note
  content. Owners can switch each one to their own provider (their SMTP server, their AI key, a local model).

The one honest limit: **TrueNAS, UGREEN (for now), ZimaOS/CasaOS and Umbrel only accept third-party apps as
containers.** There we ship a one-click catalog app; the person never sees or types anything Docker-related, but
it is a container underneath. Details in §3.

Effort: about 16 to 19 weeks for everything, in five phases after Phase 0. A private beta on Synology, QNAP and
Linux servers is possible after about 10 weeks (§12).

## 1. What the owner asked for (2026-11-25)

1. Ready-made NAS boxes (Synology, QNAP and the other major brands): a native package, no Docker and no other
   dependency, installed from the NAS's app store or an installer.
2. TrueNAS and the other major NAS systems covered too.
3. An admin panel with full control, regular members, and access from the Mac, Android, iPhone and iPad apps, as
   with Plex.
4. Email and the other services must work.
5. Also runs on hosted servers: DigitalOcean, Hetzner and similar.

## 2. How it is built: one server, many wrappers

Every platform gets the same server, built once per chip (x86-64 and ARM64) in our CI. Only the outer package
differs. This keeps one thing to test and one version number.

```
folevi-server-<version>-linux-<x86_64|aarch64>/
  bin/folevid            the supervisor (one small static Go program, no dependencies)
  bin/convex-backend     Convex's backend program (database, sync, files, search, scheduled jobs)
  runtime/node/          our own Node.js (web app, and the backend's node actions)
  runtime/lib/           private glibc + libstdc++ for NAS systems with old system libraries (QNAP)
  web/                   the Next.js standalone build, server edition
  functions/             Folevi's backend functions, already bundled, deployed on start
  LICENSES/              Folevi, Convex (FSL-1.1), Node.js and the rest
```

**`folevid`, the supervisor,** is the one new program. It is what the NAS starts and stops. It:

- starts the backend and the web app, restarts them if they crash, and stops them cleanly;
- serves everything on **one port** (default 8460) with one origin: `/` the app, `/convex` the backend and its
  WebSocket, `/convex-site` HTTP actions. Phase 0 proved this layout works (`scripts/self-host/proxy.mjs`);
- creates every secret on first start and keeps them in the data folder, never shown;
- deploys the matching backend functions after an install or update, and runs Folevi's migrations;
- gets and renews the HTTPS certificate (§4), keeps the Folevi Connect link open (§4), and announces the server
  on the home network (Bonjour/mDNS) so apps find it;
- takes the nightly backup and the pre-update backup (§9);
- writes logs that the admin panel shows and that "Send diagnostics" can redact and upload;
- runs with low-memory settings measured in Phase 0 (backend peak 570 MB, settled 260 MB, web app about 150 MB),
  and a larger profile when the machine has 8 GB or more.

Why Go for `folevid`: a single static file runs on every NAS, whatever its system libraries, and Go has good
libraries for reverse proxying, WebSockets, ACME certificates and mDNS. Node already ships for the web app, but
the supervisor must keep working when Node does not.

**Old system libraries.** Phase 0 found that Convex's backend needs glibc 2.35 and Node.js needs 2.28, while QNAP
QTS 5 has glibc 2.21. We ship a private glibc and loader in `runtime/lib` and start both programs through it.
Nothing on the NAS is changed, so it stays "no dependency". On systems that are new enough (DSM 7.2, Unraid,
Debian 12, Ubuntu 22.04+) the system libraries are used and `runtime/lib` is skipped.

**Hardware:** a 64-bit NAS (x86-64 or ARM64) with 2 GB of RAM free; 4 GB recommended for a family, 8 GB for a team
of 20 or more. 32-bit ARM models are not supported (Convex doesn't build for them).

## 3. Platforms

### 3.1 Ready-made NAS boxes: native packages

| NAS | Package | How people install | How it gets into the official store |
| --- | --- | --- | --- |
| **Synology** DSM 7.2+ | `.spk` | Package Center: from Folevi's package source (added once in Package Center > Settings > Package Sources), or Manual Install | Apply to Synology's third-party package program (Plex is listed there). Until accepted, our package source gives the same one-click installs and Update buttons |
| **QNAP** QTS 5.x, QuTS hero | `.qpkg` | App Center: from Folevi's repository, or Install Manually | QNAP must sign the package (QTS blocks unsigned apps by default and never installs invalid ones). Apply to QNAP's partner program for signing and App Center listing. Until then: Qnapclub store, or the "allow apps without a digital signature" setting with a clear guide |
| **ASUSTOR** ADM 4.x/5.x | `.apk` (ASUSTOR's own format) | App Central, or manual install | Upload in ASUSTOR's Developer Corner; listed after ASUSTOR approves it |
| **TerraMaster** TOS 6 | `.tpk` | TOS App Center, or manual install | TerraMaster's TOS Developer Platform (opened 2026-10-30); listed after review |
| **UGREEN** UGOS Pro (DXP) | `.upk` | App Center | UGREEN's developer portal. Their own docs say a NAS needs developer authorization from UGREEN to install a `.upk`, so a native app depends on UGREEN accepting us. **Until then: a container app** (§3.2) |

What every native package does the same way:

- runs as its own package user, never as root (DSM 7 requires this; we do it everywhere);
- asks during install which shared folder holds the data (default `folevi`), so the NAS's own snapshots and backup
  apps (Hyper Backup, HBS 3, ASUSTOR Backup Plan) cover it;
- adds a Folevi icon to the NAS's main menu that opens the setup page, then the admin panel;
- on Synology, registers with DSM's web server so the NAS's own HTTPS address and reverse proxy work without extra
  rules (including the WebSocket header);
- updates from the store's Update button. The supervisor takes a backup first.

### 3.2 NAS systems that only allow containers: one-click catalog apps

| System | What people do | What we ship |
| --- | --- | --- |
| **TrueNAS** Community Edition 25.04+ (the old SCALE) | Apps > Discover > Folevi > Install, fill in a short form (data folder, port) | An app in the TrueNAS Apps catalog: the Community train first, then ask iX for the Stable train. TrueNAS keeps its system read-only and only runs apps this way, so a native package is not possible |
| TrueNAS CORE | End of life | Guide: move to Community Edition, or run Folevi in a Linux VM with the Linux installer |
| **UGREEN** (until §3.1 is accepted) | Docker > Project > paste one short file | Guide with screenshots |
| **ZimaOS / CasaOS**, **Umbrel**, Runtipi | Their app stores, one click | Store submissions |

The container image holds the exact same bundle and `folevid`, so behavior, admin panel and updates are
identical. People never see a compose file or an environment variable in these stores.

### 3.3 Unraid: a native plugin

Unraid allows native plugins (`.plg`), and its system libraries are new enough. We ship a plugin through Community
Apps that installs the bundle on the array (`/mnt/user/appdata/folevi`) and starts `folevid` at boot. A Community
Apps container template is offered too, since many Unraid owners prefer containers.

### 3.4 Hosted servers (DigitalOcean, Hetzner, any Linux machine)

| Route | What people do |
| --- | --- |
| **One command** (recommended) | `curl -fsSL https://get.folevi.com/server \| sh` on Debian 12+ or Ubuntu 22.04+. It adds Folevi's apt (or rpm) repository, installs the `folevi-server` package as a systemd service, and prints the setup address. Updates arrive with the system's normal updates. No Docker |
| **DigitalOcean 1-Click** | Folevi in the DigitalOcean Marketplace: a Droplet image with Folevi Server installed. About $6 a month for the 1 GB plan with swap, $12 for 2 GB (recommended) |
| **Hetzner** | Hetzner Cloud has no third-party marketplace, so we give a cloud-init snippet to paste when creating the server. A CX22 (2 vCPU, 4 GB) is a few euros a month |
| **Coolify, Dokploy, Railway, Fly.io, Render** | Templates and deploy buttons using the container image |
| **Vultr, Linode/Akamai** | Their marketplaces, later, from the same image build |

On a server with a public address, `folevid` gets a Let's Encrypt certificate for the owner's own domain, or uses
the free `folevi.net` address (§4). Ports 80 and 443 only; nothing else is open.

### 3.5 Later, if wanted

Folevi Server for a Mac (a menu-bar app; a Mac mini makes a good home server) and for Windows. Plex offers both.
Not planned until the owner asks.

## 4. Reaching the server from anywhere, like Plex: Folevi Connect

This is what makes it feel like Plex instead of a hobby project. It is optional: a server works fully without a
Folevi account, on its own domain or on the home network.

**Link the server to a Folevi account (optional).** In setup, the owner signs in with their Folevi account. The
server registers with `connect.folevi.com` and gets an ID. From then on:

- every app signed in to that Folevi account lists the server under **Your servers**, with no address to type;
- invited members who have Folevi accounts see it too (§5).

**A real HTTPS address, at home and away.** Each server gets its own name under a domain we register for this,
for example `https://<server-id>.folevi.net`, with a certificate the server holds itself (Let's Encrypt, the DNS
check done through our API, so no ports need to be open). Like Plex's `plex.direct`, the name
`192-168-1-20.<server-id>.folevi.net` resolves to the NAS's home address, so **inside the home the apps connect
directly with full HTTPS**, and passkeys, encryption and offline mode all work there. We put `folevi.net` on the
Public Suffix List so one server's site can never set cookies for another's.

**Remote access, in the order the apps try it:**

1. **Home network, direct.** Found by Bonjour or the address above.
2. **Internet, direct.** `folevid` asks the router to open a port (UPnP or NAT-PMP), and `connect.folevi.com`
   checks from outside that it is reachable. The admin panel shows "Reachable from the internet" or tells the owner
   what to change.
3. **Folevi Relay.** When the router can't be opened (carrier-grade NAT, strict routers), the server keeps one
   outbound connection to our relay, and apps reach it through the relay. The relay passes encrypted TLS through by
   server name and **cannot read it**; only the server holds the certificate (Plex's relay works the same way).
   Notes are small, so the relay is cheap to run; we cap bandwidth for large attachments on the free tier.
4. **The owner's own way:** their own domain with the NAS's reverse proxy, Tailscale, or a Cloudflare Tunnel. The
   admin panel has a guided setup for each, as version 1 planned.

Public share links (`/s/<token>`) work through any of 2 to 4, so people outside the server can open a shared note.

## 5. People: owner, admins, members

| Role | Can |
| --- | --- |
| **Owner** (the first account, can be transferred) | Everything, including the server's settings, other admins, backups and restore, deleting the server's data |
| **Admin** | Invite and manage members, quotas, sign-in rules, email and AI settings, see logs and health |
| **Member** | Use Folevi fully: notes, tasks, sharing with other members and by link, encrypted spaces, Foli AI if allowed |
| **Guest** (optional) | Only what was shared with them; no library of their own |

These map onto the roles the cloud already has: the admin console's Owner/Admin roles (`profiles.platformRole`)
and the workspace roles for sharing. Nothing about sharing, comments or encrypted spaces changes.

**Inviting people:** by email, by a link, or a QR code shown in the admin panel. Optional: open sign-up, or sign-up
only for chosen email domains (useful for a company).

**How members sign in** (the owner turns each on or off):

- **Server account:** email and password, passkeys, two-step codes. Always available, works with no internet.
- **Folevi account:** members sign in with their existing Folevi account, like Plex users do. The server trusts
  `folevi.com` for identity only (OpenID Connect); notes stay on the server.
- **Google and Sign in with Apple:** through a Folevi sign-in broker, so owners don't need their own Google or Apple
  developer keys. Owners who want their own Google keys can add them.
- **Company sign-in (later):** any OpenID Connect provider (Synology SSO Server, Authentik, Microsoft Entra,
  Google Workspace) and LDAP.

## 6. The admin panel

The server edition of today's admin console (`/admin`, `convex/admin.ts`), opened from the NAS menu icon or from
any app's settings for owners and admins. Its sections:

| Section | What it does |
| --- | --- |
| Overview | Version, health of each part, memory and disk use, members online, last backup, reachability |
| People | Invite, roles, suspend, remove, reset password, end sessions, two-step requirement, per-person storage quota |
| Sign-in | Methods on or off (§5), open sign-up, allowed email domains, password rules |
| Workspaces and sharing | Workspaces and their owners; whether public links are allowed; link expiry defaults |
| Remote access | Folevi Connect link, the server's addresses, reachability test, relay on or off, own domain, Tailscale and Cloudflare guides |
| Email | Folevi Mail, own SMTP or none (§7), a "send test email" button, the send log |
| Foli AI | Off, Folevi AI, own key or own model (§7); who may use it; monthly limits per person |
| Notifications | Folevi push relay on or off; test notification |
| Storage | Data folder, size by person, file size limits, cleanup of deleted files |
| Backups | Schedule, how many to keep, where (the data folder, another shared folder, S3-compatible storage), Back up now, Restore |
| Updates | Current and newest version, what's new, update channel (stable or beta), automatic updates on or off |
| Logs and diagnostics | Live logs, download, "Send diagnostics to Folevi" (redacted) |
| Audit log | Who changed what, as the cloud console already records |

The cloud console's rule stays: **metadata, never content.** Admins see people, sizes and counts, never notes. The
owner controls the hardware, so this is a product promise rather than a technical wall, and encrypted spaces stay
unreadable even to the owner.

## 7. Email and the other services

Each outside service has three settings: **Folevi's relay** (works out of the box once the server is linked),
**the owner's own provider**, or **off**. The relays never receive note content.

| Service | Folevi's relay | Owner's own | If off |
| --- | --- | --- | --- |
| **Email out** (verification, password reset, invites, sharing, reminders, digests) | **Folevi Mail**: the server sends through our API, from `no-reply@folevi.net` with Reply-To set to the server owner; rate-limited per server against abuse | Any SMTP account: the NAS's mail server, Gmail, iCloud, Fastmail, Microsoft 365, Amazon SES | No verification emails; invites by link or QR; password resets by an admin |
| **Email in** (email a note to your library, `emailNotes.ts`) | Each person gets an address at the server's Folevi domain; our mail server forwards it to the server | The server checks a mailbox over IMAP that the owner sets up | Hidden |
| **Push to phones** (APNs, FCM) | **Folevi push relay** (Apple and Google only accept our keys): device token and a short notice, generic text for encrypted spaces | Not possible for the App Store and Play builds | No wake-ups; the app catches up when opened |
| **Web push** in browsers | Not needed | Works on the server itself (its own VAPID keys) | |
| **Foli AI** | **Folevi AI**: the server calls our AI gateway; usage counts against the owner's Folevi plan | The owner's Gemini key, or any OpenAI-compatible service, including a local model (Ollama, LM Studio) on the NAS | Hidden everywhere (Phase 0 found it shown with no key; fixed in Phase 1) |
| **Google / Apple sign-in** | Folevi sign-in broker (§5) | Own Google keys | Hidden |
| **Cover photos** (Unsplash) | Through our proxy | Own Unsplash key | Hidden |
| **Calendar subscriptions, link previews, imports** | Not needed; the server fetches directly | | |
| **REST API, MCP server, API tokens** | Work on the server's own address | | |
| **Mac and phone app updates** | Unchanged: apps update from Folevi and the stores | | |
| **Billing** (Polar) | Off in the server edition | | |

Before the relays launch, the Resend sending problem from 2026-10-15 must be fixed, since Folevi Mail sends
through it.

## 8. The apps: Mac, iPhone, iPad, Android, web

The work from version 1 §5.2 stands, plus Connect:

- **Sign-in screen:** *Folevi Cloud* or *Your own server* (address, QR code, or found on the home network).
  Signed in to Folevi Cloud, linked servers are listed and one tap signs in.
- **Many places at once:** a server is another place in the place switcher, beside Folevi Cloud and "On this
  device", as the apps already do for two accounts (`docs/MULTI_ACCOUNT_PLAN.md`). Each place remembers its server
  and its addresses.
- **Best connection:** the app tries home, internet, then relay (§4), and switches when the person leaves home,
  without signing in again.
- **Per-place security policy:** today the shells allow only `*.convex.cloud` (`AppScheme.csp` on the Mac). They
  must allow the place's own server origins.
- **Runtime addresses:** the bundled web export reads the server's addresses from
  `/.well-known/folevi.json` at runtime instead of build-time variables.
- **Version check:** a server older than the app needs gets a clear "Ask the person who runs this server to
  update it", never a broken screen.
- **Android** is paused (`apps/android`), so it follows when Android resumes. The web app already works in
  Android browsers against a server.

## 9. Backups, updates and moving in

- **Backups:** nightly backup of the database export plus files, kept 14 days by default, and before every update.
  Targets: the data folder, another shared folder, or S3-compatible storage (Backblaze B2, Wasabi, the NAS's own
  S3). A Restore button in the admin panel, and a restore on a new machine from the setup page.
- **Updates:** from the NAS store's Update button, the Linux package manager, or automatic updates if the owner
  turns them on. The backend version is pinned per Folevi release, so they always match. If an update fails, the
  supervisor goes back to the previous version and its backup.
- **Moving in:** "Move everything to this server" from Folevi Cloud, using the existing move between accounts and
  takeout import. Also out: a server can move to Folevi Cloud or to another server the same way.

## 10. Security

- Secrets made on the server, kept in the data folder with owner-only permissions, never shown or logged.
- HTTPS everywhere outside the home network; inside it, HTTPS through the `folevi.net` LAN names. Plain HTTP only
  for the first setup on the home network.
- Folevi's relays handle only what each row of §7 says; the remote-access relay can't decrypt traffic.
- No phone-home except what the owner turns on (Connect, relays, update checks); Convex's beacon is off
  (`--disable-beacon`).
- Signed packages wherever the store signs them; release checksums and a signed apt repository for Linux.
- Rate limits and lockouts as in the cloud (Phase 0 confirmed they work on the server).

## 11. What we have to build

| Area | Work | Notes |
| --- | --- | --- |
| Server edition of the web app | Runtime addresses, `/.well-known/folevi.json`, `output: "standalone"`, no marketing or billing, CSP and HSTS that suit HTTP on first setup, internal Convex address for server-side calls | Phase 0 items 3, 5, 7, 8, 9 |
| Backend changes | Email-optional sign-up, static JWKS, AI "configured" flag, SMTP sender, IMAP inbound, roles and quotas, invites, OIDC sign-in, relay clients | Phase 0 items 1, 2, 4 |
| `folevid` | Supervisor, proxy, secrets, deploy, certificates, mDNS, UPnP, Connect client, backups, updates, logs | New Go program |
| Admin panel | Server edition of `/admin` with §6's sections | Reuses the cloud console |
| Setup page | First account, server name, link to Folevi, remote access, email, AI, backups | |
| Folevi Connect service | Server registry, DNS and certificate help for `folevi.net`, reachability check, relay, Folevi account sign-in for servers | Runs on our infrastructure; small, but it must stay up |
| Relays | Mail, push, AI gateway, sign-in broker, Unsplash proxy | Each needs per-server keys, rate limits and abuse controls |
| Apps | §8 for Mac and iPhone/iPad (Android later) | Biggest client change |
| Packaging | `.spk`, `.qpkg`, ASUSTOR `.apk`, `.tpk`, `.upk`, Unraid `.plg`, `.deb`/`.rpm` + apt/rpm repos, install script, container image, TrueNAS/Zima/Umbrel catalog entries, DigitalOcean image | One CI job builds the bundle, one per format wraps it |
| Testing | A real NAS of each chip for Synology and QNAP before each release; the others before their store launch | |

## 12. Phases and effort

| Phase | What | Rough effort |
| --- | --- | --- |
| 0. Spike | Folevi on a standalone Convex backend, one origin, memory | **Done 2026-11-24** |
| 1. Server core | Server edition web build, backend fixes from Phase 0, `folevid` (supervisor, proxy, secrets, deploy, backups, logs), setup page, SMTP, own AI key, roles and invites, admin panel first version | 4 weeks |
| 2. Apps | Your own server at sign-in, server places, best connection, per-place security policy, runtime addresses, version check: web, Mac, iPhone, iPad | 3 weeks |
| 3. First packages | Synology `.spk` and package source, QNAP `.qpkg` with private glibc, Linux one-command installer and apt repo, container image. **Private beta here (about 10 weeks)** | 3 weeks |
| 4. Folevi Connect and relays | Server linking, `folevi.net` names and certificates, LAN HTTPS, UPnP and reachability, remote-access relay, push relay, Folevi Mail, AI gateway, sign-in broker, Folevi-account sign-in for members | 4 weeks |
| 5. Everywhere else | ASUSTOR, TerraMaster, Unraid plugin, TrueNAS catalog, ZimaOS/CasaOS/Umbrel, DigitalOcean Marketplace, Hetzner guide, Coolify/Railway templates, UGREEN when authorized; store submissions; help pages on folevi.com | 3 to 4 weeks, plus each store's review time |

Store reviews (Synology, QNAP signing, ASUSTOR, TerraMaster, UGREEN, TrueNAS) take weeks and run in parallel. Apply
early, during Phase 1.

## 13. What only the owner can do

1. **Developer accounts and applications:** Synology third-party package program, QNAP partner program (signing),
   ASUSTOR Developer Corner, TerraMaster TOS Developer Platform, UGREEN developer portal, DigitalOcean Marketplace
   vendor account.
2. **Register the Connect domain** (for example `folevi.net`; it must be its own domain, not a subdomain of
   folevi.com, for the Public Suffix List) and approve the PSL request.
3. **Test hardware:** the owner has a Synology (model to confirm: its chip decides which `.spk` gets tested first)
   and no QNAP. QNAP is tested without hardware: the private glibc runs in an old-glibc Linux container in CI
   (Ubuntu 16.04 has glibc 2.23, near QTS 5's 2.21), then on QNAP's QuTScloud virtual appliance (QTS in a VM, which
   can run in Synology's Virtual Machine Manager; license terms unverified), then with beta testers who own QNAPs
   before the QNAP package leaves beta.
4. **OK to download** Convex's Linux backend and Node.js for the bundle (Phase 0 is waiting on this).
5. **Fix Resend sending** (open since 2026-10-15), needed for Folevi Mail.
6. **Ask Convex** to confirm in writing that bundling their backend (FSL-1.1) in Folevi Server is fine.

## 14. Decisions for the owner

1. **Price.** Recommended, Plex's model: Folevi Server is free; the relays that cost us money (remote-access relay
   above a small cap, Folevi AI, Folevi Mail above a monthly allowance) come with a paid Folevi plan. A business
   license (company sign-in, more than N members) is an option.
2. **Is a Folevi account required?** Recommended: no. Connect, the relays and Folevi-account sign-in are optional;
   a server with its own domain and SMTP works with no tie to Folevi at all.
3. **Code openness.** Publish the packages only (code private), or open-source the server too?
4. **Relays at launch.** All of §7 at once (Phase 4), or launch the beta with own SMTP and own AI key only and add
   relays after?
5. **Mac and Windows server builds** (§3.5): later, or never?

## 15. Risks

- **Store approval is outside our control.** Synology, QNAP and UGREEN may take months or say no. Our own package
  sources (Synology, QNAP) and the container route (UGREEN) are the fallbacks, so launch doesn't wait on them.
- **QNAP's old glibc.** The private glibc approach must be proven on QTS 5 in Phase 3: in an old-glibc container,
  on QuTScloud, then by beta testers (we own no QNAP). Fallback:
  build Convex's backend ourselves against an older glibc.
- **Memory on small NAS models.** Phase 0's tuned numbers fit 2 GB, but a family's real use must be measured on the
  hardware. The requirements say 4 GB recommended.
- **Running Connect and the relays** makes Folevi responsible for uptime and abuse handling (spam through Folevi
  Mail especially). Per-server limits, owner verification and a kill switch per server are required.
- **Two backends to keep compatible:** every Convex change must also work on servers that update late. The version
  check (§8) makes the gap visible; our CI must test upgrades from the last few server versions.
- **Convex license (FSL-1.1, Apache-2.0 after two years):** looks allowed since we don't sell a Convex competitor;
  get written confirmation and ship their license.
- **Support load:** networking is where self-hosters get stuck. Connect (no router setup) and the reachability test
  are the main defense, with "Send diagnostics" for the rest.

## Sources

- Phase 0 results: `docs/self-hosting/PHASE0.md`; scripts in `scripts/self-host/`.
- TrueNAS apps catalog and trains: https://apps.truenas.com/managing-apps/discovering-apps/,
  https://truenas.com/docs/truenasapps/communityapps, https://www.truenas.com/docs/truenasapps/usingtrains/
- QNAP signatures: https://www.qnap.com/en/how-to/faq/con_show.php?cid=2434,
  https://docs.qnap.com/operating-system/quts-hero/5.1.x/en-us/digital-signatures-343C4CD5.html; Plex's unsigned
  QPKG report https://forums.plex.tv/t/new-qpkg-wont-install-invalid-siganture/939150
- ASUSTOR: https://developer.asustor.com/, https://developer.asustor.com/document/Upload%20your%20Application.pdf
- TerraMaster: https://www.terra-master.com/blogs/news/create-app, https://help.terra-master.com/docs/TOS6/tos-desktop/app-center
- UGREEN developer docs: https://developer-aar.canary.ugnas.com/en/doc/backend/quick-start/testing.html
- Plex relay and `plex.direct`: https://support.plex.tv/articles/200430283-network/,
  https://forums.plex.tv/t/documentation-around-the-warn-cert-tls-errors-plex-direct-sni-dns-overlay-etc/801991
- Version 1's sources (Convex self-hosting, Next.js standalone, Synology, Unraid, Umbrel, CasaOS, Tailscale,
  Cloudflare, Caddy, iOS and Android local networking, Immich, Bitwarden) are in this file's git history.

Not verified yet: Synology's current third-party package program terms; QNAP's partner signing process (not
public); DSM 7.2 and QTS 5 library versions on real hardware; DigitalOcean and Hetzner prices on launch day.
