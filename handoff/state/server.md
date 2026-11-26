# Folevi Server and Folevi Connect (`server/`, `services/connect`, `packaging/`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- The server edition, the supervisor (`server/folevid`), Connect and the NAS and Linux packaging are in `main`; every app has "Your own server" sign-in. A server only accepts apps at 1.6.0 or later (`minAppVersion`).
- Folevi Connect is live (`connect.folevi.com`, `<id>.folevi.app` names, relay); the owner's Synology DS223 test server registered and is reachable through it.
- Accounts survive a server's address change (PR 130, merged 2026-11-26).
- Server packages are NOT published: no downloads on `folevi.com/server` yet, no store submissions.

## Next steps

- Publishing the server packages (the Folevi Server session; each upload and each Fly.io deploy needs the owner's OK).
- The owner's open question from 2026-11-25: keep the DS223 reachable through Connect, or turn Connect off.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
