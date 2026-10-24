# Apple development (iOS, iPadOS, macOS, watchOS, tvOS, visionOS)

Applies to every Apple project, current and future (Airly Studio apps in `~/Documents/GitHub/Airly Studio/`).

## Account
- Paid Apple Developer Program, **Individual** enrollment (seller name "Abu Mohammad Faisal"). Apple Account: faisal@airlystudio.com, role Admin.
- **Team ID: `7K32QQ2FX8`** — always set `DEVELOPMENT_TEAM = 7K32QQ2FX8`.
- Never use team `558GMKM4KY` (old free personal team, cert "Apple Development: abumohammadfaisal@icloud.com") or the "Developer ID Application: Emily Lien (MP3F2VY4AY)" cert that is also in the keychain.

## Signing identities in the login keychain (team 7K32QQ2FX8)
- Apple Development: Abu Mohammad Faisal (BM8PK4JCA2) — expires 2027-10-22
- Apple Distribution: Abu Mohammad Faisal (7K32QQ2FX8) — expires 2027-10-22
- 3rd Party Mac Developer Installer (Mac Installer Distribution) — expires 2027-10-22
- Developer ID Application: Abu Mohammad Faisal (7K32QQ2FX8)
- Developer ID Installer: Abu Mohammad Faisal (7K32QQ2FX8) — **expires 2027-02-01**; remind the user to renew it in January 2027.

## Project conventions
- **Automatic signing** (`CODE_SIGN_STYLE = Automatic`) for all configurations. Let Xcode manage App IDs, profiles and devices; pass `-allowProvisioningUpdates` to `xcodebuild` when needed.
- **Bundle IDs: `com.airlystudio.<app>`** (lowercase app name). Derived identifiers follow it: extensions `com.airlystudio.<app>.<extension>`, App Groups `group.com.airlystudio.<app>`, iCloud containers `iCloud.com.airlystudio.<app>`.
- **Existing projects:** when I next work in one, move its signing to team 7K32QQ2FX8 (and automatic signing) as part of that work. Don't change a shipped app's bundle ID without asking — it would make it a different app on the App Store.
- **macOS distribution:** decide per app — ask at the start of each Mac project: Mac App Store (sandboxed, Apple Distribution), direct download (Developer ID + hardened runtime + notarization + stapling), or both.

## Releases
- I may build and archive freely. **Ask before** every upload to App Store Connect/TestFlight, every App Store submission, and every notarization submission.
- CLI auth uses the **App Store Connect Team API key "Claude Code CLI"** (role: Developer), set up 2026-10-22:
  - Key ID `HS88CK5RQF`, Issuer ID `9479ebb4-e44a-45b4-bfef-e625408057ae`
  - Key file `~/.appstoreconnect/private_keys/AuthKey_HS88CK5RQF.p8` — never read, print or copy its contents. (`ApiKey_TA5TTJ91KGQQ.p8` in the same folder predates this setup; leave it alone.)
  - Notarization: keychain profile **`airly-notary`** (validated) — `xcrun notarytool submit … --keychain-profile airly-notary --wait`, then `xcrun stapler staple`.
  - Uploads/export: `xcodebuild -exportArchive … -allowProvisioningUpdates -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_HS88CK5RQF.p8 -authenticationKeyID HS88CK5RQF -authenticationKeyIssuerID 9479ebb4-e44a-45b4-bfef-e625408057ae` (or `xcrun altool --apiKey HS88CK5RQF --apiIssuer …`).
  - The Developer role can upload builds and notarize, but can't submit for App Store review or edit metadata — the user does those, or upgrades the key to App Manager.
