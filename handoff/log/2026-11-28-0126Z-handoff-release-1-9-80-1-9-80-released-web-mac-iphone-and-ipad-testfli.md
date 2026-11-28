# 1.9.80 released: web, Mac, iPhone and iPad (TestFlight), Android (Play internal testing and the download)

- Date: 2026-11-28 01:26 UTC
- Area: release, mac, ios, android, web
- Branch: claude/handoff-release-1.9.80

The owner typed "release all" in the PR manager session on 2026-11-28. No kind was named, so the version rule chose: Big, because the new pricing and Foli AI on your own key are significant new features (1.8.80 to 1.9.80, build 111). Version PR 186 merged as 7b16a128; its tree is identical to the release branch commit 11b41db4 that the iPhone and Android builds were made from.

Web and Convex: the production deployment of 7b16a128 succeeded (status only).

Mac: swift test --filter FoleviMacTests passed (266 tests) and the release.mjs dry run passed, on the release branch; publish.mjs from 7b16a128 notarized and stapled the app and the DMG and uploaded them; hosted mac/Folevi.dmg and mac/Folevi-1.9.80.zip match the local builds by SHA-256; stapler validate and spctl say Notarized Developer ID, Abu Mohammad Faisal (7K32QQ2FX8); the app is 1.9.80 (111), x86_64 and arm64; the feed's first item is 1.9.80 with deltas from 110, 109 and 108. Not run: the app-hosted FoleviTests. Not opened after publishing; no Sparkle update watched.

iPhone and iPad: node scripts/release.mjs --no-upload built and exported the archive (1.9.80, 111, com.folevi.ios); xcrun altool --upload-app reported UPLOAD SUCCEEDED with no errors, delivery 7de8b52e-3587-4878-ba3f-a9524db69688. Not checked: processing at Apple, the build on a device.

Android: bundle built in the release worktree (the temporary checkout used on 2026-11-27 had been cleared with /private/tmp), unit tests passed, upload-key build opened on the emulator; the owner dragged Folevi-1.9.80-111.aab into a new internal testing release and the PR manager published it (Play's only warning: no native debug symbols; Automatic protection: None); the owner allowed the download of the signed universal APK in the built-in browser; it is 1.9.80 (111), signed CN=Android, O=Google Inc. with the same certificate as 1.8.79 (SHA-256 69f5227e...75c262), no com.pairip; on a windowless API 37 emulator the hosted 1.8.79 APK was updated in place to it (adb install -r: Success) and it opened to the first screen with no crash. Hosted as android/Folevi.apk and android/Folevi-1.9.80.apk; both return 200 with 130,160,755 bytes and match by SHA-256 (b567f9c463e982182f8c37db7cfa0b383835f8ac154efac1303bc40aee0c9af1). Not checked: a real phone, sign-in, push.

Downloads: before any 1.9.80 file went into the bucket, PR 187 (Linux session) was merged and deployed: Vercel's CDN had cached a 100-byte ranged response for a Linux AppImage and served it to everyone. Checked after the deploy and again on the new Mac and Android files: two ranged requests return 206 with x-vercel-cache MISS, and a plain request returns the full length.

Windows and Linux: built from 7b16a128 and published by the Linux session, which has the owner's OK in its own session; its report and state lines are in its own pull request. At the time of writing the arm64 snap was on stable and the amd64 snap was waiting on a Launchpad outage.

Left: Admin > Billing setup against Polar (needs an admin sign-in); the changelog page has no 1.9.80 entry yet (Landing Page session); on Linux the update offer needs zenity on KDE and minimal installs (Linux session, after this release); tags are local only.
