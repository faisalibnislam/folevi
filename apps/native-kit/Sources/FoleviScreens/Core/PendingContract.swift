// Views and commands the Home and list screens need that the bridge contract (apps/web/src/lib/engine/protocol.ts)
// doesn't have yet. Each one is filed in docs/NATIVE_CONTRACT_REQUESTS.md with its exact TypeScript shape; the
// specs here use those names and shapes, so the screens work against ScriptedTransport fixtures today and against
// the real engine as soon as the web bridge adds them (until then the engine answers `unknown_command` /
// `unknown_view`, which the screens show as a toast or hide the section). When `pnpm engine:gen` produces a
// generated spec with the same name, delete the one here and use the generated one.
import Foundation
import FoleviEngine

// MARK: Argument and result types

public struct NoteCopyToArgs: Codable, Hashable, Sendable {
    public var ids: [String]
    public var space: SpaceRef
    public init(ids: [String], space: SpaceRef) {
        self.ids = ids
        self.space = space
    }
}

public struct NoteReorderArgs: Codable, Hashable, Sendable {
    public var id: String
    /// The note it goes right after in manual order; nil: first.
    public var afterId: String?
    public var view: NotesListView
    public var folderId: String?
    public init(id: String, afterId: String?, view: NotesListView, folderId: String? = nil) {
        self.id = id
        self.afterId = afterId
        self.view = view
        self.folderId = folderId
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(afterId, forKey: .afterId) // always sent: null means first
        try c.encode(view, forKey: .view)
        try c.encodeIfPresent(folderId, forKey: .folderId)
    }
}

public struct TemplateCreateArgs: Codable, Hashable, Sendable {
    public var space: SpaceRef?
    public var title: String?
    public init(space: SpaceRef? = nil, title: String? = nil) {
        self.space = space
        self.title = title
    }
}

public struct TrashEmptyResult: Codable, Hashable, Sendable {
    public var deleted: Int
    public var skipped: Int
    public init(deleted: Int, skipped: Int) {
        self.deleted = deleted
        self.skipped = skipped
    }
}

public struct TrashSummaryValue: Codable, Hashable, Sendable {
    /// Notes in Trash.
    public var total: Int
    /// The ones this person may delete for good.
    public var deletable: Int
    public init(total: Int, deletable: Int) {
        self.total = total
        self.deletable = deletable
    }
}

public struct FolderRenameArgs: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct FolderSetColorArgs: Codable, Hashable, Sendable {
    public var id: String
    /// A folder colour key, or null for the default.
    public var color: String?
    public init(id: String, color: String?) {
        self.id = id
        self.color = color
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(color, forKey: .color)
    }
}

public struct FolderMoveArgs: Codable, Hashable, Sendable {
    public var id: String
    /// The new parent; null: the top level.
    public var parentId: String?
    /// The sibling it goes right after; null: first among its new siblings.
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

public struct FolderIdArgs: Codable, Hashable, Sendable {
    public var id: String
    public init(id: String) { self.id = id }
}

public struct FolderCardsArgs: Codable, Hashable, Sendable {
    public var space: SpaceRef?
    /// Whose subfolders; null or left out: the top level.
    public var parentId: String?
    public init(space: SpaceRef? = nil, parentId: String? = nil) {
        self.space = space
        self.parentId = parentId
    }
}

public struct FolderCardsValue: Codable, Hashable, Sendable {
    public var folders: [FolderCard]
    public init(folders: [FolderCard]) { self.folders = folders }
}

public struct BuiltInTemplate: Codable, Hashable, Sendable, Identifiable {
    /// `builtin:<key>` is what `note.create { templateId }` takes.
    public var key: String
    public var name: String
    public var description: String
    /// An icon name from the web's template tiles ("calendar", "list-checks", ...).
    public var icon: String
    public var id: String { key }
    public init(key: String, name: String, description: String, icon: String) {
        self.key = key
        self.name = name
        self.description = description
        self.icon = icon
    }
}

public struct BuiltInTemplatesValue: Codable, Hashable, Sendable {
    public var templates: [BuiltInTemplate]
    public init(templates: [BuiltInTemplate]) { self.templates = templates }
}

/// A page shared with this person (`sharing.sharedWithMe`).
public struct SharedRow: Codable, Hashable, Sendable, Identifiable, EngineRow {
    public var id: String
    public var title: String
    public var excerpt: String
    public var icon: String?
    public var sharedBy: String
    /// The workspace it lives in, or null for someone's Personal.
    public var workspaceName: String?
    public var ownerName: String?
    /// "editor", "commenter" or "viewer".
    public var role: String
    public var updatedAt: Double
    public var h: String
    public init(id: String, title: String, excerpt: String, icon: String? = nil, sharedBy: String, workspaceName: String?, ownerName: String?, role: String, updatedAt: Double, h: String) {
        self.id = id
        self.title = title
        self.excerpt = excerpt
        self.icon = icon
        self.sharedBy = sharedBy
        self.workspaceName = workspaceName
        self.ownerName = ownerName
        self.role = role
        self.updatedAt = updatedAt
        self.h = h
    }
}

/// A change a connected app proposed to a note (`proposals.list`).
public struct ProposalRow: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var noteId: String
    public var title: String
    public var sourceName: String
    /// The added lines as plain text, for the row's preview.
    public var summary: String
    public var createdAt: Double
    /// Why it can't be accepted any more (only Reject is offered), or null.
    public var problem: String?
    public init(id: String, noteId: String, title: String, sourceName: String, summary: String, createdAt: Double, problem: String?) {
        self.id = id
        self.noteId = noteId
        self.title = title
        self.sourceName = sourceName
        self.summary = summary
        self.createdAt = createdAt
        self.problem = problem
    }
}

/// A note someone else changed since this person last looked (`changes.list`).
public struct ChangedNoteRow: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    /// "Maya and Foli AI" (`whoChanged`).
    public var who: String
    /// "3 added, 1 removed" (`changeCounts`).
    public var counts: String
    public var changedAt: Double
    public init(id: String, title: String, who: String, counts: String, changedAt: Double) {
        self.id = id
        self.title = title
        self.who = who
        self.counts = counts
        self.changedAt = changedAt
    }
}

public struct ChangesValue: Codable, Hashable, Sendable {
    public var proposals: [ProposalRow]
    public var notes: [ChangedNoteRow]
    public init(proposals: [ProposalRow], notes: [ChangedNoteRow]) {
        self.proposals = proposals
        self.notes = notes
    }
}

public struct ProposalIdArgs: Codable, Hashable, Sendable {
    public var id: String
    public init(id: String) { self.id = id }
}

/// `note.move` args that always send `folderId` (null for Drafts). The generated `NoteMoveArgs` drops a nil
/// `folderId` (synthesized `encodeIfPresent`), and the engine refuses a missing one; filed in
/// docs/NATIVE_CONTRACT_REQUESTS.md (codegen: always encode `T | null` fields).
public struct NoteMoveExplicitArgs: Codable, Hashable, Sendable {
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

// MARK: Specs

/// Commands waiting for the contract (docs/NATIVE_CONTRACT_REQUESTS.md).
public enum PendingCommands {
    /// `note.move` with `folderId` always present (see `NoteMoveExplicitArgs`).
    public struct NoteMove: EngineCommandSpec {
        public static let name = "note.move"
        public var args: NoteMoveExplicitArgs
        public init(_ args: NoteMoveExplicitArgs) { self.args = args }
        public typealias Result = BulkResult
    }
    public struct NoteDeleteForever: EngineCommandSpec {
        public static let name = "note.deleteForever"
        public var args: NoteIdsArgs
        public init(_ args: NoteIdsArgs) { self.args = args }
        public typealias Result = BulkResult
    }
    public struct NoteDuplicate: EngineCommandSpec {
        public static let name = "note.duplicate"
        public var args: NoteIdArgs
        public init(_ args: NoteIdArgs) { self.args = args }
        public typealias Result = NoteCreateResult
    }
    public struct NoteCopyTo: EngineCommandSpec {
        public static let name = "note.copyTo"
        public var args: NoteCopyToArgs
        public init(_ args: NoteCopyToArgs) { self.args = args }
        public typealias Result = BulkResult
    }
    public struct NoteReorder: EngineCommandSpec {
        public static let name = "note.reorder"
        public var args: NoteReorderArgs
        public init(_ args: NoteReorderArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct NoteShowInRecent: EngineCommandSpec {
        public static let name = "note.showInRecent"
        public var args: NoteIdsArgs
        public init(_ args: NoteIdsArgs) { self.args = args }
        public typealias Result = HiddenResult
    }
    public struct TemplateCreate: EngineCommandSpec {
        public static let name = "template.create"
        public var args: TemplateCreateArgs
        public init(_ args: TemplateCreateArgs) { self.args = args }
        public typealias Result = NoteCreateResult
    }
    public struct TrashEmpty: EngineCommandSpec {
        public static let name = "trash.empty"
        public var args: SpaceArgs
        public init(_ args: SpaceArgs) { self.args = args }
        public typealias Result = TrashEmptyResult
    }
    public struct FolderRename: EngineCommandSpec {
        public static let name = "folder.rename"
        public var args: FolderRenameArgs
        public init(_ args: FolderRenameArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct FolderSetColor: EngineCommandSpec {
        public static let name = "folder.setColor"
        public var args: FolderSetColorArgs
        public init(_ args: FolderSetColorArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct FolderMove: EngineCommandSpec {
        public static let name = "folder.move"
        public var args: FolderMoveArgs
        public init(_ args: FolderMoveArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct FolderDelete: EngineCommandSpec {
        public static let name = "folder.delete"
        public var args: FolderIdArgs
        public init(_ args: FolderIdArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct ChangesMarkSeen: EngineCommandSpec {
        public static let name = "changes.markSeen"
        public var args: NoteIdsArgs
        public init(_ args: NoteIdsArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct ProposalAccept: EngineCommandSpec {
        public static let name = "proposal.accept"
        public var args: ProposalIdArgs
        public init(_ args: ProposalIdArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct ProposalReject: EngineCommandSpec {
        public static let name = "proposal.reject"
        public var args: ProposalIdArgs
        public init(_ args: ProposalIdArgs) { self.args = args }
        public typealias Result = OkResult
    }
}

/// Views waiting for the contract.
public enum PendingViews {
    public struct TrashSummary: EngineViewSpec {
        public static let name = "trash.summary"
        public var args: SpaceArgs
        public init(_ args: SpaceArgs) { self.args = args }
        public typealias Value = TrashSummaryValue
    }
    public struct TemplatesBuiltIn: EngineViewSpec {
        public static let name = "templates.builtIn"
        public var args: EmptyArgs
        public init(_ args: EmptyArgs = .init()) { self.args = args }
        public typealias Value = BuiltInTemplatesValue
    }
    public struct FolderCards: EngineViewSpec {
        public static let name = "folders.cards"
        public var args: FolderCardsArgs
        public init(_ args: FolderCardsArgs) { self.args = args }
        public typealias Value = FolderCardsValue
    }
    public struct Changes: EngineViewSpec {
        public static let name = "changes"
        public var args: EmptyArgs
        public init(_ args: EmptyArgs = .init()) { self.args = args }
        public typealias Value = ChangesValue
    }
}

/// List views waiting for the contract.
public enum PendingListViews {
    public struct SharedList: EngineListSpec {
        public static let name = "shared.list"
        public var args: EmptyArgs
        public init(_ args: EmptyArgs = .init()) { self.args = args }
        public typealias Row = SharedRow
    }
}
