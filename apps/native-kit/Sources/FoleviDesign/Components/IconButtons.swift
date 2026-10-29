// Icon buttons (30 pt ghost squares with the control radius; 44 pt hit area on touch) and the glass pill
// that groups them, like Home's bell + "..." pill (components/iphone/RootBar.tsx). Every icon button needs a label.
import SwiftUI

public struct IconButton: View {
    let systemName: String
    let label: String
    let badge: Int?
    let action: () -> Void

    /// `systemName` is an SF Symbol; `label` is what VoiceOver reads (and the tooltip on the Mac).
    public init(_ systemName: String, label: String, badge: Int? = nil, action: @escaping () -> Void) {
        self.systemName = systemName
        self.label = label
        self.badge = badge
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .medium))
                .frame(width: 30, height: 30)
                .overlay(alignment: .topTrailing) {
                    if let badge, badge > 0 { Badge(count: badge).offset(x: 6, y: -5) }
                }
        }
        .buttonStyle(IconButtonStyle())
        .accessibilityLabel(badge.map { $0 > 0 ? "\(label), \($0) unread" : label } ?? label)
        .foleviTooltip(label)
    }
}

public struct IconButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Folevi.color.ink)
            .background {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous)
                    .fill(configuration.isPressed ? Folevi.color.accentSoft : .clear)
            }
            .contentShape(Rectangle().inset(by: touchInset))
            .foleviAnimation(FoleviTokens.Motion.fast, value: configuration.isPressed)
    }

    private var touchInset: CGFloat {
        #if os(iOS)
        -7
        #else
        0
        #endif
    }
}

/// A floating glass capsule holding icon buttons (Home's notifications + More). The iPhone app's glass is
/// the one place where fully round shapes are allowed (docs/DESIGN_SYSTEM.md, Corners).
public struct GlassPill<Content: View>: View {
    let content: Content
    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        HStack(spacing: 2) { content }
            .padding(.horizontal, 5)
            .padding(.vertical, 4)
            .foleviGlass(in: Capsule())
    }
}

public extension View {
    /// Frosted glass chrome: a material with the glass tint, a hairline, and a soft drop. Solid under Reduce
    /// Transparency. (iOS 26 and macOS 26 `glassEffect` can replace the material here later, gated.)
    func foleviGlass<S: Shape>(in shape: S) -> some View {
        modifier(GlassModifier(shape: shape))
    }
}

struct GlassModifier<S: Shape>: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let shape: S
    func body(content: Content) -> some View {
        content
            .background {
                if reduceTransparency {
                    shape.fill(Folevi.color.surfaceRaised)
                } else {
                    shape.fill(.ultraThinMaterial).overlay(shape.fill(Folevi.color.glassPanel))
                }
            }
            .overlay(shape.stroke(Folevi.color.glassBorder, lineWidth: 0.75))
            .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
    }
}
