# Folevi Server and Folevi Connect (`server/`, `services/connect`, `packaging/`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- The server edition, the supervisor (`server/folevid`), Connect and the NAS and Linux packaging are in `main`; every app has "Your own server" sign-in. A server only accepts apps at 1.6.0 or later (`minAppVersion`).
- Folevi Connect is live (`connect.folevi.com`, `<id>.folevi.app` names, relay); the owner's Synology DS223 test server registered and is reachable through it.
- Accounts survive a server's address change (PR 130, merged 2026-11-26).
- The DS223 runs Folevi Server 1.5.73-0003 on Connect as `6ge2xhr4kl.folevi.app` (owner, 2026-11-25: keep Connect and the relay on). A 1.6.78-0001 package with the PR 130 fix is built (`~/FoleviServerTest/folevi-server-1.6.78-0001-dsm7-armv8.spk`); installing it is on hold until the owner says so.
- `folevi.app` and `www.folevi.app` answered 522/525 (Namecheap parking records imported into Cloudflare, proxied, no HTTPS at the origin). Owner, 2026-11-26: redirect both to https://folevi.com (301, path and query kept) with a Cloudflare redirect rule on proxied placeholder records; the owner makes the change in the dashboard. Leave `relay.folevi.app`, the Connect `*.folevi.app` names and the Resend records as they are.
- Server packages are NOT published: no downloads on `folevi.com/server` yet, no store submissions.

## Next steps

- Publishing the server packages (the Folevi Server session; each upload and each Fly.io deploy needs the owner's OK).
- Check that https://folevi.app and https://www.folevi.app answer 301 to folevi.com once the owner has changed Cloudflare.
- Install 1.6.78 on the DS223 when the owner says so, then check sign-in there (no "Finish setting up").

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
