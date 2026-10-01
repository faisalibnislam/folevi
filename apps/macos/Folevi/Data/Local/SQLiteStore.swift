import Foundation
import SQLite3

/// Local persistence: documents, block entities, the durable op log, conflicts, uploads, the sync cursor,
/// a small key-value table and the attachment cache index. System libsqlite3, WAL mode, versioned
/// migrations. Every sync state change is written in a single transaction before it is acknowledged
/// to the UI, so a crash never loses an edit that was shown on screen.
public actor SQLiteStore {
    public enum StoreError: Error, CustomStringConvertible {
        case open(String)
        case sql(String)
        public var description: String {
            switch self {
            case .open(let m): return "open: \(m)"
            case .sql(let m): return "sql: \(m)"
            }
        }
    }

    nonisolated(unsafe) private var db: OpaquePointer?
    public let url: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    static let currentSchemaVersion = 3

    public init(url: URL) throws {
        self.url = url
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK, let handle else {
            let msg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            sqlite3_close(handle)
            throw StoreError.open(msg)
        }
        db = handle
        try SQLiteStore.exec(handle, "PRAGMA journal_mode=WAL;")
        try SQLiteStore.exec(handle, "PRAGMA synchronous=NORMAL;")
        try SQLiteStore.exec(handle, "PRAGMA foreign_keys=ON;")
        try SQLiteStore.migrate(handle)
    }

    deinit {
        if let db { sqlite3_close_v2(db) }
    }

    /// Default location inside the app container (Application Support/Folevi/<account>/folevi.sqlite).
    public static func defaultURL(account: String) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let safe = account.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? String($0) : "_" }.joined()
        return base.appendingPathComponent("Folevi", isDirectory: true)
            .appendingPathComponent(safe.isEmpty ? "default" : String(safe.prefix(64)), isDirectory: true)
            .appendingPathComponent("folevi.sqlite")
    }

    public func close() {
        if let db { sqlite3_close_v2(db) }
        db = nil
    }

    // MARK: - Migrations

    private static let migrations: [Int: [String]] = [
        1: [
            "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            """
            CREATE TABLE IF NOT EXISTS documents (
              id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, json TEXT NOT NULL, updated_at REAL NOT NULL DEFAULT 0
            )
            """,
            "CREATE INDEX IF NOT EXISTS documents_workspace ON documents(workspace_id, updated_at)",
            """
            CREATE TABLE IF NOT EXISTS blocks (
              id TEXT PRIMARY KEY, document_id TEXT NOT NULL, json TEXT NOT NULL, server_revision INTEGER, deleted INTEGER NOT NULL DEFAULT 0
            )
            """,
            "CREATE INDEX IF NOT EXISTS blocks_document ON blocks(document_id)",
            "CREATE TABLE IF NOT EXISTS ops (position INTEGER PRIMARY KEY, op_id TEXT NOT NULL, inflight INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS conflicts (position INTEGER PRIMARY KEY, id TEXT NOT NULL, json TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS uploads (position INTEGER PRIMARY KEY, upload_id TEXT NOT NULL, json TEXT NOT NULL)",
        ],
        2: [
            """
            CREATE TABLE IF NOT EXISTS files (
              file_id TEXT PRIMARY KEY, local_path TEXT NOT NULL, mime_type TEXT, name TEXT, size INTEGER, cached_at REAL NOT NULL
            )
            """,
            "CREATE TABLE IF NOT EXISTS upload_sources (upload_id TEXT PRIMARY KEY, local_path TEXT NOT NULL, name TEXT, mime_type TEXT, kind TEXT)",
        ],
        // Pages saved before card previews existed never get one from a delta pull: start every scope's pull
        // over so each page comes back with its preview (cards keep their paragraphs and lists, as on the web).
        3: ["DELETE FROM kv WHERE key LIKE 'cursor.%'"],
    ]

    private static func migrate(_ db: OpaquePointer) throws {
        try exec(db, "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
        var applied = Set<Int>()
        try query(db, "SELECT version FROM migrations", []) { stmt in
            applied.insert(Int(sqlite3_column_int64(stmt, 0)))
        }
        for version in 1...currentSchemaVersion where !applied.contains(version) {
            try exec(db, "BEGIN IMMEDIATE")
            do {
                for sql in migrations[version] ?? [] { try exec(db, sql) }
                try run(db, "INSERT INTO migrations(version, applied_at) VALUES (?, ?)", [.int(version), .double(Date().timeIntervalSince1970)])
                try exec(db, "COMMIT")
            } catch {
                try? exec(db, "ROLLBACK")
                throw error
            }
        }
    }

    public func appliedMigrations() throws -> [Int] {
        var out: [Int] = []
        try SQLiteStore.query(try handle(), "SELECT version FROM migrations ORDER BY version", []) { out.append(Int(sqlite3_column_int64($0, 0))) }
        return out
    }

    // MARK: - Low-level helpers

    enum Bind {
        case text(String)
        case int(Int)
        case double(Double)
        case null
    }

    private func handle() throws -> OpaquePointer {
        guard let db else { throw StoreError.sql("database closed") }
        return db
    }

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private static func exec(_ db: OpaquePointer, _ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "exec failed"
            sqlite3_free(err)
            throw StoreError.sql(msg)
        }
    }

    private static func prepare(_ db: OpaquePointer, _ sql: String, _ binds: [Bind]) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw StoreError.sql(String(cString: sqlite3_errmsg(db)))
        }
        for (i, b) in binds.enumerated() {
            let idx = Int32(i + 1)
            switch b {
            case .text(let s): sqlite3_bind_text(stmt, idx, s, -1, transient)
            case .int(let v): sqlite3_bind_int64(stmt, idx, Int64(v))
            case .double(let v): sqlite3_bind_double(stmt, idx, v)
            case .null: sqlite3_bind_null(stmt, idx)
            }
        }
        return stmt
    }

    private static func run(_ db: OpaquePointer, _ sql: String, _ binds: [Bind]) throws {
        let stmt = try prepare(db, sql, binds)
        defer { sqlite3_finalize(stmt) }
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else { throw StoreError.sql(String(cString: sqlite3_errmsg(db))) }
    }

    private static func query(_ db: OpaquePointer, _ sql: String, _ binds: [Bind], _ row: (OpaquePointer) throws -> Void) throws {
        let stmt = try prepare(db, sql, binds)
        defer { sqlite3_finalize(stmt) }
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_ROW { try row(stmt) } else if rc == SQLITE_DONE { break } else {
                throw StoreError.sql(String(cString: sqlite3_errmsg(db)))
            }
        }
    }

    private static func text(_ stmt: OpaquePointer, _ col: Int32) -> String? {
        guard let c = sqlite3_column_text(stmt, col) else { return nil }
        return String(cString: c)
    }

    private func transaction(_ body: (OpaquePointer) throws -> Void) throws {
        let db = try handle()
        try SQLiteStore.exec(db, "BEGIN IMMEDIATE")
        do {
            try body(db)
            try SQLiteStore.exec(db, "COMMIT")
        } catch {
            try? SQLiteStore.exec(db, "ROLLBACK")
            throw error
        }
    }

    private func json<T: Encodable>(_ value: T) throws -> String {
        String(decoding: try encoder.encode(value), as: UTF8.self)
    }

    // MARK: - Key-value

    public func setValue(_ value: String?, forKey key: String) throws {
        let db = try handle()
        if let value {
            try SQLiteStore.run(db, "INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [.text(key), .text(value)])
        } else {
            try SQLiteStore.run(db, "DELETE FROM kv WHERE key = ?", [.text(key)])
        }
    }

    public func value(forKey key: String) throws -> String? {
        var out: String?
        try SQLiteStore.query(try handle(), "SELECT value FROM kv WHERE key = ?", [.text(key)]) { out = SQLiteStore.text($0, 0) }
        return out
    }

    public func setCodable<T: Encodable>(_ value: T?, forKey key: String) throws {
        try setValue(try value.map { try json($0) }, forKey: key)
    }

    public func codable<T: Decodable>(_ type: T.Type, forKey key: String) throws -> T? {
        guard let s = try value(forKey: key) else { return nil }
        return try? decoder.decode(T.self, from: Data(s.utf8))
    }

    // MARK: - Documents

    public func upsertDocuments(_ docs: [DocumentSummary]) throws {
        guard !docs.isEmpty else { return }
        try transaction { db in
            for d in docs {
                try SQLiteStore.run(db, """
                    INSERT INTO documents(id, workspace_id, json, updated_at) VALUES(?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, json = excluded.json, updated_at = excluded.updated_at
                    """, [.text(d.id), .text(d.storeKey), .text(try json(d)), .double(d.updatedAt)])
            }
        }
    }

    /// The pages filed under a scope's store key (`Scope.storeKey`, `DocumentSummary.storeKey`).
    public func documents(storeKey: String) throws -> [DocumentSummary] {
        var out: [DocumentSummary] = []
        try SQLiteStore.query(try handle(), "SELECT json FROM documents WHERE workspace_id = ? ORDER BY updated_at DESC", [.text(storeKey)]) { stmt in
            if let s = SQLiteStore.text(stmt, 0), let d = try? decoder.decode(DocumentSummary.self, from: Data(s.utf8)) { out.append(d) }
        }
        return out
    }

    public func document(id: String) throws -> DocumentSummary? {
        var out: DocumentSummary?
        try SQLiteStore.query(try handle(), "SELECT json FROM documents WHERE id = ?", [.text(id)]) { stmt in
            if let s = SQLiteStore.text(stmt, 0) { out = try? decoder.decode(DocumentSummary.self, from: Data(s.utf8)) }
        }
        return out
    }

    public func deleteDocument(id: String) throws {
        try SQLiteStore.run(try handle(), "DELETE FROM documents WHERE id = ?", [.text(id)])
    }

    // MARK: - Sync state (entities, op log, conflicts, uploads, errors)

    /// Loads the durable sync state. Ops that were in flight when the app stopped are put back at the
    /// front of `pending` (same opIds, so replays are idempotent on the server).
    public func loadSyncState() throws -> SyncState {
        let db = try handle()
        var state = SyncState()
        try SQLiteStore.query(db, "SELECT id, document_id, json, server_revision, deleted FROM blocks", []) { stmt in
            guard let id = SQLiteStore.text(stmt, 0), let docId = SQLiteStore.text(stmt, 1), let js = SQLiteStore.text(stmt, 2),
                  let block = try? decoder.decode(WireBlock.self, from: Data(js.utf8)) else { return }
            let rev: Int? = sqlite3_column_type(stmt, 3) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 3))
            state.blocks[id] = SyncEntity(documentId: docId, block: block, serverRevision: rev, deleted: sqlite3_column_int(stmt, 4) != 0)
        }
        var inflight: [SyncOp] = []
        var pending: [SyncOp] = []
        try SQLiteStore.query(db, "SELECT json, inflight FROM ops ORDER BY position", []) { stmt in
            guard let js = SQLiteStore.text(stmt, 0), let op = try? decoder.decode(SyncOp.self, from: Data(js.utf8)) else { return }
            if sqlite3_column_int(stmt, 1) != 0 { inflight.append(op) } else { pending.append(op) }
        }
        state.pending = inflight + pending
        try SQLiteStore.query(db, "SELECT json FROM conflicts ORDER BY position", []) { stmt in
            if let js = SQLiteStore.text(stmt, 0), let c = try? decoder.decode(ConflictRecord.self, from: Data(js.utf8)) { state.conflicts.append(c) }
        }
        try SQLiteStore.query(db, "SELECT json FROM uploads ORDER BY position", []) { stmt in
            if let js = SQLiteStore.text(stmt, 0), var u = try? decoder.decode(UploadRecord.self, from: Data(js.utf8)) {
                if u.state == .uploading { u.state = .queued }
                state.uploads.append(u)
            }
        }
        if let errs = try codable([SyncErrorRecord].self, forKey: "sync.errors") { state.errors = errs }
        return state
    }

    /// Persists a new sync state. `touchedBlockIds` limits entity writes (nil = write every entity).
    public func persist(_ state: SyncState, touchedBlockIds: Set<String>?) throws {
        try transaction { db in
            let ids: [String] = touchedBlockIds.map(Array.init) ?? Array(state.blocks.keys)
            if touchedBlockIds == nil { try SQLiteStore.run(db, "DELETE FROM blocks", []) }
            for id in ids {
                if let e = state.blocks[id] {
                    try SQLiteStore.run(db, """
                        INSERT INTO blocks(id, document_id, json, server_revision, deleted) VALUES(?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET document_id = excluded.document_id, json = excluded.json,
                          server_revision = excluded.server_revision, deleted = excluded.deleted
                        """, [.text(id), .text(e.documentId), .text(try json(e.block)), e.serverRevision.map { .int($0) } ?? .null, .int(e.deleted ? 1 : 0)])
                } else {
                    try SQLiteStore.run(db, "DELETE FROM blocks WHERE id = ?", [.text(id)])
                }
            }
            try SQLiteStore.run(db, "DELETE FROM ops", [])
            var position = 0
            for op in state.inflight {
                try SQLiteStore.run(db, "INSERT INTO ops(position, op_id, inflight, json) VALUES(?, ?, 1, ?)", [.int(position), .text(op.opId), .text(try json(op))])
                position += 1
            }
            for op in state.pending {
                try SQLiteStore.run(db, "INSERT INTO ops(position, op_id, inflight, json) VALUES(?, ?, 0, ?)", [.int(position), .text(op.opId), .text(try json(op))])
                position += 1
            }
            try SQLiteStore.run(db, "DELETE FROM conflicts", [])
            for (i, c) in state.conflicts.enumerated() {
                try SQLiteStore.run(db, "INSERT INTO conflicts(position, id, json) VALUES(?, ?, ?)", [.int(i), .text(c.id), .text(try json(c))])
            }
            try SQLiteStore.run(db, "DELETE FROM uploads", [])
            for (i, u) in state.uploads.enumerated() {
                try SQLiteStore.run(db, "INSERT INTO uploads(position, upload_id, json) VALUES(?, ?, ?)", [.int(i), .text(u.uploadId), .text(try json(u))])
            }
            try SQLiteStore.run(db, "INSERT INTO kv(key, value) VALUES('sync.errors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                                [.text(try json(state.errors))])
        }
    }

    public func pendingOpCount() throws -> Int {
        var n = 0
        try SQLiteStore.query(try handle(), "SELECT COUNT(*) FROM ops", []) { n = Int(sqlite3_column_int64($0, 0)) }
        return n
    }

    // MARK: - Cursor

    /// The pull cursor for a scope (`Scope.storeKey`). Each scope has its own change counter.
    public func cursor(scopeKey: String) throws -> Double {
        Double(try value(forKey: "cursor.\(scopeKey)") ?? "0") ?? 0
    }

    public func setCursor(_ cursor: Double, scopeKey: String) throws {
        try setValue(JSONValue.formatNumber(cursor), forKey: "cursor.\(scopeKey)")
    }

    // MARK: - Attachment cache

    public struct CachedFile: Sendable, Hashable {
        public var fileId: String
        public var localPath: String
        public var mimeType: String?
        public var name: String?
        public var size: Int?
    }

    public func cacheFile(_ file: CachedFile) throws {
        try SQLiteStore.run(try handle(), """
            INSERT INTO files(file_id, local_path, mime_type, name, size, cached_at) VALUES(?, ?, ?, ?, ?, ?)
            ON CONFLICT(file_id) DO UPDATE SET local_path = excluded.local_path, mime_type = excluded.mime_type, name = excluded.name,
              size = excluded.size, cached_at = excluded.cached_at
            """, [.text(file.fileId), .text(file.localPath), file.mimeType.map { .text($0) } ?? .null, file.name.map { .text($0) } ?? .null,
                  file.size.map { .int($0) } ?? .null, .double(Date().timeIntervalSince1970)])
    }

    public func cachedFile(_ fileId: String) throws -> CachedFile? {
        var out: CachedFile?
        try SQLiteStore.query(try handle(), "SELECT local_path, mime_type, name, size FROM files WHERE file_id = ?", [.text(fileId)]) { stmt in
            guard let path = SQLiteStore.text(stmt, 0) else { return }
            out = CachedFile(fileId: fileId, localPath: path, mimeType: SQLiteStore.text(stmt, 1), name: SQLiteStore.text(stmt, 2),
                             size: sqlite3_column_type(stmt, 3) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 3)))
        }
        return out
    }

    public struct UploadSource: Sendable, Hashable {
        public var uploadId: String
        public var localPath: String
        public var name: String
        public var mimeType: String
        public var kind: String
    }

    public func setUploadSource(_ source: UploadSource) throws {
        try SQLiteStore.run(try handle(), "INSERT OR REPLACE INTO upload_sources(upload_id, local_path, name, mime_type, kind) VALUES(?, ?, ?, ?, ?)",
                            [.text(source.uploadId), .text(source.localPath), .text(source.name), .text(source.mimeType), .text(source.kind)])
    }

    public func uploadSource(_ uploadId: String) throws -> UploadSource? {
        var out: UploadSource?
        try SQLiteStore.query(try handle(), "SELECT local_path, name, mime_type, kind FROM upload_sources WHERE upload_id = ?", [.text(uploadId)]) { stmt in
            out = UploadSource(uploadId: uploadId, localPath: SQLiteStore.text(stmt, 0) ?? "", name: SQLiteStore.text(stmt, 1) ?? "",
                               mimeType: SQLiteStore.text(stmt, 2) ?? "application/octet-stream", kind: SQLiteStore.text(stmt, 3) ?? "file")
        }
        return out
    }

    public func removeUploadSource(_ uploadId: String) throws {
        try SQLiteStore.run(try handle(), "DELETE FROM upload_sources WHERE upload_id = ?", [.text(uploadId)])
    }

    // MARK: - Reset

    /// Wipes all local data (Settings › Offline & Sync › Reset local cache).
    public func resetAll() throws {
        try transaction { db in
            for table in ["kv", "documents", "blocks", "ops", "conflicts", "uploads", "files", "upload_sources"] {
                try SQLiteStore.run(db, "DELETE FROM \(table)", [])
            }
        }
    }
}
