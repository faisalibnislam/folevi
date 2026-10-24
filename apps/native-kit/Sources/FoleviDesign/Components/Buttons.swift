// Buttons (docs/DESIGN_SYSTEM.md "Buttons"): primary (solid accent, faint top highlight and soft cast),
// secondary (raised surface with the control shadow), ghost (text, soft hover), destructive. Heights 28 / 34 / 40;
// on touch the hit area is at least 44 pt. Pressed: primary 4% darker, secondary sunken.
import SwiftUI

public enum FoleviButtonKind: Sendable { case primary, secondary, ghost, destructive }
public enum FoleviButtonSize: Sendable {
    case small, medium, large
    var height: CGFloat { switch self { case .small: 28; case .medium: 34; case .large: 40 } }
    var padding: CGFloat { switch self { case .small: 10; case .medium: 14; case .large: 18 } }
    var text: FoleviTextStyle { self == .small ? .caption : .button }
}

public struct FoleviButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorScheme) private var scheme
    let kind: FoleviButtonKind
    let size: FoleviButtonSize
    let fullWidth: Bool

    public init(_ kind: FoleviButtonKind = .primary, size: FoleviButtonSize = .medium, fullWidth: Bool = false) {
        self.kind = kind
        self.size = size
        self.fullWidth = fullWidth
    }

    public func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let radius = FoleviTokens.Radius.control
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return configuration.label
            .foleviFont(size.text)
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, size.padding)
            .frame(minHeight: size.height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background { background(pressed: pressed).clipShape(shape) }
            .modifier(ButtonDepth(kind: kind, radius: radius))
            .contentShape(Rectangle().inset(by: -max(0, (minTouch - size.height) / 2)))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(pressed && kind != .ghost ? 0.985 : 1)
            .foleviAnimation(FoleviTokens.Motion.fast, value: pressed)
    }

    private var minTouch: CGFloat {
        #if os(iOS)
        44
        #else
        0
        #endif
    }

    private var foreground: Color {
        switch kind {
        case .primary: Folevi.color.accentInk
        case .secondary, .ghost: Folevi.color.ink
        case .destructive: Folevi.color.destructive
        }
    }

    @ViewBuilder private func background(pressed: Bool) -> some View {
        let c = FoleviTokens.Chrome.self
        switch kind {
        case .primary:
            let base = c.accent.resolve(scheme)
            let top = base.mix(RGBA(255, 255, 255), 0.96)
            let pressedBase = base.mix(RGBA(0, 0, 0), 0.96)
            LinearGradient(colors: pressed ? [pressedBase.color, pressedBase.color] : [top.color, base.color], startPoint: .top, endPoint: .bottom)
        case .secondary:
            // Raised surface with a hint of the sunken tone at the bottom; pressed = sunken.
            ZStack {
                c.surfaceRaised.color
                if pressed {
                    c.surfaceSunken.color
                } else {
                    LinearGradient(colors: [.clear, c.surfaceSunken.resolve(scheme).opacity(0.5).color], startPoint: .center, endPoint: .bottom)
                }
            }
        case .ghost:
            pressed ? c.accentSoft.color : Color.clear
        case .destructive:
            pressed ? c.destructiveSoft.color : c.surfaceRaised.color
        }
    }
}

private struct ButtonDepth: ViewModifier {
    let kind: FoleviButtonKind
    let radius: CGFloat
    func body(content: Content) -> some View {
        switch kind {
        case .primary: content.foleviShadow(.primary, radius: radius)
        case .secondary, .destructive: content.foleviShadow(.control, radius: radius)
        case .ghost: content
        }
    }
}

public extension ButtonStyle where Self == FoleviButtonStyle {
    static var foleviPrimary: FoleviButtonStyle { FoleviButtonStyle(.primary) }
    static var foleviSecondary: FoleviButtonStyle { FoleviButtonStyle(.secondary) }
    static var foleviGhost: FoleviButtonStyle { FoleviButtonStyle(.ghost) }
    static var foleviDestructive: FoleviButtonStyle { FoleviButtonStyle(.destructive) }
    static func folevi(_ kind: FoleviButtonKind, size: FoleviButtonSize = .medium, fullWidth: Bool = false) -> FoleviButtonStyle {
        FoleviButtonStyle(kind, size: size, fullWidth: fullWidth)
    }
}
