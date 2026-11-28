import SwiftUI
import AppKit

/// Every animation in Notlet goes through here, so Reduce Motion and Settings ▸ "Animate
/// popover" switch them all off in one place (cross-fades replace morphs).
@MainActor
enum Motion {
    /// Set by AppModel from Settings ▸ General ▸ Animate popover.
    static var animationsEnabledSetting = true

    static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || A11yOverrides.reduceMotion }
    static var isEnabled: Bool { animationsEnabledSetting && !reduceMotion }

    static let dotSwitchDuration: TimeInterval = 0.12
    static let openResponse = 0.32
    static let openDamping = 0.86
    static let closeDuration: TimeInterval = 0.18

    /// Spring for the active-dot ring, hover growth and glass morphs; a fade under Reduce Motion.
    static var spring: Animation? {
        isEnabled ? .spring(response: 0.32, dampingFraction: 0.82) : .easeInOut(duration: 0.12)
    }

    static var quick: Animation? { isEnabled ? .easeOut(duration: 0.12) : nil }
    static var fade: Animation { .easeInOut(duration: isEnabled ? 0.18 : 0.1) }

    static func animate(_ animation: Animation? = spring, _ body: () -> Void) {
        if let animation { withAnimation(animation, body) } else { body() }
    }
}
