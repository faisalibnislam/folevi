// The type scale for native screens (docs/DESIGN_SYSTEM.md "Type", adapted to iOS sizes as plan section 4.1
// says: Spectral 34 large titles, Instrument Sans semibold 17 inline titles). Every style grows with Dynamic
// Type relative to the system style named beside it, and carries its tracking.
import SwiftUI

public enum FoleviTextStyle: String, Sendable, CaseIterable {
    /// Large navigation title: Spectral 34 semibold.
    case largeTitle
    /// Screen and sheet titles: Spectral 25 semibold.
    case title
    /// Section titles in content: Spectral 20 semibold.
    case title2
    /// Card and row titles in serif: Spectral 17 medium.
    case title3
    /// Inline navigation title, emphasised rows: Instrument Sans 17 semibold.
    case headline
    /// Body text and row titles: Instrument Sans 16.
    case body
    /// Body, emphasised: Instrument Sans 16 semibold.
    case bodyStrong
    /// Secondary text, buttons: Instrument Sans 14.
    case callout
    /// Button labels: Instrument Sans 14 semibold.
    case button
    /// Row subtitles, metadata: Instrument Sans 13.
    case footnote
    /// Small metadata, chips: Instrument Sans 12.
    case caption
    /// Section labels: Instrument Sans 11 semibold, upper case, +0.06em.
    case caps
    /// Code: JetBrains Mono 14.
    case mono

    public var family: FoleviFonts.Family {
        switch self {
        case .largeTitle, .title, .title2, .title3: .display
        case .mono: .mono
        default: .ui
        }
    }

    public var size: CGFloat {
        switch self {
        case .largeTitle: 34
        case .title: FoleviTokens.FontSize.h2
        case .title2: FoleviTokens.FontSize.h3
        case .title3, .headline: 17
        case .body, .bodyStrong: FoleviTokens.FontSize.body
        case .callout, .button, .mono: FoleviTokens.FontSize.md
        case .footnote: FoleviTokens.FontSize.sm
        case .caption: FoleviTokens.FontSize.xs
        case .caps: 11
        }
    }

    public var weight: Font.Weight {
        switch self {
        case .largeTitle, .title, .title2, .headline, .bodyStrong, .button, .caps: .semibold
        case .title3: .medium
        default: .regular
        }
    }

    /// Letter spacing in em (tokens `font.tracking`).
    public var trackingEm: CGFloat {
        switch self {
        case .largeTitle, .title: FoleviTokens.Tracking.tight
        case .title2, .title3: FoleviTokens.Tracking.snug
        case .caps: FoleviTokens.Tracking.caps
        case .mono: 0
        default: FoleviTokens.Tracking.normal
        }
    }

    public var relativeTo: Font.TextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .body, .bodyStrong, .mono: .body
        case .callout, .button: .callout
        case .footnote: .footnote
        case .caption: .caption
        case .caps: .caption2
        }
    }

    public var font: Font { FoleviFonts.font(family, size: size, weight: weight, relativeTo: relativeTo) }

    #if canImport(UIKit)
    public var uiTextStyle: UIFont.TextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .body, .bodyStrong, .mono: .body
        case .callout, .button: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caps: .caption2
        }
    }

    /// For UIKit (navigation bar titles): scaled with Dynamic Type.
    public var uiFont: UIFont { FoleviFonts.uiFont(family, size: size, weight: weight, relativeTo: uiTextStyle) }
    #endif
}

public extension View {
    /// Sets a Folevi text style: face, size (Dynamic Type), weight and tracking; caps also upper-cases.
    func foleviFont(_ style: FoleviTextStyle) -> some View {
        modifier(FoleviFontModifier(style: style))
    }
}

struct FoleviFontModifier: ViewModifier {
    @ScaledMetric private var scale: CGFloat = 1
    let style: FoleviTextStyle

    func body(content: Content) -> some View {
        content
            .font(style.font)
            .tracking(style.trackingEm * style.size * scale)
            .textCase(style == .caps ? .uppercase : nil)
    }
}
