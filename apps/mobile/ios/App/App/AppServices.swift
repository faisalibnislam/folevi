// What the app does for its extensions (the widgets, Siri and Shortcuts, Spotlight, the share sheet) as it comes and
// goes, as the iPhone and iPad app's AppServices did (apps/ios Native/AppServices.swift). With an account: at launch
// it writes where the REST API is to the App Group; when it comes to the front it fetches the share sheet's places,
// the widgets' copy and Spotlight's notes again with this device's token (at most every few minutes), and once more
// when it goes to the background, then the widgets reload. In local mode the page hands them what they show instead
// (apps/ios Native/LocalExtensions.swift, through FoleviNative) and none of this reaches the REST API. Signing out
// clears all of it and turns notifications off on this device.
//
// Not carried over: the background refresh task (BackgroundRefresh.swift); the widgets refresh their own copy on
// their timeline.
import UIKit
import WidgetKit

@MainActor
enum AppServices {
    private static var lastRefresh = Date.distantPast
    private static var refreshing = false

    /// At launch: the REST API's address, from the account service the page signs in to.
    static func launched(serverURL: URL?) {
        if let origin = serverURL.map({ AppOrigin.of($0) }), origin.hasPrefix("http"), let base = URL(string: "\(origin)/api/v1") {
            SharedAccount.apiBase = base
        }
    }

    /// At launch, the mode the app is in. A change of mode leaves nothing of the other one in the widgets, the
    /// share sheet's places or Spotlight; actions queued in local mode wait for it to come back.
    static func modeApplied(local: Bool) {
        guard LocalMode.on != local else { return }
        LocalMode.on = local
        WidgetStore.shared.clear()
        LocalCatalog.clear()
        PlacesCache.save([])
        WidgetCenter.shared.reloadAllTimelines()
        Task { await SpotlightIndex.shared.removeAll() }
        if !local { refresh() }
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
            if !SharedAccount.signedIn || LocalMode.on { WidgetCenter.shared.reloadAllTimelines() }
            done?()
            return
        }
        refreshing = true
        lastRefresh = Date()
        Task {
            if let places = try? await api.places(), !places.isEmpty {
                PlacesCache.save(places)
                if let userId = SaveTargets.userId(of: SaveTargets.current()) { PlacesCache.save(places, userId: userId) }
            }
            await WidgetStore.shared.refresh(api: api)
            WidgetCenter.shared.reloadAllTimelines()
            await SpotlightIndex.shared.update(api: api)
            refreshing = false
            done?()
        }
    }

    /// Another place opened (several places): what the widgets, the share sheet's workspaces and Spotlight showed
    /// was the last place's. Its token and notifications stay: it's still signed in on this device.
    static func placeChanged() {
        WidgetStore.shared.clear()
        PlacesCache.save([])
        WidgetCenter.shared.reloadAllTimelines()
        Task { await SpotlightIndex.shared.removeAll() }
        lastRefresh = .distantPast
    }

    /// Signing out: nothing of the account stays for the widgets, the share sheet or Spotlight. With other accounts
    /// still here (several places) notifications stay on for them.
    static func signedOut(keepNotifications: Bool = false) {
        SharedAccount.forget()
        if !keepNotifications { PushNotifications.shared.disable() }
        WidgetStore.shared.clear()
        PlacesCache.save([])
        WidgetCenter.shared.reloadAllTimelines()
        Task { await SpotlightIndex.shared.removeAll() }
    }
}
