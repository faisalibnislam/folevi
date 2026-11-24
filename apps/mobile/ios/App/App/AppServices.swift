// What the iPhone and iPad app's AppServices did around the page, for this app: the share extension's places come
// from the page (the shared PlacesCache), and there are no widgets or Spotlight entries yet (docs/MOBILE.md, "Not
// carried over yet"). The shared plugins call these at the same moments as before; most have nothing to do here.
import UIKit
import WidgetKit

enum AppServices {
    static func launched(serverURL: URL?) {}

    /// A switch of mode: nothing of the other one stays for the widgets.
    static func modeApplied(local: Bool) {
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func refresh(then done: (() -> Void)? = nil) { done?() }

    static func placeChanged() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func signedOut(keepNotifications: Bool = false) {
        if !keepNotifications { Task { @MainActor in PushNotifications.shared.disable() } }
        WidgetCenter.shared.reloadAllTimelines()
    }
}
