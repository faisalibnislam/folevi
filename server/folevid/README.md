# folevid

The Folevi Server supervisor (plan: `docs/SELF_HOSTING_PLAN.md` §2; binding interfaces:
`docs/self-hosting/CONTRACT.md`). One static Go program that a NAS package or service manager starts. It replaces
the Phase 0 scripts in `scripts/self-host/`.

```
folevid run --data <dir> --bundle <dir>   start everything; SIGTERM stops it cleanly
folevid version | setup-url | backup | restore <id> | healthcheck   (all take --data)
```

Exit codes: 0 clean, 1 error, 2 bad configuration. `--data` defaults to `FOLEVI_DATA`, `--bundle` to
`FOLEVI_BUNDLE` or the folder above `bin/folevid`. `backup`, `restore` and `healthcheck` talk to the running
instance through the control API; `healthcheck` exits 0 only when both services run and answer through the
public port. `setup-url --if-needed` (what package scripts use when they write the address to a log, because it
carries the setup code) prints it only while the running server has no owner: exit 3 once it has one, exit 1
while the server is not answering yet.

## What `run` does

1. Creates `data/{convex/storage,backups,logs,tmp}` and every missing secret in `data/secrets` (mode 700/600; the
   admin key through `convex-backend keygen`). Secrets are never logged: every log line, ours and the children's,
   goes through a redactor that knows all secret values plus bearer/admin-key/password patterns.
2. Listens on `:8460` (the one public port: `/convex/*` and its WebSocket to 3510, `/convex-site/*` to 3511, the
   rest to 3501) and `127.0.0.1:8461` (control API, bearer `server-secret`, constant-time compare, loopback Host
   only). `:8443` starts once a certificate exists; relay streams are served by the same HTTPS server.
3. Starts `convex-backend` (Phase 0 flags, short `TMPDIR`, our Node first on `PATH`, memory knobs) and waits for
   `/version`.
4. If the bundle version changed since the last start: a `pre-update` backup. Then the deploy step: sets the Convex
   environment over the backend's admin HTTP API (no secret in any process list), runs
   `node functions/node_modules/convex/bin/main.js deploy --yes --typecheck=disable --codegen=disable` with
   `CONVEX_SELF_HOSTED_URL`/`ADMIN_KEY` (never `--prod`), fetches the JWKS from the site port, sets `FOLEVI_JWKS`
   and deploys once more when it changed. Skipped when version, functions hash, origin and environment all match
   (and the backend reports the same `FOLEVI_SERVER_VERSION`).
5. Starts `node web/server.js` with the CONTRACT §4 environment.
6. Background: nightly backups, mDNS (`_folevi._tcp`, TXT `name`, `v`, `id`, `url`), and remote access (Connect,
   certificate, UPnP/NAT-PMP, relay), all off until turned on through `PUT /v1/remote`.

Children are restarted with backoff (1 s doubling to 60 s, reset after a minute of uptime) and stopped with
SIGTERM to their process group, SIGKILL after 15 s. Logs: `data/logs/{folevid,backend,web}.log`, 10 MB x 5.

## Settings

`data/config.json` (created on first start). Environment overrides, not written back: `FOLEVI_PORT`,
`FOLEVI_HTTPS_PORT`, `FOLEVI_CONTROL_PORT`, `FOLEVI_PUBLIC_URL`, `FOLEVI_CONNECT_URL`, `FOLEVI_RELAY_URL`,
`FOLEVI_ACME_DIRECTORY`, `FOLEVI_BIND`. Also `FOLEVI_TMPDIR` (when the data path is too long for the 80-character
socket limit), `FOLEVI_MANAGED_BY` (`store` or `apt`, shown by `GET /v1/update`), `FOLEVI_DEBUG=1`.

The public origin is, in order: `publicUrl` (or `FOLEVI_PUBLIC_URL`), `https://<customDomain>`,
`https://<id>.folevi.app` once Connect gave a certificate, else `http://<LAN IP>:<port>`. When it changes,
folevid restarts both services and redeploys.

Memory profile (`memoryProfile`: `auto`, `tiny`, `low`, `high`): `auto` picks `tiny` at 2.5 GB of RAM or less
(a 2 GB DS223: node actions 1, isolates idle 15 s, web heap 192 MB), `high` at 8 GB or more, else Phase 0's low
knobs. `GET /v1/status` adds `memory.profile` and `memory.low` so the admin panel can warn.

## Private glibc

If `bundle/runtime/lib/ld-linux-*` exists, programs whose ELF interpreter is not already inside the bundle run as
`ld-linux --library-path runtime/lib <program>`, and a `node` shim on `PATH` does the same for the backend's own
node child. Binaries patched with `patchelf` to use the bundle's loader (the QNAP package) run directly.

## Backups

`backups/<UTC timestamp>-<kind>.zip` (`kind`: nightly, manual, pre-update), holding `manifest.json`,
`convex-export.zip` (`convex export --include-file-storage`: every table and stored file) and `secrets.json`
(hash salt, auth and file-URL secrets, so a restore on a new machine keeps hashed lookups working). Keep N
(default 14); the newest pre-update backup is always kept. Targets: `local`, `folder` (absolute path), `s3`
(any S3-compatible service, via minio-go). Restore stops the web app, imports with `--replace-all`, redeploys.

Encryption: each backup is streamed through age (X25519) to `secrets/backup-key` and stored as
`<id>.zip.age`; plain `.zip` backups from before still restore (told apart by their first bytes). The owner saves
the key once (`GET /v1/backups/key`, shown by the admin panel). Restoring on a new machine:
`POST /v1/backups/{id}/restore` with `{"key": "..."}` or `folevid restore <id> --key-file <file>`; the key that
opened the backup then becomes the machine's backup key. A wrong or missing key answers 422.

## Connect

Registration with an Ed25519 key (`secrets/connect-key`), address updates, link codes (polled every 3 s until
approved), DNS-01 certificates for `<id>.folevi.app` and `*.<id>.folevi.app` through lego with a provider that
calls Connect's `/acme` endpoints (renewed 30 days before expiry), the reachability check (folevid answers
`/.well-known/folevi-connect/reach` with its signature), and the relay tunnel: a WebSocket to
`wss://relay.folevi.app/v1/tunnel` carrying yamux, folevid as the yamux server, each stream's PROXY v1 line
stripped and its client address kept for logs and lockouts.

## Tests

```
cd server/folevid && GOTOOLCHAIN=local go vet ./... && go test ./...
```

Unit tests cover proxy routing (WebSocket included), control API auth, secrets, backups and rotation,
redaction and rotation of logs, config, Connect's client, the PROXY header and the relay. `internal/app` runs
folevid end to end with a fake backend (`testdata/fakebackend`), a fake web server and a fake Convex CLI (needs
`node`). `internal/connect` also builds and drives the real `services/connect`. `main_test.go` cross-compiles
for linux/arm64 and amd64. `-short` skips the slow ones.

## Bundle

`server/bundle/build-bundle.sh --version V --arch x86_64|aarch64 --out DIR` writes
`DIR/folevi-server-V-linux-<arch>/` (CONTRACT §10). Inputs come from the environment (`CONVEX_BACKEND`,
`NODE_DIST`, `WEB_STANDALONE`, `WEB_STATIC`, `WEB_PUBLIC`, `FUNCTIONS_DIR`, `RUNTIME_LIB`); see the header of the
script. It downloads only inputs given as https URLs. `FUNCTIONS_DIR` comes from
`server/bundle/prepare-functions.sh --arch A --out DIR` (needs a `pnpm install`ed checkout): convex/, the few
`packages/` files it imports by path, and only the node_modules the Convex CLI reads, about 70 MB.
