// The value types Generated/Tokens.swift is written in, and their SwiftUI, UIKit and AppKit forms.
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// An sRGB colour, 0 to 255 per channel, alpha 0 to 1.
public struct RGBA: Hashable, Sendable {
    public var r: Double, g: Double, b: Double, a: Double

    public init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r
        self.g = g
        self.b = b
        self.a = a
    }

    /// "#RRGGBB" or "#RRGGBBAA"; nil for anything else.
    public init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 || s.count == 8, let n = UInt64(s, radix: 16) else { return nil }
        if s.count == 6 {
            self.init(Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255))
        } else {
            self.init(Double((n >> 24) & 255), Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255) / 255)
        }
    }

    public var color: Color { Color(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: a) }

    public func opacity(_ alpha: Double) -> RGBA { RGBA(r, g, b, a * alpha) }

    /// Mixes like CSS `color-mix(in srgb, self p%, other)`.
    public func mix(_ other: RGBA, _ p: Double) -> RGBA {
        RGBA(r * p + other.r * (1 - p), g * p + other.g * (1 - p), b * p + other.b * (1 - p), a * p + other.a * (1 - p))
    }

    /// WCAG relative luminance.
    public var luminance: Double {
        func lin(_ c: Double) -> Double { let v = c / 255; return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    public func contrast(_ other: RGBA) -> Double {
        let (x, y) = (max(luminance, other.luminance), min(luminance, other.luminance))
        return (x + 0.05) / (y + 0.05)
    }

    #if canImport(UIKit)
    public var platformColor: UIColor { UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: a) }
    #elseif canImport(AppKit)
    public var platformColor: NSColor { NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a) }
    #endif
}

/// A token's light and dark values. `color` follows the environment's colour scheme (and Increase Contrast).
public struct ColorPair: Hashable, Sendable {
    public let light: RGBA
    public let dark: RGBA

    public init(light: RGBA, dark: RGBA) {
        self.light = light
        self.dark = dark
    }

    public func resolve(_ scheme: ColorScheme) -> RGBA { scheme == .dark ? dark : light }

    #if canImport(UIKit)
    public var platformColor: UIColor {
        let light = light.platformColor, dark = dark.platformColor
        return UIColor { $0.userInterfaceStyle == .dark ? dark : light }
    }
    #elseif canImport(AppKit)
    public var platformColor: NSColor {
        let light = light.platformColor, dark = dark.platformColor
        return NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .vibrantDark, .accessibilityHighContrastDarkAqua]) != nil ? dark : light
        }
    }
    #endif

    /// A dynamic SwiftUI colour (light and dark from the trait collection / appearance).
    public var color: Color { Color(platformColor) }
}

/// One layer of a CSS-like box shadow.
public struct ShadowLayer: Hashable, Sendable {
    public let x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat
    public let color: RGBA
    public let inset: Bool

    public init(x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat, color: RGBA, inset: Bool = false) {
        self.x = x
        self.y = y
        self.blur = blur
        self.spread = spread
        self.color = color
        self.inset = inset
    }
}

public struct ShadowPair: Hashable, Sendable {
    public let light: [ShadowLayer]
    public let dark: [ShadowLayer]

    public func resolve(_ scheme: ColorScheme) -> [ShadowLayer] { scheme == .dark ? dark : light }
}

/// A built-in note theme's colours (covers/covers.json): the page and text of a card drawn in its style.
public struct NoteTheme: Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let paper: RGBA, ink: RGBA, paperDark: RGBA, inkDark: RGBA
    public let accent: RGBA, accentDark: RGBA
    /// The cover reads deep behind the title (white title) rather than light (ink title).
    public let deepCover: Bool

    public func paper(_ scheme: ColorScheme) -> RGBA { scheme == .dark ? paperDark : paper }
    public func ink(_ scheme: ColorScheme) -> RGBA { scheme == .dark ? inkDark : ink }
    public func accent(_ scheme: ColorScheme) -> RGBA { scheme == .dark ? accentDark : accent }

    /// The theme for an id like "art-07"; ids past the last theme wrap onto the ones there are (as the web does).
    public static func named(_ id: String?) -> NoteTheme? {
        guard let id, id.hasPrefix("art-"), let n = Int(id.dropFirst(4)), n > 0 else { return nil }
        let all = FoleviTokens.noteThemes
        if let exact = all.first(where: { $0.id == id }) { return exact }
        return all.isEmpty ? nil : all[(n - 1) % all.count]
    }
}

/// A folder colour (covers/folder-colors.json).
public struct FolderColor: Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let color: RGBA

    public static let defaultId = "sky"

    /// The colour a folder shows: its own, the one an earlier colour id maps to, or the default (web `folderHex`).
    public static func resolve(_ id: String?) -> FolderColor {
        let all = FoleviTokens.folderColors
        if let id, let c = all.first(where: { $0.id == id }) { return c }
        if let id, let mapped = FoleviTokens.legacyFolderColors[id], let c = all.first(where: { $0.id == mapped }) { return c }
        return all.first(where: { $0.id == defaultId }) ?? all[0]
    }
}
