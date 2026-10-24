// Folevi's mark (packages/design-tokens/brand, public/brand/folevi-mark.svg): the F on a disc. Light: a white F on
// black; dark: a black F on white (logo-dark.svg). Drawn from the brand file's own path, not a font glyph, so the
// gate screens and the first-launch choice show the real mark at any size.
import SwiftUI
import FoleviDesign

/// The F of the mark, in the brand file's 512-unit square.
struct FoleviMarkF: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 512
        let o = CGPoint(x: rect.midX - 256 * s, y: rect.midY - 256 * s)
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: o.x + x * s, y: o.y + y * s) }
        var path = Path()
        path.move(to: p(340.693, 101.605))
        path.addCurve(to: p(357.106, 102.557), control1: p(346.183, 99.1649), control2: p(352.396, 98.8284))
        path.addCurve(to: p(385.593, 132.218), control1: p(366.189, 109.747), control2: p(378.216, 123.222))
        path.addCurve(to: p(390.914, 146.506), control1: p(388.899, 136.25), control2: p(390.65, 141.298))
        path.addCurve(to: p(359.65, 192.879), control1: p(392.366, 175.071), control2: p(392.886, 181.05))
        path.addCurve(to: p(339.153, 201.164), control1: p(353.568, 195.048), control2: p(345.3, 198.687))
        path.addLine(to: p(248.08, 237.879))
        path.addCurve(to: p(180.172, 287.728), control1: p(236.601, 242.521), control2: p(165.863, 266.139))
        path.addCurve(to: p(278.329, 281.246), control1: p(203.823, 289.572), control2: p(278.655, 227.755))
        path.addCurve(to: p(278.036, 349.471), control1: p(278.182, 303.448), control2: p(278.264, 327.191))
        path.addCurve(to: p(273.176, 358.343), control1: p(277.237, 352.437), control2: p(275.573, 356.698))
        path.addCurve(to: p(170.075, 413.849), control1: p(258.647, 368.295), control2: p(180.526, 414.431))
        path.addCurve(to: p(167.526, 366.172), control1: p(166.667, 401.504), control2: p(167.49, 379.362))
        path.addCurve(to: p(167.952, 206.284), control1: p(167.723, 312.918), control2: p(166.944, 259.51))
        path.addCurve(to: p(179.917, 175.079), control1: p(168.123, 197.253), control2: p(171.886, 179.825))
        path.addCurve(to: p(240.694, 146.061), control1: p(198.928, 163.841), control2: p(220.504, 155.067))
        path.closeSubpath()
        return path
    }
}

/// The mark: the disc and its F, inverted in dark mode (or the other way round with `inverse`).
public struct FoleviMark: View {
    @Environment(\.colorScheme) private var scheme
    let size: CGFloat
    let inverse: Bool

    public init(size: CGFloat = 24, inverse: Bool = false) {
        self.size = size
        self.inverse = inverse
    }

    public var body: some View {
        let dark = (scheme == .dark) != inverse
        ZStack {
            Circle().fill(dark ? Color.white : Color.black)
            FoleviMarkF().fill(dark ? Color.black : Color.white)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The mark and the word "Folevi" in Spectral, as the logo reads (the gate screens' header).
public struct FoleviWordmark: View {
    let height: CGFloat
    public init(height: CGFloat = 26) { self.height = height }
    public var body: some View {
        HStack(spacing: height * 0.28) {
            FoleviMark(size: height)
            Text("Folevi")
                .font(FoleviFonts.font(.display, size: height * 1.02, weight: .semibold))
                .foregroundStyle(Folevi.color.heading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Folevi")
    }
}
