// Folevi's motion on the Mac and the iPad's wide layout: the web's own where it has one (globals.css,
// `data-desktop="mac"`: a dialog `mac-sheet-in` 180 ms ease-out from 8 pt above, a popover `mac-pop-in` 120 ms from
// 4 pt below, a tooltip `mac-fade-in` 100 ms; menus open at once, hover answers at once), and macOS's own for what
// the web doesn't move (a menu or a dialog fading as it goes, a section of the sidebar opening, a view switching).
// Springs (FoleviSpring, the owner, 2026-11-01): what's tapped dips and springs back, sheets and popovers grow from
// what opened them, the selected tab's pill slides, all playful (a visible overshoot, as iOS 26's own). With Reduce
// Motion everything only fades (the web's 120 ms linear).
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

/// Grows in from what opened it when it first appears (a dialog from above, a popover from below): from 90% and
/// `dy` points away on FoleviSpring.pop, settling with a small overshoot. Under Reduce Motion it only fades.
public struct WebArrival: ViewModifier {
    let dy: CGFloat
    let duration: TimeInterval
    @State private var shown = false

    public init(dy: CGFloat, duration: TimeInterval) {
        self.dy = dy
        self.duration = duration
    }

    public func body(content: Content) -> some View {
        let reduced = WebMotion.reduced
        content
            .opacity(shown ? 1 : 0)
            .scaleEffect(shown || reduced ? 1 : 0.9, anchor: dy < 0 ? .top : .bottom)
            .offset(y: shown || reduced ? 0 : dy)
            .onAppear {
                withAnimation(reduced ? .linear(duration: 0.12) : FoleviSpring.pop) { shown = true }
            }
    }
}

public extension View {
    /// A dialog arriving: 8 pt from above, 180 ms (globals.css `mac-sheet-in`).
    func webSheetIn() -> some View { modifier(WebArrival(dy: -8, duration: WebMotion.sheetIn)) }
    /// A popover arriving: 4 pt from below, 120 ms (`mac-pop-in`).
    func webPopIn() -> some View { modifier(WebArrival(dy: 4, duration: WebMotion.popIn)) }
}

/// Folevi's springs on every platform (the owner, 2026-11-01: playful, like the iOS 26 videos; globals.css has the
/// same as `--spring-*`). Under Reduce Motion each is a short fade-speed curve and nothing scales or moves.
public enum FoleviSpring {
    /// A sheet, popover or menu growing from what opened it: a visible overshoot, settled in about half a second.
    @MainActor public static var pop: Animation { WebMotion.reduced ? .easeOut(duration: 0.15) : .spring(response: 0.42, dampingFraction: 0.66) }
    /// A selection moving (the tab bar's pill, a segmented control), a sidebar sliding in.
    @MainActor public static var slide: Animation { WebMotion.reduced ? .easeInOut(duration: 0.15) : .spring(response: 0.38, dampingFraction: 0.7) }
    /// A press: in quickly, back with a small bounce.
    @MainActor public static var press: Animation { WebMotion.reduced ? .linear(duration: 0.08) : .spring(response: 0.24, dampingFraction: 0.52) }
}

/// What's pressed dips a little and springs back (cards, buttons, rows): never under Reduce Motion.
public struct PressDip: ViewModifier {
    let pressed: Bool
    let scale: CGFloat
    @Environment(\.colorScheme) private var scheme

    public init(pressed: Bool, scale: CGFloat = 0.96) {
        self.pressed = pressed
        self.scale = scale
    }

    public func body(content: Content) -> some View {
        #if os(macOS)
        // The Mac (globals.css §2.4): "pressed controls darken, never scale or lift (a Mac button doesn't move)". The
        // darkening comes at once and fades out over 120 ms, as the web's press fills do. A scale also pulled a control's
        // edge in under the pointer, so a click that started near a row's edge could end outside it (MAC-07).
        content
            .brightness(pressed ? Self.macPressBrightness(scheme) : 0)
            .animation(pressed ? nil : .easeOut(duration: WebMotion.fadeOut), value: pressed)
        #else
        content
            .scaleEffect(pressed && !WebMotion.reduced ? scale : 1)
            .animation(FoleviSpring.press, value: pressed)
        #endif
    }

    /// How much a pressed control darkens on the Mac (the web's primary button: about 4% darker); in the dark it
    /// lightens a touch, as `--mac-press` does there (white at 10%).
    public static func macPressBrightness(_ scheme: ColorScheme) -> Double { scheme == .dark ? 0.06 : -0.05 }
}

public extension View {
    /// Dips to `scale` while `pressed` (a ButtonStyle's isPressed), springing back on release; on the Mac it darkens
    /// instead and never scales.
    func pressDip(_ pressed: Bool, scale: CGFloat = 0.96) -> some View { modifier(PressDip(pressed: pressed, scale: scale)) }
}

/// A plain button (no system highlight) that dips while pressed (darkens on the Mac): for cards and tiles, so a tap
/// feels physical and scrolling and dragging still work as they do for any button.
public struct PressDipButtonStyle: ButtonStyle {
    let scale: CGFloat
    public init(scale: CGFloat = 0.97) { self.scale = scale }
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle()).pressDip(configuration.isPressed, scale: scale)
    }
}

/// Folevi's plain button on every platform: no system highlight, the whole label takes the click, and the one press
/// answer (PressDip: darkens on the Mac, dips on iPhone and iPad). Use it in place of `.buttonStyle(.plain)`, whose
/// own pressed dimming is another, different press feedback on the Mac (MAC-07).
public struct WebPlainButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle()).pressDip(configuration.isPressed)
    }
}

public extension ButtonStyle where Self == WebPlainButtonStyle {
    /// `.buttonStyle(.webPlain)`: Folevi's plain button (WebPlainButtonStyle).
    static var webPlain: WebPlainButtonStyle { WebPlainButtonStyle() }
}
