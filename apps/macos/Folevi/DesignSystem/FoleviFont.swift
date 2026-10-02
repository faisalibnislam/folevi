import AppKit
import CoreText
import SwiftUI

/// The product typefaces — the same families the web loads: Instrument Sans (UI and default document
/// text), Spectral (display headings and the document "Serif") and JetBrains Mono (document "Mono", code).
/// The rounded document font is the system's rounded design, as the web's `ui-rounded` stack is. The TTFs
/// ship in `Resources/Fonts` (SIL OFL 1.1) and are registered for this process at launch.
///
/// Instrument Sans is a variable font (weight 400–700): weights are set on its `wght` axis rather than
/// picked by name.
enum FoleviFont {
    enum Family: Sendable {
        /// `rounded` is the system's rounded design (SF Pro Rounded), as the web's `ui-rounded` stack is.
        case sans, serif, mono, rounded

        init(_ document: DocumentFont) {
            switch document {
            case .sans: self = .sans
            case .serif: self = .serif
            case .mono: self = .mono
            case .rounded: self = .rounded
            }
        }
    }

    /// Discrete faces we bundle. Anything in between maps to the nearest one.
    enum Face: Int, Comparable, Sendable {
        case regular = 400, medium = 500, semibold = 600, bold = 700
        static func < (a: Face, b: Face) -> Bool { a.rawValue < b.rawValue }

        init(_ weight: Font.Weight) {
            switch weight {
            case .medium: self = .medium
            case .semibold: self = .semibold
            case .bold, .heavy, .black: self = .bold
            default: self = .regular
            }
        }

        init(_ weight: NSFont.Weight) {
            if weight >= .bold { self = .bold } else if weight >= .semibold { self = .semibold } else if weight >= .medium { self = .medium } else { self = .regular }
        }
    }

    // MARK: Registration

    nonisolated(unsafe) private static var registered = false

    /// Registers the bundled fonts for this process (idempotent). Called first thing at launch;
    /// `ATSApplicationFontsPath` in Info.plist registers them too, this is the belt to those braces.
    static func registerBundledFonts() {
        guard !registered else { return }
        registered = true
        let urls = (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [])
            + (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
        for url in urls where NSFont(name: url.deletingPathExtension().lastPathComponent, size: 12) == nil {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    // MARK: Names

    static func postScriptName(_ family: Family, _ face: Face, italic: Bool = false) -> String {
        switch family {
        case .sans:
            return italic ? "InstrumentSans-Italic" : "InstrumentSans-Regular"
        case .serif:
            let weight = switch face {
            case .regular: ""
            case .medium: "Medium"
            case .semibold: "SemiBold"
            case .bold: "Bold"
            }
            if italic { return "Spectral-\(weight)Italic" }
            return "Spectral-\(weight.isEmpty ? "Regular" : weight)"
        case .mono:
            return face >= .semibold ? "JetBrainsMono-SemiBold" : "JetBrainsMono-Regular"
        case .rounded:
            return ".AppleSystemUIFontRounded"
        }
    }

    /// Whether the bundle has a true italic for this face (otherwise italic is a gentle oblique).
    static func hasItalic(_ family: Family, _ face: Face) -> Bool {
        switch family {
        case .sans, .serif: return true
        case .mono, .rounded: return false
        }
    }

    /// The `wght` axis tag ('wght') for variable fonts.
    private static let weightAxis = 0x7767_6874

    // MARK: AppKit

    static func nsFont(_ family: Family, size: CGFloat, weight: Face = .regular, italic: Bool = false) -> NSFont {
        registerBundledFonts()
        if family == .rounded { return rounded(size: size, weight: weight, italic: italic) }
        let name = postScriptName(family, weight, italic: italic)
        guard var font = NSFont(name: name, size: size) else {
            // Only if the bundle is damaged: keep the app usable.
            return family == .mono ? .monospacedSystemFont(ofSize: size, weight: .regular) : .systemFont(ofSize: size)
        }
        if family == .sans, weight != .regular {
            let descriptor = font.fontDescriptor.addingAttributes([
                NSFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [weightAxis: weight.rawValue],
            ])
            font = NSFont(descriptor: descriptor, size: size) ?? font
        }
        if italic && !hasItalic(family, weight) { return oblique(font) }
        return font
    }

    static func nsFont(_ family: Family, size: CGFloat, weight: NSFont.Weight, italic: Bool = false) -> NSFont {
        nsFont(family, size: size, weight: Face(weight), italic: italic)
    }

    /// Family and face of one of our fonts.
    static func describe(_ font: NSFont) -> (family: Family, face: Face, italic: Bool)? {
        let name = font.fontName
        let family: Family
        if name.hasPrefix("InstrumentSans") { family = .sans } else if name.hasPrefix("Spectral") { family = .serif } else if name.hasPrefix("JetBrainsMono") { family = .mono } else { return nil }
        var face: Face
        if name.contains("Bold") && !name.contains("SemiBold") { face = .bold } else if name.contains("SemiBold") { face = .semibold } else if name.contains("Medium") { face = .medium } else { face = .regular }
        if family == .sans, let variation = CTFontCopyVariation(font as CTFont) as? [Int: Double], let w = variation[weightAxis] {
            face = w >= 650 ? .bold : w >= 550 ? .semibold : w >= 450 ? .medium : .regular
        }
        let italic = name.contains("Italic") || font.fontDescriptor.symbolicTraits.contains(.italic) || font.matrix[2] != 0
        return (family, face, italic)
    }

    /// Bold/italic marks on top of a block font (bold = one step heavier, at least Bold for body text).
    static func applying(bold: Bool, italic: Bool, to font: NSFont) -> NSFont {
        guard let d = describe(font) else {
            var f = font
            if bold { f = NSFontManager.shared.convert(f, toHaveTrait: .boldFontMask) }
            if italic { f = NSFontManager.shared.convert(f, toHaveTrait: .italicFontMask) }
            return f
        }
        let face: Face = bold ? (d.face >= .semibold ? .bold : (d.family == .sans ? .semibold : .bold)) : d.face
        return nsFont(d.family, size: font.pointSize, weight: face, italic: italic || d.italic)
    }

    private static func rounded(size: CGFloat, weight: Face, italic: Bool) -> NSFont {
        let nsWeight: NSFont.Weight = switch weight {
        case .regular: .regular
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        }
        let system = NSFont.systemFont(ofSize: size, weight: nsWeight)
        let font = system.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: size) } ?? system
        return italic ? oblique(font) : font
    }

    private static func oblique(_ font: NSFont) -> NSFont {
        let skew = AffineTransform(m11: 1, m12: 0, m21: 0.2, m22: 1, tX: 0, tY: 0)
        let descriptor = font.fontDescriptor.withMatrix(skew)
        return NSFont(descriptor: descriptor, size: font.pointSize) ?? font
    }

    // MARK: SwiftUI

    static func font(_ family: Family, size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        Font(nsFont(family, size: size, weight: Face(weight), italic: italic) as CTFont)
    }
}

extension Font {
    /// Instrument Sans — every piece of product UI.
    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        FoleviFont.font(.sans, size: size, weight: weight)
    }

    /// Spectral (display headings, the document "Serif").
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        FoleviFont.font(.serif, size: size, weight: weight, italic: italic)
    }

    /// JetBrains Mono.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        FoleviFont.font(.mono, size: size, weight: weight)
    }

    /// The document's chosen family (sans = Instrument Sans, serif = Spectral, mono = JetBrains Mono, rounded = system rounded).
    static func document(_ font: DocumentFont, _ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        FoleviFont.font(FoleviFont.Family(font), size: size, weight: weight)
    }
}

extension View {
    /// A CSS line-height for Instrument Sans text: the extra space goes between lines and, split in half, above
    /// and below, so a block of text is as tall as the web's (e.g. body 16px × 1.55, Tailwind text-sm 13px × 1.43).
    func uiLineHeight(_ lineHeight: CGFloat, size: CGFloat, weight: Font.Weight = .regular) -> some View {
        cssLineHeight(lineHeight, family: .sans, size: size, weight: weight)
    }

    /// A CSS line-height for any Folevi family. A line-height tighter than the font's own (display headings at
    /// leading-tight) trims the space above and below, as CSS does.
    func cssLineHeight(_ lineHeight: CGFloat, family: FoleviFont.Family, size: CGFloat, weight: Font.Weight = .regular) -> some View {
        let natural = NSLayoutManager().defaultLineHeight(for: FoleviFont.nsFont(family, size: size, weight: FoleviFont.Face(weight)))
        let extra = lineHeight - natural
        return lineSpacing(max(0, extra)).padding(.vertical, extra / 2)
    }

    /// Letter spacing from a `FoleviTracking` token (a fraction of the point size).
    func foleviTracking(_ tracking: CGFloat, size: CGFloat) -> some View {
        self.tracking(tracking * size)
    }

    /// Product defaults for a scene: Instrument Sans 13 for every unstyled label/control.
    func foleviTypography() -> some View {
        self.font(.ui(13))
            .tint(FoleviColor.accent)
    }

    /// Small caps section label: 11pt semibold, uppercase, +0.06em.
    func foleviCapsLabel(_ color: Color = FoleviColor.inkFaint) -> some View {
        self.font(.ui(11, .semibold))
            .textCase(.uppercase)
            .tracking(FoleviTracking.caps * 11)
            .foregroundStyle(color)
            .uiLineHeight(11 * 1.55, size: 11, weight: .semibold) // the body's 1.55 line height, as on the web
    }
}
