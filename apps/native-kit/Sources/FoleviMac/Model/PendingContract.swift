// Contract additions the Mac frame needs that protocol.ts doesn't have yet (filed in
// docs/NATIVE_CONTRACT_REQUESTS.md). They're typed here with the requested names and shapes, so the frame calls
// them now and they work as soon as the engine answers them; until then the engine replies `unknown_command`
// (or `unknown_view`) and the frame says it isn't available yet. Each goes once `pnpm engine:gen` emits it.
import Foundation
import FoleviEngine

public enum MacPending {
    /// `note.move` with `folderId` always sent: the generated `NoteMoveArgs` leaves a nil `folderId` out, and
    /// the engine refuses that ("folderId must be a folder id or null"), so moving to Drafts needs this until
    /// the codegen writes `T | null` fields as null (reported in docs/NATIVE_CONTRACT_REQUESTS.md).
    public struct NoteMove: EngineCommandSpec {
        public static let name = "note.move"
        public struct Args: Codable, Hashable, Sendable {
            public var ids: [String]
            public var folderId: String?
            public init(ids: [String], folderId: String?) {
                self.ids = ids
                self.folderId = folderId
            }

            public func encode(to encoder: any Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(ids, forKey: .ids)
                try c.encode(folderId, forKey: .folderId)
            }
        }
        public typealias Result = BulkResult
        public var args: Args
        public init(_ args: Args) { self.args = args }
    }

    /// `folder.move { id, parentId, afterId }`: nest, un-nest or reorder a folder (the same request as
    /// FoleviScreens' `FolderMove`, N7).
    public struct FolderMove: EngineCommandSpec {
        public static let name = "folder.move"
        public struct Args: Codable, Hashable, Sendable {
            public var id: String
            public var parentId: String?
            public var afterId: String?
            public init(id: String, parentId: String?, afterId: String?) {
                self.id = id
                self.parentId = parentId
                self.afterId = afterId
            }

            public func encode(to encoder: any Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(id, forKey: .id)
                try c.encode(parentId, forKey: .parentId)
                try c.encode(afterId, forKey: .afterId)
            }
        }
        public typealias Result = OkResult
        public var args: Args
        public init(_ args: Args) { self.args = args }
    }

    /// `notifications.list {}`: the bell's popover (plan 5.6).
    public struct NotificationsList: EngineViewSpec {
        public static let name = "notifications.list"
        public typealias Args = EmptyArgs
        public typealias Value = NotificationsValue
        public var args: Args
        public init(_ args: Args = .init()) { self.args = args }
    }

    /// `notification.markRead { ids, read }`.
    public struct NotificationMarkRead: EngineCommandSpec {
        public static let name = "notification.markRead"
        public struct Args: Codable, Hashable, Sendable {
            public var ids: [String]
            public var read: Bool
            public init(ids: [String], read: Bool) {
                self.ids = ids
                self.read = read
            }
        }
        public typealias Result = OkResult
        public var args: Args
        public init(_ args: Args) { self.args = args }
    }

    /// `search { text, scope }` (plan 5.7), one-off query.
    public struct Search: EngineViewSpec {
        public static let name = "search"
        public struct Args: Codable, Hashable, Sendable {
            public var text: String
            /// "place" (this place) or "everywhere".
            public var scope: String
            public init(text: String, scope: String = "place") {
                self.text = text
                self.scope = scope
            }
        }
        public typealias Value = SearchValue
        public var args: Args
        public init(_ args: Args) { self.args = args }
    }
}

public struct NotificationRow: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    /// "mention", "comment", "share", "invite", "reminder", "change", ... (open).
    public var kind: String
    public var title: String
    public var body: String
    public var at: Double
    public var read: Bool
    /// Where tapping it goes (a web route), or null.
    public var route: String?
    public init(id: String, kind: String, title: String, body: String, at: Double, read: Bool, route: String?) {
        self.id = id
        self.kind = kind
        self.title = title
        self.body = body
        self.at = at
        self.read = read
        self.route = route
    }
}

public struct NotificationsValue: Codable, Hashable, Sendable {
    public var unread: Int
    public var rows: [NotificationRow]
    public init(unread: Int, rows: [NotificationRow]) {
        self.unread = unread
        self.rows = rows
    }
}

public struct SearchHit: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var icon: String?
    /// The matched text with the match in it.
    public var snippet: String
    public var folder: FolderChip?
    public var updatedAt: Double
    public init(id: String, title: String, icon: String?, snippet: String, folder: FolderChip?, updatedAt: Double) {
        self.id = id
        self.title = title
        self.icon = icon
        self.snippet = snippet
        self.folder = folder
        self.updatedAt = updatedAt
    }
}

public struct SearchValue: Codable, Hashable, Sendable {
    public var hits: [SearchHit]
    public init(hits: [SearchHit]) { self.hits = hits }
}
