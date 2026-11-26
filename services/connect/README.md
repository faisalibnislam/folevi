# Folevi Connect

The small service Folevi runs for every self-hosted Folevi Server (like plex.tv): the server registry and account
linking, DNS for `folevi.app`, the reachability check, Folevi Relay (TLS passthrough by server name), and the mail,
push, AI and Unsplash relays. The binding API is `docs/self-hosting/CONTRACT.md` §9; operations are in
[OPS.md](OPS.md).

Go 1.24, one binary, SQLite (pure Go, `modernc.org/sqlite`) behind `internal/store.Store` so Postgres can follow.

```
cmd/connect          main: config, wiring, listeners, graceful shutdown
internal/api         HTTP API (§9), auth, rate limits, admin calls
internal/store       Store interface + SQLite
internal/dns         Names and rules for folevi.app, Provider interface, Cloudflare, in-memory fake
internal/relay       WebSocket tunnel (yamux), :443 SNI router, bandwidth caps
internal/mail        Resend client, From header
internal/push        APNs (ES256 JWT, HTTP/2) and FCM HTTP v1 (service account)
internal/ai          OpenAI-compatible gateway to Gemini, monthly metering, limit hook
internal/limits      in-memory rate limiters
```

Run the tests: `go vet ./... && go test ./...` (no network: every provider is an `httptest` fake).
Run locally: `CONNECT_HTTP_ADDR=127.0.0.1:3900 go run ./cmd/connect` (in-memory DNS, no relays configured).

## API

Server calls: `Authorization: Bearer <token>` (the `fct_...` token from registration; Connect stores only its
SHA-256). Cloud calls: `Authorization: Bearer <CONNECT_SERVICE_KEY>` plus `X-Folevi-User`. Admin calls:
`Authorization: Bearer <CONNECT_ADMIN_KEY>`. Errors are `{"error": "<code>"}` (the AI endpoints use OpenAI's
error shape).

| Method and path | Notes beyond the contract |
| --- | --- |
| `POST /v1/servers` | `201 {serverId, token, hostname}`. Rate limited per IP. `<id>.folevi.app` starts out pointing at the relay |
| `GET /v1/servers/{id}` | also returns `serverId, name, version, publicIp, publicPort, tunnelConnected, online, lastSeenAt` |
| `PATCH /v1/servers/{id}` | `lanIps`: at most 8, RFC 1918 or IPv6 ULA only (others: `400 invalid_lan_ip`). IPv6 labels are the expanded address with dashes. Names of removed LAN IPs are deleted. A new `publicPort` clears `reachable` until the next check. `502 dns_unavailable` when the DNS host fails (state is saved; retry the PATCH) |
| `POST /v1/servers/{id}/link-codes` | `201 {code: "ABCD-EFGH", approveUrl, expiresAt}`; single use, 10 minutes, 6 per server per hour. Codes are stored hashed |
| `PUT/DELETE /v1/servers/{id}/acme/{label}` | label `@` (the bare name and its wildcard) or one of the server's `a-b-c-d` labels. Value must be base64url (16 to 128 characters). Up to 4 values per name. DELETE takes `{value}` or `?value=`; none removes all |
| `POST /v1/servers/{id}/reachability` | `{reachable, publicIp, certificateValid}`. Connect dials the caller's own public IP only (never a private one), with TLS and SNI `<id>.folevi.app`, and asks `GET /.well-known/folevi-connect/reach?nonce=<n>`; the server must answer `{"signature": base64(Ed25519 sign("folevi-connect-reach:<serverId>:<n>"))}` with the key it registered. Updates the `<id>` record: public IP when reachable, else the relay |
| `POST /v1/mail` | `to` is one address. Needs a linked server. `202 {id}`; `429 {error:"rate_limited", limit}`; `403 mail_disabled / not_linked`; `503 provider_busy` |
| `POST /v1/push` | `202 {status:"sent"}`; `410 {error:"token_gone", reason}` means forget the token; `503 provider_busy`; `502 provider_refused`. `data`: up to 16 string keys (APNs: top level next to `aps`, `category` goes into `aps`; FCM: data message) |
| `POST /v1/ai/chat/completions`, `/v1/ai/embeddings` | Needs a linked server. Unknown models become the default. Streaming is passed through event by event. `429 insufficient_quota / monthly_limit` |
| `GET /v1/unsplash/{path}` | only `search/photos`, `photos/random`, `photos/{id}`, `photos/{id}/download` |
| `POST /v1/diagnostics` | `201 {reference: "FD-XXXXXXXX"}`; size and daily limits; kept 30 days |
| `POST /v1/link-codes/{code}/approve` | `200 {serverId, name, hostname}`; `404 invalid_code` (unknown, used or expired) |
| `GET /v1/accounts/{userId}/servers` | a JSON array; `X-Folevi-User` must equal `userId`; suspended servers are left out |
| `GET /v1/tunnel` (WebSocket) | see "Relay protocol" |
| `GET /v1/admin/servers/{id}` | flags and this period's usage |
| `PUT /v1/admin/servers/{id}/flags` | `{Suspended?, MailDisabled?, PushDisabled?, AIDisabled?, RelayDisabled?}`; suspending or disabling the relay drops the tunnel |
| `GET /v1/admin/servers/{id}/mail-log` | metadata only: recipient hash and domain, tag, status |
| `GET /v1/admin/diagnostics/{ref}` | the uploaded text |
| `GET /healthz` | `{ok: true}` |

### Relay protocol (what folevid implements)

1. Open `wss://relay.folevi.app/v1/tunnel` with `Authorization: Bearer <token>`; binary messages carry a yamux
   session. folevid is the yamux **server** (it accepts streams); the relay opens them. A new tunnel for the same
   server replaces the old one. Reconnect with backoff when it closes.
2. Each stream is one client connection: a PROXY protocol v1 line (`PROXY TCP4 <client ip> <relay ip> <client
   port> 443\r\n`) and then the client's raw TLS bytes, starting with its ClientHello. Strip the line, use the
   client address for logs and lockouts, and hand the rest to the HTTPS listener (certificate for
   `<id>.folevi.app` and `*.<id>.folevi.app`).
3. The relay never terminates TLS for server names, so it cannot read the traffic (the tests prove the bytes
   it carries never contain the plaintext).

## Environment

Secrets marked (secret) can also be given as a file path in `<NAME>_FILE`. None is ever logged.

| Variable | Default | What |
| --- | --- | --- |
| `CONNECT_HTTP_ADDR` | `:8080` | Plain HTTP API (also serves `/v1/tunnel`). Keep it private behind a proxy, or use the relay port |
| `CONNECT_RELAY_ADDR` | empty (off) | The SNI router listener (public :443). Connect's own names on it get TLS locally |
| `CONNECT_RELAY_PROXY_PROTOCOL` | `false` | The relay listener sits behind a load balancer that sends PROXY v1 (Fly `proxy_proto`) |
| `CONNECT_LOCAL_HOSTNAMES` | `connect.folevi.com,relay.folevi.app` | Names the relay port serves itself (the API) instead of routing |
| `CONNECT_TLS_CERT_FILE`, `CONNECT_TLS_KEY_FILE` | empty | Certificate for the local names. Without them, `CONNECT_ACME_EMAIL` turns on Let's Encrypt |
| `CONNECT_ACME_EMAIL` | empty | Let's Encrypt account email (TLS-ALPN-01 on the relay port) |
| `CONNECT_ACME_CACHE_DIR` | `./acme` | Where certificates are kept (put it on the volume) |
| `CONNECT_DB` | `./connect.db` | SQLite file |
| `CONNECT_ZONE` | `folevi.app` | The servers' zone |
| `CONNECT_APP_URL` | `https://app.folevi.com` | Base of `approveUrl` |
| `CONNECT_SERVICE_KEY` | empty | (secret) Folevi Cloud's key for the cloud calls; empty refuses them |
| `CONNECT_ADMIN_KEY` | empty | (secret) Folevi operations key for `/v1/admin`; empty refuses them |
| `CONNECT_TRUSTED_PROXY_HEADER` | empty | Header holding the client IP when the HTTP port is behind a proxy (`Fly-Client-IP`). Leave empty otherwise, or callers can spoof it |
| `CONNECT_RELAY_IPV4`, `CONNECT_RELAY_IPV6` | empty | The relay's public addresses; `<id>.folevi.app` points here when the server is not directly reachable |
| `CONNECT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `CONNECT_DNS_PROVIDER` | `memory` | `cloudflare` in production; `memory` publishes nothing |
| `CLOUDFLARE_API_TOKEN` | empty | (secret) Token with Zone.DNS:Edit on the `folevi.app` zone only |
| `CLOUDFLARE_ZONE_ID` | empty | The `folevi.app` zone id |
| `CONNECT_DNS_TTL` | `60` | TTL of address records |
| `CONNECT_REACH_TIMEOUT` | `8s` | Dial and request timeout of the reachability check |
| `CONNECT_REACH_ALLOW_PRIVATE` | `false` | Tests only: allow dialing a private caller address |
| `CONNECT_RELAY_BYTES_PER_SECOND` | `1048576` | Per server, both directions; `0` unlimited |
| `CONNECT_RELAY_MONTHLY_BYTES` | `5368709120` | Per server per month (free cap); `0` unlimited |
| `CONNECT_RELAY_MAX_STREAMS` | `64` | Concurrent client connections per server |
| `CONNECT_RELAY_MAX_CONNS` | `20000` | Concurrent client connections in all |
| `CONNECT_RELAY_IDLE_TIMEOUT` | `5m` | Close a relayed connection idle this long |
| `CONNECT_REGISTER_PER_IP_HOURLY` | `10` | Registrations per hour per IPv4 address or IPv6 /64 |
| `CONNECT_REGISTER_GLOBAL_HOURLY` | `120` | Registrations per hour from all callers together; `0` unlimited |
| `CONNECT_LINK_CODES_PER_HOUR` | `6` | Link codes per server per hour |
| `CONNECT_APPROVE_PER_USER_HOURLY` | `20` | Approve attempts per account per hour |
| `CONNECT_MAX_SERVERS_PER_OWNER` | `10` | Servers one account may own (suspended ones are not counted); approve answers `409 too_many_servers` past it; `0` unlimited |
| `RESEND_API_KEY` | empty | (secret) Resend key; empty makes `/v1/mail` answer 503 |
| `CONNECT_RESEND_BASE_URL` | `https://api.resend.com` | |
| `CONNECT_MAIL_FROM_ADDRESS` | `no-reply@folevi.app` | From address. The name is always `Folevi Server (<server name>)` |
| `CONNECT_MAIL_DISABLED` | `false` | Global mail kill switch |
| `CONNECT_MAIL_REQUIRE_LINKED` | `true` | Only servers linked to a Folevi account may send |
| `CONNECT_MAIL_PER_SERVER_HOURLY` | `30` | Per owner account: all of its servers together (per server when not linked) |
| `CONNECT_MAIL_PER_SERVER_DAILY` | `200` | Persisted. Per owner account, as above |
| `CONNECT_MAIL_PER_RECIPIENT_HOURLY` | `5` | Per address, across all servers |
| `CONNECT_MAIL_PER_RECIPIENT_DAILY` | `20` | Per address, across all servers |
| `CONNECT_MAIL_GLOBAL_DAILY` | `10000` | All servers together; persisted |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | empty | Apple key id and team |
| `APNS_KEY` | empty | (secret) The .p8 contents (PEM, `\n`-escaped PEM, or bare base64) |
| `APNS_BUNDLE_ID` | `com.folevi.ios` | `apns-topic` |
| `FCM_SERVICE_ACCOUNT` | empty | (secret) Firebase service account JSON |
| `FCM_PROJECT_ID` | from the JSON | |
| `CONNECT_PUSH_PER_SERVER_HOURLY` | `1000` | |
| `GEMINI_API_KEY` | empty | (secret) Folevi's Gemini key; empty makes AI answer 503 |
| `CONNECT_AI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` | |
| `CONNECT_AI_CHAT_MODEL` | `gemini-3.8-flash` | Default chat model |
| `CONNECT_AI_EMBEDDING_MODEL` | `gemini-embedding-001` | Default embedding model |
| `CONNECT_AI_ALLOWED_MODELS` | `gemini-3.8-flash,gemini-flash-lite-latest,gemini-embedding-001` | Models a server may name |
| `CONNECT_AI_MONTHLY_TOKENS` | `2000000` | Per owner account per month, all of its servers together (per server when not linked), until plans come from the cloud; negative = no limit. A stream that ends without a usage chunk is charged an estimate |
| `CONNECT_AI_PER_SERVER_MINUTE` | `60` | Requests per minute per owner account (per server when not linked) |
| `CONNECT_AI_REQUIRE_LINKED` | `true` | |
| `CONNECT_AI_MAX_REQUEST_BYTES` | `4194304` | |
| `UNSPLASH_ACCESS_KEY` | empty | (secret) Unsplash access key; empty makes the proxy answer 503 |
| `CONNECT_UNSPLASH_BASE_URL` | `https://api.unsplash.com` | |
| `CONNECT_UNSPLASH_PER_SERVER_HOURLY` | `100` | |
| `CONNECT_DIAG_MAX_BYTES` | `2097152` | Largest diagnostics upload |
| `CONNECT_DIAG_RETENTION` | `720h` | How long uploads are kept |
| `CONNECT_DIAG_PER_SERVER_DAILY` | `10` | |

Exit codes: 0 clean shutdown (SIGTERM or SIGINT, 20 seconds to drain), 1 runtime error, 2 bad configuration.
