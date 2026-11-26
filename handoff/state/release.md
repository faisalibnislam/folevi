# Release: what is live, versions and builds

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Version **1.7.78**, a Big update released 2026-11-26 from PR 131's merge (`b11f3256`). `version.json`'s build is 107: every platform shipped build 103, and the native iPhone and iPad app was uploaded as 107 (builds 104 to 106 are used on TestFlight as 1.6.79, a TestFlight-only release that is not in `CHANGELOG.json`).
- Web and Convex: deployed by each merge to `main` (Vercel builds it and runs `convex deploy`).
- Mac: 1.7.78 published with `apps/mac/scripts/publish.mjs` (notarized, stapled, Sparkle feed, `mac/Folevi.dmg`). Not opened on a Mac after publishing.
- iPhone and iPad: two builds on TestFlight (internal "Folevi team"): the Capacitor app (`apps/mobile`) as 1.7.78 (103), delivery `1ce1048f-6e01-45b8-9da3-a4980ac34711`, and the native app (`apps/ios`, PR 129) as 1.7.78 (107). Neither was opened on a device by a session.
- Windows (1.8.78, build 108, from `73d949ec`): `windows/Folevi_1.8.78_x64-setup.exe` and `_arm64-setup.exe` (Desktop workflow run 45788907176) plus the stable names; unsigned; update feeds `desktop/windows-*/latest.json` say 1.8.78, signed. Hosted files match the builds byte for byte. Not installed on Windows.
- Linux (1.8.78, build 108, from `73d949ec`): six packages and `SHA256SUMS`, apt and rpm repositories (live `InRelease` verifies), update feeds `desktop/linux-*/latest.json` say 1.8.78, signed; Snap Store revisions 9 (arm64) and 10 (amd64) on stable, listing says Beta. Both AppImages passed `smoke-test.sh` in the VM; hosted files match the builds byte for byte.
- Android: NOT on Play at 1.7.78 as far as any session knows (Play internal testing had 1.5.74, build 89, on 2026-11-24). The signed 1.7.78 bundle is at `~/Downloads/Folevi 1.7.78 Android/Folevi-1.7.78-103.aab`.
- Tags `v1.6.78` and `v1.7.78` are local only (not pushed).
- How to release: `handoff/guide.md` section 6. One version for every platform, cut with `scripts/version.mjs`; a Big update keeps the patch number (1.5.78, 1.6.78, 1.7.78). Mac deltas need the earlier ZIPs in `apps/mac/release-archive/` (kept in the main checkout).

## Next steps

- The owner drags the Android bundle into Play Console's internal testing (files that size can't be attached by a session).
- Next free version: 1.7.79 (Small update) or 1.8.79 (Big update). The next iOS upload needs a build above 107.
- Hardware checks nobody has done: Float this note on a Mac, a Windows PC and in Chrome; the first automatic update (1.7.78 to 1.8.78) on Windows and the Linux AppImage; the native iPhone and iPad build on devices.
- CI builds no Swift or Kotlin: before merging anything that touches `apps/mac`, `apps/ios`, `apps/mobile` or `apps/native-kit`, build the Mac app and the iOS app (`node apps/mac/scripts/build.mjs`, `apps/ios` `node scripts/simulator.mjs build`).

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
