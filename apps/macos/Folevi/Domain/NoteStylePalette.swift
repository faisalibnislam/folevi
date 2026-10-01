import Foundation

/// An sRGB colour (components 0...1) with alpha. The note style palette's maths works on these; the views
/// turn them into `Color` / `NSColor` (DesignSystem/SheetPalette.swift).
struct PaletteColor: Hashable, Sendable {
    var red: Double
    var green: Double
    var blue: Double
    var alpha: Double = 1

    init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// `#RRGGBB`.
    init?(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }

    static let white = PaletteColor(red: 1, green: 1, blue: 1)
    static let transparent = PaletteColor(red: 0, green: 0, blue: 0, alpha: 0)

    /// `#rrggbb` (alpha left out), each channel rounded to 0...255.
    var hex: String {
        let byte = { (v: Double) in Int((min(1, max(0, v)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(red), byte(green), byte(blue))
    }

    /// The same colour at another opacity.
    func opacity(_ alpha: Double) -> PaletteColor {
        PaletteColor(red: red, green: green, blue: blue, alpha: alpha)
    }
}

/// OKLab, the perceptual colour space CSS `color-mix(in oklab, …)` interpolates in. The conversions use the
/// same matrices as packages/design-tokens/src/palette.ts.
enum OKLab {
    struct Lab: Hashable, Sendable {
        var L: Double
        var a: Double
        var b: Double
    }

    private static func toLinear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    private static func fromLinear(_ c: Double) -> Double { c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055 }

    static func lab(_ color: PaletteColor) -> Lab {
        let r = toLinear(color.red), g = toLinear(color.green), b = toLinear(color.blue)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return Lab(L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
                   a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
                   b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)
    }

    /// Back to sRGB, clipped to the gamut.
    static func color(_ lab: Lab, alpha: Double = 1) -> PaletteColor {
        let l = pow(lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b, 3)
        let m = pow(lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b, 3)
        let s = pow(lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b, 3)
        let srgb = { (v: Double) in min(1, max(0, fromLinear(min(1, max(0, v))))) }
        return PaletteColor(red: srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
                            green: srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
                            blue: srgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
                            alpha: alpha)
    }

    /// CSS `color-mix(in oklab, x p, y)` with `p` in 0...1 (y gets the rest). Alpha is premultiplied, as CSS
    /// does: mixing with `transparent` keeps x's colour at opacity p.
    static func mix(_ x: PaletteColor, _ p: Double, _ y: PaletteColor) -> PaletteColor {
        let q = 1 - p
        let alpha = x.alpha * p + y.alpha * q
        guard alpha > 0 else { return .transparent }
        let a = lab(x), b = lab(y)
        let wa = x.alpha * p / alpha, wb = y.alpha * q / alpha
        return color(Lab(L: a.L * wa + b.L * wb, a: a.a * wa + b.a * wb, b: a.b * wa + b.b * wb), alpha: alpha)
    }
}

/// A note style's palette (packages/design-tokens/src/palette.ts, precomputed per style into covers.json):
/// five text colours and four highlights, for light and dark appearance. The mark ids stay the same
/// (accent, moss, marigold, plum, coral / yellow, green, blue, pink): they're slots, filled per style
/// (lib/cover.ts `paletteVars`).
struct NoteStylePalette: Hashable, Sendable {
    struct Slots: Hashable, Sendable {
        /// accent, moss, marigold, plum, coral.
        var text: [PaletteColor]
        /// yellow, green, blue, pink.
        var highlight: [PaletteColor]

        /// The key colour (checkboxes, quote bars, links, underlines, callouts, code).
        var accent: PaletteColor { text[0] }

        /// A text colour mark's colour; nil for "muted", which keeps the page's own muted ink.
        func text(_ color: TextColor) -> PaletteColor? {
            NoteStylePalette.textSlots.firstIndex(of: color).map { text[$0] }
        }

        func highlight(_ color: HighlightColor) -> PaletteColor {
            highlight[NoteStylePalette.highlightSlots.firstIndex(of: color) ?? 0]
        }
    }

    /// The web's `PALETTE_TEXT_SLOTS` and `PALETTE_HIGHLIGHT_SLOTS`, in palette order.
    static let textSlots: [TextColor] = [.accent, .moss, .marigold, .plum, .coral]
    static let highlightSlots: [HighlightColor] = [.yellow, .green, .blue, .pink]

    var light: Slots
    var dark: Slots
    /// The colours' own names ("Coral", "Teal", …), one per text slot.
    var names: [String]

    /// A complete palette, or nil when any part is missing (`paletteVars` returns undefined then, and the
    /// note keeps the fixed colours).
    init?(accent: String?, accentDark: String?, text: [String]?, textDark: [String]?,
          highlight: [String]?, highlightDark: [String]?, names: [String]? = nil) {
        func colors(_ list: [String]?, _ count: Int) -> [PaletteColor]? {
            guard let list, list.count == count else { return nil }
            let parsed = list.compactMap(PaletteColor.init(hex:))
            return parsed.count == count ? parsed : nil
        }
        guard accent.flatMap(PaletteColor.init(hex:)) != nil, accentDark.flatMap(PaletteColor.init(hex:)) != nil,
              let text = colors(text, 5), let textDark = colors(textDark, 5),
              let highlight = colors(highlight, 4), let highlightDark = colors(highlightDark, 4) else { return nil }
        light = Slots(text: text, highlight: highlight)
        dark = Slots(text: textDark, highlight: highlightDark)
        self.names = names ?? []
    }

    /// `sheetProps`: the style colours the page's accents only while the page colour is on Auto (no
    /// document colour picked in Style). The text colour setting doesn't matter.
    static func applies(sheet: DocumentSheet?) -> Bool { sheet == nil }

    func slots(dark: Bool) -> Slots { dark ? self.dark : light }

    /// The palette on a page of colour `surface` (the style's paper in light, its deep paper in dark).
    func look(dark: Bool, surface: PaletteColor) -> NotePaletteLook {
        NotePaletteLook(slots: slots(dark: dark), surface: surface, dark: dark)
    }
}

/// The note style palette's colours on its page for one appearance: editor.css "Note style palette"
/// (`.fb-sheet[data-palette]`).
struct NotePaletteLook: Hashable, Sendable {
    var slots: NoteStylePalette.Slots
    /// `--doc-accent` / `--color-accent`: bullets, quote bars, links, selection outlines, block colours.
    var accent: PaletteColor
    /// `--doc-accent-soft`: the accent 14% into the page.
    var accentSoft: PaletteColor
    /// `--color-code-bg`: the accent 6% into the page (code blocks, inline code).
    var codeBackground: PaletteColor
    /// A checked to-do's gradient: the accent 82% into white at the top, the accent at the bottom.
    var checkTop: PaletteColor
    /// A checked to-do's drop shadow: the accent at 45%.
    var checkShadow: PaletteColor
    /// Underlined text: the accent at 70% (1.5pt thick, 3pt below the baseline).
    var underline: PaletteColor
    /// Links (`.fb-link` on `--color-accent`): the accent at 35%.
    var linkUnderline: PaletteColor
    /// Page links' underline (`--doc-accent` at 55%).
    var pageLinkUnderline: PaletteColor
    /// How much of the highlight colour a callout takes (60% light, 40% dark).
    var calloutMix: Double
    private var surface: PaletteColor

    init(slots: NoteStylePalette.Slots, surface: PaletteColor, dark: Bool) {
        self.slots = slots
        self.surface = surface
        accent = slots.accent
        accentSoft = OKLab.mix(slots.accent, 0.14, surface)
        codeBackground = OKLab.mix(slots.accent, 0.06, surface)
        checkTop = OKLab.mix(slots.accent, 0.82, .white)
        checkShadow = OKLab.mix(slots.accent, 0.45, .transparent)
        underline = OKLab.mix(slots.accent, 0.7, .transparent)
        linkUnderline = OKLab.mix(slots.accent, 0.35, .transparent)
        pageLinkUnderline = OKLab.mix(slots.accent, 0.55, .transparent)
        calloutMix = dark ? 0.4 : 0.6
    }

    func text(_ color: TextColor) -> PaletteColor? { slots.text(color) }
    func highlight(_ color: HighlightColor) -> PaletteColor { slots.highlight(color) }

    /// A callout's background and mark: the plain ("note") callout takes the style's key colour on its
    /// first highlight, "info" its second colour. Success, warning and danger keep their meaning colours
    /// (nil).
    func callout(_ tone: CalloutTone) -> (background: PaletteColor, icon: PaletteColor)? {
        switch tone {
        case .note: return (OKLab.mix(slots.highlight(.yellow), calloutMix, surface), slots.accent)
        case .info: return (OKLab.mix(slots.highlight(.green), calloutMix, surface), slots.text[1])
        case .success, .warning, .danger: return nil
        }
    }
}
