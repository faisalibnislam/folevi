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
// (`noteContent()`), as does anything else a note draws. The iPad sets none, so it draws
// exactly as before. Since 2026-11-19 the iPhone sets one too (FoleviDesign/Phone/PhoneNativeLook.swift), with
// `dynamicType`: Apple's text sizes, following the person's text size.
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
    /// The iPhone's native look (the owner, 2026-11-19): interface text keeps the size the web gives it, snapped to
    /// the nearest of Apple's text styles (Body 17, Subheadline 15, Footnote 13, ...), and follows Dynamic Type.
    /// The Mac's four fixed sizes otherwise.
    public var dynamicType: Bool

    public init(title: CGFloat, title3: CGFloat, body: CGFloat, small: CGFloat, accent: Color, onAccent: Color, hover: Color, dynamicType: Bool = false) {
        self.title = title
        self.title3 = title3
        self.body = body
        self.small = small
        self.accent = accent
        self.onAccent = onAccent
        self.hover = hover
        self.dynamicType = dynamicType
    }

    /// Apple's text styles by their default (Large) size, largest first (the HIG's iOS type sizes).
    static let appleStyles: [(size: CGFloat, style: Font.TextStyle)] = [
        (34, .largeTitle), (28, .title), (22, .title2), (20, .title3), (17, .body), (16, .callout), (15, .subheadline),
        (13, .footnote), (12, .caption), (11, .caption2),
    ]

    /// The Apple text size nearest a web size (14 reads as Subheadline, 18 as Body, 24 as Title 2).
    public static func appleSize(_ web: CGFloat) -> CGFloat {
        appleStyles.min { abs($0.size - web) < abs($1.size - web) || (abs($0.size - web) == abs($1.size - web) && $0.size > $1.size) }!.size
    }

    /// The text style whose default size is `size` (an Apple size, see `appleSize`).
    static func textStyle(_ size: CGFloat) -> Font.TextStyle? {
        appleStyles.first { $0.size == size }?.style
    }

    /// The font for interface text in this chrome: under `dynamicType` Apple's text style at that size (so it
    /// grows and shrinks with the person's text size), else the system font at the fixed size.
    public func font(_ s: WebTextStyle) -> Font {
        if dynamicType, s.family == .system, let style = Self.textStyle(s.size) {
            return .system(style, weight: WebFont.nearestStatic(s.weight))
        }
        return Self.font(s)
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
        if dynamicType {
            let size = Self.appleSize(s.size)
            return WebTextStyle(family: .system, size: size, leading: Self.leading(size), weight: s.weight, letterSpacing: 0)
        }
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
        if dynamicType {
            let size = Self.appleSize(s == .caps ? 13 : s.size)
            return WebTextStyle(family: .system, size: size, leading: Self.leading(size), weight: s == .caps ? 600 : weight, letterSpacing: 0)
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

public extension WebFont {
    /// Interface text set straight in a font (a field, a run in an attributed string, a canvas label): the system
    /// font at the same size and weight under the Mac's native look (`chrome` set), its monospaced design for code;
    /// Folevi's own family everywhere else (the iPhone, the iPad). The owner, 2026-11-18: the whole Mac app is the
    /// system font but for notes, folders and the editor.
    static func interface(_ chrome: NativeChrome?, _ family: WebFontFamily = .sans, size: CGFloat, weight: CGFloat = 400, italic: Bool = false) -> Font {
        guard let chrome else { return font(family, size: size, weight: weight, italic: italic) }
        if chrome.dynamicType, family != .mono {
            let f = chrome.font(WebTextStyle(family: .system, size: NativeChrome.appleSize(size), leading: 0, weight: weight))
            return italic ? f.italic() : f
        }
        let f = Font.system(size: size, weight: nearestStatic(weight), design: family == .mono ? .monospaced : .default)
        return italic ? f.italic() : f
    }
}

public extension WebTextStyle {
    /// A card's interface words (its dates, its folder chip, a folder's count line) in the system font at the same
    /// size and weight, under the Mac's native look (`native`: the chrome round the card is set). The owner,
    /// 2026-11-18: the whole app is the system font but for notes (a card's title and preview) and folders (a
    /// folder's name).
    func cardInterface(_ native: Bool) -> WebTextStyle {
        guard native else { return self }
        return WebTextStyle(family: .system, size: size, leading: leading, weight: weight, letterSpacing: 0)
    }
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

// MARK: - The Mac's text field

/// The one text field of Folevi for Mac's native look (the owner, 2026-11-18: "form fields look tiny and weird",
/// then "the selected active field ... very poorly done"). Every field is this one: 34 pt (a segmented control's
/// height), 8 pt corners, 12 pt before its words. At rest a quiet well with a hairline edge; under the pointer the
/// edge firms up; with the cursor in it the well lifts, the edge is a crisp 1.5 pt line in the ink's colour and a
/// soft halo sits outside it, so the field never changes size and the active one is unmistakable.
public enum NativeField {
    public static let height: CGFloat = 34
    public static let radius: CGFloat = 8
    public static let inset: CGFloat = 12
    public static let textSize: CGFloat = 13
    /// A label over a field, and the room between the two and between one field and the next.
    public static let labelSize: CGFloat = 12
    public static let labelGap: CGFloat = 6
    public static let fieldGap: CGFloat = 16

    static func ink(_ scheme: ColorScheme) -> Color { scheme == .dark ? .white : .black }
    static func fill(_ scheme: ColorScheme, focused: Bool) -> Color {
        scheme == .dark ? Color.white.opacity(focused ? 0.1 : 0.055) : Color.black.opacity(focused ? 0 : 0.035)
    }
    static func edge(_ scheme: ColorScheme, focused: Bool, hovered: Bool) -> Color {
        ink(scheme).opacity(focused ? (scheme == .dark ? 0.92 : 0.82) : hovered ? (scheme == .dark ? 0.3 : 0.26) : (scheme == .dark ? 0.14 : 0.12))
    }
    static func halo(_ scheme: ColorScheme) -> Color { ink(scheme).opacity(scheme == .dark ? 0.16 : 0.1) }
}

/// The field's surface round its text: `height` nil for a text area, which keeps its own height.
public struct NativeFieldBox: ViewModifier {
    var focused: Bool
    var height: CGFloat?
    var vertical: CGFloat
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    @State private var hovered = false

    public init(focused: Bool, height: CGFloat? = NativeField.height, vertical: CGFloat = 0) {
        self.focused = focused
        self.height = height
        self.vertical = vertical
    }

    public func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: NativeField.radius, style: .continuous)
        content
            .padding(.horizontal, NativeField.inset)
            .padding(.vertical, vertical)
            .frame(height: height)
            .background(shape.fill(NativeField.fill(scheme, focused: focused)))
            .overlay(shape.strokeBorder(NativeField.edge(scheme, focused: focused, hovered: hovered), lineWidth: focused ? 1.5 : 1))
            // The halo sits outside the field, so the field never changes size as the cursor comes and goes.
            .background {
                if focused {
                    RoundedRectangle(cornerRadius: NativeField.radius + 3, style: .continuous)
                        .fill(NativeField.halo(scheme))
                        .padding(-3)
                        .allowsHitTesting(false)
                }
            }
            .opacity(enabled ? 1 : 0.5)
            .onHover { hovered = $0 }
            .animation(.easeOut(duration: 0.14), value: focused)
            .animation(.easeOut(duration: 0.1), value: hovered)
    }
}

/// A field's label in a form: 12 pt medium, a step quieter than the field's words.
public struct NativeFieldLabel: View {
    let text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
        Text(text).font(.system(size: NativeField.labelSize, weight: .medium)).foregroundStyle(Color.primary.opacity(0.72)).lineLimit(1)
    }
}

struct NativeTextFieldModifier: ViewModifier {
    var height: CGFloat
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.system(size: NativeField.textSize))
            .lineLimit(1)
            .focused($focused)
            .modifier(NativeFieldBox(focused: focused, height: height))
            // A click anywhere in the field puts the cursor in it (the padding round the text is the field too).
            .contentShape(Rectangle())
            .onTapGesture { focused = true } // (no hover: a field, the click puts the cursor in it)
    }
}

public extension View {
    /// A one-line `TextField` or `SecureField` drawn as the Mac app's field (NativeField). A font set on the field
    /// itself (a fixed-width one for a secret) is kept.
    func nativeTextField(height: CGFloat = NativeField.height) -> some View { modifier(NativeTextFieldModifier(height: height)) }
}

// MARK: - The Mac's shadows

/// The four shadows of Folevi for Mac's native look (the owner, 2026-11-18: "shadows are inconsistent ... I prefer
/// less shadows"). Every shadow was its own numbers, from 5% to 25% and 1 to 28 pt. Each is now one of these, all
/// of them light; a surface is told apart by its hairline edge first and its shadow second.
public enum NativeShadow: Sendable {
    /// A chosen pill in its track, a knob: just enough to lift it off the track.
    case raised
    /// Content sitting on the page: a thumbnail, a picture of a tab.
    case card
    /// A control or tip floating over content: a tab being dragged, a card under the pointer, a tooltip.
    case floating
    /// A surface over the window: a dialog, a popover, the floating chat.
    case overlay

    public var opacity: Double {
        switch self {
        case .raised: 0.12
        case .card: 0.05
        case .floating: 0.09
        case .overlay: 0.13
        }
    }
    public var radius: CGFloat {
        switch self {
        case .raised: 1.5
        case .card: 4
        case .floating: 9
        case .overlay: 20
        }
    }
    public var y: CGFloat {
        switch self {
        case .raised: 0.5
        case .card: 1.5
        case .floating: 4
        case .overlay: 9
        }
    }
    /// Black at the level's strength; a dark window needs more of it to show at all.
    public func color(_ scheme: ColorScheme) -> Color { Color.black.opacity(min(0.5, opacity * (scheme == .dark ? 2.4 : 1))) }
}

struct NativeShadowModifier: ViewModifier {
    let level: NativeShadow?
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        if let level {
            content.shadow(color: level.color(scheme), radius: level.radius, y: level.y)
        } else {
            content.shadow(color: .clear, radius: 0)
        }
    }
}

public extension View {
    /// One of the Mac look's four shadows (nil: none, with the same view identity so a change animates).
    func nativeShadow(_ level: NativeShadow?) -> some View { modifier(NativeShadowModifier(level: level)) }
}

public extension EnvironmentValues {
    /// How much of the web's drawn shadows (a note card's lift, a dialog's drop) the Mac's native look keeps: 1
    /// everywhere else. The Mac sets it with its chrome; note and folder cards keep it though they reset the chrome.
    @Entry var nativeShadowScale: Double = 1
}
