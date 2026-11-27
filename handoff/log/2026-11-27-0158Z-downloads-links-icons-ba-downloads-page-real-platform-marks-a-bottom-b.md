# Downloads page: real platform marks, a bottom bar to jump to a platform, server packages from the release manifest

- Date: 2026-11-27 01:58 UTC
- Area: web
- Branch: claude/downloads-links-icons-bar

Owner asks, 2026-11-27: real download links for every platform, real platform icons, and the platform chips turned into a bottom bar to jump between platforms.

- components/marketing/PlatformMark.tsx: the Apple, Linux (Tux) and Android marks from Simple Icons 13.21.0 (CC0), the Windows 11 four squares drawn by hand (Simple Icons dropped it), a globe for the web and a server for Folevi Server. Each section heading on /downloads shows its mark.
- components/marketing/DownloadsBar.tsx: replaces the chips in the header. It is sticky at the bottom of the scroll area (.mk-content), one button per platform with its mark, and marks the section in view (IntersectionObserver, aria-current="location"). Where the names don’t fit (phones, tablets) the row scrolls sideways and keeps the current one centred. Without script it is plain jump links. Styles: .mk-downloads-bar in marketing.css (the one lift shadow on the page, since the bar floats).
- Links: every Mac, Windows and Linux file returned 200 on 2026-11-27. The App Store link stays an App Store search (owner’s choice: the app is not public yet). Android stays "Coming soon": the owner chose a direct APK, so the PR manager session was asked to host a signed APK at folevi.com/download/android/Folevi.apk (404 today). Once it exists, the Android row gets that link.
- Folevi Server rows now come from the release manifest (fetchServerManifest, revalidate 600), one row per package with a button per kind of PC. No release is published yet (latest.json is not there), so the row says Coming soon and links to no package.
- test/downloads-page.test.tsx: marks and bar links for every platform, real file links, server rows with and without a manifest, Beta badges kept.

Checked: full vitest (272 files), tsc, eslint; in the browser at desktop and 375 px, light and dark (data-theme): jumping, the current platform marked and scrolled into view, no sideways page scroll.

Left: the Android APK link; the Linux note still says Linux doesn’t update itself, although the release state lists signed Linux update feeds (check with the Linux owner before changing it); the Beta badge is faint in dark mode on every page (components/marketing/Beta.tsx, unchanged here).
