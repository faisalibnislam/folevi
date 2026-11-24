// Whether iOS lays a view's bars out in a column at the side of the screen (iPhone Duo, iOS 27.1: closed, and open
// across; the inner screen upright keeps horizontal bars). Read from `toolbarVerticalEdge`, the system's own word,
// never the device model. Before iOS 27.1, and on every other iPhone and iPad, it is always false.
#if os(iOS)
import SwiftUI

public extension View {
    /// Reports whether iOS puts this view's bars at the side, first when the view appears and then as it changes.
    /// (The edge reads nil for a moment while the phone opens: "no side bars", the first answer too, waits until it
    /// settles.)
    func readVerticalBars(_ action: @escaping (Bool) -> Void) -> some View {
        modifier(VerticalBarsReader(action: action))
    }
}

private struct VerticalBarsReader: ViewModifier {
    let action: (Bool) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 27.1, *) {
            content.modifier(VerticalBarsReader271(action: action))
        } else {
            content.onAppear { action(false) }
        }
    }
}

@available(iOS 27.1, *)
private struct VerticalBarsReader271: ViewModifier {
    let action: (Bool) -> Void
    @Environment(\.toolbarVerticalEdge) private var edge
    @State private var side: Bool?
    @State private var changes = 0

    func body(content: Content) -> some View {
        content.onChange(of: edge, initial: true) { _, e in
            changes += 1
            let change = changes
            if e != nil {
                if side != true { side = true; action(true) }
            } else if side != false {
                // (Also the first reading: the phone may still be opening.)
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(300))
                    if changes == change { side = false; action(false) }
                }
            }
        }
    }
}
#endif
