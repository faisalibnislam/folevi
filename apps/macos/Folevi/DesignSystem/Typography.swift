import AppKit
import SwiftUI

/// Typography tokens: Instrument Sans for UI and titles, Spectral for display headings (the web's
/// `.ui-display`), the document's family for editor text. See `FoleviFont` for the bundled faces.
enum FoleviType {
    /// Display headings (sign-in, empty states, section heroes): Spectral semibold, as on the web.
    static func display(_ size: CGFloat = FoleviFontSize.title) -> Font { .serif(size, .semibold) }
    /// The web's `.ui-display` letter spacing (-0.012em).
    static func displayTracking(_ size: CGFloat) -> CGFloat { -0.012 * size }
    static let pageTitle = Font.ui(FoleviFontSize.title, .semibold)
    static let sectionTitle = Font.ui(FoleviFontSize.xl, .semibold)
    static let cardTitle = Font.ui(15, .semibold)
    static let body = Font.ui(FoleviFontSize.sm)
    static let caption = Font.ui(11)
    static let label = Font.ui(12, .medium)

    /// Editor fonts (AppKit) for a block style at a given zoom, in the document's family.
    static func editorFont(size: CGFloat, weight: NSFont.Weight = .regular, design: DocumentFont, scale: CGFloat) -> NSFont {
        FoleviFont.nsFont(FoleviFont.Family(design), size: size * scale, weight: weight)
    }

    static func mono(size: CGFloat, scale: CGFloat) -> NSFont {
        FoleviFont.nsFont(.mono, size: size * scale)
    }
}

extension NSColor {
    static var foleviInk: NSColor { NSColor(FoleviColor.ink) }
    static var foleviInkMuted: NSColor { NSColor(FoleviColor.inkMuted) }
    static var foleviInkFaint: NSColor { NSColor(FoleviColor.inkFaint) }
    static var foleviAccent: NSColor { NSColor(FoleviColor.accent) }
    static var foleviHeading: NSColor { NSColor(FoleviColor.heading) }
    static var foleviEmber: NSColor { NSColor(FoleviColor.ember) }
    static var foleviCodeBg: NSColor { NSColor(FoleviColor.codeBg) }
    static var foleviSelection: NSColor { NSColor(FoleviColor.selection) }

    static func folevi(text color: TextColor) -> NSColor {
        switch color {
        case .muted: return NSColor(FoleviColor.inkMuted)
        case .accent: return NSColor(FoleviColor.accent)
        case .moss: return NSColor(FoleviColor.mossInk)
        case .marigold: return NSColor(FoleviColor.marigoldInk)
        case .plum: return NSColor(FoleviColor.plumInk)
        case .coral: return NSColor(FoleviColor.coralInk)
        }
    }

    static func folevi(highlight color: HighlightColor) -> NSColor {
        switch color {
        case .yellow: return NSColor(FoleviColor.highlightYellow)
        case .green: return NSColor(FoleviColor.highlightGreen)
        case .blue: return NSColor(FoleviColor.highlightBlue)
        case .pink: return NSColor(FoleviColor.highlightPink)
        }
    }
}

extension Color {
    /// Page accents: "accent" renders ember; moss, marigold, plum and coral render their own token.
    static func folevi(accent: DocumentAccent) -> Color {
        switch accent {
        case .accent: return FoleviColor.ember
        case .moss: return FoleviColor.moss
        case .marigold: return FoleviColor.marigold
        case .plum: return FoleviColor.plum
        case .coral: return FoleviColor.coral
        }
    }

    /// Soft fill of a page accent (covers, tinted pages).
    static func folevi(accentSoft: DocumentAccent) -> Color {
        switch accentSoft {
        case .accent: return FoleviColor.emberSoft
        case .moss: return FoleviColor.mossSoft
        case .marigold: return FoleviColor.marigoldSoft
        case .plum: return FoleviColor.plumSoft
        case .coral: return FoleviColor.coralSoft
        }
    }

    /// A cover's own color wins over the page accent (same rule as the web's `coverBackground`).
    static func folevi(cover: DocumentCover?, style: DocumentStyle) -> Color {
        folevi(accent: cover?.value.flatMap(DocumentAccent.init(rawValue:)) ?? style.accent)
    }

    static func folevi(tag name: String) -> Color {
        switch name {
        case "moss": return FoleviColor.moss
        case "marigold": return FoleviColor.marigold
        case "plum": return FoleviColor.plum
        case "coral": return FoleviColor.coral
        case "muted": return FoleviColor.inkMuted
        default: return FoleviColor.accent
        }
    }

    static func folevi(tone: CalloutTone) -> (bg: Color, ink: Color, icon: String) {
        switch tone {
        case .note: return (FoleviColor.accentSoft, FoleviColor.heading, "note.text")
        case .info: return (FoleviColor.accentSoft, FoleviColor.accentSoftInk, "info.circle")
        case .success: return (FoleviColor.successSoft, FoleviColor.success, "checkmark.circle")
        case .warning: return (FoleviColor.warningSoft, FoleviColor.warning, "exclamationmark.triangle")
        case .danger: return (FoleviColor.destructiveSoft, FoleviColor.destructive, "xmark.octagon")
        }
    }
}
