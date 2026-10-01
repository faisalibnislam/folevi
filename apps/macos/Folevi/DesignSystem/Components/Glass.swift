import SwiftUI

/// The web's glass recipes (globals.css): the fine light edge every glass panel, tab and popover carries,
/// the translucent "well" behind search fields, and the soft outline of an input.
enum FoleviGlassDepth {
    /// `--glass-edge`: inset 1px white/60% and an outer 1px black/6% (dark: white/8% inside, black/40% outside).
    static var edge: [FoleviShadowLayer] {
        [
            FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: Color(nsColor: .folevi(
                light: (1, 1, 1, 0.6), dark: (1, 1, 1, 0.08), name: "folevi.glassEdge.inner")), inset: true),
            FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: Color(nsColor: .folevi(
                light: (0, 0, 0, 0.06), dark: (0, 0, 0, 0.4), name: "folevi.glassEdge.outer")), inset: false),
        ]
    }

    /// `--glass-shadow`: 0 1px 2px black/4%, 0 12px 32px -12px (dark: deeper).
    static var shadow: [FoleviShadowLayer] {
        [
            FoleviShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: Color(nsColor: .folevi(
                light: (0, 0, 0, 0.04), dark: (0, 0, 0, 0.3), name: "folevi.glassShadow.0")), inset: false),
            FoleviShadowLayer(x: 0, y: 12, blur: 32, spread: -12, color: Color(nsColor: .folevi(
                light: (0.078, 0.078, 0.157, 0.14), dark: (0, 0, 0, 0.6), name: "folevi.glassShadow.1")), inset: false),
        ]
    }

    /// `.ui-well`: an inset 1px glass border over the glass hover tint.
    static var well: [FoleviShadowLayer] {
        [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviGlass.border, inset: true)]
    }

    /// `.ui-input`: a faint inner top shade and a 1px line ring.
    static var input: [FoleviShadowLayer] {
        [
            FoleviShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: FoleviColor.heading.opacity(0.08), inset: true),
            FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false),
        ]
    }

    /// The open tab and a focused input: a soft 16.5% ink outline and a small drop.
    static var activeOutline: [FoleviShadowLayer] {
        [
            FoleviShadowLayer(x: 0, y: 1, blur: 3, spread: 0, color: .black.opacity(0.1), inset: false),
            FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1.5, color: FoleviColor.heading.opacity(0.165), inset: true),
        ]
    }
}

extension View {
    /// `.ui-well`: translucent (the glass behind shows through), with a fine inner border. Radius 6.
    func foleviGlassWell(radius: CGFloat = 6) -> some View {
        foleviSurface(.color(FoleviGlass.hover), shape: .rounded(radius), shadow: FoleviGlassDepth.well)
    }

    /// `.ui-input`: the surface colour, radius 6, a line ring and a faint inner shade.
    func foleviInputSurface(radius: CGFloat = 6, focused: Bool = false) -> some View {
        foleviSurface(.color(FoleviColor.surface), shape: .rounded(radius),
                      shadow: focused ? FoleviGlassDepth.activeOutline : FoleviGlassDepth.input)
    }

}
