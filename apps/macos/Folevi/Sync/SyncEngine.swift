import Foundation

/// What the UI needs to render sync state.
struct SyncSnapshot: Sendable, Equatable {
    var status: SyncStatus = .saved
    var pendingCount = 0
    var uploadCount = 0
    var conflicts: [ConflictRecord] = []
    var errors: [SyncErrorRecord] = []
    var isOnline = true
    var forcedOffline = false
    var lastSyncedAt: Date?
    var lastErrorMessage: String?
    /// Pages with changes still waiting on this Mac (the sync details list them, as on the web).
    var pendingDocuments: [PendingDocument] = []
    /// The session needs refreshing before changes can be sent.
    var authRequired = false
}

enum SyncEvent: Sendable {
    /// Blocks of these documents changed (local edit or server update).
    case blocks(Set<String>)
    /// Blocks of these documents changed because of the server (pull / ack normalization).
    case remoteBlocks(Set<String>)
    case documents
    case status(SyncSnapshot)
    /// The server acknowledged edits in these documents (used for idle snapshots).
    case acknowledged(Set<String>)
}

/// The sync engine for one scope (Personal or a team workspace); the op queue is the account's, shared by every scope. Owns the reducer state (docs/SYNC_PROTOCOL.md), persists every
/// change to SQLite, and runs the reconnect pipeline:
/// refresh auth → subscribe to `sync:head` → pull since cursor → reconcile (remoteUpdate) →
/// push pending ops in order (takeBatch → sync:pushJson → applyResults) → surface conflicts.
actor SyncEngine {
    let scope: Scope
    let profileId: String
    let deviceId: String
    /// Where this scope's pages and pull cursor are filed locally (`Scope.storeKey`).
    private var storeKey: String { scope.storeKey(profileId: profileId) }
    private let store: SQLiteStore
    private let convex: ConvexService
    private let files: FilesRepository
    private let monitor: ConnectionMonitor

    private(set) var state = SyncState()
    private var continuations: [UUID: AsyncStream<SyncEvent>.Continuation] = [:]

    // Connectivity inputs
    private var networkUp = true
    private var socketConnected: Bool?
    private var forcedOffline = false
    private var authReady = false

    // Pipeline
    private var running = false
    private var rerun = false
    private var headSeq: Double = 0
    private var retryDelay: Double = 0
    private var retryTask: Task<Void, Never>?
    private var debounceTask: Task<Void, Never>?
    private var headTask: Task<Void, Never>?
    private var watchTasks: [Task<Void, Never>] = []
    private var batchLimit = 100
    private var consecutiveServerFailures = 0
    private var lastSyncedAt: Date?
    private var lastErrorMessage: String?
    private var uploading = false

    // Persistence (coalescing writer: the newest state always lands last)
    private var dirtyIds = Set<String>()
    private var dirtyAll = false
    private var dirtyDocs = false
    private var flushing = false

    /// Called when the server says the token is no longer valid. Returns true when auth was refreshed.
    private var refreshAuth: (@Sendable () async -> Bool)?

    init(store: SQLiteStore, convex: ConvexService, files: FilesRepository, monitor: ConnectionMonitor, scope: Scope, profileId: String, deviceId: String) {
        self.store = store
        self.convex = convex
        self.files = files
        self.monitor = monitor
        self.scope = scope
        self.profileId = profileId
        self.deviceId = deviceId
    }

    // MARK: Lifecycle

    func start(forcedOffline: Bool, refreshAuth: @escaping @Sendable () async -> Bool) async {
        self.forcedOffline = forcedOffline
        self.refreshAuth = refreshAuth
        do {
            state = try await store.loadSyncState()
            Log.sync.info("loaded state: \(self.state.blocks.count, privacy: .public) entities, \(self.state.pending.count, privacy: .public) pending ops")
        } catch {
            Log.sync.error("failed to load sync state: \(String(describing: error), privacy: .public)")
        }
        state.connection = canTalk ? .online : .offline
        let pathStream = monitor.pathUpdates()
        let socketStream = convex.socketStates()
        watchTasks.append(Task { [weak self] in
            for await up in pathStream { await self?.setNetwork(up) }
        })
        watchTasks.append(Task { [weak self] in
            for await connected in socketStream { await self?.setSocket(connected) }
        })
        emitStatus()
    }

    func stop() {
        for t in watchTasks { t.cancel() }
        watchTasks = []
        headTask?.cancel()
        retryTask?.cancel()
        debounceTask?.cancel()
        for c in continuations.values { c.finish() }
        continuations = [:]
    }

    func events() -> AsyncStream<SyncEvent> {
        let (stream, continuation) = AsyncStream<SyncEvent>.makeStream(bufferingPolicy: .bufferingNewest(64))
        let id = UUID()
        continuations[id] = continuation
        continuation.yield(.status(snapshot))
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeContinuation(id) }
        }
        return stream
    }

    private func removeContinuation(_ id: UUID) {
        continuations[id] = nil
    }

    private func emit(_ event: SyncEvent) {
        for c in continuations.values { c.yield(event) }
    }

    private func emitStatus() {
        emit(.status(snapshot))
    }

    var snapshot: SyncSnapshot {
        var status = state.status
        if status == .saving || status == .saved, consecutiveServerFailures >= 3 { status = .error }
        if !canTalk && status != .conflict && status != .error { status = .offline }
        return SyncSnapshot(status: status, pendingCount: state.outstandingCount, uploadCount: state.uploads.count,
                            conflicts: state.conflicts, errors: state.errors, isOnline: canTalk, forcedOffline: forcedOffline,
                            lastSyncedAt: lastSyncedAt, lastErrorMessage: lastErrorMessage,
                            pendingDocuments: PendingDocument.from(ops: state.pending + state.inflight, uploads: state.uploads),
                            authRequired: state.authRequired)
    }

    // MARK: Connectivity

    private var canTalk: Bool {
        networkUp && !forcedOffline && authReady && socketConnected != false
    }

    private func setNetwork(_ up: Bool) {
        guard networkUp != up else { return }
        networkUp = up
        connectivityChanged()
    }

    private func setSocket(_ connected: Bool) {
        guard socketConnected != connected else { return }
        socketConnected = connected
        connectivityChanged()
    }

    func setForcedOffline(_ offline: Bool) {
        forcedOffline = offline
        connectivityChanged()
    }

    func isForcedOffline() -> Bool { forcedOffline }

    func setAuthReady(_ ready: Bool) {
        authReady = ready
        if ready { state.authRefreshed() }
        connectivityChanged()
    }

    private func connectivityChanged() {
        if canTalk {
            if state.connection == .offline { state.setConnection(.online) }
            ensureHeadSubscription()
            retryDelay = 0
            kick()
        } else {
            if state.connection == .online { state.setConnection(.offline) }
            headTask?.cancel()
            headTask = nil
        }
        emitStatus()
    }

    private func ensureHeadSubscription() {
        guard headTask == nil else { return }
        let stream: AsyncThrowingStream<HeadResponse, Error> = convex.subscribe("sync:head", ["scope": scope.arg])
        headTask = Task { [weak self] in
            do {
                for try await head in stream { await self?.onHead(head.seq) }
            } catch {
                Log.sync.error("head subscription ended: \(ConvexService.mapError(error).code, privacy: .public)")
            }
            await self?.headEnded()
        }
    }

    private func headEnded() async {
        headTask = nil
        guard canTalk else { return }
        try? await Task.sleep(for: .seconds(3))
        if canTalk { ensureHeadSubscription() }
    }

    private func onHead(_ seq: Double) async {
        if socketConnected == nil { socketConnected = true }
        headSeq = max(headSeq, seq)
        let cursor = (try? await store.cursor(scopeKey: storeKey)) ?? 0
        if seq > cursor { kick() }
    }

    // MARK: Local edits

    func blocks(documentId: String) -> [WireBlock] {
        state.liveBlocks(documentId: documentId)
    }

    func hasLocalBlocks(documentId: String) -> Bool {
        state.blocks.values.contains { $0.documentId == documentId }
    }

    func entity(_ blockId: String) -> SyncEntity? { state.blocks[blockId] }

    func todoBlocks() -> [(documentId: String, block: WireBlock)] {
        state.blocks.values.filter { !$0.deleted && $0.block.type == "todo" }.map { ($0.documentId, $0.block) }
    }

    /// Applies local block edits: each upsert/delete/restore becomes an op (coalesced by the reducer).
    /// `restoring` brings back deleted blocks (Undo): restore when the entity is a tombstone, otherwise
    /// re-create it with an upsert (blocks that never reached the server are forgotten on delete).
    func applyLocal(documentId: String, upserts: [(WireBlock, [ChangedField])] = [], deletes: [String] = [], restoring: [WireBlock] = []) {
        var touched = Set<String>()
        for (block, fields) in upserts {
            state.localUpsert(opId: ULID.make(), documentId: documentId, block: block, fields: fields)
            touched.insert(block.id)
        }
        for id in deletes {
            state.localDelete(opId: ULID.make(), documentId: documentId, blockId: id)
            touched.insert(id)
        }
        for block in restoring {
            if let entity = state.blocks[block.id], entity.deleted {
                state.localRestore(opId: ULID.make(), documentId: documentId, blockId: block.id)
                if !entity.block.sameContent(as: block) || entity.block.parentId != block.parentId || entity.block.rank != block.rank {
                    state.localUpsert(opId: ULID.make(), documentId: documentId, block: block, fields: [.content, .position])
                }
            } else {
                state.localUpsert(opId: ULID.make(), documentId: documentId, block: block, fields: [.content, .position])
            }
            touched.insert(block.id)
        }
        markDirty(touched)
        emit(.blocks([documentId]))
        emitStatus()
        scheduleKick()
    }

    /// Feeds server rows fetched outside the pull stream (e.g. blocks:list for a shared document).
    func ingestRemote(documentId: String, blocks: [WireBlock]) {
        var touched = Set<String>()
        for b in blocks {
            state.remoteUpdate(documentId: documentId, block: b, deleted: false)
            touched.insert(b.id)
        }
        markDirty(touched)
    }

    func documents() async -> [DocumentSummary] {
        (try? await store.documents(storeKey: storeKey)) ?? []
    }

    func document(_ id: String) async -> DocumentSummary? {
        try? await store.document(id: id)
    }

    func createDocument(_ create: WireDocumentCreate, summary: DocumentSummary, blocks: [WireBlock]) async {
        try? await store.upsertDocuments([summary])
        state.enqueueDocumentCreate(opId: ULID.make(), document: create)
        for b in blocks {
            state.localUpsert(opId: ULID.make(), documentId: create.id, block: b, fields: [.content, .position])
        }
        markDirty(Set(blocks.map(\.id)))
        emit(.documents)
        emit(.blocks([create.id]))
        emitStatus()
        scheduleKick()
    }

    func updateDocument(_ id: String, patch: WireDocumentPatch) async {
        guard var doc = try? await store.document(id: id) else { return }
        doc.apply(patch, now: Date().timeIntervalSince1970 * 1000)
        try? await store.upsertDocuments([doc])
        state.enqueueDocumentUpdate(opId: ULID.make(), documentId: id, patch: patch, baseRevision: doc.revision > 0 ? doc.revision : nil)
        markDirty([])
        emit(.documents)
        emitStatus()
        scheduleKick()
    }

    /// Stores a server summary (e.g. after an online-only mutation like star/trash).
    func storeDocuments(_ docs: [DocumentSummary]) async {
        let outstanding = state.documentsWithOutstandingOps
        let fresh = docs.filter { !outstanding.contains($0.id) }
        try? await store.upsertDocuments(fresh)
        emit(.documents)
    }

    func resolveConflict(_ conflictId: String, choice: ConflictChoice) {
        guard let record = state.conflicts.first(where: { $0.id == conflictId }) else { return }
        var newId: String?
        var newRank: String?
        if choice == .both {
            let siblings = state.liveBlocks(documentId: record.documentId)
            let anchor = state.blocks[record.blockId]?.block ?? record.client
            newId = ULID.make()
            newRank = (try? Tree.rankForPosition(siblings, parentId: anchor.parentId, afterId: anchor.id)) ?? Rank.betweenOrAfter(anchor.rank, nil)
        }
        do {
            try state.resolveConflict(conflictId: conflictId, choice: choice, opId: ULID.make(), newBlockId: newId, newRank: newRank)
        } catch {
            Log.sync.error("resolve conflict failed")
            return
        }
        markDirty(Set([record.blockId] + (newId.map { [$0] } ?? [])))
        emit(.blocks([record.documentId]))
        emitStatus()
        scheduleKick()
    }

    func clearErrors() {
        state.clearErrors()
        consecutiveServerFailures = 0
        lastErrorMessage = nil
        markDirty([])
        emitStatus()
        kick()
    }

    // MARK: Uploads

    /// Copies the file into the container (sandbox access may end after the drop), queues the upload and
    /// holds the block op back until the file is finalized.
    func queueUpload(fileURL: URL, documentId: String, block: WireBlock, kind: String) async throws {
        let uploadId = ULID.make()
        let dir = FilesRepository.cacheDirectory.appendingPathComponent("pending", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(uploadId + "-" + fileURL.lastPathComponent)
        try FileManager.default.copyItem(at: fileURL, to: dest)
        try await store.setUploadSource(.init(uploadId: uploadId, localPath: dest.path, name: fileURL.lastPathComponent,
                                              mimeType: FilesRepository.mimeType(for: fileURL), kind: kind))
        state.queueUpload(uploadId: uploadId, documentId: documentId, blockId: block.id)
        state.localUpsert(opId: ULID.make(), documentId: documentId, block: block, fields: [.content, .position], blockedBy: uploadId)
        markDirty([block.id])
        emit(.blocks([documentId]))
        emitStatus()
        kick()
    }

    func localUploadPath(blockId: String) async -> String? {
        guard let upload = state.uploads.first(where: { $0.blockId == blockId }) else { return nil }
        return try? await store.uploadSource(upload.uploadId)?.localPath
    }

    private func processUploads() async {
        guard !uploading, canTalk else { return }
        uploading = true
        defer { uploading = false }
        for upload in state.uploads where upload.state == .queued || (upload.state == .failed && upload.attempts < 8) {
            guard canTalk else { return }
            guard let source = try? await store.uploadSource(upload.uploadId) else { continue }
            if upload.state == .failed {
                try? await Task.sleep(for: .seconds(min(60, pow(2, Double(upload.attempts)))))
            }
            do {
                let result = try await files.upload(fileURL: URL(fileURLWithPath: source.localPath), scope: scope,
                                                    documentId: upload.documentId, kind: source.kind)
                var patchProps: [String: JSONValue] = [:]
                if let w = result.width { patchProps["naturalWidth"] = .number(w) }
                if let h = result.height { patchProps["naturalHeight"] = .number(h) }
                if var entity = state.blocks[upload.blockId], !patchProps.isEmpty, var props = entity.block.props.objectValue {
                    for (k, v) in patchProps { props[k] = v }
                    entity.block.props = .object(props)
                    state.blocks[upload.blockId] = entity
                }
                state.uploadCompleted(uploadId: upload.uploadId, fileId: result.fileId)
                try? await store.removeUploadSource(upload.uploadId)
                try? FileManager.default.removeItem(atPath: source.localPath)
                Log.files.info("upload finalized \(upload.uploadId, privacy: .public)")
            } catch {
                state.uploadFailed(upload.uploadId)
                Log.files.error("upload failed \(upload.uploadId, privacy: .public): \(ConvexService.mapError(error).code, privacy: .public)")
            }
            markDirty([upload.blockId])
            emit(.blocks([upload.documentId]))
            emitStatus()
        }
    }

    // MARK: Pipeline

    /// Debounced kick after typing, so a burst becomes one batch.
    private func scheduleKick() {
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await self?.kick()
        }
    }

    func syncNow() {
        retryDelay = 0
        consecutiveServerFailures = 0
        kick()
    }

    func kick() {
        if running {
            rerun = true
            return
        }
        guard canTalk else {
            emitStatus()
            return
        }
        running = true
        Task { await self.runLoop() }
    }

    private func runLoop() async {
        repeat {
            rerun = false
            await runOnce()
        } while rerun && canTalk
        running = false
        emitStatus()
    }

    private func runOnce() async {
        guard canTalk else { return }
        if state.connection == .offline { state.setConnection(.online) }
        emitStatus()
        do {
            try await pullAll()
            await processUploads()
            try await pushAll()
            let cursor = (try? await store.cursor(scopeKey: storeKey)) ?? 0
            if headSeq > cursor { try await pullAll() }
            lastSyncedAt = Date()
            retryDelay = 0
            consecutiveServerFailures = 0
            lastErrorMessage = nil
        } catch let error as FoleviError {
            handleFailure(error)
        } catch {
            handleFailure(ConvexService.mapError(error))
        }
        emitStatus()
    }

    private func handleFailure(_ error: FoleviError) {
        Log.sync.error("sync pass failed: \(error.code, privacy: .public)")
        if error.isNetwork {
            if state.connection == .online { state.setConnection(.offline) }
            socketConnected = false
            lastErrorMessage = nil
            scheduleRetry()
        } else if error.code == "unauthenticated" {
            Task { [weak self] in
                guard let self else { return }
                let ok = await self.refreshAuth?() ?? false
                await self.authRefreshResult(ok)
            }
        } else {
            consecutiveServerFailures += 1
            lastErrorMessage = error.localizedDescription
            batchLimit = max(1, batchLimit / 2)
            scheduleRetry()
        }
    }

    private func authRefreshResult(_ ok: Bool) {
        if ok {
            state.authRefreshed()
            markDirty([])
            kick()
        } else {
            lastErrorMessage = String(localized: "Your session expired. Sign in again to sync.")
            emitStatus()
        }
    }

    private func scheduleRetry() {
        retryTask?.cancel()
        retryDelay = retryDelay == 0 ? 2 : min(60, retryDelay * 2)
        let delay = retryDelay
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.retryNow()
        }
    }

    private func retryNow() {
        // A retry is also a reachability probe: assume the socket may be back.
        if socketConnected == false, networkUp { socketConnected = nil }
        if canTalk, state.connection == .offline { state.setConnection(.online) }
        kick()
    }

    private func pullAll() async throws {
        var cursor = try await store.cursor(scopeKey: storeKey)
        var changedDocs = Set<String>()
        var anyDocuments = false
        while true {
            let json: String = try await convex.query("sync:pullJson", [
                "scope": scope.arg, "cursor": .number(cursor), "limit": 300,
            ], timeout: 15)
            let page = try JSONDecoder().decode(PullResponse.self, from: Data(json.utf8))
            if !page.documents.isEmpty {
                let outstanding = state.documentsWithOutstandingOps
                let docs = page.documents.filter { !outstanding.contains($0.id) }
                try await store.upsertDocuments(docs)
                anyDocuments = true
            }
            var touched = Set<String>()
            for row in page.blocks {
                let before = state.blocks[row.block.id]
                state.remoteUpdate(documentId: row.documentId, block: row.block, deleted: row.deleted)
                if state.blocks[row.block.id] != before {
                    touched.insert(row.block.id)
                    changedDocs.insert(row.documentId)
                }
            }
            if !touched.isEmpty { markDirty(touched) }
            cursor = page.nextCursor
            try await store.setCursor(cursor, scopeKey: storeKey)
            headSeq = max(headSeq, page.head)
            if !page.hasMore { break }
        }
        if anyDocuments { emit(.documents) }
        if !changedDocs.isEmpty {
            emit(.blocks(changedDocs))
            emit(.remoteBlocks(changedDocs))
        }
    }

    private func pushAll() async throws {
        while true {
            state.takeBatch(max: batchLimit)
            let batch = state.inflight
            if batch.isEmpty { return }
            markDirty([])
            emitStatus()
            let payload: String
            do {
                let data = try JSONEncoder().encode(batch.map(\.forWire))
                payload = String(decoding: data, as: UTF8.self)
            } catch {
                state.batchFailed(.server)
                throw FoleviError.invalidResponse("encode")
            }
            let resultJSON: String
            do {
                resultJSON = try await convex.mutation("sync:pushJson", [
                    "scope": scope.arg, "deviceId": .string(deviceId), "payload": .string(payload),
                ], timeout: 30)
            } catch {
                let mapped = ConvexService.mapError(error)
                if mapped.code == "unauthenticated" || mapped.code == "session_revoked" {
                    state.batchFailed(.unauthenticated)
                } else if mapped.isNetwork {
                    state.batchFailed(.network)
                } else {
                    state.batchFailed(.server)
                }
                markDirty([])
                throw mapped
            }
            let results: [OpResult]
            do {
                results = try JSONDecoder().decode([OpResult].self, from: Data(resultJSON.utf8))
            } catch {
                state.batchFailed(.server)
                markDirty([])
                throw FoleviError.invalidResponse("push results")
            }
            await handleDocumentResults(batch: batch, results: results)
            let touched = Set(batch.compactMap(\.targetBlockId))
            let docs = Set(batch.compactMap(\.targetDocumentId))
            let before = state.blocks
            state.applyResults(results)
            markDirty(touched)
            batchLimit = min(100, batchLimit * 2)
            consecutiveServerFailures = 0
            // Server normalization (e.g. re-parenting) or conflicts change what the editor shows.
            let changed = touched.filter { before[$0] != state.blocks[$0] }
            let changedDocs = Set(changed.compactMap { state.blocks[$0]?.documentId ?? before[$0]?.documentId })
            if !changedDocs.isEmpty {
                emit(.blocks(changedDocs))
                emit(.remoteBlocks(changedDocs))
            }
            let acked = Set(results.filter { $0.status == .applied || $0.status == .duplicate }.map(\.opId))
            let ackedDocs = Set(batch.filter { acked.contains($0.opId) }.compactMap(\.targetDocumentId))
            if !ackedDocs.isEmpty { emit(.acknowledged(ackedDocs.intersection(docs))) }
            Log.sync.info("pushed \(batch.count, privacy: .public) ops: \(results.filter { $0.status == .applied }.count, privacy: .public) applied, \(results.filter { $0.status == .conflict }.count, privacy: .public) conflicts, \(results.filter { $0.status == .rejected }.count, privacy: .public) rejected")
            emitStatus()
        }
    }

    /// The reducer ignores document ops; record their outcome here.
    private func handleDocumentResults(batch: [SyncOp], results: [OpResult]) async {
        let byId = Dictionary(results.map { ($0.opId, $0) }, uniquingKeysWith: { _, b in b })
        var docs: [DocumentSummary] = []
        for op in batch where op.kind == .documentCreate || op.kind == .documentUpdate {
            guard let r = byId[op.opId] else { continue }
            switch r.status {
            case .applied, .duplicate:
                if let d = r.document { docs.append(d) }
            case .conflict:
                // Title changed elsewhere (or a daily note already exists): adopt the server's version.
                if let d = r.document { docs.append(d) }
                lastErrorMessage = String(localized: "A title was changed on another device; the newer title was kept.")
            case .rejected:
                state.errors.append(SyncErrorRecord(opId: op.opId, code: r.error?.code ?? "rejected"))
            }
        }
        if !docs.isEmpty {
            // Keep local optimistic values while more document ops for the same doc are still queued.
            let stillQueued = Set(state.pending.filter { $0.kind == .documentCreate || $0.kind == .documentUpdate }.compactMap(\.targetDocumentId))
            try? await store.upsertDocuments(docs.filter { !stillQueued.contains($0.id) })
            emit(.documents)
        }
    }

    // MARK: Persistence

    private func markDirty(_ ids: Set<String>) {
        dirtyIds.formUnion(ids)
        dirtyDocs = true
        guard !flushing else { return }
        flushing = true
        Task { await self.flush() }
    }

    private func flush() async {
        while dirtyDocs || dirtyAll || !dirtyIds.isEmpty {
            let snapshot = state
            let ids = dirtyIds
            let all = dirtyAll
            dirtyIds = []
            dirtyAll = false
            dirtyDocs = false
            do {
                try await store.persist(snapshot, touchedBlockIds: all ? nil : ids)
            } catch {
                Log.store.error("persist failed: \(String(describing: error), privacy: .public)")
            }
        }
        flushing = false
    }

    /// Waits until everything is on disk (used before quitting and by tests).
    func flushNow() async {
        while flushing { try? await Task.sleep(for: .milliseconds(10)) }
        if !dirtyIds.isEmpty || dirtyDocs {
            flushing = true
            await flush()
        }
    }

    // MARK: Local search (offline fallback)

    func searchLocal(_ query: String, documents: [DocumentSummary]) -> [(DocumentSummary, String)] {
        let q = SearchText.normalize(query)
        guard !q.isEmpty else { return [] }
        var textByDoc: [String: String] = [:]
        for e in state.blocks.values where !e.deleted {
            let t = SearchText.blockText(e.block)
            if !t.isEmpty { textByDoc[e.documentId, default: ""] += " " + t }
        }
        var out: [(DocumentSummary, String)] = []
        for d in documents where d.deletedAt == nil {
            let body = textByDoc[d.id] ?? d.excerpt
            if SearchText.normalize(d.title).contains(q) || SearchText.normalize(body).contains(q) {
                let ranges = SearchText.highlightRanges(body, query: query)
                var snippet = String(body.prefix(140))
                if let r = ranges.first {
                    let chars = Array(body)
                    let start = max(0, r.lowerBound - 50)
                    let end = min(chars.count, r.upperBound + 70)
                    snippet = (start > 0 ? "…" : "") + String(chars[start..<end]) + (end < chars.count ? "…" : "")
                }
                out.append((d, snippet.trimmingCharacters(in: .whitespaces)))
            }
        }
        return out
    }

    // MARK: Reset

    func resetLocalCache() async {
        state = SyncState()
        state.connection = canTalk ? .online : .offline
        try? await store.resetAll()
        emit(.documents)
        emitStatus()
        kick()
    }
}
