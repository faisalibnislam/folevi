import AppKit
import SwiftUI

/// Typography: SF for UI, New York (system serif design) for editorial headings. No bundled fonts.
enum FoleviType {
    static func display(_ size: CGFloat = 30) -> Font { .system(size: size, weight: .medium, design: .serif) }
    static let pageTitle = Font.system(size: 34, weight: .semibold, design: .serif)
    static let sectionTitle = Font.system(size: 22, weight: .semibold, design: .serif)
    static let cardTitle = Font.system(size: 15, weight: .semibold, design: .serif)
    static let body = Font.system(size: 13)
    static let caption = Font.system(size: 11)
    static let label = Font.system(size: 12, weight: .medium)

    /// Editor fonts (AppKit) for a block style at a given zoom.
    static func editorFont(size: CGFloat, weight: NSFont.Weight = .regular, design: DocumentFont, scale: CGFloat) -> NSFont {
        let base = NSFont.systemFont(ofSize: size * scale, weight: weight)
        let descriptorDesign: NSFontDescriptor.SystemDesign
        switch design {
        case .sans: descriptorDesign = .default
        case .serif: descriptorDesign = .serif
        case .mono: descriptorDesign = .monospaced
        }
        if let d = base.fontDescriptor.withDesign(descriptorDesign), let f = NSFont(descriptor: d, size: size * scale) {
            return f
        }
        return base
    }

    static func serifHeading(size: CGFloat, weight: NSFont.Weight = .semibold, scale: CGFloat) -> NSFont {
        editorFont(size: size, weight: weight, design: .serif, scale: scale)
    }

    static func mono(size: CGFloat, scale: CGFloat) -> NSFont {
        NSFont.monospacedSystemFont(ofSize: size * scale, weight: .regular)
    }
}

extension NSColor {
    static var foleviInk: NSColor { NSColor(FoleviColor.ink) }
    static var foleviInkMuted: NSColor { NSColor(FoleviColor.inkMuted) }
    static var foleviInkFaint: NSColor { NSColor(FoleviColor.inkFaint) }
    static var foleviAccent: NSColor { NSColor(FoleviColor.accent) }
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
    static func folevi(accent: DocumentAccent) -> Color {
        switch accent {
        case .accent: return FoleviColor.accent
        case .moss: return FoleviColor.moss
        case .marigold: return FoleviColor.marigold
        case .plum: return FoleviColor.plum
        case .coral: return FoleviColor.coral
        }
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
        case .note: return (FoleviColor.surfaceSunken, FoleviColor.ink, "note.text")
        case .info: return (FoleviColor.accentSoft, FoleviColor.accentSoftInk, "info.circle")
        case .success: return (FoleviColor.successSoft, FoleviColor.success, "checkmark.circle")
        case .warning: return (FoleviColor.warningSoft, FoleviColor.warning, "exclamationmark.triangle")
        case .danger: return (FoleviColor.destructiveSoft, FoleviColor.destructive, "xmark.octagon")
        }
    }
}
