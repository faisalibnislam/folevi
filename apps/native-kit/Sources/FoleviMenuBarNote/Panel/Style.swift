// Folevi's type and icons in the panel: one size per role from FoleviTextStyle (labels and buttons at callout 14,
// metadata at caption 12, card titles at headline 17), Instrument Sans throughout, and the web's line icons drawn
// at one line width whatever their size (the desktop controls' 1.5 px, tokens `--control-icon-stroke`).
import FoleviDesign
import SwiftUI

enum QNStyle {
    /// The web app's line width for every icon (`--control-icon-stroke`: 1.25 px on the desktop, the same at any icon
    /// size, `vector-effect: non-scaling-stroke`): the web is the standard, the panel matches it.
    static let iconStroke: CGFloat = 1.25

    /// A role's face at its Folevi size.
    static func font(_ style: FoleviTextStyle) -> Font {
        FoleviFonts.font(style.family, size: style.size, weight: style.weight)
    }

    /// The panel's controls are smaller than a screen's: 13 for buttons and labels (FoleviTextStyle.footnote),
    /// 12 for counts and hints (caption), as the Mac's menus and sidebar rows.
    static let label = font(.footnote)
    static let labelStrong = FoleviFonts.font(.ui, size: FoleviTextStyle.footnote.size, weight: .semibold)
    static let meta = font(.caption)
    static let title = font(.headline)
}

/// A Folevi line icon at `size`, its lines 1.25 pt wide as on the web.
struct QNIcon: View {
    let icon: WebIcon
    var size: CGFloat = 15

    init(_ icon: WebIcon, size: CGFloat = 15) {
        self.icon = icon
        self.size = size
    }

    var body: some View {
        WebIconView(icon, size: size, strokeWidth: QNStyle.iconStroke, absoluteStrokeWidth: true)
    }
}

extension QNStyle {
    /// A Folevi line icon as a template image for menu items (lines 1.25 pt, like the buttons').
    @MainActor
    static func menuImage(_ icon: WebIcon, size: CGFloat = 15) -> NSImage {
        let rect = CGRect(x: 0, y: 0, width: size, height: size)
        let path = WebIconShape(icon: icon).path(in: rect).cgPath
        let image = NSImage(size: rect.size, flipped: true) { _ in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            ctx.addPath(path)
            ctx.setLineWidth(iconStroke)
            ctx.setLineCap(.round)
            ctx.setLineJoin(.round)
            ctx.setStrokeColor(NSColor.black.cgColor)
            ctx.strokePath()
            return true
        }
        image.isTemplate = true
        return image
    }
}
