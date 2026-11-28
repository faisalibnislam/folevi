// Shadow tokens as SwiftUI modifiers (docs/SHADOWS.md). Edges (hairline, control, primary) outline a surface; the
// elevation levels (raised, resting, lifted, floating, overlay) are a solid surface's edge (FoleviTokens.Shadow.edge)
// plus that level's drop, as the web's `var(--shadow-edge), var(--shadow-<level>)`. Cast layers become stacked
// `.shadow`s under the (opaque) content; a spread-only ring becomes a stroke; inset highlights become an inner
// gradient stroke.
import SwiftUI

public enum FoleviShadow: Sendable {
    case hairline, control, primary
    /// A control lifted off its track; a card on the page; a card under the pointer or dragged; a menu, popover,
    /// toast or floating bar; a dialog or sheet.
    case raised, resting, lifted, floating, overlay

    var pair: ShadowPair {
        switch self {
        case .hairline: FoleviTokens.Shadow.hairline
        case .control: FoleviTokens.Shadow.control
        case .primary: FoleviTokens.Shadow.primary
        case .raised: Self.edged(FoleviTokens.Shadow.raised)
        case .resting: Self.edged(FoleviTokens.Shadow.resting)
        case .lifted: Self.edged(FoleviTokens.Shadow.lifted)
        case .floating: Self.edged(FoleviTokens.Shadow.floating)
        case .overlay: Self.edged(FoleviTokens.Shadow.overlay)
        }
    }

    private static func edged(_ level: ShadowPair) -> ShadowPair {
        ShadowPair(light: FoleviTokens.Shadow.edge.light + level.light, dark: FoleviTokens.Shadow.edge.dark + level.dark)
    }
}

public extension View {
    /// Draws a shadow token around a shape of the given corner radius.
    func foleviShadow(_ shadow: FoleviShadow, radius: CGFloat) -> some View {
        modifier(TokenShadow(shadow: shadow, shape: RoundedRectangle(cornerRadius: radius, style: .continuous)))
    }

    func foleviShadow<S: InsettableShape>(_ shadow: FoleviShadow, in shape: S) -> some View {
        modifier(TokenShadow(shadow: shadow, shape: shape))
    }
}

struct TokenShadow<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let shadow: FoleviShadow
    let shape: S

    func body(content: Content) -> some View {
        let layers = shadow.pair.resolve(scheme)
        let casts = layers.filter { !$0.inset && ($0.blur > 0 || $0.x != 0 || $0.y != 0) }
        let rings = layers.filter { !$0.inset && $0.blur == 0 && $0.x == 0 && $0.y == 0 && $0.spread > 0 }
        let insets = layers.filter(\.inset)
        content
            .overlay {
                ForEach(Array(rings.enumerated()), id: \.offset) { _, l in
                    shape.strokeBorder(contrast == .increased ? FoleviTokens.Chrome.lineStrong.resolve(scheme).color : l.color.color, lineWidth: l.spread)
                }
            }
            .overlay {
                ForEach(Array(insets.enumerated()), id: \.offset) { _, l in
                    // An inset highlight/shade along the top (y > 0) or bottom (y < 0) edge.
                    shape.inset(by: 0.25)
                        .stroke(LinearGradient(colors: l.y >= 0 ? [l.color.color, .clear] : [.clear, l.color.color], startPoint: .top, endPoint: .center), lineWidth: max(1, abs(l.y)))
                        .allowsHitTesting(false)
                }
            }
            .background {
                ZStack {
                    ForEach(Array(casts.enumerated()), id: \.offset) { _, l in
                        // The caster is drawn under the content, which is opaque inside the shape (cards, buttons).
                        shape.fill(l.color.opacity(1).color)
                            .padding(-l.spread)
                            .shadow(color: l.color.color, radius: l.blur / 2, x: l.x, y: l.y)
                    }
                }
            }
    }
}
