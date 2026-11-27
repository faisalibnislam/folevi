# Space Cherries LLC named as Folevi's operator in every app, email, installer and listing

- Date: 2026-11-27 05:16 UTC
- Area: repo
- Branch: claude/strange-swartz-bceee4

The owner decided on 2026-11-27 where the operator goes. Following the website (PR 167), this change names Space Cherries LLC in each of those places.

**Sources (one per language).** The web keeps `OPERATOR`, `OPERATOR_ADDRESS` and the new `OPERATOR_COPYRIGHT` ("© 2026 Space Cherries LLC") in `apps/web/src/components/marketing/site.ts`. The emails use `packages/email/src/operator.ts` and Swift uses `apps/native-kit/Sources/FoleviDesign/Operator.swift` (`FoleviOperator`). `tests/convex/static/operator.test.ts` checks that every copy, plist, Tauri config, listing and NAS manifest matches site.ts. It also checks that the street address stays out of non-legal places and that the desktop identifiers didn't change.

**What changed**
- **Web, Android (Capacitor) and Windows/Linux** (they all show the web Settings): Settings > About gains "Operated by Space Cherries LLC" (with a link), the address and the copyright line, under the terms and privacy links. Sign-up gets "Folevi is operated by Space Cherries LLC." under the terms line. Both stay hidden on a Folevi Server, as the terms line already was.
- **Mac:**
  - Settings > About (`AboutSettings.swift`) gets the same operator block.
  - The About panel's credits now say "Operated by Space Cherries LLC" with a link.
  - Info.plist `NSHumanReadableCopyright` is "© 2026 Space Cherries LLC".
- **iPhone/iPad:**
  - Settings > About (`PhoneAboutSettings`) gets an "Operated by" row, with the address and copyright in its footer.
  - The shared `AboutSettingsSection` (FoleviScreens) gets the same.
  - The native sign-up line is in `SignInScreens.swift`.
  - The App Info.plist gets `NSHumanReadableCopyright`.
- **Emails:**
  - Every template's footer ends with "Folevi is operated by Space Cherries LLC, 5242 Elbetee Lane, Alexandria, VA 22312, USA." (HTML with a link, and plain text).
  - The line sits between markers. `renderEmail(..., { operator: false })` drops it, and `convex/email.ts` passes that on a Folevi Server, whose emails come from the person who runs it.
- **Folevi Server:** the setup pages and the admin Overview say "Folevi Server is made by Space Cherries LLC" with a link (`components/server/MadeBy.tsx`). It says "made by", not "operated by", because the self-hoster operates the server.
- **Installers and listings:**
  - Tauri `publisher` and `copyright` (Windows NSIS/MSI CompanyName and LegalCopyright, plus deb/rpm), and Cargo `authors`.
  - Linux: AppStream `developer` name plus a description line, the snap description line, and nfpm vendor and maintainer.
  - Docker vendor label.
  - NAS and app-store manifests: Synology, QNAP, TerraMaster, UGREEN, ASUSTOR, Unraid, Runtipi, Umbrel, CasaOS, TrueNAS, all through `packaging/lib/common.sh`.
  - Web Clipper: manifest `author`, plus STORE.md's description and publisher name.
- **Unchanged on purpose:**
  - Bundle IDs, App IDs, team, signing, Play package and Tauri `identifier`/`productName`.
  - The AppStream `developer id="com.folevi"`.
  - The Linux and Folevi Server Beta tags.
  - The native Compose app (`apps/android`, paused, PR 112 draft): it has no About screen, only a version line.

**Checked**
- Email package: 238 tests, typecheck and lint.
- Web: tsc, eslint on the changed files, and `operator.test.tsx` with the auth and beta tests (21).
- Convex: tsc, plus the email and server-edition tests (41).
- `tests/convex/static/operator.test.ts` (23).
- Swift: `swift build`, `OperatorTests` (2) and an xcodebuild of FoleviPhone for the iOS Simulator.
- Mac: `MenuTests` (8, including the new `testAboutNamesTheOperator`), run headless.
- Plists linted, JSON/YAML/XML parsed.

**Not checked**
- No screenshots of the new rows.
- No desktop (Rust) build.
- Whether a Windows update from a build with publisher "Folevi" to one with "Space Cherries LLC" keeps a custom install folder. Tauri's NSIS installer stores that folder under `HKCU\Software\<publisher>\Folevi`, so try one update on Windows before the next Windows release.

**Owner steps (consoles, not in the repo)**
- **Apple:** the seller name comes from the Developer Program membership (Individual, "Abu Mohammad Faisal"). Showing Space Cherries LLC means moving the membership to an Organization (D-U-N-S number). In App Store Connect, set each app's Copyright field to "2026 Space Cherries LLC".
- **Google Play:** Console > Developer account > developer name, address and organization verification.
- **Stores:** set the publisher display name in the Snap Store, the Chrome Web Store and Edge Add-ons, and the Microsoft Store if used.
- **Windows code signing:** if a signing certificate is used, its subject is what SmartScreen shows.
