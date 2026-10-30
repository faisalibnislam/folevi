// Text set the way the web app sets it (docs/MAC_REBUILD_PLAN.md section 3.1), for Folevi for Mac, which draws
// the web's compact desktop scale as is:
//
// - any CSS weight (450, 550, 650 as well as 400 to 700), through the variable fonts' `wght` axis;
// - body text's OpenType features (globals.css `font-feature-settings: "cv11", "ss01", "ss03"`);
// - letter spacing as CSS computes it: an em value resolves where it is declared and is inherited as a length,
//   so the body's `--tracking-normal` (-0.006em at 16 px) is -0.096 px on every UI text that doesn't set its own;
// - CSS line boxes: a line is exactly `leading` tall with the glyphs centred in it (half-leading above and
//   below), not the font's own line height, so rows and stacks measure what the web's do.
import CoreText
import Foundation
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

/// The type scale's roles (tokens `font.role`, docs/DESIGN_SYSTEM.md "Type scale"), as the web's `text-*` classes.
public enum WebTypeRole: String, CaseIterable, Sendable {
    case largeTitle, title1, title2, title3, headline, body, callout, subheadline, footnote, caption1, caption2

    /// The desktop size and line height (the web app and Folevi for Mac).
    public var desktop: TypeMetrics {
        typealias D = FoleviTokens.TypeScale.Desktop
        switch self {
        case .largeTitle: return D.largeTitle
        case .title1: return D.title1
        case .title2: return D.title2
        case .title3: return D.title3
        case .headline: return D.headline
        case .body: return D.body
        case .callout: return D.callout
        case .subheadline: return D.subheadline
        case .footnote: return D.footnote
        case .caption1: return D.caption1
        case .caption2: return D.caption2
        }
    }

    /// The iPhone and iPad size and line height: Apple's default Dynamic Type sizes, which the web switches to in
    /// the iOS app (`:root:is([data-iphone], [data-native])` in the tokens' CSS).
    public var ios: TypeMetrics {
        typealias I = FoleviTokens.TypeScale.Ios
        switch self {
        case .largeTitle: return I.largeTitle
        case .title1: return I.title1
        case .title2: return I.title2
        case .title3: return I.title3
        case .headline: return I.headline
        case .body: return I.body
        case .callout: return I.callout
        case .subheadline: return I.subheadline
        case .footnote: return I.footnote
        case .caption1: return I.caption1
        case .caption2: return I.caption2
        }
    }

    /// The scale this platform's web draws: desktop on the Mac, Dynamic Type sizes on iPhone and iPad.
    public var metrics: TypeMetrics {
        #if os(iOS)
        ios
        #else
        desktop
        #endif
    }

    /// The weight the class itself sets (`text-headline` is semibold); the rest inherit the regular body weight.
    public var defaultWeight: CGFloat { self == .headline ? FoleviTokens.FontWeight.semibold : FoleviTokens.FontWeight.regular }
}

/// The web's faces (`--font-sans`, `--font-display`, `--font-mono`).
public enum WebFontFamily: Sendable {
    /// Instrument Sans: UI and body text.
    case sans
    /// Spectral: `.ui-display` titles.
    case display
    /// JetBrains Mono: code.
    case mono
}

public enum WebFont {
    /// `wght`, the variation axis of Instrument Sans and JetBrains Mono.
    private static let weightAxis: Int = 0x7767_6874

    /// A Core Text font for a CSS family, size and weight, with the body text features on.
    public static func ctFont(_ family: WebFontFamily, size: CGFloat, weight: CGFloat = 400, italic: Bool = false) -> CTFont {
        FoleviFonts.register()
        let name: String
        var variable = false
        switch family {
        case .sans:
            name = "InstrumentSans-Regular"
            variable = true
        case .mono:
            name = "JetBrainsMono-Regular"
            variable = true
        case .display:
            // Spectral ships as static faces (400, 500, 600, 700): the browser picks the nearest, as here.
            name = FoleviFonts.postScriptName(.display, nearestStatic(weight), italic: italic)
        }
        var attributes: [CFString: Any] = [kCTFontNameAttribute: name]
        if variable {
            attributes[kCTFontVariationAttribute] = [weightAxis as CFNumber: weight as CFNumber] as CFDictionary
        }
        if family == .sans {
            attributes[kCTFontFeatureSettingsAttribute] = ["cv11", "ss01", "ss03"].map { tag in
                [kCTFontOpenTypeFeatureTag: tag, kCTFontOpenTypeFeatureValue: 1] as CFDictionary
            } as CFArray
        }
        // A character the face lacks (⌘, ⌥, arrows) comes from the system font, as WebKit falls back, not from Core
        // Text's own list (Lucida Grande first, a point wider: it moved the rest of a line).
        attributes[kCTFontCascadeListAttribute] = [systemFallback(size: size, weight: weight)] as CFArray
        let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }

    /// The system UI font at about the CSS weight, for the cascade list.
    private static func systemFallback(size: CGFloat, weight: CGFloat) -> CTFontDescriptor {
        let system = CTFontCopyFontDescriptor(CTFontCreateUIFontForLanguage(.system, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil))
        // CSS 400, 500, 600, 700 as Core Text weight traits (regular, medium, semibold, bold).
        let trait: CGFloat = weight < 450 ? 0 : weight < 550 ? 0.23 : weight < 650 ? 0.3 : 0.4
        guard trait != 0 else { return system }
        return CTFontDescriptorCreateCopyWithAttributes(system, [kCTFontTraitsAttribute: [kCTFontWeightTrait: trait] as CFDictionary] as CFDictionary)
    }

    public static func font(_ family: WebFontFamily, size: CGFloat, weight: CGFloat = 400, italic: Bool = false) -> Font {
        Font(ctFont(family, size: size, weight: weight, italic: italic))
    }

    /// Draws text as the web app does: `-webkit-font-smoothing: antialiased` (globals.css) turns off macOS font
    /// smoothing, which otherwise thickens every stem. The Mac app calls this at launch, before any text draws;
    /// the screenshot diffs prove the result (type specimens match the web to the pixel with it, about 2% off
    /// without). It only sets this app's own default, in memory.
    public static func useWebTextRendering() {
        UserDefaults.standard.register(defaults: ["AppleFontSmoothing": 0])
    }

    #if canImport(AppKit)
    public static func nsFont(_ family: WebFontFamily, size: CGFloat, weight: CGFloat = 400, italic: Bool = false) -> NSFont {
        ctFont(family, size: size, weight: weight, italic: italic) as NSFont
    }
    #endif

    /// The height Core Text gives one line (ascent, descent and line gap): what SwiftUI lays a line out in.
    public static func naturalLineHeight(_ font: CTFont) -> CGFloat {
        CTFontGetAscent(font) + CTFontGetDescent(font) + CTFontGetLeading(font)
    }

    static func nearestStatic(_ weight: CGFloat) -> Font.Weight {
        switch weight {
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        default: return .bold
        }
    }
}

/// A web text style: family, size, line height, weight and letter spacing, as CSS computes them.
public struct WebTextStyle: Hashable, Sendable {
    public var family: WebFontFamily
    public var size: CGFloat
    public var leading: CGFloat
    public var weight: CGFloat
    /// Letter spacing in points (CSS `letter-spacing` as computed).
    public var letterSpacing: CGFloat

    /// The body's letter spacing, inherited by all UI text: `--tracking-normal` at the body's 16 px.
    public static let bodyLetterSpacing = FoleviTokens.Tracking.normal * 16

    public init(family: WebFontFamily = .sans, size: CGFloat, leading: CGFloat, weight: CGFloat = 400, letterSpacing: CGFloat = WebTextStyle.bodyLetterSpacing) {
        self.family = family
        self.size = size
        self.leading = leading
        self.weight = weight
        self.letterSpacing = letterSpacing
    }

    /// A role of the type scale (`text-body`), in Instrument Sans with body tracking.
    public static func role(_ role: WebTypeRole, weight: CGFloat? = nil) -> WebTextStyle {
        WebTextStyle(size: role.metrics.size, leading: role.metrics.leading, weight: weight ?? role.defaultWeight)
    }

    /// `.ui-display` at a role's size: Spectral semibold, -0.012em.
    public static func display(_ role: WebTypeRole) -> WebTextStyle {
        WebTextStyle(family: .display, size: role.metrics.size, leading: role.metrics.leading, weight: FoleviTokens.FontWeight.semibold, letterSpacing: -0.012 * role.metrics.size)
    }

    /// `.ui-caps`: Caption 2, semibold, +0.06em, upper case (the caller upper-cases the text, as CSS does). On
    /// iPhone and iPad the web draws it at Footnote, +0.04em, in the muted ink (`capsInk`).
    public static let caps: WebTextStyle = {
        #if os(iOS)
        let m = WebTypeRole.footnote.ios
        return WebTextStyle(size: m.size, leading: m.leading, weight: FoleviTokens.FontWeight.semibold, letterSpacing: 0.04 * m.size)
        #else
        let m = WebTypeRole.caption2.desktop
        return WebTextStyle(size: m.size, leading: m.leading, weight: FoleviTokens.FontWeight.semibold, letterSpacing: FoleviTokens.Tracking.caps * m.size)
        #endif
    }()

    /// `.ui-caps`'s colour: the faint ink, the muted one on iPhone and iPad.
    public static var capsInk: Color {
        #if os(iOS)
        Folevi.color.inkMuted
        #else
        Folevi.color.inkFaint
        #endif
    }

    public func weight(_ w: CGFloat) -> WebTextStyle {
        var s = self
        s.weight = w
        return s
    }

    /// Letter spacing declared in em on this text itself (`.ui-btn`'s -0.005em), so at its own size.
    public func tracking(em: CGFloat) -> WebTextStyle {
        var s = self
        s.letterSpacing = em * size
        return s
    }

    public var ctFont: CTFont { WebFont.ctFont(family, size: size, weight: weight) }
}

extension WebTextStyle: Equatable {
    public static func == (a: WebTextStyle, b: WebTextStyle) -> Bool {
        a.family == b.family && a.size == b.size && a.leading == b.leading && a.weight == b.weight && a.letterSpacing == b.letterSpacing
    }

    public func hash(into h: inout Hasher) {
        h.combine(size)
        h.combine(leading)
        h.combine(weight)
        h.combine(letterSpacing)
    }
}

extension WebFontFamily: Hashable {}

/// Sets text in a web text style with CSS line boxes. CSS centres the glyphs (ascent plus descent) in a line box
/// `leading` tall, so a line's baseline sits at half the leftover plus the ascent. SwiftUI lays each line out in
/// the ascent and descent rounded to whole points, baseline at the rounded ascent (measured, ZZ probes of
/// 2026-10-27). On iPhone and iPad SwiftUI rounds them to the pixel grid instead (1/3 pt at 3x; the iOS screenshot
/// diffs, 2026-10-30). So: line spacing makes the pitch `leading`, and padding moves the first baseline to where
/// CSS has it and makes the whole block `lines x leading` tall. A single line (`lineLimit(1)`) is framed exactly.
struct WebTextModifier: ViewModifier {
    let style: WebTextStyle
    @Environment(\.lineLimit) private var lineLimit
    @Environment(\.displayScale) private var displayScale

    /// A font metric as SwiftUI rounds it when it lays out a line.
    private func snapped(_ v: CGFloat) -> CGFloat {
        #if os(iOS)
        (v * displayScale).rounded() / displayScale
        #else
        v.rounded()
        #endif
    }

    func body(content: Content) -> some View {
        let font = style.ctFont
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font)
        let cssBaseline = (style.leading - ascent - descent) / 2 + ascent
        let line = snapped(ascent) + snapped(descent)
        let spacing = max(0, style.leading - line)
        let top = cssBaseline - snapped(ascent)
        let text = content
            .font(Font(font))
            .tracking(style.letterSpacing)
            .lineSpacing(spacing)
        return Group {
            if lineLimit == 1 {
                text
                    .alignmentGuide(.top) { d in d[.firstTextBaseline] - cssBaseline }
                    .frame(height: style.leading, alignment: .top)
            } else {
                text
                    .padding(.top, top)
                    .padding(.bottom, spacing - top)
            }
        }
    }
}

public extension View {
    /// Text in a web text style (`.webText(.role(.body))`, `.webText(.display(.title2))`).
    func webText(_ style: WebTextStyle) -> some View {
        modifier(WebTextModifier(style: style))
    }

    /// The web's `.ui-invert`: this part in the other theme (the Vault's panel), everything else unchanged.
    func uiInvert() -> some View {
        modifier(InvertScheme())
    }
}

private struct InvertScheme: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.environment(\.colorScheme, scheme == .dark ? .light : .dark)
    }
}
