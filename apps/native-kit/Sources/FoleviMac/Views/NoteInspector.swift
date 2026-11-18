// The note's inspector on the Mac (docs/MAC_NATIVE_LOOK.md, the owner's inspector profile): the note's own tools
// (WebNoteSidebar: its name and place, its pages, then Table of contents, Comments, Tasks, Attachments and links,
// Find in page) in one flat, rounded side panel inside the content card, below the top bar, at the card's right.
// ContentViewController keeps its width out of the note page's (the page never runs under it) and hides it while
// the page's own panel (Info, Foli AI, Style) is open, in Focus mode, and when the top bar's Note Tools button
// says so.
#if os(macOS)
import SwiftUI
import FoleviDesign

struct NoteInspector: View {
    let model: FrameModel

    var body: some View {
        if let noteId = model.route.noteId {
            SidePanel {
                WebNoteSidebar(model: model, noteId: noteId)
                    .id(noteId)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Note tools")
        }
    }
}
#endif
