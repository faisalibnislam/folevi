import Foundation

// Online-only calls for organizing notes, workspace people, the account and support. Each server function
// checks access again; these only shape the arguments.

extension DocumentsRepository {
    /// One action on up to 50 notes (documents.MAX_BULK); notes you can't change are skipped and counted.
    func bulkUpdate(_ ids: [String], _ action: BulkAction) async throws -> BulkUpdateResult {
        try await convex.mutation("documents:bulkUpdate", ["documentIds": .array(ids.map { .string($0) }), "action": action.arg])
    }

    /// Home's Recent notes: the scope's most recently edited notes, minus the ones you removed.
    func recentNotes(scope: Scope, limit: Int = 10) async throws -> [DocumentSummary] {
        try await convex.query("documents:recentNotes", ["scope": scope.arg, "limit": .number(Double(limit))])
    }

    func hideFromRecent(_ ids: [String]) async throws -> Int {
        let r: HideFromRecentResult = try await convex.mutation("documents:hideFromRecent", ["documentIds": .array(ids.map { .string($0) })])
        return Int(r.hidden)
    }

    func showInRecent(_ ids: [String]) async throws {
        try await convex.mutationVoid("documents:showInRecent", ["documentIds": .array(ids.map { .string($0) })])
    }

    func trashSummary(scope: Scope) async throws -> TrashSummary {
        try await convex.query("documents:trashSummary", ["scope": scope.arg])
    }

    func emptyTrash(scope: Scope) async throws -> EmptyTrashResult {
        try await convex.mutation("documents:emptyTrash", ["scope": scope.arg])
    }

    /// Deletes a trashed page for good (its title typed back to confirm).
    func deletePermanently(_ id: String, confirmTitle: String) async throws {
        try await convex.mutationVoid("documents:deletePermanently", ["documentId": .string(id), "confirmTitle": .string(confirmTitle)])
    }
}

extension AccountRepository {
    func deletionBlockers() async throws -> DeletionBlockers { try await convex.query("users:deletionBlockers") }

    func requestAccountDeletion(confirmEmail: String) async throws -> ScheduledResult {
        try await convex.mutation("users:requestAccountDeletion", ["confirmEmail": .string(confirmEmail)])
    }

    func cancelAccountDeletion() async throws { try await convex.mutationVoid("users:cancelAccountDeletion") }

    func signOutOtherDevices() async throws -> Int {
        let r: RevokeOthersResult = try await convex.mutation("users:revokeOtherSessions")
        return Int(r.ended)
    }

    /// A ZIP of everything in a scope (owners and admins only in a workspace).
    func exportScope(_ scope: Scope) async throws -> ExportResult {
        try await convex.action("exports:exportScope", ["scope": scope.arg], timeout: 300)
    }

    func supportRequests() async throws -> [SupportRequest] { try await convex.query("support:myRequests") }
    func supportRequestUpdates() -> AsyncThrowingStream<[SupportRequest], Error> { convex.subscribe("support:myRequests") }

    func replyToSupportRequest(number: Int, message: String) async throws {
        try await convex.mutationVoid("support:replyToMyRequest", ["number": .number(Double(number)), "message": .string(message)])
    }
}

/// A team workspace's people and settings (owners and admins change them; the server checks every call).
struct WorkspacesRepository: Sendable {
    let convex: ConvexService

    private func ws(_ id: String, _ extra: [String: JSONValue] = [:]) -> [String: JSONValue] {
        extra.merging(["workspaceId": .string(id)]) { a, _ in a }
    }

    func members(_ workspaceId: String) async throws -> WorkspaceMembers {
        try await convex.query("workspaces:members", ws(workspaceId))
    }

    /// The member list, live (changes made anywhere show up).
    func membersUpdates(_ workspaceId: String) -> AsyncThrowingStream<WorkspaceMembers, Error> {
        convex.subscribe("workspaces:members", ws(workspaceId))
    }

    func guestsUpdates(_ workspaceId: String) -> AsyncThrowingStream<WorkspaceGuests, Error> {
        convex.subscribe("workspaces:guests", ws(workspaceId))
    }

    func invite(_ workspaceId: String, email: String, as choice: MemberRoleChoice) async throws {
        let _: JSONValue = try await convex.mutation("workspaces:invite", ws(workspaceId, choice.args.merging(["email": .string(email)]) { a, _ in a }))
    }

    func revokeInvite(_ inviteId: String) async throws {
        try await convex.mutationVoid("workspaces:revokeInvite", ["inviteId": .string(inviteId)])
    }

    func changeRole(_ workspaceId: String, profileId: String, to choice: MemberRoleChoice) async throws {
        try await convex.mutationVoid("workspaces:changeRole", ws(workspaceId, choice.args.merging(["profileId": .string(profileId)]) { a, _ in a }))
    }

    /// Removes a member, or (with your own profile id) leaves the workspace.
    func removeMember(_ workspaceId: String, profileId: String) async throws {
        try await convex.mutationVoid("workspaces:removeMember", ws(workspaceId, ["profileId": .string(profileId)]))
    }

    func transferOwnership(_ workspaceId: String, profileId: String) async throws {
        try await convex.mutationVoid("workspaces:transferOwnership", ws(workspaceId, ["profileId": .string(profileId)]))
    }

    func setBillingManager(_ workspaceId: String, profileId: String, allowed: Bool) async throws {
        try await convex.mutationVoid("workspaces:setBillingManager", ws(workspaceId, ["profileId": .string(profileId), "allowed": .bool(allowed)]))
    }

    func rename(_ workspaceId: String, name: String) async throws {
        try await convex.mutationVoid("workspaces:rename", ws(workspaceId, ["name": .string(name)]))
    }

    func guests(_ workspaceId: String) async throws -> WorkspaceGuests {
        try await convex.query("workspaces:guests", ws(workspaceId))
    }

    func setGuestAccess(_ workspaceId: String, profileId: String, documentId: String, role: ShareRole) async throws {
        try await convex.mutationVoid("workspaces:setGuestAccess", ws(workspaceId, [
            "profileId": .string(profileId), "documentId": .string(documentId), "role": .string(role.rawValue),
        ]))
    }

    func removeGuest(_ workspaceId: String, profileId: String) async throws {
        try await convex.mutationVoid("workspaces:removeGuest", ws(workspaceId, ["profileId": .string(profileId)]))
    }

    func convertGuestToMember(_ workspaceId: String, profileId: String) async throws {
        let _: JSONValue = try await convex.mutation("workspaces:convertGuestToMember", ws(workspaceId, ["profileId": .string(profileId)]))
    }

    func convertMemberToGuest(_ workspaceId: String, profileId: String) async throws {
        let _: JSONValue = try await convex.mutation("workspaces:convertMemberToGuest", ws(workspaceId, ["profileId": .string(profileId)]))
    }

    func revokePageInvite(_ inviteId: String) async throws {
        try await convex.mutationVoid("sharing:revokePageInvite", ["inviteId": .string(inviteId)])
    }

    func scheduleDeletion(_ workspaceId: String, confirmName: String) async throws {
        let _: ScheduledResult = try await convex.mutation("workspaces:scheduleDeletion", ws(workspaceId, ["confirmName": .string(confirmName)]))
    }

    func cancelDeletion(_ workspaceId: String) async throws {
        try await convex.mutationVoid("workspaces:cancelDeletion", ws(workspaceId))
    }
}

extension SessionContext {
    var workspacesRepo: WorkspacesRepository { WorkspacesRepository(convex: convex) }
}
