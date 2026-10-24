// The Face ID / Touch ID lock's settings (web parity: settings/TouchIdCard.tsx and the iOS app's Privacy rows).
// The lock itself, its cover and unlocking stay in the hosts (apps/ios App/AppLock.swift, apps/mac
// Services/MacAppLock.swift: they already drop what's on screen and cover the window, plan 3.7); Settings reads and
// changes it through this protocol. It's kept on the device, never on Folevi's servers.
import Foundation

@MainActor
public protocol AppLockSettings: AnyObject {
    /// What unlocks this device: "faceID", "touchID", "opticID", "passcode", or "none" (no passcode: no lock).
    var method: String { get }
    var enabled: Bool { get }
    /// Seconds in the background before the app asks again (0: right away).
    var after: Int { get }
    /// Turns the lock on or off; turning it off asks for Face ID / Touch ID first (false: not changed).
    func setEnabled(_ on: Bool) async -> Bool
    func setAfter(_ seconds: Int)
}

public enum AppLockWords {
    /// The choices for "Ask after", as the iOS app offers them.
    public static let afterChoices: [Int] = [0, 60, 300, 900]

    /// "Face ID", "Touch ID", "Optic ID", "Passcode".
    public static func methodName(_ method: String) -> String {
        switch method {
        case "faceID": "Face ID"
        case "touchID": "Touch ID"
        case "opticID": "Optic ID"
        case "passcode": "Passcode"
        default: "Screen lock"
        }
    }

    /// "Lock with Face ID".
    public static func toggleLabel(_ method: String) -> String {
        method == "passcode" ? "Lock with passcode" : "Lock with \(methodName(method))"
    }

    public static func afterLabel(_ seconds: Int) -> String {
        switch seconds {
        case 0: "Right away"
        case 60: "After 1 minute"
        default: "After \(seconds / 60) minutes"
        }
    }
}

/// A lock answered from Swift (tests, previews).
@MainActor
public final class ScriptedAppLock: AppLockSettings {
    public var method: String
    public var enabled: Bool
    public var after: Int
    public var allow = true

    public init(method: String = "faceID", enabled: Bool = false, after: Int = 0) {
        self.method = method
        self.enabled = enabled
        self.after = after
    }

    public func setEnabled(_ on: Bool) async -> Bool {
        guard allow, method != "none" else { return false }
        enabled = on
        return true
    }

    public func setAfter(_ seconds: Int) { after = seconds }
}
