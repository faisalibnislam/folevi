// Boxes drawn the way CSS draws them (docs/MAC_REBUILD_PLAN.md section 3.1), from the web app's computed styles
// (Generated/WebStyles.swift, scripts/web-styles.mjs): background colour and linear gradient, border-radius
// (circular corners, as CSS), a border, and every `box-shadow` layer exactly as the CSS spec defines them: outer
// shadows only outside the border box, inset shadows only inside, spread growing or shrinking the shape, blur
// as a Gaussian of half the blur radius (Core Graphics' shadow, which is what WebKit itself draws with).
import CoreGraphics
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

public struct WebInsets: Hashable, Sendable {
    public var top: CGFloat, right: CGFloat, bottom: CGFloat, left: CGFloat

    public init(_ top: CGFloat, _ right: CGFloat, _ bottom: CGFloat, _ left: CGFloat) {
        self.top = top
        self.right = right
        self.bottom = bottom
        self.left = left
    }

    public var edgeInsets: EdgeInsets { EdgeInsets(top: top, leading: left, bottom: bottom, trailing: right) }
}

public struct WebGradient: Hashable, Sendable {
    /// CSS angle: 180 is top to bottom.
    public var angle: CGFloat
    public var stops: [RGBA]

    public init(angle: CGFloat, stops: [RGBA]) {
        self.angle = angle
        self.stops = stops
    }
}

/// What WebKit computed for one element in one theme.
public struct WebComputedStyle: Hashable, Sendable {
    /// Where the element was in its page (the app's window for app styles), in points from the top left.
    public var x: CGFloat, y: CGFloat
    public var width: CGFloat, height: CGFloat
    public var padding: WebInsets
    public var margin: WebInsets
    public var radius: CGFloat
    public var background: RGBA
    public var gradient: WebGradient?
    public var shadows: [ShadowLayer]
    public var borderWidth: CGFloat
    public var borderColor: RGBA
    public var color: RGBA
    public var opacity: CGFloat
    public var family: WebFontFamily
    public var fontSize: CGFloat
    public var fontWeight: CGFloat
    public var lineHeight: CGFloat?
    public var letterSpacing: CGFloat
    public var gap: CGFloat
    public var backdropBlur: CGFloat

    public init(x: CGFloat = 0, y: CGFloat = 0, width: CGFloat, height: CGFloat, padding: WebInsets, margin: WebInsets, radius: CGFloat, background: RGBA, gradient: WebGradient?, shadows: [ShadowLayer], borderWidth: CGFloat, borderColor: RGBA, color: RGBA, opacity: CGFloat, family: WebFontFamily, fontSize: CGFloat?, fontWeight: CGFloat?, lineHeight: CGFloat?, letterSpacing: CGFloat, gap: CGFloat, backdropBlur: CGFloat) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.padding = padding
        self.margin = margin
        self.radius = radius
        self.background = background
        self.gradient = gradient
        self.shadows = shadows
        self.borderWidth = borderWidth
        self.borderColor = borderColor
        self.color = color
        self.opacity = opacity
        self.family = family
        self.fontSize = fontSize ?? 16
        self.fontWeight = fontWeight ?? 400
        self.lineHeight = lineHeight
        self.letterSpacing = letterSpacing
        self.gap = gap
        self.backdropBlur = backdropBlur
    }

    /// The element's text style (font, size, weight, letter spacing, line height).
    public var text: WebTextStyle {
        WebTextStyle(family: family, size: fontSize, leading: lineHeight ?? (fontSize * 1.55).rounded(), weight: fontWeight, letterSpacing: letterSpacing)
    }

    /// How far the outer shadows reach past the box, on any side.
    var shadowReach: CGFloat {
        shadows.filter { !$0.inset }.map { max(abs($0.x), abs($0.y)) + max(0, $0.spread) + $0.blur * 1.5 }.max() ?? 0
    }
}

/// A style in light and dark.
public struct WebStylePair: Hashable, Sendable {
    public let light: WebComputedStyle
    public let dark: WebComputedStyle

    public init(light: WebComputedStyle, dark: WebComputedStyle) {
        self.light = light
        self.dark = dark
    }

    public func resolve(_ scheme: ColorScheme) -> WebComputedStyle { scheme == .dark ? dark : light }
}

public extension View {
    /// Draws a web element's box behind the content (background, gradient, shadows, border) and clips nothing:
    /// size and padding are the caller's (usually `webFrame`), so content can still lay itself out.
    func webBox(_ style: WebStylePair) -> some View {
        modifier(WebBoxModifier(pair: style))
    }

    /// The web element's height (when it has a fixed one), padding, text style and colour, and its box.
    func webElement(_ style: WebStylePair, fixedHeight: Bool = true, fixedWidth: Bool = false) -> some View {
        modifier(WebElementModifier(pair: style, fixedHeight: fixedHeight, fixedWidth: fixedWidth))
    }
}

struct WebElementModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let pair: WebStylePair
    let fixedHeight: Bool
    let fixedWidth: Bool

    func body(content: Content) -> some View {
        let s = pair.resolve(scheme)
        content
            .padding(s.padding.edgeInsets)
            .frame(width: fixedWidth ? s.width : nil, height: fixedHeight ? s.height : nil)
            .foregroundStyle(s.color.color)
            .webBox(pair)
            .opacity(s.opacity)
    }
}

struct WebBoxModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let pair: WebStylePair

    func body(content: Content) -> some View {
        let s = pair.resolve(scheme)
        let outer = Array(s.shadows.enumerated().filter { !$0.element.inset })
        let inner = Array(s.shadows.enumerated().filter { $0.element.inset })
        content.background {
            ZStack {
                // Outer shadows, last listed at the bottom (CSS paints the first on top), outside the box only.
                ForEach(outer.reversed(), id: \.offset) { item in
                    WebShadowLayerView(layer: item.element, radius: s.radius, inset: false)
                }
                WebBoxFill(style: s)
                ForEach(inner.reversed(), id: \.offset) { item in
                    WebShadowLayerView(layer: item.element, radius: s.radius, inset: true)
                }
                if s.borderWidth > 0, s.borderColor.a > 0 {
                    RoundedRectangle(cornerRadius: s.radius, style: .circular).strokeBorder(s.borderColor.color, lineWidth: s.borderWidth)
                }
            }
            .allowsHitTesting(false)
        }
    }
}

/// The background colour and gradient inside the border box.
struct WebBoxFill: View {
    let style: WebComputedStyle

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: style.radius, style: .circular)
        ZStack {
            if style.background.a > 0 { shape.fill(style.background.color) }
            if let g = style.gradient, g.stops.count >= 2 {
                shape.fill(LinearGradient(colors: g.stops.map(\.color), startPoint: Self.point(g.angle, start: true), endPoint: Self.point(g.angle, start: false)))
            }
        }
    }

    /// The ends of a CSS gradient line for an angle (0deg up, 90deg right, 180deg down), in unit coordinates.
    static func point(_ angle: CGFloat, start: Bool) -> UnitPoint {
        let a = angle * .pi / 180
        let dx = sin(a) / 2, dy = -cos(a) / 2
        return start ? UnitPoint(x: 0.5 - dx, y: 0.5 - dy) : UnitPoint(x: 0.5 + dx, y: 0.5 + dy)
    }
}

/// One `box-shadow` layer. Outer: the box grown by `spread`, moved by (x, y), blurred, shown only outside the
/// box. Inset: everything outside the box shrunk by `spread` and moved, blurred, shown only inside the box.
struct WebShadowLayerView: View {
    let layer: ShadowLayer
    let radius: CGFloat
    let inset: Bool

    var body: some View {
        let reach = max(abs(layer.x), abs(layer.y)) + abs(layer.spread) + layer.blur * 1.5 + 2
        GeometryReader { geo in
            let box = CGRect(origin: .zero, size: geo.size)
            let sigma = layer.blur / 2
            if inset {
                WebRingShape(box: box, spread: layer.spread, radius: radius, dx: layer.x, dy: layer.y, reach: reach)
                    .fill(layer.color.color, style: FillStyle(eoFill: true))
                    .blur(radius: sigma, opaque: false)
                    .mask(RoundedRectangle(cornerRadius: radius, style: .circular))
            } else {
                let big = CGSize(width: box.width + reach * 2, height: box.height + reach * 2)
                ZStack {
                    RoundedRectangle(cornerRadius: max(0, radius + layer.spread), style: .circular)
                        .fill(layer.color.color)
                        .frame(width: max(0, box.width + layer.spread * 2), height: max(0, box.height + layer.spread * 2))
                        .offset(x: layer.x, y: layer.y)
                        .blur(radius: sigma, opaque: false)
                }
                .frame(width: big.width, height: big.height)
                .mask {
                    WebOutsideShape(box: CGRect(x: reach, y: reach, width: box.width, height: box.height), radius: radius)
                        .fill(style: FillStyle(eoFill: true))
                }
                .position(x: box.midX, y: box.midY)
            }
        }
    }
}

/// A big rectangle with the box shrunk by `spread` (and moved) cut out of it: an inset shadow's caster.
struct WebRingShape: Shape {
    let box: CGRect
    let spread: CGFloat
    let radius: CGFloat
    let dx: CGFloat, dy: CGFloat
    let reach: CGFloat

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(box.insetBy(dx: -reach, dy: -reach))
        let hole = box.insetBy(dx: spread, dy: spread).offsetBy(dx: dx, dy: dy)
        if hole.width > 0, hole.height > 0 {
            let r = max(0, radius - spread)
            p.addRoundedRect(in: hole, cornerSize: CGSize(width: r, height: r), style: .circular)
        }
        return p
    }
}

/// Everything around the box (its frame minus the rounded box): where an outer shadow may show.
struct WebOutsideShape: Shape {
    let box: CGRect
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect)
        p.addRoundedRect(in: box, cornerSize: CGSize(width: radius, height: radius), style: .circular)
        return p
    }
}

extension RGBA {
    var cgColor: CGColor {
        CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [r / 255, g / 255, b / 255, a]) ?? CGColor(gray: 0, alpha: a)
    }
}

/// `backdrop-filter: blur()`. Over a plain canvas (the screenshot specimens) the blurred backdrop is the canvas
/// itself, so nothing is drawn yet; menus and popovers over content get a real blur with M2's popover windows.
struct WebBackdropBlur: View {
    let radius: CGFloat

    var body: some View { Color.clear }
}
