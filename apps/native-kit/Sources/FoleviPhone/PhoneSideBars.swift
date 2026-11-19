// iPhone Duo's side bars (iOS 27.1, the owner's pick 2026-11-19): closed, and open across, iOS lays the navigation
// bar's and the bottom bar's items out in a column down the side of the screen. A note draws its own bars on other
// iPhones (PhoneNoteBars); where the system puts bars at the side, the note's buttons are iOS's toolbar items
// instead, so they join that column with every other screen's.
#if os(iOS)
import SwiftUI

public extension EnvironmentValues {
    /// iOS puts bars in a column at the side here (iPhone Duo closed, or open across): the note uses iOS's bars.
    @Entry var phoneSideBars = false
}

public extension View {
    /// Reads whether iOS puts bars at the side into `phoneSideBars`.
    func phoneSideBarsReader() -> some View {
        modifier(SideBarsReader())
    }

    /// A note's screen: its own bars on other iPhones (`phoneOwnBar`), iOS's navigation bar where bars are at the
    /// side (the note puts its buttons in it). The note beside its list (`inColumn`) keeps its own bars.
    func phoneNoteBar(inColumn: Bool) -> some View {
        modifier(NoteBar(inColumn: inColumn))
    }
}

private struct SideBarsReader: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 27.1, *) {
            content.modifier(SideBarsReader271())
        } else {
            content
        }
    }
}

@available(iOS 27.1, *)
private struct SideBarsReader271: ViewModifier {
    @Environment(\.toolbarVerticalEdge) private var edge
    /// (The edge reads nil for a moment while the phone opens: the last edge stays until it settles.)
    @State private var side = false
    @State private var changes = 0

    func body(content: Content) -> some View {
        content
            .environment(\.phoneSideBars, side)
            .onChange(of: edge, initial: true) { _, e in
                changes += 1
                let change = changes
                if e != nil {
                    side = true
                } else if side {
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(300))
                        if changes == change { side = false }
                    }
                }
            }
    }
}

private struct NoteBar: ViewModifier {
    let inColumn: Bool
    @Environment(\.phoneSideBars) private var side

    func body(content: Content) -> some View {
        // The note beside its list keeps its own bars: iOS 27 leaves a column's side-bar items behind as empty glass
        // when the phone folds and the column goes (and on the open screen the sidebar has the tabs' place, so
        // there is no side column to join).
        if side, !inColumn {
            content
                .toolbar(.visible, for: .navigationBar)
                .navigationBarTitleDisplayMode(.inline)
        } else {
            content
                .environment(\.phoneSideBars, false)
                .phoneOwnBar()
        }
    }
}
#endif
