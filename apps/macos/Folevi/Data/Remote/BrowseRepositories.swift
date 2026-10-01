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

    func renameFolder(_ folderId: String, name: String) async throws {
        try await convex.mutationVoid("organization:renameFolder", ["folderId": .string(folderId), "name": .string(name)])
    }

    func setFolderColor(_ folderId: String, color: String?) async throws {
        try await convex.mutationVoid("organization:setFolderColor", ["folderId": .string(folderId), "color": color.map { .string($0) } ?? .null])
    }

    /// Moves a folder to the top level (`parentFolderId` nil) or into another folder.
    func moveFolder(_ folderId: String, parentFolderId: String?) async throws {
        try await convex.mutationVoid("organization:moveFolder", ["folderId": .string(folderId), "parentFolderId": parentFolderId.map { .string($0) } ?? .null])
    }

    func deleteFolder(_ folderId: String) async throws {
        try await convex.mutationVoid("organization:deleteFolder", ["folderId": .string(folderId)])
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
