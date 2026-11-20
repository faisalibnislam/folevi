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

    /// iOS 26's toolbars (Liquid Glass) for a note on every iPhone.
    static var systemBarsEverywhere: Bool {
        if #available(iOS 26, *) { true } else { false }
    }

    func body(content: Content) -> some View {
        // iOS's bars on every iPhone since iOS 26 (the owner, 2026-11-20: the note's own bars slid in with the page
        // while the tab bar snapped away; iOS's bars stay put and iOS moves between the tab bar and them itself):
        // at the side where iOS puts them there (iPhone Duo), the tools in its bottom bar elsewhere.
        if side || wide || Self.systemBarsEverywhere {
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
