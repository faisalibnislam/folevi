import Foundation

// Server calls the browse views use (Home, note lists, Folders and Tags pages, folder menus, Tasks).

private struct CreatedFolder: Decodable { var id: String }

extension OrganizationRepository {
    /// Every folder (with counts, last update and previews) and tag of a scope (organization:index).
    func index(scope: Scope) async throws -> OrganizationIndex {
        try await convex.query("organization:index", ["scope": scope.arg])
    }

    /// Creates a folder and returns its id (the Folders page opens it).
    func createFolderReturningId(scope: Scope, name: String) async throws -> String {
        let r: CreatedFolder = try await convex.mutation("organization:createFolder", ["scope": scope.arg, "name": .string(name)])
        return r.id
    }
}

extension DocumentsRepository {
    /// Manual order: puts a note between two neighbours (documents:reorder).
    func reorder(_ documentId: String, after: String?, before: String?) async throws {
        try await convex.mutationVoid("documents:reorder", [
            "documentId": .string(documentId),
            "afterDocumentId": after.map { .string($0) } ?? .null,
            "beforeDocumentId": before.map { .string($0) } ?? .null,
        ])
    }

    /// A note list in a given sort (Starred and tag pages come from the server).
    func list(scope: Scope, view: String, tagId: String?, sort: BrowseSort) async throws -> [DocumentSummary] {
        try await list(scope: scope, view: view, folderId: nil, tagId: tagId, sort: sort.rawValue)
    }
}
