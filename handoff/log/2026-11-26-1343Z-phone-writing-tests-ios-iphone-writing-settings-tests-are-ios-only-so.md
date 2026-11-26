# iPhone Writing settings tests are iOS only, so swift test builds on a Mac again

- Date: 2026-11-26 13:43 UTC
- Area: ios
- Branch: claude/phone-writing-tests-ios-only

`apps/native-kit/Tests/FoleviPhoneTests/PhoneWritingSettingsTests.swift` (PR 158) is now inside `#if os(iOS)`, like `PhoneVaultTests.swift`: its types are iOS only, so `swift test` in `apps/native-kit` failed to build for every target on a Mac. Checked: `swift build --build-tests` on macOS completes. Nothing left.
