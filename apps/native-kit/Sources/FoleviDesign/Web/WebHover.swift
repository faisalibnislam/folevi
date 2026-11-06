// The hover every clickable control shows (the owner, 2026-11-06: "all buttons show hover effect everywhere"):
// on the Mac, and on the iPad with a pointer or trackpad (`onHover` follows the pointer there; an iPhone never
// fires it). The shared pieces:
//
//   .webHover(radius:)              a quiet `--glass-hover` fill over the control's own box, `radius` round
//   .webLinkHover()                 a text link: its words fade a little under the pointer
//   .buttonStyle(.webHover(radius:)) Folevi's plain button (WebPlainButtonStyle) with that fill built in
//   .buttonStyle(.webLink)           Folevi's plain button for a text link
//
// A disabled control takes no hover (`isEnabled`), and nor does one that shows a selected or pressed look of its
// own (`enabled: false`), so a selection keeps its look. Nothing changes at rest: the fill only exists under the
// pointer. Tests/FoleviMacTests/HoverGuardTests.swift checks that new plain buttons use one of these.
import SwiftUI

/// The `--glass-hover` fill over a control while the pointer is on it.
public struct WebHoverFill: ViewModifier {
    let radius: CGFloat
    let fill: String
    let active: Bool
    @State private var over = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme

    public init(radius: CGFloat, fill: String = "glass-hover", active: Bool = true) {
        self.radius = radius
        self.fill = fill
        self.active = active
    }

    public func body(content: Content) -> some View {
        content
            .overlay {
                if over && enabled && active {
                    RoundedRectangle(cornerRadius: radius, style: .circular)
                        .fill(WebStyles.vars[fill]?.resolve(scheme).color ?? .clear)
                        .allowsHitTesting(false)
                }
            }
            .onHover { over = $0 }
    }
}

/// A text link under the pointer: its words fade to about three quarters, as a link's colour changes on the web.
public struct WebLinkHover: ViewModifier {
    let active: Bool
    @State private var over = false
    @Environment(\.isEnabled) private var enabled

    public init(active: Bool = true) { self.active = active }

    public func body(content: Content) -> some View {
        content
            .opacity(over && enabled && active ? 0.72 : 1)
            .onHover { over = $0 }
    }
}

/// A filled (primary or danger) control under the pointer: a touch brighter, as `.ui-btn-primary:hover`
/// (`filter: brightness(1.05)`) has it.
public struct WebBrightHover: ViewModifier {
    let active: Bool
    @State private var over = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme

    public init(active: Bool = true) { self.active = active }

    public func body(content: Content) -> some View {
        content
            .brightness(over && enabled && active ? (scheme == .dark ? 0.06 : 0.05) : 0)
            .onHover { over = $0 }
    }
}

public extension View {
    /// The quiet hover fill (`--glass-hover` unless `fill` names another colour variable) over this control's box,
    /// `radius` round. `active: false` for a selected or pressed look that keeps its own fill.
    func webHover(radius: CGFloat, fill: String = "glass-hover", active: Bool = true) -> some View {
        modifier(WebHoverFill(radius: radius, fill: fill, active: active))
    }

    /// A text link's hover: its words fade a little.
    func webLinkHover(active: Bool = true) -> some View { modifier(WebLinkHover(active: active)) }

    /// A filled control's hover: a touch brighter.
    func webBrightHover(active: Bool = true) -> some View { modifier(WebBrightHover(active: active)) }
}

/// Folevi's plain button (no system highlight, the whole label takes the click, PressDip on press) with the quiet
/// hover fill at `radius`. `selected`: a selected look of its own, so no hover over it.
public struct WebHoverButtonStyle: ButtonStyle {
    let radius: CGFloat
    let fill: String
    let selected: Bool

    public init(radius: CGFloat = 8, fill: String = "glass-hover", selected: Bool = false) {
        self.radius = radius
        self.fill = fill
        self.selected = selected
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .webHover(radius: radius, fill: fill, active: !selected)
            .pressDip(configuration.isPressed)
    }
}

/// Folevi's plain button for a text link: the words fade a little under the pointer.
public struct WebLinkButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .webLinkHover()
            .pressDip(configuration.isPressed)
    }
}

public extension ButtonStyle where Self == WebHoverButtonStyle {
    /// `.buttonStyle(.webHover(radius: 8))`: a plain button with the quiet hover fill.
    static func webHover(radius: CGFloat = 8, fill: String = "glass-hover", selected: Bool = false) -> WebHoverButtonStyle {
        WebHoverButtonStyle(radius: radius, fill: fill, selected: selected)
    }
}

public extension ButtonStyle where Self == WebLinkButtonStyle {
    /// `.buttonStyle(.webLink)`: a plain button for a text link.
    static var webLink: WebLinkButtonStyle { WebLinkButtonStyle() }
}
