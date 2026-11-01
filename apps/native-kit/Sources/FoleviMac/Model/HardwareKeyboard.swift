// Whether a hardware keyboard is attached: always on a Mac; on an iPad, a Magic Keyboard, Smart Keyboard or a
// Bluetooth one (GameController's GCKeyboard). Keyboard hints (⌘K) show only with one, and a screen puts the cursor
// in its field by itself only with one: without it the on-screen keyboard would cover half the screen before the
// person chose to type.
import Foundation
import Observation
#if os(iOS)
import GameController
#endif

@MainActor
@Observable
public final class HardwareKeyboard {
    public static let shared = HardwareKeyboard()

    public private(set) var connected: Bool

    private init() {
        #if os(iOS)
        connected = GCKeyboard.coalesced != nil
        let center = NotificationCenter.default
        center.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { HardwareKeyboard.shared.connected = true }
        }
        center.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { HardwareKeyboard.shared.connected = GCKeyboard.coalesced != nil }
        }
        #else
        connected = true
        #endif
    }
}
