# Folevi for Mac: migration, signing, updates and releases (WM3)

The native Folevi for Mac (`apps/mac`, docs/MAC_WEBKIT_PLAN.md, docs/DESKTOP.md) replaces the Electron app (removed
from the repository on 2026-10-23; its last version was 1.21.0) in place: same bundle id (`com.folevi.mac`), same team (`7K32QQ2FX8`), same support folder
(`~/Library/Application Support/Folevi`). This page covers how an Electron Mac becomes a native one, how the app
is signed, updated and downloaded, and the exact steps the owner runs. Builders only ever run the dry runs.

## 1. Moving from Electron (first launch)

Code: `apps/mac/Folevi/Migration/` (`ElectronMigration.swift`, `SafeStorage.swift`, `MigrationWindow.swift`). It
runs from `AppDelegate.migrate`, before any other part of the app reads the support folder, and only when the
folder holds something only Electron writes (Chromium's files, `secrets/`, `e2ee/`, `settings.json`, an Electron
`library.json`) and `migration.json` doesn't say it finished.

A small window, "Moving Folevi to its new engine", shows four steps. Each is idempotent; a step that can't finish
stops with what happened and Try Again, Continue Without or Quit. Nothing of Electron's is deleted then.

| Step | From (Electron) | To (native) |
| --- | --- | --- |
| Sign-ins | `secrets/auth.session[.<user id>].bin`, `secrets/ai.*.bin`, `cloud-tokens.bin`, `cloud-connection.json` | Keychain `com.folevi.shell-auth` `session[.<user id>]`, `com.folevi.shell-secrets` `ai.*`, `com.folevi.cloud-tokens` `<provider>`; `folevi.cloud.provider/account` |
| Encryption keys | `e2ee/device.{bin,json}`, `e2ee/accounts/<user id>/`, `prefs.json`, `library-keys/<id>.key` | Keychain `com.folevi.e2ee` `device[.<user id>]` (same `mac-<ulid>` device id, private halves checked against `device.json`), `e2ee.faceId`; `com.folevi.library-key` `<library id>` |
| Library | `library.json` `{ kind, path, chosenFolder?, move?, encryptionJob? }`, `places.json`, `library/journal-<id>.bin` | `library.json` `{ kind, bookmark?, sub?, move?, encryptionJob? }` (Electron's kept as `library.electron.json`); `places.json` and the journal as they are; Electron's Dropbox or Google Drive copy set aside as `Cloud libraries (previous)` (the native app downloads its own) |
| Settings | `settings.json`, `window.json`, `reminders.json` | `folevi.desktop.settings` (the page's four settings), `folevi.shell.mode`, the first window's frame (`ElectronMigration.firstWindowFrame`), waiting reminders scheduled with the system, shown ones not shown again. `lock.json` stays (MacAppLock reads it as is) |

Sealed values are Electron's safeStorage: the password in the login Keychain item "Folevi Safe Storage" (account
"Folevi Key"), PBKDF2-HMAC-SHA1 (`saltysalt`, 1003 rounds) to an AES-128-CBC key, IV of 16 spaces, blobs that
start with `v10`. Each value is decrypted, stored, read back and compared before its step counts as done.

30 days after a finished migration (`cleanUpIfDue`, at launch) Chromium's storage and caches go, and the sealed
folders of the steps that moved. A step the person went on without keeps its files. The library, its journal,
`places.json`, `library.json` and `lock.json` are the native app's and stay.

### R1: the Keychain item opens without a prompt (proved 2026-10-23)

The item's access list names the Electron app by its designated requirement (bundle id and team). A native app
with the same bundle id and a Developer ID signature meets it. Proved with throwaway apps and a throwaway item,
never the owner's:

1. Electron 44.4.5 itself, renamed to `com.folevi.migration-test` and Developer ID signed, made the item
   "Folevi Migration Test Safe Storage" and sealed four strings.
2. A different binary (Swift, the migration's own `SafeStorage.swift`) with the same bundle id and Developer ID
   read the item with every prompt refused (`SecKeychainSetUserInteractionAllowed(false)`,
   `kSecUseAuthenticationUIFail`) in 15 ms and opened all four. A rebuilt copy (another cdhash) read it too, so an
   update keeps working.
3. Controls: the same binary as `com.folevi.migration-test.other` (Developer ID) and as an ad hoc build both got
   "needs permission" at once, with no dialog. So the check tells the two cases apart.
4. The item was deleted afterwards. The strings and the item's password are the test vector in
   `apps/mac/fixtures/migration/safestorage-vector.json` (they protect nothing now).

`release.mjs` checks that every release build's designated requirement is the Electron app's,
character for character. If macOS ever does ask (a Mac whose Keychain was reset, say), the migration window explains
the one question first ("Choose Always Allow"), then asks. If the person says Deny: Continue Without means signing
in again and approving the Mac for encrypted notes again; nothing is lost.

Test runs never touch the real item: a Debug build or a `FOLEVI_USER_DATA` run reads only what
`FOLEVI_SAFE_STORAGE` names (`mock` for a folder made by Electron with `--use-mock-keychain`, whose password is
Chromium's `mock_password`, or `<name>` for a throwaway "<name> Safe Storage" item).

## 2. Offline changes left in Electron

Electron kept the web app's account databases (and so any edit not yet sent) in Chromium's IndexedDB, which
WebKit can't read. A handover release (Electron 1.22, writing those databases out for the native app to import)
was planned and built, then dropped before it shipped: no Electron copy ever got it, because Electron's update feed
(`updates.folevi.com`) never resolved, so every Electron copy out there is one the owner or a tester installed by
hand. The migration has no offline step: it moves sign-ins, keys, the library and settings. The library is files
and its journal moves, so local-mode notes are never at risk; an account edit made offline in Electron and never
synced stays in Chromium's storage, which the migration keeps for 30 days, and opening "Folevi (previous).app"
(`release.mjs --install` keeps it) once while online sends it.

## 3. Signing

- Identity: "Developer ID Application: Abu Mohammad Faisal (7K32QQ2FX8)", hardened runtime, secure timestamp,
  not sandboxed (decision M8).
- Entitlements (`apps/mac/Folevi/Resources/Folevi.entitlements`): microphone; iCloud container
  `iCloud.com.folevi` for CloudDocuments in the production environment; Keychain group `7K32QQ2FX8.com.folevi.mac`.
  No JIT entitlements.
- Provisioning profile: "Folevi for Mac Developer ID iCloud" (type `MAC_APP_DIRECT`, App Store Connect id
  `7UV5HL3JWQ`, UUID `fb7482e9-ec98-40fd-a42e-fe908c5125ed`), with the iCloud container and the team's Keychain
  groups, for the current Developer ID certificate (serial `7AA7EDB68D8654F4`, expires 2027-02-01). Committed as
  `apps/mac/signing/Folevi.provisionprofile`; `release.mjs` puts it in Xcode's profiles folder. It was made through
  the App Store Connect API on 2026-10-22 and checked on 2026-10-23 (active, the right certificate and
  entitlements), so no second one was made. When the certificate is renewed, the profile has to be made again:
  `POST /v1/profiles` with `profileType: MAC_APP_DIRECT`, the bundle id `com.folevi.mac` (`YGQBMDR4TR`, iCloud
  capability on) and the new certificate, then commit the downloaded file.
- Debug builds (`com.folevi.mac.dev`, Apple Development) have no iCloud or Keychain group entitlement and need no
  profile.

## 4. Updates (Sparkle 2)

- Sparkle 2.10.0 (Swift package, exact version). `Updates/Updater.swift`; release builds only (a Debug build or a
  `FOLEVI_USER_DATA` run never checks; `FOLEVI_UPDATES=on|off`, `FOLEVI_UPDATE_URL` for a test bucket).
- Feed `https://folevi.com/download/mac/appcast.xml`, checked every six hours, downloaded in the background,
  installed on quit or from "Restart to Update" (`Updater.shared.menuTitle`, `menuAction()`, the
  `Updater.changed` notification: the Folevi menu shows it).
- EdDSA key: generated 2026-10-23 on this Mac with Sparkle's `generate_keys --account folevi`. The private key is
  only in the login Keychain (service `https://sparkle-project.org`, account `folevi`); the public key
  `F+N/necf9zCMzOTldJSKppxPoWCYn8rTANGly0mLbtA=` is `SUPublicEDKey` in Info.plist. Back the private key up once
  (`generate_keys --account folevi -x <file>`, kept somewhere safe, never in the repository): without it, no update
  can ever be signed for copies already out there.
- The bucket: `folevi-updates` on Cloudflare R2, public at `https://pub-e55d5e1b47314fcbbbe3664ed7aed1c2.r2.dev`.
  folevi.com's DNS is at Namecheap, so the bucket has no custom domain of its own: the website proxies it.
  `apps/web/next.config.ts` rewrites `https://folevi.com/download/:path*` to the bucket's address, with these
  caching headers: `public, max-age=31536000, immutable` for versioned files (`Folevi-<v>.zip`, `.dmg`, the
  `.delta` files), `no-cache` for `mac/appcast.xml` and the stable `mac/Folevi.dmg`, and a short cache for anything
  else. Keys under `mac/`: `Folevi-<v>.zip`, its deltas, `Folevi-<v>.dmg`, `Folevi.dmg` (the website's download
  link, `https://folevi.com/download/mac/Folevi.dmg`) and `appcast.xml`. `publish.mjs` uploads with
  `npx wrangler r2 object put folevi-updates/<key> --remote` and reads the current appcast from the r2.dev address.
- Electron copies can't be moved over by an update: they read `mac/darwin-universal/RELEASES.json` from
  `updates.folevi.com`, which never resolved, so there is nothing to redirect. Anyone on Electron downloads the
  native app from the website (or the owner installs it); the first launch migrates the folder (section 1).

## 5. Versions

One version for every platform (the owner's rule, 2026-10-23, made exact 2026-10-29): MAJOR.UPDATE.PATCH shown as
`#.#.##`, UPDATE one digit and PATCH always two, shown as "Folevi 1.0.00" (the About panel says "Version 1.0.00",
with no build number). Three kinds of release, chosen by hand, the next version worked out by `scripts/version.mjs`:
a Major release (`major`, 1.5.20 to 2.0.00), a Big update (`update`, 1.0.25 to 1.1.00, 1.9.x to 2.0.00) and a Small
update (`patch`, 1.0.09 to 1.0.10, 1.1.99 to 1.2.00, 1.9.99 to 2.0.00). `version.json` at the repo root holds the
version and the build, a whole number that goes up by one with every new version and is never shown;
`CHANGELOG.json` holds every release (version, build, date, type, changes) and `CHANGELOG.md` is written from it.
`node scripts/version.mjs release patch|update|major --change "..."` (`--plan` to see it first; `next` lists the
three) is the only way the version changes: it refuses a version that exists already or is older, records the
release in the changelog and writes the version and build into `apps/mac/project.yml` (`MARKETING_VERSION`,
`CURRENT_PROJECT_VERSION`), the iOS project and Android's `build.gradle.kts`. `check` (and the web tests in CI) fail
when any of them, or the changelog, says something else. `publish.mjs` refuses a version or build the live feed has
already, or an older one, and gives Sparkle the release's changes as its release notes. Sparkle compares
the build (`sparkle:version`, CFBundleVersion); 1.0.00 is its `sparkle:shortVersionString`. `release.mjs --install`
never changes the version: it refuses one that already has a `mac-v<version>` tag.

## 6. Scripts

| | Who | What |
| --- | --- | --- |
| `node apps/mac/scripts/release.mjs --out <dir> [--universal] [--launch-check]` | anyone | the dry run: production export, Release archive, Resources/web, signature, every check, `checks.json`. Nothing installed or opened |
| `node apps/mac/scripts/release.mjs --install` | owner | the same, then `/Applications/Folevi.app` (an Electron copy kept as "Folevi (previous).app"), the tag, opens it |
| `node apps/mac/scripts/publish.mjs` (`--plan` to see) | owner | universal build, notarization (`folevi-notary`), staple, ZIP, DMG, the signed appcast with deltas, upload to R2 |

Dry run on 2026-10-23 (arm64, the production export, `release.mjs --out <scratch> --web <export>`): archive in
under ten minutes, 92 MB, every check passed (Developer ID with a secure timestamp, hardened runtime, the
entitlements above, the embedded profile, production Resources/web for 2.0.0, Sparkle signed by the team, the
public key matching the Keychain's, and the installed Electron app's designated requirement, so its Keychain item
accepts the build). Only notarization is left for `publish.mjs`. `--launch-check` is off by default:
the run's folder, Keychain names and web storage are its own, but AppKit keeps small window state in
`com.folevi.mac`'s preferences, which the installed Folevi shares.

### Testing on this Mac

- `FoleviTests/MigrationTests.swift` (11 tests) runs the migration on `apps/mac/fixtures/migration` in memory and
  in the run's own Keychain names. The fixture was made with the Electron app's own modules (its safeStorage with
  `--use-mock-keychain`) before the Electron code was removed; it's frozen now (the script that made it,
  `scripts/migration-fixture.mjs`, went with it). Electron's formats won't change again, so it needs no remaking.
- A test host launched by xcodebuild can't open files in `~/Documents` until macOS has been told it may (the
  repository is there, so dyld waits on the folder's privacy question and xcodebuild reports "the test runner hung
  before establishing connection"). Until the owner allows it, run the tests with derived data, the run's folder
  and a copy of the fixtures outside `~/Documents` (`FOLEVI_MIGRATION_FIXTURES`), as WM3 did.
- End to end: Electron itself (its safeStorage with `--use-mock-keychain` and the Electron app's modules) wrote a
  scratch support folder (a folder library in a scratch folder, encrypted, E2EE keys, a session and a Foli AI key,
  two places and settings); the Debug app on a copy (`FOLEVI_USER_DATA`, `FOLEVI_SAFE_STORAGE=mock`) migrated it in
  0.24 s and then answered with the same device id, the library open and unlocked, the note readable, the Foli AI
  key set and both places (2026-10-22, before the Electron code was removed).

## 7. What the owner does, in order

1. **Back up the Sparkle key** (once): `apps/mac/build/DerivedData-release/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys --account folevi -x ~/Desktop/folevi-sparkle-key.txt` (the tool comes with the first release build),
   move the file to your password manager or another safe place, delete it from the Desktop.
2. **Dogfood the Debug build** for a week (`node apps/web/scripts/build-shell.mjs`, `node apps/mac/scripts/build.mjs`,
   then `node apps/mac/scripts/mac.mjs launch`; it has its own data and never touches the installed app).
3. **Install the native app on this Mac**: quit Folevi, then `node apps/mac/scripts/release.mjs --install`. The
   migration window appears once; it should finish by itself in a few seconds without a Keychain question. The
   Electron app stays as "Folevi (previous).app" until you decide it can go (Trash it then; open it once while
   online first if it might hold account edits made offline, section 2). Commit `apps/mac/project.yml` if the
   version moved.
4. **Publish** (when it's ready for others): `xcrun notarytool history --keychain-profile folevi-notary` must
   work (if not: `xcrun notarytool store-credentials folevi-notary --apple-id <your Apple ID> --team-id 7K32QQ2FX8`),
   `npx wrangler whoami` must show the account that owns `folevi-updates`, then
   `node apps/mac/scripts/publish.mjs` (`--plan` first shows every key it uploads). macOS asks once whether
   `generate_appcast` may use the Sparkle key: choose Always Allow. Check the bucket's own copies:
   `curl -I https://pub-e55d5e1b47314fcbbbe3664ed7aed1c2.r2.dev/mac/Folevi.dmg` and `.../mac/appcast.xml` answer 200.
5. **Deploy the website** (push to main) once step 4 is done, so `https://folevi.com/download/mac/Folevi.dmg` (the
   /mac page's Download button) and the appcast Sparkle reads resolve through the rewrite. Then
   `curl -I https://folevi.com/download/mac/appcast.xml` shows `cache-control: no-cache` and
   `curl -I https://folevi.com/download/mac/Folevi-1.0.00.dmg` shows `immutable`.
6. **Testers on Electron** install the native app from the website by hand (the Electron feed never resolved, so no
   update reaches them); their first launch migrates the folder.
