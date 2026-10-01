import Foundation

/// Comments, notifications and sharing: online-only calls (convex/comments.ts, convex/notifications.ts,
/// convex/sharing.ts). Never logs note content, emails or tokens.
struct CollaborationRepository: Sendable {
    let convex: ConvexService

    private func doc(_ id: String) -> [String: JSONValue] { ["documentId": .string(id)] }
    private func body(_ nodes: [InlineNode]) throws -> JSONValue { try JSONValue(encoding: nodes) }

    // MARK: Comments

    func threadUpdates(_ documentId: String) -> AsyncThrowingStream<CommentsData, Error> {
        convex.subscribe("comments:threads", doc(documentId))
    }
    func mentionable(_ documentId: String) async throws -> [MentionPerson] {
        try await convex.query("comments:mentionable", doc(documentId))
    }
    func createComment(documentId: String, blockId: String?, body nodes: [InlineNode]) async throws -> CommentCreated {
        var args = doc(documentId)
        args["body"] = try body(nodes)
        if let blockId { args["blockId"] = .string(blockId) }
        return try await convex.mutation("comments:create", args)
    }
    func reply(threadId: String, body nodes: [InlineNode]) async throws {
        try await convex.mutationVoid("comments:reply", ["threadId": .string(threadId), "body": try body(nodes)])
    }
    func edit(commentId: String, body nodes: [InlineNode]) async throws {
        try await convex.mutationVoid("comments:edit", ["commentId": .string(commentId), "body": try body(nodes)])
    }
    func removeComment(_ commentId: String) async throws -> CommentRemoved {
        try await convex.mutation("comments:remove", ["commentId": .string(commentId)])
    }
    func setResolved(threadId: String, resolved: Bool) async throws {
        try await convex.mutationVoid("comments:setResolved", ["threadId": .string(threadId), "resolved": .bool(resolved)])
    }
    func deleteThread(_ threadId: String) async throws {
        try await convex.mutationVoid("comments:deleteThread", ["threadId": .string(threadId)])
    }
    func markThreadRead(_ threadId: String) async throws {
        try await convex.mutationVoid("comments:markThreadRead", ["threadId": .string(threadId)])
    }
    func markThreadUnread(_ threadId: String) async throws {
        try await convex.mutationVoid("comments:markThreadUnread", ["threadId": .string(threadId)])
    }
    func markCommentsRead(_ documentId: String) async throws {
        try await convex.mutationVoid("comments:markRead", doc(documentId))
    }

    // MARK: Notifications

    func notificationUpdates(limit: Int = 50) -> AsyncThrowingStream<[AppNotification], Error> {
        convex.subscribe("notifications:list", ["limit": .number(Double(limit))])
    }
    func unreadCountUpdates() -> AsyncThrowingStream<Double, Error> {
        convex.subscribe("notifications:unreadCount")
    }
    /// Marks these read, or every notification when `ids` is nil ("Mark all read").
    func markNotificationsRead(_ ids: [String]?) async throws {
        try await convex.mutationVoid("notifications:markRead", ids.map { ["ids": .array($0.map { .string($0) })] } ?? [:])
    }
    func markNotificationsUnread(_ ids: [String]) async throws {
        try await convex.mutationVoid("notifications:markUnread", ["ids": .array(ids.map { .string($0) })])
    }
    func removeNotifications(_ ids: [String]) async throws {
        try await convex.mutationVoid("notifications:remove", ["ids": .array(ids.map { .string($0) })])
    }
    func noteSubscriptionUpdates(_ documentId: String) -> AsyncThrowingStream<NoteSubscription?, Error> {
        convex.subscribe("notifications:noteSubscription", doc(documentId))
    }
    func setNoteSubscription(_ documentId: String, mode: String) async throws {
        var args = doc(documentId)
        args["mode"] = .string(mode)
        try await convex.mutationVoid("notifications:setNoteSubscription", args)
    }
    func acceptWorkspaceInvite(_ inviteId: String) async throws {
        try await convex.mutationVoid("workspaces:acceptInvite", ["inviteId": .string(inviteId)])
    }
    func acceptPageInvite(_ inviteId: String) async throws -> AcceptedPageInvite {
        try await convex.mutation("sharing:acceptPageInvite", ["inviteId": .string(inviteId)])
    }

    // MARK: Sharing

    func shareUpdates(_ documentId: String) -> AsyncThrowingStream<ShareInfo, Error> {
        convex.subscribe("sharing:get", doc(documentId))
    }
    func setAccessMode(_ documentId: String, mode: String) async throws {
        var args = doc(documentId)
        args["mode"] = .string(mode)
        try await convex.mutationVoid("sharing:setAccessMode", args)
    }
    func grant(_ documentId: String, email: String, role: ShareRole) async throws -> GrantResult {
        var args = doc(documentId)
        args["email"] = .string(email)
        args["role"] = .string(role.rawValue)
        return try await convex.mutation("sharing:grant", args)
    }
    func revoke(_ documentId: String, profileId: String) async throws {
        var args = doc(documentId)
        args["profileId"] = .string(profileId)
        try await convex.mutationVoid("sharing:revoke", args)
    }
    func revokePageInvite(_ inviteId: String) async throws {
        try await convex.mutationVoid("sharing:revokePageInvite", ["inviteId": .string(inviteId)])
    }
    func createPublicLink(_ documentId: String, expiresAt: Date?, password: String?) async throws -> PublicLinkCreated {
        var args = doc(documentId)
        if let expiresAt { args["expiresAt"] = .number((expiresAt.timeIntervalSince1970 * 1000).rounded()) }
        if let password, !password.isEmpty { args["password"] = .string(password) }
        return try await convex.mutation("sharing:createPublicLink", args)
    }
    func revokePublicLink(_ linkId: String) async throws {
        try await convex.mutationVoid("sharing:revokePublicLink", ["linkId": .string(linkId)])
    }
}
