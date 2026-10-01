import AppKit
import SwiftUI

// A block's own styling (BlockLook: text style, colour, alignment, font, decoration, card group) and the
// divider looks, drawn as the web's editor.css does.

extension BlockStyles {
    /// Text style, colour, alignment and font from the block's props (editor.css "Block styling").
    static func applyLook(_ look: BlockLook, to base: TextRenderStyle, document: DocumentStyle, palette: SheetPalette?) -> TextRenderStyle {
        guard !look.isPlain else { return base }
        var s = base
        if let font = look.font {
            let family: FoleviFont.Family
            switch font {
            case .system: family = .sans
            case .serif: family = .serif
            case .mono: family = .mono
            case .rounded: family = .rounded
            }
            let size = s.font.pointSize * (font == .mono ? 0.92 : 1)
            let face = FoleviFont.describe(s.font)
            s.font = FoleviFont.nsFont(family, size: size, weight: face?.face ?? .regular, italic: face?.italic ?? false)
            if font == .mono { s.kern = 0 }
        }
        switch look.textStyle {
        case .strong:
            let face = FoleviFont.describe(s.font)
            s.font = FoleviFont.nsFont(face?.family ?? FoleviFont.Family(document.font), size: s.font.pointSize, weight: FoleviFont.Face.semibold, italic: face?.italic ?? false)
            s.color = palette.map { NSColor($0.heading) } ?? .foleviHeading
        case .caption:
            let face = FoleviFont.describe(s.font)
            s.font = FoleviFont.nsFont(face?.family ?? FoleviFont.Family(document.font), size: s.font.pointSize * 0.84, weight: face?.face ?? .regular, italic: face?.italic ?? false)
            s.color = palette.map { NSColor($0.muted) } ?? .foleviInkMuted
            s.lineSpacing = spacing(for: s.font, lineHeight: 1.5)
        case nil:
            break
        }
        if let color = look.color {
            s.color = NSColor(blockColor(color, document: document, palette: palette))
        }
        switch look.align {
        case .center: s.alignment = .center
        case .right: s.alignment = .right
        case .justify: s.alignment = .justified
        case .left, nil: break
        }
        return s
    }

    /// A block colour on this page ("black" is the heading colour; nil hex is the page accent).
    static func blockColor(_ color: BlockColor, document: DocumentStyle, palette: SheetPalette?) -> Color {
        if color == .black { return palette?.heading ?? FoleviColor.heading }
        guard let light = BlockLook.colorHex(color, darkPage: false).flatMap(NSColor.init(foleviHex:)),
              let dark = BlockLook.colorHex(color, darkPage: true).flatMap(NSColor.init(foleviHex:)) else {
            return palette?.notePalette.map { Color($0.accent) } ?? Color.folevi(accent: document.accent)
        }
        if let palette { return Color(nsColor: palette.isDark ? dark : light) }
        // On the app's own page: follow the appearance.
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        })
    }
}

extension NSColor {
    /// `#RRGGBB` in sRGB.
    convenience init?(foleviHex hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}

/// The decoration and card-group background behind a styled block (editor.css `[data-decoration]`,
/// `[data-group="card"]`).
struct BlockLookBackground: View {
    var look: BlockLook
    var edges: (first: Bool, last: Bool)?
    var document: DocumentStyle
    var palette: SheetPalette?

    var body: some View {
        let tint = look.color.map { BlockStyles.blockColor($0, document: document, palette: palette) } ?? palette?.notePalette.map { Color($0.accent) } ?? Color.folevi(accent: document.accent)
        let surface = palette?.surface ?? FoleviColor.surface
        ZStack(alignment: .leading) {
            if look.group == .card {
                let e = edges ?? (true, true)
                UnevenRoundedRectangle(topLeadingRadius: e.first ? 8 : 0, bottomLeadingRadius: e.last ? 8 : 0,
                                       bottomTrailingRadius: e.last ? 8 : 0, topTrailingRadius: e.first ? 8 : 0, style: .continuous)
                    .fill(FoleviColor.surfaceRaised.mix(with: palette?.notePalette.map { Color($0.accentSoft) } ?? Color.folevi(accentSoft: document.accent), by: 0.3))
                    .overlay {
                        UnevenRoundedRectangle(topLeadingRadius: e.first ? 8 : 0, bottomLeadingRadius: e.last ? 8 : 0,
                                               bottomTrailingRadius: e.last ? 8 : 0, topTrailingRadius: e.first ? 8 : 0, style: .continuous)
                            .strokeBorder(palette?.line ?? FoleviColor.line, lineWidth: 1)
                            .mask(CardEdgeMask(first: e.first, last: e.last))
                    }
                    .shadow(color: .black.opacity(e.last ? 0.12 : 0), radius: 10, y: 8)
            }
            switch look.decoration {
            case .focus:
                UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3, bottomTrailingRadius: 6, topTrailingRadius: 6, style: .continuous)
                    .fill(tint.opacity(0.07))
                Capsule().fill(tint).frame(width: 3).padding(.vertical, 3)
            case .block:
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill((look.color.map { BlockStyles.blockColor($0, document: document, palette: palette) } ?? (palette?.ink ?? FoleviColor.ink))
                        .mix(with: surface, by: 0.91))
            case nil:
                EmptyView()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Hides the top / bottom hairline where the card continues into the next block.
    private struct CardEdgeMask: View {
        var first: Bool
        var last: Bool
        var body: some View {
            VStack(spacing: 0) {
                Color.black.frame(height: first ? 2 : 0)
                Color.black
                Color.black.frame(height: last ? 2 : 0)
            }
            .padding(.top, first ? 0 : 1)
            .padding(.bottom, last ? 0 : 1)
        }
    }
}

/// A divider: its own look (Extra light dots, Light dots, Regular, Strong) or the page's separator style
/// (line, dots, doodle).
struct DividerLineView: View {
    var style: DividerStyle?
    var separator: SeparatorStyle?
    var palette: SheetPalette?
    var selected = false
    var accent: Color = FoleviColor.ember

    var body: some View {
        line
            .frame(maxWidth: .infinity)
            .overlay {
                if selected {
                    RoundedRectangle(cornerRadius: 2).strokeBorder(accent, lineWidth: 2).padding(-4)
                }
            }
            .padding(.vertical, 11)
            .accessibilityElement()
            .accessibilityLabel(Text("Divider"))
    }

    private var faint: Color { palette?.faint ?? FoleviColor.inkFaint }
    private var strongLine: Color { palette?.line.opacity(1.6) ?? FoleviColor.lineStrong }

    @ViewBuilder private var line: some View {
        switch style {
        case .extralight:
            Dots(diameter: 2.2, step: 10, color: faint).frame(height: 4).opacity(0.8)
        case .light:
            Dots(diameter: 1.4, step: 4, color: faint).frame(height: 2)
        case .regular:
            Rectangle().fill(strongLine).frame(height: 1)
        case .strong:
            RoundedRectangle(cornerRadius: 2).fill((palette?.ink ?? FoleviColor.ink).opacity(0.82)).frame(height: 3)
        case nil:
            switch separator {
            case .dots:
                Dots(diameter: 2, step: 6, color: strongLine).frame(height: 2)
            case .doodle:
                Doodle().stroke(Color(white: 0.6), style: StrokeStyle(lineWidth: 1.6, lineCap: .round)).frame(height: 10).opacity(0.8)
            case .line, nil:
                Rectangle().fill(palette?.line ?? FoleviColor.line).frame(height: 1)
            }
        }
    }

    private struct Dots: View {
        var diameter: CGFloat
        var step: CGFloat
        var color: Color
        var body: some View {
            Canvas { ctx, size in
                var x = step / 2
                while x < size.width {
                    ctx.fill(Path(ellipseIn: CGRect(x: x - diameter / 2, y: size.height / 2 - diameter / 2, width: diameter, height: diameter)), with: .color(color))
                    x += step
                }
            }
        }
    }

    /// The web's doodle: a soft wave repeated every 24pt.
    private struct Doodle: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            let mid = rect.midY
            var x: CGFloat = 0
            p.move(to: CGPoint(x: 0, y: mid))
            while x < rect.width {
                p.addQuadCurve(to: CGPoint(x: x + 12, y: mid), control: CGPoint(x: x + 6, y: mid - 5))
                p.addQuadCurve(to: CGPoint(x: x + 24, y: mid), control: CGPoint(x: x + 18, y: mid + 5))
                x += 24
            }
            return p
        }
    }
}

/// The line looks in the Insert panel (the same drawings as the dividers).
struct DividerPreview: View {
    var style: DividerStyle
    var body: some View {
        DividerLineView(style: style, separator: nil).padding(.vertical, -11)
    }
}
