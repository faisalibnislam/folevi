---
name: apple-developer-account
description: "Since 2026-10-22 the owner has the paid Apple Developer Program, team 7K32QQ2FX8; use it for all iOS, iPadOS and macOS work"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-22T05:33:04.345Z
---

2026-10-22: the owner joined the Apple Developer Program and said to use it from now on for iOS, iPadOS, macOS and all Apple app development.
- Team "Abu Mohammad Faisal", team ID **7K32QQ2FX8**, role Admin. In this Mac's keychain: "Developer ID Application: Abu Mohammad Faisal (7K32QQ2FX8)", "Apple Distribution: Abu Mohammad Faisal (7K32QQ2FX8)", "Apple Development: Abu Mohammad Faisal (BM8PK4JCA2)"; Xcode also lists Mac Installer Distribution and Developer ID Installer. The old free personal team (558GMKM4KY, abumohammadfaisal@icloud.com cert XS494CQ48W) is retired.
- Mac app (apps/desktop): `pnpm release` signs with the Developer ID Application cert (commit d0a9701f); `pnpm publish` notarizes via the keychain profile `folevi-notary`, saved and validated 2026-10-22 from the App Store Connect API key (Key ID HS88CK5RQF, Issuer 9479ebb4-e44a-45b4-bfef-e625408057ae, file ~/.appstoreconnect/private_keys/AuthKey_HS88CK5RQF.p8; never copy it into the repo or print it).
- Bundle IDs registered 2026-10-22 via the App Store Connect API (client script pattern: ES256 JWT with key HS88CK5RQF): com.folevi.ios (SHA29D74KC: push, app groups, associated domains, iCloud), com.folevi.ios.share (65RQD3278Y: app groups), com.folevi.ios.widgets (7R2FX978U5: app groups), com.folevi.mac (YGQBMDR4TR: iCloud). The API can't create the App Group group.com.folevi or the iCloud container iCloud.com.folevi: the owner does those in the portal. The owner creates the App Store Connect app (iOS, bundle com.folevi.ios).
- 2026-10-22 portal work done (browser + API): App Store Connect app "Folevi" id 6825699028 (iOS, SKU folevi-ios, Productivity/Business, free, privacy URL set, internal TestFlight group "Folevi team" a07a78a1-8693-451b-bab5-c4eead3c2b08 with the owner); App Group group.com.folevi on the 3 iOS IDs; iCloud container iCloud.com.folevi on com.folevi.ios and com.folevi.mac. Sign in with Apple: on com.folevi.ios (primary), Services ID com.folevi.signin (N72V738MU7; domain app.folevi.com, return https://app.folevi.com/api/auth/callback/apple), key BNZC6FGWJC (.p8 downloaded 2026-10-23 to ~/.appstoreconnect/private_keys; APPLE_SIGNIN_* set on dev + prod Convex; website URLs were missing on the Services ID and were registered 2026-10-23), relay email sources folevi.com + hello@/security@/support@ registered but SPF check fails at Apple (revisit with the Resend SPF issue, [[email-provider-resend]]).
- Now possible (not done yet): real iCloud container `iCloud.com.folevi` shared by Mac and iPhone (App ID + iCloud capability + Developer ID provisioning profile), device builds, TestFlight/App Store, APNs push for iOS, passkeys/associated domains. 2026-10-22 the owner said: resume iOS and set up iCloud sync right after the encryption build ([[mac-follows-web]], [[ios-app]]); set DEVELOPMENT_TEAM = 7K32QQ2FX8 in apps/ios then.

**Why:** the free team couldn't notarize, use iCloud containers, push or ship to devices.
**How to apply:** sign every Apple build with team 7K32QQ2FX8; supersedes the "personal cert" notes in [[mac-is-electron]] and "Simulator only" in [[ios-app]]. Portal steps (App IDs, containers, profiles, notary password) are the owner's to do; give exact steps.
