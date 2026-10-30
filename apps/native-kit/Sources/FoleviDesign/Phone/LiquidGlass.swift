// The iPhone app's Liquid Glass (apps/web/src/app/globals.css, `.ui-liquid` and `.ui-liquid-strong` with the
// --liquid-* variables): what the web paints under the iPhone's floating chrome (the tab bar, the glass pills and
// circles, menus and sheets), layer for layer and in the same order:
//   the drop shadows (--liquid-shadow) and the hairline outline (--liquid-edge's 0.5 px ring), outside the shape;
//   what's behind, blurred (backdrop-filter: blur saturate brightness);
//   the fill (--liquid-fill, or a caller's, as the tab bar's pills have);
//   the edge light (--liquid-edge's inset highlights);
//   the sheen (::before, --liquid-sheen);
//   the content;
//   the rim (::after, --liquid-rim: a 1 px ring in a 135deg gradient).
import SwiftUI
#if os(iOS)
import UIKit
#endif

public enum LiquidGlassKind: Sendable {
    /// `.ui-liquid`: clear, blur 9.
    case regular
    /// `.ui-liquid-strong`: nearly opaque, blur 30 (menus, sheets).
    case strong
}

/// The --liquid-* variables, light and dark.
public enum LiquidGlassLook {
    public static let fill = ColorPair(light: RGBA(255, 255, 255, 0.3), dark: RGBA(44, 44, 50, 0.36))
    public static let fillStrong = ColorPair(light: RGBA(252, 252, 253, 0.8), dark: RGBA(36, 36, 40, 0.84))
    /// `.iphone-tab-pill`'s own fill (globals.css): the tab bar's pills are more opaque than other glass.
    public static let tabPillFill = ColorPair(light: RGBA(255, 255, 255, 0.72), dark: RGBA(36, 36, 40, 0.72))
    public static let lens = ColorPair(light: RGBA(0, 0, 0, 0.06), dark: RGBA(255, 255, 255, 0.1))
    public static let active = ColorPair(light: RGBA(0, 0, 0, 0.075), dark: RGBA(255, 255, 255, 0.12))
    public static let press = ColorPair(light: RGBA(0, 0, 0, 0.1), dark: RGBA(255, 255, 255, 0.16))

    /// --liquid-edge: two inset highlights and a 0.5 px outline.
    static func edge(_ scheme: ColorScheme) -> [ShadowLayer] {
        scheme == .dark
            ? [ShadowLayer(x: 0, y: 1, blur: 0, spread: 0, color: RGBA(255, 255, 255, 0.14), inset: true),
               ShadowLayer(x: 0, y: -1, blur: 1, spread: 0, color: RGBA(255, 255, 255, 0.04), inset: true),
               ShadowLayer(x: 0, y: 0, blur: 0, spread: 0.5, color: RGBA(0, 0, 0, 0.55))]
            : [ShadowLayer(x: 0, y: 1, blur: 0, spread: 0, color: RGBA(255, 255, 255, 0.85), inset: true),
               ShadowLayer(x: 0, y: -1, blur: 1, spread: 0, color: RGBA(255, 255, 255, 0.35), inset: true),
               ShadowLayer(x: 0, y: 0, blur: 0, spread: 0.5, color: RGBA(0, 0, 0, 0.09))]
    }

    /// --liquid-shadow.
    static func shadow(_ scheme: ColorScheme) -> [ShadowLayer] {
        scheme == .dark
            ? [ShadowLayer(x: 0, y: 12, blur: 34, spread: -10, color: RGBA(0, 0, 0, 0.65)),
               ShadowLayer(x: 0, y: 2, blur: 8, spread: -2, color: RGBA(0, 0, 0, 0.4))]
            : [ShadowLayer(x: 0, y: 10, blur: 30, spread: -10, color: RGBA(0, 0, 0, 0.2)),
               ShadowLayer(x: 0, y: 2, blur: 8, spread: -2, color: RGBA(0, 0, 0, 0.08))]
    }

    /// --liquid-rim's stops (position, colour), at 135deg.
    static func rim(_ scheme: ColorScheme) -> [(CGFloat, RGBA)] {
        scheme == .dark
            ? [(0, RGBA(255, 255, 255, 0.5)), (0.22, RGBA(255, 255, 255, 0.12)), (0.48, RGBA(255, 255, 255, 0.02)), (0.76, RGBA(255, 255, 255, 0.06)), (1, RGBA(255, 255, 255, 0.3))]
            : [(0, RGBA(255, 255, 255, 1)), (0.2, RGBA(255, 255, 255, 0.4)), (0.46, RGBA(255, 255, 255, 0.05)), (0.76, RGBA(255, 255, 255, 0.2)), (1, RGBA(255, 255, 255, 0.9))]
    }
}

public extension View {
    /// The web's `.ui-liquid` (or `-strong`) behind this view, in `shape` (a capsule unless given).
    func liquidGlass(_ kind: LiquidGlassKind = .regular, fill: ColorPair? = nil, shape: WebCornersShape = .capsule) -> some View {
        modifier(LiquidGlassModifier(kind: kind, fill: fill, shape: shape))
    }
}

public extension WebCornersShape {
    /// `rounded-capsule` (9999px): CSS keeps each radius to half the shorter side.
    static let capsule = WebCornersShape(topLeft: 9999, topRight: 9999, bottomRight: 9999, bottomLeft: 9999)
}

struct LiquidGlassModifier: ViewModifier {
    let kind: LiquidGlassKind
    let fill: ColorPair?
    let shape: WebCornersShape
    @Environment(\.colorScheme) private var scheme
    @Environment(\.webSnapshot) private var snapshot

    func body(content: Content) -> some View {
        let edge = LiquidGlassLook.edge(scheme)
        let fillColor = (fill ?? (kind == .strong ? LiquidGlassLook.fillStrong : LiquidGlassLook.fill)).resolve(scheme)
        content
            .background {
                ZStack {
                    WebShapeBox(shape: shape, fill: nil, shadows: LiquidGlassLook.shadow(scheme) + edge.filter { !$0.inset })
                    // What's behind, blurred: live only (a picture made by ImageRenderer has nothing behind it to
                    // blur; over the screenshot diffs' plain canvas the web's blur changes nothing either).
                    if !snapshot {
                        BackdropBlur(radius: kind == .strong ? 30 : 9).clipShape(shape)
                    }
                    WebShapeBox(shape: shape, fill: fillColor.color, shadows: edge.filter(\.inset))
                    LiquidSheen(scheme: scheme).clipShape(shape)
                }
            }
            .overlay {
                LiquidRim(stops: LiquidGlassLook.rim(scheme), shape: shape).allowsHitTesting(false)
            }
    }
}

/// --liquid-sheen: `radial-gradient(130% 80% at 28% 0%, white .55, transparent 58%)` and, in light mode,
/// `linear-gradient(to top, black .025, transparent 45%)`.
struct LiquidSheen: View {
    let scheme: ColorScheme

    var body: some View {
        Canvas { ctx, size in
            let rect = CGRect(origin: .zero, size: size)
            if scheme != .dark {
                ctx.fill(Path(rect), with: .linearGradient(
                    Gradient(stops: [.init(color: RGBA(0, 0, 0, 0.025).color, location: 0), .init(color: RGBA(0, 0, 0, 0).color, location: 0.45)]),
                    startPoint: CGPoint(x: 0, y: size.height), endPoint: .zero))
            }
            // The ellipse: 130% of the width by 80% of the height, centred at 28% across the top edge. Drawn as a
            // circle of the ellipse's x radius, squashed vertically.
            let rx = size.width * 1.3, ry = size.height * 0.8
            guard rx > 0, ry > 0 else { return }
            var e = ctx
            e.translateBy(x: size.width * 0.28, y: 0)
            e.scaleBy(x: 1, y: ry / rx)
            let top = scheme == .dark ? 0.1 : 0.55
            e.fill(Path(CGRect(x: -rx * 2, y: -rx * 2, width: rx * 4, height: rx * 4)), with: .radialGradient(
                Gradient(stops: [.init(color: RGBA(255, 255, 255, top).color, location: 0), .init(color: RGBA(255, 255, 255, 0).color, location: 0.58)]),
                center: .zero, startRadius: 0, endRadius: rx))
        }
        .allowsHitTesting(false)
    }
}

/// --liquid-rim: a 1 px ring (the box minus its content box, as the web's mask cuts it) in a 135deg gradient.
struct LiquidRim: View {
    let stops: [(CGFloat, RGBA)]
    let shape: WebCornersShape

    var body: some View {
        Canvas { ctx, size in
            let rect = CGRect(origin: .zero, size: size)
            var ring = shape.path(in: rect)
            ring.addPath(shape.grown(-1).path(in: rect))
            // The CSS gradient line for 135deg: through the centre, as long as the box's projection on it.
            let a = 135 * CGFloat.pi / 180
            let half = (abs(size.width * sin(a)) + abs(size.height * cos(a))) / 2
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let d = CGPoint(x: sin(a) * half, y: -cos(a) * half)
            ctx.fill(ring, with: .linearGradient(
                Gradient(stops: stops.map { .init(color: $0.1.color, location: $0.0) }),
                startPoint: CGPoint(x: c.x - d.x, y: c.y - d.y), endPoint: CGPoint(x: c.x + d.x, y: c.y + d.y)), style: FillStyle(eoFill: true))
        }
    }
}

/// What's behind the glass, blurred, without the system material's own tint (the web's glass brings its own fill).
struct BackdropBlur: View {
    let radius: CGFloat

    var body: some View {
        #if os(iOS)
        BlurView()
        #else
        Rectangle().fill(.ultraThinMaterial)
        #endif
    }
}

#if os(iOS)
/// The lightest system blur, its tint layers made clear so only the blur is left.
private struct BlurView: UIViewRepresentable {
    func makeUIView(context: Context) -> UIVisualEffectView {
        let v = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
        v.isUserInteractionEnabled = false
        return v
    }

    func updateUIView(_ v: UIVisualEffectView, context: Context) {
        for sub in v.subviews where sub !== v.contentView {
            sub.backgroundColor = .clear
        }
    }
}
#endif
