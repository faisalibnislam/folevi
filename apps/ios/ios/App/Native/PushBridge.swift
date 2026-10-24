// FoleviNativePlugin's calls for notifications on this device (bridge.js, lib/nativeApp.ts): what the
// switch in Settings > Notifications shows, turning it on (the permission prompt, then Apple's device token
// for the page to register with Folevi) and off, the app icon's badge, and iOS Settings when notifications
// are turned off there. Like every FoleviNative call, each one checks the page is Folevi's own first.
import UIKit

extension FoleviNativePlugin {
    /// { permission, enabled, asked, token, environment, bundleId }.
    @objc func pushStatus(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            call.resolve(await PushNotifications.shared.status())
        }
    }

    /// Asks iOS the first time (later: iOS remembers the answer), then registers with Apple.
    @objc func enablePush(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            call.resolve(await PushNotifications.shared.enable())
        }
    }

    @objc func disablePush(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            PushNotifications.shared.disable()
            call.resolve()
        }
    }

    /// { count }: what's unread in the bell, on the app icon.
    @objc func setBadge(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            PushNotifications.shared.setBadge(min(max(call.getInt("count") ?? 0, 0), 99_999))
            call.resolve()
        }
    }

    /// Folevi's page in iOS Settings > Notifications (where notifications turned off in iOS come back on).
    @objc func openNotificationSettings(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return call.reject("Can't open Settings") }
            UIApplication.shared.open(url)
            call.resolve()
        }
    }
}
