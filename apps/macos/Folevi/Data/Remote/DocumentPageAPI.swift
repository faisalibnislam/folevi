import Foundation

/// Where a page lives, as the server reports it with search and recent results (the web's HomeFolder).
struct HomeFolderRef: Decodable, Sendable, Hashable {
    var id: String
    var name: String
    var color: String?
}

/// A page to move another page under (documents:recent and search:documents rows).
struct PageTarget: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String
    var kind: String?
    var homeFolder: HomeFolderRef?
}

/// Someone else on the open page right now (presence:list).
struct PresencePerson: Decodable, Sendable, Hashable, Identifiable {
    var profileId: String
    var name: String
    var color: String
    var focusedBlockId: String?
    var id: String { profileId }
}

/// documents:createSnapshot: whether a new version was saved (nothing changed since the last one: false).
struct SnapshotCreated: Decodable, Sendable {
    var created: Bool?
}

private struct CreatedTag: Decodable, Sendable { var id: String }

/// The document page's own calls (DocumentView, Inspector, MovePageDialog, VersionHistory on the web).
extension DocumentsRepository {
    /// documents:duplicate; `asTemplate` saves a copy to Templates.
    func duplicate(_ id: String, asTemplate: Bool) async throws -> DocumentSummary {
        try await convex.mutation("documents:duplicate", ["documentId": .string(id), "asTemplate": .bool(asTemplate)])
    }

    /// Nests a page under another page (nil: back to the top level).
    func move(_ id: String, parentDocumentId: String?) async throws {
        try await convex.mutationVoid("documents:move", ["documentId": .string(id), "parentDocumentId": parentDocumentId.map { .string($0) } ?? .null])
    }

    /// Saves a version now; false when nothing changed since the last one.
    func saveVersion(_ id: String) async throws -> Bool {
        let r: SnapshotCreated = try await convex.mutation("documents:createSnapshot", ["documentId": .string(id), "reason": "manual"])
        return r.created ?? true
    }

    func recentPages(scope: Scope, limit: Int = 12) async throws -> [PageTarget] {
        try await convex.query("documents:recent", ["scope": scope.arg, "limit": .number(Double(limit))])
    }

    func searchPages(scope: Scope, query: String, limit: Int = 12) async throws -> [PageTarget] {
        try await convex.query("search:documents", ["scope": scope.arg, "query": .string(query), "limit": .number(Double(limit))], timeout: 10)
    }

    func setTags(_ id: String, tagIds: [String]) async throws {
        try await convex.mutationVoid("organization:setDocumentTags", ["documentId": .string(id), "tagIds": .array(tagIds.map { .string($0) })])
    }

    func createTag(scope: Scope, name: String) async throws -> String {
        let r: CreatedTag = try await convex.mutation("organization:createTag", ["scope": scope.arg, "name": .string(name)])
        return r.id
    }

    func sidebar(scope: Scope) async throws -> SidebarData {
        try await convex.query("organization:sidebar", ["scope": scope.arg])
    }

    // MARK: Presence

    func heartbeat(_ id: String, sessionId: String, focusedBlockId: String?) async throws {
        try await convex.mutationVoid("presence:heartbeat", ["documentId": .string(id), "sessionId": .string(sessionId),
                                                             "focusedBlockId": focusedBlockId.map { .string($0) } ?? .null])
    }

    func leave(_ id: String, sessionId: String) async throws {
        try await convex.mutationVoid("presence:leave", ["documentId": .string(id), "sessionId": .string(sessionId)])
    }

    func presence(_ id: String, now: Double) async throws -> [PresencePerson] {
        try await convex.query("presence:list", ["documentId": .string(id), "now": .number(now)])
    }
}

extension DocumentSummary {
    /// The Personal or workspace the page belongs to (the web's documentScope).
    var homeScope: Scope { workspaceId.isEmpty ? .personal : .workspace(workspaceId) }
}
