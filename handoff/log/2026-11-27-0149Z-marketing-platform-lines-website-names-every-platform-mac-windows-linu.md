# Website names every platform: Mac, Windows, Linux, iPhone, iPad and web; Android coming soon

- Date: 2026-11-27 01:49 UTC
- Area: web
- Branch: claude/marketing-platform-lines

The website said there was no Windows, Linux or Android app, and the home page title, site description, share image and footer named only the Mac, iPhone, iPad and web. Now:

- Title, site description (app/layout.tsx), share image (opengraph-image.tsx), footer, structured data (seo.tsx) and the compare chart name Mac, Windows, Linux, iPhone, iPad and web.
- "Free with no account" lines name Mac, Windows, Linux, iPhone and iPad: the desktop app has the same local library (docs/DESKTOP_APP.md). Lines that are Apple-only stay Apple-only: "native" app claims (Windows and Linux are Tauri web views), iCloud sync, Foli AI on Apple Intelligence, passkeys.
- Home FAQ, support, docs ("The apps and notes on your devices" now has Windows and Linux rows) and both comparisons: Windows and Linux are downloads (Linux in beta); Android is coming soon to Google Play.
- Home apps section: "native" dropped from its lede, and a "Windows and Linux" button to /downloads.
- test/platform-copy.test.ts fails on the old "no Windows/Android app" lines and checks the title, description, share image and footer name every platform.

Checked: vitest (new test, beta badges, type scale), tsc, eslint; in the browser at 375 px and desktop: title, apps section, share image, docs table; no sideways scroll.

Left: /downloads itself (real links, platform icons, a bottom bar to jump to a platform) is the next pull request. Its Linux note says Linux doesn’t update itself, which the release state says is no longer true.
