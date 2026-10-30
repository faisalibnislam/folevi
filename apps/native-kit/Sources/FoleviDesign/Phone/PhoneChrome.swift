// The iPhone app's floating controls, as the web draws them (apps/web/src/components/iphone/Glass.tsx and
// TabBar.tsx): the round glass button (Back, close), the glass pill of icon buttons, the glass text button
// ("Select", "Done") and the floating tab bar. 44 pt targets; glass swells a little under the finger.
import SwiftUI

/// `.ui-glass-press`: pressed, it swells to 1.07 and brightens 6% (160 ms), springs back on release (380 ms,
/// cubic-bezier(0.34, 1.56, 0.64, 1)).
public struct GlassPressStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 1.07 : 1)
            .brightness(configuration.isPressed ? 0.06 : 0)
            .animation(configuration.isPressed ? .easeOut(duration: 0.16) : .timingCurve(0.34, 1.56, 0.64, 1, duration: 0.38), value: configuration.isPressed)
    }
}

/// GlassCircle: a round glass button (`size` square, 44 by default) in the heading ink.
public struct WebGlassCircle<Label: View>: View {
    let label: String
    let size: CGFloat
    let action: () -> Void
    let content: Label

    public init(_ label: String, size: CGFloat = 44, action: @escaping () -> Void = {}, @ViewBuilder content: () -> Label) {
        self.label = label
        self.size = size
        self.action = action
        self.content = content()
    }

    public var body: some View {
        Button(action: action) {
            content
                .frame(width: size, height: size)
                .foregroundStyle(Folevi.color.heading)
                .liquidGlass()
        }
        .buttonStyle(GlassPressStyle())
        .accessibilityLabel(label)
    }
}

/// GlassPill: a row of glass-backed buttons sharing one capsule, 44 tall, 2 pt in from its ends.
public struct WebGlassPill<Content: View>: View {
    let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: 0) { content }
            .padding(.horizontal, 2)
            .frame(height: 44)
            .liquidGlass()
    }
}

/// PillButton: an icon button inside a GlassPill, 44 by at least 44, 10 pt either side of its icon; `pressed` shows
/// the --liquid-active fill.
public struct WebPillButton<Label: View>: View {
    let label: String
    let pressed: Bool
    let action: () -> Void
    let content: Label
    @Environment(\.colorScheme) private var scheme

    public init(_ label: String, pressed: Bool = false, action: @escaping () -> Void = {}, @ViewBuilder content: () -> Label) {
        self.label = label
        self.pressed = pressed
        self.action = action
        self.content = content()
    }

    public var body: some View {
        Button(action: action) {
            content
                .padding(.horizontal, 10)
                .frame(minWidth: 44, minHeight: 44, maxHeight: 44)
                .foregroundStyle(Folevi.color.heading)
                .background(Capsule().fill(pressed ? LiquidGlassLook.active.resolve(scheme).color : .clear))
        }
        .buttonStyle(GlassPressStyle())
        .accessibilityLabel(label)
    }
}

/// GlassTextButton: a text button in a glass capsule ("Select"), or, `strong`, a dark capsule with the canvas's ink
/// ("Done"): 44 tall, 16 pt either side, Headline at 500 (600 strong).
public struct WebGlassTextButton: View {
    let title: String
    let strong: Bool
    /// Glass with the label at 600 (a note's Done, `.iphone-done`).
    let semibold: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(_ title: String, strong: Bool = false, semibold: Bool = false, action: @escaping () -> Void = {}) {
        self.title = title
        self.strong = strong
        self.semibold = semibold
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            let text = Text(title)
                .webText(.role(.headline, weight: strong || semibold ? FoleviTokens.FontWeight.semibold : FoleviTokens.FontWeight.medium))
                .lineLimit(1)
                .padding(.horizontal, 16)
                .frame(height: 44)
            if strong {
                text
                    .foregroundStyle(FoleviTokens.Chrome.canvas.resolve(scheme).color)
                    .background {
                        WebShapeBox(shape: .capsule, fill: FoleviTokens.Chrome.heading.resolve(scheme).color, shadows: LiquidGlassLook.shadow(scheme))
                    }
            } else {
                text
                    .foregroundStyle(Folevi.color.heading)
                    .liquidGlass()
            }
        }
        .buttonStyle(GlassPressStyle())
    }
}

/// The "+" of the tab bar: a 40 pt disc in the heading colour with a 22 pt plus (2.6 stroke) in the canvas's colour
/// and a small shadow, in a 56 pt target.
public struct PlusDisc: View {
    @Environment(\.colorScheme) private var scheme

    public init() {}

    public var body: some View {
        WebIconView(.plus, size: 22, strokeWidth: 2.6)
            .foregroundStyle(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            .frame(width: 40, height: 40)
            .background {
                WebShapeBox(shape: .capsule, fill: FoleviTokens.Chrome.heading.resolve(scheme).color, shadows: [ShadowLayer(x: 0, y: 2, blur: 6, spread: 0, color: RGBA(0, 0, 0, 0.18))])
            }
    }
}

/// The floating tab bar (TabBar.tsx): Home, Tasks and Calendar in one glass capsule, the current one in a glass
/// lens that slides to the tab picked; Foli AI and + in another. The frame places it over the home indicator and
/// hides it for the keyboard, a note and Select.
public struct PhoneTabBar: View {
    let current: PhoneTab?
    let aiOn: Bool
    let pick: (PhoneTab) -> Void
    let openAI: () -> Void
    /// + tapped, with where it is on the screen (the Create menu grows out of it).
    let plus: (CGRect) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var plusFrame: CGRect = .zero

    public init(current: PhoneTab?, aiOn: Bool = true, pick: @escaping (PhoneTab) -> Void = { _ in }, openAI: @escaping () -> Void = {}, plus: @escaping (CGRect) -> Void = { _ in }) {
        self.current = current
        self.aiOn = aiOn
        self.pick = pick
        self.openAI = openAI
        self.plus = plus
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            tabs
            Spacer(minLength: 0)
            create
        }
        .padding(.horizontal, 16)
    }

    /// The tabs' capsule: 64 tall, 4 pt padding, 64 by 56 tabs 2 pt apart.
    private var tabs: some View {
        HStack(spacing: 2) {
            ForEach(PhoneTab.allCases) { tab in
                let on = tab == current
                Button { pick(tab) } label: {
                    WebIconView(tab.icon, size: tab.iconSize, strokeWidth: PhoneTab.stroke(chosen: on))
                        .foregroundStyle(on ? FoleviTokens.Chrome.heading.resolve(scheme).color : FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                        .frame(width: 64, height: 56)
                }
                .buttonStyle(GlassPressStyle())
                .accessibilityLabel(tab.label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .background(alignment: .topLeading) {
            if let current, let i = PhoneTab.allCases.firstIndex(of: current) {
                // The lens: --liquid-lens with a lit top edge, moved 66 pt a tab on the menu's spring.
                WebShapeBox(shape: .capsule, fill: LiquidGlassLook.lens.resolve(scheme).color, shadows: scheme == .dark
                    ? [ShadowLayer(x: 0, y: 1, blur: 0, spread: 0, color: RGBA(255, 255, 255, 0.14), inset: true), ShadowLayer(x: 0, y: 0, blur: 0, spread: 0.5, color: RGBA(255, 255, 255, 0.08), inset: true)]
                    : [ShadowLayer(x: 0, y: 1, blur: 0, spread: 0, color: RGBA(255, 255, 255, 0.55), inset: true), ShadowLayer(x: 0, y: 0, blur: 0, spread: 0.5, color: RGBA(255, 255, 255, 0.35), inset: true)])
                    .frame(width: 64, height: 56)
                    .offset(x: CGFloat(i) * 66)
                    .animation(.spring(response: 0.38, dampingFraction: 0.78), value: i)
            }
        }
        .padding(4)
        .frame(height: 64)
        .liquidGlass(fill: LiquidGlassLook.tabPillFill)
    }

    /// Foli AI and +, 56 pt targets 4 pt apart.
    private var create: some View {
        HStack(spacing: 4) {
            if aiOn {
                Button(action: openAI) {
                    AiMarkGlyph(size: 26).frame(width: 56, height: 56)
                }
                .buttonStyle(GlassPressStyle())
                .accessibilityLabel("Foli AI")
            }
            Button { plus(plusFrame) } label: {
                PlusDisc().frame(width: 56, height: 56)
            }
            .buttonStyle(GlassPressStyle())
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { plusFrame = $0 }
            .accessibilityLabel(current == .tasks ? "Quick task" : "Create")
        }
        .padding(4)
        .frame(height: 64)
        .liquidGlass(fill: LiquidGlassLook.tabPillFill)
    }
}
