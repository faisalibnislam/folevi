// The sidebar reads what the shared screens drag (FoleviScreens' NoteDragItem and FolderDragItem, a Codable
// representation of com.folevi.note-ref / com.folevi.folder-ref), and older bare ids.
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
import Testing
import FoleviScreens
@testable import FoleviMac

@Suite("Drag types") @MainActor
struct DragTypeTests {
    @Test func notesFromTheListScreens() throws {
        let item = NSPasteboardItem()
        item.setData(try JSONEncoder().encode(NoteDragItem(id: "doc_1", title: "A", folderId: nil)), forType: .init(FrameDrag.noteType))
        #expect(FrameDrag.noteIds(item) == ["doc_1"])
        #expect(FrameDrag.folderId(item) == nil)
        // A whole selection dragged from a list (Shift or Command clicks on the Mac).
        let many = NSPasteboardItem()
        many.setData(try JSONEncoder().encode(NoteDragItem(notes: [NoteRef(id: "a", title: "A", folderId: nil), NoteRef(id: "b", title: "B", folderId: "f")])), forType: .init(FrameDrag.noteType))
        #expect(FrameDrag.noteIds(many) == ["a", "b"])
        let bare = NSPasteboardItem()
        bare.setString("doc_2", forType: .init(FrameDrag.noteType))
        #expect(FrameDrag.noteIds(bare) == ["doc_2"])
    }

    @Test func foldersFromCardsAndTheSidebar() throws {
        let item = NSPasteboardItem()
        item.setData(try JSONEncoder().encode(FolderDragItem(id: "f1", name: "F", parentId: nil)), forType: .init(FrameDrag.folderType))
        #expect(FrameDrag.folderId(item) == "f1")
    }

    @Test func theTypesAreTheScreensOwn() {
        #expect(FrameDrag.noteType == UTType.foleviNoteRef.identifier)
        #expect(FrameDrag.folderType == UTType.foleviFolderRef.identifier)
    }
}
#endif
