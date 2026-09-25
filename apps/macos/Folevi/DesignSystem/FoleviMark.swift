import AppKit
import SwiftUI

/// The Folevi mark: two offset leaf/page shapes that together read as an "F".
/// The tall shape is the stem with a leaf-blade top stroke; the smaller leaf is the crossbar, set
/// slightly apart so the mark stays legible at 16pt. Monochrome — it takes the foreground style.
struct FoleviMarkShape: Shape {
    enum Part { case stem, leaf, both }
    var part: Part = .both

    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height)
        let ox = rect.midX - s / 2
        let oy = rect.midY - s / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x / 100 * s, y: oy + y / 100 * s) }
        var path = Path()
        if part != .leaf {
            // Stem + top stroke: a page edge rising into a leaf blade that sweeps right.
            path.move(to: p(24, 90))
            path.addLine(to: p(24, 34))
            path.addCurve(to: p(82, 12), control1: p(24, 16), control2: p(52, 8))
            path.addCurve(to: p(41, 36), control1: p(70, 30), control2: p(52, 33))
            path.addLine(to: p(41, 90))
            path.addQuadCurve(to: p(24, 90), control: p(32.5, 96))
            path.closeSubpath()
        }
        if part != .stem {
            // Crossbar leaf, offset from the stem.
            path.move(to: p(47, 64))
            path.addCurve(to: p(78, 44), control1: p(50, 50), control2: p(64, 43))
            path.addCurve(to: p(47, 64), control1: p(72, 57), control2: p(60, 64))
            path.closeSubpath()
        }
        return path
    }
}

struct FoleviMark: View {
    var size: CGFloat = 20

    var body: some View {
        FoleviMarkShape()
            .frame(width: size, height: size)
            .accessibilityLabel(Text("Folevi"))
            .accessibilityAddTraits(.isImage)
    }
}

#Preview {
    HStack(spacing: 20) {
        FoleviMark(size: 16)
        FoleviMark(size: 32)
        FoleviMark(size: 96).foregroundStyle(FoleviColor.accent)
    }
    .padding()
}

extension FoleviMarkShape {
    /// Template image of the mark for the menu bar (tinted by the system).
    @MainActor
    static func templateImage(size: CGFloat = 16) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            ctx.addPath(FoleviMarkShape().path(in: rect.insetBy(dx: 0.5, dy: 0.5)).cgPath)
            ctx.setFillColor(NSColor.black.cgColor)
            ctx.fillPath()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Folevi"
        return image
    }
}
