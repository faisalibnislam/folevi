// What the app does for its extensions as it comes and goes: on launch it writes where the REST API is (the
// site it loads, capacitor.config.ts server.url) to the App Group; when it comes to the front it refreshes
// the share sheet's places, the widgets' copy and Spotlight (at most every few minutes); when it goes to the
// background it refreshes them once more and reloads the widgets. Signing out clears all of it
// (FoleviNativePlugin.clearCredential).
import CoreSpotlight
import UIKit
import WidgetKit

@MainActor
enum AppServices {
    private static var lastRefresh = Date.distantPast
    private static var refreshing = false

    /// At launch: the API's address, from the site the app loads.
    static func launched(serverURL: URL?) {
        if let origin = serverURL.map({ AppOrigin.of($0) }), !origin.isEmpty, let base = URL(string: "\(origin)/api/v1") {
            SharedAccount.apiBase = base
        }
    }

    static func becameActive() {
        DeepLinkRouter.openPending()
        guard Date().timeIntervalSince(lastRefresh) > 5 * 60 else { return }
        refresh()
    }

    /// Leaving the screen: one more refresh (with the time iOS gives a backgrounded app), then the widgets reload.
    static func enteredBackground() {
        final class Holder: @unchecked Sendable { var task = UIBackgroundTaskIdentifier.invalid }
        let holder = Holder()
        let end: @MainActor @Sendable () -> Void = {
            guard holder.task != .invalid else { return }
            UIApplication.shared.endBackgroundTask(holder.task)
            holder.task = .invalid
        }
        holder.task = UIApplication.shared.beginBackgroundTask(withName: "Folevi widgets", expirationHandler: end)
        refresh(then: end)
    }

    /// The widgets' tasks and notes, the share sheet's places and Spotlight's notes, fetched again.
    static func refresh(then done: (() -> Void)? = nil) {
        guard !refreshing, let api = SharedAccount.api() else {
            if !SharedAccount.signedIn { WidgetCenter.shared.reloadAllTimelines() }
            done?()
            return
        }
        refreshing = true
        lastRefresh = Date()
        Task {
            if let places = try? await api.places(), !places.isEmpty { PlacesCache.save(places) }
            await WidgetStore.shared.refresh(api: api)
            WidgetCenter.shared.reloadAllTimelines()
            await SpotlightIndex.shared.update(api: api)
            refreshing = false
            done?()
        }
    }

    /// Signing out: nothing of the account stays for the widgets, the share sheet or Spotlight.
    static func signedOut() {
        SharedAccount.forget()
        WidgetStore.shared.clear()
        PlacesCache.save([])
        WidgetCenter.shared.reloadAllTimelines()
        Task { await SpotlightIndex.shared.removeAll() }
    }
}
