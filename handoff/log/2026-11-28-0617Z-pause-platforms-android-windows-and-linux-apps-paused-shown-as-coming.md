# Android, Windows and Linux apps paused; shown as Coming soon everywhere

- Date: 2026-11-28 06:17 UTC
- Area: repo
- Branch: claude/pause-platforms

The owner, 2026-11-28: "We are pausing: Android, Windows and Linux app. Only Mac, iOS (iPhone, iPad, iPhone Duo), Self-Hosted will remain. Rest will say coming soon." Then: "Self-Hosted version will say (Early Beta)".

What changed:
- Website: no download buttons, file links or store links for Android, Windows or Linux. The home page, /apps, /downloads, /server, pricing, features, compare, support, security, the footer, site metadata and the share image name Mac, iPhone and iPad (and the web app), with "Android, Windows and Linux are coming soon." (`COMING_SOON_NOTE` in `components/marketing/site.ts`, re-exporting `COMING_SOON_APPS_NOTE` from `lib/platforms.ts`). /downloads lists the paused three last with a Coming soon chip. /windows and /linux stay up as noindex Coming soon pages (`components/marketing/ComingSoonPlatform.tsx`) and are out of the sitemap. The home FAQ answers "Not yet" for Windows, Linux and Android. Changelog and blog history are untouched.
- In the web app and Folevi Server: Connect your apps, the setup flow, the joined welcome, the admin overview and checklist, and the push relay setting name Mac, iPhone and iPad; Connect your apps shows the coming soon line. NAS package descriptions (Unraid, ASUSTOR, TrueNAS, CasaOS, Runtipi, Umbrel) drop Android.
- Folevi Server is "Early Beta": `BETA_LABEL` and `BETA_NOTE` in `lib/beta.ts`, the in-app and site badges, site text and metadata, and the server package descriptions.
- Native Mac and iPhone apps needed no change: nothing in them offers the paused apps. There are no store listing files in the repo.
- Rules: CLAUDE.md (platform list; desktop feature parity on hold), `docs/claude-context/memory/platforms-paused-2026-11-28.md`, the parity memory and `docs/DESKTOP_PARITY.md` marked on hold, short paused notes at the top of README and the Android, desktop and Linux docs, and PAUSED lines in `handoff/state/android.md`, `windows.md`, `linux.md` and `release.md`.
- Not changed on purpose: code that runs inside the paused apps (platform detection, the Linux app's own Beta copy, Google Play update text inside the Android app), device names, the Linux app's Snap and AppStream listings, and every Android, Windows and Linux build and release script.

Checked: `tsc --noEmit` and eslint for apps/web pass; the full web vitest suite passes (287 files, 2467 tests). New or rewritten tests: `test/paused-apps-copy.test.ts`, `test/platform-copy.test.ts`, `test/windows-linux-pages.test.tsx`, `test/downloads-page.test.tsx`, `test/beta-badges.test.tsx`; e2e `home-editor.spec.ts` heading updated (e2e runs in CI). Not looked at in a browser.

Left:
- Already published builds stay up: folevi.com download files, the Snap Store listing, Play internal testing, the apt and rpm repositories and the update feeds. Withdrawing any of them is the owner's call.
- PR 191 (Linux GTK message dialogs) is merged but unreleased; it ships with the first Linux release after the pause.
