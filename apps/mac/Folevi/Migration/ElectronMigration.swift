// The first launch after Folevi for Mac moved from Electron to its own engine (docs/MAC_WEBKIT_PLAN.md §8): what the
// old app kept in Application Support/Folevi (its `userData`, the release build's support folder too) becomes the
// native app's, once, before any window opens. Each step is idempotent and can be tried again; nothing of Electron's
// is deleted until 30 days after a finished migration, and then only what moved (`cleanUpIfDue`).
//
// | Step            | Electron (userData/...)                                     | Native                                     |
// | sessions        | secrets/auth.session[.<user id>].bin, secrets/ai.*.bin,      | Keychain com.folevi.shell-auth            |
// |                 | cloud-tokens.bin, cloud-connection.json                     | session[.<user id>], shell-secrets ai.*,  |
// |                 |                                                             | cloud-tokens <provider>, folevi.cloud.*   |
// | keys            | e2ee/device.{bin,json}, e2ee/accounts/<user id>/..., prefs   | Keychain com.folevi.e2ee device[.<id>],   |
// |                 | library-keys/<library id>.key                               | e2ee.faceId; library-key <library id>     |
// | library         | library.json { kind, path, chosenFolder?, move?, job? }     | library.json { kind, bookmark?, sub?, ... }|
// |                 | places.json, library/journal-<id>.bin                       | the same files (one format on both)       |
// | settings        | settings.json, window.json, reminders.json                  | the app's defaults, the first window's    |
// |                 |                                                             | frame, the system's pending notifications |
//
// Edits the Electron app hadn't sent yet stay in Chromium's storage, which WebKit can't read: no Electron release
// ever wrote them out for this app (the 1.22 handover was dropped before shipping), so there's nothing to move.
// Chromium's folders are kept for 30 days like the rest, and "Folevi (previous).app" can still send them.
//
// Sealed values (safeStorage, SafeStorage.swift) are decrypted, stored, read back and compared before a step counts
// as done. E2EE device keys keep their device id (`mac-<ulid>`) and are checked against the public halves in
// device.json, so the server keeps recognising this Mac. A step that can't finish says why, and the person can try
// again or go on without it (sign in again, approve the Mac again): the old files stay where they are.
//
// Which Keychain item opens the sealed values: the release app reads "Folevi Safe Storage" (Electron's; macOS hands
// it over without asking, R1). A Debug build or a FOLEVI_USER_DATA run never touches it: FOLEVI_SAFE_STORAGE=mock
// opens a folder made by Electron with --use-mock-keychain, FOLEVI_SAFE_STORAGE=<name> a throwaway
// "<name> Safe Storage" item, and without it the sealed steps say they can't run here.
import AppKit
import CryptoKit
import Foundation

/// Where secrets go: the shared Keychain helper (this build's service names), or memory in tests.
protocol MigrationKeychain {
    func get(_ service: String, _ account: String) -> Data?
    func set(_ service: String, _ account: String, _ data: Data) -> Bool
}

struct SharedKeychain: MigrationKeychain {
    func get(_ service: String, _ account: String) -> Data? { Keychain.get(service, account) }
    func set(_ service: String, _ account: String, _ data: Data) -> Bool { Keychain.set(service, account, data) }
}

final class ElectronMigration {
    enum Step: String, CaseIterable, Codable {
        case sessions, keys, library, settings

        var title: String {
            switch self {
            case .sessions: return "Sign-ins"
            case .keys: return "Encryption keys"
            case .library: return "Library"
            case .settings: return "Settings"
            }
        }
    }

    /// Where the old app's sealing key comes from.
    enum Sealer: Equatable {
        case keychain(SafeStorage.Item)
        /// Electron run with --use-mock-keychain (tests and fixtures): Chromium's fixed mock password.
        case mock
        /// Nothing sealed can be opened in this run.
        case none
    }

    struct StepRecord: Codable, Equatable {
        /// "done", "skipped" (nothing to move), "failed", or "continued" (the person went on without it).
        var state: String
        var detail: String
        var at: Double
    }

    struct Record: Codable, Equatable {
        var v = 1
        var startedAt: Double
        var finishedAt: Double?
        var steps: [String: StepRecord] = [:]
        /// The old main window's frame as Electron saved it (top-left origin, points).
        var window: [String: Double]?
        var windowMaximized: Bool?
        var electronVersion: String?
        var cleanedUpAt: Double?
    }

    struct Failure: Error, Equatable {
        /// What happened, for the migration screen.
        let message: String
        /// The Keychain asked first (the screen explains, then asks with the prompt allowed).
        var needsPermission = false
    }

    static let mockPassword = Data("mock_password".utf8)
    static let keepDays: Double = 30

    let folder: URL
    let keychain: MigrationKeychain
    let defaults: UserDefaults
    let sealer: Sealer
    /// ~ (iCloud Drive's container lives under it).
    let home: URL
    /// Where a library "on this Mac" lives for this build (Platform.documentsFolder).
    let documents: URL
    /// Schedules a reminder with the system (ShellNotify, tests: a list).
    var schedule: (_ id: String, _ at: Date, _ title: String, _ body: String, _ path: String) async -> Void = { id, at, title, body, path in
        try? await ShellNotify.schedule(id: id, at: at, title: title, body: body, path: path)
    }
    var now: () -> Date = Date.init

    private var key: Data?

    init(folder: URL, keychain: MigrationKeychain, defaults: UserDefaults, sealer: Sealer, home: URL, documents: URL) {
        self.folder = folder
        self.keychain = keychain
        self.defaults = defaults
        self.sealer = sealer
        self.home = home
        self.documents = documents
    }

    /// This build's migration: the support folder (Electron's userData for the release app), the shared Keychain.
    static func forThisApp() -> ElectronMigration {
        ElectronMigration(folder: Paths.supportFolder, keychain: SharedKeychain(), defaults: Paths.defaults, sealer: sealerForThisRun,
                          home: FileManager.default.homeDirectoryForCurrentUser, documents: Paths.documentsFolder)
    }

    /// The release app reads Electron's own item; every other run only what FOLEVI_SAFE_STORAGE names.
    static var sealerForThisRun: Sealer {
        if !Paths.isDebug && Paths.userDataOverride == nil { return .keychain(SafeStorage.folevi) }
        let name = (ProcessInfo.processInfo.environment["FOLEVI_SAFE_STORAGE"] ?? "").trimmingCharacters(in: .whitespaces)
        if name == "mock" { return .mock }
        if !name.isEmpty, name != "Folevi", name.range(of: #"^[A-Za-z0-9 ._-]{1,64}$"#, options: .regularExpression) != nil { return .keychain(SafeStorage.Item(appName: name)) }
        return .none
    }

    // MARK: files

    private let fm = FileManager.default
    private func url(_ rel: String) -> URL { folder.appendingPathComponent(rel) }
    private func exists(_ rel: String) -> Bool { fm.fileExists(atPath: url(rel).path) }
    private func data(_ rel: String) -> Data? { try? Data(contentsOf: url(rel)) }
    private func json(_ rel: String) -> [String: Any]? { data(rel).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }

    private func write(_ rel: String, _ d: Data) throws {
        let target = url(rel)
        try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try d.write(to: target, options: .atomic)
    }

    private var recordFile: URL { url("migration.json") }

    var record: Record? {
        get { (try? Data(contentsOf: recordFile)).flatMap { try? JSONDecoder().decode(Record.self, from: $0) } }
        set {
            guard let newValue, let d = try? JSONEncoder().encode(newValue) else { return }
            try? d.write(to: recordFile, options: .atomic)
        }
    }

    /// Something only the Electron app writes is here: Chromium's own files, or Folevi's sealed folders.
    var hasElectronData: Bool {
        for marker in ["Local State", "Partitions", "secrets", "e2ee", "library-keys", "settings.json", "cloud-tokens.bin"] where exists(marker) { return true }
        return (json("library.json")?["path"] as? String) != nil
    }

    /// There's an Electron folder here that hasn't been migrated (or a migration that didn't finish).
    var isNeeded: Bool { hasElectronData && record?.finishedAt == nil }

    func state(_ step: Step) -> StepRecord? { record?.steps[step.rawValue] }

    private func note(_ step: Step, _ state: String, _ detail: String) {
        var r = record ?? Record(startedAt: now().timeIntervalSince1970)
        r.steps[step.rawValue] = StepRecord(state: state, detail: detail, at: now().timeIntervalSince1970)
        record = r
    }

    /// The person went on without a step (it stays as it is; nothing of Electron's is removed for it).
    func continueWithout(_ step: Step, because: String) { note(step, "continued", because) }

    /// Every step has an answer: the migration is over (the windows open, and the 30 days start).
    func finish() {
        var r = record ?? Record(startedAt: now().timeIntervalSince1970)
        r.finishedAt = now().timeIntervalSince1970
        record = r
    }

    // MARK: the sealing key

    /// Whether anything here was sealed with safeStorage (only then is the Keychain asked at all).
    var hasSealed: Bool {
        if exists("cloud-tokens.bin") { return true }
        for dir in ["secrets", "library-keys"] where !((try? fm.contentsOfDirectory(atPath: url(dir).path)) ?? []).isEmpty { return true }
        return !e2eeFolders().isEmpty
    }

    /// The key Electron sealed with. With `allowPrompt` false nothing is ever shown.
    func sealingKey(allowPrompt: Bool) -> Result<Data, Failure> {
        if let key { return .success(key) }
        switch sealer {
        case .none:
            return .failure(Failure(message: "This test run can't open the previous app's saved keys (set FOLEVI_SAFE_STORAGE)."))
        case .mock:
            key = SafeStorage.key(password: Self.mockPassword)
        case .keychain(let item):
            switch SafeStorage.password(item, allowPrompt: allowPrompt) {
            case .success(let password): key = SafeStorage.key(password: password)
            case .failure(.needsPermission): return .failure(Failure(message: "macOS needs your permission for Folevi to use its saved keys.", needsPermission: true))
            case .failure(.notFound): return .failure(Failure(message: "The previous Folevi's saved keys aren't in this Mac's Keychain."))
            case .failure(.denied): return .failure(Failure(message: "Folevi wasn't allowed to use its saved keys."))
            case .failure(.failed(let status)): return .failure(Failure(message: "The Keychain couldn't be read (error \(status))."))
            }
        }
        return .success(key!)
    }

    private func open(_ rel: String, _ key: Data) throws -> Data {
        guard let blob = data(rel) else { throw Failure(message: "\(rel) can't be read.") }
        do {
            return try SafeStorage.decrypt(blob, key: key)
        } catch {
            throw Failure(message: "\(rel) can't be opened with this Mac's saved keys.")
        }
    }

    /// Stores a secret unless the native app already holds one there (then that one stays: it's newer), and reads
    /// it back.
    private func store(_ service: String, _ account: String, _ value: Data) throws {
        if keychain.get(service, account) != nil { return }
        guard keychain.set(service, account, value), keychain.get(service, account) == value else {
            throw Failure(message: "The Keychain didn't keep \(account).")
        }
    }

    // MARK: running the steps

    /// Runs one step (again). Throws a Failure the screen shows; `allowPrompt` lets macOS ask for the Keychain.
    func run(_ step: Step, allowPrompt: Bool = false) async throws {
        // The Keychain outlives the app: the shared helper wipes this build's items on what it takes for a first
        // install (Keychain.forgetAfterReinstall). This is a move, not a reinstall: what's written here stays.
        defaults.set(true, forKey: "folevi.installed")
        do {
            let detail: String?
            switch step {
            case .sessions: detail = try moveSessions(allowPrompt: allowPrompt)
            case .keys: detail = try moveKeys(allowPrompt: allowPrompt)
            case .library: detail = try moveLibrary()
            case .settings: detail = await moveSettings()
            }
            if let detail { note(step, "done", detail) } else { note(step, "skipped", "Nothing to move.") }
        } catch let f as Failure {
            note(step, "failed", f.message)
            throw f
        }
    }

    // MARK: sessions, Foli AI keys, cloud tokens

    static let authService = "com.folevi.shell-auth"
    static let secretsService = "com.folevi.shell-secrets"
    static let cloudService = "com.folevi.cloud-tokens"
    private static let idPattern = #"^[A-Za-z0-9_-]{1,64}$"#
    private static let aiNames: Set<String> = ["ai.openai", "ai.anthropic", "ai.google"]

    /// Where a secrets/<name>.bin goes in the Keychain, or nil for a file Folevi doesn't know.
    static func target(forSecret file: String) -> (service: String, account: String)? {
        guard file.hasSuffix(".bin") else { return nil }
        let name = String(file.dropLast(4))
        if name == "auth.session" { return (authService, "session") }
        if name.hasPrefix("auth.session.") {
            let user = String(name.dropFirst("auth.session.".count))
            return user.range(of: idPattern, options: .regularExpression) != nil ? (authService, "session.\(user)") : nil
        }
        return aiNames.contains(name) ? (secretsService, name) : nil
    }

    private func moveSessions(allowPrompt: Bool) throws -> String? {
        let files = ((try? fm.contentsOfDirectory(atPath: url("secrets").path)) ?? []).sorted().filter { Self.target(forSecret: $0) != nil }
        let hasCloud = exists("cloud-tokens.bin")
        guard !files.isEmpty || hasCloud else { return nil }
        let key = try sealingKey(allowPrompt: allowPrompt).get()
        var sessions = 0, aiKeys = 0, clouds: [String] = []
        for file in files {
            let t = Self.target(forSecret: file)!
            let value = try open("secrets/\(file)", key)
            guard !value.isEmpty, value.count <= 16 * 1024 else { continue }
            try store(t.service, t.account, value)
            if t.service == Self.authService { sessions += 1 } else { aiKeys += 1 }
        }
        if hasCloud {
            // { dropbox?: TokenSet, googleDrive?: TokenSet }: the same fields ShellCloud keeps per provider.
            let all = (try? JSONSerialization.jsonObject(with: try open("cloud-tokens.bin", key))) as? [String: Any] ?? [:]
            for p in ["dropbox", "googleDrive"] {
                guard let t = all[p] as? [String: Any], let access = t["accessToken"] as? String, let expires = (t["expiresAt"] as? NSNumber)?.doubleValue else { continue }
                var tokens: [String: Any] = ["accessToken": access, "expiresAt": expires]
                if let refresh = t["refreshToken"] as? String { tokens["refreshToken"] = refresh }
                try store(Self.cloudService, p, try JSONSerialization.data(withJSONObject: tokens, options: [.sortedKeys]))
                clouds.append(p)
            }
            if let c = json("cloud-connection.json"), let p = c["provider"] as? String, clouds.contains(p), defaults.string(forKey: "folevi.cloud.provider") == nil {
                defaults.set(p, forKey: "folevi.cloud.provider")
                if let account = c["account"] as? String { defaults.set(account, forKey: "folevi.cloud.account") }
            }
        }
        var parts: [String] = []
        if sessions > 0 { parts.append(sessions == 1 ? "1 sign-in" : "\(sessions) sign-ins") }
        if aiKeys > 0 { parts.append(aiKeys == 1 ? "1 Foli AI key" : "\(aiKeys) Foli AI keys") }
        if !clouds.isEmpty { parts.append(clouds.map { ShellCloud.name($0) }.joined(separator: " and ")) }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    // MARK: E2EE device keys and library keys

    static let e2eeService = "com.folevi.e2ee"
    static let libraryKeyService = "com.folevi.library-key"

    /// e2ee/ (the library's and older builds' pair) and e2ee/accounts/<user id>/ (each account's), with their
    /// Keychain accounts ("device", "device.<user id>").
    func e2eeFolders() -> [(rel: String, account: String)] {
        var out: [(String, String)] = []
        if exists("e2ee/device.json") && exists("e2ee/device.bin") { out.append(("e2ee", "device")) }
        for user in ((try? fm.contentsOfDirectory(atPath: url("e2ee/accounts").path)) ?? []).sorted() where user.range(of: Self.idPattern, options: .regularExpression) != nil {
            if exists("e2ee/accounts/\(user)/device.json") && exists("e2ee/accounts/\(user)/device.bin") { out.append(("e2ee/accounts/\(user)", "device.\(user)")) }
        }
        return out
    }

    static func fromB64u(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        return Data(base64Encoded: t)
    }

    static func b64u(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// One Electron device key pair as E2eeKeys keeps it ({ version, deviceId, x, ed }, standard base64), after
    /// checking each private half gives the public half device.json names (as e2ee.ts does).
    func deviceKeyItem(_ rel: String, key: Data) throws -> (deviceId: String, item: Data) {
        guard let meta = json("\(rel)/device.json"), meta["version"] as? Int == 1, let deviceId = meta["deviceId"] as? String,
              let xPub = meta["x25519Pub"] as? String, let edPub = meta["ed25519Pub"] as? String,
              deviceId.range(of: #"^[A-Za-z0-9_-]{1,80}$"#, options: .regularExpression) != nil else {
            throw Failure(message: "\(rel)/device.json isn't a Folevi device key file.")
        }
        var inner = try open("\(rel)/device.bin", key)
        defer { inner.resetBytes(in: 0..<inner.count) }
        guard let obj = try? JSONSerialization.jsonObject(with: inner) as? [String: Any], let xs = obj["x"] as? String, let eds = obj["ed"] as? String,
              var xRaw = Self.fromB64u(xs), var edRaw = Self.fromB64u(eds) else {
            throw Failure(message: "\(rel)/device.bin isn't a Folevi device key file.")
        }
        defer {
            xRaw.resetBytes(in: 0..<xRaw.count)
            edRaw.resetBytes(in: 0..<edRaw.count)
        }
        guard let x = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: xRaw), let ed = try? Curve25519.Signing.PrivateKey(rawRepresentation: edRaw),
              Self.b64u(x.publicKey.rawRepresentation) == xPub, Self.b64u(ed.publicKey.rawRepresentation) == edPub else {
            throw Failure(message: "The encryption keys in \(rel) don't match their public halves.")
        }
        let stored: [String: Any] = ["version": 1, "deviceId": deviceId, "x": xRaw.base64EncodedString(), "ed": edRaw.base64EncodedString()]
        return (deviceId, try JSONSerialization.data(withJSONObject: stored, options: [.sortedKeys]))
    }

    private func moveKeys(allowPrompt: Bool) throws -> String? {
        let folders = e2eeFolders()
        let libraryKeys = ((try? fm.contentsOfDirectory(atPath: url("library-keys").path)) ?? []).sorted().filter {
            $0.hasSuffix(".key") && LibraryPaths.isValidId(String($0.dropLast(4)))
        }
        guard !folders.isEmpty || !libraryKeys.isEmpty else { return nil }
        let key = try sealingKey(allowPrompt: allowPrompt).get()
        var devices: [String] = []
        var touchId = false
        for f in folders {
            let made = try deviceKeyItem(f.rel, key: key)
            try store(Self.e2eeService, f.account, made.item)
            devices.append(made.deviceId)
            if (json("\(f.rel)/prefs.json")?["touchId"] as? Bool) == true { touchId = true }
        }
        if touchId && defaults.object(forKey: "e2ee.faceId") == nil { defaults.set(true, forKey: "e2ee.faceId") }
        var libraries = 0
        for file in libraryKeys {
            let id = String(file.dropLast(4))
            let value = try open("library-keys/\(file)", key)
            guard let text = String(data: value, encoding: .utf8), Data(base64Encoded: text)?.count == 32 else {
                throw Failure(message: "The saved key of library \(id) isn't a library key.")
            }
            try store(Self.libraryKeyService, id, Data(text.utf8))
            libraries += 1
        }
        var parts: [String] = []
        if !devices.isEmpty { parts.append("this Mac's device keys (\(devices.joined(separator: ", ")))") }
        if libraries > 0 { parts.append(libraries == 1 ? "1 library key" : "\(libraries) library keys") }
        return parts.joined(separator: ", ")
    }

    // MARK: the library

    /// The iCloud container's Documents folder ("Sync with iCloud", shared with the iPhone and iPad).
    var iCloudDocuments: URL { home.appendingPathComponent("Library/Mobile Documents/iCloud~com~folevi/Documents", isDirectory: true) }

    private static func same(_ a: String, _ b: URL) -> Bool {
        URL(fileURLWithPath: a).standardizedFileURL.resolvingSymlinksInPath().path == b.standardizedFileURL.resolvingSymlinksInPath().path
    }

    private func bookmark(_ path: String) throws -> String {
        let u = URL(fileURLWithPath: path, isDirectory: true)
        guard fm.fileExists(atPath: u.path), let d = try? u.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else {
            throw Failure(message: "The library's folder (\((path as NSString).abbreviatingWithTildeInPath)) can't be reached. Connect its disk and try again.")
        }
        return d.base64EncodedString()
    }

    /// Electron's { kind, path, chosenFolder? } as the native { kind, bookmark?, sub? }.
    func place(kind: String, path: String, chosenFolder: String?) throws -> (kind: String, bookmark: String?, sub: String?) {
        switch kind {
        case "device" where Self.same(path, documents.appendingPathComponent(LibraryService.deviceFolder, isDirectory: true)):
            return ("device", nil, nil)
        case "icloud" where Self.same(path, iCloudDocuments):
            return ("icloud", nil, nil)
        case "dropbox", "gdrive":
            return (kind, nil, nil)
        case "folder":
            if let chosen = chosenFolder {
                if Self.same(path, URL(fileURLWithPath: chosen)) { return ("folder", try bookmark(chosen), "") }
                if Self.same(path, URL(fileURLWithPath: chosen).appendingPathComponent(LibraryService.deviceFolder)) { return ("folder", try bookmark(chosen), LibraryService.deviceFolder) }
            }
            return ("folder", try bookmark(path), "")
        case "device", "icloud":
            // "On this Mac" somewhere else (a test run), or the older iCloud Drive folder (com~apple~CloudDocs/Folevi):
            // the same files, kept where they are.
            return ("folder", try bookmark(path), "")
        default:
            throw Failure(message: "library.json names a kind of library Folevi doesn't know (\(kind)).")
        }
    }

    private func moveLibrary() throws -> String? {
        var parts: [String] = []
        if let raw = json("library.json"), let path = raw["path"] as? String, let kind = raw["kind"] as? String, let id = raw["libraryId"] as? String, LibraryPaths.isValidId(id) {
            let p = try place(kind: kind, path: path, chosenFolder: raw["chosenFolder"] as? String)
            var out: [String: Any] = ["v": 1, "kind": p.kind, "libraryId": id]
            if let b = p.bookmark { out["bookmark"] = b }
            if let s = p.sub { out["sub"] = s }
            if let mv = raw["move"] as? [String: Any], let mk = mv["kind"] as? String, let mp = mv["path"] as? String {
                // A half-done move goes on from where it was (LibraryService.open finishes it); its target may be gone.
                if let t = try? place(kind: mk, path: mp, chosenFolder: mv["chosenFolder"] as? String) {
                    var m: [String: Any] = ["kind": t.kind]
                    if let b = t.bookmark { m["bookmark"] = b }
                    if let s = t.sub { m["sub"] = s }
                    out["move"] = m
                }
            }
            if let job = (raw["encryptionJob"] as? [String: Any])?["direction"] as? String, job == "encrypt" || job == "decrypt" { out["encryptionJob"] = job }
            // Electron's file stays beside it until the clean-up.
            if !exists("library.electron.json"), let old = data("library.json") { try write("library.electron.json", old) }
            try write("library.json", try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]))
            parts.append(p.kind == "folder" ? "a folder library" : p.kind == "icloud" ? "the iCloud library" : p.kind == "device" ? "the library on this Mac" : "the \(p.kind == "dropbox" ? "Dropbox" : "Google Drive") library")
            if exists("library/journal-\(id).bin") { parts.append("its journal") }
        }
        if let d = data("places.json") {
            // One format on both (places.ts and ShellPlaces); a file the native app can't read is left for it to
            // start over from, as a damaged one would be.
            guard let s = try? JSONDecoder().decode(ShellPlaces.State.self, from: d) else { throw Failure(message: "places.json can't be read.") }
            let accounts = s.accounts.count
            if accounts > 0 { parts.append(accounts == 1 ? "1 account" : "\(accounts) accounts") }
        }
        // Electron's copies of a Dropbox or Google Drive library are laid out differently: they go aside (the native
        // app downloads its own), kept until the clean-up.
        if exists("Cloud libraries/Dropbox/.folevi-cloud") || exists("Cloud libraries/Google Drive/.folevi-cloud") {
            if !exists("Cloud libraries (previous)") { try fm.moveItem(at: url("Cloud libraries"), to: url("Cloud libraries (previous)")) }
            parts.append("the cloud library's copy set aside")
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    // MARK: settings, the window, reminders

    /// WM2's DesktopSettings key (the page's four settings, Chrome/DesktopSettings.swift).
    static let desktopSettingsKey = "folevi.desktop.settings"

    private func moveSettings() async -> String? {
        var parts: [String] = []
        if let s = json("settings.json") {
            if defaults.dictionary(forKey: Self.desktopSettingsKey) == nil {
                var page: [String: Any] = [:]
                if let v = s["quickAddShortcut"] as? String { page["quickAddShortcut"] = v }
                for k in ["openAtLogin", "menuBarIcon", "notifications"] { if let v = s[k] as? Bool { page[k] = v } }
                if !page.isEmpty { defaults.set(page, forKey: Self.desktopSettingsKey) }
            }
            if let mode = s["mode"] as? String, mode == "local" || mode == "account", defaults.string(forKey: "folevi.shell.mode") == nil {
                defaults.set(mode, forKey: "folevi.shell.mode")
            }
            parts.append("Quick Add, the menu bar icon and opening at login")
        }
        if let w = json("window.json"), let b = w["bounds"] as? [String: Any], let width = (b["width"] as? NSNumber)?.doubleValue, let height = (b["height"] as? NSNumber)?.doubleValue, width >= 480, height >= 360 {
            var r = record ?? Record(startedAt: now().timeIntervalSince1970)
            var frame = ["width": width, "height": height]
            if let x = (b["x"] as? NSNumber)?.doubleValue, let y = (b["y"] as? NSNumber)?.doubleValue { frame["x"] = x; frame["y"] = y }
            r.window = frame
            r.windowMaximized = w["maximized"] as? Bool
            record = r
            parts.append("the window's place")
        }
        if let r = json("reminders.json") {
            let nowMs = now().timeIntervalSince1970 * 1000
            // Shown ones aren't shown again (ShellNotify's stamps); waiting ones go to the system, past ones are dropped.
            var stamps = defaults.stringArray(forKey: "folevi.local.shown") ?? []
            for s in (r["shown"] as? [[String: Any]]) ?? [] {
                if let id = s["id"] as? String, let at = (s["at"] as? NSNumber)?.doubleValue { stamps.append("\(id)@\(Int(at / 1000))") }
            }
            defaults.set(Array(stamps.suffix(500)), forKey: "folevi.local.shown")
            let waiting = ((r["reminders"] as? [[String: Any]]) ?? []).compactMap { x -> (String, Double, String, String, String)? in
                guard let id = x["id"] as? String, let at = (x["at"] as? NSNumber)?.doubleValue, at > nowMs, let title = x["title"] as? String else { return nil }
                return (id, at, title, x["body"] as? String ?? "", x["path"] as? String ?? "/tasks")
            }.sorted { $0.1 < $1.1 }.prefix(64)
            for w in waiting { await schedule(w.0, Date(timeIntervalSince1970: w.1 / 1000), w.2, w.3, w.4) }
            if !waiting.isEmpty { parts.append(waiting.count == 1 ? "1 reminder" : "\(waiting.count) reminders") }
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// The old main window's frame in AppKit's coordinates (bottom-left origin), for the first window (WM2's
    /// WindowRestore, when it has nothing of its own yet).
    static func firstWindowFrame(_ r: Record?, primaryScreenHeight: CGFloat? = NSScreen.screens.first?.frame.height) -> NSRect? {
        guard let w = r?.window, let width = w["width"], let height = w["height"] else { return nil }
        guard let x = w["x"], let y = w["y"], let screenHeight = primaryScreenHeight else { return NSRect(x: 0, y: 0, width: width, height: height) }
        return NSRect(x: x, y: Double(screenHeight) - y - height, width: width, height: height)
    }

    // MARK: 30 days later

    /// Removes what Electron left once 30 days have passed since a finished migration: Chromium's storage and
    /// caches always, the sealed folders only for the steps that moved them (a step the person went on without
    /// keeps its files). The library, its journal, places.json and lock.json are the native app's and stay.
    @discardableResult
    func cleanUpIfDue() -> [String] {
        guard var r = record, let finished = r.finishedAt, r.cleanedUpAt == nil, now().timeIntervalSince1970 - finished >= Self.keepDays * 86_400 else { return [] }
        var gone = ["Partitions", "Cache", "Code Cache", "GPUCache", "GPUPersistentCache", "GraphiteDawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
                    "blob_storage", "Shared Dictionary", "Trust Tokens", "Trust Tokens-journal", "Local State", "Preferences", "Network Persistent State",
                    "TransportSecurity", "Cookies", "Cookies-journal", "DIPS", "DIPS-wal", "SharedStorage", "Session Storage", "Local Storage", "WebStorage",
                    "Service Worker", "Crashpad", "handoff.json", "window.json", "settings.json", "reminders.json", "library.electron.json",
                    "Cloud libraries (previous)"]
        let done = { (s: Step) in r.steps[s.rawValue]?.state == "done" || r.steps[s.rawValue]?.state == "skipped" }
        if done(.sessions) { gone += ["secrets", "cloud-tokens.bin", "cloud-connection.json"] }
        if done(.keys) { gone += ["e2ee", "library-keys"] }
        var removed: [String] = []
        for rel in gone where exists(rel) {
            if (try? fm.removeItem(at: url(rel))) != nil { removed.append(rel) }
        }
        r.cleanedUpAt = now().timeIntervalSince1970
        record = r
        return removed
    }
}
