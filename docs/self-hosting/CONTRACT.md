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
  setup-token  vapid-public  vapid-private  connect-token  tls/
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
| `GET /v1/backups` | `{backups:[{id, createdAt, sizeBytes, kind:"nightly"\|"manual"\|"pre-update"}], schedule:{enabled, hour, keep, target}}` |
| `POST /v1/backups` | start one now: `{id}` |
| `PUT /v1/backups/schedule` | `{enabled, hour, keep, target:{kind:"local"\|"folder"\|"s3", path?, s3?:{endpoint, bucket, prefix, accessKeyId, secretAccessKey, region}}}` |
| `POST /v1/backups/{id}/restore` | restore, restarting services: `{ok}` |
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
| `PATCH /v1/servers/{id}` | server | `{name?, version?, lanIps?, publicPort?}`; Connect points `<id>.folevi.net` at the public IP (or the relay) and `<a-b-c-d>.<id>.folevi.net` at each LAN IP |
| `POST /v1/servers/{id}/link-codes` | server | to `{code, approveUrl: "https://app.folevi.com/connect/approve?code=..."}`, 10 minutes |
| `GET /v1/servers/{id}` | server | `{linked: boolean, ownerAccount?, hostname, lanHostnames, reachable?}` |
| `PUT /v1/servers/{id}/acme/{label}` / `DELETE` | server | `{value}`; sets `_acme-challenge.<label>.<id>.folevi.net` (label `@` for the bare name) for the DNS-01 check |
| `POST /v1/servers/{id}/reachability` | server | `{port}` to `{reachable, publicIp}` |
| `POST /v1/mail` | server | `{to, subject, html, text, replyTo?, tag}` to `202 {id}`; From is `<server name> <no-reply@folevi.net>` |
| `POST /v1/push` | server | `{platform: "apns" \| "fcm", token, environment?: "production" \| "sandbox", title, body, data?, collapseId?, threadId?}` to `202` |
| `POST /v1/ai/chat/completions`, `POST /v1/ai/embeddings` | server | OpenAI-compatible request and response (streaming allowed); counts against the owner's plan |
| `GET /v1/unsplash/*` | server | proxied Unsplash API |
| `POST /v1/diagnostics` | server | `{text}` to `{reference}` |
| `POST /v1/link-codes/{code}/approve` | cloud | links to `X-Folevi-User` |
| `GET /v1/accounts/{userId}/servers` | cloud | see `connect:myServers` |
| `wss://relay.folevi.net/v1/tunnel` | server | bearer token; yamux over WebSocket; the relay accepts TLS on :443, reads the SNI, and pipes raw bytes for `<id>.folevi.net` and `*.<id>.folevi.net` into a new stream. It never terminates TLS |

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
