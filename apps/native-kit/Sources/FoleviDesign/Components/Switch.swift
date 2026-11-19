// Folevi's on/off switch, the one the web draws (ui/Switch.tsx) on every platform: a 40 by 24 rounded rectangle
// (the chip radius) in the app's neutral chrome, dark when on, with a 20 pt rounded-square knob that slides 16 pt.
// Not iOS's or macOS's round switch (the owner, 2026-11-01): the iPhone, the iPad and the Mac match the web.
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public struct FoleviSwitch: View {
    let label: String
    let on: Bool
    let disabled: Bool
    let change: (Bool) -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.nativeChrome) private var chrome

    public init(_ label: String, on: Bool, disabled: Bool = false, change: @escaping (Bool) -> Void) {
        self.label = label
        self.on = on
        self.disabled = disabled
        self.change = change
    }

    public var body: some View {
        #if os(iOS)
        if let chrome, chrome.dynamicType {
            // The iPhone's native look: iOS's own switch, on in Folevi's accent.
            Toggle(label, isOn: Binding(get: { on }, set: { change($0) }))
                .labelsHidden()
                .tint(FoleviSwitchTint.on)
                .disabled(disabled)
        } else {
            drawn
        }
        #else
        drawn
        #endif
    }

    private var drawn: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        return Button {
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

/// The "on" colour of the system's switch in the native look (the owner, 2026-11-19). The switch's knob is always
/// white, so Folevi's accent can't fill the track in dark mode: #F2F2F3 under a white knob doesn't read as on. Light
/// keeps the accent (#1F1F22, the knob at 16:1). Dark is graphite, as macOS draws a switch with its Graphite accent:
/// #8C8C90, the knob at 3.3:1 on it and the track far from the off track's dark grey, still black and white.
public enum FoleviSwitchTint {
    static let lightOn = (r: 0x1F, g: 0x1F, b: 0x22)
    static let darkOn = (r: 0x8C, g: 0x8C, b: 0x90)

    #if canImport(UIKit)
    public static let on = Color(uiColor: UIColor { t in
        let c = t.userInterfaceStyle == .dark ? darkOn : lightOn
        return UIColor(red: CGFloat(c.r) / 255, green: CGFloat(c.g) / 255, blue: CGFloat(c.b) / 255, alpha: 1)
    })
    #elseif canImport(AppKit)
    public static let on = Color(nsColor: NSColor(name: "FoleviSwitchOn") { appearance in
        let c = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? darkOn : lightOn
        return NSColor(srgbRed: CGFloat(c.r) / 255, green: CGFloat(c.g) / 255, blue: CGFloat(c.b) / 255, alpha: 1)
    })
    #endif
}

/// The system's switch in `FoleviSwitchTint.on`, for every plain `Toggle` under it (set by the native look's root).
/// A toggle with its own style (Folevi's checkbox, `.folevi`) keeps that style.
public struct NativeSwitchStyle: ToggleStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        Toggle(configuration)
            .toggleStyle(.switch)
            .tint(FoleviSwitchTint.on)
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
