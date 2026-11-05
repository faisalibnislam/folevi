// What a card's drop target reads from a drag (FolderDrop.performDrop): a note or folder dragged with `.draggable`
// comes as an item provider with Folevi's own type, its data the JSON CodableRepresentation writes.
import Foundation
import Testing
import UniformTypeIdentifiers
@testable import FoleviScreens

@Suite("Drag items")
struct DragItemTests {
    @Test func aDraggedNoteReadsBackAsJSONData() async throws {
        let provider = NSItemProvider()
        provider.register(NoteDragItem(id: "01ABC", title: "Trip", folderId: nil))
        #expect(provider.hasItemConformingToTypeIdentifier(UTType.foleviNoteRef.identifier))
        let data: Data? = await withCheckedContinuation { done in
            _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.foleviNoteRef.identifier) { data, _ in done.resume(returning: data) }
        }
        let item = try JSONDecoder().decode(NoteDragItem.self, from: try #require(data))
        #expect(item.ids == ["01ABC"])
    }

    @Test func aDraggedFolderReadsBackAsJSONData() async throws {
        let provider = NSItemProvider()
        provider.register(FolderDragItem(id: "F1", name: "Shelf", parentId: nil))
        let data: Data? = await withCheckedContinuation { done in
            _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.foleviFolderRef.identifier) { data, _ in done.resume(returning: data) }
        }
        #expect(try JSONDecoder().decode(FolderDragItem.self, from: try #require(data)).id == "F1")
    }
}
