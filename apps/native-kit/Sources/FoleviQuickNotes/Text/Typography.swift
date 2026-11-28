import AppKit
import FoleviDesign

extension NSAttributedString.Key {
    /// Heading level 1…3 (semantic; the font is derived from it).
    static let quickNoteHeading = NSAttributedString.Key("quickNoteHeading")
    /// Inline code / monospace span (semantic).
    static let quickNoteCode = NSAttributedString.Key("quickNoteCode")
    /// On a checkbox attachment character: `true` when checked.
    static let quickNoteCheckbox = NSAttributedString.Key("quickNoteCheckbox")
}

/// Everything the text engine needs to know about the user's typography choices. A value type so
/// it can cross to background tasks (fonts are rebuilt where they are used).
struct TextStyle: Sendable, Equatable {
    var fontChoice: QuickNotesSettings.FontChoice = .folevi
    var customFontName: String = ""
    var fontSize: CGFloat = 15
    var lineHeightMultiple: CGFloat = 1.35
    var bulletGlyph: String = "•"

    init(fontChoice: QuickNotesSettings.FontChoice = .folevi, customFontName: String = "", fontSize: CGFloat = 15,
         lineHeightMultiple: CGFloat = 1.35, bulletGlyph: String = "•") {
        self.fontChoice = fontChoice
        self.customFontName = customFontName
        self.fontSize = fontSize
        self.lineHeightMultiple = lineHeightMultiple
        self.bulletGlyph = bulletGlyph
    }

    init(baseFont: NSFont, lineHeightMultiple: CGFloat, bulletGlyph: String) {
        self.init(fontChoice: .custom, customFontName: baseFont.fontName, fontSize: baseFont.pointSize,
                  lineHeightMultiple: lineHeightMultiple, bulletGlyph: bulletGlyph)
    }

    var baseFont: NSFont { Typography.baseFont(choice: fontChoice, customName: customFontName, size: fontSize) }
}

enum Typography {
    /// Horizontal distance per list/indent level.
    static let indentStep: CGFloat = 22

    static func headingScale(_ level: Int) -> CGFloat {
        switch level {
        case 1: 1.5
        case 2: 1.3
        case 3: 1.15
        default: 1
        }
    }

    static func baseFont(choice: QuickNotesSettings.FontChoice, customName: String, size: CGFloat) -> NSFont {
        let system = NSFont.systemFont(ofSize: size)
        switch choice {
        case .folevi:
            return FoleviFonts.nsFont(.ui, size: size)
        case .system:
            return system
        case .rounded:
            return system.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: size) } ?? system
        case .serif:
            return system.fontDescriptor.withDesign(.serif).flatMap { NSFont(descriptor: $0, size: size) } ?? system
        case .mono:
            return NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
        case .custom:
            return NSFont(name: customName, size: size) ?? system
        }
    }

    /// Derives a display font from semantic traits.
    static func font(base: NSFont, bold: Bool, italic: Bool, heading: Int, code: Bool) -> NSFont {
        let size = base.pointSize * headingScale(heading)
        var font: NSFont
        if code {
            font = FoleviFonts.nsFont(.mono, size: size * 0.92, weight: (bold || heading > 0) ? .semibold : .regular)
        } else if base.fontName.hasPrefix("InstrumentSans") {
            // Folevi's face: its named weights (NSFontManager can't step a variable font's instances).
            font = FoleviFonts.nsFont(.ui, size: size, weight: heading > 0 ? .semibold : (bold ? .bold : .regular))
        } else {
            font = NSFont(descriptor: base.fontDescriptor, size: size) ?? base
            if bold || heading > 0 {
                font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask)
                if !font.fontDescriptor.symbolicTraits.contains(.bold) {
                    // Fonts without a bold face: fall back to a heavier system weight.
                    font = NSFont.systemFont(ofSize: size, weight: .semibold)
                }
            }
        }
        if italic, font.fontName.hasPrefix("InstrumentSans") {
            // Folevi's face has no italic file (the web slants it too): an oblique of the same face.
            let t = NSAffineTransform()
            t.transformStruct = NSAffineTransformStruct(m11: size, m12: 0, m21: size * obliqueSlant, m22: size, tX: 0, tY: 0)
            font = NSFont(descriptor: font.fontDescriptor.addingAttributes([.matrix: t]), size: size) ?? font
        } else if italic {
            let converted = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask)
            if converted.fontDescriptor.symbolicTraits.contains(.italic) {
                font = converted
            } else {
                let desc = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.italic))
                font = NSFont(descriptor: desc, size: size) ?? font
            }
        }
        return font
    }

    /// How far the oblique Instrument Sans leans (about 12 degrees, as browsers slant a face with no italic).
    static let obliqueSlant: CGFloat = 0.21

    /// Whether `font` is the slanted Instrument Sans above.
    static func isOblique(_ font: NSFont) -> Bool {
        CTFontGetMatrix(font as CTFont).c != 0
    }

    static func traits(of font: NSFont) -> (bold: Bool, italic: Bool) {
        if isOblique(font) {
            let weight = (font.fontDescriptor.object(forKey: .traits) as? [NSFontDescriptor.TraitKey: Any])?[.weight] as? CGFloat ?? 0
            return (font.fontDescriptor.symbolicTraits.contains(.bold) || weight >= 0.3 || font.fontName.contains("Bold"), true)
        }
        let t = font.fontDescriptor.symbolicTraits
        let weight = (font.fontDescriptor.object(forKey: .traits) as? [NSFontDescriptor.TraitKey: Any])?[.weight] as? CGFloat ?? 0
        return (t.contains(.bold) || weight >= 0.3 || font.fontName.hasSuffix("_Bold"), t.contains(.italic))
    }

    static func isMonospaced(_ font: NSFont) -> Bool {
        font.fontDescriptor.symbolicTraits.contains(.monoSpace) || font.isFixedPitch
    }

    /// Background tint for inline code spans (adapts to appearance at draw time).
    static let codeBackground = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.09) : NSColor.black.withAlphaComponent(0.055)
    }
}
