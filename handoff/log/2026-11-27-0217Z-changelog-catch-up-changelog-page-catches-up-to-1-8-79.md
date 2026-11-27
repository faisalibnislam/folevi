# Changelog page catches up to 1.8.79

- Date: 2026-11-27 02:17 UTC
- Area: web
- Branch: claude/changelog-catch-up

What changed: the public /changelog page (`apps/web/src/components/marketing/content/changelog.ts`) had stopped at
1.5.52. It now has every release from 1.5.53 to 1.8.79 (30 entries), newest first, condensed from `CHANGELOG.md`
into the site's voice, with no build numbers. The owner approved it on 2026-11-27 ("Yes, all releases").
`LATEST_RELEASE_DATE`, so the sitemap's lastModified for /changelog, is now 2026-11-26. Entries up to 1.5.52 are
unchanged.

Truth rules kept: 1.8.79 says it is for the web and the Mac only, and its Writing settings are named for the Mac only
(the iPhone and iPad builds are not out). No entry says the App Store or Google Play. Folevi for Linux and Folevi
Server are marked Beta where they appear. Server releases are written as signing in to your own server, never as a
download. The Windows test build is described as unsigned. Left out as unsure or internal: "Folevi Server keeps
accounts when its address changes" (1.8.78, the server is not published), the website product-page note in 1.5.53,
and the backend security detail (kept as "Security fixes across the apps").

Checked: new `apps/web/test/changelog-page.test.ts` (newest is 1.8.79, versions MAJOR.MINOR.PATCH apart from the
early 0.x previews, unique and newest first, dates never go forward, labels match dates, no build numbers or em
dashes). From `apps/web`: `npx vitest run` (the new test passes; `editor-ios-return.test.ts` failed once in the full
parallel run and passed alone, unrelated to this change), `npx tsc --noEmit -p .` clean, `npx eslint` clean on the
changed files.

Left: the page wasn't viewed in a browser. When a release ships, add its entry at the top of `RELEASES`.
