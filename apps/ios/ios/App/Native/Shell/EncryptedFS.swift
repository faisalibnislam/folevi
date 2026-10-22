// Transparent encryption around the library folder (docs/LOCAL_MODE_PLAN.md §3.9): the page reads and writes
// plain paths and bytes; the folder holds FLV1 envelopes under HMAC names. The same mapping as local-store's
// EncryptedFs and the Mac's apps/desktop/src/library/encryptedFs.ts, with the key held in native code only.
import CryptoKit
import Foundation

final class EncryptedFS: LibraryFS {
    let inner: LibraryFS
    private let master: Data
    /// HMAC name → note id, and attachment HMAC name → sha256.
    private var noteIds: [String: String] = [:]
    private var shas: [String: String] = [:]

    init(inner: LibraryFS, masterKey: Data) throws {
        guard masterKey.count == 32 else { throw LibraryError(.invalidArgument, "The library key must be 32 bytes.") }
        self.inner = inner
        self.master = masterKey
    }

    private func noteName(_ id: String) -> String {
        let name = (try? LibraryCrypto.hmacName(master, kind: "note", id: id)) ?? id
        noteIds[name] = id
        return name
    }

    private func fileName(_ sha: String) -> String {
        let name = (try? LibraryCrypto.hmacName(master, kind: "file", id: sha)) ?? sha
        shas[name] = sha
        return name
    }

    static func plain(_ path: String) -> Bool { path == LibraryPaths.libraryFile || path.hasPrefix(LibraryPaths.tmpDir + "/") }

    /// Logical path → on-disk path (the logical path is checked first: a name can't hide a `..`).
    func physical(_ path: String) throws -> String {
        let parts = try LibraryPaths.check(path).split(separator: "/").map(String.init)
        if parts[0] == LibraryPaths.notesDir, parts.count == 2, let parsed = LibraryPaths.parseNoteFileName(parts[1]), !parsed.placeholder {
            return "\(LibraryPaths.notesDir)/\(noteName(parsed.id))\(parts[1].dropFirst(parsed.id.count))"
        }
        if parts[0] == LibraryPaths.historyDir, parts.count >= 2 {
            return ([LibraryPaths.historyDir, noteName(parts[1])] + parts.dropFirst(2)).joined(separator: "/")
        }
        if parts[0] == LibraryPaths.filesDir, parts.count == 3 {
            let name = fileName(parts[2])
            return "\(LibraryPaths.filesDir)/\(name.prefix(2))/\(name)"
        }
        return path
    }

    /// The path a file's key comes from: its canonical on-disk path (a provider's copy uses the original's).
    static func keyPath(_ physical: String) -> String {
        let parts = physical.split(separator: "/").map(String.init)
        if parts.first == LibraryPaths.notesDir, parts.count == 2, let parsed = LibraryPaths.parseNoteFileName(parts[1]) {
            return "\(LibraryPaths.notesDir)/\(parsed.id).fnote"
        }
        if parts.first == LibraryPaths.historyDir, parts.count == 3 {
            let file = parts[2]
            if let cut = file.firstIndex(where: { $0 == " " || $0 == "(" }), cut != file.startIndex, file.hasSuffix(".fver") {
                return "\(parts[0])/\(parts[1])/\(file[..<cut]).fver"
            }
        }
        return physical
    }

    func seal(_ physical: String, _ bytes: Data) throws -> Data {
        if Self.plain(physical) { return bytes }
        let key = Self.keyPath(physical)
        return physical.hasPrefix(LibraryPaths.filesDir + "/") ? try LibraryCrypto.sealStream(master, pathId: key, bytes) : try LibraryCrypto.sealFile(master, pathId: key, bytes)
    }

    func open(_ physical: String, _ bytes: Data) throws -> Data {
        if Self.plain(physical) { return bytes }
        do {
            return try LibraryCrypto.openFile(master, pathId: Self.keyPath(physical), bytes)
        } catch {
            throw LibraryError(.unreadable, "\(error)", path: physical)
        }
    }

    /// On-disk path → logical path, learning unknown names by decrypting the file. Nil if it can't be read.
    func logical(_ physical: String) -> String? {
        let parts = physical.split(separator: "/").map(String.init)
        if parts.first == LibraryPaths.notesDir, parts.count == 2 {
            guard let parsed = LibraryPaths.parseNoteFileName(parts[1]) else { return physical }
            if parsed.placeholder { return physical }
            var id = noteIds[parsed.id]
            if id == nil {
                guard let r = try? inner.read(physical) else { return nil }
                guard case .bytes(let bytes, _) = r else { return physical }
                guard let opened = try? open(physical, bytes),
                      let value = try? JSONSerialization.jsonObject(with: opened) as? [String: Any], let found = value["id"] as? String,
                      noteName(found) == parsed.id else { return nil }
                id = found
            }
            return "\(LibraryPaths.notesDir)/\(id!)\(parts[1].dropFirst(parsed.id.count))"
        }
        if parts.first == LibraryPaths.historyDir, parts.count >= 2 {
            guard let id = noteIds[parts[1]] else { return nil }
            return ([LibraryPaths.historyDir, id] + parts.dropFirst(2)).joined(separator: "/")
        }
        if parts.first == LibraryPaths.filesDir, parts.count == 3 {
            var sha = shas[parts[2]]
            if sha == nil {
                guard case .bytes(let bytes, _)? = try? inner.read(physical), let opened = try? open(physical, bytes) else { return nil }
                let found = SHA256.hash(data: opened).map { String(format: "%02x", $0) }.joined()
                guard fileName(found) == parts[2] else { return nil }
                sha = found
            }
            return "\(LibraryPaths.filesDir)/\(sha!.prefix(2))/\(sha!)"
        }
        return physical
    }

    /// The logical path for a physical one already seen (no file reads); nil when unknown.
    func knownLogical(_ physical: String) -> String? {
        let parts = physical.split(separator: "/").map(String.init)
        if parts.first == LibraryPaths.notesDir, parts.count == 2 {
            guard let parsed = LibraryPaths.parseNoteFileName(parts[1]) else { return nil }
            if parsed.placeholder { return physical }
            return noteIds[parsed.id].map { "\(LibraryPaths.notesDir)/\($0)\(parts[1].dropFirst(parsed.id.count))" }
        }
        if parts.first == LibraryPaths.historyDir, parts.count >= 2 {
            return noteIds[parts[1]].map { ([LibraryPaths.historyDir, $0] + parts.dropFirst(2)).joined(separator: "/") }
        }
        if parts.first == LibraryPaths.filesDir, parts.count == 3 {
            return shas[parts[2]].map { "\(LibraryPaths.filesDir)/\($0.prefix(2))/\($0)" }
        }
        return physical
    }

    func list(_ dir: String) throws -> [LibraryEntry] {
        let d = try LibraryPaths.checkDir(dir)
        if d.isEmpty || d == LibraryPaths.historyDir || d.hasPrefix(LibraryPaths.historyDir + "/") {
            // History folders are named after notes: learn the note names first.
            for e in try inner.list(LibraryPaths.notesDir) { _ = logical(e.path) }
        }
        var out: [LibraryEntry] = []
        for e in try inner.list(d.isEmpty ? "" : physical(d)) {
            if let path = logical(e.path) {
                var entry = e
                entry.path = path
                out.append(entry)
            }
        }
        return out
    }

    func read(_ path: String) throws -> ReadResult {
        let p = try physical(path)
        switch try inner.read(p) {
        case .notDownloaded: return .notDownloaded
        case .bytes(let bytes, let etag): return .bytes(try open(p, bytes), etag: etag)
        }
    }

    func write(_ path: String, _ bytes: Data, _ ifMatch: IfMatch) throws -> WriteResult {
        let p = try physical(path)
        return try inner.write(p, try seal(p, bytes), ifMatch)
    }

    func remove(_ path: String, ifMatch: String?) throws {
        try inner.remove(try physical(path), ifMatch: ifMatch)
    }

    func conflictVersions(_ path: String) throws -> [(id: String, bytes: Data)] {
        let p = try physical(path)
        return try inner.conflictVersions(p).map { ($0.id, try open(p, $0.bytes)) }
    }

    func resolveConflicts(_ path: String, ids: [String]) throws {
        try inner.resolveConflicts(try physical(path), ids: ids)
    }

    func startDownload(_ paths: [String]) throws {
        try inner.startDownload(try paths.map { try physical($0) })
    }
}
