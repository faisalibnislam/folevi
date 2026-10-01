import AppKit
import QuartzCore
import SwiftUI

/// Fill of a Warm Folio surface.
enum SurfaceFill: Equatable {
    case none
    case color(Color)
    /// Vertical gradient, first color at the top.
    case gradient([Color])
}

/// Shape of a surface: a rounded rectangle (continuous corners) or a pill.
enum SurfaceShape: Equatable {
    case rounded(CGFloat)
    case capsule

    func path(in rect: CGRect) -> CGPath {
        switch self {
        case .rounded(let r):
            let radius = min(r, min(rect.width, rect.height) / 2)
            return RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: rect).cgPath
        case .capsule:
            return Capsule(style: .continuous).path(in: rect).cgPath
        }
    }
}

extension View {
    /// A Warm Folio surface behind the view: fill + the token shadow stack (outer drops, 1pt ring,
    /// inner top highlight / bottom shade), rendered with Core Animation shadow paths — the same
    /// semantics as CSS `box-shadow` (blur, spread, inset), and cheap to scroll.
    func foleviSurface(_ fill: SurfaceFill, shape: SurfaceShape, shadow: [FoleviShadowLayer] = [],
                       clipShadowInside: Bool = false, ring: Color? = nil) -> some View {
        background(FoleviSurface(fill: fill, shape: shape, layers: shadow, clipShadowInside: clipShadowInside, ring: ring))
    }

    func foleviSurface(_ color: Color, radius: CGFloat, shadow: [FoleviShadowLayer] = [], ring: Color? = nil) -> some View {
        foleviSurface(.color(color), shape: .rounded(radius), shadow: shadow, ring: ring)
    }

    /// Just the token shadow (no fill) for a rounded shape, e.g. `.foleviShadow(FoleviShadow.card, radius: 16)`.
    func foleviShadow(_ layers: [FoleviShadowLayer], radius: CGFloat) -> some View {
        background(FoleviSurface(fill: .none, shape: .rounded(radius), layers: layers, clipShadowInside: true, ring: nil))
    }

    /// Sunken "well" (search fields, segmented tracks, the sync pill): surfaceSunken + soft inner shadow.
    func foleviWell(shape: SurfaceShape = .capsule) -> some View {
        foleviSurface(.color(FoleviColor.surfaceSunken), shape: shape, shadow: FoleviDepth.well)
    }
}

/// Extra shadow recipes from the web's component CSS (not tokens there either).
enum FoleviDepth {
    /// `.ui-well`: inset 0 1px 2px heading/10%, inset ring heading/7% (dark: black/45%, warm white/6%).
    static let well: [FoleviShadowLayer] = [
        FoleviShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: Color(nsColor: .folevi(
            light: (0.2902, 0.1843, 0.1725, 0.10), dark: (0, 0, 0, 0.45), name: "folevi.well.0")), inset: true),
        FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: Color(nsColor: .folevi(
            light: (0.2902, 0.1843, 0.1725, 0.07), dark: (1.0, 0.9412, 0.902, 0.06), name: "folevi.well.1")), inset: true),
    ]

    /// `.ui-kbd`: ring line + 1px bottom lineStrong.
    static var keycap: [FoleviShadowLayer] {
        [
            FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false),
            FoleviShadowLayer(x: 0, y: 1, blur: 0, spread: 0, color: FoleviColor.lineStrong.opacity(0.5), inset: false),
        ]
    }

    /// Callouts: a subtle inner rim (top highlight + soft inner hairline).
    static var calloutRim: [FoleviShadowLayer] {
        [
            FoleviShadow.card[0],
            FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.heading.opacity(0.06), inset: true),
        ]
    }

    /// A 3pt glow ring around the ember drop line.
    static func halo(_ color: Color, width: CGFloat) -> [FoleviShadowLayer] {
        [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: width, color: color, inset: false)]
    }
}

// MARK: - Implementation

struct FoleviSurface: NSViewRepresentable {
    var fill: SurfaceFill
    var shape: SurfaceShape
    var layers: [FoleviShadowLayer]
    var clipShadowInside: Bool
    var ring: Color?

    func makeNSView(context: Context) -> SurfaceView { SurfaceView() }

    func updateNSView(_ view: SurfaceView, context: Context) {
        let env = context.environment
        func cg(_ c: Color) -> CGColor { c.resolve(in: env).cgColor }
        let increasedContrast = env.colorSchemeContrast == .increased
        var spec = SurfaceView.Spec()
        spec.shape = shape
        switch fill {
        case .none: spec.fill = []
        case .color(let c): spec.fill = [cg(c)]
        case .gradient(let cs): spec.fill = cs.map(cg)
        }
        spec.outer = layers.filter { !$0.inset }.map {
            SurfaceView.Layer(x: $0.x, y: $0.y, blur: $0.blur, spread: $0.spread, color: cg($0.color))
        }
        spec.inner = layers.filter(\.inset).map {
            SurfaceView.Layer(x: $0.x, y: $0.y, blur: $0.blur, spread: $0.spread, color: cg($0.color))
        }
        // Increase Contrast: hairlines become lineStrong rings.
        if increasedContrast && !layers.isEmpty {
            spec.outer.append(SurfaceView.Layer(x: 0, y: 0, blur: 0, spread: 1, color: cg(FoleviColor.lineStrong)))
        }
        if let ring {
            spec.outer.append(SurfaceView.Layer(x: 0, y: 0, blur: 0, spread: 2, color: cg(ring)))
        }
        spec.clipInside = clipShadowInside
        view.spec = spec
    }
}

/// Layer-backed renderer for `FoleviSurface`. Never takes part in hit testing or accessibility.
final class SurfaceView: NSView {
    struct Layer: Equatable {
        var x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat
        var color: CGColor
    }

    struct Spec: Equatable {
        var shape: SurfaceShape = .rounded(0)
        var fill: [CGColor] = []
        var outer: [Layer] = []
        var inner: [Layer] = []
        var clipInside = false
    }

    var spec = Spec() {
        didSet { if spec != oldValue { rebuild() } }
    }

    private let outerContainer = CALayer()
    private let fillLayer = CAShapeLayer()
    private let gradientLayer = CAGradientLayer()
    private let gradientMask = CAShapeLayer()
    private let innerContainer = CALayer()
    private let innerMask = CAShapeLayer()
    private let outerMask = CAShapeLayer()
    private var outerLayers: [CALayer] = []
    private var innerLayers: [CAShapeLayer] = []

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layerContentsRedrawPolicy = .never
        guard let root = layer else { return }
        root.masksToBounds = false
        root.addSublayer(outerContainer)
        root.addSublayer(gradientLayer)
        root.addSublayer(fillLayer)
        root.addSublayer(innerContainer)
        gradientLayer.mask = gradientMask
        innerContainer.mask = innerMask
        fillLayer.fillColor = nil
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func isAccessibilityElement() -> Bool { false }
    override var allowsVibrancy: Bool { false }

    override func layout() {
        super.layout()
        updatePaths()
    }

    private func rebuild() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        outerLayers.forEach { $0.removeFromSuperlayer() }
        outerLayers = spec.outer.map { l in
            let s = CALayer()
            s.shadowColor = l.color
            s.shadowOpacity = 1
            s.shadowRadius = l.blur / 2
            // Non-flipped layer space: CSS "down" is negative y here.
            s.shadowOffset = CGSize(width: l.x, height: -l.y)
            outerContainer.addSublayer(s)
            return s
        }
        innerLayers.forEach { $0.removeFromSuperlayer() }
        innerLayers = spec.inner.map { l in
            let s = CAShapeLayer()
            s.fillRule = .evenOdd
            // Unblurred: paint the rim directly. Blurred: the frame casts a shadow into the hole.
            s.fillColor = l.blur == 0 ? l.color : NSColor.clear.cgColor
            s.shadowColor = l.color
            s.shadowOpacity = l.blur == 0 ? 0 : 1
            s.shadowRadius = l.blur / 2
            s.shadowOffset = .zero
            innerContainer.addSublayer(s)
            return s
        }
        switch spec.fill.count {
        case 0:
            fillLayer.fillColor = nil
            gradientLayer.isHidden = true
        case 1:
            fillLayer.fillColor = spec.fill[0]
            gradientLayer.isHidden = true
        default:
            fillLayer.fillColor = nil
            gradientLayer.isHidden = false
            gradientLayer.colors = spec.fill
            gradientLayer.startPoint = CGPoint(x: 0.5, y: 1)
            gradientLayer.endPoint = CGPoint(x: 0.5, y: 0)
        }
        // CSS never paints an outer box-shadow under the box itself, so a translucent fill (glass) shows what
        // is behind it, not its own shadow: without this mask the tab strip and content panel read grey.
        outerContainer.mask = spec.outer.isEmpty ? nil : outerMask
        CATransaction.commit()
        updatePaths()
    }

    private func updatePaths() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let rect = bounds
        let shapePath = spec.shape.path(in: rect)
        fillLayer.frame = rect
        fillLayer.path = shapePath
        gradientLayer.frame = rect
        gradientMask.frame = rect
        gradientMask.path = shapePath

        outerContainer.frame = rect
        for (layer, l) in zip(outerLayers, spec.outer) {
            layer.frame = rect
            let r = rect.insetBy(dx: -l.spread, dy: -l.spread)
            layer.shadowPath = expanded(shape: spec.shape, rect: r, spread: l.spread)
        }
        if !spec.outer.isEmpty {
            let big = CGMutablePath()
            big.addRect(rect.insetBy(dx: -200, dy: -200))
            big.addPath(shapePath)
            outerMask.frame = rect
            outerMask.fillRule = .evenOdd
            outerMask.path = big
        }

        innerContainer.frame = rect
        innerMask.frame = rect
        innerMask.path = shapePath
        for (layer, l) in zip(innerLayers, spec.inner) {
            layer.frame = rect
            // A frame around the (offset, shrunk) shape: whatever of it falls inside the real shape is
            // the inset shadow — exactly CSS `inset x y blur spread`.
            let hole = rect.offsetBy(dx: l.x, dy: -l.y).insetBy(dx: l.spread, dy: l.spread)
            let frame = CGPath(rect: rect.insetBy(dx: -40, dy: -40), transform: nil)
            let p: CGPath
            if hole.width > 0, hole.height > 0 {
                // A real subtraction, so shadow paths (always non-zero winding) keep the hole open.
                p = frame.subtracting(shrunk(shape: spec.shape, rect: hole, spread: l.spread))
            } else {
                p = frame
            }
            layer.path = p
            if l.blur > 0 { layer.shadowPath = p }
        }
        CATransaction.commit()
    }

    /// Outset corner radius grows with spread (CSS behavior).
    private func expanded(shape: SurfaceShape, rect: CGRect, spread: CGFloat) -> CGPath {
        switch shape {
        case .capsule: return SurfaceShape.capsule.path(in: rect)
        case .rounded(let r): return SurfaceShape.rounded(max(0, r + spread)).path(in: rect)
        }
    }

    private func shrunk(shape: SurfaceShape, rect: CGRect, spread: CGFloat) -> CGPath {
        switch shape {
        case .capsule: return SurfaceShape.capsule.path(in: rect)
        case .rounded(let r): return SurfaceShape.rounded(max(0, r - spread)).path(in: rect)
        }
    }
}
