# Release: what is live, versions and builds

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Version **1.8.78**, a Big update released 2026-11-26 from PR 150's merge (`73d949ec`, tree of main `ba843571` plus the version files). `version.json`'s build is 108 and every platform below shipped 108.
- Web and Convex: 1.8.78's code and functions live since `ba843571` deployed (08:12 UTC). The release commit's own deploy was skipped (`scripts/vercel-ignore.sh` didn't watch `version.json`), so the version label shows 1.8.78 only from PR 152's deploy, which adds that rule.
- Mac: 1.8.78 (108) published with `apps/mac/scripts/publish.mjs`: notarized and stapled ("Notarized Developer ID"), `mac/Folevi.dmg`, Sparkle feed's first item 1.8.78 (108), deltas from the kept ZIPs; `Folevi-1.8.78.zip` added to `apps/mac/release-archive/`. Not opened on a Mac after publishing.
- iPhone and iPad: the native app (`apps/ios`) as 1.8.78 (108) on TestFlight, internal "Folevi team", delivery `0d3e9747-6fce-4809-b30d-26c27c0f2025` (`apps/ios` `node scripts/release.mjs --no-upload`, then `xcrun altool --upload-app`). The Capacitor app was not uploaded this time (owner, 2026-11-26). Not opened on a device by a session.
- Windows and Linux (installers, update feeds, apt and rpm, Snap Store): released from `73d949ec` by the Linux desktop session; see its log entry for what went where.
- Android: the signed 1.8.78 bundle (version code 108, upload key "Folevi upload") is at `~/Downloads/Folevi 1.8.78 Android/Folevi-1.8.78-108.aab` for the owner's drag into Play Console's internal testing. Not on Play yet as far as any session knows.
- Tags `v1.6.78`, `v1.7.78` and `v1.8.78`: not pushed.
- How to release: `handoff/guide.md` section 6. One version for every platform, cut with `scripts/version.mjs`; a Big update keeps the patch number (1.6.78, 1.7.78, 1.8.78). Mac deltas need the earlier ZIPs in `apps/mac/release-archive/` (kept in the main checkout).

## Next steps

- The owner drags the Android bundle into Play Console's internal testing.
- Next free version: 1.8.79 (Small update) or 1.9.78 (Big update): run `node scripts/version.mjs prepare`, which prints both. The next iOS upload needs a build above 108.
- Hardware checks nobody has done: spell check and Tab prediction in the Mac app, the native iPhone app and on Windows; Float this note on a Mac, a Windows PC and in Chrome; the native iPhone app's "..." menus (All notes: View as, Sort by) on a device; the first automatic update from 1.7.78 on Windows and Linux.
- CI builds no Swift or Kotlin: before merging anything that touches `apps/mac`, `apps/ios`, `apps/mobile` or `apps/native-kit`, build the Mac app and the iOS app (`node apps/mac/scripts/build.mjs`, `apps/ios` `node scripts/simulator.mjs build`).

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
