// The Mac chrome (docs/MAC_WEBKIT_PLAN.md §10 WM2, docs/MAC_POLISH_PLAN.md §3): the menu bar, the title bar and
// window buttons, restoring windows, Quick Add's panel and shortcut, the menu bar icon, the Dock, the Settings
// window and notifications. `install()` wires them into WM0's hooks before launch finishes; what the pages tell the
// app about themselves (menu state, badge, recent notes, the save state) is kept here per view.
import AppKit
import WebKit

/// What a page said about itself (foleviDesktop.setMenuState and friends).
struct PageState {
    /// Menu commands it can't do right now (the items show disabled).
    var disabled: Set<String> = []
    /// Menu commands shown checked (As Cards, the note starred).
    var checked: Set<String> = []
    /// Whether Foli AI is on (Ask Foli AI is hidden when it's off), nil until the page says.
    var ai: Bool?
    var sidebar: Bool?
    var inspector: Bool?
    var focus: Bool?
    /// The page has its own find bar (else Find uses the system's).
    var find = false
    /// The note in front is locked (Lock or Unlock's title).
    var locked: Bool?
    /// The route's name ("doc", "documents", "settings", ...).
    var route: String?
    /// Whether the page has ever said (an old page never does, and then every command stays on).
    var reported = false
}

@MainActor
enum Chrome {
    /// Per view (ObjectIdentifier of its FoleviWebView).
    static var states: [ObjectIdentifier: PageState] = [:]
    /// The Dock badge per place ("" for a view without one).
    static var badges: [String: Int] = [:]
    /// The menu bar icon's and the Dock's recent notes, newest first.
    static var recent: [(id: String, title: String, place: String?)] = []
    /// The save state ("All changes saved").
    static var status = ""

    /// Checks for updates (WM3's Sparkle sets it; the item is off until then).
    static var checkForUpdates: (() -> Void)?
    /// Says whether an update is ready ("Restart to Update"); WM3.
    static var updateTitle: (() -> String?)?
    /// Print (WM5 may replace it with the note's print layout); by default the page's own print.
    static var print: ((FoleviWebView) -> Void)?
    /// File > Share's services for the key window's note (WM5's ChromeHooks); hidden while nil.
    static var shareItems: ((FoleviWebView) -> [NSMenuItem])?

    static func install() {
        AppDelegate.buildMenu = { MainMenu.shared.build() }
        WebViewFactory.extraScripts.append("chrome-page")
        WindowManager.shared.quickAdd = { QuickAddPanel.shared.toggle() }
        WindowManager.viewMade.append { TitleBar.adopt($0) }
        WindowManager.shared.shouldClose = { WindowRestore.shouldClose($0) }
        WindowManager.shared.openFirst = { WindowRestore.openFirstWindows() }
        AppDelegate.beforeFirstWindow.insert({
            Notifications.shared.install()
            applySettings(DesktopSettings.current, previous: nil)
            WindowRestore.install()
            TitleBar.install()
            return true
        }, at: 0)
        HotKey.shared.action = { QuickAddPanel.shared.toggle() }
        // Updates (WM3's Sparkle): the Folevi menu's item says what Updater says; off (hidden) in Debug builds.
        checkForUpdates = { Updater.shared.menuAction() }
        updateTitle = { Updater.shared.menuTitle }
        let nc = NotificationCenter.default
        nc.addObserver(forName: Updater.changed, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { MainMenu.shared.refreshUpdates() }
        }
        // Another place opened (WM1): its recent notes and save state come from its pages; the menus start over.
        nc.addObserver(forName: Places.switched, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                Chrome.recent = []
                Chrome.status = ""
                Chrome.refresh()
                QuickAddPanel.shared.placeChanged()
            }
        }
        nc.addObserver(forName: Places.quickAddChanged, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { QuickAddPanel.shared.placeChanged() }
        }
        #if DEBUG
        ChromeEval.install()
        #endif
    }

    // MARK: settings

    /// The last shortcut that couldn't be registered (Settings shows it).
    static var shortcutError: String?

    /// Applies settings that changed (all of them at launch). The login item is only touched on a change.
    static func applySettings(_ next: DesktopSettings, previous: DesktopSettings?) {
        if previous == nil || next.quickAddShortcut != previous?.quickAddShortcut {
            shortcutError = HotKey.shared.register(next.quickAddShortcut)
            if shortcutError != nil, let previous {
                // Keep the one that worked.
                var kept = next
                kept.quickAddShortcut = previous.quickAddShortcut
                HotKey.shared.register(previous.quickAddShortcut)
                DesktopSettings.current = kept
                refresh()
                return
            }
        }
        if let previous, next.openAtLogin != previous.openAtLogin { LoginItem.apply(next.openAtLogin) }
        DesktopSettings.current = next
        refresh()
    }

    /// The menu bar icon and the menus again (settings, recent notes, the save state, places changed).
    static func refresh() {
        StatusItem.shared.update()
        MainMenu.shared.refreshShortcuts()
        updateBadge()
    }

    /// The open place's count and every other place's (a place no page reports for counts its last known unread,
    /// from places.describe), as Electron's updateDock.
    static func updateBadge() {
        let others = ShellPlaces.state.accounts.filter { badges[$0.id] == nil }.reduce(0) { $0 + $1.unread }
        let n = badges.values.reduce(0, +) + others
        NSApp.dockTile.badgeLabel = n == 0 ? nil : n > 99 ? "99+" : String(n)
    }

    // MARK: windows and places

    private static var afterLoad: [ObjectIdentifier: [(FoleviWebView) -> Void]] = [:]

    /// Runs `f` once the view's first page is up (now if it is).
    static func whenLoaded(_ view: FoleviWebView, _ f: @escaping (FoleviWebView) -> Void) {
        if view.loaded { f(view) } else { afterLoad[ObjectIdentifier(view), default: []].append(f) }
    }

    /// A view's page finished loading (TitleBar watches isLoading).
    static func viewLoaded(_ view: FoleviWebView) {
        for f in afterLoad.removeValue(forKey: ObjectIdentifier(view)) ?? [] { f(view) }
        MainMenu.shared.viewLoaded(view)
    }

    /// The key main window's view; while Folevi isn't the active app (the Dock menu, the menu bar icon, a script),
    /// the front main window's if one is showing; nil otherwise (Settings or Quick Add is key, or no window).
    static var keyMainView: FoleviWebView? {
        if let key = WindowManager.shared.mains.first(where: { $0.window?.isKeyWindow == true }) { return key.view }
        guard !NSApp.isActive, let front = WindowManager.shared.frontMain, front.window?.isVisible == true else { return nil }
        return front.view
    }

    /// The key window's web view, whatever window it is (a main window, Settings, Quick Add).
    static var keyView: FoleviWebView? {
        guard let window = NSApp.keyWindow else { return nil }
        return WindowManager.shared.allViews.first { $0.window === window }
    }

    /// Opens a path in a place: the open place's windows directly; another place by switching to it first
    /// (the page asks the host through foleviShell.places.switchTo, WM1's).
    static func open(path: String?, place: String?) {
        let current = WindowManager.shared.currentPlace()
        let safe = path.flatMap { $0.hasPrefix("/") && !$0.hasPrefix("//") ? $0 : nil }
        guard let place, place != current, ShellPlaces.has(place) else {
            WindowManager.shared.showMain(path: safe)
            return
        }
        WindowManager.shared.showMain()
        guard let view = WindowManager.shared.frontMain?.view else { return }
        view.callAsyncJavaScript("const p = window.foleviShell && window.foleviShell.places; if (p && p.switchTo) await p.switchTo(id, { path });", arguments: ["id": place, "path": safe ?? "/documents"], in: nil, in: .page, completionHandler: nil)
    }

    /// The places' names for menus: "On this Mac" for the library, an account's name or email.
    static func placeLabel(_ id: String?) -> String? {
        guard let id else { return nil }
        if id == ShellPlaces.library { return "On this Mac" }
        guard let a = ShellPlaces.state.accounts.first(where: { $0.id == id }) else { return nil }
        return a.name.isEmpty ? (a.email.isEmpty ? "Folevi account" : a.email) : a.name
    }

    /// Every place, in the menus' order: the library first, then the accounts.
    static var places: [String] {
        let s = ShellPlaces.state
        return (s.library ? [ShellPlaces.library] : []) + s.accounts.map(\.id)
    }

    /// Switches every main window to another place (the page does it through WM1's places).
    static func switchPlace(_ id: String) {
        guard id != WindowManager.shared.currentPlace() else { return }
        open(path: "/documents", place: id)
    }
}
