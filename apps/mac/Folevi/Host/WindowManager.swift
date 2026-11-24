// Every page the app made and the pages that serve its windows. The shared Places.swift asks this for the pages to
// load again in another place (`mains`), every view for events (`allViews`), and what a new page starts with
// (`bootstrapOf`). The app's windows are SwiftUI scenes: they hold no page of their own; the place's engine page
// and the editor pool (Engine/Pages.swift) serve them all.
import AppKit
import WebKit

/// A page that serves windows and loads again when the place or mode changes.
@MainActor
protocol PageHost: AnyObject {
    var view: FoleviWebView { get }
    /// The page again from a fresh bootstrap in `place` (when given), at `path`.
    func rebuild(place: String??, path: String)
}

@MainActor
final class WindowManager {
    static let shared = WindowManager()

    private let views = NSHashTable<FoleviWebView>.weakObjects()
    private let hosts = NSHashTable<AnyObject>.weakObjects()

    /// Every live web view (events, Spotlight's place checks).
    var allViews: [FoleviWebView] { views.allObjects }

    /// The pages that serve windows (the engine page and the editors), for Places' switch.
    var mains: [any PageHost] { hosts.allObjects.compactMap { $0 as? any PageHost } }

    /// The open place (Places sets it at launch).
    var currentPlace: () -> String? = { ShellPlaces.state.current }

    /// A place's mode, "local" or "account" (Places sets it at launch).
    var modeOf: (String?) -> String = { _ in ShellMode.current }

    /// What a new page in `place` starts with.
    var bootstrapOf: (String?, ViewRole) -> Bootstrap = { place, role in
        Bootstrap(mode: WindowManager.shared.modeOf(place), place: place, background: role == .runner)
    }

    /// The page of the front window (its note's editor, else the place's engine page) and that window.
    struct Front {
        let view: FoleviWebView
        let window: NSWindow?
    }

    /// Set by the app model.
    var front: () -> Front? = { nil }
    var showWindow: () -> Void = {}

    var frontMain: Front? { front() }

    func showMain() { showWindow() }

    func register(_ view: FoleviWebView) { views.add(view) }

    func register(host: any PageHost) { hosts.add(host) }

    func unregister(host: any PageHost) { hosts.remove(host) }
}
