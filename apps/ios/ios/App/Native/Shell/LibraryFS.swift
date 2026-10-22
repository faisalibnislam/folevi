// The library's files on iPhone and iPad: local-store's `LocalFs` over a folder (docs/LOCAL_MODE_PLAN.md §3.6,
// §4.3), the same contract as the Mac's apps/desktop/src/library/fs.ts and folevi-files.swift.
//
// - Paths are checked (relative, forward slashes, no `..`, no control characters) and can't leave the folder,
//   whatever links it holds.
// - Etags are inode + size + modification time in nanoseconds (an atomic replace always makes a new inode).
// - Every read, write and remove goes through NSFileCoordinator (iCloud, the Files app and other apps' File
//   Providers order their own access against it); writes are `.forReplacing` with Data.write(.atomic), then
//   fsync'd, and `ifMatch` is checked inside the coordinated block.
// - Files whose contents aren't on this device (iCloud's `.name.icloud` placeholders, or dataless files a
//   File Provider keeps in the cloud) are listed with `downloaded: false` and read as `notDownloaded`, and
//   are asked for (startDownloadingUbiquitousItem) rather than read, so a read never blocks on the network.
// - NSFileVersion's unresolved conflict versions are offered as conflict versions and resolved once merged.
import CryptoKit
import Foundation

struct LibraryEntry {
    var path: String
    var size: Int
    var mtimeMs: Double
    var etag: String
    var downloaded: Bool
    var hasConflicts: Bool

    var json: [String: Any] { ["path": path, "size": size, "mtimeMs": mtimeMs, "etag": etag, "downloaded": downloaded, "hasConflicts": hasConflicts] }
}

enum ReadResult {
    case bytes(Data, etag: String)
    case notDownloaded
}

enum WriteResult {
    case written(etag: String)
    case mismatch(etag: String)
}

/// `ifMatch` as the page passes it: absent (write anyway), null (only if the file doesn't exist yet), or an etag.
enum IfMatch {
    case any
    case create
    case match(String)
}

protocol LibraryFS: AnyObject {
    func list(_ dir: String) throws -> [LibraryEntry]
    func read(_ path: String) throws -> ReadResult
    func write(_ path: String, _ bytes: Data, _ ifMatch: IfMatch) throws -> WriteResult
    func remove(_ path: String, ifMatch: String?) throws
    func conflictVersions(_ path: String) throws -> [(id: String, bytes: Data)]
    func resolveConflicts(_ path: String, ids: [String]) throws
    func startDownload(_ paths: [String]) throws
}

/// A file's stat: what an etag is made of.
struct FileStat: Equatable {
    let ino: UInt64
    let size: Int64
    let mtimeNs: Int64

    var mtimeMs: Double { Double(mtimeNs) / 1_000_000 }
    var etag: String { "\(String(ino, radix: 36))-\(String(size, radix: 36))-\(String(mtimeNs, radix: 36))" }

    static func of(_ path: String) -> FileStat? {
        var st = stat()
        guard lstat(path, &st) == 0, (st.st_mode & S_IFMT) == S_IFREG else { return nil }
        return FileStat(ino: UInt64(st.st_ino), size: Int64(st.st_size), mtimeNs: Int64(st.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(st.st_mtimespec.tv_nsec))
    }
}

final class FolderFS: LibraryFS {
    /// The library folder.
    let root: URL
    /// A folder the person chose in the Files app: reached only between start/stopAccessingSecurityScopedResource.
    private let scoped: URL?
    private let fm = FileManager.default

    /// Names never listed: the temp folder, the system's and the providers' own files.
    static let ignored: Set<String> = [LibraryPaths.tmpDir, ".DS_Store", ".dropbox", ".dropbox.attr", ".dropbox.cache", "Icon\r", ".tmp.drivedownload", ".tmp.driveupload", ".Trash", ".Trashes"]

    init(root: URL, scoped: URL? = nil) {
        self.root = root.standardizedFileURL
        self.scoped = scoped
    }

    /// Runs `work` with the chosen folder's access open (and closes it after).
    func access<T>(_ work: () throws -> T) throws -> T {
        guard let scoped else { return try work() }
        let opened = scoped.startAccessingSecurityScopedResource()
        defer { if opened { scoped.stopAccessingSecurityScopedResource() } }
        return try work()
    }

    private var realRoot: String {
        (root.path as NSString).resolvingSymlinksInPath
    }

    /// The absolute path for a library path, after checking that no link on the way leads out of the folder.
    func abs(_ path: String) throws -> String {
        guard LibraryPaths.isValid(path) else { throw LibraryError(.invalidPath, "Invalid library path.", path: path) }
        let rootPath = realRoot
        let full = (rootPath as NSString).appendingPathComponent(path)
        var dir = (full as NSString).deletingLastPathComponent
        while true {
            if fm.fileExists(atPath: dir) {
                let real = (dir as NSString).resolvingSymlinksInPath
                if real != rootPath && !real.hasPrefix(rootPath + "/") { throw LibraryError(.invalidPath, "Outside the library.", path: path) }
                break
            }
            if dir.count <= rootPath.count { break }
            dir = (dir as NSString).deletingLastPathComponent
        }
        var st = stat()
        if lstat(full, &st) == 0, (st.st_mode & S_IFMT) == S_IFLNK { throw LibraryError(.invalidPath, "A link, not a file.", path: path) }
        return full
    }

    private func placeholderOf(_ abs: String) -> String {
        ((abs as NSString).deletingLastPathComponent as NSString).appendingPathComponent(LibraryPaths.placeholderName((abs as NSString).lastPathComponent))
    }

    /// Download and conflict state from the file's resource values (local files read as downloaded).
    static func status(_ abs: String) -> (downloaded: Bool, hasConflicts: Bool, ubiquitous: Bool, uploaded: Bool) {
        var url = URL(fileURLWithPath: abs)
        url.removeAllCachedResourceValues()
        let keys: Set<URLResourceKey> = [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .ubiquitousItemHasUnresolvedConflictsKey, .ubiquitousItemIsUploadedKey]
        guard let v = try? url.resourceValues(forKeys: keys) else { return (true, false, false, true) }
        let ubiquitous = v.isUbiquitousItem ?? false
        let downloaded = !(ubiquitous && v.ubiquitousItemDownloadingStatus == .notDownloaded)
        return (downloaded, v.ubiquitousItemHasUnresolvedConflicts ?? false, ubiquitous, ubiquitous ? (v.ubiquitousItemIsUploaded ?? false) : true)
    }

    // MARK: list

    func list(_ dir: String) throws -> [LibraryEntry] {
        let start = try dir.isEmpty ? realRoot : abs(try LibraryPaths.checkDir(dir))
        return try access {
            let rootPath = realRoot
            var files: [(path: String, abs: String, placeholder: Bool)] = []
            func walk(_ absDir: String) {
                guard let names = try? fm.contentsOfDirectory(atPath: absDir) else { return }
                for name in names {
                    if Self.ignored.contains(name) { continue }
                    let child = (absDir as NSString).appendingPathComponent(name)
                    let real = LibraryPaths.fromPlaceholder(name)
                    if name.hasPrefix(".") && real == nil { continue }
                    var st = stat()
                    guard lstat(child, &st) == 0 else { continue }
                    let kind = st.st_mode & S_IFMT
                    if kind == S_IFLNK { continue }
                    if kind == S_IFDIR {
                        if real == nil { walk(child) }
                        continue
                    }
                    guard kind == S_IFREG else { continue }
                    let shown = real.map { (absDir as NSString).appendingPathComponent($0) } ?? child
                    guard shown.hasPrefix(rootPath + "/") else { continue }
                    let path = String(shown.dropFirst(rootPath.count + 1))
                    guard LibraryPaths.isValid(path) else { continue }
                    files.append((path, child, real != nil))
                }
            }
            walk(start)
            // A placeholder and its downloaded file both present: the file wins.
            var byPath: [String: (path: String, abs: String, placeholder: Bool)] = [:]
            for f in files where byPath[f.path] == nil || !f.placeholder { byPath[f.path] = f }
            var out: [LibraryEntry] = []
            for f in byPath.values {
                guard let s = FileStat.of(f.abs) else { continue }
                if f.placeholder {
                    out.append(LibraryEntry(path: f.path, size: 0, mtimeMs: s.mtimeMs, etag: "p" + s.etag, downloaded: false, hasConflicts: false))
                } else {
                    let st = Self.status(f.abs)
                    out.append(LibraryEntry(path: f.path, size: Int(s.size), mtimeMs: s.mtimeMs, etag: s.etag, downloaded: st.downloaded, hasConflicts: st.hasConflicts))
                }
            }
            return out.sorted { $0.path < $1.path }
        }
    }

    /// One entry by path (nil when it's missing).
    func entry(_ path: String) throws -> LibraryEntry? {
        let a = try abs(path)
        return try access {
            if let s = FileStat.of(a) {
                let st = Self.status(a)
                return LibraryEntry(path: path, size: Int(s.size), mtimeMs: s.mtimeMs, etag: s.etag, downloaded: st.downloaded, hasConflicts: st.hasConflicts)
            }
            if let p = FileStat.of(placeholderOf(a)) { return LibraryEntry(path: path, size: 0, mtimeMs: p.mtimeMs, etag: "p" + p.etag, downloaded: false, hasConflicts: false) }
            return nil
        }
    }

    // MARK: read

    func read(_ path: String) throws -> ReadResult {
        let a = try abs(path)
        return try access {
            guard FileStat.of(a) != nil else {
                if FileStat.of(placeholderOf(a)) != nil {
                    try? fm.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: a))
                    return .notDownloaded
                }
                throw LibraryError(.notFound, "No such file.", path: path)
            }
            if !Self.status(a).downloaded {
                try? fm.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: a))
                return .notDownloaded
            }
            var result: ReadResult?
            var inner: Error?
            var error: NSError?
            NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: URL(fileURLWithPath: a), options: [.withoutChanges], error: &error) { url in
                for _ in 0..<3 {
                    let before = FileStat.of(url.path)
                    guard let data = try? Data(contentsOf: url) else {
                        inner = FileStat.of(url.path) == nil ? LibraryError(.notFound, "No such file.", path: path) : LibraryError(.io, "The file couldn't be read.", path: path)
                        return
                    }
                    let after = FileStat.of(url.path)
                    if let before, before == after, Int64(data.count) == after?.size {
                        result = .bytes(data, etag: before.etag)
                        return
                    }
                }
                inner = LibraryError(.unreadable, "The file kept changing while it was read.", path: path)
            }
            if let inner { throw inner }
            if let error { throw Self.ioError(error, path) }
            guard let result else { throw LibraryError(.io, "Nothing was read.", path: path) }
            return result
        }
    }

    // MARK: write

    private func currentEtag(_ a: String) -> String {
        if let s = FileStat.of(a) { return s.etag }
        if let p = FileStat.of(placeholderOf(a)) { return "p" + p.etag }
        return ""
    }

    func write(_ path: String, _ bytes: Data, _ ifMatch: IfMatch) throws -> WriteResult {
        let a = try abs(path)
        return try access {
            try fm.createDirectory(atPath: (a as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
            // Checked again now the folders exist: a linked folder made meanwhile can't redirect the write.
            _ = try abs(path)
            var result: WriteResult?
            var inner: Error?
            var error: NSError?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: URL(fileURLWithPath: a), options: .forReplacing, error: &error) { url in
                let current = currentEtag(url.path)
                switch ifMatch {
                case .create where !current.isEmpty: result = .mismatch(etag: current); return
                case .match(let want) where want != current: result = .mismatch(etag: current); return
                default: break
                }
                do {
                    try bytes.write(to: url, options: .atomic)
                    Self.fsync(url.path)
                    Self.fsync((url.path as NSString).deletingLastPathComponent)
                    // A placeholder for the same name is stale now.
                    try? fm.removeItem(atPath: placeholderOf(url.path))
                    guard let s = FileStat.of(url.path) else { throw LibraryError(.io, "The file vanished after writing.", path: path) }
                    result = .written(etag: s.etag)
                } catch {
                    inner = (error as? LibraryError) ?? LibraryError(.io, error.localizedDescription, path: path)
                }
            }
            if let inner { throw inner }
            if let error { throw Self.ioError(error, path) }
            guard let result else { throw LibraryError(.io, "Nothing was written.", path: path) }
            return result
        }
    }

    // MARK: remove

    func remove(_ path: String, ifMatch: String?) throws {
        let a = try abs(path)
        try access {
            let current = currentEtag(a)
            if current.isEmpty { return }
            if let ifMatch, ifMatch != current { throw LibraryError(.mismatch, "Changed since read.", path: path) }
            let target = current.hasPrefix("p") ? placeholderOf(a) : a
            var inner: Error?
            var error: NSError?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: URL(fileURLWithPath: target), options: .forDeleting, error: &error) { url in
                if let ifMatch, !current.hasPrefix("p"), currentEtag(a) != ifMatch {
                    inner = LibraryError(.mismatch, "Changed since read.", path: path)
                    return
                }
                do {
                    try fm.removeItem(at: url)
                } catch let e as NSError where e.domain == NSCocoaErrorDomain && e.code == NSFileNoSuchFileError {
                    // Gone already.
                } catch {
                    inner = LibraryError(.io, error.localizedDescription, path: path)
                }
            }
            if let inner { throw inner }
            if let error { throw Self.ioError(error, path) }
            Self.fsync((a as NSString).deletingLastPathComponent)
            // Empty folders a remove leaves behind (history/<id>/, files/<aa>/) go too; the top-level ones stay.
            let rootPath = realRoot
            var dir = (a as NSString).deletingLastPathComponent
            while dir.hasPrefix(rootPath + "/"), dir.dropFirst(rootPath.count + 1).split(separator: "/").count >= 2 {
                guard (try? fm.contentsOfDirectory(atPath: dir))?.isEmpty == true, (try? fm.removeItem(atPath: dir)) != nil else { break }
                dir = (dir as NSString).deletingLastPathComponent
            }
        }
    }

    // MARK: providers

    static func versionId(_ v: NSFileVersion) -> String {
        SHA256.hash(data: Data(v.url.path.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    func conflictVersions(_ path: String) throws -> [(id: String, bytes: Data)] {
        let a = try abs(path)
        return try access {
            var out: [(id: String, bytes: Data)] = []
            for v in NSFileVersion.unresolvedConflictVersionsOfItem(at: URL(fileURLWithPath: a)) ?? [] {
                var data: Data?
                NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: v.url, options: [], error: nil) { u in data = try? Data(contentsOf: u) }
                // A version whose bytes can't be read now is left for later (it stays unresolved).
                if let data { out.append((Self.versionId(v), data)) }
            }
            return out
        }
    }

    func resolveConflicts(_ path: String, ids: [String]) throws {
        let a = try abs(path)
        guard !ids.isEmpty else { return }
        try access {
            let wanted = Set(ids)
            var inner: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: URL(fileURLWithPath: a), options: [], error: nil) { _ in
                for v in NSFileVersion.unresolvedConflictVersionsOfItem(at: URL(fileURLWithPath: a)) ?? [] where wanted.contains(Self.versionId(v)) {
                    do {
                        v.isResolved = true
                        try v.remove()
                    } catch {
                        inner = LibraryError(.io, error.localizedDescription, path: path)
                    }
                }
            }
            if let inner { throw inner }
        }
    }

    func startDownload(_ paths: [String]) throws {
        let all = try paths.map { try abs($0) }
        try access { for a in all { try? fm.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: a)) } }
    }

    /// Clears `.folevi-tmp/` of files a crash left behind (older than a minute, so a write in flight is safe).
    func cleanTemp(now: Date = Date()) {
        try? access {
            let dir = (realRoot as NSString).appendingPathComponent(LibraryPaths.tmpDir)
            for name in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] {
                let p = (dir as NSString).appendingPathComponent(name)
                if let s = FileStat.of(p), now.timeIntervalSince1970 * 1000 - s.mtimeMs > 60_000 { try? fm.removeItem(atPath: p) }
            }
        }
    }

    /// Whether Folevi can write here: the folder exists (or can be made) and a probe file goes in and out.
    func probeWritable() -> Bool {
        (try? access { () -> Bool in
            let dir = (root.path as NSString).appendingPathComponent(LibraryPaths.tmpDir)
            try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let probe = (dir as NSString).appendingPathComponent("probe-\(UUID().uuidString)")
            guard fm.createFile(atPath: probe, contents: Data()) else { return false }
            try fm.removeItem(atPath: probe)
            return true
        }) ?? false
    }

    static func fsync(_ path: String) {
        let fd = open(path, O_RDONLY)
        guard fd >= 0 else { return }
        if fcntl(fd, F_FULLFSYNC) != 0 { _ = Darwin.fsync(fd) }
        close(fd)
    }

    static func ioError(_ error: NSError, _ path: String) -> LibraryError {
        if error.domain == NSCocoaErrorDomain && (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError) {
            return LibraryError(.notFound, "No such file.", path: path)
        }
        return LibraryError(.io, error.localizedDescription, path: path)
    }
}
