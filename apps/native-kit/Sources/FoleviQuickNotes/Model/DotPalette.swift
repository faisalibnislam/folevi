import SwiftUI

/// The built-in dot colors: soft, slightly desaturated hues that stay distinct from each other.
/// Each has a dark-appearance value and a light variant tuned for contrast on light backgrounds. The app also ships these as asset-catalog
/// colors (`Dot<Name>`); this table is the fallback the widget and exporters use.
public enum DotColorID: String, CaseIterable, Codable, Sendable, Identifiable {
    case neutral, red, orange, yellow, green, blue, purple
    // Extra colors used when the user adds more than seven dots.
    case pink, teal, indigo, brown, mint

    public var id: String { rawValue }

    public static let defaults: [DotColorID] = [.neutral, .red, .orange, .yellow, .green, .blue, .purple]

    public var darkHex: String {
        switch self {
        case .neutral: "#98989D"
        case .red: "#E57A72"
        case .orange: "#E9A766"
        case .yellow: "#E4CB6E"
        case .green: "#76C793"
        case .blue: "#73A6E3"
        case .purple: "#B892D9"
        case .pink: "#E08299"
        case .teal: "#72C3CE"
        case .indigo: "#8D8CD9"
        case .brown: "#B59E84"
        case .mint: "#7FD0C9"
        }
    }

    public var lightHex: String {
        switch self {
        case .neutral: "#8E8E93"
        case .red: "#D6675F"
        case .orange: "#D78E45"
        case .yellow: "#C4A443"
        case .green: "#52A872"
        case .blue: "#5285CC"
        case .purple: "#9873C2"
        case .pink: "#C9637D"
        case .teal: "#4F9FAC"
        case .indigo: "#6E6CC0"
        case .brown: "#9A8269"
        case .mint: "#55AFA8"
        }
    }

    /// Localized, human-readable name used by VoiceOver ("Dot 3, blue, empty").
    public var localizedName: String {
        switch self {
        case .neutral: String(localized: "gray", comment: "Dot color name")
        case .red: String(localized: "red", comment: "Dot color name")
        case .orange: String(localized: "orange", comment: "Dot color name")
        case .yellow: String(localized: "yellow", comment: "Dot color name")
        case .green: String(localized: "green", comment: "Dot color name")
        case .blue: String(localized: "blue", comment: "Dot color name")
        case .purple: String(localized: "purple", comment: "Dot color name")
        case .pink: String(localized: "pink", comment: "Dot color name")
        case .teal: String(localized: "teal", comment: "Dot color name")
        case .indigo: String(localized: "indigo", comment: "Dot color name")
        case .brown: String(localized: "brown", comment: "Dot color name")
        case .mint: String(localized: "mint", comment: "Dot color name")
        }
    }

    public var nsColor: NSColor {
        #if FOLEVI_QUICKNOTES_ASSETS
        if let named = NSColor(named: "Dot" + rawValue.prefix(1).uppercased() + rawValue.dropFirst()) {
            return named
        }
        #endif
        let light = NSColor(hex: lightHex) ?? .gray
        let dark = NSColor(hex: darkHex) ?? .gray
        return NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        }
    }

    public var color: Color { Color(nsColor: nsColor) }
}

public extension NSColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
        let r, g, b, a: CGFloat
        if s.count == 8 {
            r = CGFloat((v >> 24) & 0xFF) / 255; g = CGFloat((v >> 16) & 0xFF) / 255
            b = CGFloat((v >> 8) & 0xFF) / 255; a = CGFloat(v & 0xFF) / 255
        } else {
            r = CGFloat((v >> 16) & 0xFF) / 255; g = CGFloat((v >> 8) & 0xFF) / 255
            b = CGFloat(v & 0xFF) / 255; a = 1
        }
        self.init(srgbRed: r, green: g, blue: b, alpha: a)
    }

    /// `#RRGGBB` in sRGB.
    var hexString: String {
        let c = usingColorSpace(.sRGB) ?? self
        return String(format: "#%02X%02X%02X",
                      Int((c.redComponent * 255).rounded()),
                      Int((c.greenComponent * 255).rounded()),
                      Int((c.blueComponent * 255).rounded()))
    }
}
