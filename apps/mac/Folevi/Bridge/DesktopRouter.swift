// foleviDesktop's native side (docs/MAC_WEBKIT_PLAN.md §5.2): the Dock badge, notifications, the menu bar icon's
// recent notes and status, the app's settings, the window buttons' place, Quick Add, opening a path in the main
// window, and the Mac chrome's own calls (menu state, drag areas, text services). WM2 owns this file; WM5 adds its
// rows (dragFile, recognizeText, call capture) in DesktopRouter+Capabilities.swift through `extraHandlers` and
// `features`.
//
// Every argument is checked here: the page is Folevi's own (MessageRouter makes sure), but it's still a page.
import AppKit

final class DesktopRouter {
    let context: BridgeContext

    /// The optional foleviDesktop members the app answers (mac-bridge.js shows only these to the page):
    /// "signInInBrowser", "dragFile", "callCapture", "screenAccess", "openSystemSettings", "recognizeText".
    nonisolated(unsafe) static var features: Set<String> = []

    /// More methods, by name, from other files (WM5's capabilities): tried before `handle` gives up.
    nonisolated(unsafe) static var extraHandlers: [String: @MainActor (DesktopRouter, [String: Any]) async throws -> [String: Any]] = [:]

    init(context: BridgeContext) {
        self.context = context
    }

    /// The view the call came from.
    @MainActor
    var view: FoleviWebView? {
        (context.events as? ViewEvents)?.view as? FoleviWebView
    }

    @MainActor
    func handle(_ method: String, _ options: [String: Any]) async throws -> [String: Any] {
        if let extra = Self.extraHandlers[method] { return try await extra(self, options) }
        switch method {
        case "setBadge":
            let n = max(0, min(100_000, Self.int(options["count"]) ?? 0))
            // A place's count: the open place's windows and each runner say theirs (the sum is on the Dock).
            Chrome.badges[context.place() ?? ""] = n
            Chrome.updateBadge()
            return [:]

        case "notify":
            guard DesktopSettings.current.notifications else { return [:] }
            let title = Self.text(options["title"], 200)
            guard !title.isEmpty else { return [:] }
            Notifications.shared.post(Notifications.Note(
                id: Self.text(options["id"], 120),
                title: title,
                body: Self.text(options["body"], 400),
                path: Self.path(options["path"]),
                kind: Self.text(options["kind"], 40),
                thread: Self.text(options["thread"], 80),
                threadTitle: Self.text(options["threadTitle"], 120),
                commentThread: Self.text(options["commentThread"], 80),
                place: context.place()
            ))
            return [:]

        case "setRecent":
            // From the open place's windows only (a runner's notes are its own place's, not the menu's).
            guard view?.role == .main else { return [:] }
            let list = (options["notes"] as? [[String: Any]] ?? []).prefix(50).compactMap { n -> (String, String, String?)? in
                let id = Self.text(n["id"], 40)
                guard id.range(of: "^[0-9A-Z]{26}$", options: .regularExpression) != nil else { return nil }
                return (id, Self.text(n["title"], 80), context.place())
            }
            Chrome.recent = Array(list.prefix(8)).map { (id: $0.0, title: $0.1, place: $0.2) }
            Chrome.refresh()
            return [:]

        case "setStatus":
            guard view?.role == .main else { return [:] }
            let next = Self.text(options["text"], 80)
            if next != Chrome.status {
                Chrome.status = next
                StatusItem.shared.update()
            }
            return [:]

        case "getSettings":
            return ["settings": DesktopSettings.current.page, "error": Chrome.shortcutError.map { $0 as Any } ?? NSNull()]

        case "setSettings":
            let previous = DesktopSettings.current
            let next = DesktopSettings.clean(options["patch"] as? [String: Any] ?? [:], base: previous)
            Chrome.applySettings(next, previous: previous)
            return ["settings": DesktopSettings.current.page, "error": Chrome.shortcutError.map { $0 as Any } ?? NSNull()]

        case "placeWindowButtons":
            guard let x = Self.number(options["x"]), let y = Self.number(options["y"]), let h = Self.number(options["height"]),
                  [x, y, h].allSatisfy({ $0 >= 0 && $0 < 400 }), let window = context.window() else { return [:] }
            TitleBar.place(ButtonSpot(x: x, y: y, height: h), in: window)
            return [:]

        case "pauseShortcut":
            HotKey.shared.pause(options["paused"] as? Bool == true)
            return [:]

        case "closeQuickAdd":
            guard view?.role == .quickAdd else { return [:] }
            QuickAddPanel.shared.hide()
            return [:]

        case "sizeQuickAdd":
            guard view?.role == .quickAdd, let h = Self.number(options["height"]) else { return [:] }
            QuickAddPanel.shared.size(height: h)
            return [:]

        case "openInMain":
            if view?.role == .quickAdd { QuickAddPanel.shared.hide() }
            Chrome.open(path: Self.path(options["path"]), place: context.place())
            NSApp.activate()
            return [:]

        // ---- the Mac chrome's own (chrome-page.js)

        case "chromeHello":
            guard let view else { return [:] }
            let window = view.window
            return [
                "fullscreen": window?.styleMask.contains(.fullScreen) == true,
                "active": window?.isKeyWindow == true || view.role == .quickAdd,
                "keyboard": NSApp.isFullKeyboardAccessEnabled,
                "vibrancy": view.role == .main && TitleBar.vibrancy ? "sidebar" : view.role == .quickAdd ? "hud" : "",
                "panel": view.role == .quickAdd ? "quick-add" : (window != nil && window === SettingsWindow.shared.window ? "settings" : ""),
            ]

        case "dragRegions":
            guard let view else { return [:] }
            let rects = { (key: String) -> [[Double]] in (options[key] as? [[Any]] ?? []).map { $0.compactMap(Self.number) } }
            TitleBar.setRegions(view, drag: rects("drag"), noDrag: rects("noDrag"))
            return [:]

        case "setMenuState":
            guard let view else { return [:] }
            let ids = { (key: String) -> Set<String> in
                Set((options[key] as? [Any] ?? []).prefix(400).compactMap { ($0 as? String).flatMap { $0.count <= 60 ? $0 : nil } })
            }
            var s = PageState()
            s.disabled = ids("disabled")
            s.checked = ids("checked")
            s.ai = options["ai"] as? Bool
            s.sidebar = options["sidebar"] as? Bool
            s.inspector = options["inspector"] as? Bool
            s.focus = options["focus"] as? Bool
            s.find = options["find"] as? Bool == true
            s.locked = options["locked"] as? Bool
            s.route = (options["route"] as? String).map { String($0.prefix(40)) }
            s.reported = true
            Chrome.states[ObjectIdentifier(view)] = s
            if view === SettingsWindow.shared.view { SettingsWindow.shared.pageStateChanged() }
            return [:]

        case "pageTheme":
            guard let view, let theme = options["theme"] as? String, ["dark", "light"].contains(theme) else { return [:] }
            TitleBar.pageTheme(theme, view: view)
            return [:]

        case "closeWindow":
            guard let view, view.role == .main, let window = view.window else { return [:] }
            window.performClose(nil)
            return [:]

        case "spelling":
            return TextMenu.spelling(Self.text(options["word"], 100), view: view)

        case "learnWord":
            TextMenu.learn(Self.text(options["word"], 100))
            return [:]

        case "ignoreWord":
            TextMenu.ignore(Self.text(options["word"], 100), view: view)
            return [:]

        case "lookUp":
            guard let view, let x = Self.number(options["x"]), let y = Self.number(options["y"]) else { return [:] }
            TextMenu.lookUp(Self.text(options["text"], 2000), x: x, y: y, view: view)
            return [:]

        default:
            throw BridgeError.unavailable("foleviDesktop.\(method)")
        }
    }

    // MARK: arguments

    static func text(_ v: Any?, _ max: Int) -> String {
        guard let s = v as? String else { return "" }
        return String(s.prefix(max))
    }

    static func number(_ v: Any?) -> Double? {
        // (An NSNumber of 0 or 1 also reads as a Bool in Swift: only a real boolean is refused.)
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        return d.isFinite ? d : nil
    }

    static func int(_ v: Any?) -> Int? { number(v).map { Int($0.rounded(.down)) } }

    /// A path inside the app ("/d/01…", "/tasks/today"), or nil.
    static func path(_ v: Any?) -> String? {
        let p = text(v, 500)
        return p.hasPrefix("/") && !p.hasPrefix("//") ? p : nil
    }
}
