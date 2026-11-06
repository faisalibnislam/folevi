// Folevi's on/off switch, the one the web draws (ui/Switch.tsx) on every platform: a 40 by 24 rounded rectangle
// (the chip radius) in the app's neutral chrome, dark when on, with a 20 pt rounded-square knob that slides 16 pt.
// Not iOS's or macOS's round switch (the owner, 2026-11-01): the iPhone, the iPad and the Mac match the web.
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct FoleviSwitch: View {
    let label: String
    let on: Bool
    let disabled: Bool
    let change: (Bool) -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(_ label: String, on: Bool, disabled: Bool = false, change: @escaping (Bool) -> Void) {
        self.label = label
        self.on = on
        self.disabled = disabled
        self.change = change
    }

    public var body: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        Button {
            #if canImport(UIKit)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            #endif
            change(!on)
        } label: {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous)
                    .fill(on ? FoleviTokens.Chrome.heading.resolve(scheme).color : ink.color.opacity(0.22))
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous)
                    .fill(on ? FoleviTokens.Chrome.canvas.resolve(scheme).color : .white)
                    .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
                    .frame(width: 20, height: 20)
                    .offset(x: on ? 18 : 2)
            }
            .frame(width: 40, height: 24)
            .webHover(radius: FoleviTokens.Radius.chip)
            .animation(reduceMotion ? .easeOut(duration: 0.12) : FoleviSpring.press, value: on)
            // The touch target reaches 44 tall on a touch screen; the switch is drawn the web's size.
            #if os(iOS)
            .frame(height: 44)
            #endif
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain) // (hover: on the track, above)
        .disabled(disabled)
        .opacity(disabled || !enabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
    }
}

/// A SwiftUI `Toggle` drawn as Folevi's switch: `.toggleStyle(.folevi)`.
public struct FoleviSwitchToggleStyle: ToggleStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        HStack {
            configuration.label
            Spacer(minLength: 8)
            FoleviSwitch("", on: configuration.isOn) { configuration.isOn = $0 }
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(configuration.isOn ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
        .accessibilityAction { configuration.isOn.toggle() }
    }
}

public extension ToggleStyle where Self == FoleviSwitchToggleStyle {
    static var folevi: FoleviSwitchToggleStyle { FoleviSwitchToggleStyle() }
}
