import Foundation

// DTOs for organizing notes, workspace people, the account and support (convex/documents.ts,
// workspaces.ts, users.ts, exports.ts, support.ts).

/// documents:bulkUpdate.
struct BulkUpdateResult: Decodable, Sendable, Hashable {
    var done: [String]
    var skipped: Int
    /// For "move": where each moved note was before (nil = Drafts), so it can be undone.
    var previousFolders: [String: String?]

    enum CodingKeys: String, CodingKey { case done, skipped, previousFolders }

    init(done: [String] = [], skipped: Int = 0, previousFolders: [String: String?] = [:]) {
        self.done = done
        self.skipped = skipped
        self.previousFolders = previousFolders
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        done = try c.decodeIfPresent([String].self, forKey: .done) ?? []
        skipped = Int(try c.decodeIfPresent(Double.self, forKey: .skipped) ?? 0)
        previousFolders = try c.decodeIfPresent([String: String?].self, forKey: .previousFolders) ?? [:]
    }
}

/// documents:hideFromRecent.
struct HideFromRecentResult: Decodable, Sendable { var hidden: Double }

/// documents:trashSummary: what "Empty Trash" would delete for you.
struct TrashSummary: Decodable, Sendable, Hashable {
    var total: Double
    var deletable: Double
    var more: Bool
}

/// documents:emptyTrash.
struct EmptyTrashResult: Decodable, Sendable, Hashable {
    var scheduled: Double
    var continuing: Bool
}

/// users:deletionBlockers: workspaces you own that other people use.
struct DeletionBlockers: Decodable, Sendable, Hashable {
    struct Workspace: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var name: String
        var otherMembers: Double
    }
    var workspaces: [Workspace]
}

/// users:requestAccountDeletion, workspaces:scheduleDeletion.
struct ScheduledResult: Decodable, Sendable { var scheduledFor: Double }

/// users:revokeOtherSessions.
struct RevokeOthersResult: Decodable, Sendable { var ended: Double }

/// A member's access (owners and admins always edit).
enum MemberAccess: String, Codable, Sendable, CaseIterable {
    case edit, comment, view
}

/// A role choice in Members and invitations: Member with an access, or Admin (owner only).
enum MemberRoleChoice: String, CaseIterable, Identifiable, Sendable {
    case memberEdit = "member:edit"
    case memberComment = "member:comment"
    case memberView = "member:view"
    case admin

    var id: String { rawValue }

    init(role: String, access: MemberAccess) {
        if role == "admin" {
            self = .admin
        } else {
            switch access {
            case .edit: self = .memberEdit
            case .comment: self = .memberComment
            case .view: self = .memberView
            }
        }
    }

    var role: String { self == .admin ? "admin" : "member" }
    var access: MemberAccess? {
        switch self {
        case .memberEdit: return .edit
        case .memberComment: return .comment
        case .memberView: return .view
        case .admin: return nil
        }
    }

    var title: String {
        switch self {
        case .memberEdit: return String(localized: "Member")
        case .memberComment: return String(localized: "Member · can comment")
        case .memberView: return String(localized: "Member · view only")
        case .admin: return String(localized: "Admin")
        }
    }

    /// The arguments for workspaces:invite / changeRole.
    var args: [String: JSONValue] {
        var out: [String: JSONValue] = ["role": .string(role)]
        if let access { out["memberAccess"] = .string(access.rawValue) }
        return out
    }

    /// "an admin", "a member who can comment"… for the toast after a change.
    var phrase: String {
        switch self {
        case .admin: return String(localized: "an admin")
        case .memberEdit: return String(localized: "a member")
        case .memberComment: return String(localized: "a member who can comment")
        case .memberView: return String(localized: "a view-only member")
        }
    }
}

/// workspaces:members.
struct WorkspaceMembers: Decodable, Sendable, Hashable {
    struct Member: Decodable, Sendable, Hashable, Identifiable {
        var profileId: String
        var displayName: String
        var email: String
        var role: String
        var memberAccess: MemberAccess
        var canManageBilling: Bool
        var joinedAt: Double?
        var isYou: Bool
        var canManage: Bool
        var id: String { profileId }

        enum CodingKeys: String, CodingKey { case profileId, displayName, email, role, memberAccess, canManageBilling, joinedAt, isYou, canManage }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            profileId = try c.decode(String.self, forKey: .profileId)
            displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
            email = try c.decodeIfPresent(String.self, forKey: .email) ?? ""
            role = try c.decodeIfPresent(String.self, forKey: .role) ?? "member"
            memberAccess = (try? c.decode(MemberAccess.self, forKey: .memberAccess)) ?? .edit
            canManageBilling = try c.decodeIfPresent(Bool.self, forKey: .canManageBilling) ?? false
            joinedAt = try c.decodeIfPresent(Double.self, forKey: .joinedAt)
            isYou = try c.decodeIfPresent(Bool.self, forKey: .isYou) ?? false
            canManage = try c.decodeIfPresent(Bool.self, forKey: .canManage) ?? false
        }
    }
    struct Invite: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var email: String
        var role: String
        var memberAccess: MemberAccess
        var expiresAt: Double
        var expired: Bool

        enum CodingKeys: String, CodingKey { case id, email, role, memberAccess, expiresAt, expired }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            email = try c.decodeIfPresent(String.self, forKey: .email) ?? ""
            role = try c.decodeIfPresent(String.self, forKey: .role) ?? "member"
            memberAccess = (try? c.decode(MemberAccess.self, forKey: .memberAccess)) ?? .edit
            expiresAt = try c.decodeIfPresent(Double.self, forKey: .expiresAt) ?? 0
            expired = try c.decodeIfPresent(Bool.self, forKey: .expired) ?? false
        }
    }
    struct Seats: Decodable, Sendable, Hashable {
        var billable: Double
        var paid: Bool
        var planName: String
        var seatPriceCents: Double?
        var interval: String?
    }
    var members: [Member]
    var invites: [Invite]
    var yourRole: String
    var yourMemberAccess: MemberAccess?
    var yourCanManageBilling: Bool?
    var canManage: Bool
    var seats: Seats?
    var guests: Double?
}

/// workspaces:guests.
struct WorkspaceGuests: Decodable, Sendable, Hashable {
    struct Page: Decodable, Sendable, Hashable, Identifiable {
        var documentId: String
        var title: String
        var icon: String?
        var inTrash: Bool
        /// "viewer" | "commenter" | "editor"
        var role: String
        var id: String { documentId }
    }
    struct Guest: Decodable, Sendable, Hashable, Identifiable {
        var profileId: String
        var displayName: String
        var email: String
        var pages: [Page]
        var id: String { profileId }
    }
    struct PendingInvite: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var email: String
        var documentId: String
        var title: String
        var role: String
        var expiresAt: Double
        var expired: Bool
    }
    var guests: [Guest]
    var pendingInvites: [PendingInvite]
}

/// A page share role (guests): Can view, Can comment, Can edit.
enum ShareRole: String, CaseIterable, Identifiable, Sendable {
    case viewer, commenter, editor
    var id: String { rawValue }
    var title: String {
        switch self {
        case .viewer: return String(localized: "Can view")
        case .commenter: return String(localized: "Can comment")
        case .editor: return String(localized: "Can edit")
        }
    }
}

/// exports:exportScope: a signed link to the ZIP, valid for an hour.
struct ExportResult: Decodable, Sendable {
    var url: String
    var filename: String
    var documents: Double
    var assets: Double
    var skippedAssets: [String]
    var skippedReason: String?

    enum CodingKeys: String, CodingKey { case url, filename, documents, assets, skippedAssets, skippedReason }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try c.decode(String.self, forKey: .url)
        filename = try c.decodeIfPresent(String.self, forKey: .filename) ?? "folevi-export.zip"
        documents = try c.decodeIfPresent(Double.self, forKey: .documents) ?? 0
        assets = try c.decodeIfPresent(Double.self, forKey: .assets) ?? 0
        skippedAssets = try c.decodeIfPresent([String].self, forKey: .skippedAssets) ?? []
        skippedReason = try c.decodeIfPresent(String.self, forKey: .skippedReason)
    }
}

/// support:myRequests: your support requests with our replies (never staff notes).
struct SupportRequest: Decodable, Sendable, Hashable, Identifiable {
    struct Message: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        /// "you" | "support"
        var from: String
        var body: String
        var createdAt: Double
    }
    var number: Double
    var subject: String
    var topic: String
    var topicLabel: String
    /// "open" | "pending" (replied) | "closed"
    var status: String
    var createdAt: Double
    var lastMessageAt: Double
    var messages: [Message]
    var id: Int { Int(number) }

    var replyCount: Int { messages.filter { $0.from == "support" }.count }

    var statusLabel: String {
        switch status {
        case "pending": return String(localized: "Replied")
        case "closed": return String(localized: "Closed")
        default: return String(localized: "Open")
        }
    }
}

/// Prices as the web shows them (convex/lib/plans.ts formatPrice): "$8", "$4.50".
enum PlanPrice {
    static func format(cents: Double) -> String {
        let c = Int(cents.rounded())
        return c % 100 == 0 ? "$\(c / 100)" : String(format: "$%.2f", Double(c) / 100)
    }
}
