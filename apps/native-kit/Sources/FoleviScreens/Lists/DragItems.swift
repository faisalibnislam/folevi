// What a dragged note or folder carries (plan 5.5): a Folevi type for drops inside the app (folder cards, the
// sidebar, the editor turns a note into a page link) and the public link for drops into other apps. The hosts
// declare `com.folevi.note-ref` and `com.folevi.folder-ref` as exported types in their Info.plist.
import CoreTransferable
import Foundation
import UniformTypeIdentifiers

public extension UTType {
    static let foleviNoteRef = UTType(exportedAs: "com.folevi.note-ref")
    static let foleviFolderRef = UTType(exportedAs: "com.folevi.folder-ref")
}

/// One note a drag carries.
public struct NoteRef: Codable, Hashable, Sendable {
    public var id: String
    public var title: String
    /// Its folder now (nil: Drafts), for Undo after a move.
    public var folderId: String?
    public init(id: String, title: String, folderId: String?) {
        self.id = id
        self.title = title
        self.folderId = folderId
    }
}

/// One folder a selection's drag carries along with its notes.
public struct FolderRef: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    /// Its parent now (nil: the top level).
    public var parentId: String?
    public init(id: String, name: String, parentId: String?) {
        self.id = id
        self.name = name
        self.parentId = parentId
    }
}

/// A dragged note, or a whole selection: dragging a selected note in Select mode (or with several selected on
/// the Mac) carries every selected note that's loaded, and (a folder's page, ListSelection) the selected folders.
public struct NoteDragItem: Codable, Hashable, Sendable, Transferable {
    public var notes: [NoteRef]
    /// Folders of the same selection (dropped on a folder, they go inside it too).
    public var folders: [FolderRef]
    public init(notes: [NoteRef], folders: [FolderRef] = []) {
        self.notes = notes
        self.folders = folders
    }
    public init(id: String, title: String, folderId: String?) {
        self.notes = [NoteRef(id: id, title: title, folderId: folderId)]
        self.folders = []
    }

    // (A drag from an older build carries no folders.)
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        notes = try c.decode([NoteRef].self, forKey: .notes)
        folders = try c.decodeIfPresent([FolderRef].self, forKey: .folders) ?? []
    }

    public var ids: [String] { notes.map(\.id) }
    /// Each note's folder now, for Undo.
    public var from: [String: String?] {
        var out: [String: String?] = [:]
        for n in notes { out[n.id] = n.folderId }
        return out
    }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviNoteRef)
        ProxyRepresentation { (item: NoteDragItem) in URL(string: FoleviLinks.note(item.notes.first?.id ?? ""))! }
    }
}

public struct FolderDragItem: Codable, Hashable, Sendable, Transferable {
    public var id: String
    public var name: String
    public var parentId: String?
    public init(id: String, name: String, parentId: String?) {
        self.id = id
        self.name = name
        self.parentId = parentId
    }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviFolderRef)
        ProxyRepresentation { (item: FolderDragItem) in URL(string: FoleviLinks.folder(item.id))! }
    }
}
