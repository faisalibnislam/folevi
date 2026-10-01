import AppKit
import SwiftUI

/// A note's page colours, as the web derives them (lib/cover.ts `sheetProps` + editor.css `.fb-sheet`):
///
/// - A document colour picked in Style (white, paper, ivory, mist, sage, blush, night) is an explicit
///   appearance: light sheets keep dark text and a night sheet keeps light text whatever the app theme.
/// - A note with a built-in style and no document colour gets the artwork's colours: a very light page
///   with dark text in the same hue (a deep page with light text in dark appearance).
/// - A text colour picked in Style overrides the ink.
/// - While the page colour is on Auto, the style's palette also colours the accents (bullets, checkboxes,
///   quote bars, links, underlines, callouts, code) and the text colour and highlight marks (`notePalette`;
///   editor.css "Note style palette").
///
/// `nil` means the app's own surface and ink.
struct SheetPalette: Equatable {
    var surface: Color
    var ink: Color
    var heading: Color
    var muted: Color
    var faint: Color
    var line: Color
    /// Whether the page is dark (for controls drawn on it).
    var isDark: Bool
    /// The note style's palette on this page (`data-palette`), or nil for the fixed colours.
    var notePalette: NotePaletteLook? = nil

    @MainActor
    static func resolve(style: DocumentStyle, cover: DocumentCover, dark: Bool) -> SheetPalette? {
        let art = cover.kind == .art ? CoverArt.entry(cover.value) : nil
        var palette: SheetPalette
        if let sheet = style.sheet {
            palette = fixed(sheet)
        } else if let art, let paper = art.paper.flatMap(Color.init(hex:)) {
            let surface = dark ? (art.paperDark.flatMap(Color.init(hex:)) ?? Color(hex: "#161618")!) : paper
            palette = dark
                ? SheetPalette(surface: surface, ink: Color(hex: "#ececef")!, heading: .white, muted: Color(hex: "#a9a9b1")!, faint: Color(hex: "#93939b")!,
                               line: .white.opacity(0.12), isDark: true)
                : base(surface: surface)
            if NoteStylePalette.applies(sheet: style.sheet), let notes = art.notePalette,
               let paper = PaletteColor(hex: (dark ? art.paperDark : art.paper) ?? "#161618") {
                palette.notePalette = notes.look(dark: dark, surface: paper)
            }
        } else {
            return nil
        }
        // Text: an explicit colour, else the artwork's ink (not on a night sheet).
        if let text = style.text, text != .ink, let ink = textInk(text) {
            palette.ink = ink.ink
            palette.heading = ink.heading
        } else if style.text == nil, let art, style.sheet != .night, style.sheet == nil || !dark {
            let ink = (dark && style.sheet == nil ? art.inkDark : art.ink).flatMap(Color.init(hex:))
            if let ink {
                let isDarkPage = dark && style.sheet == nil
                palette.ink = ink
                palette.heading = isDarkPage ? ink.mix(with: .white, by: 0.2) : ink.mix(with: .black, by: 0.12)
                palette.muted = ink.mix(with: palette.surface, by: isDarkPage ? 0.16 : 0.22)
                palette.faint = ink.mix(with: palette.surface, by: isDarkPage ? 0.26 : 0.3)
            }
        }
        return palette
    }

    private static func base(surface: Color) -> SheetPalette {
        SheetPalette(surface: surface, ink: Color(hex: "#1c1c1f")!, heading: Color(hex: "#0d0d0f")!, muted: Color(hex: "#5c5c64")!,
                     faint: Color(hex: "#6b6b73")!, line: .black.opacity(0.1), isDark: false)
    }

    private static func fixed(_ sheet: DocumentSheet) -> SheetPalette {
        switch sheet {
        case .white: return base(surface: .white)
        case .paper: return base(surface: Color(hex: "#fbf8f2")!)
        case .ivory: return base(surface: Color(hex: "#f4ecdb")!)
        case .mist: return base(surface: Color(hex: "#edf1f6")!)
        case .sage: return base(surface: Color(hex: "#ecf2ea")!)
        case .blush: return base(surface: Color(hex: "#f8ecec")!)
        case .night:
            return SheetPalette(surface: Color(hex: "#161618")!, ink: Color(hex: "#ececef")!, heading: .white, muted: Color(hex: "#a9a9b1")!,
                                faint: Color(hex: "#93939b")!, line: .white.opacity(0.12), isDark: true)
        }
    }

    private static func textInk(_ text: DocumentText) -> (ink: Color, heading: Color)? {
        switch text {
        case .ink: return nil
        case .slate: return (Color(hex: "#3a4758")!, Color(hex: "#273345")!)
        case .navy: return (Color(hex: "#23406f")!, Color(hex: "#1b3561")!)
        case .forest: return (Color(hex: "#25543a")!, Color(hex: "#1b432d")!)
        case .plum: return (Color(hex: "#5a2d66")!, Color(hex: "#4a2155")!)
        case .brown: return (Color(hex: "#5b3b23")!, Color(hex: "#4a2e19")!)
        case .white: return (Color(hex: "#f2f2f4")!, .white)
        }
    }
}

extension Color {
    init(_ color: PaletteColor) {
        self.init(.sRGB, red: color.red, green: color.green, blue: color.blue, opacity: color.alpha)
    }
}

extension NSColor {
    convenience init(_ color: PaletteColor) {
        self.init(srgbRed: color.red, green: color.green, blue: color.blue, alpha: color.alpha)
    }
}
