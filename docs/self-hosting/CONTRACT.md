# Folevi Server: the contract between the pieces

Written 2026-11-25 to let six workstreams build Folevi Server in parallel (plan: `docs/SELF_HOSTING_PLAN.md` v2).
Every name here is binding. If a workstream must change something, it changes this file and says so in its report.

Pieces and owners:

| Piece | Folder | What |
| --- | --- | --- |
| Backend | `convex/`, `packages/email/` | Server edition of the Convex functions |
| Web | `apps/web/` | Server edition of the web app, setup page, server admin panel, "Your own server" sign-in, cloud pages for Connect |
| Supervisor | `server/folevid/`, `server/bundle/` | `folevid` (Go) and the script that assembles the bundle |
| Connect | `services/connect/` | Folevi Connect service and relays (Go) |
| Packaging | `packaging/`, `.github/workflows/server-*.yml` | Every package format, installers, catalog entries |
| Apps | `apps/mac/`, `apps/ios/` | Native shells: server places, per-place security policy, runtime addresses |

## 1. Edition

- `FOLEVI_EDITION=server` in the Convex backend environment and in the web server's runtime environment turns on
  the server edition. Unset (or `cloud`) means Folevi Cloud, which must behave exactly as today.
- Web build: `FOLEVI_EDITION=server next build` produces the server build (`output: "standalone"`, no marketing
  site, no billing). The cloud build is unchanged.

## 2. Ports and layout (all on one machine)

| Port | Bind | Who | What |
| --- | --- | --- | --- |
| 8460 | `0.0.0.0` (configurable `FOLEVI_PORT`) | folevid | The one public port. `/convex/*` (HTTP + WebSocket) to 3510 with the prefix removed, `/convex-site/*` to 3511 with the prefix removed, everything else to 3501 |
| 8443 | `0.0.0.0`, only when a certificate exists | folevid | The same routes over HTTPS (`FOLEVI_HTTPS_PORT`) |
| 8461 | `127.0.0.1` | folevid | Control API (§5) |
| 3501 | `127.0.0.1` | web (`node server.js`) | Next.js standalone |
| 3510 / 3511 | `127.0.0.1` | convex-backend | Client API / HTTP actions |

Public addresses: app `<origin>`, Convex `<origin>/convex`, Convex site `<origin>/convex-site`.

## 3. Data folder

`$FOLEVI_DATA` (chosen by the package; for example `/volume1/folevi`):

```
config.json          settings folevid owns (port, public URL, connect state, backup schedule)
secrets/             mode 700; one file per secret, never logged
  instance-secret  admin-key  better-auth-secret  hash-salt  file-url-secret  server-secret
  setup-token  vapid-public  vapid-private  connect-token  connect-key  backup-key  tls/
convex/              convex.sqlite3, storage/
backups/             <timestamp>.zip (Convex export + files), 14 kept by default
logs/                folevid.log, backend.log, web.log (rotated, 10 MB x 5)
tmp/                 short TMPDIR for the backend (must stay under 80 characters)
```

## 4. Environment folevid passes

To the backend process: `TMPDIR`, `PATH` with our Node first, the low-memory knobs from Phase 0
(`APPLICATION_MAX_CONCURRENT_QUERIES=4` etc.), flags `--convex-origin <origin>/convex --convex-site
<origin>/convex-site --disable-beacon --redact-logs-to-client --local-storage`.

Convex environment variables folevid sets with `convex env set` before each deploy:

| Variable | Value |
| --- | --- |
| `FOLEVI_EDITION` | `server` |
| `FOLEVI_ENV` | `production` |
| `SITE_URL`, `FOLEVI_APP_URL` | the public origin |
| `BETTER_AUTH_SECRET`, `FOLEVI_HASH_SALT`, `FOLEVI_FILE_URL_SECRET`, `FOLEVI_SERVER_SECRET` | from `secrets/` |
| `FOLEVI_SETUP_TOKEN_HASH` | SHA-256 hex of `secrets/setup-token` |
| `FOLEVI_JWKS` | static JWKS JSON so the backend never fetches its own public address (empty until the backend has made its keys; folevid fetches it from `http://127.0.0.1:3511/api/auth/convex/jwks` after the first deploy and sets it) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | generated |
| `FOLEVI_SERVER_VERSION` | the bundle version |
| `FOLEVI_CONNECT_URL` | `https://connect.folevi.com` (overridable for tests) |
| `FOLEVI_CONNECT_TOKEN` | the server's Connect token, once registered (§7) |
| `FOLEVI_CONNECT_SERVER_ID`, `FOLEVI_CONNECT_HOSTNAMES` | the Connect id and names (home names first, comma separated), once registered |
| `FOLEVI_TRUSTED_ORIGINS` | every origin the server answers on, comma separated (public origin, Connect names, own domain, LAN addresses, `.local` name, loopback); Better Auth trusts each (added 2026-11-25) |

To the web process: `PORT=3501`, `HOSTNAME=127.0.0.1`, `FOLEVI_EDITION=server`, `FOLEVI_PUBLIC_URL=<origin>`,
`FOLEVI_INTERNAL_CONVEX_URL=http://127.0.0.1:3510`, `FOLEVI_INTERNAL_CONVEX_SITE_URL=http://127.0.0.1:3511`,
`FOLEVI_SERVER_SECRET`, `FOLEVI_CONTROL_URL=http://127.0.0.1:8461`, `FOLEVI_SERVER_VERSION`.

The public origin can change (a new domain, Connect names). folevid restarts the web process and redeploys the env
when it does; the web app reads every address at runtime, never at build time.

## 5. folevid control API (loopback only)

`http://127.0.0.1:8461`, every request needs `Authorization: Bearer <FOLEVI_SERVER_SECRET>`. JSON in and out.
Only the web server calls it, after checking that the signed-in person is the owner or an admin.

| Method and path | Result |
| --- | --- |
| `GET /v1/status` | `{version, uptimeSeconds, publicUrl, services:[{name, state, pid, rssBytes, restarts}], disk:{dataBytes, freeBytes}, memory:{totalBytes, availableBytes}}` |
| `GET /v1/logs?service=folevid\|backend\|web&lines=500` | `{lines:[string]}` (secrets redacted) |
| `GET /v1/backups` | `{backups:[{id, createdAt, sizeBytes, kind:"nightly"\|"manual"\|"pre-update", encrypted}], schedule:{enabled, hour, keep, target}}` |
| `POST /v1/backups` | start one now: `{id}` |
| `PUT /v1/backups/schedule` | `{enabled, hour, keep, target:{kind:"local"\|"folder"\|"s3", path?, s3?:{endpoint, bucket, prefix, accessKeyId, secretAccessKey, region}}}` |
| `POST /v1/backups/{id}/restore` | optional body `{key?}` (the backup key of the server that made it); restore, restarting services: `{ok}`. 422 when the backup is encrypted with a key this server does not have, 400 for a malformed key |
| `GET /v1/backups/key` | `{key, recipient}`: the backup key (`AGE-SECRET-KEY-1...`, secret; owner only, shown once for the owner to save) and its public half (`age1...`) |
| `GET /v1/remote` | `{publicUrl, connect:{state:"off"\|"registered"\|"linked", serverId?, hostname?, lanHostnames?}, upnp:{state, externalPort?}, reachable?:boolean, relay:{enabled, connected}, customDomain?}` |
| `PUT /v1/remote` | `{connectEnabled?, relayEnabled?, upnpEnabled?, customDomain?}` |
| `POST /v1/connect/link` | start linking to a Folevi account: `{code, approveUrl, expiresAt}` |
| `GET /v1/update` | `{current, latest?, notesUrl?, channel:"stable"\|"beta", managedBy:"store"\|"apt"\|"folevid"}` |
| `POST /v1/diagnostics` | redact and upload logs through Connect: `{reference}` |

## 6. `/.well-known/folevi.json` (served by the web app)

```json
{
  "kind": "folevi-server",
  "apiVersion": 1,
  "name": "Smith family",
  "version": "1.0.0",
  "minAppVersion": "1.6.0",
  "urls": { "app": "https://x", "convex": "https://x/convex", "convexSite": "https://x/convex-site" },
  "signIn": { "password": true, "passkey": true, "folevi": false, "google": false, "apple": false, "signUp": "invite" },
  "features": { "ai": false, "email": false, "push": false, "publicLinks": true },
  "connect": { "serverId": null, "hostnames": [] },
  "needsSetup": false
}
```

Folevi Cloud serves the same file with `"kind": "folevi-cloud"`. Apps refuse a server whose `apiVersion` they
don't know, and show "Ask the person who runs this server to update it" when their own version is below
`minAppVersion` or the server's `version` is below what the app needs.

### 6.1 Notes from the Apps workstream (native shells)

- `connect.hostnames`: each entry is `host` or `host:port`, always reached over https. Home names
  (`192-168-1-20.<id>.folevi.app`, first label a dashed IPv4) are tried first, then the address the person added,
  then the rest; the apps move each of `urls` that sits on the added origin to the chosen name with the same path.
  The server must therefore serve the same paths on every name, and Better Auth must trust every one of its names
  as an origin (the session is the server's, so switching names never signs anyone out).
- Bridge (`window.foleviShell.places`, shell-bridge.js), for `apps/web/src/lib/shell/types.ts`:
  - `server: ShellServerInfo | null`, set before page scripts run: the server of this page's place, or of the
    sign-in screen it shows; null for Folevi Cloud and the library.
    `ShellServerInfo = { origin, addedOrigin, name, version, serverId: string | null, urls: { app, convex, convexSite } }`,
    with `origin` and `urls` at the name in use now. The bundled export must read its Convex and site addresses
    from here when it is non-null, instead of the build-time `NEXT_PUBLIC_*` values.
  - `addServerPlace({ origin, info? }): Promise<ShellServerInfo>`. The app ignores `info` and fetches
    `/.well-known/folevi.json` itself. It rejects with `{ code, message }`, code one of `bad_address`,
    `unreachable`, `not_folevi`, `folevi_cloud`, `server_outdated`, `app_outdated`, `needs_setup`. On success
    every window reloads on that server's sign-in screen (mode `account`, `current: null`, `server` set);
    `auth.signIn`, `auth.fetch` and `places.signIn` then go to that server, and the account that signs in becomes
    a place on it.
  - `listLocalServers(): Promise<{ name, origin, serverId: string | null, version: string | null }[]>` (Bonjour).
  - `scanCode?(): Promise<string | null>` (added 2026-11-25): the camera reads a QR code and returns its text (null
    when closed); the page reduces a link to its origin (`addressFromCode`) and looks the server up. Hosts without
    a camera leave it out, and the "Scan QR code" button is hidden.
  - With `server` set and nobody signed in, the shell's sign-in screen names that server and offers only "Sign in"
    (the server's own page offers its ways in). `minAppVersion` is compared with the shell's `shellVersion`.
  - `ShellPlace` (kind `account`) gains `server: ShellServerInfo | null`.
- Accepted addresses: `https://` anywhere; `http://` only for localhost, a name with no dots, `*.local`, or a
  private, link-local or 100.64/10 IP. No path, query or user name.
- Security policy: a server place's pages get a header CSP whose `connect-src` is `'self'` plus each of the
  server's origins at every name, over http(s) and ws(s); never `*.convex.cloud`. The header narrows the export's
  meta CSP (both apply), so the server-capable export's meta `connect-src` must not be limited to the build's
  Convex host (for example `'self' https: wss:` plus `http: ws:` if home http addresses are to work).
- Bonjour (supervisor): advertise `_folevi._tcp` on the public port with TXT `id` (Connect server id, if any),
  `name`, `v` (server version) and `url` (the https origin to use, when a certificate exists). Without `url` the
  apps use `http://<address>:<port>` of the service.

## 7. Backend functions (Convex, server edition)

Public (no sign-in):

| Function | Shape |
| --- | --- |
| `server:info` query | everything in §6 except `urls` (the web server adds those) |
| `server:claimOwner` mutation | `{setupToken}`; the signed-in person becomes Owner if the server has none and the token's SHA-256 matches `FOLEVI_SETUP_TOKEN_HASH`. Returns `{ok}` |
| `serverInvites:preview` query | `{token}` to `{serverName, invitedBy, email?, role, expired}` |
| `serverInvites:accept` mutation | `{token}`; the signed-in person joins with the invite's role |

Owner and Admin only (every other caller gets `not_found`, as `convex/admin.ts` does):

| Function | Shape |
| --- | --- |
| `serverAdmin:getSettings` query | the settings (§8), secrets replaced by `{set: boolean}` |
| `serverAdmin:updateSettings` mutation | a partial of §8; secrets accepted write-only; audited |
| `serverAdmin:listPeople` query | `[{userId, name, email, role, suspended, storageBytes, quotaBytes?, lastActiveAt, twoFactor}]` |
| `serverAdmin:invite` mutation | `{email?, role}` to `{token, url, expiresAt}`; emails it when email is on |
| `serverAdmin:listInvites` / `serverAdmin:revokeInvite` | |
| `serverAdmin:setRole` mutation | `{userId, role}`; only the Owner can make Admins; there is always exactly one Owner |
| `serverAdmin:transferOwnership` mutation | Owner only |
| `serverAdmin:suspend` / `serverAdmin:unsuspend` / `serverAdmin:removePerson` / `serverAdmin:endSessions` / `serverAdmin:resetPassword` | `{userId}` (reset returns a one-time link when email is off) |
| `serverAdmin:setQuota` mutation | `{userId, quotaBytes \| null}` |
| `serverAdmin:testEmail` action | `{to}` to `{ok, error?}` |
| `serverAdmin:overview` query | `{people, storageBytes, notes, lastSignIns}` (counts only, never content) |

Roles: `owner` = `profiles.platformRole: "super_admin"`, `admin` = `"ops_admin"`, `member` = no platform role,
`guest` = a new optional `profiles.serverGuest: true`. In the cloud edition none of this changes anything.

Cloud edition only (for Connect, §9):

| Function | Shape |
| --- | --- |
| `connect:myServers` action | the signed-in person's linked servers from the Connect service: `[{serverId, name, hostname, lanHostnames, version, online, role:"owner"\|"member"}]` |
| `connect:approveLink` action | `{code}`; links the server waiting on that code to the signed-in person |

### 7.1 Notes from the Backend build (2026-11-25)

Built in `convex/server.ts`, `convex/serverAdmin.ts`, `convex/serverInvites.ts`, `convex/connect.ts` (tests:
`tests/convex/server-edition.test.ts`). What the table above left open, now fixed:

1. **`userId`** in every `serverAdmin:*` call and result is the **profile id** (`profiles._id`), as in the cloud
   admin console.
2. **Admin access:** owner and admin, no two-step requirement (the cloud console requires it; a home server's
   owner may not have an authenticator app).
3. **`serverAdmin:updateSettings`** takes `{patch}` (a partial of §8). A secret field: a string sets it, `null`
   clears it, left out keeps it. Validation errors are `invalid_argument` with a message for the admin. It returns
   the same view as `getSettings`, which also has `configured: {email, ai, pushRelay}`. Audit records list the
   changed field names only.
4. **Invites:** `serverAdmin:invite` returns `{token, url, expiresAt, inviteId, emailed}`; the link is
   `<origin>/join/<token>` (`/invite/` is taken by workspace invites), 7 days. `serverAdmin:revokeInvite` takes
   `{inviteId}`; `listInvites` returns `[{inviteId, email?, role, invitedBy, createdAt, expiresAt,
   state: "pending"|"used"|"accepted"|"revoked"|"expired", acceptedBy?}]`. `serverInvites:preview` returns null for
   an unknown token. An invite never lowers anyone's role; only `setRole` does. `setRole` takes
   `"admin"|"member"|"guest"` (the owner changes only through `transferOwnership`).
5. **Sign-up with an invite (web and apps):** the sign-up request carries the token as `inviteToken` in the
   `/api/auth/sign-up/email` JSON body, or as the `x-folevi-invite` header (Google and Apple sign-ups: the header).
   Better Auth's user hook checks the server's sign-up mode for every new account, spends the invite, and the
   account gets the invite's role when `users:bootstrap` makes its profile. Refusals are 403 with codes
   `SIGNUP_INVITE_ONLY`, `SIGNUP_DOMAIN`, `INVITE_INVALID`, `INVITE_OTHER_EMAIL`. While the server has no owner
   (`needsSetup`), sign-up is open so the setup page can create the owner's account, which then calls
   `server:claimOwner`.
6. **Email off:** new accounts start verified (nothing to verify with), so sign-up and sign-in need no email. With
   email on, verification works as in the cloud. Password sign-in or passkeys turned off in `signIn` are refused
   by the backend too (`PASSWORD_SIGN_IN_OFF`, `PASSKEY_SIGN_IN_OFF`).
7. **`serverAdmin:resetPassword`** returns `{emailed, link, expiresAt}`: with email on, `{emailed: true, link:
   null}`; with email off, a one-time `<origin>/reset-password?token=...` link valid for 1 hour.
8. **`serverAdmin:overview`** returns `{people, storageBytes, notes, lastSignIns: [{userId, name, at}]}` (the ten
   most recently active people).
9. **`serverAdmin:testEmail`** returns `{ok, error?}` with `error` in words for the admin.
10. **`server:info`** works on both editions (the cloud returns `kind: "folevi-cloud"`). `features.ai` is the
    "Foli AI configured" flag: hide Foli AI when it is false. `connect` comes from the optional backend variables
    `FOLEVI_CONNECT_SERVER_ID` and `FOLEVI_CONNECT_HOSTNAMES` (comma separated), else `{serverId: null,
    hostnames: []}`; the web server may fill it from the control API instead. Google and Apple show as on only
    when their keys are in the backend's environment (`GOOGLE_CLIENT_ID`/`_SECRET`, `APPLE_SIGNIN_*`).
11. **`connect:myServers`** returns `[]` when Connect isn't available (a server, or no `CONNECT_SERVICE_KEY`) or
    can't be reached. **`connect:approveLink`** returns `{ok: true}` or `{ok: false, error: "not_available" |
    "invalid_code" | "expired" | "failed"}`. Both need a signed-in person.
12. **`FOLEVI_JWKS`** (§4) accepts either the public set `{"keys":[...]}` from `/api/auth/convex/jwks` (tokens keep
    being signed with the key in the database) or the key rows Better Auth's `getLatestJwks` returns. It is read
    only in the server edition. Changing it needs a redeploy, since `auth.config.ts` is read at deploy time.
13. **Folevi AI** (`ai.mode: "folevi"`) calls `${FOLEVI_CONNECT_URL}/v1/ai/chat/completions` with model
    `folevi-default` and `/v1/ai/embeddings` with model `folevi-embedding` and `dimensions: 768`, bearer the Connect
    token. Streaming requests send `stream: true` and `stream_options: {include_usage: true}`.
14. **Billing** is off in the server edition: everyone has the top plan with no trial, `billing:checkout`,
    `buyCredits`, `portal` and the workspace billing actions answer `not_found`. Storage is limited only by quotas;
    `ai.monthlyLimitPerPerson` is in AI credits (100 credits = US$1 of model usage at Gemini Flash prices).
15. **Push relay:** a 410 drops the device token; a 503 is tried once more after 1.5 s. The `data` sent is
    `{kind, path, taskId?, label?, place?}`.
16. **Not built yet:** inbound email (`emailIn`), Google sign-in from `settings.google` (Google keys come from the
    environment for now), covers through Folevi or the server's Unsplash key, and limits for guests (a guest is
    stored as `profiles.serverGuest` but can still make notes of their own).

## 8. Server settings (singleton table `serverSettings`)

```ts
{
  name: string,
  signUp: "invite" | "open" | "domains", allowedDomains: string[],
  signIn: { password: boolean, passkey: boolean, folevi: boolean, google: boolean, apple: boolean },
  google?: { clientId: string, clientSecret: string /* write-only */ },
  publicLinks: boolean,
  defaultQuotaBytes?: number,
  email: { mode: "off" | "folevi" | "smtp",
           smtp?: { host, port, security: "tls" | "starttls" | "none", username?, password? /* write-only */, from } },
  emailIn: { mode: "off" | "folevi" | "imap", imap?: { host, port, username, password /* write-only */, folder } },
  ai: { mode: "off" | "folevi" | "gemini" | "openai",
        gemini?: { apiKey /* write-only */, model?, embeddingModel? },
        openai?: { baseUrl, apiKey? /* write-only */, model, embeddingModel? },
        allowed: "everyone" | "admins", monthlyLimitPerPerson?: number },
  push: { relay: boolean },
  covers: { mode: "off" | "folevi" | "unsplash", unsplashKey? /* write-only */ },
  ownerUserId?: string,
}
```

Email verification is required only when `email.mode !== "off"`. With email off, sign-up needs an invite (or open
sign-up), and password resets come from an admin.

## 9. Folevi Connect (`https://connect.folevi.com/v1`)

Server calls use `Authorization: Bearer <connect-token>`. Cloud calls (from Folevi Cloud's Convex) use
`Authorization: Bearer <CONNECT_SERVICE_KEY>` and pass `X-Folevi-User: <cloud user id>`.

| Method and path | Caller | Shape |
| --- | --- | --- |
| `POST /v1/servers` | server | `{name, version, publicKey}` (Ed25519, base64) to `{serverId, token}`. `serverId` is 10 lowercase base32 characters |
| `PATCH /v1/servers/{id}` | server | `{name?, version?, lanIps?, publicPort?}`; Connect points `<id>.folevi.app` at the public IP (or the relay) and `<a-b-c-d>.<id>.folevi.app` at each LAN IP |
| `POST /v1/servers/{id}/link-codes` | server | to `{code, approveUrl: "https://app.folevi.com/connect/approve?code=..."}`, 10 minutes |
| `GET /v1/servers/{id}` | server | `{linked: boolean, ownerAccount?, hostname, lanHostnames, reachable?}` |
| `PUT /v1/servers/{id}/acme/{label}` / `DELETE` | server | `{value}`; sets `_acme-challenge.<label>.<id>.folevi.app` (label `@` for the bare name) for the DNS-01 check |
| `POST /v1/servers/{id}/reachability` | server | `{port}` to `{reachable, publicIp}` |
| `POST /v1/mail` | server | `{to, subject, html, text, replyTo?, tag}` to `202 {id}`; From is `<server name> <no-reply@folevi.app>` |
| `POST /v1/push` | server | `{platform: "apns" \| "fcm", token, environment?: "production" \| "sandbox", title, body, data?, collapseId?, threadId?}` to `202` |
| `POST /v1/ai/chat/completions`, `POST /v1/ai/embeddings` | server | OpenAI-compatible request and response (streaming allowed); counts against the owner's plan |
| `GET /v1/unsplash/*` | server | proxied Unsplash API |
| `POST /v1/diagnostics` | server | `{text}` to `{reference}` |
| `POST /v1/link-codes/{code}/approve` | cloud | links to `X-Folevi-User` |
| `GET /v1/accounts/{userId}/servers` | cloud | see `connect:myServers` |
| `wss://relay.folevi.app/v1/tunnel` | server | bearer token; yamux over WebSocket; the relay accepts TLS on :443, reads the SNI, and pipes raw bytes for `<id>.folevi.app` and `*.<id>.folevi.app` into a new stream. It never terminates TLS |

## 10. Bundle layout and versions

```
folevi-server-<version>-linux-<x86_64|aarch64>/
  VERSION  manifest.json  LICENSES/
  bin/folevid  bin/convex-backend
  runtime/node/bin/node  runtime/lib/ (optional private glibc + libstdc++, with ld-linux)
  web/            Next.js standalone (server.js, .next/static, public)
  functions/      `npx convex deploy` inputs: the convex/ folder bundled, plus node_modules it needs
```

`folevid run --data <dir> --bundle <dir>` starts everything. `folevid version`, `folevid setup-url`,
`folevid backup`, `folevid restore <id>` are the other commands packages use. Exit codes: 0 clean, 1 error,
2 bad configuration.

Server version numbers follow the app's unified version (`docs/claude-context/memory/unified-version.md`).
`minAppVersion` starts at the first app release that has "Your own server".

## 11. Rules for everyone

- Never push `main`, deploy, use `--prod` with the Convex CLI, notarize or upload anything.
- Never print secrets. No em dashes in text. The assistant is "Foli AI".
- Folevi Cloud must behave exactly as before when `FOLEVI_EDITION` is unset; tests prove it.

### 9.1 Changes from the Connect build (2026-11-25)

1. **Reachability:** the server answers `GET /.well-known/folevi-connect/reach?nonce=N` on its HTTPS port with
   `{"signature": "<base64 Ed25519 signature of folevi-connect-reach:<serverId>:N>"}`, signed with its registered
   key. The reachability response also has `certificateValid`.
2. **Tunnel:** folevid is the yamux **server** side. Each stream starts with a PROXY protocol v1 line naming the
   client, then the raw TLS bytes.
3. **Push:** `/v1/push` returns `410 {"error":"token_gone"}` for a dead device token (the server drops that token)
   and `503` when the provider is busy (retry later), otherwise `202`.
4. **Mail:** `to` is one address, not a list.
5. **Server list:** `GET /v1/accounts/{userId}/servers` returns a bare array, and `X-Folevi-User` must equal
   `userId`.
6. **Additions:** a `/v1/admin/*` API for Folevi staff (flags, kill switches), extra fields on `GET
   /v1/servers/{id}`, and `hostname` in the register response. See `services/connect/README.md`.

### 10.1 Changes from the folevid build (2026-11-25)

- Backup files are `backups/<UTC timestamp>-<kind>.zip.age` (older ones `.zip`). Each holds the Convex export with
  stored files and `secrets.json` (hash salt, auth and file-URL secrets) so a restore on a new machine keeps
  sign-ins and file links.
- **Encrypted backups (added later the same day):** every new backup is the ZIP streamed through
  [age](https://age-encryption.org/v1) to the X25519 key in `secrets/backup-key` (made on first start, never
  logged), on every target (local, folder, S3). Restore tells encrypted and plain files apart by their first bytes,
  so old `.zip` backups still restore. On the same machine nothing is asked. On a new machine the owner gives the
  old server's key: `POST /v1/backups/{id}/restore` with `{"key": "AGE-SECRET-KEY-1..."}` (or `folevid restore <id>
  --key-file <file>`); when that key (not the machine's own) opened the backup it becomes this server's
  `backup-key`, so the one key the owner saved keeps opening every backup. `GET /v1/backups/key` returns
  `{key, recipient}` for the admin panel to show once ("save this key somewhere safe; without it a backup cannot be
  restored on another machine"). Backup rows have `encrypted`. A key that fits no identity answers 422.
- New secret file `secrets/connect-key` (the server's Ed25519 key for Connect).
- `FOLEVI_JWKS` starts as a single space: Convex refuses to deploy an auth config that reads an unset variable.
  So the repo's `convex/auth.config.ts` stays Folevi Cloud's (no environment reads), and the bundle's
  `functions/convex/auth.config.ts` is `server/bundle/auth.config.server.ts`, which reads only `FOLEVI_JWKS` and
  `CONVEX_SITE_URL` (prepare-functions.mjs copies it in).
- Additions: `/v1/status` has `memory.profile` (`tiny` up to 2.5 GB of RAM, `low` up to 8 GB, `high` above) and
  `memory.low`; `POST /v1/backups?wait=1` waits for the backup to finish.
- Extra settings: `FOLEVI_TMPDIR`, `FOLEVI_BIND`, `FOLEVI_RELAY_URL`, `FOLEVI_MANAGED_BY`, `FOLEVI_PUBLIC_URL`.
- Relayed streams are handed to the HTTPS server in-process (not dialed to :8443), so the client address survives.
- `server/bundle/build-bundle.sh --version V --arch A --out DIR` also needs `CONVEX_BACKEND`, `NODE_DIST`,
  `WEB_STANDALONE` and `FUNCTIONS_DIR` (paths, or https URLs it downloads), and `functions/` needs the target
  chip's `@esbuild` binary.
- `FUNCTIONS_DIR` comes from `server/bundle/prepare-functions.sh --arch A --out DIR` (about 70 MB instead of the
  workspace's 560 MB): `convex/` with `_generated`, the few `packages/` files convex/ imports by relative path,
  and only the node_modules the Convex CLI reads (found by running esbuild the way the CLI does). `functions/` may
  therefore contain `packages/` beside `convex/`.
- Download manifest: `packaging/manifest/make-latest.sh` writes `latest.json`
  (`{version, releasedAt, channel, notesUrl, baseUrl, files:[{platform, arch, name, url, sha256, sizeBytes}],
  unraidPluginUrl, installScript, dockerImage}`), built by the Server packages workflow as an artifact; it is
  uploaded by hand to R2 (`folevi-updates`, `server/<version>/` and `server/latest.json`).
