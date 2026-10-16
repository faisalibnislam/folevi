// Folevi's neutral look for the widgets and the share sheet: white or near-black, the app's chrome tokens
// (packages/design-tokens tokens.json, "chrome"), and Spectral for titles (bundled in the extensions:
// Spectral-SemiBold.ttf, SIL Open Font License 1.1, its notice inside the font file).
import SwiftUI
import UIKit

enum Palette {
    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    static let canvas = dynamic(0xFFFFFF, 0x101011)
    static let heading = dynamic(0x0B0B0C, 0xFAFAFA)
    static let ink = dynamic(0x18181B, 0xF2F2F3)
    static let muted = dynamic(0x56565E, 0xA6A6AE)
    static let faint = dynamic(0x67676F, 0x93939B)
    static let line = dynamic(0xE2E2E6, 0x2C2C2F)
    static let accent = dynamic(0x1F1F22, 0xF2F2F3)
    static let accentInk = dynamic(0xFFFFFF, 0x101011)
    static let sunken = dynamic(0xF2F2F2, 0x1C1C1E)
    static let danger = dynamic(0xB42318, 0xF97066)
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

enum Typeface {
    /// Titles in Spectral (the app's display face), scaling with Dynamic Type.
    static func title(_ size: CGFloat) -> Font {
        Font.custom("Spectral-SemiBold", size: size, relativeTo: .headline)
    }

    static let row = Font.system(size: 14, weight: .regular)
    static let rowSmall = Font.system(size: 13, weight: .regular)
    static let meta = Font.system(size: 11.5, weight: .medium)
}
