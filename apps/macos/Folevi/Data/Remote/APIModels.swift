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
    /// Email for replies in threads you took part in (unset follows `comments`).
    var replies: Bool?
    /// Email when your access to a page or workspace changes (unset follows `shares`).
    var access: Bool?
    /// In-app (bell) notifications per kind; unset = all on. Kept so saving from the Mac never resets them.
    var inApp: InApp?

    struct InApp: Codable, Sendable, Hashable {
        var comments: Bool?
        var replies: Bool?
        var mentions: Bool?
        var shares: Bool?
        var access: Bool?
    }
}

struct Profile: Codable, Sendable, Hashable {
    var id: String
    var email: String
    var displayName: String
    var appearance: String
    var locale: String
    var timeZone: String
    var onboardingStep: String
    /// Use cases picked in onboarding (their starter pages were added once).
    var onboardingUseCases: [String]?
    var status: String
    var notificationPrefs: NotificationPrefs?
    var createdAt: Double
    /// What their plan includes right now (users.me; the server enforces it again).
    var entitlements: Entitlements?
    /// Whether they've left the AI Assistant on (Settings → Account on the web).
    var aiEnabled: Bool?
    /// When a requested account deletion happens (status "pending_deletion").
    var deletionScheduledFor: Double?

    /// AI is available: their plan includes it and they haven't turned it off (the server enforces it).
    var aiOn: Bool { aiEnabled != false && (entitlements?.ai ?? true) }
    var aiEntitled: Bool { entitlements?.ai ?? true }
}

/// One onboarding step (users:completeOnboardingStep): workspace → uses → style → appearance → ai →
/// welcome. Each choice belongs to its own step; the server only moves forward.
struct OnboardingStepChoice: Sendable {
    var step: String
    var appearance: String? = nil
    var useCases: [String]? = nil
    var noteStyle: String? = nil
    var aiEnabled: Bool? = nil
}

/// ai:ask / ai:brief — Markdown with [n] citations, and the notes cited.
struct AiAnswer: Decodable, Sendable {
    struct Source: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var title: String
    }
    var answer: String
    var sources: [Source]
}

/// A person's Personal plan right now (convex/lib/plans.ts `personalEntitlementsOf`).
struct Entitlements: Codable, Sendable, Hashable {
    /// The tier: "free" | "core" | "pro" | "pro_ai" (Pro AI while a trial runs).
    var plan: String
    /// What they pay for (or were given); "free" during a trial.
    var paidPlan: String
    var planId: String?
    var paid: Bool?
    /// AI credits a month (Core has none; the trial has its own allowance).
    var monthlyCredits: Double?
    /// Whether they can buy AI credit packs.
    var creditPacks: Bool?
    var storageRule: String?
    var trialing: Bool
    var trialEndsAt: Double?
    var ai: Bool
    var aiSource: String?
    var storageBytes: Double
    /// nil = unlimited (a float64 from Convex).
    var devices: Double?
    var deviceLimit: Int? { devices.map { Int($0) } }

    var planName: String { PlanTier.name(plan) }
    var paidPlanName: String { PlanTier.name(paidPlan) }

    /// Whole days left in the trial (at least 1 while it runs).
    var trialDaysLeft: Int {
        guard trialing, let end = trialEndsAt else { return 0 }
        return max(1, Int(ceil((end - Date().timeIntervalSince1970 * 1000) / 86_400_000)))
    }
}

/// billing:mine — plan, subscription, usage.
struct BillingSummary: Decodable, Sendable {
    struct Subscription: Decodable, Sendable {
        var plan: String
        var interval: String?
        var status: String
        var provider: String
        var currentPeriodEnd: Double?
        var cancelAtPeriodEnd: Bool
    }
    var entitlements: Entitlements
    var subscription: Subscription?
    var storageUsedBytes: Double
    var devicesActive: Double
    var aiRequestsThisMonth: Double
}

/// Plan tiers (convex/lib/plans.ts `TIER_NAMES`), the same for Personal and team workspaces.
enum PlanTier {
    static func name(_ tier: String) -> String {
        switch tier {
        case "core": return String(localized: "Core")
        case "pro": return String(localized: "Pro")
        case "pro_ai": return String(localized: "Pro AI")
        default: return String(localized: "Free")
        }
    }
}

/// A team workspace you belong to (workspaces:mine). Personal is never in this list.
struct WorkspaceInfo: Codable, Sendable, Hashable, Identifiable {
    struct Plan: Codable, Sendable, Hashable {
        var id: String
        var name: String
        var tier: String
        var shortName: String?
    }
    var id: String
    var name: String
    var icon: String?
    var logoUrl: String?
    /// "owner" | "admin" | "member"
    var role: String
    /// A member's access: "edit" | "comment" | "view" (owners and admins always edit).
    var memberAccess: String?
    var canEdit: Bool
    var canManage: Bool
    var status: String
    var deletionScheduledFor: Double?
    var storageUsedBytes: Double
    var storageQuotaBytes: Double
    var storageRule: String?
    var plan: Plan?
    var canManageBilling: Bool?
    /// Whether this workspace's plan includes AI for its members.
    var aiIncluded: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, icon, logoUrl, role, memberAccess, canEdit, canManage, status, deletionScheduledFor,
             storageUsedBytes, storageQuotaBytes, storageRule, plan, canManageBilling, aiIncluded
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        logoUrl = try c.decodeIfPresent(String.self, forKey: .logoUrl)
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "member"
        memberAccess = try c.decodeIfPresent(String.self, forKey: .memberAccess)
        canEdit = try c.decodeIfPresent(Bool.self, forKey: .canEdit) ?? true
        canManage = try c.decodeIfPresent(Bool.self, forKey: .canManage) ?? (role == "owner" || role == "admin")
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
        deletionScheduledFor = try c.decodeIfPresent(Double.self, forKey: .deletionScheduledFor)
        storageUsedBytes = try c.decodeIfPresent(Double.self, forKey: .storageUsedBytes) ?? 0
        storageQuotaBytes = try c.decodeIfPresent(Double.self, forKey: .storageQuotaBytes) ?? 0
        storageRule = try c.decodeIfPresent(String.self, forKey: .storageRule)
        plan = try? c.decodeIfPresent(Plan.self, forKey: .plan)
        canManageBilling = try c.decodeIfPresent(Bool.self, forKey: .canManageBilling)
        aiIncluded = try c.decodeIfPresent(Bool.self, forKey: .aiIncluded)
    }

    /// "Owner · Pro", as the web's switcher shows it.
    var roleAndPlan: String {
        let r: String
        switch role {
        case "owner": r = String(localized: "Owner")
        case "admin": r = String(localized: "Admin")
        default:
            switch memberAccess {
            case "comment": r = String(localized: "Can comment")
            case "view": r = String(localized: "Can view")
            default: r = String(localized: "Member")
            }
        }
        guard let plan else { return r }
        return "\(r) · \(plan.shortName ?? PlanTier.name(plan.tier))"
    }
}

struct FolderInfo: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String
    var icon: String?
    var parentFolderId: String?
    var rank: String
    /// The folder's colour (hex), when it has one.
    var color: String?
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
    /// The workspace it lives in; nil for a page from someone's Personal.
    var workspaceName: String?
    var ownerName: String?
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

/// A built-in template ("builtin:<key>").
struct BuiltInTemplate: Codable, Sendable, Hashable, Identifiable {
    var key: String
    var name: String
    var description: String
    var icon: String
    var id: String { key }
}
