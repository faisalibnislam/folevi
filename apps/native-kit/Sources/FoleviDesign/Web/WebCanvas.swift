// The app's canvas as the web draws it (.ui-canvas and .ui-canvas::before in globals.css): --glass-canvas under
// three soft radial lights sized to the window (70vw x 60vh at 85% -10%, 60vw x 70vh at -10% 110%, 50vw x 50vh at
// the centre), each fading to transparent at 70% (75% for the centre one). The window's background in the
// native frame; the sidebar and the content card float over it.
import SwiftUI

public struct WebCanvas: View {
    @Environment(\.colorScheme) private var scheme

    public init() {}

    /// One CSS `radial-gradient(<w> <h> at <x> <y>, <color>, transparent <stop>)`: sizes in fractions of the
    /// viewport, position in fractions.
    struct Light {
        let w: CGFloat, h: CGFloat, x: CGFloat, y: CGFloat
        let color: ColorPair
        let stop: CGFloat
    }

    static let lights = [
        Light(w: 0.7, h: 0.6, x: 0.85, y: -0.10, color: FoleviTokens.Glass.lightA, stop: 0.70),
        Light(w: 0.6, h: 0.7, x: -0.10, y: 1.10, color: FoleviTokens.Glass.lightB, stop: 0.70),
        Light(w: 0.5, h: 0.5, x: 0.50, y: 0.50, color: FoleviTokens.Glass.lightC, stop: 0.75),
    ]

    public var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(FoleviTokens.Glass.canvas.resolve(scheme).color))
            // The first gradient listed is on top (CSS backgrounds paint last to first).
            for light in Self.lights.reversed() {
                let c = light.color.resolve(scheme)
                let rx = light.w * size.width, ry = light.h * size.height
                guard rx > 0, ry > 0 else { continue }
                let center = CGPoint(x: light.x * size.width, y: light.y * size.height)
                // A circle of radius rx, squashed to the ellipse: CSS interpolates to a transparent of the same colour.
                var layer = ctx
                layer.translateBy(x: center.x, y: center.y)
                layer.scaleBy(x: 1, y: ry / rx)
                let gradient = Gradient(stops: [
                    .init(color: c.color, location: 0),
                    .init(color: RGBA(c.r, c.g, c.b, 0).color, location: light.stop),
                ])
                let reach = max(size.width, size.height) * 4
                layer.fill(Path(CGRect(x: -reach, y: -reach * rx / ry, width: reach * 2, height: reach * 2 * rx / ry)), with: .radialGradient(gradient, center: .zero, startRadius: 0, endRadius: rx))
            }
        }
        .ignoresSafeArea()
    }
}
