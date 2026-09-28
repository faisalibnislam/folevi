import AppKit
import CoreText
import SwiftUI

/// The product typefaces — the same families the web build loads from Google Fonts:
/// Inter (UI, headings, default document text), Source Serif 4 (document "Serif") and
/// JetBrains Mono (document "Mono", code). The TTFs ship in `Resources/Fonts` (SIL OFL 1.1) and are
/// registered for this process at launch; San Francisco / New York are never used for product UI.
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
            if italic && face == .regular { return "Inter-Italic" }
            switch face {
            case .regular: return "Inter-Regular"
            case .medium: return "Inter-Medium"
            case .semibold: return "Inter-SemiBold"
            case .bold: return "Inter-Bold"
            }
        case .serif:
            if italic && face < .semibold { return "SourceSerif4-Italic" }
            return face >= .semibold ? "SourceSerif4-SemiBold" : "SourceSerif4-Regular"
        case .mono:
            return face >= .semibold ? "JetBrainsMono-SemiBold" : "JetBrainsMono-Regular"
        case .rounded:
            return ".AppleSystemUIFontRounded"
        }
    }

    /// Whether the bundle has a true italic for this face (otherwise italic is a gentle oblique).
    static func hasItalic(_ family: Family, _ face: Face) -> Bool {
        switch family {
        case .sans: return face == .regular
        case .serif: return face < .semibold
        case .mono, .rounded: return false
        }
    }

    // MARK: AppKit

    static func nsFont(_ family: Family, size: CGFloat, weight: Face = .regular, italic: Bool = false) -> NSFont {
        registerBundledFonts()
        if family == .rounded { return rounded(size: size, weight: weight, italic: italic) }
        let name = postScriptName(family, weight, italic: italic)
        guard let base = NSFont(name: name, size: size) else {
            // Only if the bundle is damaged: keep the app usable.
            return family == .mono ? .monospacedSystemFont(ofSize: size, weight: .regular) : .systemFont(ofSize: size)
        }
        if italic && !hasItalic(family, weight) { return oblique(base) }
        return base
    }

    static func nsFont(_ family: Family, size: CGFloat, weight: NSFont.Weight, italic: Bool = false) -> NSFont {
        nsFont(family, size: size, weight: Face(weight), italic: italic)
    }

    /// Family and face of one of our fonts (by PostScript name).
    static func describe(_ font: NSFont) -> (family: Family, face: Face, italic: Bool)? {
        let name = font.fontName
        let family: Family
        if name.hasPrefix("Inter") { family = .sans } else if name.hasPrefix("SourceSerif4") { family = .serif } else if name.hasPrefix("JetBrainsMono") { family = .mono } else { return nil }
        let face: Face
        if name.hasSuffix("-Bold") { face = .bold } else if name.hasSuffix("-SemiBold") { face = .semibold } else if name.hasSuffix("-Medium") { face = .medium } else { face = .regular }
        let italic = name.hasSuffix("-Italic") || font.fontDescriptor.symbolicTraits.contains(.italic) || font.matrix[2] != 0
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
        registerBundledFonts()
        let face = Face(weight)
        if family == .rounded { return Font(nsFont(.rounded, size: size, weight: face, italic: italic) as CTFont) }
        if italic && !hasItalic(family, face) {
            return Font(nsFont(family, size: size, weight: face, italic: true) as CTFont)
        }
        return Font.custom(postScriptName(family, face, italic: italic), fixedSize: size)
    }
}

extension Font {
    /// Inter — every piece of product UI.
    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        FoleviFont.font(.sans, size: size, weight: weight)
    }

    /// Source Serif 4.
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        FoleviFont.font(.serif, size: size, weight: weight, italic: italic)
    }

    /// JetBrains Mono.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        FoleviFont.font(.mono, size: size, weight: weight)
    }

    /// The document's chosen family (sans = Inter, serif = Source Serif 4, mono = JetBrains Mono).
    static func document(_ font: DocumentFont, _ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        FoleviFont.font(FoleviFont.Family(font), size: size, weight: weight)
    }
}

extension View {
    /// Letter spacing from a `FoleviTracking` token (a fraction of the point size).
    func foleviTracking(_ tracking: CGFloat, size: CGFloat) -> some View {
        self.tracking(tracking * size)
    }

    /// Product defaults for a scene: Inter 13 for every unstyled label/control, cocoa tint.
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
    }
}
