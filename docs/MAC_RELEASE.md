# Folevi for Mac: migration, signing, updates and releases (WM3)

The native Folevi for Mac (`apps/mac`, docs/MAC_WEBKIT_PLAN.md) replaces the Electron app (`apps/desktop`) in
place: same bundle id (`com.folevi.mac`), same team (`7K32QQ2FX8`), same support folder
(`~/Library/Application Support/Folevi`). This page covers how an Electron Mac becomes a native one, how the app
is signed and updated, and the exact steps the owner runs. Builders only ever run the dry runs.

## 1. Moving from Electron (first launch)

Code: `apps/mac/Folevi/Migration/` (`ElectronMigration.swift`, `SafeStorage.swift`, `HandoverImport.swift`,
`MigrationWindow.swift`, `handover-kit.js`). It runs from `AppDelegate.migrate`, before any other part of the app
reads the support folder, and only when the folder holds something only Electron writes (Chromium's files,
`secrets/`, `e2ee/`, `settings.json`, an Electron `library.json`, a `handover/`) and `migration.json` doesn't say
it finished.

A small window, "Moving Folevi to its new engine", shows five steps. Each is idempotent; a step that can't finish
stops with what happened and Try Again, Continue Without or Quit. Nothing of Electron's is deleted then.

| Step | From (Electron) | To (native) |
| --- | --- | --- |
| Sign-ins | `secrets/auth.session[.<user id>].bin`, `secrets/ai.*.bin`, `cloud-tokens.bin`, `cloud-connection.json` | Keychain `com.folevi.shell-auth` `session[.<user id>]`, `com.folevi.shell-secrets` `ai.*`, `com.folevi.cloud-tokens` `<provider>`; `folevi.cloud.provider/account` |
| Encryption keys | `e2ee/device.{bin,json}`, `e2ee/accounts/<user id>/`, `prefs.json`, `library-keys/<id>.key` | Keychain `com.folevi.e2ee` `device[.<user id>]` (same `mac-<ulid>` device id, private halves checked against `device.json`), `e2ee.faceId`; `com.folevi.library-key` `<library id>` |
| Library | `library.json` `{ kind, path, chosenFolder?, move?, encryptionJob? }`, `places.json`, `library/journal-<id>.bin` | `library.json` `{ kind, bookmark?, sub?, move?, encryptionJob? }` (Electron's kept as `library.electron.json`); `places.json` and the journal as they are; Electron's Dropbox or Google Drive copy set aside as `Cloud libraries (previous)` (the native app downloads its own) |
| Settings | `settings.json`, `window.json`, `reminders.json` | `folevi.desktop.settings` (the page's four settings), `folevi.shell.mode`, the first window's frame (`ElectronMigration.firstWindowFrame`), waiting reminders scheduled with the system, shown ones not shown again. `lock.json` stays (MacAppLock reads it as is) |
| Offline changes | `handover/` (Electron 1.22, section 2) | WebKit's storage for `app://folevi` through a hidden view running the same kit |

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

`release.mjs` checks that every release build's designated requirement is the installed Electron app's,
character for character. If macOS ever does ask (a Mac whose Keychain was reset, say), the migration window explains
the one question first ("Choose Always Allow"), then asks. If the person says Deny: Continue Without means signing
in again and approving the Mac for encrypted notes again; nothing is lost.

Test runs never touch the real item: a Debug build or a `FOLEVI_USER_DATA` run reads only what
`FOLEVI_SAFE_STORAGE` names (`mock` for a folder made by Electron with `--use-mock-keychain`, whose password is
Chromium's `mock_password`, or `<name>` for a throwaway "<name> Safe Storage" item).

## 2. Electron 1.22: the handover

Electron keeps the web app's account databases in Chromium's IndexedDB, which WebKit can't read. Electron 1.22
(`apps/desktop/src/handover.ts`, small marked edits in `main.ts` and `updates.ts`) writes every account database
that still holds unsent work into `userData/handover/` with handoffKit's own chunks, an index (names, versions,
schema, counts, a SHA-256 per file) and the sync journals:

- **at every quit** (up to 20 seconds), so a native app installed by hand finds it too;
- **before an update installs**: when Squirrel has downloaded one, the menu says "Finishing Sync Before the
  Update…" while the normal sync gets up to ten minutes to send what's waiting, then "Restart to Update" writes the
  handover and installs.

It's written whole into a temporary folder and renamed into place. Electron removes a handover it finds at launch
(it's running again, so its storage is the truth). The native app imports it before any window opens: nothing
already there is overwritten, a database newer than the bundled interface holds the import back and asks for an
update, and the folder is renamed `handover (imported)` until the clean-up.

`apps/mac/Folevi/Migration/handover-kit.js` is made from `handoffKit.ts` as tsc compiles it:
`cd apps/desktop && pnpm build && node scripts/handover-kit.mjs` (and `--check`). `src/handover.test.ts` runs the
committed copy against the kit.

With no handover and Chromium storage present (an Electron older than 1.22 replaced by hand), the window says some
offline changes may not have reached Folevi and to open the previous version once (`release.mjs --install` keeps
the Electron app as "Folevi (previous).app").

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
- Feed `https://updates.folevi.com/mac/appcast.xml`, checked every six hours, downloaded in the background,
  installed on quit or from "Restart to Update" (`Updater.shared.menuTitle`, `menuAction()`, the
  `Updater.changed` notification: the Folevi menu shows it).
- EdDSA key: generated 2026-10-23 on this Mac with Sparkle's `generate_keys --account folevi`. The private key is
  only in the login Keychain (service `https://sparkle-project.org`, account `folevi`); the public key
  `F+N/necf9zCMzOTldJSKppxPoWCYn8rTANGly0mLbtA=` is `SUPublicEDKey` in Info.plist. Back the private key up once
  (`generate_keys --account folevi -x <file>`, kept somewhere safe, never in the repository): without it, no update
  can ever be signed for copies already out there.
- The bucket: the Electron feed's (`folevi-updates` on Cloudflare R2, served at `https://updates.folevi.com`).
  Native files live under `mac/`: `Folevi-<v>.zip`, its deltas, `Folevi-<v>.dmg`, `Folevi.dmg` and `appcast.xml`.
  Electron's stay under `mac/darwin-universal/`.
- Electron copies update to the native app when its Squirrel feed (`mac/darwin-universal/RELEASES.json`) points at
  the native ZIP (`publish.mjs --electron-feed`). Squirrel.Mac accepts it: the build meets the running app's
  designated requirement (checked by `release.mjs`).

## 5. Versions

One version for every platform (the owner's rule, 2026-10-23, replacing decision M9's 2.0.0): biggest.big.minor
with two digits last, 1.0.00, 1.0.01 ... 1.0.99, then 1.1.00, and 2.0.00 for the biggest changes, shown as
"Folevi 1.0.00" (the About panel says "Version 1.0.00", with no build number). `version.json` at the repo root holds
the version and the build, a whole number that goes up by one with every new version and is never shown;
`node scripts/version.mjs set <version>` or `bump minor|big|biggest` writes them into `apps/mac/project.yml`
(`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`), the iOS project and Android's `build.gradle.kts`. Sparkle compares
the build (`sparkle:version`, CFBundleVersion); 1.0.00 is its `sparkle:shortVersionString`. `release.mjs --install`
never changes the version: it refuses one that already has a `mac-v<version>` tag.

## 6. Scripts

| | Who | What |
| --- | --- | --- |
| `node apps/mac/scripts/release.mjs --out <dir> [--universal] [--launch-check]` | anyone | the dry run: production export, Release archive, Resources/web, signature, every check, `checks.json`. Nothing installed or opened |
| `node apps/mac/scripts/release.mjs --install` | owner | the same, then `/Applications/Folevi.app` (an Electron copy kept as "Folevi (previous).app"), the tag, opens it |
| `node apps/mac/scripts/publish.mjs [--electron-feed]` (`--plan` to see) | owner | universal build, notarization (`folevi-notary`), staple, ZIP, DMG, the signed appcast with deltas, upload |
| `node apps/mac/scripts/migration-fixture.mjs` | anyone | remakes `apps/mac/fixtures/migration` (after `pnpm build` in apps/desktop) |
| `node apps/desktop/scripts/handover-kit.mjs [--check]` | anyone | remakes `handover-kit.js` from the compiled kit |

Dry run on 2026-10-23 (arm64, the production export, `release.mjs --out <scratch> --web <export>`): archive in
under ten minutes, 92 MB, every check passed (Developer ID with a secure timestamp, hardened runtime, the
entitlements above, the embedded profile, production Resources/web for 2.0.0, Sparkle signed by the team, the
public key matching the Keychain's, and the installed Electron app's designated requirement, so its Keychain item
and Squirrel accept the build). Only notarization is left for `publish.mjs`. `--launch-check` is off by default:
the run's folder, Keychain names and web storage are its own, but AppKit keeps small window state in
`com.folevi.mac`'s preferences, which the installed Folevi shares.

### Testing on this Mac

- `FoleviTests/MigrationTests.swift` (13 tests) runs the migration on `apps/mac/fixtures/migration` (made by
  `scripts/migration-fixture.mjs` with Electron's own modules) in memory and in the run's own Keychain names, and
  the handover import in WebKit (a persistent scratch data store: WebKit's non-persistent stores refuse Blobs in
  IndexedDB).
- A test host launched by xcodebuild can't open files in `~/Documents` until macOS has been told it may (the
  repository is there, so dyld waits on the folder's privacy question and xcodebuild reports "the test runner hung
  before establishing connection"). Until the owner allows it, run the tests with derived data, the run's folder
  and a copy of the fixtures outside `~/Documents` (`FOLEVI_MIGRATION_FIXTURES`), as WM3 did.
- End to end: Electron itself (its safeStorage with `--use-mock-keychain` and apps/desktop's modules) wrote a
  scratch support folder (a folder library in a scratch folder, encrypted, E2EE keys, a session and a Foli AI key,
  two places, settings, and a handover from Chromium's real IndexedDB); the Debug app on a copy
  (`FOLEVI_USER_DATA`, `FOLEVI_SAFE_STORAGE=mock`) migrated it in 0.24 s and then answered with the same device id,
  the library open and unlocked, the note readable, the Foli AI key set, both places, and the handed-over outbox
  entry and journal in WebKit's storage.

## 7. What the owner does, in order

1. **Back up the Sparkle key** (once): `apps/mac/build/DerivedData-release/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys --account folevi -x ~/Desktop/folevi-sparkle-key.txt` (the tool comes with the first release build),
   move the file to your password manager or another safe place, delete it from the Desktop.
2. **Electron 1.22 first** (the handover): in `apps/desktop`, `pnpm release` (installs 1.22.0 on this Mac). For
   testers, `pnpm publish-mac` so their Electron copies get 1.22 through the current feed. Keep 1.22 the current
   Electron release for at least two weeks before step 5's `--electron-feed`.
3. **Dogfood the Debug build** beside Electron for a week (`node apps/mac/scripts/build.mjs`, then
   `node apps/mac/scripts/mac.mjs launch`; it has its own data and never touches the installed app).
4. **Install the native app on this Mac**: quit Folevi, then `node apps/mac/scripts/release.mjs --install`. The
   migration window appears once; it should finish by itself in a few seconds without a Keychain question. The
   Electron app stays as "Folevi (previous).app" until you decide it can go (Trash it then). Commit
   `apps/mac/project.yml` if the version moved.
5. **Publish** (when it's ready for others): `xcrun notarytool history --keychain-profile folevi-notary` must
   work (if not: `xcrun notarytool store-credentials folevi-notary --apple-id <your Apple ID> --team-id 7K32QQ2FX8`),
   `npx wrangler whoami` must show the account that owns `folevi-updates`, then
   `node apps/mac/scripts/publish.mjs`. macOS asks once whether `generate_appcast` may use the Sparkle key: choose
   Always Allow. Later, once Electron 1.22 has been out long enough: `node apps/mac/scripts/publish.mjs --electron-feed`
   moves Electron copies to the native app.
6. **Make `updates.folevi.com` resolve** to the bucket (Cloudflare R2 custom domain). It doesn't today, so neither
   Electron nor the native app can update until it does.
