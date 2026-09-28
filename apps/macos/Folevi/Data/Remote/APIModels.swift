import Foundation

// Decodable DTOs for the Convex functions the Mac app calls (see convex/*.ts). Numbers are decoded as
// Double (Convex float64) and converted where an Int is needed.

struct MeResponse: Decodable, Sendable {
    enum State: String, Decodable, Sendable {
        case signedOut = "signed_out"
        case emailUnverified = "email_unverified"
        case mfaRequired = "mfa_required"
        case needsBootstrap = "needs_bootstrap"
        case suspended
        case sessionRevoked = "session_revoked"
        /// Over the plan's device limit (convex/lib/devices.ts): this Mac waits until another device signs out.
        case deviceLimit = "device_limit"
        case ready
    }
    var state: State
    var profile: Profile?
    var limit: Double?
    var active: Double?
}

struct NotificationPrefs: Codable, Sendable, Hashable {
    var mentions: Bool
    var comments: Bool
    var shares: Bool
    var invites: Bool
    var digest: String
    var productEmail: Bool
}

struct Profile: Codable, Sendable, Hashable {
    var id: String
    var email: String
    var displayName: String
    var appearance: String
    var locale: String
    var timeZone: String
    var onboardingStep: String
    var status: String
    var defaultWorkspaceId: String?
    var notificationPrefs: NotificationPrefs?
    var createdAt: Double
}

struct WorkspaceInfo: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String
    var kind: String
    var icon: String?
    var role: String
    var status: String
    var isDefault: Bool
    var storageUsedBytes: Double
    var storageQuotaBytes: Double
}

struct FolderInfo: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String
    var icon: String?
    var parentFolderId: String?
    var rank: String
}

struct TagInfo: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String
    var color: String
}

struct SidebarData: Codable, Sendable, Hashable {
    var folders: [FolderInfo]
    var tags: [TagInfo]
}

struct DocumentPage: Decodable, Sendable {
    var page: [DocumentSummary]
    var isDone: Bool
    var continueCursor: String
}

struct Breadcrumb: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String
    var icon: String?
}

struct DocumentDetail: Decodable, Sendable {
    struct FolderRef: Decodable, Sendable, Hashable { var id: String; var name: String }
    var document: DocumentSummary
    var access: String
    var folder: FolderRef?
    var breadcrumbs: [Breadcrumb]
    var lastEditedBy: String?
    var createdByName: String?
    var inTrash: Bool

    var canWrite: Bool { ["write", "manage", "owner", "edit", "editor", "full"].contains(access) }
}

struct LinkRef: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String
    var icon: String?
    var excerpt: String
}

struct Backlinks: Decodable, Sendable {
    var linked: [LinkRef]
    var unlinked: [LinkRef]
}

struct DocumentInfo: Decodable, Sendable {
    struct Activity: Decodable, Sendable, Hashable {
        var kind: String
        var at: Double
        var by: String
        var reason: String
    }
    var wordCount: Double
    var charCount: Double
    var blockCount: Double
    var createdAt: Double
    var updatedAt: Double
    var createdBy: String
    var lastEditedBy: String
    var activity: [Activity]
}

struct SnapshotInfo: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var reason: String
    var title: String
    var blockCount: Double
    var createdAt: Double
    var createdBy: String
}

struct SnapshotContent: Decodable, Sendable {
    var content: String?
}

struct TaskItem: Decodable, Sendable, Hashable, Identifiable {
    var blockId: String
    var documentId: String
    var documentTitle: String
    var documentIcon: String?
    var title: String
    var status: String
    var dueDate: String?
    var dueTime: String?
    var priority: String
    var assigneeName: String?
    var completedAt: Double?
    var updatedAt: Double
    var id: String { blockId }
}

struct TaskCounts: Decodable, Sendable, Hashable {
    var inbox: Double
    var today: Double
    var upcoming: Double
    var all: Double
    var mine: Double
}

struct TaskUpdateResult: Decodable, Sendable {
    var before: JSONValue
    var revision: Double?
}

struct SearchHit: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String
    var icon: String?
    var kind: String
    var updatedAt: Double
    var snippet: String
    var archived: Bool
}

struct FileURLInfo: Decodable, Sendable, Hashable {
    var url: String
    var mimeType: String
    var filename: String
    var size: Double
    var width: Double?
    var height: Double?
}

struct UploadTicket: Decodable, Sendable {
    var uploadUrl: String
    var intentId: String
}

struct FinalizeResult: Decodable, Sendable {
    var fileId: String
    var mimeType: String
    var width: Double?
    var height: Double?
    var size: Double
}

struct SessionInfo: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var client: String
    var label: String
    var createdAt: Double
    var lastSeenAt: Double
    var revokedAt: Double?
    var current: Bool
}

struct SharedDocument: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String
    var icon: String?
    var role: String
    var sharedBy: String
    var sharedAt: Double
    var workspaceName: String
    var updatedAt: Double
    var excerpt: String
}

struct CommentThreadList: Decodable, Sendable {
    struct Comment: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var authorName: String
        var body: [InlineNode]
        var deleted: Bool
        var createdAt: Double
        var mine: Bool
    }
    struct Thread: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var blockId: String?
        var status: String
        var createdAt: Double
        var unread: Bool
        var comments: [Comment]
    }
    var threads: [Thread]
    var canComment: Bool
}

struct CollectionData: Decodable, Sendable {
    struct Property: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var name: String
        var type: String
        var options: JSONValue?
    }
    struct Row: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var documentId: String
        var title: String
        var icon: String?
        var values: [String: JSONValue]
        var updatedAt: Double
    }
    var id: String
    var name: String
    var hostDocumentId: String
    var canEdit: Bool
    var properties: [Property]
    var rows: [Row]
}

struct ImportTextResult: Decodable, Sendable {
    struct Warning: Decodable, Sendable, Hashable { var line: Double; var code: String; var message: String }
    var document: DocumentSummary
    var warnings: [Warning]
    var blockCount: Double
}

struct SettingsStatus: Decodable, Sendable, Hashable {
    var bannerMessage: String?
    var readOnly: Bool
}

struct BlocksListResponse: Decodable, Sendable {
    var documentId: String
    var revision: Double
    var blocks: [WireBlock]
}

struct HeadResponse: Decodable, Sendable {
    var seq: Double
}

struct PullResponse: Decodable, Sendable {
    struct Row: Decodable, Sendable {
        var documentId: String
        var block: WireBlock
        var deleted: Bool
    }
    var documents: [DocumentSummary]
    var blocks: [Row]
    var nextCursor: Double
    var hasMore: Bool
    var head: Double
}

struct EmptyResult: Decodable, Sendable {}
