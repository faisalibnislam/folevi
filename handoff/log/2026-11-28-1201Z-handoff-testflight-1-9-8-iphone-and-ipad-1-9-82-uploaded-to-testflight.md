# iPhone and iPad 1.9.82 uploaded to TestFlight; Folevi Server release handed to its session

- Date: 2026-11-28 12:01 UTC
- Area: release
- Branch: claude/handoff-testflight-1.9.82

By the PR manager session.

The owner's words, in this session on 2026-11-28: "release TestFlight and Folevi Server".

TestFlight: built in the release worktree at `33fcfd22` (main at PR 205's merge, the version commit `79cfe52e` and the Mac handoff record) with `node scripts/release.mjs --no-upload` in `apps/ios`: archive and export succeeded. The IPA is `com.folevi.ios` 1.9.82, build 113, minimum iOS 26.0, 118,606,100 bytes, SHA-256 `a7920f1fd99cf46c4112276b44934625039a6683c2c6104436b158f0af9ab019`. Uploaded with `xcrun altool --upload-app --type ios` and the App Store Connect key: "UPLOAD SUCCEEDED with no errors", delivery `38eab28b-b7f8-41d7-89ce-cd7cdfa4df6b`. altool also printed one ERROR line about a missing resume file before the upload; it did not affect the result. Internal testing only; nothing was submitted for review.

Not checked: Apple's processing of the build, that it shows for the "Folevi team" group, and the app on a device. The native suites passed on the same source earlier (257 screen, 278 Mac, 36 design, 28, 20 and 14); the web app session reported that the iOS simulator build succeeds.

Folevi Server: handed to the Folevi Server session with the owner's words quoted. Its plan is in `handoff/state/release.md`. Nothing under `server/`, `packaging/` or the bucket's `server/` prefix was touched from here.
