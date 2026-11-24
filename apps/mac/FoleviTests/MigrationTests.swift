// The move from Electron (docs/MAC_WEBKIT_PLAN.md §8): safeStorage against a vector Electron itself made, the whole
// migration of an Electron support folder (apps/mac/fixtures/migration, made with the Electron app's own modules before
// it was removed) into memory and into this run's own Keychain names, and the 30-day clean-up. Never the owner's
// folder or Keychain items: the fixture is copied into a scratch folder, sealed with Electron's mock Keychain.
import CryptoKit
import XCTest
@testable import Folevi

final class MigrationTests: XCTestCase {
    private final class MemoryKeychain: MigrationKeychain {
        var items: [String: Data] = [:]
        func get(_ service: String, _ account: String) -> Data? { items["\(service)|\(account)"] }
        func set(_ service: String, _ account: String, _ data: Data) -> Bool {
            items["\(service)|\(account)"] = data
            return true
        }
    }

    /// apps/mac/fixtures/migration, or a copy FOLEVI_MIGRATION_FIXTURES names (a run whose host can't read the repository).
    private static let fixtures: URL = {
        if let dir = ProcessInfo.processInfo.environment["FOLEVI_MIGRATION_FIXTURES"], !dir.isEmpty { return URL(fileURLWithPath: dir, isDirectory: true) }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("fixtures/migration")
    }()
    private var scratch: URL!
    private var defaults: UserDefaults!
    private var suite = ""

    override func setUpWithError() throws {
        scratch = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-migration-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        suite = "com.folevi.mac.dev.tests.migration-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: scratch)
    }

    private func json(_ url: URL) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private var expected: [String: Any] { try! json(Self.fixtures.appendingPathComponent("electron-user-data.expected.json")) }

    /// A copy of the Electron folder, its library pointed at a scratch folder that exists.
    private func electronFolder() throws -> (folder: URL, library: URL) {
        let folder = scratch.appendingPathComponent("Folevi", isDirectory: true)
        try FileManager.default.copyItem(at: Self.fixtures.appendingPathComponent("electron-user-data"), to: folder)
        let library = scratch.appendingPathComponent("Chosen", isDirectory: true)
        try FileManager.default.createDirectory(at: library.appendingPathComponent("Folevi Library"), withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("library.json")
        try String(contentsOf: file, encoding: .utf8).replacingOccurrences(of: "$LIBRARY", with: library.path).write(to: file, atomically: true, encoding: .utf8)
        return (folder, library)
    }

    private func migration(_ folder: URL, keychain: MigrationKeychain, sealer: ElectronMigration.Sealer = .mock) -> ElectronMigration {
        let home = scratch.appendingPathComponent("home", isDirectory: true)
        let m = ElectronMigration(folder: folder, keychain: keychain, defaults: defaults, sealer: sealer, home: home, documents: home.appendingPathComponent("Documents"))
        // Never the system's notifications from a test (it would ask for permission and wait).
        m.schedule = { _, _, _, _, _ in }
        return m
    }

    private static func b64u(_ d: Data) -> String { ElectronMigration.b64u(d) }

    // MARK: safeStorage

    func testSafeStorageOpensWhatElectronSealed() throws {
        let v = try json(Self.fixtures.appendingPathComponent("safestorage-vector.json"))
        let key = SafeStorage.key(password: try XCTUnwrap(Data(base64Encoded: v["keychainPassword"] as! String)))
        let plain = v["plain"] as! [String]
        let blobs = (v["blobs"] as! [String]).map { Data(base64Encoded: $0)! }
        XCTAssertEqual(plain.count, 4)
        for (blob, text) in zip(blobs, plain) {
            XCTAssertEqual(blob.prefix(3), Data("v10".utf8))
            XCTAssertEqual(try SafeStorage.decryptString(blob, key: key), text)
            // And this file's sealing is Electron's: what it seals opens the same way.
            XCTAssertEqual(try SafeStorage.decryptString(try SafeStorage.encrypt(Data(text.utf8), key: key), key: key), text)
        }
        // Another Mac's key never gives the text back (CBC may still find valid padding, so it needn't throw).
        XCTAssertNotEqual(try? SafeStorage.decryptString(blobs[0], key: SafeStorage.key(password: Data("another Mac".utf8))), plain[0])
        XCTAssertThrowsError(try SafeStorage.decrypt(Data("plain text".utf8), key: key)) { XCTAssertEqual($0 as? SafeStorage.DecryptError, .notSealed) }
        XCTAssertThrowsError(try SafeStorage.decrypt(Data("v10".utf8) + Data(repeating: 1, count: 15), key: key))
        XCTAssertEqual(SafeStorage.folevi, SafeStorage.Item(appName: "Folevi"))
        XCTAssertEqual(SafeStorage.folevi.service, "Folevi Safe Storage")
        XCTAssertEqual(SafeStorage.folevi.account, "Folevi Key")
    }

    func testATestRunNeverReadsTheRealItem() {
        // This test run (Debug, FOLEVI_USER_DATA) never names "Folevi Safe Storage".
        XCTAssertNotEqual(ElectronMigration.sealerForThisRun, .keychain(SafeStorage.folevi))
        XCTAssertEqual(SafeStorage.password(SafeStorage.Item(appName: "Folevi Migration Test \(UUID().uuidString)"), allowPrompt: false), .failure(.notFound))
    }

    func testSecretFilesMapToTheNativeNames() {
        XCTAssertEqual(ElectronMigration.target(forSecret: "auth.session.bin")?.account, "session")
        XCTAssertEqual(ElectronMigration.target(forSecret: "auth.session.abc_1.bin")?.account, "session.abc_1")
        XCTAssertEqual(ElectronMigration.target(forSecret: "auth.session.abc_1.bin")?.service, "com.folevi.shell-auth")
        XCTAssertEqual(ElectronMigration.target(forSecret: "ai.anthropic.bin")?.service, "com.folevi.shell-secrets")
        XCTAssertNil(ElectronMigration.target(forSecret: "auth.session.../x.bin"))
        XCTAssertNil(ElectronMigration.target(forSecret: "ai.other.bin"))
        XCTAssertNil(ElectronMigration.target(forSecret: "notes.txt"))
    }

    // MARK: the whole migration

    func testTheElectronFolderMovesOver() async throws {
        let (folder, library) = try electronFolder()
        let keychain = MemoryKeychain()
        let m = migration(folder, keychain: keychain)
        var scheduled: [String] = []
        m.schedule = { id, _, _, _, _ in scheduled.append(id) }
        XCTAssertTrue(m.hasElectronData)
        XCTAssertTrue(m.isNeeded)
        XCTAssertTrue(m.hasSealed)
        for step in ElectronMigration.Step.allCases { try await m.run(step) }
        let e = expected
        let user = e["user"] as! String

        // Sign-ins, the Foli AI key and Dropbox, under the shared services' names; the unknown file left alone.
        for (account, value) in e["sessions"] as! [String: String] {
            XCTAssertEqual(keychain.get("com.folevi.shell-auth", account), Data(value.utf8), account)
        }
        XCTAssertEqual(keychain.get("com.folevi.shell-secrets", "ai.openai"), Data((e["ai"] as! [String: String])["ai.openai"]!.utf8))
        let dropbox = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(keychain.get("com.folevi.cloud-tokens", "dropbox"))) as? [String: Any])
        XCTAssertEqual(dropbox["accessToken"] as? String, "test-dropbox-access")
        XCTAssertEqual(dropbox["refreshToken"] as? String, "test-dropbox-refresh")
        XCTAssertEqual(dropbox["expiresAt"] as? Double, 1_900_000_000_000)
        XCTAssertEqual(defaults.string(forKey: "folevi.cloud.provider"), "dropbox")
        XCTAssertEqual(defaults.string(forKey: "folevi.cloud.account"), "test@example.com")
        XCTAssertEqual(keychain.items.count, 7)

        // Device keys: the same ids and keys, as E2eeKeys keeps them.
        for (account, d) in e["devices"] as! [String: [String: String]] {
            let item = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(keychain.get("com.folevi.e2ee", account))) as? [String: Any])
            XCTAssertEqual(item["version"] as? Int, 1)
            XCTAssertEqual(item["deviceId"] as? String, d["deviceId"])
            let x = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: XCTUnwrap(Data(base64Encoded: item["x"] as! String)))
            let ed = try Curve25519.Signing.PrivateKey(rawRepresentation: XCTUnwrap(Data(base64Encoded: item["ed"] as! String)))
            XCTAssertEqual(Self.b64u(x.publicKey.rawRepresentation), d["x25519Pub"])
            XCTAssertEqual(Self.b64u(ed.publicKey.rawRepresentation), d["ed25519Pub"])
        }
        XCTAssertTrue(defaults.bool(forKey: "e2ee.faceId"))
        let lib = e["libraryKey"] as! [String: String]
        XCTAssertEqual(keychain.get("com.folevi.library-key", lib["libraryId"]!), Data(lib["key"]!.utf8))

        // The library: a bookmark to the chosen folder, the library inside it, the job carried over; Electron's file kept.
        let stored = try JSONDecoder().decode(LibraryService.Stored.self, from: Data(contentsOf: folder.appendingPathComponent("library.json")))
        XCTAssertEqual(stored.kind, "folder")
        XCTAssertEqual(stored.libraryId, lib["libraryId"])
        XCTAssertEqual(stored.sub, "Folevi Library")
        XCTAssertEqual(stored.encryptionJob, "encrypt")
        var stale = false
        let resolved = try URL(resolvingBookmarkData: XCTUnwrap(Data(base64Encoded: XCTUnwrap(stored.bookmark))), options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        XCTAssertEqual(resolved.resolvingSymlinksInPath().path, library.resolvingSymlinksInPath().path)
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("library.electron.json").path))
        // Electron's journal (written by its own journal.ts) is the native one's, read as it is.
        let journal = LibraryJournal(url: folder.appendingPathComponent("library/journal-\(lib["libraryId"]!).bin"))
        XCTAssertEqual(journal.records().map { String(decoding: $0, as: UTF8.self) }, e["journal"] as? [String])
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("Cloud libraries (previous)/Dropbox/notes/one.md").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("Cloud libraries").path))
        // places.json is read as it is.
        let places = try JSONDecoder().decode(ShellPlaces.State.self, from: Data(contentsOf: folder.appendingPathComponent("places.json")))
        XCTAssertEqual(places.current, "acct:\(user)")
        XCTAssertEqual(places.accounts.map(\.userId), [user])
        XCTAssertTrue(places.library)

        // Settings, the mode, the window, reminders (only the one still to come; the shown one isn't shown again).
        let page = try XCTUnwrap(defaults.dictionary(forKey: ElectronMigration.desktopSettingsKey))
        XCTAssertEqual(page["quickAddShortcut"] as? String, "Command+Shift+K")
        XCTAssertEqual(page["openAtLogin"] as? Bool, false)
        XCTAssertEqual(page["menuBarIcon"] as? Bool, false)
        XCTAssertEqual(page["notifications"] as? Bool, true)
        XCTAssertNil(page["mode"])
        XCTAssertEqual(defaults.string(forKey: "folevi.shell.mode"), "account")
        XCTAssertEqual(scheduled, ["r-future"])
        XCTAssertTrue(defaults.stringArray(forKey: "folevi.local.shown")?.contains("r-shown@1700000000") == true)
        XCTAssertEqual(ElectronMigration.firstWindowFrame(m.record, primaryScreenHeight: 1000), NSRect(x: 100, y: 120, width: 1200, height: 800))
        XCTAssertTrue(defaults.bool(forKey: "folevi.installed"))

        // Every step said what it did; again changes nothing (and never overwrites what the native app has).
        for step in ElectronMigration.Step.allCases { XCTAssertEqual(m.state(step)?.state, "done", step.rawValue) }
        keychain.items["com.folevi.shell-auth|session"] = Data("newer".utf8)
        let before = keychain.items
        for step in ElectronMigration.Step.allCases { try await m.run(step) }
        XCTAssertEqual(keychain.items, before)
        XCTAssertTrue(m.isNeeded)
        m.finish()
        XCTAssertFalse(m.isNeeded)
    }

    func testMovedKeysWorkThroughTheSharedServices() async throws {
        // Into this run's own Keychain names (com.folevi.dev.<run>.*), read back by E2eeKeys, ShellAuth and ShellSecrets.
        let (folder, _) = try electronFolder()
        let m = migration(folder, keychain: SharedKeychain())
        let user = expected["user"] as! String
        defer {
            E2eeKeys.forget(userId: user)
            ShellPlaces.$acting.withValue(ShellPlaces.library) { E2eeKeys.shared.reset() }
            ShellAuth.shared.setToken(nil, for: user)
            ShellAuth.shared.setToken(nil, for: nil)
            try? ShellSecrets.delete("ai.openai")
            Keychain.delete("com.folevi.library-key", (expected["libraryKey"] as! [String: String])["libraryId"]!)
            Keychain.delete("com.folevi.cloud-tokens", "dropbox")
        }
        // Nothing of an earlier run in the way (the migration never overwrites what the native app holds).
        for name in ["session.\(user)", "session"] { Keychain.delete("com.folevi.shell-auth", name) }
        for name in ["device.\(user)", "device"] { Keychain.delete("com.folevi.e2ee", name) }
        try? ShellSecrets.delete("ai.openai")
        Keychain.delete("com.folevi.cloud-tokens", "dropbox")
        try await m.run(.sessions)
        try await m.run(.keys)
        let devices = expected["devices"] as! [String: [String: String]]
        let account = try ShellPlaces.$acting.withValue("acct:\(user)") { try E2eeKeys.shared.deviceKeys() }
        XCTAssertEqual(account.deviceId, devices["device.\(user)"]?["deviceId"])
        XCTAssertEqual(Self.b64u(account.x25519Pub), devices["device.\(user)"]?["x25519Pub"])
        let library = try ShellPlaces.$acting.withValue(ShellPlaces.library) { try E2eeKeys.shared.deviceKeys() }
        XCTAssertEqual(library.deviceId, devices["device"]?["deviceId"])
        XCTAssertEqual(ShellAuth.shared.token(for: user), (expected["sessions"] as! [String: String])["session.\(user)"])
        XCTAssertTrue(ShellSecrets.has("ai.openai"))
    }

    func testKeysThatDontMatchTheirPublicHalvesAreRefused() async throws {
        let (folder, _) = try electronFolder()
        let file = folder.appendingPathComponent("e2ee/device.json")
        var meta = try json(file)
        meta["x25519Pub"] = Self.b64u(Curve25519.KeyAgreement.PrivateKey().publicKey.rawRepresentation)
        try JSONSerialization.data(withJSONObject: meta).write(to: file)
        let keychain = MemoryKeychain()
        let m = migration(folder, keychain: keychain)
        do {
            try await m.run(.keys)
            XCTFail("a swapped device.json was accepted")
        } catch let f as ElectronMigration.Failure {
            XCTAssertTrue(f.message.contains("don't match"), f.message)
        }
        XCTAssertNil(keychain.get("com.folevi.e2ee", "device"))
        XCTAssertEqual(m.state(.keys)?.state, "failed")
        m.continueWithout(.keys, because: "test")
        XCTAssertEqual(m.state(.keys)?.state, "continued")
    }

    func testWithoutTheKeysASealedStepStopsAndSaysWhy() async throws {
        let (folder, _) = try electronFolder()
        let m = migration(folder, keychain: MemoryKeychain(), sealer: .none)
        m.schedule = { _, _, _, _, _ in }
        do {
            try await m.run(.sessions)
            XCTFail("sessions moved without a key")
        } catch let f as ElectronMigration.Failure {
            XCTAssertFalse(f.needsPermission)
        }
        // A step with nothing sealed in it goes on.
        try await m.run(.settings)
        XCTAssertEqual(m.state(.settings)?.state, "done")
        // Another app's throwaway item, if it existed, would be read without a prompt or not at all.
        let other = migration(folder, keychain: MemoryKeychain(), sealer: .keychain(SafeStorage.Item(appName: "Folevi Missing \(UUID().uuidString)")))
        XCTAssertThrowsError(try other.sealingKey(allowPrompt: false).get())
    }

    func testAFolderWithoutElectronIsLeftAlone() throws {
        let folder = scratch.appendingPathComponent("Native", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data(#"{"v":1,"kind":"device","libraryId":"L1"}"#.utf8).write(to: folder.appendingPathComponent("library.json"))
        try Data("{}".utf8).write(to: folder.appendingPathComponent("places.json"))
        let m = migration(folder, keychain: MemoryKeychain())
        XCTAssertFalse(m.hasElectronData)
        XCTAssertFalse(m.isNeeded)
    }

    func testLibraryPlacesMapToTheNativeKinds() throws {
        let m = migration(scratch, keychain: MemoryKeychain())
        let docs = scratch.appendingPathComponent("home/Documents/Folevi Library")
        XCTAssertEqual(try m.place(kind: "device", path: docs.path, chosenFolder: nil).kind, "device")
        XCTAssertEqual(try m.place(kind: "icloud", path: m.iCloudDocuments.path, chosenFolder: nil).kind, "icloud")
        XCTAssertEqual(try m.place(kind: "dropbox", path: "/anything", chosenFolder: nil).kind, "dropbox")
        // "On this Mac" somewhere else is a folder library, kept where it is; a missing folder stops the step.
        let elsewhere = scratch.appendingPathComponent("Elsewhere")
        try FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
        let p = try m.place(kind: "device", path: elsewhere.path, chosenFolder: nil)
        XCTAssertEqual(p.kind, "folder")
        XCTAssertEqual(p.sub, "")
        XCTAssertThrowsError(try m.place(kind: "folder", path: scratch.appendingPathComponent("Gone").path, chosenFolder: nil))
    }

    func testTheCleanUpWaitsThirtyDaysAndKeepsTheLibrary() async throws {
        let (folder, _) = try electronFolder()
        let m = migration(folder, keychain: MemoryKeychain())
        m.schedule = { _, _, _, _, _ in }
        var clock = Date(timeIntervalSince1970: 1_800_000_000)
        m.now = { clock }
        for step in ElectronMigration.Step.allCases { try await m.run(step) }
        m.finish()
        XCTAssertEqual(m.cleanUpIfDue(), [])
        clock = clock.addingTimeInterval(31 * 86_400)
        let removed = Set(m.cleanUpIfDue())
        XCTAssertTrue(removed.isSuperset(of: ["Partitions", "Local State", "secrets", "e2ee", "library-keys", "cloud-tokens.bin", "settings.json", "library.electron.json", "Cloud libraries (previous)"]), "\(removed)")
        for kept in ["library.json", "places.json", "lock.json", "library", "migration.json"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent(kept).path), kept)
        }
        XCTAssertEqual(m.cleanUpIfDue(), [])
    }

    // MARK: offline changes

    func testEditsLeftInChromiumAreNotAStep() async throws {
        // No Electron release wrote a handover: the four steps are the whole migration, and Chromium's storage
        // (where unsent edits would be) is only kept for the 30 days, never read.
        XCTAssertEqual(ElectronMigration.Step.allCases, [.sessions, .keys, .library, .settings])
        let (folder, _) = try electronFolder()
        let m = migration(folder, keychain: MemoryKeychain())
        m.schedule = { _, _, _, _, _ in }
        XCTAssertTrue(m.isNeeded)
        for step in ElectronMigration.Step.allCases { try await m.run(step) }
        m.finish()
        XCTAssertFalse(m.isNeeded)
        XCTAssertNil(m.record?.steps["offline"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("Partitions").path))
    }
}
