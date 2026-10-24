// The app's palette as SwiftUI colours: the neutral chrome (docs/DESIGN_SYSTEM.md "Neutral app chrome") with
// the warm palette's signal colours (ember, moss, coral, destructive...). Every colour is dynamic (light and
// dark), so views just use `Folevi.color.ink`.
import SwiftUI

public enum Folevi {
    public static let color = Palette()
    public static let space = FoleviTokens.Space.self
    public static let radius = FoleviTokens.Radius.self
    public static let motion = FoleviTokens.Motion.self
}

/// Semantic colours of the app chrome.
public struct Palette: Sendable {
    typealias C = FoleviTokens.Chrome

    public var canvas: Color { C.canvas.color }
    public var sidebar: Color { C.sidebar.color }
    public var surface: Color { C.surface.color }
    public var surfaceRaised: Color { C.surfaceRaised.color }
    public var surfaceSunken: Color { C.surfaceSunken.color }
    public var ink: Color { C.ink.color }
    public var heading: Color { C.heading.color }
    public var inkMuted: Color { C.inkMuted.color }
    public var inkFaint: Color { C.inkFaint.color }
    public var line: Color { C.line.color }
    public var lineStrong: Color { C.lineStrong.color }
    public var accent: Color { C.accent.color }
    public var accentStrong: Color { C.accentStrong.color }
    public var accentInk: Color { C.accentInk.color }
    public var accentSoft: Color { C.accentSoft.color }
    public var accentSoftInk: Color { C.accentSoftInk.color }
    public var focus: Color { C.focus.color }
    public var selection: Color { C.selection.color }
    public var ember: Color { C.ember.color }
    public var emberInk: Color { C.emberInk.color }
    public var emberSoft: Color { C.emberSoft.color }
    public var moss: Color { C.moss.color }
    public var mossInk: Color { C.mossInk.color }
    public var mossSoft: Color { C.mossSoft.color }
    public var marigold: Color { C.marigold.color }
    public var coral: Color { C.coral.color }
    public var coralInk: Color { C.coralInk.color }
    public var coralSoft: Color { C.coralSoft.color }
    public var destructive: Color { C.destructive.color }
    public var destructiveSoft: Color { C.destructiveSoft.color }
    public var success: Color { C.success.color }
    public var warning: Color { C.warning.color }
    public var scrim: Color { C.scrim.color }
    public var glassPanel: Color { FoleviTokens.Glass.panel.color }
    public var glassPop: Color { FoleviTokens.Glass.pop.color }
    public var glassBorder: Color { FoleviTokens.Glass.border.color }
    public var glassHover: Color { FoleviTokens.Glass.hover.color }
}

public extension Animation {
    /// The app's easing (cubic-bezier(0.2, 0.7, 0.2, 1)), no bounce. `duration` defaults to the base 180 ms.
    static func folevi(_ duration: Double = FoleviTokens.Motion.base) -> Animation {
        let e = FoleviTokens.Motion.easing
        return .timingCurve(e.0, e.1, e.2, e.3, duration: duration)
    }
}

public extension View {
    /// Animates with the app's curve, or not at all under Reduce Motion.
    func foleviAnimation<V: Equatable>(_ duration: Double = FoleviTokens.Motion.base, value: V) -> some View {
        modifier(ReducibleAnimation(duration: duration, value: value))
    }
}

private struct ReducibleAnimation<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let duration: Double
    let value: V
    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : .folevi(duration), value: value)
    }
}
