// Every way into the app lands here and goes to the page as a folevi:// link, through Capacitor's App
// plugin (appUrlOpen, which the page reads with lib/deepLink.ts): links from other apps and widgets
// (openURLContexts), App Intents (PendingLink), Spotlight results (CSSearchableItemActionType) and Handoff of
// a Folevi page. Links that arrive before the web view and its plugins exist (a cold launch) wait here until
// FoleviViewController says it's ready; the App plugin then keeps them until the page listens.
import Capacitor
import CoreSpotlight
import UIKit

@MainActor
enum DeepLinkRouter {
    private static var ready = false
    private static var waiting: [URL] = []

    /// Opens a folevi:// link in the page (now, or once the web view is ready).
    static func open(_ url: URL) {
        // A link for another of this device's places (a widget's or an intent's Save to): that place opens first,
        // then the link opens in it (the new page's bridge says when it's ready).
        let (place, link) = DeepLink.place(of: url)
        if let place, ShellPlaces.has(place), place != ShellPlaces.state.current {
            guard DeepLink.parse(link.absoluteString) != nil else { return }
            ShellPlaces.setCurrent(place)
            ready = false
            waiting.append(link)
            FoleviViewController.restart()
            return
        }
        let url = link
        guard DeepLink.parse(url.absoluteString) != nil else { return }
        guard ready else { return waiting.append(url) }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    /// The web view and its plugins exist: links that came early go now, then any an intent left behind.
    static func bridgeReady() {
        ready = true
        let early = waiting
        waiting = []
        early.forEach(open)
        openPending()
    }

    /// A link an App Intent left in the App Group (it ran before the app was up, or in an extension).
    static func openPending() {
        if let url = PendingLink.take() { open(url) }
    }

    /// The folevi:// link an activity stands for: a Spotlight result (its id is the note's), or a Folevi page
    /// handed off from another device. Nil for anything else.
    static func link(for activity: NSUserActivity) -> URL? {
        if activity.activityType == CSSearchableItemActionType, let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            return DeepLink.forNote(id)
        }
        if activity.activityType == NSUserActivityTypeBrowsingWeb, let web = activity.webpageURL { return DeepLink.fromWeb(web) }
        return nil
    }
}
