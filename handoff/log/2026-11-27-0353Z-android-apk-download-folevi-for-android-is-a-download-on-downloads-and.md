# Folevi for Android is a download on /downloads and /apps

- Date: 2026-11-27 03:53 UTC
- Area: web
- Branch: claude/android-apk-download

The PR manager hosted Folevi 1.8.79 for Android (Play-signed universal APK, owner's choice 2026-11-27) at https://folevi.com/download/android/Folevi.apk, with a versioned copy at Folevi-1.8.79.apk. Both returned 200, application/vnd.android.package-archive, 130,160,563 bytes when checked from here.

- site.ts: ANDROID_DOWNLOAD_URL (the stable name), ANDROID_REQUIREMENT ("Android 13 or later"), ANDROID_INSTALL_NOTE (allow installs from the browser the first time; no self-update yet).
- /downloads: the Android row is a Download (.apk, about 124 MB) with that note, no longer "Coming soon".
- /apps: the Android card has "Download for Android" and says it is on its way to Google Play.
- Changelog 1.8.79: an Android group (download from folevi.com).
- test/downloads-page.test.tsx checks the Android link and note.

Checked: vitest (downloads, changelog, beta badges, scale tests), tsc, eslint; in the browser: /downloads#android and /apps#android link to the APK.

Left: other pages still say the Android app is "coming soon" where PRs 165 and 170 changed that line; once they merge, a follow-up should point those at the download. The 1.8.80 changelog entry waits for the PR manager to say 1.8.80 is out. No build number shown anywhere.
