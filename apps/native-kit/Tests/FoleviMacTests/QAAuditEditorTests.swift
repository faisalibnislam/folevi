// QA audit 1.2.32 on Folevi for Mac: a new note never flashes "In Drafts" before its place is known (F13),
// toasts sit above a note's floating page tools (F22) and checkbox outlines reach 3:1 on every page (F10).
#if os(macOS)
import Foundation
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac

@Suite("QA audit: editor and note status") @MainActor
struct QAAuditEditorTests {
    static func meta(found: Bool, folder: FolderChip? = nil) -> NoteMeta {
        NoteMeta(id: "n1", found: found, title: "", icon: nil, kind: "document", space: nil, folder: folder, breadcrumbs: [], starred: false, access: "full", canEdit: true, encrypted: false, archived: false, inTrash: false, cover: CardCover(kind: "none"), style: DemoEngine.style, sync: .saved)
    }

    @Test func noPlaceUntilKnown() {
        // Nothing from the note page or note.meta yet, or note.meta still looking: no "In Drafts".
        #expect(WebNoteSidebar.trail(tools: nil, meta: nil).isEmpty)
        #expect(WebNoteSidebar.trail(tools: nil, meta: Self.meta(found: false)).isEmpty)
        // The note page said it doesn't know yet (a note just made in a folder whose name isn't here).
        #expect(WebNoteSidebar.trail(tools: [], meta: Self.meta(found: true)).isEmpty)
    }

    @Test func placeOnceKnown() {
        #expect(WebNoteSidebar.trail(tools: nil, meta: Self.meta(found: true, folder: FolderChip(id: "f1", name: "QA"))).map(\.label) == ["QA"])
        #expect(WebNoteSidebar.trail(tools: nil, meta: Self.meta(found: true)).map(\.label) == ["Drafts"])
        let said = [NoteToolsCrumb(href: "/folders/f1", label: "QA")]
        #expect(WebNoteSidebar.trail(tools: said, meta: Self.meta(found: false)) == said)
    }

    @Test func toastsClearTheNoteTools() {
        // The floating bar's top is about 80 pt up from the card's bottom: toasts on a note sit above it.
        #expect(ToastStack.bottomInset(onNote: true) - ToastStack.bottomInset(onNote: false) == ToastStack.noteDockClearance - 16)
        #expect(ToastStack.noteDockClearance >= 92)
    }

    @Test func checkboxOutlineContrast() {
        typealias C = FoleviTokens.Chrome
        typealias W = FoleviTokens.Warm
        for (edge, checked, pages) in [
            (Palette.checkboxEdge.light, Palette.checkboxCheckedEdge.light, [C.canvas.light, C.surface.light, C.surfaceRaised.light, W.canvas.light, W.surface.light, W.surfaceSunken.light]),
            (Palette.checkboxEdge.dark, Palette.checkboxCheckedEdge.dark, [C.canvas.dark, C.surface.dark, C.surfaceRaised.dark, W.canvas.dark, W.surface.dark, W.surfaceSunken.dark]),
        ] {
            for page in pages {
                #expect(edge.contrast(page) >= 3, "unchecked on \(page)")
                #expect(checked.contrast(page) >= 3, "checked on \(page)")
            }
        }
    }
}
#endif
