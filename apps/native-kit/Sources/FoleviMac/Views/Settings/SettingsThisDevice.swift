// Settings > This device in the iPad's wide layout (the iPhone's PhoneThisDeviceSettings, PhoneSettings.swift): the
// app lock, kept on this device only, drawn as the Mac's Settings cards (the library's App lock card). The app
// hands the lock in through FrameHost.frameDeviceLock; the Mac has none, so it never lists the section.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign

struct ThisDeviceSettingsView: View {
    let lock: FrameDeviceLock
    @State private var state: (on: Bool, after: Int, method: String)?
    @State private var busy = false

    /// How long Folevi may be in the background before it asks again (LockSettings.choices).
    static let after: [(Int, String)] = [(0, "Immediately"), (60, "After 1 minute"), (300, "After 5 minutes"), (900, "After 15 minutes")]

    /// How the device unlocks, as a sentence says it.
    static func methodName(_ m: String) -> String {
        switch m {
        case "touchID": "Touch ID"
        case "opticID": "Optic ID"
        case "passcode": "your passcode"
        default: "Face ID"
        }
    }

    /// The switch's label: "Lock with Face ID", "Lock with passcode".
    static func label(_ method: String) -> String {
        method == "passcode" ? "Lock with passcode" : "Lock with \(methodName(method))"
    }

    /// The card's words (the iPhone's footer).
    static func description(_ method: String) -> String {
        let name = methodName(method)
        let how = method == "none" ? "Set a passcode for this device in the Settings app first." : "Turning it on asks for \(name) once."
        return "Folevi asks for \(name) when it opens, and hides your notes in the app switcher. This is kept on this device only. \(how)"
    }

    var body: some View {
        let l = state ?? lock.state()
        let label = Self.label(l.method)
        let row = SettingsStyle.pair("lock.row").light
        SettingsCard("Lock", description: Self.description(l.method)) {
            VStack(alignment: .leading, spacing: row.gap) {
                HStack {
                    SText(label, "lock.label")
                    Spacer(minLength: 16)
                    SettingsSwitch(isOn: l.on, label: label, disabled: busy || (l.method == "none" && !l.on)) { on in
                        busy = true
                        await lock.set(on)
                        let now = lock.state()
                        state = now
                        busy = false
                        return now.on == on
                    }
                }
                .frame(height: row.height)
                if l.on {
                    HStack {
                        SText("Ask again when you come back", "lock.label")
                        Spacer(minLength: 12)
                        SettingsSelect(options: Self.after.map { .init(value: String($0.0), label: $0.1) }, value: String(l.after), width: 192) { v in
                            lock.setAfter(Int(v) ?? 0)
                            state = lock.state()
                        }
                    }
                }
            }
        }
        .onAppear { state = lock.state() }
    }
}
#endif
