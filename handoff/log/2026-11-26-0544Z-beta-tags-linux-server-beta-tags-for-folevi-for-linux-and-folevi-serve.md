# Beta tags for Folevi for Linux and Folevi Server

- Date: 2026-11-26 05:44 UTC
- Area: web
- Branch: claude/beta-tags-linux-server

PR 147. Owner decision 2026-11-26: every platform launches; only Folevi for Linux and Folevi Server carry Beta. One note and feedback link in apps/web/src/lib/beta.ts (BETA_NOTE "Beta: works, but expect rough edges.", link folevi.com/support), drawn by components/ui/Beta.tsx (in the product) and components/marketing/Beta.tsx (website). Shown on /downloads (Linux and a new Folevi Server section), /apps (Linux card, server card), /server (hero, every download row, container image), the Linux app's window title (MAIN_TITLE in apps/desktop/src-tauri/src/lib.rs, Linux only) and Settings > About (isLinuxApp(), not Windows), Folevi Server's /setup and admin sidebar. Not on the 'Your own server' sign-in option. Snap, AppStream, deb/rpm, Docker label and NAS/catalog descriptions say Beta. The Snap Store listing text is not pushed: paste it at dashboard.snapcraft.io (folevi, Listing) or let the next revision carry it. Not rendered: the server admin panel (needs a signed-in server backend), typecheck only. To drop Beta later: beta.ts, MAIN_TITLE and the packaging text.
