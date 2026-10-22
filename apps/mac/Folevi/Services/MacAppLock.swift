// The app lock on the Mac (docs/MAC_WEBKIT_PLAN.md §4.2 and §5.1, Electron's lock.ts): Touch ID or the Mac's
// password before encrypted notes open (E2eeKeys calls AppLock.confirm), and later the cover over every window
// at launch, on screen lock and sleep, and after the "away" time.
//
// WM1 owns this file and builds the cover and the settings. WM0 gives the shared E2eeKeys what it calls:
// confirm(reason:), with the same meaning as on iOS (a yes within 30 seconds covers windows opening together).
import Foundation
import LocalAuthentication

enum AppLock {
    private static var lastYes: Date?

    /// Asks for Touch ID (or the Mac's password); true when the person confirmed.
    @MainActor
    static func confirm(reason: String) async -> Bool {
        if let lastYes, Date().timeIntervalSince(lastYes) < 30 { return true }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        let ok = (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
        if ok { lastYes = Date() }
        return ok
    }
}
