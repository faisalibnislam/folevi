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
        let dark = scheme == .dark
        // In light mode 35% lighter, as the folder card (WebFolderCard.tone; the owner, 28 November 2026).
        let muted = color.color.oklabMix(RGBA(154, 159, 171), 0.84)
        let tone = dark ? muted : muted.oklabMix(RGBA(255, 255, 255), 0.65)
        // The folder card's colours and depth (FolderGlyph.tsx, globals.css .fg-*; the owner, 28 November 2026: "too
        // flat"): the back's diagonal gradient, the front's opaque top-to-bottom tint, a hairline shadow above the front,
        // a light top edge on it and a small drop shadow.
        let b1 = dark ? tone.oklabMix(RGBA(26, 26, 30), 0.44) : tone.oklabMix(RGBA(44, 44, 58), 0.84)
        let b2 = dark ? tone.oklabMix(RGBA(42, 42, 47), 0.56) : tone.oklabMix(RGBA(255, 255, 255), 0.86)
        let behind = dark ? tone.oklabMix(RGBA(34, 34, 39), 0.5) : tone
        let fa = (dark ? tone.oklabMix(RGBA(58, 58, 66), 0.48) : tone.oklabMix(RGBA(255, 255, 255), 0.5)).oklabMix(behind, dark ? 0.82 : 0.62)
        let fb = (dark ? tone.oklabMix(RGBA(31, 31, 36), 0.4) : tone.oklabMix(RGBA(58, 58, 72), 0.92)).oklabMix(behind, dark ? 0.78 : 0.66)
        let f1 = fa.oklabMix(fb, 0.6), f2 = fa.oklabMix(fb, 0.4)
        let lip = dark ? RGBA(0, 0, 0, 0.35) : RGBA(30, 30, 50, 0.16)
        let edge = dark ? RGBA(255, 255, 255, 0.12) : RGBA(255, 255, 255, 0.55)
        let page = dark ? RGBA(217, 217, 222) : RGBA(255, 255, 255)
        let kind = kind
        let box = box
        Canvas { ctx, canvasSize in
            let s = canvasSize.height / box.height
            ctx.translateBy(x: 0, y: -box.top * s)
            let backShading = GraphicsContext.Shading.linearGradient(Gradient(colors: [b1.color, b2.color]), startPoint: .zero, endPoint: CGPoint(x: 144 * s, y: 220 * s))
            if kind == .stack {
                ctx.opacity = 0.7
                ctx.fill(Self.back(scale: s, x: 30, y: -44, sx: 0.75, sy: 0.8), with: backShading)
                ctx.opacity = 1
                ctx.fill(Self.back(scale: s, x: 15, y: -22, sx: 0.875, sy: 0.9), with: backShading)
            }
            ctx.fill(Self.back(scale: s), with: backShading)
            if kind == .notes {
                let paper = Path(roundedRect: CGRect(x: 40 * s, y: 32 * s, width: 160 * s, height: 120 * s), cornerRadius: 12 * s)
                ctx.fill(paper, with: .color(page.color))
                if !dark { ctx.stroke(paper, with: .color(.black.opacity(0.08)), lineWidth: 4 * s) }
            }
            ctx.fill(Path(roundedRect: CGRect(x: 0, y: 88 * s, width: 240 * s, height: 132 * s), cornerRadius: 15.6 * s), with: .color(lip.color))
            ctx.fill(
                Path(roundedRect: CGRect(x: 0, y: 96 * s, width: 240 * s, height: 124 * s), cornerRadius: 15.6 * s),
                with: .linearGradient(Gradient(colors: [f1.color, f2.color]), startPoint: CGPoint(x: 0, y: 96 * s), endPoint: CGPoint(x: 0, y: 220 * s))
            )
            var top = Path()
            top.move(to: CGPoint(x: 15.6 * s, y: 101 * s))
            top.addLine(to: CGPoint(x: 224.4 * s, y: 101 * s))
            ctx.stroke(top, with: .color(edge.color), style: StrokeStyle(lineWidth: 7 * s, lineCap: .round))
        }
        .shadow(color: (dark ? RGBA(0, 0, 0, 0.2) : RGBA(30, 30, 50, 0.088)).color, radius: 0.75, y: 0.5)
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
