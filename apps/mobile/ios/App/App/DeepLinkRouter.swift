// Every way into the app lands here and goes to the page as a folevi:// link (the "App" plugin's "appUrlOpen" event,
// which bridge/mobile-bridge.js hands to foleviNative.onCommand and the page reads with lib/deepLink.ts): links from
// other apps, universal links to app.folevi.com, notifications and Handoff of a Folevi page. Links that arrive
// before the page's bridge is up (a cold launch) wait here until it says it's ready.
import CoreSpotlight
import UIKit

@MainActor
enum DeepLinkRouter {
    private static var ready = false
    private static var waiting: [URL] = []

    static func open(_ url: URL) {
        // A universal link (https://app.folevi.com/...) becomes the folevi:// link for the same page.
        let incoming = url.scheme?.lowercased() == "https" ? (DeepLink.fromWeb(url) ?? url) : url
        // A link for another of this device's places: that place opens first, then the link opens in it.
        let (place, link) = DeepLink.place(of: incoming)
        if let place, ShellPlaces.has(place), place != ShellPlaces.state.current {
            guard DeepLink.parse(link.absoluteString) != nil else { return }
            ShellPlaces.setCurrent(place)
            FoleviViewController.startPath = DeepLink.path(of: link)
            ready = false
            FoleviViewController.restart()
            return
        }
        guard DeepLink.parse(link.absoluteString) != nil else { return }
        guard ready, let host = WebHost.current else { return waiting.append(link) }
        host.emit("App", "appUrlOpen", ["url": link.absoluteString])
    }

    /// The page's bridge is up: links that came early go now, then any an extension left behind.
    static func bridgeReady() {
        ready = true
        let early = waiting
        waiting = []
        early.forEach(open)
        if let url = PendingLink.take() { open(url) }
    }

    /// The page is going away (a mode or place switch): links wait for the next one.
    static func pageLeft() { ready = false }

    /// The folevi:// link an activity stands for: a Spotlight result, or a Folevi page handed off. Nil otherwise.
    static func link(for activity: NSUserActivity) -> URL? {
        if activity.activityType == CSSearchableItemActionType, let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            return DeepLink.forNote(id)
        }
        if activity.activityType == NSUserActivityTypeBrowsingWeb, let web = activity.webpageURL { return DeepLink.fromWeb(web) }
        return nil
    }
}
