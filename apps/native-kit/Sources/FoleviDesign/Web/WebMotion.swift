// Folevi's motion on the Mac and the iPad's wide layout: the web's own where it has one (globals.css,
// `data-desktop="mac"`: a dialog `mac-sheet-in` 180 ms ease-out from 8 pt above, a popover `mac-pop-in` 120 ms from
// 4 pt below, a tooltip `mac-fade-in` 100 ms; menus open at once, hover answers at once), and macOS's own for what
// the web doesn't move (a menu or a dialog fading as it goes, a section of the sidebar opening, a view switching).
// Short and quiet: nothing bounces. With Reduce Motion everything only fades (the web's 120 ms linear).
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

public enum WebMotion {
    /// Reduce Motion in the system's Accessibility settings.
    @MainActor public static var reduced: Bool {
        #if os(macOS)
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #else
        UIAccessibility.isReduceMotionEnabled
        #endif
    }

    /// A dialog arriving (`mac-sheet-in`).
    public static let sheetIn: TimeInterval = 0.18
    /// A popover arriving (`mac-pop-in`).
    public static let popIn: TimeInterval = 0.12
    /// Anything floating going away (a menu, a dialog, a popover): macOS fades it.
    public static let fadeOut: TimeInterval = 0.12
    /// A section or a folder opening or closing in the sidebar, a list's rows coming and going.
    public static let disclosure: TimeInterval = 0.2
    /// One view of the same place for another (Grid and List, a calendar's Month and Week).
    public static let viewSwitch: TimeInterval = 0.15

    /// The curve for a change in place (opening, closing, switching): ease in and out, or a plain fade.
    @MainActor public static func change(_ duration: TimeInterval = disclosure) -> Animation {
        reduced ? .linear(duration: 0.12) : .easeInOut(duration: duration)
    }

    /// Runs `body` animated as a change in place.
    @MainActor public static func animate(_ duration: TimeInterval = disclosure, _ body: () -> Void) {
        withAnimation(change(duration), body)
    }
}

/// Fades in from `dy` points away when it first appears (a dialog from above, a popover from below).
public struct WebArrival: ViewModifier {
    let dy: CGFloat
    let duration: TimeInterval
    @State private var shown = false

    public init(dy: CGFloat, duration: TimeInterval) {
        self.dy = dy
        self.duration = duration
    }

    public func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : dy)
            .onAppear {
                let reduced = WebMotion.reduced
                withAnimation(reduced ? .linear(duration: 0.12) : .easeOut(duration: duration)) { shown = true }
            }
    }
}

public extension View {
    /// A dialog arriving: 8 pt from above, 180 ms (globals.css `mac-sheet-in`).
    func webSheetIn() -> some View { modifier(WebArrival(dy: -8, duration: WebMotion.sheetIn)) }
    /// A popover arriving: 4 pt from below, 120 ms (`mac-pop-in`).
    func webPopIn() -> some View { modifier(WebArrival(dy: 4, duration: WebMotion.popIn)) }
}
