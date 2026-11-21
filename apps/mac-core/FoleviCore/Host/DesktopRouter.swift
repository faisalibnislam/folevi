// foleviDesktop's native side in Folevi Core: what the page asks of the Mac (the Dock badge, notifications, its
// recent notes, the desktop settings, opening a path in a window, text services). Core draws its own chrome, so
// the calls today's app answers for a page-drawn title bar (drag areas, window buttons, the page's theme) are
// accepted and do nothing. Every argument is checked: the page is Folevi's own, but it's still a page.
import AppKit
import UserNotifications

/// The desktop settings (Settings > General): Quick Add's shortcut, open at login, the menu bar icon, Mac
/// notifications and Spotlight.
struct DesktopSettings: Equatable {
    var quickAddShortcut = "Alt+Space"
    var openAtLogin = false
    var menuBarIcon = true
    var notifications = true
    var spotlight = true

    private static let key = "folevi.desktop.settings"

    static var current: DesktopSettings {
        get { clean(Paths.defaults.dictionary(forKey: key) ?? [:], base: DesktopSettings()) }
        set { Paths.defaults.set(newValue.page, forKey: key) }
    }

    var page: [String: Any] {
        ["quickAddShortcut": quickAddShortcut, "openAtLogin": openAtLogin, "menuBarIcon": menuBarIcon, "notifications": notifications, "spotlight": spotlight]
    }

    static func clean(_ raw: [String: Any], base: DesktopSettings) -> DesktopSettings {
        var out = base
        if let s = raw["quickAddShortcut"] as? String, HotKey.isValidShortcut(s) { out.quickAddShortcut = s }
        if let b = raw["openAtLogin"] as? Bool { out.openAtLogin = b }
        if let b = raw["menuBarIcon"] as? Bool { out.menuBarIcon = b }
        if let b = raw["notifications"] as? Bool { out.notifications = b }
        if let b = raw["spotlight"] as? Bool { out.spotlight = b }
        return out
    }
}

/// What the desktop router hands to Core's app model (set at launch).
@MainActor
enum DesktopHooks {
    /// A place's unread count changed (the Dock badge is the sum).
    static var badges: [String: Int] = [:]
    /// The page's recent notes (the Dock menu and the menu bar extra).
    static var recent: [(id: String, title: String)] = []
    static var onRecent: (() -> Void)?
    /// Open a path in a window of the place.
    static var openPath: ((String, String?) -> Void)?
    /// The desktop settings changed.
    static var onSettings: ((DesktopSettings, DesktopSettings) -> Void)?
    /// Pause the global Quick Add shortcut (while a shortcut field records keys).
    static var pauseShortcut: ((Bool) -> Void)?

    static func updateBadge() {
        let total = badges.values.reduce(0, +)
        NSApp.dockTile.badgeLabel = total > 0 ? (total > 99 ? "99+" : String(total)) : nil
    }
}

final class DesktopRouter {
    let context: BridgeContext

    /// The optional foleviDesktop members the app answers (mac-bridge.js shows only these to the page).
    nonisolated(unsafe) static var features: Set<String> = []

    /// More methods, by name, from other files (sign-in in the system sheet): tried before `handle` gives up.
    nonisolated(unsafe) static var extraHandlers: [String: @MainActor (DesktopRouter, [String: Any]) async throws -> [String: Any]] = [:]

    init(context: BridgeContext) {
        self.context = context
    }

    @MainActor
    var view: FoleviWebView? { (context.events as? ViewEvents)?.view as? FoleviWebView }

    @MainActor
    func handle(_ method: String, _ options: [String: Any]) async throws -> [String: Any] {
        if let extra = Self.extraHandlers[method] { return try await extra(self, options) }
        switch method {
        case "setBadge":
            DesktopHooks.badges[context.place() ?? ""] = max(0, min(100_000, Self.int(options["count"]) ?? 0))
            DesktopHooks.updateBadge()
            return [:]

        case "notify":
            // While Core is in front, its Inbox shows it.
            guard DesktopSettings.current.notifications, !NSApp.isActive else { return [:] }
            let title = Self.text(options["title"], 200)
            guard !title.isEmpty else { return [:] }
            await CoreNotifications.post(id: Self.text(options["id"], 120), title: title, body: Self.text(options["body"], 400), path: Self.path(options["path"]), thread: Self.text(options["thread"], 80), place: context.place())
            return [:]

        case "setRecent":
            guard view?.role == .main else { return [:] }
            DesktopHooks.recent = (options["notes"] as? [[String: Any]] ?? []).prefix(50).compactMap { n -> (String, String)? in
                let id = Self.text(n["id"], 40)
                guard id.range(of: "^[0-9A-Z]{26}$", options: .regularExpression) != nil else { return nil }
                return (id, Self.text(n["title"], 80))
            }.prefix(8).map { (id: $0.0, title: $0.1) }
            DesktopHooks.onRecent?()
            return [:]

        case "getSettings":
            return ["settings": DesktopSettings.current.page, "error": NSNull()]

        case "setSettings":
            let previous = DesktopSettings.current
            let next = DesktopSettings.clean(options["patch"] as? [String: Any] ?? [:], base: previous)
            DesktopSettings.current = next
            DesktopHooks.onSettings?(next, previous)
            return ["settings": next.page, "error": NSNull()]

        case "pauseShortcut":
            DesktopHooks.pauseShortcut?(options["paused"] as? Bool == true)
            return [:]

        case "openInMain":
            DesktopHooks.openPath?(Self.path(options["path"]) ?? "/", context.place())
            NSApp.activate()
            return [:]

        case "chromeHello":
            let window = view?.window
            return ["fullscreen": window?.styleMask.contains(.fullScreen) == true, "active": window?.isKeyWindow == true, "keyboard": NSApp.isFullKeyboardAccessEnabled, "vibrancy": "", "panel": ""]

        // Core draws the title bar and the window's chrome itself: the page's reports change nothing.
        case "setStatus", "placeWindowButtons", "dragRegions", "setMenuState", "pageTheme", "closeQuickAdd", "sizeQuickAdd":
            return [:]

        case "closeWindow":
            view?.window?.performClose(nil)
            return [:]

        case "spelling":
            return Self.spelling(Self.text(options["word"], 100), context: Self.text(options["context"], 700))

        case "learnWord":
            let word = Self.text(options["word"], 100)
            if !word.isEmpty { NSSpellChecker.shared.learnWord(word) }
            return [:]

        case "ignoreWord":
            let word = Self.text(options["word"], 100)
            if !word.isEmpty, let view { NSSpellChecker.shared.ignoreWord(word, inSpellDocumentWithTag: Self.spellTag(view)) }
            return [:]

        case "lookUp":
            guard let view, let x = Self.number(options["x"]), let y = Self.number(options["y"]) else { return [:] }
            let text = Self.text(options["text"], 2000)
            guard !text.isEmpty else { return [:] }
            let font = NSFont.systemFont(ofSize: 15)
            let string = NSAttributedString(string: text, attributes: [.font: font])
            // The page's point (from its top left) in the view's flipped space.
            view.showDefinition(for: string, at: NSPoint(x: x, y: y + font.ascender))
            return [:]

        default:
            throw BridgeError.unavailable("foleviDesktop.\(method)")
        }
    }

    // MARK: spelling for the page's own menu

    private static var tags: [ObjectIdentifier: Int] = [:]

    @MainActor
    static func spellTag(_ view: NSView) -> Int {
        if let tag = tags[ObjectIdentifier(view)] { return tag }
        let tag = NSSpellChecker.uniqueSpellDocumentTag()
        tags[ObjectIdentifier(view)] = tag
        return tag
    }

    /// { misspelled, guesses } for the word under the page's menu.
    @MainActor
    static func spelling(_ word: String, context: String) -> [String: Any] {
        guard !word.isEmpty else { return ["misspelled": false, "guesses": []] }
        let checker = NSSpellChecker.shared
        let miss = checker.checkSpelling(of: word, startingAt: 0)
        guard miss.location != NSNotFound else { return ["misspelled": false, "guesses": []] }
        let guesses = checker.guesses(forWordRange: NSRange(location: 0, length: (word as NSString).length), in: word, language: nil, inSpellDocumentWithTag: 0) ?? []
        return ["misspelled": true, "guesses": Array(guesses.prefix(6))]
    }

    // MARK: arguments

    static func text(_ v: Any?, _ max: Int) -> String {
        guard let s = v as? String else { return "" }
        return String(s.prefix(max))
    }

    static func number(_ v: Any?) -> Double? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        return d.isFinite ? d : nil
    }

    static func int(_ v: Any?) -> Int? { number(v).map { Int($0.rounded(.down)) } }

    static func path(_ v: Any?) -> String? {
        let p = text(v, 500)
        return p.hasPrefix("/") && !p.hasPrefix("//") ? p : nil
    }
}

/// Mac notifications for comments, mentions and reminders (while Core isn't in front). Clicking one opens its
/// path in Core.
@MainActor
enum CoreNotifications {
    static var onOpen: ((String, String?) -> Void)?

    static func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    static func post(id: String, title: String, body: String, path: String?, thread: String, place: String?) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if !thread.isEmpty { content.threadIdentifier = thread }
        content.userInfo = ["path": path ?? "/inbox", "place": place ?? ""]
        content.categoryIdentifier = "folevi.notification"
        let request = UNNotificationRequest(identifier: id.isEmpty ? UUID().uuidString : id, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

/// Quick Add's global shortcut ("Alt+Space"): an accelerator string the page and Settings use.
enum HotKey {
    private static let modifiers: Set<String> = ["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "Shift", "Super", "Meta"]
    private static let keyPattern = #"^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Return|Backspace|Delete|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Plus|[`\-=\[\]\\;',./])$"#

    /// At least one modifier other than Shift, then one key; empty means none.
    static func isValidShortcut(_ accelerator: String) -> Bool {
        if accelerator.isEmpty { return true }
        var parts = accelerator.components(separatedBy: "+")
        guard let key = parts.popLast(), key.range(of: keyPattern, options: .regularExpression) != nil, !parts.isEmpty else { return false }
        guard parts.allSatisfy(modifiers.contains), Set(parts).count == parts.count else { return false }
        return parts.contains { $0 != "Shift" }
    }
}
