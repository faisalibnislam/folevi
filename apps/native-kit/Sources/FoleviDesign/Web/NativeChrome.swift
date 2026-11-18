// Folevi for Mac's native look (docs/MAC_NATIVE_LOOK.md, the owner, 2026-11-18) as the shared design layer applies
// it: "system chrome, Folevi content". While a view tree carries a NativeChrome (the Mac's screens set one, from
// FoleviMac's MacLook), the web components here draw their interface parts the macOS way:
//
// - interface text (webText, foleviFont, WebPrettyText, WebClampedText, WebParagraph) is the system font in the
//   chrome's four sizes, picked by the web size it replaces, with native wrapping instead of WebKit's;
// - boxes (webBox) keep their fills and borders but lose the web's drawn shadows and gradients;
// - WebButton, WebTextField and WebCheckboxStyle become the system's Button, TextField and checkbox.
//
// Note content keeps Folevi's own fonts and look: note and folder cards reset the chrome for what they draw
// (`noteContent()`), as does anything else a note draws. Nothing sets a chrome on iPhone or iPad, so they draw
// exactly as before.
import SwiftUI

public struct NativeChrome: Hashable, Sendable {
    /// The four interface sizes (macOS: title 22, title3 15, body 13, subheadline 11).
    public var title: CGFloat
    public var title3: CGFloat
    public var body: CGFloat
    public var small: CGFloat
    /// The one prominent action's fill, and its ink.
    public var accent: Color
    public var onAccent: Color
    /// A borderless control's hover fill.
    public var hover: Color

    public init(title: CGFloat, title3: CGFloat, body: CGFloat, small: CGFloat, accent: Color, onAccent: Color, hover: Color) {
        self.title = title
        self.title3 = title3
        self.body = body
        self.small = small
        self.accent = accent
        self.onAccent = onAccent
        self.hover = hover
    }

    /// The interface size for a web size: a page title (24 pt and up on the web) is the title; a section title (17
    /// to 20) title3; body and control text (13 to 16) body; anything smaller the small size.
    public func size(for web: CGFloat) -> CGFloat {
        switch web {
        case 21.5...: title
        case 16.5..<21.5: title3
        case 12.5..<16.5: body
        default: small
        }
    }

    /// A web text style as interface text: the system font at the matching size, the same weight (a title at least
    /// semibold), no letter spacing. Code (mono) and text already in the system font stay as they are.
    public func text(_ s: WebTextStyle) -> WebTextStyle {
        guard s.family == .sans || s.family == .display else { return s }
        let size = size(for: s.size)
        let weight = size == title ? max(s.weight, 600) : s.weight
        return WebTextStyle(family: .system, size: size, leading: Self.leading(size), weight: weight, letterSpacing: 0)
    }

    /// A Folevi text style (`foleviFont`) as interface text. Caps become an 11 pt semibold heading, not upper case.
    public func text(_ s: FoleviTextStyle) -> WebTextStyle {
        let weight: CGFloat = switch s.weight {
        case .semibold: 600
        case .medium: 500
        case .bold: 700
        default: 400
        }
        let size = s == .caps ? small : size(for: s.size)
        return WebTextStyle(family: .system, size: size, leading: Self.leading(size), weight: size == title ? max(weight, 600) : weight, letterSpacing: 0)
    }

    /// The system font's line at a size, rounded (11: 14, 13: 16, 15: 19, 22: 28).
    static func leading(_ size: CGFloat) -> CGFloat { (size * 1.25).rounded() }

    /// The SwiftUI font for a style in the system family.
    static func font(_ s: WebTextStyle) -> Font {
        .system(size: s.size, weight: WebFont.nearestStatic(s.weight))
    }
}

extension EnvironmentValues {
    /// Set on the Mac's screens (and their dialogs): interface parts draw natively. Nil everywhere else.
    @Entry public var nativeChrome: NativeChrome? = nil
}

public extension View {
    /// What a note draws (a note card's title and preview, a folder card's art, the editor's text): Folevi's own
    /// fonts and look, under any native chrome around it.
    func noteContent() -> some View {
        environment(\.nativeChrome, nil)
    }
}

/// A borderless button under the native look (WebButton's ghost and quiet variants, row actions): the label in the
/// primary ink, a rounded hover fill, a deeper one pressed.
public struct NativeBorderlessStyle: ButtonStyle {
    let chrome: NativeChrome
    let radius: CGFloat

    public init(_ chrome: NativeChrome, radius: CGFloat = 6) {
        self.chrome = chrome
        self.radius = radius
    }

    public func makeBody(configuration: Configuration) -> some View {
        NativeBorderlessBody(configuration: configuration, chrome: chrome, radius: radius)
    }

    struct NativeBorderlessBody: View {
        let configuration: Configuration
        let chrome: NativeChrome
        let radius: CGFloat
        @State private var hovered = false
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            // (As tall as a compact control, so a borderless action beside a push button isn't a sliver.)
            configuration.label
                .padding(.horizontal, 8)
                .frame(minHeight: 24)
                .background {
                    if enabled, hovered || configuration.isPressed {
                        Capsule().fill(chrome.hover.opacity(configuration.isPressed ? 1 : 0.6))
                    }
                }
                .contentShape(Capsule())
                .opacity(enabled ? 1 : 0.4)
                .onHover { hovered = $0 }
        }
    }
}

/// The one prominent button's label: the accent's ink while its window is active. In an inactive window the system
/// grays the button, and its label keeps the system's ink (the accent's would be dark on gray).
public struct NativeAccentInk: ViewModifier {
    let chrome: NativeChrome
    #if os(macOS)
    @Environment(\.controlActiveState) private var active
    #endif

    public init(_ chrome: NativeChrome) { self.chrome = chrome }

    public func body(content: Content) -> some View {
        #if os(macOS)
        if active == .inactive {
            content
        } else {
            content.foregroundStyle(chrome.onAccent)
        }
        #else
        content.foregroundStyle(chrome.onAccent)
        #endif
    }
}
