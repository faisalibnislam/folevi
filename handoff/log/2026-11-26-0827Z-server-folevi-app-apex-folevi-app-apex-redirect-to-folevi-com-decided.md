# folevi.app apex redirect to folevi.com decided

- Date: 2026-11-26 08:27 UTC
- Area: server
- Branch: claude/server-folevi-app-apex

**Found:** https://folevi.app answered 522 and https://www.folevi.app 525. Both are the Namecheap parking/URL-redirect
records imported when folevi.app moved to Cloudflare (2026-11-25), proxied by Cloudflare. Those origins answer only on
port 80, so Cloudflare's HTTPS connection to them times out or fails; http://folevi.app still gave 302 to www. The
domain is HSTS-preloaded, so browsers only use https: broken since the move, not a new outage. Nothing in the rollout
serves the apex.

**Checked (read only, dig and curl):** connect.folevi.com/healthz 200, relay.folevi.app answers, 6ge2xhr4kl.folevi.app
307, all on Fly 137.66.16.104. Connect is unaffected.

**Decided (owner, 2026-11-26):** redirect folevi.app and www.folevi.app to https://folevi.com, 301, path and query kept:
replace the parking A/CNAME for `@` and `www` with proxied placeholder `192.0.2.1` records and add one Cloudflare
redirect rule. The owner makes the change in the dashboard; no session edits Cloudflare. Leave relay, the Connect
`*.folevi.app` names and the Resend records alone.

**Left:** after the owner's change, check both names answer 301 to folevi.com. Also corrected `state/server.md`: the
DS223 question is settled (keep Connect on), and the 1.6.78 package is built but its install is on hold.
