// The note's inspector on the Mac (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): the note's own tools
// (WebNoteSidebar: its name and place, its pages, then Table of contents, Comments, Tasks, Attachments and links,
// Find in page) in a column on the window's material at the right, under the title bar, as the sidebar is at the
// left: no panel of its own, its sections in a quiet segmented control at its top. FrameSplitViewController keeps
// its width out of the card's and hides it while the page's own panel (Style, Format, Insert, Foli AI) has the
// column, in Focus mode, when the title bar's button says so, and in a window too narrow for both.
#if os(macOS)
import SwiftUI
import FoleviDesign

struct NoteInspector: View {
    let model: FrameModel

    var body: some View {
        if let noteId = model.route.noteId {
            WebNoteSidebar(model: model, noteId: noteId)
                .id(noteId)
                .padding(.trailing, 4)
                .frame(maxHeight: .infinity, alignment: .top)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Note tools")
        }
    }
}
#endif
