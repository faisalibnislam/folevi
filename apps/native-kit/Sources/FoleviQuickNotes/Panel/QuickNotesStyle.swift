// Folevi's type and icons in the panel: one size per role from FoleviTextStyle (labels and buttons at callout 14,
// metadata at caption 12, card titles at headline 17), Instrument Sans throughout, and the web's line icons drawn
// at one line width whatever their size (the desktop controls' 1.5 px, tokens `--control-icon-stroke`).
import FoleviDesign
import SwiftUI

enum QNStyle {
    static let iconStroke: CGFloat = 1.5

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

/// A Folevi line icon at `size`, its lines 1.5 pt wide.
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
