import SwiftUI

/// An on/off switch in the app's neutral chrome, as the web's Switch: 40 by 24, dark when on, a white
/// 20 pt knob with a soft shadow. Never the OS toggle. Labelled for VoiceOver, with an optional hint.
struct FoleviToggleSwitch: View {
    @Binding var isOn: Bool
    var label: String
    var hint: String? = nil
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule()
                    .fill(isOn ? FoleviColor.heading : FoleviColor.ink.opacity(0.22))
                Circle()
                    .fill(Color.white)
                    .frame(width: 20, height: 20)
                    .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
                    .padding(2)
            }
            .frame(width: 40, height: 24)
            .contentShape(Capsule())
            .opacity(isEnabled ? 1 : 0.5)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: isOn)
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityElement()
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(isOn ? String(localized: "On") : String(localized: "Off")))
        .accessibilityHint(hint.map { Text($0) } ?? Text(""))
        .accessibilityAddTraits(.isToggle)
        .accessibilityAction { isOn.toggle() }
    }
}
