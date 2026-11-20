// A folder in its muted colour, the folder card in miniature (web ui/FolderGlyph.tsx; the owner, 20 November 2026):
// a back with a curved tab, a white page standing in it when it holds notes, and a plain front. A folder with
// subfolders shows a small stack of folders behind it; an empty one shows no page. `size` is the height.
import SwiftUI

public struct FolderGlyph: View {
    public enum Kind: Sendable { case notes, stack, empty }
    let color: FolderColor
    let size: CGFloat
    let kind: Kind
    @Environment(\.colorScheme) private var scheme

    public init(colorId: String?, size: CGFloat = 18, kind: Kind = .notes) {
        self.color = FolderColor.resolve(colorId)
        self.size = size
        self.kind = kind
    }

    /// The drawing's box in the web's units: 240 wide, 220 tall (264 with a stack, which rises 44 above the back).
    private var box: (top: CGFloat, height: CGFloat) { kind == .stack ? (-44, 264) : (0, 220) }

    public var body: some View {
        let tone = color.color.oklabMix(RGBA(154, 159, 171), 0.84)
        let dark = scheme == .dark
        let backFill = dark ? tone.oklabMix(RGBA(42, 42, 46), 0.45) : tone.oklabMix(RGBA(255, 255, 255), 0.55)
        let subFill = dark ? tone.oklabMix(RGBA(58, 58, 64), 0.55) : tone.oklabMix(RGBA(255, 255, 255), 0.62)
        let frontFill = dark ? tone.oklabMix(RGBA(42, 42, 46), 0.75) : tone.oklabMix(RGBA(255, 255, 255), 0.86)
        let page = dark ? RGBA(217, 217, 222) : RGBA(255, 255, 255)
        let kind = kind
        let box = box
        Canvas { ctx, canvasSize in
            let s = canvasSize.height / box.height
            ctx.translateBy(x: 0, y: -box.top * s)
            if kind == .stack {
                ctx.opacity = 0.7
                ctx.fill(Self.back(scale: s, x: 30, y: -44, sx: 0.75, sy: 0.8), with: .color(subFill.color))
                ctx.opacity = 1
                ctx.fill(Self.back(scale: s, x: 15, y: -22, sx: 0.875, sy: 0.9), with: .color(subFill.color))
            }
            ctx.fill(Self.back(scale: s), with: .color(backFill.color))
            if kind == .notes {
                let paper = Path(roundedRect: CGRect(x: 40 * s, y: 32 * s, width: 160 * s, height: 120 * s), cornerRadius: 12 * s)
                ctx.fill(paper, with: .color(page.color))
                if !dark { ctx.stroke(paper, with: .color(.black.opacity(0.08)), lineWidth: 4 * s) }
            }
            ctx.fill(Path(roundedRect: CGRect(x: 0, y: 96 * s, width: 240 * s, height: 124 * s), cornerRadius: 24 * s), with: .color(frontFill.color))
        }
        .frame(width: size * 240 / box.height, height: size)
        .accessibilityHidden(true)
    }

    /// "M0 22Q0 0 22 0H72C86 0 90 14 104 14H218Q240 14 240 36V198Q240 220 218 220H22Q0 220 0 198Z", placed at (x, y)
    /// in the drawing's units and scaled by (sx, sy).
    static func back(scale s: CGFloat, x: CGFloat = 0, y: CGFloat = 0, sx: CGFloat = 1, sy: CGFloat = 1) -> Path {
        var p = Path()
        func pt(_ px: CGFloat, _ py: CGFloat) -> CGPoint { CGPoint(x: (x + px * sx) * s, y: (y + py * sy) * s) }
        p.move(to: pt(0, 22))
        p.addQuadCurve(to: pt(22, 0), control: pt(0, 0))
        p.addLine(to: pt(72, 0))
        p.addCurve(to: pt(104, 14), control1: pt(86, 0), control2: pt(90, 14))
        p.addLine(to: pt(218, 14))
        p.addQuadCurve(to: pt(240, 36), control: pt(240, 14))
        p.addLine(to: pt(240, 198))
        p.addQuadCurve(to: pt(218, 220), control: pt(240, 220))
        p.addLine(to: pt(22, 220))
        p.addQuadCurve(to: pt(0, 198), control: pt(0, 220))
        p.closeSubpath()
        return p
    }
}
