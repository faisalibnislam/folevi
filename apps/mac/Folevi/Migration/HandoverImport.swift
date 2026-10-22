// Edits the old Electron app hadn't sent yet (docs/MAC_WEBKIT_PLAN.md §8.3). Electron keeps the web app's account
// databases in Chromium's storage, which WebKit can't read. The last Electron release (1.22, apps/desktop
// src/handover.ts) writes every database that still holds unsent work into userData/handover/ as it quits, with
// handoffKit's own chunks: an index (names, versions, schema, record counts, a SHA-256 per file), one file per chunk
// and the app's localStorage entries (the sync journals).
//
// The first launch imports them, before any window opens, into this app's WKWebView storage through a hidden view
// on app://folevi/_folevi-handoff running the same kit (handover-kit.js, made from apps/desktop/src/handoffKit.ts by
// apps/desktop/scripts/handover-kit.mjs): `prepare` makes each database with its schema, `writeChunk` fills it,
// `counts` checks every record arrived, `writeStorage` adds the journals. Nothing already here is overwritten (a
// database that exists with records stays as it is, and so do its account's journals). A database newer than the
// bundled interface opens holds the import back: the app asks for an update first (Electron's needsUpdate rule).
// The web app then finds its outbox where it always looks and sends it once the account opens.
import CryptoKit
import Foundation
import WebKit

@MainActor
final class HandoverImport: NSObject, WKNavigationDelegate {
    enum Outcome: Equatable {
        /// No handover folder; `electronStorage` says whether Electron's web storage is here at all (an Electron
        /// older than 1.22 may have left unsent changes in it).
        case none(electronStorage: Bool)
        /// Electron 1.22 quit with nothing waiting.
        case nothingWaiting
        case imported(databases: Int, records: Int, storage: Int, skipped: [String])
        /// The handover holds databases this bundled interface can't open yet.
        case needsUpdate([String])
    }

    struct Failure: Error, Equatable { let message: String }

    struct ChunkFile: Decodable { let store: String; let file: String; let records: Int; let sha256: String }
    struct StorageFile: Decodable { let file: String; let entries: Int; let sha256: String }
    struct Database: Decodable {
        let name: String
        let version: Int
        let chunks: [ChunkFile]
        let counts: [String: Int]
    }
    struct Index: Decodable {
        let v: Int
        let createdAt: Double
        let appVersion: String?
        let databases: [Database]
        let storage: StorageFile?
    }

    let folder: URL
    let dataStore: WKWebsiteDataStore
    let scheme: AppScheme
    let bundledDbVersion: Int?

    private var view: WKWebView?
    private var loaded: CheckedContinuation<Void, Error>?

    init(folder: URL, dataStore: WKWebsiteDataStore, scheme: AppScheme, bundledDbVersion: Int?) {
        self.folder = folder
        self.dataStore = dataStore
        self.scheme = scheme
        self.bundledDbVersion = bundledDbVersion
    }

    static func forThisApp() -> HandoverImport {
        HandoverImport(folder: Paths.supportFolder, dataStore: Paths.dataStore, scheme: WebViewFactory.scheme, bundledDbVersion: (Paths.shellBuild?["dbVersion"] as? NSNumber)?.intValue)
    }

    var handover: URL { folder.appendingPathComponent("handover", isDirectory: true) }

    /// Chromium's IndexedDB for the app's origin (or the website's, from before the bundled interface).
    var hasElectronStorage: Bool {
        let idb = folder.appendingPathComponent("Partitions/folevi/IndexedDB", isDirectory: true)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: idb.path)) ?? []
        return names.contains { $0.hasSuffix(".indexeddb.leveldb") }
    }

    static func sha256(_ d: Data) -> String { SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }

    /// The index, with every file it names read and checked.
    func load() throws -> (index: Index, schemas: [String: String], chunks: [String: String], storage: String?)? {
        let indexURL = handover.appendingPathComponent("index.json")
        guard let raw = try? Data(contentsOf: indexURL) else { return nil }
        guard let index = try? JSONDecoder().decode(Index.self, from: raw), index.v == 1 else { throw Failure(message: "The previous version's offline changes can't be read.") }
        // Each database's schema as the kit's `prepare` takes it (the inventory record Electron wrote).
        var schemas: [String: String] = [:]
        let obj = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any]
        for entry in (obj?["databases"] as? [[String: Any]]) ?? [] {
            guard let name = entry["name"] as? String, let schema = entry["schema"] as? [String: Any], schema["name"] as? String == name,
                  let d = try? JSONSerialization.data(withJSONObject: schema), let text = String(data: d, encoding: .utf8) else { continue }
            schemas[name] = text
        }
        for db in index.databases where schemas[db.name] == nil { throw Failure(message: "The previous version's offline changes can't be read (\(db.name)).") }
        var chunks: [String: String] = [:]
        func read(_ name: String, _ sha: String) throws -> String {
            guard name.range(of: #"^[A-Za-z0-9_.-]{1,64}$"#, options: .regularExpression) != nil, !name.hasPrefix("."),
                  let d = try? Data(contentsOf: handover.appendingPathComponent(name)), Self.sha256(d) == sha, let text = String(data: d, encoding: .utf8) else {
                throw Failure(message: "The previous version's offline changes are damaged (\(name)).")
            }
            return text
        }
        for db in index.databases { for c in db.chunks { chunks[c.file] = try read(c.file, c.sha256) } }
        let storage = try index.storage.map { try read($0.file, $0.sha256) }
        return (index, schemas, chunks, storage)
    }

    func run() async throws -> Outcome {
        guard let (index, schemas, chunks, storage) = try load() else { return .none(electronStorage: hasElectronStorage) }
        if index.databases.isEmpty && (index.storage?.entries ?? 0) == 0 {
            setAside()
            return .nothingWaiting
        }
        if let bundled = bundledDbVersion {
            let newer = index.databases.filter { $0.version > bundled }.map { "\($0.name) (version \($0.version))" }
            if !newer.isEmpty { return .needsUpdate(newer) }
        }
        try await openView()
        defer { closeView() }
        var imported = 0, records = 0
        var skipped: [String] = []
        for db in index.databases {
            let prepared = try await call("prepare", [schemas[db.name]!]) as? String
            if prepared == "exists" {
                skipped.append(db.name)
                continue
            }
            for c in db.chunks {
                records += (try await call("writeChunk", [db.name, c.store, chunks[c.file]!]) as? NSNumber)?.intValue ?? 0
            }
            let counts = (try await call("counts", [db.name]) as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Int] } ?? [:]
            for (store, n) in db.counts where (counts[store] ?? -1) != n {
                throw Failure(message: "\(db.name): \(counts[store] ?? 0) of \(n) records in \(store) arrived.")
            }
            imported += 1
        }
        var set = 0
        if let storage {
            let skippedAccounts = Set(skipped.map { String($0.dropFirst("folevi-".count)) })
            let entries = ((try? JSONSerialization.jsonObject(with: Data(storage.utf8))) as? [[String]] ?? []).filter { e in
                guard e.count == 2 else { return false }
                return Self.journalAccount(e[0]).map { !skippedAccounts.contains($0) } ?? true
            }
            if !entries.isEmpty, let text = String(data: try JSONSerialization.data(withJSONObject: entries), encoding: .utf8) {
                set = (try await call("writeStorage", [text]) as? NSNumber)?.intValue ?? 0
            }
        }
        setAside()
        return .imported(databases: imported, records: records, storage: set, skipped: skipped)
    }

    /// The account a sync journal belongs to ("folevi:sync-journal:<account>[:<tab>]", handoff.ts journalAccount).
    static func journalAccount(_ key: String) -> String? {
        let prefix = "folevi:sync-journal:"
        guard key.hasPrefix(prefix) else { return nil }
        let rest = key.dropFirst(prefix.count).split(separator: ":", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return rest.isEmpty ? nil : rest
    }

    /// The folder is kept (renamed) until the 30-day clean-up.
    private func setAside() {
        let fm = FileManager.default
        let target = folder.appendingPathComponent("handover (imported)", isDirectory: true)
        try? fm.removeItem(at: target)
        try? fm.moveItem(at: handover, to: target)
    }

    // MARK: the hidden page

    private static let kit: String? = Bundle.main.url(forResource: "handover-kit", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) }

    private func openView() async throws {
        guard Self.kit != nil else { throw Failure(message: "This copy of Folevi is missing a part (handover-kit.js). Reinstall Folevi.") }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        config.setURLSchemeHandler(scheme, forURLScheme: AppScheme.scheme)
        config.preferences.inactiveSchedulingPolicy = .none
        let v = WKWebView(frame: NSRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        v.navigationDelegate = self
        view = v
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            loaded = cont
            v.load(URLRequest(url: URL(string: AppScheme.origin + AppScheme.handoffPath)!))
        }
    }

    private func closeView() {
        view?.navigationDelegate = nil
        view = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded?.resume()
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loaded?.resume(throwing: Failure(message: "The import page didn't open (\(error.localizedDescription))."))
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        self.webView(webView, didFail: navigation, withError: error)
    }

    /// One of the kit's functions on the page, with the page's own storage.
    func call(_ fn: String, _ args: [Any]) async throws -> Any? {
        guard let view, let kit = Self.kit else { throw Failure(message: "The import page isn't open.") }
        let body = "const kit = (\(kit))(); return await kit[fn]({ indexedDB, IDBKeyRange, localStorage }, ...args);"
        do {
            return try await view.callAsyncJavaScript(body, arguments: ["fn": fn, "args": args], in: nil, contentWorld: .page)
        } catch {
            let info = (error as NSError).userInfo
            let detail = (info["WKJavaScriptExceptionMessage"] as? String).flatMap { $0 == "null" ? nil : $0 } ?? (error as NSError).localizedDescription
            throw Failure(message: "Importing the offline changes failed (\(fn)): \(detail)")
        }
    }
}
