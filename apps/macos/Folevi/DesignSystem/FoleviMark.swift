import AppKit
import SwiftUI

/// Folevi's mark, from the brand files (packages/design-tokens/brand/source/favicon.svg): a black folio
/// with a white clasp on a rounded tile. The image in the asset catalog (FoleviMark) is rendered from that
/// file by scripts/brand-icons.mjs, so it matches the web's mark and the app icon exactly.
struct FoleviMark: View {
    var size: CGFloat = 20

    var body: some View {
        Image("FoleviMark")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .accessibilityLabel(Text("Folevi"))
            .accessibilityAddTraits(.isImage)
    }
}

#Preview {
    HStack(spacing: 20) {
        FoleviMark(size: 16)
        FoleviMark(size: 32)
        FoleviMark(size: 96)
    }
    .padding()
}

/// Line drawing of the mark for monochrome places (the menu bar), in the brand file's 236-unit square.
enum FoleviMarkShape {
    /// The tile's corner radius at a given size (40 of 236 units).
    static func cornerRadius(_ size: CGFloat) -> CGFloat { size * 40 / 236 }

    /// Template image for the menu bar (tinted by the system): the tile's outline, the folio's edge
    /// running down its right side, and the clasp.
    @MainActor
    static func templateImage(size: CGFloat = 16) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            let tile = rect.insetBy(dx: 0.75, dy: 0.75)
            let k = tile.width / 236
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: tile.minX + x * k, y: tile.minY + y * k) }
            let outline = CGPath(roundedRect: tile, cornerWidth: cornerRadius(tile.width), cornerHeight: cornerRadius(tile.width), transform: nil)
            ctx.setStrokeColor(NSColor.black.cgColor)
            ctx.setFillColor(NSColor.black.cgColor)
            ctx.setLineWidth(1.2)
            ctx.addPath(outline)
            ctx.strokePath()
            // The folio's edge: down from the top, a short step left, then down to the bottom.
            ctx.saveGState()
            ctx.addPath(outline)
            ctx.clip()
            ctx.move(to: p(197, 0))
            ctx.addLine(to: p(197, 34))
            ctx.addLine(to: p(172, 50))
            ctx.addLine(to: p(172, 236))
            ctx.setLineWidth(max(1, 12 * k))
            ctx.strokePath()
            ctx.restoreGState()
            // The clasp, with its hole punched out.
            let clasp = CGMutablePath()
            clasp.addRoundedRect(in: CGRect(origin: p(128, 108), size: CGSize(width: 76 * k, height: 42 * k)), cornerWidth: 18 * k, cornerHeight: 18 * k)
            clasp.addEllipse(in: CGRect(origin: p(138, 119), size: CGSize(width: 20 * k, height: 20 * k)))
            ctx.addPath(clasp)
            ctx.fillPath(using: .evenOdd)
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Folevi"
        return image
    }
}
