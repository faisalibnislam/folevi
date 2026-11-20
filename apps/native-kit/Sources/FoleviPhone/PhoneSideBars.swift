// iPhone Duo's side bars (iOS 27.1, the owner's pick 2026-11-19): closed, and open across, iOS lays the navigation
// bar's and the bottom bar's items out in a column down the side of the screen. A note draws its own bars on other
// iPhones (PhoneNoteBars); where the system puts bars at the side, the note's buttons are iOS's toolbar items
// instead, so they join that column with every other screen's.
#if os(iOS)
import SwiftUI

public extension EnvironmentValues {
    /// iOS puts bars in a column at the side here (iPhone Duo closed, or open across): the note uses iOS's bars.
    @Entry var phoneSideBars = false
    /// The window is regular width (iPhone Duo open): the note sits beside its list, with no Back of its own.
    @Entry var phoneWideWindow = false
    /// The note's buttons are iOS's toolbar items (PhoneSideBars' NoteBar): at the side where `phoneSideBars`, in the
    /// top bar otherwise (the open inner screen upright, where the tab bar has the bottom).
    @Entry var phoneSystemNoteBars = false
    /// The note is the first in the split view's detail column: collapsed, iOS draws no Back for it.
    @Entry var phoneNoteFirst = false
}

public extension View {
    /// Reads whether iOS puts bars at the side into `phoneSideBars`.
    func phoneSideBarsReader() -> some View {
        modifier(SideBarsReader())
    }

    /// A note's screen: its own bars on other iPhones (`phoneOwnBar`), iOS's navigation bar where bars are at the
    /// side (the note puts its buttons in it).
    func phoneNoteBar() -> some View {
        modifier(NoteBar())
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
    @Environment(\.phoneSideBars) private var side
    @Environment(\.phoneWideWindow) private var wide

    func body(content: Content) -> some View {
        // iOS's bars where they sit at the side, and on the open inner screen upright too (the note beside its list,
        // its tools in iOS's bottom bar, laid out with the tab bar rather than floating over it).
        if side || wide {
            content
                .environment(\.phoneSystemNoteBars, true)
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
