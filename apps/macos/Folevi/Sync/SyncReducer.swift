import Foundation

// Exact port of packages/editor-schema/src/sync.ts. Pure and deterministic; verified against
// packages/editor-schema/fixtures/sync-scenarios.json by FoleviTests/SyncScenarioTests.
// See docs/SYNC_PROTOCOL.md for the normative rules.

public enum ChangedField: String, Codable, Sendable, Hashable, Comparable {
    case content
    case position

    public static func < (lhs: ChangedField, rhs: ChangedField) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// One offline-capable operation. A flat struct (rather than an enum) so the reducer can rebase
/// `baseRevision` and coalesce in place, like the TypeScript objects.
public struct SyncOp: Sendable, Hashable, Codable {
    public enum Kind: String, Codable, Sendable {
        case blockUpsert = "block.upsert"
        case blockDelete = "block.delete"
        case blockRestore = "block.restore"
        case documentCreate = "document.create"
        case documentUpdate = "document.update"
    }

    public var opId: String
    public var kind: Kind
    public var documentId: String?
    public var block: WireBlock?
    public var blockId: String?
    public var baseRevision: Int?
    public var fields: [ChangedField]
    public var blockedBy: String?
    public var document: WireDocumentCreate?
    public var patch: WireDocumentPatch?

    public init(opId: String, kind: Kind, documentId: String? = nil, block: WireBlock? = nil, blockId: String? = nil,
                baseRevision: Int? = nil, fields: [ChangedField] = [], blockedBy: String? = nil,
                document: WireDocumentCreate? = nil, patch: WireDocumentPatch? = nil) {
        self.opId = opId
        self.kind = kind
        self.documentId = documentId
        self.block = block
        self.blockId = blockId
        self.baseRevision = baseRevision
        self.fields = fields
        self.blockedBy = blockedBy
        self.document = document
        self.patch = patch
    }

    /// The block this op touches (TS `opBlockId`).
    public var targetBlockId: String? {
        switch kind {
        case .blockUpsert: return block?.id
        case .blockDelete, .blockRestore: return blockId
        case .documentCreate, .documentUpdate: return nil
        }
    }

    /// The document this op touches.
    public var targetDocumentId: String? {
        switch kind {
        case .documentCreate: return document?.id
        default: return documentId
        }
    }

    enum CodingKeys: String, CodingKey { case opId, kind, documentId, block, blockId, baseRevision, fields, blockedBy, document, patch }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        opId = try c.decode(String.self, forKey: .opId)
        kind = try c.decode(Kind.self, forKey: .kind)
        documentId = try c.decodeIfPresent(String.self, forKey: .documentId)
        block = try c.decodeIfPresent(WireBlock.self, forKey: .block)
        blockId = try c.decodeIfPresent(String.self, forKey: .blockId)
        baseRevision = try c.decodeFlexibleIntIfPresent(forKey: .baseRevision)
        fields = try c.decodeIfPresent([ChangedField].self, forKey: .fields) ?? []
        blockedBy = try c.decodeIfPresent(String.self, forKey: .blockedBy)
        document = try c.decodeIfPresent(WireDocumentCreate.self, forKey: .document)
        patch = try c.decodeIfPresent(WireDocumentPatch.self, forKey: .patch)
    }

    /// Encodes the exact wire shape for each kind (plus `blockedBy` for local persistence).
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(opId, forKey: .opId)
        try c.encode(kind, forKey: .kind)
        func encodeBase() throws {
            if let baseRevision { try c.encode(baseRevision, forKey: .baseRevision) } else { try c.encodeNil(forKey: .baseRevision) }
        }
        switch kind {
        case .blockUpsert:
            try c.encodeIfPresent(documentId, forKey: .documentId)
            try c.encodeIfPresent(block?.withoutRevision(), forKey: .block)
            try encodeBase()
            try c.encode(fields, forKey: .fields)
            try c.encodeIfPresent(blockedBy, forKey: .blockedBy)
        case .blockDelete:
            try c.encodeIfPresent(documentId, forKey: .documentId)
            try c.encodeIfPresent(blockId, forKey: .blockId)
            try encodeBase()
        case .blockRestore:
            try c.encodeIfPresent(documentId, forKey: .documentId)
            try c.encodeIfPresent(blockId, forKey: .blockId)
        case .documentCreate:
            try c.encodeIfPresent(document, forKey: .document)
        case .documentUpdate:
            try c.encodeIfPresent(documentId, forKey: .documentId)
            try c.encode(patch ?? WireDocumentPatch(), forKey: .patch)
            try encodeBase()
        }
    }

    /// The op as sent to `sync:pushJson` (never carries local-only fields).
    public var forWire: SyncOp {
        var op = self
        op.blockedBy = nil
        op.block = op.block?.withoutRevision()
        return op
    }
}

public enum OpStatus: String, Codable, Sendable {
    case applied, duplicate, conflict, rejected
}

public enum ConflictReason: String, Codable, Sendable {
    case content, deleted, exists
}

public struct OpResult: Codable, Sendable, Hashable {
    public struct Conflict: Codable, Sendable, Hashable {
        public var reason: ConflictReason
        public var server: WireBlock?
        public var client: WireBlock?
    }

    public struct OpError: Codable, Sendable, Hashable {
        public var code: String
        public var message: String
    }

    public var opId: String
    public var status: OpStatus
    public var revision: Int?
    public var block: WireBlock?
    public var deleted: Bool?
    public var conflict: Conflict?
    public var error: OpError?
    public var normalized: Bool?
    /// Document ops carry the server summary.
    public var document: DocumentSummary?

    public init(opId: String, status: OpStatus, revision: Int? = nil, block: WireBlock? = nil, deleted: Bool? = nil,
                conflict: Conflict? = nil, error: OpError? = nil, normalized: Bool? = nil, document: DocumentSummary? = nil) {
        self.opId = opId
        self.status = status
        self.revision = revision
        self.block = block
        self.deleted = deleted
        self.conflict = conflict
        self.error = error
        self.normalized = normalized
        self.document = document
    }

    enum CodingKeys: String, CodingKey { case opId, status, revision, block, deleted, conflict, error, normalized, document }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        opId = try c.decode(String.self, forKey: .opId)
        status = try c.decode(OpStatus.self, forKey: .status)
        revision = try c.decodeFlexibleIntIfPresent(forKey: .revision)
        block = try c.decodeIfPresent(WireBlock.self, forKey: .block)
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted)
        conflict = try c.decodeIfPresent(Conflict.self, forKey: .conflict)
        error = try c.decodeIfPresent(OpError.self, forKey: .error)
        normalized = try c.decodeIfPresent(Bool.self, forKey: .normalized)
        document = try? c.decodeIfPresent(DocumentSummary.self, forKey: .document)
    }
}

public struct SyncEntity: Codable, Sendable, Hashable {
    public var documentId: String
    public var block: WireBlock
    public var serverRevision: Int?
    public var deleted: Bool
}

public struct ConflictRecord: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var documentId: String
    public var blockId: String
    public var reason: ConflictReason
    public var server: WireBlock?
    public var client: WireBlock
}

public struct UploadRecord: Codable, Sendable, Hashable {
    public enum State: String, Codable, Sendable { case queued, uploading, failed, done }
    public var uploadId: String
    public var documentId: String
    public var blockId: String
    public var attempts: Int
    public var state: State
}

public struct SyncErrorRecord: Codable, Sendable, Hashable {
    public var opId: String
    public var code: String
}

public enum ConnectionState: String, Codable, Sendable { case online, offline }

public enum SyncStatus: String, Codable, Sendable {
    case saved, saving, offline, syncing, conflict, error
}

public enum BatchFailure: String, Sendable { case network, unauthenticated, server }

public enum ConflictChoice: String, Sendable { case theirs, mine, both }

public struct SyncState: Sendable, Hashable {
    public var blocks: [String: SyncEntity] = [:]
    public var pending: [SyncOp] = []
    public var inflight: [SyncOp] = []
    public var conflicts: [ConflictRecord] = []
    public var errors: [SyncErrorRecord] = []
    public var uploads: [UploadRecord] = []
    public var connection: ConnectionState = .online
    public var authRequired = false

    public init() {}

    private func hasOutstanding(_ blockId: String) -> Bool {
        pending.contains { $0.targetBlockId == blockId } || inflight.contains { $0.targetBlockId == blockId }
    }

    private func hasOutstanding(_ blockId: String, except opId: String) -> Bool {
        pending.contains { $0.opId != opId && $0.targetBlockId == blockId }
            || inflight.contains { $0.opId != opId && $0.targetBlockId == blockId }
    }

    // MARK: Local edits

    public mutating func localUpsert(opId: String, documentId: String, block input: WireBlock, fields: [ChangedField], blockedBy: String? = nil) {
        let block = input.withoutRevision()
        let serverRevision = blocks[block.id]?.serverRevision ?? nil
        blocks[block.id] = SyncEntity(documentId: documentId, block: block, serverRevision: serverRevision, deleted: false)

        // Coalesce with the latest not-yet-sent upsert for the same block, provided nothing touching this
        // block (a delete/restore) sits after it in the queue.
        let lastIdx = pending.lastIndex { $0.targetBlockId == block.id }
        if let lastIdx, pending[lastIdx].kind == .blockUpsert, blockedBy == nil {
            let merged = Array(Set(pending[lastIdx].fields + fields)).sorted()
            pending[lastIdx].block = block
            pending[lastIdx].fields = merged
            return
        }
        pending.append(SyncOp(opId: opId, kind: .blockUpsert, documentId: documentId, block: block,
                              baseRevision: serverRevision, fields: fields.sorted(), blockedBy: blockedBy))
    }

    public mutating func localDelete(opId: String, documentId: String, blockId: String) {
        guard var entity = blocks[blockId] else { return }
        let inflightTouches = inflight.contains { $0.targetBlockId == blockId }
        if entity.serverRevision == nil && !inflightTouches {
            // Never reached the server: forget it entirely.
            pending.removeAll { $0.targetBlockId == blockId }
            uploads.removeAll { $0.blockId == blockId }
            blocks[blockId] = nil
            return
        }
        entity.deleted = true
        blocks[blockId] = entity
        pending.append(SyncOp(opId: opId, kind: .blockDelete, documentId: documentId, blockId: blockId, baseRevision: entity.serverRevision))
    }

    public mutating func localRestore(opId: String, documentId: String, blockId: String) {
        guard var entity = blocks[blockId], entity.deleted else { return }
        entity.deleted = false
        blocks[blockId] = entity
        if let last = pending.last, last.kind == .blockDelete, last.blockId == blockId {
            // Delete never sent: cancel it instead of sending delete+restore.
            pending.removeLast()
            return
        }
        pending.append(SyncOp(opId: opId, kind: .blockRestore, documentId: documentId, blockId: blockId))
    }

    public mutating func setConnection(_ connection: ConnectionState) {
        self.connection = connection
    }

    // MARK: Batching

    /// Moves up to `max` sendable ops to `inflight`. No-op when a batch is already in flight.
    public mutating func takeBatch(max: Int = 100) {
        if !inflight.isEmpty || connection == .offline || authRequired { return }
        var blocked = Set<String>()
        var take: [SyncOp] = []
        var keep: [SyncOp] = []
        for op in pending {
            let bid = op.targetBlockId
            let isBlocked = (op.kind == .blockUpsert && op.blockedBy != nil) || (bid.map { blocked.contains($0) } ?? false)
            if isBlocked {
                if let bid, !bid.isEmpty { blocked.insert(bid) }
                keep.append(op)
            } else if take.count < max {
                take.append(op)
            } else {
                keep.append(op)
            }
        }
        inflight = take
        pending = keep
    }

    public mutating func applyResults(_ results: [OpResult]) {
        var byId: [String: OpResult] = [:]
        for r in results { byId[r.opId] = r }
        var unanswered: [SyncOp] = []
        let batch = inflight
        for op in batch {
            guard let result = byId[op.opId] else {
                unanswered.append(op)
                continue
            }
            guard let blockId = op.targetBlockId else { continue }
            switch result.status {
            case .applied, .duplicate:
                guard var entity = blocks[blockId] else { break }
                let oldRevision = entity.serverRevision
                if let rev = result.revision { entity.serverRevision = rev }
                // Rebase queued ops that were written on top of this (now acknowledged) change.
                for i in pending.indices where pending[i].targetBlockId == blockId {
                    if (pending[i].kind == .blockUpsert || pending[i].kind == .blockDelete) && pending[i].baseRevision == oldRevision {
                        pending[i].baseRevision = entity.serverRevision
                    }
                }
                let stillOutstanding = pending.contains { $0.targetBlockId == blockId }
                    || inflight.contains { $0.opId != op.opId && $0.targetBlockId == blockId && byId[$0.opId] == nil }
                if !stillOutstanding, let b = result.block {
                    entity.block = b.withoutRevision()
                }
                if let deleted = result.deleted, !stillOutstanding { entity.deleted = deleted }
                blocks[blockId] = entity
            case .conflict:
                let c = result.conflict
                let entity = blocks[blockId]
                // The most recent local content is what the person would want to keep.
                let latestLocal: WireBlock? = entity?.block ?? (op.kind == .blockUpsert ? op.block : nil)
                pending.removeAll { $0.targetBlockId == blockId }
                if let server = c?.server {
                    blocks[blockId] = SyncEntity(documentId: entity?.documentId ?? op.documentId ?? "",
                                                 block: server.withoutRevision(),
                                                 serverRevision: server.revision,
                                                 deleted: c?.reason == .deleted)
                }
                if let latestLocal {
                    conflicts.append(ConflictRecord(id: op.opId, documentId: op.documentId ?? "", blockId: blockId,
                                                    reason: c?.reason ?? .content, server: c?.server?.withoutRevision(),
                                                    client: latestLocal.withoutRevision()))
                }
            case .rejected:
                errors.append(SyncErrorRecord(opId: op.opId, code: result.error?.code ?? "rejected"))
                guard var entity = blocks[blockId] else { break }
                if let b = result.block {
                    let rev = b.revision ?? entity.serverRevision
                    entity.block = b.withoutRevision()
                    entity.serverRevision = rev
                    entity.deleted = result.deleted ?? false
                    blocks[blockId] = entity
                } else if entity.serverRevision == nil && !hasOutstanding(blockId, except: op.opId) {
                    blocks[blockId] = nil
                }
            }
        }
        inflight = []
        // Ops the server did not answer are retried first, in their original order.
        pending = unanswered + pending
        if !results.isEmpty { authRequired = false }
    }

    public mutating func batchFailed(_ reason: BatchFailure) {
        pending = inflight + pending
        inflight = []
        if reason == .unauthenticated { authRequired = true }
        if reason == .network { connection = .offline }
    }

    /// Dismisses surfaced errors (after the person has seen them).
    public mutating func clearErrors(_ opIds: [String]? = nil) {
        if let opIds { errors.removeAll { opIds.contains($0.opId) } } else { errors = [] }
    }

    public mutating func authRefreshed() {
        authRequired = false
    }

    // MARK: Remote

    /// A server row arrived via subscription or pull. Local unsent work always wins until acknowledged.
    public mutating func remoteUpdate(documentId: String, block: WireBlock, deleted: Bool) {
        let rev = block.revision ?? 0
        if let existing = blocks[block.id], let sr = existing.serverRevision, sr >= rev { return }
        if hasOutstanding(block.id) { return }
        blocks[block.id] = SyncEntity(documentId: documentId, block: block.withoutRevision(), serverRevision: rev, deleted: deleted)
    }

    // MARK: Uploads

    public mutating func queueUpload(uploadId: String, documentId: String, blockId: String) {
        uploads.append(UploadRecord(uploadId: uploadId, documentId: documentId, blockId: blockId, attempts: 0, state: .queued))
    }

    public mutating func uploadFailed(_ uploadId: String) {
        guard let i = uploads.firstIndex(where: { $0.uploadId == uploadId }) else { return }
        uploads[i].attempts += 1
        uploads[i].state = .failed
    }

    public mutating func uploadCompleted(uploadId: String, fileId: String) {
        guard let i = uploads.firstIndex(where: { $0.uploadId == uploadId }) else { return }
        uploads[i].state = .done
        let blockId = uploads[i].blockId
        var entityBlock: WireBlock?
        if var entity = blocks[blockId] {
            var props = entity.block.props.objectValue ?? [:]
            props["fileId"] = .string(fileId)
            entity.block.props = .object(props)
            blocks[blockId] = entity
            entityBlock = entity.block
        }
        for j in pending.indices where pending[j].kind == .blockUpsert && pending[j].blockedBy == uploadId {
            pending[j].block = entityBlock ?? pending[j].block
            pending[j].blockedBy = nil
        }
        uploads.removeAll { $0.state == .done }
    }

    // MARK: Conflicts

    public struct ResolveError: Error {}

    public mutating func resolveConflict(conflictId: String, choice: ConflictChoice, opId: String,
                                         newBlockId: String? = nil, newRank: String? = nil) throws {
        guard let record = conflicts.first(where: { $0.id == conflictId }) else { return }
        if choice == .both && (newBlockId == nil || newRank == nil) { throw ResolveError() }
        conflicts.removeAll { $0.id == conflictId }
        switch choice {
        case .theirs:
            return
        case .mine:
            if record.reason == .deleted {
                localRestore(opId: "\(opId)-restore", documentId: record.documentId, blockId: record.blockId)
            }
            let current = blocks[record.blockId]?.block ?? record.server ?? record.client
            var b = record.client
            b.parentId = current.parentId
            b.rank = current.rank
            localUpsert(opId: opId, documentId: record.documentId, block: b, fields: [.content])
        case .both:
            let base = blocks[record.blockId]?.block ?? record.client
            var b = record.client
            b.id = newBlockId ?? b.id
            b.parentId = base.parentId
            b.rank = newRank ?? b.rank
            localUpsert(opId: opId, documentId: record.documentId, block: b, fields: [.content, .position])
        }
    }

    // MARK: Status

    public var status: SyncStatus {
        if !conflicts.isEmpty { return .conflict }
        if !errors.isEmpty || authRequired { return .error }
        if connection == .offline { return .offline }
        if !inflight.isEmpty { return .syncing }
        if !pending.isEmpty || !uploads.isEmpty { return .saving }
        return .saved
    }

    /// Canonical projection used by contract tests (identical to TS `canonicalSyncState`).
    public var canonical: String {
        var blocksJSON: [String: JSONValue] = [:]
        for (id, e) in blocks {
            blocksJSON[id] = .object([
                "block": e.block.jsonValue,
                "deleted": .bool(e.deleted),
                "documentId": .string(e.documentId),
                "serverRevision": e.serverRevision.map { .number(Double($0)) } ?? .null,
            ])
        }
        let root: JSONValue = .object([
            "blocks": .object(blocksJSON),
            "pending": .array(pending.map(Self.opSummary)),
            "inflight": .array(inflight.map(Self.opSummary)),
            "conflicts": .array(conflicts.map { c in
                .object(["blockId": .string(c.blockId), "client": c.client.jsonValue, "id": .string(c.id), "reason": .string(c.reason.rawValue)])
            }),
            "errors": .array(errors.map { .object(["opId": .string($0.opId), "code": .string($0.code)]) }),
            "uploads": .array(uploads.map { u in
                .object([
                    "uploadId": .string(u.uploadId), "documentId": .string(u.documentId), "blockId": .string(u.blockId),
                    "attempts": .number(Double(u.attempts)), "state": .string(u.state.rawValue),
                ])
            }),
            "connection": .string(connection.rawValue),
            "authRequired": .bool(authRequired),
            "status": .string(status.rawValue),
        ])
        return root.canonicalString
    }

    static func opSummary(_ op: SyncOp) -> JSONValue {
        var base: [String: JSONValue] = ["opId": .string(op.opId), "kind": .string(op.kind.rawValue)]
        let rev: JSONValue = op.baseRevision.map { .number(Double($0)) } ?? .null
        switch op.kind {
        case .blockUpsert:
            base["blockId"] = op.block.map { .string($0.id) } ?? .null
            base["baseRevision"] = rev
            base["fields"] = .array(op.fields.map { .string($0.rawValue) })
            if let b = op.blockedBy, !b.isEmpty { base["blockedBy"] = .string(b) }
        case .blockDelete:
            base["blockId"] = op.blockId.map { .string($0) } ?? .null
            base["baseRevision"] = rev
        case .blockRestore:
            base["blockId"] = op.blockId.map { .string($0) } ?? .null
        case .documentCreate, .documentUpdate:
            break
        }
        return .object(base)
    }
}

// MARK: - Document ops (additive helpers; the TS reducer passes these through untouched)

extension SyncState {
    public mutating func enqueueDocumentCreate(opId: String, document: WireDocumentCreate) {
        pending.append(SyncOp(opId: opId, kind: .documentCreate, document: document))
    }

    /// Coalesces with the latest unsent update for the same document.
    public mutating func enqueueDocumentUpdate(opId: String, documentId: String, patch: WireDocumentPatch, baseRevision: Int?) {
        if let idx = pending.lastIndex(where: { $0.targetDocumentId == documentId && ($0.kind == .documentUpdate || $0.kind == .documentCreate) }) {
            if pending[idx].kind == .documentUpdate {
                pending[idx].patch = (pending[idx].patch ?? WireDocumentPatch()).merged(with: patch)
                return
            }
            if pending[idx].kind == .documentCreate, var doc = pending[idx].document {
                // Fold the patch into the unsent create.
                if let t = patch.title { doc.title = t }
                if let i = patch.icon { doc.icon = i }
                if let s = patch.style { doc.style = s }
                if let c = patch.cover { doc.cover = c }
                if let f = patch.folderId { doc.folderId = f }
                if let p = patch.parentDocumentId { doc.parentDocumentId = p }
                pending[idx].document = doc
                return
            }
        }
        pending.append(SyncOp(opId: opId, kind: .documentUpdate, documentId: documentId, baseRevision: baseRevision, patch: patch))
    }

    /// Documents with unsent/in-flight document ops (local wins until acknowledged).
    public var documentsWithOutstandingOps: Set<String> {
        Set((pending + inflight).filter { $0.kind == .documentCreate || $0.kind == .documentUpdate }.compactMap(\.targetDocumentId))
    }

    public func liveBlocks(documentId: String) -> [WireBlock] {
        blocks.values.filter { $0.documentId == documentId && !$0.deleted }.map(\.block)
    }

    public var outstandingCount: Int { pending.count + inflight.count }
}
