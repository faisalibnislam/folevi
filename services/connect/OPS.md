# Folevi Connect: operations

Nothing here has been deployed. Every step below needs the owner's OK first.

## Before the first deploy

1. **Domain.** `folevi.app` on Cloudflare (it is HSTS-preloaded, so everything under it is HTTPS only). Create an
   API token scoped to Zone.DNS:Edit on that zone only; note the zone id. Ask to add `folevi.app` to the Public
   Suffix List so one server's site cannot set cookies for another.
2. **Hosting.** A Fly.io app (`fly.toml`) with a 1 GB volume `connect_data` and a **dedicated IPv4** plus IPv6
   (`fly ips allocate-v4`, `fly ips allocate-v6`): raw TCP on 443 needs a dedicated address. Put both addresses in
   `CONNECT_RELAY_IPV4` / `CONNECT_RELAY_IPV6`.
3. **DNS for Connect itself.** `connect.folevi.com` (A/AAAA at Namecheap, folevi.com's DNS) and
   `relay.folevi.app` (A/AAAA on Cloudflare, not proxied) to the dedicated addresses. Connect gets their
   certificates itself through Let's Encrypt (set `CONNECT_ACME_EMAIL`).
4. **Secrets** (`fly secrets set`, never in fly.toml): `CONNECT_SERVICE_KEY` (also set in Folevi Cloud's Convex
   env), `CONNECT_ADMIN_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `RESEND_API_KEY` (a new key named for
   Connect), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `FCM_SERVICE_ACCOUNT`, `GEMINI_API_KEY`,
   `UNSPLASH_ACCESS_KEY`.
5. **Resend.** Add and verify the sending domain `folevi.app` (SPF, DKIM, DMARC on Cloudflare). Fix the 2026-10-15
   "send records pending" problem first (see `docs/claude-context/memory/email-provider-resend.md`).
6. **Apple and Google.** The APNs .p8 key and the Firebase service account are the same ones the cloud uses; the
   bundle id is `com.folevi.ios`.

## Running it

- Health: `GET /healthz` on the internal port 8080 (Fly checks it).
- Logs are JSON lines on stdout: route pattern, status, duration and server id. Never tokens, keys, link codes,
  recipients, subjects, bodies, prompts or push text.
- Usage counters live in the `usage` table: `ai_tokens` and `relay_bytes` per month, `mail` and `diagnostics` per
  day.

## Abuse

- Look at a server: `GET /v1/admin/servers/{id}` with the admin key; its mail log at `.../mail-log`.
- Switch something off: `PUT /v1/admin/servers/{id}/flags` with `{"MailDisabled": true}` (or `PushDisabled`,
  `AIDisabled`, `RelayDisabled`, `Suspended`). Suspension stops every call and drops the tunnel.
- Global mail stop: set `CONNECT_MAIL_DISABLED=true` and restart.
- Limits are environment variables (README); lower them and restart.

## Backups

The SQLite file on the volume is the only state (servers, token hashes, owners, usage). Fly takes daily volume
snapshots; for more, copy `/data/connect.db` with `sqlite3 .backup`. Losing it unlinks every server (they would
need to register again), so keep the snapshots.

## Scaling

One machine handles many thousands of tunnels. Two limits before scaling out: tunnels are kept in memory (a
second machine would not know them, so the SNI router must find the machine that holds the tunnel), and SQLite is
single-node. The `Store` interface is ready for a Postgres version; tunnel routing across machines needs a shared
map (for example Fly's `fly-replay` or a small Redis).
