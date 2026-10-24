// A folder in its colour, upright like the big folder cards (web ui/FolderGlyph.tsx): a lighter back cover
// offset right and a filled front cover with the stepped tab at its top right. `size` is the height.
import SwiftUI

public struct FolderGlyph: View {
    let color: FolderColor
    let size: CGFloat

    public init(colorId: String?, size: CGFloat = 18) {
        self.color = FolderColor.resolve(colorId)
        self.size = size
    }

    public var body: some View {
        let base = color.color
        Canvas { ctx, canvasSize in
            let s = canvasSize.height / 112
            let outline = GraphicsContext.Shading.color(.black.opacity(0.16))
            let back = Path(roundedRect: CGRect(x: 9 * s, y: 4 * s, width: 69 * s, height: 106 * s), cornerRadius: 7 * s)
            ctx.fill(back, with: .color(base.mix(RGBA(238, 240, 243), 0.7).color))
            ctx.stroke(back, with: outline, lineWidth: 2.5 * s)
            let front = FolderGlyph.frontPath(scale: s)
            ctx.fill(front, with: .color(base.color))
            ctx.stroke(front, with: outline, lineWidth: 2.5 * s)
        }
        .frame(width: size * 80 / 112, height: size)
        .accessibilityHidden(true)
    }

    /// "M9 2 H68 Q76 2 76 10 V23 Q76 27 72.5 29 L70.5 30.2 Q67 32.2 67 36.2 V102 Q67 110 59 110 H9 Q2 110 2 103 V9 Q2 2 9 2 Z"
    static func frontPath(scale s: CGFloat) -> Path {
        var p = Path()
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
        p.move(to: pt(9, 2))
        p.addLine(to: pt(68, 2))
        p.addQuadCurve(to: pt(76, 10), control: pt(76, 2))
        p.addLine(to: pt(76, 23))
        p.addQuadCurve(to: pt(72.5, 29), control: pt(76, 27))
        p.addLine(to: pt(70.5, 30.2))
        p.addQuadCurve(to: pt(67, 36.2), control: pt(67, 32.2))
        p.addLine(to: pt(67, 102))
        p.addQuadCurve(to: pt(59, 110), control: pt(67, 110))
        p.addLine(to: pt(9, 110))
        p.addQuadCurve(to: pt(2, 103), control: pt(2, 110))
        p.addLine(to: pt(2, 9))
        p.addQuadCurve(to: pt(9, 2), control: pt(2, 2))
        p.closeSubpath()
        return p
    }
}
