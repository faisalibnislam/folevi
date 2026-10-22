// The library behind `foleviShell.library` on iPhone and iPad (docs/LOCAL_MODE_PLAN.md §3, §4.1, §4.3): where it
// is, its files (FolderFS, or EncryptedFS around it), change detection (LibraryWatcher), the journal
// (LibraryJournal), the passphrase and the key (LibraryCrypto, the Keychain), moving it, and attachments for
// folevi-file://. The iOS twin of the Mac's apps/desktop/src/library/service.ts, with the same rules.
//
// Places:
// - "Sync with iCloud": the app's own iCloud container, iCloud.com.folevi, its Documents folder (shown in iCloud
//   Drive and the Files app as "Folevi"). Folevi for Mac uses the same folder
//   (~/Library/Mobile Documents/iCloud~com~folevi/Documents), so the iPhone, the iPad and the Mac share one
//   library.
// - "Choose a folder": any folder the Files app offers (On My iPhone, iCloud Drive, Dropbox, Google Drive,
//   OneDrive and other File Providers), kept as a security-scoped bookmark.
// - "This device only": Documents/Folevi Library (visible in the Files app under On My iPhone > Folevi).
//
// Everything runs on one serial queue, so a move or an encryption switch never overlaps the page's calls.
// The state is library.json in Application Support: { v, kind, libraryId, bookmark?, sub?, move?, encryptionJob? }.
import CryptoKit
import Foundation
import UIKit

final class LibraryService {
    static let shared = LibraryService()
    static let containerId = "iCloud.com.folevi"
    static let deviceFolder = "Folevi Library"

    let queue = DispatchQueue(label: "com.folevi.library", qos: .userInitiated)
    /// Change batches for the page ([{ path, kind }]), called on `queue`.
    var onChanges: (([[String: String]]) -> Void)?

    struct Move: Codable {
        var kind: String
        var bookmark: String?
        var sub: String?
    }

    struct Stored: Codable {
        var v = 1
        var kind: String
        var libraryId: String
        /// "Choose a folder": the folder the person picked, as a bookmark (base64).
        var bookmark: String?
        /// The library inside the picked folder: "" (the folder itself) or "Folevi Library".
        var sub: String?
        var move: Move?
        var encryptionJob: String?
    }

    private var stored: Stored?
    private var base: FolderFS?
    private var enc: EncryptedFS?
    private var manifest: [String: Any]?
    private var manifestEtag: String?
    private var header: LibraryCrypto.Header?
    private var watcher: LibraryWatcher?
    private var journalStore: LibraryJournal?
    private var opened = false
    /// PBKDF2 iterations for a new passphrase (600,000; tests use fewer).
    var iterations = LibraryCrypto.defaultIterations

    private let fm = FileManager.default
    private static let kinds: Set<String> = ["icloud", "folder", "device", "dropbox", "gdrive"]
    static func isCloud(_ kind: String?) -> Bool { kind == "dropbox" || kind == "gdrive" }
    /// A cloud library's files are the provider's, handled by the shared provider code in the bridge.
    static let cloudProvider = ["dropbox": "dropbox", "gdrive": "googleDrive"]
    /// Asks the bridge to bring an attachment of a cloud library into this device's copy (LibraryFileHandler).
    var onCloudWant: ((String) -> Void)?

    // MARK: places on this device

    private static var support: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Folevi", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private var stateFile: URL { Self.support.appendingPathComponent("library.json") }

    static var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    /// The iCloud container's Documents folder, or the reason there's none. Never on the main thread.
    static func iCloudRoot() -> Result<URL, LibraryError> {
        guard FileManager.default.ubiquityIdentityToken != nil else { return .failure(LibraryError(.unavailable, "This device isn't signed in to iCloud, or iCloud Drive is off.", path: "signed_out")) }
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: containerId) else {
            return .failure(LibraryError(.unavailable, "iCloud Drive is turned off for Folevi.", path: "drive_off"))
        }
        let docs = container.appendingPathComponent("Documents", isDirectory: true)
        try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        return .success(docs)
    }

    /// The folder a stored state names (the picked folder's access comes with it), or nil when it can't be reached.
    private func place(kind: String, bookmark: String?, sub: String?) -> (root: URL, scoped: URL?)? {
        switch kind {
        case "device":
            return (Self.documents.appendingPathComponent(Self.deviceFolder, isDirectory: true), nil)
        case "icloud":
            guard case .success(let docs) = Self.iCloudRoot() else { return nil }
            return (docs, nil)
        case "folder":
            guard let b = bookmark, let data = Data(base64Encoded: b) else { return nil }
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
            let root = (sub ?? "").isEmpty ? url : url.appendingPathComponent(sub!, isDirectory: true)
            return (root, url)
        default:
            return nil
        }
    }

    // MARK: state

    private func loadState() -> Stored? {
        guard let data = try? Data(contentsOf: stateFile), let s = try? JSONDecoder().decode(Stored.self, from: data), s.v == 1, Self.kinds.contains(s.kind), LibraryPaths.isValidId(s.libraryId) else { return nil }
        return s
    }

    private func saveState(_ s: Stored?) {
        stored = s
        if let s, let data = try? JSONEncoder().encode(s) {
            try? data.write(to: stateFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } else {
            try? fm.removeItem(at: stateFile)
        }
    }

    /// Forgets the library on this device (several places, docs/MULTI_ACCOUNT_PLAN.md §9): its journal and where it
    /// is go; the folder stays exactly as it is, so setting up the same folder again brings it back. Call on `queue`.
    func forget() {
        let id = stored?.libraryId
        detach()
        journalStore = nil
        if let id { try? fm.removeItem(at: Self.support.appendingPathComponent("library", isDirectory: true).appendingPathComponent("journal-\(id).bin")) }
        saveState(nil)
    }

    /// Loads library.json and opens the library it names; finishes a move or encryption switch left half done.
    func open() {
        guard !opened else { return }
        opened = true
        stored = loadState()
        guard stored != nil else { return }
        if stored?.move != nil { try? finishMove() }
        if base == nil { attach() }
        try? resumeEncryption()
    }

    // MARK: keys

    private func cachedKey(_ libraryId: String) -> Data? {
        Keychain.getString("com.folevi.library-key", libraryId).flatMap { Data(base64Encoded: $0) }
    }

    private func cacheKey(_ libraryId: String, _ key: Data) {
        Keychain.setString("com.folevi.library-key", libraryId, key.base64EncodedString())
    }

    private func forgetKey(_ libraryId: String) {
        Keychain.delete("com.folevi.library-key", libraryId)
    }

    private func key() -> Data? {
        guard let header, let id = manifest?["libraryId"] as? String, let k = cachedKey(id), LibraryCrypto.keyMatches(header, k) else { return nil }
        return k
    }

    // MARK: the manifest

    static func encodeManifest(_ m: [String: Any]) -> Data {
        let data = (try? JSONSerialization.data(withJSONObject: m, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
        return data + Data("\n".utf8)
    }

    static func decodeManifest(_ data: Data) throws -> [String: Any] {
        guard let m = try JSONSerialization.jsonObject(with: data) as? [String: Any], m["format"] as? String == "folevi-library" else { throw LibraryError(.unreadable, "Not a Folevi library.") }
        guard let id = m["libraryId"] as? String, LibraryPaths.isValidId(id), m["createdAt"] is NSNumber, m["minWriterVersion"] is NSNumber else { throw LibraryError(.unreadable, "The library file is missing fields.") }
        var out = m
        if out["v"] == nil { out["v"] = 1 }
        if out["encryption"] == nil { out["encryption"] = NSNull() }
        return out
    }

    static func header(of m: [String: Any]) -> LibraryCrypto.Header? {
        guard let e = m["encryption"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: e) else { return nil }
        return try? JSONDecoder().decode(LibraryCrypto.Header.self, from: data)
    }

    static func headerJSON(_ h: LibraryCrypto.Header) -> [String: Any] {
        ["alg": h.alg, "kdf": ["name": h.kdf.name, "iterations": h.kdf.iterations, "salt": h.kdf.salt], "wrappedKey": h.wrappedKey, "keyCheck": h.keyCheck]
    }

    private func readManifest(_ fs: FolderFS) -> (manifest: [String: Any], etag: String)? {
        guard let r = try? fs.read(LibraryPaths.libraryFile) else { return nil }
        switch r {
        case .notDownloaded:
            try? fs.startDownload([LibraryPaths.libraryFile])
            return nil
        case .bytes(let bytes, let etag):
            guard let m = try? Self.decodeManifest(bytes) else { return nil }
            return (m, etag)
        }
    }

    private func useManifest(_ m: [String: Any], _ etag: String) {
        manifest = m
        manifestEtag = etag
        header = (m["encryption"] is NSNull) ? nil : Self.header(of: m)
        if header != nil, let k = key(), let base { enc = try? EncryptedFS(inner: base, masterKey: k) } else { enc = nil }
    }

    private func attach() {
        detach()
        guard let s = stored, let p = place(kind: s.kind, bookmark: s.bookmark, sub: s.sub) else { return }
        let fs = FolderFS(root: p.root, scoped: p.scoped)
        base = fs
        guard let m = readManifest(fs) else {
            manifest = nil
            return
        }
        if let id = m.manifest["libraryId"] as? String, id != s.libraryId {
            // The folder now holds another library (replaced in the Files app): adopt it, its journal is its own.
            var next = s
            next.libraryId = id
            saveState(next)
            journalStore = nil
        }
        useManifest(m.manifest, m.etag)
        fs.cleanTemp()
        startWatching()
    }

    private func detach() {
        watcher?.stop()
        watcher = nil
        base = nil
        enc = nil
        manifest = nil
        manifestEtag = nil
        header = nil
    }

    private func startWatching() {
        guard let base else { return }
        watcher?.stop()
        watcher = LibraryWatcher(queue: queue, iCloudScope: stored?.kind == "icloud", list: { [weak self] in
            guard let self else { return [] }
            if self.header != nil {
                // Locked: only the library file matters (a passphrase change elsewhere).
                guard let enc = self.enc else { return try base.entry(LibraryPaths.libraryFile).map { [$0] } ?? [] }
                return try enc.list("")
            }
            return try base.list("")
        }, onChanges: { [weak self] changes in self?.changed(changes) })
    }

    private func changed(_ changes: [[String: String]]) {
        if changes.contains(where: { $0["path"] == LibraryPaths.libraryFile }), let base, let m = readManifest(base) {
            // Another device changed the passphrase, or switched encryption on or off.
            let wasEncrypted = header != nil
            useManifest(m.manifest, m.etag)
            if wasEncrypted != (header != nil) { startWatching() }
        }
        onChanges?(changes)
    }

    // MARK: info and setup

    func info() -> [String: Any] {
        guard let s = stored else { return ["kind": "device", "displayPath": "", "available": false, "encrypted": false, "locked": false, "configured": false] }
        // Dropbox and Google Drive: the bridge's provider code says the rest (cloudKit.info).
        if Self.isCloud(s.kind) { return ["kind": s.kind, "displayPath": s.kind == "dropbox" ? "Dropbox" : "Google Drive", "available": true, "encrypted": false, "locked": false, "configured": true] }
        if manifest == nil { attach() }
        let encrypted = header != nil
        return ["kind": s.kind, "displayPath": displayPath(s), "available": base != nil && manifest != nil, "encrypted": encrypted, "locked": encrypted && enc == nil, "configured": true]
    }

    private func displayPath(_ s: Stored) -> String {
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "On My iPad" : "On My iPhone"
        switch s.kind {
        case "icloud": return "iCloud Drive › Folevi"
        case "device": return "\(device) › Folevi › \(Self.deviceFolder)"
        default:
            guard let p = place(kind: s.kind, bookmark: s.bookmark, sub: s.sub) else { return "A folder you chose" }
            return Self.describe(p.root)
        }
    }

    /// For people to read: "Dropbox › Notes", "iCloud Drive › Notes", "On My iPhone › Notes".
    static func describe(_ url: URL) -> String {
        let parts = url.standardizedFileURL.pathComponents
        if let i = parts.firstIndex(of: "com~apple~CloudDocs") { return (["iCloud Drive"] + parts[(i + 1)...]).joined(separator: " › ") }
        if let i = parts.firstIndex(of: "Mobile Documents"), i + 1 < parts.count {
            let rest = parts[(i + 2)...].filter { $0 != "Documents" }
            return (["iCloud Drive"] + rest).joined(separator: " › ")
        }
        if let i = parts.firstIndex(of: "File Provider Storage") ?? parts.firstIndex(of: "CloudStorage"), i + 1 < parts.count {
            let names = [("Dropbox", "Dropbox"), ("GoogleDrive", "Google Drive"), ("OneDrive", "OneDrive"), ("Box", "Box")]
            let provider = names.first { url.path.contains($0.0) }?.1 ?? "Files"
            return ([provider] + parts.suffix(2)).joined(separator: " › ")
        }
        if parts.contains("Documents") { return ([UIDevice.current.userInterfaceIdiom == .pad ? "On My iPad" : "On My iPhone"] + parts.suffix(1)).joined(separator: " › ") }
        return url.lastPathComponent
    }

    /// Where a kind puts the library (a picked folder comes from the Files app first).
    private func target(kind: String, picked: URL?) throws -> (root: URL, scoped: URL?, bookmark: String?, sub: String?) {
        switch kind {
        case "device":
            let root = Self.documents.appendingPathComponent(Self.deviceFolder, isDirectory: true)
            return (root, nil, nil, nil)
        case "icloud":
            switch Self.iCloudRoot() {
            case .failure(let e): throw e
            case .success(let docs): return (docs, nil, nil, nil)
            }
        case "folder":
            guard let picked else { throw LibraryError(.invalidArgument, "No folder was chosen.") }
            let opened = picked.startAccessingSecurityScopedResource()
            defer { if opened { picked.stopAccessingSecurityScopedResource() } }
            guard let data = try? picked.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else {
                throw LibraryError(.unavailable, "Folevi can't keep using that folder.", path: "not_writable")
            }
            // The folder itself when it's a library or empty; else a "Folevi Library" folder inside it.
            let names = ((try? fm.contentsOfDirectory(atPath: picked.path)) ?? []).filter { $0 != ".DS_Store" && $0 != "Icon\r" && !$0.hasPrefix(".folevi") }
            let sub = names.contains(LibraryPaths.libraryFile) || names.isEmpty ? "" : Self.deviceFolder
            return (sub.isEmpty ? picked : picked.appendingPathComponent(sub, isDirectory: true), picked, data.base64EncodedString(), sub)
        default:
            throw LibraryError(.invalidArgument, "Unknown library kind.")
        }
    }

    static func newLibraryId(_ now: Date = Date()) -> String {
        let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
        var t = UInt64(now.timeIntervalSince1970 * 1000)
        var time = ""
        for _ in 0..<10 {
            time = String(alphabet[Int(t % 32)]) + time
            t /= 32
        }
        let r = LibraryCrypto.randomBytes(16)
        return time + String(r.map { alphabet[Int($0) % 32] })
    }

    /// Makes sure a folder holds a library: a new manifest when there's none. Returns its id.
    private func prepare(_ fs: FolderFS) throws -> String {
        try fs.access { try fm.createDirectory(at: fs.root, withIntermediateDirectories: true) }
        guard fs.probeWritable() else { throw LibraryError(.unavailable, "Folevi can't write to that folder.", path: "not_writable") }
        if let existing = readManifest(fs), let id = existing.manifest["libraryId"] as? String { return id }
        // A library file there that isn't on this device yet: wait for it a little rather than start another.
        if (try? fs.read(LibraryPaths.libraryFile)).map({ if case .notDownloaded = $0 { return true } else { return false } }) == true {
            for _ in 0..<40 {
                Thread.sleep(forTimeInterval: 0.25)
                if let m = readManifest(fs), let id = m.manifest["libraryId"] as? String { return id }
            }
            throw LibraryError(.notDownloaded, "The library in that place is still downloading. Try again in a moment.")
        }
        let now = Date()
        let id = Self.newLibraryId(now)
        let m: [String: Any] = ["format": "folevi-library", "v": 1, "libraryId": id, "createdAt": Int(now.timeIntervalSince1970 * 1000), "minWriterVersion": 1, "encryption": NSNull()]
        if case .mismatch = try fs.write(LibraryPaths.libraryFile, Self.encodeManifest(m), .create) {
            // Another device made it just now.
            guard let again = readManifest(fs), let other = again.manifest["libraryId"] as? String else { throw LibraryError(.unreadable, "The library file in that folder can't be read yet.") }
            return other
        }
        return id
    }

    /// First run: "This device only", "Sync with iCloud" or a folder from the Files app (`picked`).
    func setup(kind: String, picked: URL?) throws -> [String: Any] {
        let t = try target(kind: kind, picked: picked)
        let fs = FolderFS(root: t.root, scoped: t.scoped)
        let libraryId = try prepare(fs)
        saveState(Stored(kind: kind, libraryId: libraryId, bookmark: t.bookmark, sub: t.sub))
        journalStore = nil
        attach()
        return info()
    }

    /// A library on Dropbox or Google Drive (the bridge prepared its library file there): kept as this device's.
    func setCloud(kind: String, libraryId: String) throws -> [String: Any] {
        guard Self.isCloud(kind), LibraryPaths.isValidId(libraryId) else { throw LibraryError(.invalidArgument, "Not a cloud library.") }
        detach()
        saveState(Stored(kind: kind, libraryId: libraryId))
        journalStore = nil
        return info()
    }

    // MARK: files (the page's calls)

    private func current() throws -> LibraryFS {
        guard stored != nil else { throw LibraryError(.notSetUp, "No library has been set up on this device.") }
        if base == nil || manifest == nil { attach() }
        guard let base, manifest != nil else { throw LibraryError(.unavailable, "The library can't be reached right now.") }
        if header != nil {
            guard let enc else { throw LibraryError(.locked, "The library is encrypted: enter its passphrase.") }
            return enc
        }
        return base
    }

    /// A place's files as stored, whatever the library is now (moving a cloud library to this device or iCloud).
    func filesAt(_ root: String) throws -> FolderFS {
        guard let p = place(kind: root, bookmark: nil, sub: nil) else { throw LibraryError(.unavailable, "That place can't be reached right now.") }
        let fs = FolderFS(root: p.root, scoped: p.scoped)
        try fs.access { try fm.createDirectory(at: fs.root, withIntermediateDirectories: true) }
        return fs
    }

    func list(_ dir: String) throws -> [[String: Any]] {
        try current().list(try LibraryPaths.checkDir(dir)).map(\.json)
    }

    func read(_ path: String) throws -> ReadResult {
        try current().read(try LibraryPaths.check(path))
    }

    func write(_ path: String, _ bytes: Data, _ ifMatch: IfMatch) throws -> WriteResult {
        let p = try LibraryPaths.check(path)
        let fs = try current()
        let r = try Self.inBackground { try fs.write(p, bytes, ifMatch) }
        if case .written(let etag) = r {
            watcher?.noteOwnChange(p, etag: etag)
            if p == LibraryPaths.libraryFile, let base, let m = readManifest(base) { useManifest(m.manifest, m.etag) }
        }
        return r
    }

    func remove(_ path: String, ifMatch: String?) throws {
        let p = try LibraryPaths.check(path)
        guard p != LibraryPaths.libraryFile else { throw LibraryError(.invalidPath, "The library file can't be removed.", path: p) }
        let fs = try current()
        try Self.inBackground { try fs.remove(p, ifMatch: ifMatch) }
        watcher?.noteOwnChange(p, etag: nil)
    }

    func conflictVersions(_ path: String) throws -> [(id: String, bytes: Data)] {
        try current().conflictVersions(try LibraryPaths.check(path))
    }

    func resolveConflicts(_ path: String, ids: [String]) throws {
        try current().resolveConflicts(try LibraryPaths.check(path), ids: ids)
    }

    func startDownload(_ paths: [String]) throws {
        try current().startDownload(try paths.map { try LibraryPaths.check($0) })
    }

    func rescan() { watcher?.scan() }

    /// A write that finishes even if Folevi goes to the background meanwhile.
    private static func inBackground<T>(_ work: () throws -> T) throws -> T {
        var task = UIBackgroundTaskIdentifier.invalid
        DispatchQueue.main.sync { task = UIApplication.shared.beginBackgroundTask(withName: "folevi-library-write") {} }
        defer { DispatchQueue.main.async { if task != .invalid { UIApplication.shared.endBackgroundTask(task) } } }
        return try work()
    }

    // MARK: the journal

    func journal() throws -> LibraryJournal {
        guard let s = stored else { throw LibraryError(.notSetUp, "No library has been set up on this device.") }
        let url = Self.support.appendingPathComponent("library", isDirectory: true).appendingPathComponent("journal-\(s.libraryId).bin")
        if journalStore?.url != url { journalStore = LibraryJournal(url: url) }
        return journalStore!
    }

    // MARK: passphrase

    private func writeManifest(_ change: ([String: Any]) -> [String: Any]) throws {
        guard let base else { throw LibraryError(.unavailable, "The library can't be reached right now.") }
        for _ in 0..<5 {
            guard let cur = readManifest(base) else { throw LibraryError(.unreadable, "The library file can't be read right now.") }
            let next = change(cur.manifest)
            if case .written(let etag) = try base.write(LibraryPaths.libraryFile, Self.encodeManifest(next), .match(cur.etag)) {
                watcher?.noteOwnChange(LibraryPaths.libraryFile, etag: etag)
                useManifest(next, etag)
                return
            }
        }
        throw LibraryError(.busy, "The library file kept changing; try again.")
    }

    /// Unlocks an encrypted library. False when the passphrase is wrong.
    func unlock(_ passphrase: String) throws -> Bool {
        guard passphrase.count <= 1024 else { throw LibraryError(.invalidArgument, "A passphrase is text.") }
        if manifest == nil { attach() }
        guard let m = manifest else {
            if stored == nil { throw LibraryError(.notSetUp, "No library has been set up on this device.") }
            throw LibraryError(.unavailable, "The library can't be reached right now.")
        }
        guard let header else { return true }
        guard let key = try? LibraryCrypto.unlock(header, passphrase: passphrase) else { return false }
        cacheKey(m["libraryId"] as! String, key)
        let wasLocked = enc == nil
        useManifest(m, manifestEtag ?? "")
        if wasLocked { startWatching() }
        try? resumeEncryption()
        return true
    }

    /// Turns encryption on (a passphrase), changes the passphrase of an unlocked library, or turns it off (nil).
    func setPassphrase(_ passphrase: String?) throws {
        if let p = passphrase, p.isEmpty || p.count > 1024 { throw LibraryError(.invalidArgument, "A passphrase is 1 to 1024 characters.") }
        _ = try current()
        defer { if base != nil { startWatching() } }
        watcher?.stop()
        watcher = nil
        guard let m = manifest, let id = m["libraryId"] as? String else { return }
        guard let passphrase else {
            guard header != nil else { return }
            var s = stored!
            s.encryptionJob = "decrypt"
            saveState(s)
            try runEncryptionJob()
            return
        }
        if header != nil {
            guard let k = key() else { throw LibraryError(.locked, "The library is encrypted: enter its passphrase.") }
            let h = try LibraryCrypto.wrap(k, passphrase: passphrase, iterations: iterations)
            try writeManifest { var c = $0; c["encryption"] = Self.headerJSON(h); return c }
            return
        }
        let created = try LibraryCrypto.create(passphrase: passphrase, iterations: iterations)
        cacheKey(id, created.masterKey)
        var s = stored!
        s.encryptionJob = "encrypt"
        saveState(s)
        try writeManifest { var c = $0; c["encryption"] = Self.headerJSON(created.header); return c }
        try runEncryptionJob()
    }

    /// Changes the passphrase given the old one. False when the old one is wrong.
    func changePassphrase(_ old: String, _ new: String) throws -> Bool {
        guard !new.isEmpty, new.count <= 1024 else { throw LibraryError(.invalidArgument, "A passphrase is 1 to 1024 characters.") }
        guard let m = manifest, let header, let id = m["libraryId"] as? String else { return false }
        guard let key = try? LibraryCrypto.unlock(header, passphrase: old) else { return false }
        let h = try LibraryCrypto.wrap(key, passphrase: new, iterations: header.kdf.iterations)
        try writeManifest { var c = $0; c["encryption"] = Self.headerJSON(h); return c }
        cacheKey(id, key)
        useManifest(manifest!, manifestEtag ?? "")
        return true
    }

    private func resumeEncryption() throws {
        guard let job = stored?.encryptionJob, base != nil, manifest != nil else { return }
        if job == "encrypt" && header == nil {
            // It stopped before the library file was written: nothing was converted.
            var s = stored!
            s.encryptionJob = nil
            saveState(s)
            return
        }
        guard key() != nil else { return }
        try runEncryptionJob()
    }

    /// Rewrites every file for the job in library.json; safe to run again (each file says what it is).
    private func runEncryptionJob() throws {
        guard let plain = base, let job = stored?.encryptionJob else { return }
        guard let key = key() else { throw LibraryError(.locked, "The library is encrypted: enter its passphrase.") }
        let e = try EncryptedFS(inner: plain, masterKey: key)
        let attachmentPlain = try NSRegularExpression(pattern: "^files/[0-9a-f]{2}/[0-9a-f]{64}$")
        var leftover = 0
        for _ in 0..<3 {
            leftover = 0
            let entries = try plain.list("").filter { $0.path != LibraryPaths.libraryFile }
            let waiting = entries.filter { !$0.downloaded }.map(\.path)
            if !waiting.isEmpty { try? plain.startDownload(waiting) }
            for entry in entries {
                guard entry.downloaded, let r = try? plain.read(entry.path), case .bytes(let bytes, let etag) = r else {
                    leftover += 1
                    continue
                }
                let isPlain = entry.path.hasPrefix(LibraryPaths.filesDir + "/")
                    ? attachmentPlain.firstMatch(in: entry.path, range: NSRange(location: 0, length: (entry.path as NSString).length)) != nil
                    : !LibraryCrypto.isEnvelope(bytes)
                if job == "encrypt" && isPlain {
                    let target = try e.physical(entry.path)
                    let sealed = try e.seal(target, bytes)
                    if target == entry.path {
                        if case .mismatch = try plain.write(entry.path, sealed, .match(etag)) { leftover += 1 }
                    } else {
                        _ = try plain.write(target, sealed, .any)
                        do { try plain.remove(entry.path, ifMatch: etag) } catch { leftover += 1 }
                    }
                } else if job == "decrypt" && !isPlain {
                    guard let logical = e.logical(entry.path), let opened = try? e.open(entry.path, bytes) else {
                        leftover += 1
                        continue
                    }
                    if logical == entry.path {
                        if case .mismatch = try plain.write(entry.path, opened, .match(etag)) { leftover += 1 }
                    } else {
                        _ = try plain.write(logical, opened, .any)
                        do { try plain.remove(entry.path, ifMatch: etag) } catch { leftover += 1 }
                    }
                }
            }
            if leftover == 0 { break }
        }
        if leftover > 0 { throw LibraryError(.notDownloaded, "\(leftover) files couldn't be rewritten yet; Folevi will finish later.") }
        if job == "decrypt", let id = manifest?["libraryId"] as? String {
            try writeManifest { var c = $0; c["encryption"] = NSNull(); return c }
            forgetKey(id)
        }
        var s = stored!
        s.encryptionJob = nil
        saveState(s)
        useManifest(manifest!, manifestEtag ?? "")
    }

    // MARK: moving

    /// Copies the library to another place, checks every file arrived, then switches to it. The old folder is
    /// left as it was. Calling it again, or restarting, picks up where it stopped (equal files are skipped).
    func move(kind: String, picked: URL?) throws -> [String: Any] {
        guard let s = stored else { throw LibraryError(.notSetUp, "No library has been set up on this device.") }
        guard base != nil, manifest != nil else { throw LibraryError(.unavailable, "The library can't be reached right now.") }
        let t = try target(kind: kind, picked: picked)
        let from = (base!.root.path as NSString).resolvingSymlinksInPath
        let dest = (t.root.path as NSString).resolvingSymlinksInPath
        if from == dest {
            var next = s
            next.kind = kind
            next.bookmark = t.bookmark ?? next.bookmark
            next.sub = t.sub ?? next.sub
            saveState(next)
            return info()
        }
        if dest.hasPrefix(from + "/") || from.hasPrefix(dest + "/") { throw LibraryError(.invalidArgument, "A library can't move into itself or into a folder that holds it.") }
        var next = s
        next.move = Move(kind: kind, bookmark: t.bookmark, sub: t.sub)
        saveState(next)
        try finishMove()
        return info()
    }

    private func finishMove() throws {
        guard let s = stored, let mv = s.move else { return }
        if base == nil {
            guard let p = place(kind: s.kind, bookmark: s.bookmark, sub: s.sub) else { throw LibraryError(.unavailable, "The library can't be reached right now.") }
            base = FolderFS(root: p.root, scoped: p.scoped)
        }
        let src = base!
        guard let p = place(kind: mv.kind, bookmark: mv.bookmark, sub: mv.sub) else { throw LibraryError(.unavailable, "That place can't be reached right now.") }
        let dst = FolderFS(root: p.root, scoped: p.scoped)
        try dst.access { try fm.createDirectory(at: dst.root, withIntermediateDirectories: true) }
        guard dst.probeWritable() else { throw LibraryError(.unavailable, "Folevi can't write to that folder.", path: "not_writable") }
        if let theirs = readManifest(dst), let id = theirs.manifest["libraryId"] as? String, id != s.libraryId {
            throw LibraryError(.targetHasLibrary, "That place already holds another Folevi library.")
        }
        var entries = try src.list("")
        let waiting = entries.filter { !$0.downloaded }.map(\.path)
        if !waiting.isEmpty {
            try? src.startDownload(waiting)
            for _ in 0..<120 {
                entries = try src.list("")
                if entries.allSatisfy(\.downloaded) { break }
                Thread.sleep(forTimeInterval: 0.5)
            }
            if entries.contains(where: { !$0.downloaded }) { throw LibraryError(.notDownloaded, "Some files are still downloading; Folevi will finish moving the library later.") }
        }
        // The library file goes last: a place with it holds a whole library.
        let ordered = entries.filter { $0.path != LibraryPaths.libraryFile } + entries.filter { $0.path == LibraryPaths.libraryFile }
        for e in ordered {
            guard case .bytes(let bytes, _) = try src.read(e.path) else { throw LibraryError(.notDownloaded, "Some files are still downloading.") }
            if case .bytes(let there, _)? = try? dst.read(e.path), there == bytes { continue }
            _ = try dst.write(e.path, bytes, .any)
        }
        let copied = Dictionary(uniqueKeysWithValues: try dst.list("").map { ($0.path, $0) })
        for e in entries where copied[e.path]?.size != e.size {
            throw LibraryError(.io, "\(e.path) didn't arrive whole; moving again will finish it.")
        }
        var next = Stored(kind: mv.kind, libraryId: s.libraryId, bookmark: mv.bookmark, sub: mv.sub)
        next.encryptionJob = s.encryptionJob
        saveState(next)
        attach()
    }

    // MARK: attachments (folevi-file://)

    struct AttachmentPlace {
        let fs: FolderFS
        let abs: String
        let rel: String
        let key: Data?
        /// A cloud library's file the bridge is fetching: there's no placeholder to say it's coming.
        var waitForArrival = false
    }

    /// Where an attachment is kept (on `queue`): nil when there's no library, it's locked, or the name is wrong.
    func locateAttachment(sha: String) -> AttachmentPlace? {
        guard sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { return nil }
        if let s = stored, Self.isCloud(s.kind), let p = Self.cloudProvider[s.kind], let root = try? ShellCloud.mirrorRoot(p) {
            // A cloud library's copy on this device; a file not here yet is asked of the bridge.
            let rel = "\(LibraryPaths.filesDir)/\(sha.prefix(2))/\(sha)"
            let fs = FolderFS(root: root)
            if (try? ShellCloud.mirrorRead(p, rel)) == nil { onCloudWant?(rel) }
            guard let abs = try? fs.abs(rel) else { return nil }
            return AttachmentPlace(fs: fs, abs: abs, rel: rel, key: nil, waitForArrival: true)
        }
        guard let base, manifest != nil else { return nil }
        let key = header != nil ? self.key() : nil
        if header != nil && key == nil { return nil }
        let name = key.flatMap { try? LibraryCrypto.hmacName($0, kind: "file", id: sha) } ?? sha
        let rel = "\(LibraryPaths.filesDir)/\(name.prefix(2))/\(name)"
        guard let abs = try? base.abs(rel) else { return nil }
        return AttachmentPlace(fs: base, abs: abs, rel: rel, key: key)
    }

    /// An attachment's size and a reader of its plain bytes [start, end), or nil when it isn't here. A file
    /// still in the cloud is asked for and waited on a little (off the library's queue).
    static func openAttachment(_ place: AttachmentPlace) -> (size: Int, read: (Int, Int) throws -> Data)? {
        let fs = place.fs
        let abs = place.abs
        let placeholder = ((abs as NSString).deletingLastPathComponent as NSString).appendingPathComponent(LibraryPaths.placeholderName((abs as NSString).lastPathComponent))
        var here = false
        for i in 0..<60 {
            let state = (try? fs.access { () -> (Bool, Bool) in
                let file = FileStat.of(abs) != nil
                return (file && FolderFS.status(abs).downloaded, file || FileStat.of(placeholder) != nil)
            }) ?? (false, false)
            if state.0 { here = true; break }
            if !state.1 && !place.waitForArrival { return nil }
            if i == 0 { try? fs.startDownload([place.rel]) }
            Thread.sleep(forTimeInterval: 0.25)
        }
        guard here, let size = (try? fs.access { FileStat.of(abs)?.size }) ?? nil else { return nil }
        let readAt: (Int, Int) throws -> Data = { position, length in
            try fs.access {
                guard let h = FileHandle(forReadingAtPath: abs) else { throw LibraryError(.notFound, "No such file.") }
                defer { try? h.close() }
                try h.seek(toOffset: UInt64(position))
                return try h.read(upToCount: length) ?? Data()
            }
        }
        guard let key = place.key else { return (Int(size), readAt) }
        guard let reader = try? LibraryCrypto.StreamReader(master: key, pathId: place.rel, envelopeLength: Int(size), readAt: readAt) else { return nil }
        return (reader.layout.plainLength, { try reader.range($0, $1) })
    }
}
