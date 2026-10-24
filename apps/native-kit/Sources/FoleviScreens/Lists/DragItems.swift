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

public struct NoteDragItem: Codable, Hashable, Sendable, Transferable {
    public var id: String
    public var title: String
    /// Its folder now (nil: Drafts), for Undo after a move.
    public var folderId: String?
    public init(id: String, title: String, folderId: String?) {
        self.id = id
        self.title = title
        self.folderId = folderId
    }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviNoteRef)
        ProxyRepresentation { (item: NoteDragItem) in URL(string: FoleviLinks.note(item.id))! }
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
