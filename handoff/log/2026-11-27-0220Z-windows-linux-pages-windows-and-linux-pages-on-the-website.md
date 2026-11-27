# Windows and Linux pages on the website

- Date: 2026-11-27 02:20 UTC
- Area: web
- Branch: claude/windows-linux-pages

What changed:
- New marketing pages `/windows` and `/linux` (`apps/web/src/app/(marketing)/windows/page.tsx`, `linux/page.tsx`),
  modeled on `/mac` with the same components. Windows: both installers (`WindowsDownload`), the SmartScreen note
  (new `WINDOWS_SMARTSCREEN_NOTE` in `site.ts`; drop it once the installers are signed), not in the Microsoft Store.
  Linux: Beta badge and note (`components/marketing/Beta.tsx`), every package and the checksums (`LinuxDownload`),
  updates (AppImage itself, .deb/.rpm through the signed repositories, Snap Store), not on Flathub, Wayland Quick Add
  note, and what it lacks (Share, text in images, call sound).
- `MARKETING_ROUTES` (sitemap) has both; the footer's Product column links them; `proxy.ts` treats both as
  marketing-only paths, like `/mac`.
- `LibraryPlaces` takes `kinds` and `details`, so Windows and Linux show only "Choose a folder" and "This device
  only" (Dropbox and Google Drive aren't offered there yet). Default output unchanged.

Checked: `apps/web/test/windows-linux-pages.test.tsx` (downloads, Beta only on Linux, SmartScreen note, no build
numbers or dashes, sitemap); full `npx vitest run`, `npx tsc --noEmit -p .` and eslint on the changed files pass.
Looked at both pages in a dev server on port 3045 at desktop width.

Left: not checked at phone width or in dark mode. The KeysPiece "Ctrl Alt Space" sticker is wider than the Mac's and
sits near the hero card's top right at xl widths. Update both pages when Windows is signed, the Microsoft Store or
Flathub listings exist, or Linux gains Share or text in images (docs/DESKTOP_PARITY.md).
