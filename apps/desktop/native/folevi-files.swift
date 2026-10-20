// folevi-files: coordinated file access for a local library kept in iCloud Drive or a File Provider folder
// (Dropbox, Google Drive, OneDrive and Box desktop apps under ~/Library/CloudStorage), for docs/LOCAL_MODE_PLAN.md
// §3.6 and §3.7 (src/library/helper.ts drives it). Plain folders don't use it: Node writes those directly.
//
// It runs as long as the library is open and speaks JSON lines: one request per line on stdin,
// {"id": 1, "op": "read", "path": "/abs/path"}, one answer per line on stdout, {"id": 1, "ok": true, "result": {...}}
// or {"id": 1, "ok": false, "code": "not_found", "message": "..."}, plus {"event": "status", ...} lines from
// a watch. Requests run concurrently; NSFileCoordinator orders them against the providers' own access.
//
// - read / write / remove: NSFileCoordinator reads, .forReplacing writes (Data.write(.atomic), then fsync) and
//   .forDeleting removes. The compare-and-swap of `ifMatch` happens inside the coordinated block.
// - stat: download, upload and conflict state (URL resource values), and the inode, size and mtime that the
//   app's etags are made of. startDownload: startDownloadingUbiquitousItem.
// - conflictVersions / resolveConflicts: NSFileVersion's unresolved conflict versions, read, then marked
//   resolved and removed once the app has merged them into a successful write.
// - watch / unwatch: an NSMetadataQuery over the folder that reports download and upload changes.
// - icloud: whether this Mac is signed in to iCloud and iCloud Drive's folder exists.
//
// `--self-test <dir>` runs its own checks in <dir> and prints them as JSON (no XCTest needed); `--test-hooks`
// adds two requests only tests use (addVersion, holdWrite). It touches no path it isn't given and talks to no one.
import CryptoKit
import Foundation

let helperVersion = "1"
let args = CommandLine.arguments
let testHooks = args.contains("--test-hooks")

// ---------------------------------------------------------------- output

let outputLock = NSLock()
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    outputLock.unlock()
}

struct Failure: Error {
    let code: String
    let message: String
}

// ---------------------------------------------------------------- files

/// The parts of an etag: inode, size and modification time in nanoseconds. Numbers go out as strings
/// (an inode or a nanosecond time doesn't fit a JSON double).
func statInfo(_ path: String) -> [String: Any]? {
    var st = stat()
    guard lstat(path, &st) == 0, (st.st_mode & S_IFMT) == S_IFREG else { return nil }
    let ns = Int64(st.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(st.st_mtimespec.tv_nsec)
    // SF_DATALESS: a file whose contents are still in the cloud.
    let dataless = (st.st_flags & 0x4000_0000) != 0
    return ["ino": String(st.st_ino), "size": Int(st.st_size), "mtimeNs": String(ns), "dataless": dataless]
}

func sameStat(_ a: [String: Any]?, _ b: [String: Any]?) -> Bool {
    guard let a = a, let b = b else { return false }
    return (a["ino"] as? String) == (b["ino"] as? String) && (a["size"] as? Int) == (b["size"] as? Int)
        && (a["mtimeNs"] as? String) == (b["mtimeNs"] as? String)
}

func checkedPath(_ value: Any?) throws -> String {
    guard let path = value as? String, path.hasPrefix("/"), !path.contains("\0"),
          !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
        throw Failure(code: "invalid_path", message: "An absolute path without . or .. is needed.")
    }
    return path
}

func placeholderPath(_ path: String) -> String {
    let url = URL(fileURLWithPath: path)
    return url.deletingLastPathComponent().appendingPathComponent("." + url.lastPathComponent + ".icloud").path
}

/// Download, upload and conflict state. Items outside iCloud Drive and File Provider folders read as local.
func itemStatus(_ path: String) -> [String: Any] {
    var out: [String: Any] = ["exists": false]
    var info = statInfo(path)
    var placeholder = false
    if info == nil, statInfo(placeholderPath(path)) != nil {
        placeholder = true
        info = nil
    }
    let url = URL(fileURLWithPath: path)
    let keys: Set<URLResourceKey> = [
        .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .ubiquitousItemIsUploadedKey,
        .ubiquitousItemIsUploadingKey, .ubiquitousItemHasUnresolvedConflictsKey, .ubiquitousItemIsDownloadingKey,
    ]
    let values = try? url.resourceValues(forKeys: keys)
    let ubiquitous = values?.isUbiquitousItem ?? false
    let status = values?.ubiquitousItemDownloadingStatus
    var downloaded = info != nil && !((info?["dataless"] as? Bool) ?? false)
    if ubiquitous, let status = status, status == .notDownloaded { downloaded = false }
    if let info = info { out.merge(info) { a, _ in a }; out["exists"] = true }
    out["placeholder"] = placeholder
    if placeholder { out["exists"] = true }
    out["ubiquitous"] = ubiquitous
    out["downloaded"] = downloaded
    out["downloading"] = values?.ubiquitousItemIsDownloading ?? false
    out["uploaded"] = ubiquitous ? (values?.ubiquitousItemIsUploaded ?? false) : true
    out["uploading"] = values?.ubiquitousItemIsUploading ?? false
    out["hasConflicts"] = values?.ubiquitousItemHasUnresolvedConflicts ?? false
    return out
}

func fsync(path: String) {
    let fd = open(path, O_RDONLY)
    guard fd >= 0 else { return }
    if fcntl(fd, F_FULLFSYNC) != 0 { _ = Darwin.fsync(fd) }
    close(fd)
}

func coordinatorError(_ error: NSError?, _ inner: Error?) throws {
    if let inner = inner { throw inner }
    if let error = error {
        if error.domain == NSCocoaErrorDomain && (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError) {
            throw Failure(code: "not_found", message: error.localizedDescription)
        }
        throw Failure(code: "io", message: error.localizedDescription)
    }
}

func readFile(_ path: String) throws -> [String: Any] {
    if statInfo(path) == nil {
        if statInfo(placeholderPath(path)) != nil {
            try? FileManager.default.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: path))
            return ["notDownloaded": true]
        }
        throw Failure(code: "not_found", message: "No such file.")
    }
    let status = itemStatus(path)
    if !((status["downloaded"] as? Bool) ?? true) {
        try? FileManager.default.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: path))
        return ["notDownloaded": true]
    }
    var result: [String: Any]?
    var inner: Error?
    var error: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: URL(fileURLWithPath: path), options: [], error: &error) { url in
        do {
            for _ in 0..<3 {
                let before = statInfo(url.path)
                let data = try Data(contentsOf: url)
                let after = statInfo(url.path)
                if before != nil, sameStat(before, after) {
                    result = ["bytes": data.base64EncodedString(), "stat": after!]
                    return
                }
            }
            inner = Failure(code: "io", message: "The file kept changing while it was read.")
        } catch let e as NSError where e.domain == NSCocoaErrorDomain && e.code == NSFileReadNoSuchFileError {
            inner = Failure(code: "not_found", message: "No such file.")
        } catch {
            inner = Failure(code: "io", message: error.localizedDescription)
        }
    }
    try coordinatorError(error, inner)
    guard let r = result else { throw Failure(code: "io", message: "Nothing was read.") }
    return r
}

/// The condition a write or remove checks inside its coordinated block.
struct Expect {
    let mode: String // "any", "create" (only if missing) or "match"
    let stat: [String: Any]?

    init(_ req: [String: Any]) throws {
        mode = (req["mode"] as? String) ?? "any"
        stat = req["expect"] as? [String: Any]
        guard ["any", "create", "match"].contains(mode), mode != "match" || stat != nil else {
            throw Failure(code: "invalid_argument", message: "Unknown write condition.")
        }
    }

    func holds(_ current: [String: Any]?) -> Bool {
        switch mode {
        case "create": return current == nil
        case "match": return current != nil && sameStat(current, stat)
        default: return true
        }
    }
}

func payload(_ req: [String: Any]) throws -> Data {
    if let b64 = req["bytes"] as? String {
        guard let d = Data(base64Encoded: b64) else { throw Failure(code: "invalid_argument", message: "Bad bytes.") }
        return d
    }
    if let from = req["fromFile"] as? String {
        return try Data(contentsOf: URL(fileURLWithPath: try checkedPath(from)))
    }
    throw Failure(code: "invalid_argument", message: "Nothing to write.")
}

func writeFile(_ path: String, _ data: Data, _ expect: Expect, holdMs: Int = 0) throws -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var result: [String: Any]?
    var inner: Error?
    var error: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &error) { u in
        let current = statInfo(u.path)
        // A placeholder counts as an existing file: its contents just aren't here.
        let exists: [String: Any]? = current ?? (statInfo(placeholderPath(u.path)) != nil ? ["placeholder": true] : nil)
        if !expect.holds(exists) {
            result = ["mismatch": true, "current": current ?? NSNull()]
            return
        }
        do {
            if holdMs > 0 { usleep(useconds_t(holdMs * 1000)) }
            try data.write(to: u, options: .atomic)
            fsync(path: u.path)
            fsync(path: u.deletingLastPathComponent().path)
            guard let st = statInfo(u.path) else { throw Failure(code: "io", message: "The file vanished after writing.") }
            result = ["stat": st]
        } catch {
            inner = (error as? Failure) ?? Failure(code: "io", message: error.localizedDescription)
        }
    }
    try coordinatorError(error, inner)
    guard let r = result else { throw Failure(code: "io", message: "Nothing was written.") }
    return r
}

func removeFile(_ path: String, _ expect: Expect) throws -> [String: Any] {
    var target = path
    if statInfo(path) == nil {
        let ph = placeholderPath(path)
        guard statInfo(ph) != nil else { return ["removed": false] }
        if expect.mode == "match" { throw Failure(code: "mismatch", message: "Changed since read.") }
        target = ph
    }
    var inner: Error?
    var error: NSError?
    var removed = false
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: URL(fileURLWithPath: target), options: .forDeleting, error: &error) { u in
        let current = statInfo(u.path)
        if current == nil { return }
        if expect.mode == "match" && !sameStat(current, expect.stat) {
            inner = Failure(code: "mismatch", message: "Changed since read.")
            return
        }
        do {
            try FileManager.default.removeItem(at: u)
            fsync(path: u.deletingLastPathComponent().path)
            removed = true
        } catch {
            inner = Failure(code: "io", message: error.localizedDescription)
        }
    }
    try coordinatorError(error, inner)
    return ["removed": removed]
}

// ---------------------------------------------------------------- versions

func versionId(_ v: NSFileVersion) -> String {
    let digest = SHA256.hash(data: Data(v.url.path.utf8))
    return digest.prefix(16).map { String(format: "%02x", $0) }.joined()
}

func versions(_ path: String, includeOther: Bool) -> [NSFileVersion] {
    let url = URL(fileURLWithPath: path)
    var list = NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []
    if includeOther && testHooks {
        for v in NSFileVersion.otherVersionsOfItem(at: url) ?? [] where !list.contains(where: { $0.url == v.url }) { list.append(v) }
    }
    return list
}

func conflictVersions(_ path: String, includeOther: Bool) throws -> [String: Any] {
    var out: [[String: Any]] = []
    for v in versions(path, includeOther: includeOther) {
        var data: Data?
        var error: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: v.url, options: [], error: &error) { u in
            data = try? Data(contentsOf: u)
        }
        // A version whose bytes can't be read now is left for later (it stays unresolved).
        if let d = data { out.append(["id": versionId(v), "bytes": d.base64EncodedString()]) }
    }
    return ["versions": out]
}

func resolveConflicts(_ path: String, ids: [String], includeOther: Bool) throws -> [String: Any] {
    let wanted = Set(ids)
    var resolved = 0
    var inner: Error?
    var error: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: URL(fileURLWithPath: path), options: [], error: &error) { _ in
        for v in versions(path, includeOther: includeOther) where wanted.contains(versionId(v)) {
            do {
                if v.isConflict { v.isResolved = true }
                try v.remove()
                resolved += 1
            } catch {
                inner = Failure(code: "io", message: error.localizedDescription)
            }
        }
    }
    try coordinatorError(error, inner)
    return ["resolved": resolved]
}

func addVersion(_ path: String, _ data: Data) throws -> [String: Any] {
    let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("folevi-files-\(UUID().uuidString)")
    try data.write(to: tmp)
    defer { try? FileManager.default.removeItem(at: tmp) }
    let v = try NSFileVersion.addOfItem(at: URL(fileURLWithPath: path), withContentsOf: tmp, options: [])
    return ["id": versionId(v)]
}

// ---------------------------------------------------------------- watching (main thread)

final class Watch {
    let root: String
    let query = NSMetadataQuery()
    var observers: [NSObjectProtocol] = []

    init(root: String) {
        self.root = root
        query.searchScopes = [URL(fileURLWithPath: root)]
        query.predicate = NSPredicate(format: "%K LIKE %@", NSMetadataItemFSNameKey, "*")
        query.notificationBatchingInterval = 0.5
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.report(self.query.results.compactMap { $0 as? NSMetadataItem }, initial: true)
        })
        observers.append(center.addObserver(forName: .NSMetadataQueryDidUpdate, object: query, queue: .main) { [weak self] note in
            var items: [NSMetadataItem] = []
            for key in [NSMetadataQueryUpdateAddedItemsKey, NSMetadataQueryUpdateChangedItemsKey] {
                items += (note.userInfo?[key] as? [NSMetadataItem]) ?? []
            }
            self?.report(items, initial: false)
        })
        query.start()
    }

    func report(_ items: [NSMetadataItem], initial: Bool) {
        query.disableUpdates()
        defer { query.enableUpdates() }
        var out: [[String: Any]] = []
        for item in items {
            guard let path = item.value(forAttribute: NSMetadataItemPathKey) as? String, path.hasPrefix(root + "/") else { continue }
            var s = itemStatus(path)
            s["path"] = path
            out.append(s)
        }
        if !out.isEmpty || initial { emit(["event": "status", "root": root, "initial": initial, "items": out]) }
    }

    func stop() {
        query.stop()
        for o in observers { NotificationCenter.default.removeObserver(o) }
    }
}

var watches: [String: Watch] = [:]

// ---------------------------------------------------------------- requests

func handle(_ req: [String: Any]) throws -> [String: Any] {
    let op = (req["op"] as? String) ?? ""
    switch op {
    case "ping":
        return ["version": helperVersion, "pid": Int(getpid()), "testHooks": testHooks]
    case "icloud":
        let drive = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs")
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: drive.path, isDirectory: &isDir) && isDir.boolValue
        return ["signedIn": FileManager.default.ubiquityIdentityToken != nil, "driveRoot": drive.path, "driveExists": exists]
    case "stat":
        let paths = (req["paths"] as? [Any]) ?? []
        var items: [String: Any] = [:]
        for p in paths { let path = try checkedPath(p); items[path] = itemStatus(path) }
        return ["items": items]
    case "read":
        return try readFile(try checkedPath(req["path"]))
    case "write":
        return try writeFile(try checkedPath(req["path"]), try payload(req), try Expect(req))
    case "remove":
        return try removeFile(try checkedPath(req["path"]), try Expect(req))
    case "startDownload":
        var started = 0
        for p in (req["paths"] as? [Any]) ?? [] {
            let path = try checkedPath(p)
            if (try? FileManager.default.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: path))) != nil { started += 1 }
        }
        return ["started": started]
    case "conflictVersions":
        return try conflictVersions(try checkedPath(req["path"]), includeOther: (req["includeOther"] as? Bool) ?? false)
    case "resolveConflicts":
        let ids = ((req["ids"] as? [Any]) ?? []).compactMap { $0 as? String }
        return try resolveConflicts(try checkedPath(req["path"]), ids: ids, includeOther: (req["includeOther"] as? Bool) ?? false)
    case "watch":
        let root = try checkedPath(req["root"])
        DispatchQueue.main.async { if watches[root] == nil { watches[root] = Watch(root: root) } }
        return [:]
    case "unwatch":
        let root = try checkedPath(req["root"])
        DispatchQueue.main.async { watches.removeValue(forKey: root)?.stop() }
        return [:]
    case "addVersion" where testHooks:
        return try addVersion(try checkedPath(req["path"]), try payload(req))
    case "holdWrite" where testHooks:
        return try writeFile(try checkedPath(req["path"]), try payload(req), try Expect(req), holdMs: (req["ms"] as? Int) ?? 0)
    default:
        throw Failure(code: "invalid_argument", message: "Unknown request \(op).")
    }
}

let work = DispatchQueue(label: "folevi-files.work", attributes: .concurrent)
let slots = DispatchSemaphore(value: 8)

func serve() {
    let reader = Thread {
        while let line = readLine(strippingNewline: true) {
            if line.isEmpty { continue }
            guard let data = line.data(using: .utf8),
                  let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                emit(["id": NSNull(), "ok": false, "code": "invalid_argument", "message": "Not a JSON object."])
                continue
            }
            let id = req["id"] ?? NSNull()
            slots.wait()
            work.async {
                defer { slots.signal() }
                autoreleasepool {
                    do {
                        emit(["id": id, "ok": true, "result": try handle(req)])
                    } catch let f as Failure {
                        emit(["id": id, "ok": false, "code": f.code, "message": f.message])
                    } catch {
                        emit(["id": id, "ok": false, "code": "io", "message": error.localizedDescription])
                    }
                }
            }
        }
        // stdin closed: the app is gone or done with the library.
        work.async(flags: .barrier) { exit(0) }
    }
    reader.start()
    // NSMetadataQuery needs the main run loop; the timer keeps it from returning when nothing else is scheduled.
    RunLoop.main.add(Timer(timeInterval: 86_400, repeats: true) { _ in }, forMode: .default)
    while true { RunLoop.main.run(mode: .default, before: .distantFuture) }
}

// ---------------------------------------------------------------- self-test

func selfTest(_ dir: String) -> Never {
    var checks: [[String: Any]] = []
    func check(_ name: String, _ body: () throws -> Bool) {
        do { checks.append(["name": name, "ok": try body()]) } catch { checks.append(["name": name, "ok": false, "detail": "\(error)"]) }
    }
    let base = (dir as NSString).appendingPathComponent("self-test-\(getpid())")
    try? FileManager.default.createDirectory(atPath: base, withIntermediateDirectories: true)
    let file = (base as NSString).appendingPathComponent("notes/a.fnote")
    var first: [String: Any] = [:]

    check("coordinated create-only write") {
        let r = try writeFile(file, Data("one".utf8), try Expect(["mode": "create"]))
        first = (r["stat"] as? [String: Any]) ?? [:]
        let again = try writeFile(file, Data("two".utf8), try Expect(["mode": "create"]))
        return r["stat"] != nil && again["mismatch"] as? Bool == true
    }
    check("coordinated read returns the bytes and the same stat") {
        let r = try readFile(file)
        return (r["bytes"] as? String) == Data("one".utf8).base64EncodedString() && sameStat(r["stat"] as? [String: Any], first)
    }
    check("compare-and-swap inside the coordinated block") {
        let ok = try writeFile(file, Data("two".utf8), try Expect(["mode": "match", "expect": first]))
        let stale = try writeFile(file, Data("three".utf8), try Expect(["mode": "match", "expect": first]))
        let now = try Data(contentsOf: URL(fileURLWithPath: file))
        return ok["stat"] != nil && stale["mismatch"] as? Bool == true && String(data: now, encoding: .utf8) == "two"
    }
    check("a coordinated reader waits for a coordinated writer") {
        var order: [String] = []
        let lock = NSLock()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async {
            _ = try? writeFile(file, Data("held".utf8), try! Expect([:]), holdMs: 400)
            lock.lock(); order.append("write"); lock.unlock()
            group.leave()
        }
        usleep(100_000)
        let r = try readFile(file)
        lock.lock(); order.append("read"); lock.unlock()
        group.wait()
        return order == ["write", "read"] && (r["bytes"] as? String) == Data("held".utf8).base64EncodedString()
    }
    check("remove with a stale stat is refused, then removes") {
        do {
            _ = try removeFile(file, try Expect(["mode": "match", "expect": first]))
            return false
        } catch let f as Failure where f.code == "mismatch" {}
        let r = try removeFile(file, try Expect([:]))
        return r["removed"] as? Bool == true && statInfo(file) == nil
    }
    check("a placeholder reads as not downloaded") {
        let ph = placeholderPath(file)
        FileManager.default.createFile(atPath: ph, contents: Data())
        defer { try? FileManager.default.removeItem(atPath: ph) }
        return try readFile(file)["notDownloaded"] as? Bool == true && itemStatus(file)["downloaded"] as? Bool == false
    }
    check("NSFileVersion: versions are read, resolved and removed") {
        _ = try writeFile(file, Data("current".utf8), try Expect([:]))
        let url = URL(fileURLWithPath: file)
        let tmp = URL(fileURLWithPath: base).appendingPathComponent("other.tmp")
        try Data("other".utf8).write(to: tmp)
        let v = try NSFileVersion.addOfItem(at: url, withContentsOf: tmp, options: [])
        let listed = (NSFileVersion.otherVersionsOfItem(at: url) ?? []).contains { $0.url == v.url }
        // Local versions are never conflicts: the unresolved list stays empty outside iCloud.
        let unresolved = NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []
        var bytes: Data?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: v.url, options: [], error: nil) { u in bytes = try? Data(contentsOf: u) }
        try v.remove()
        let gone = !(NSFileVersion.otherVersionsOfItem(at: url) ?? []).contains { $0.url == v.url }
        return listed && unresolved.isEmpty && bytes == Data("other".utf8) && gone
    }
    try? FileManager.default.removeItem(atPath: base)
    let ok = checks.allSatisfy { ($0["ok"] as? Bool) == true }
    emit(["selfTest": ok, "checks": checks])
    exit(ok ? 0 : 1)
}

if let i = args.firstIndex(of: "--self-test") {
    selfTest(i + 1 < args.count ? args[i + 1] : NSTemporaryDirectory())
}
serve()
