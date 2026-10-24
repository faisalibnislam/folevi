// The bundled Folevi faces (Resources/Fonts, from the web app's own files by scripts/import-fonts.swift):
// Instrument Sans (UI and body, variable 400 to 700), Spectral (titles, note and card titles, folder names),
// JetBrains Mono (code), and Inter (the "Modern" font type's standard face in card previews). All SIL OFL 1.1.
//
// `FoleviFonts.register()` registers them for the process (idempotent, cheap after the first call). Text
// styles call it on first use, so apps don't have to, but calling it at launch avoids a first-frame hitch.
import CoreText
import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public enum FoleviFonts {
    private static let registered: Bool = {
        guard let dir = Bundle.module.url(forResource: "Fonts", withExtension: nil),
              let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return false }
        let urls = files.filter { $0.pathExtension == "ttf" } as CFArray
        CTFontManagerRegisterFontURLs(urls, .process, true) { _, _ in true }
        return true
    }()

    /// Registers the bundled faces. Returns false when the resources are missing (a broken build).
    @discardableResult
    public static func register() -> Bool { registered }

    /// PostScript names of the faces, by family and weight. Variable fonts expose their named instances
    /// ("InstrumentSans-Regular_SemiBold"), which Core Text resolves to the right axis value.
    static func postScriptName(_ family: Family, _ weight: Font.Weight, italic: Bool) -> String {
        switch family {
        case .ui:
            switch weight {
            case .medium: return "InstrumentSans-Regular_Medium"
            case .semibold: return "InstrumentSans-Regular_SemiBold"
            case .bold, .heavy, .black: return "InstrumentSans-Regular_Bold"
            default: return "InstrumentSans-Regular"
            }
        case .display:
            let base: String
            switch weight {
            case .medium: base = "Spectral-Medium"
            case .semibold: base = "Spectral-SemiBold"
            case .bold, .heavy, .black: base = "Spectral-Bold"
            default: base = "Spectral-Regular"
            }
            if italic { return base == "Spectral-Regular" ? "Spectral-Italic" : base + "Italic" }
            return base
        case .mono:
            switch weight {
            // The variable font's named instances have no SemiBold: semibold draws Bold.
            case .medium: return "JetBrainsMonoRoman-Medium"
            case .semibold, .bold, .heavy, .black: return "JetBrainsMonoRoman-Bold"
            default: return "JetBrainsMono-Regular"
            }
        case .modern:
            switch weight {
            case .medium: return "Inter-Regular_Medium"
            case .semibold: return "Inter-Regular_SemiBold"
            case .bold, .heavy, .black: return "Inter-Regular_Bold"
            default: return "Inter-Regular"
            }
        case .rounded:
            return "" // the system's rounded face, see `font(...)`
        }
    }

    public enum Family: String, Sendable, CaseIterable {
        /// Instrument Sans: UI and body text.
        case ui
        /// Spectral: titles and larger UI text, note titles, card titles, folder names (and the "Serif" font type).
        case display
        /// JetBrains Mono: code (and the "Mono" font type).
        case mono
        /// Inter: the "Modern" font type's standard face (card previews).
        case modern
        /// The system's rounded face: the "Soft" font type.
        case rounded
    }

    /// A fixed-size face (no Dynamic Type), for drawings that scale as one (cards).
    public static func font(_ family: Family, size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        register()
        if family == .rounded {
            let f = Font.system(size: size, weight: weight, design: .rounded)
            return italic ? f.italic() : f
        }
        return Font.custom(postScriptName(family, weight, italic: italic), fixedSize: size)
    }

    /// A face that grows with Dynamic Type relative to a system text style.
    public static func font(_ family: Family, size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false, relativeTo style: Font.TextStyle) -> Font {
        register()
        if family == .rounded {
            let f = Font.system(style, design: .rounded).weight(weight)
            return italic ? f.italic() : f
        }
        return Font.custom(postScriptName(family, weight, italic: italic), size: size, relativeTo: style)
    }

    #if canImport(UIKit)
    /// UIKit form (navigation bar appearance, attributed strings), scaled with Dynamic Type when `style` is given.
    public static func uiFont(_ family: Family, size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false, relativeTo style: UIFont.TextStyle? = nil) -> UIFont {
        register()
        let base: UIFont
        if family == .rounded {
            let sys = UIFont.systemFont(ofSize: size, weight: weight.uiKit)
            base = sys.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: size) } ?? sys
        } else {
            base = UIFont(name: postScriptName(family, weight, italic: italic), size: size) ?? .systemFont(ofSize: size, weight: weight.uiKit)
        }
        guard let style else { return base }
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }
    #elseif canImport(AppKit)
    public static func nsFont(_ family: Family, size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false) -> NSFont {
        register()
        if family == .rounded {
            let sys = NSFont.systemFont(ofSize: size, weight: weight.appKit)
            return sys.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: size) } ?? sys
        }
        return NSFont(name: postScriptName(family, weight, italic: italic), size: size) ?? .systemFont(ofSize: size, weight: weight.appKit)
    }
    #endif
}

extension Font.Weight {
    #if canImport(UIKit)
    var uiKit: UIFont.Weight {
        switch self {
        case .ultraLight: .ultraLight
        case .thin: .thin
        case .light: .light
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        case .heavy: .heavy
        case .black: .black
        default: .regular
        }
    }
    #elseif canImport(AppKit)
    var appKit: NSFont.Weight {
        switch self {
        case .ultraLight: .ultraLight
        case .thin: .thin
        case .light: .light
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        case .heavy: .heavy
        case .black: .black
        default: .regular
        }
    }
    #endif
}
