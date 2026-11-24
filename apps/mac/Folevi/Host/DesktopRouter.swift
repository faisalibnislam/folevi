// foleviDesktop's native side in Folevi: what the page asks of the Mac (the Dock badge, notifications, its
// recent notes, the desktop settings, opening a path in a window, text services). The app draws its own chrome, so
// the calls today's app answers for a page-drawn title bar (drag areas, window buttons, the page's theme) are
// accepted and do nothing. Every argument is checked: the page is Folevi's own, but it's still a page.
import AppKit
import WebKit
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

/// What the desktop router hands to the app model (set at launch).
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

    /// Account places that send no count of their own (not open now) count with their last-known unread.
    nonisolated(unsafe) static var silentUnread: [String: Int] = [:]

    static func updateBadge() {
        let total = badges.values.reduce(0, +) + silentUnread.filter { badges[$0.key] == nil }.values.reduce(0, +)
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
            // While the app is in front only reminders show (willPresent); activity is in Notifications.
            guard DesktopSettings.current.notifications else { return [:] }
            let title = Self.text(options["title"], 200)
            guard !title.isEmpty else { return [:] }
            await AppNotifications.post(id: Self.text(options["id"], 120), title: title, body: Self.text(options["body"], 400), path: Self.path(options["path"]), thread: Self.text(options["thread"], 80), place: context.place(),
                                         kind: Self.text(options["kind"], 40), threadTitle: Self.text(options["threadTitle"], 120), commentThread: Self.text(options["commentThread"], 80))
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

        // The app draws the title bar and the window's chrome itself: the page's reports change nothing.
        case "setStatus", "placeWindowButtons", "dragRegions", "setMenuState", "pageTheme", "closeQuickAdd", "sizeQuickAdd":
            return [:]

        case "closeWindow":
            view?.window?.performClose(nil)
            return [:]

        case "spelling":
            return Self.spelling(Self.text(options["word"], 100), context: Self.text(options["context"], 700), view: view)

        case "learnWord":
            let word = Self.text(options["word"], 100)
            if !word.isEmpty { NSSpellChecker.shared.learnWord(word); Self.clearUnderline(word, view: view) }
            return [:]

        case "ignoreWord":
            let word = Self.text(options["word"], 100)
            if !word.isEmpty, let view { NSSpellChecker.shared.ignoreWord(word, inSpellDocumentWithTag: Self.spellTag(view)); Self.clearUnderline(word, view: view) }
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

    /// { misspelled, guesses } for the word under the page's menu. The paragraph around it (the page's context)
    /// picks the language and the guesses, so a French note gets French ones; up to 8.
    @MainActor
    static func spelling(_ raw: String, context: String, view: NSView?) -> [String: Any] {
        let none: [String: Any] = ["misspelled": false, "guesses": [String]()]
        let w = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !w.isEmpty else { return none }
        let checker = NSSpellChecker.shared
        let t = view.map(spellTag) ?? 0
        if context.contains(w) {
            let text = context as NSString
            var orthography: NSOrthography?
            let found = checker.check(context, range: NSRange(location: 0, length: text.length), types: NSTextCheckingResult.CheckingType.spelling.rawValue, options: nil, inSpellDocumentWithTag: t, orthography: &orthography, wordCount: nil)
            if let hit = found.first(where: { $0.resultType == .spelling && text.substring(with: $0.range) == w }) {
                let language = checker.language(forWordRange: hit.range, in: context, orthography: orthography)
                let guesses = checker.guesses(forWordRange: hit.range, in: context, language: language, inSpellDocumentWithTag: t) ?? []
                return ["misspelled": true, "guesses": Array(guesses.prefix(8))]
            }
        }
        // No text around it: the word alone, in the Spelling settings' language.
        let range = checker.checkSpelling(of: w, startingAt: 0, language: nil, wrap: false, inSpellDocumentWithTag: t, wordCount: nil)
        guard range.location != NSNotFound else { return none }
        let guesses = checker.guesses(forWordRange: NSRange(location: 0, length: (w as NSString).length), in: w, language: nil, inSpellDocumentWithTag: t) ?? []
        return ["misspelled": true, "guesses": Array(guesses.prefix(8))]
    }

    /// Takes WebKit's red underline off a learned or ignored word: WebKit's own Ignore Spelling acts on the
    /// selected word, so the page selects it first (where the right-click landed) and says whether it could.
    @MainActor
    static func clearUnderline(_ w: String, view: NSView?) {
        guard let view = view as? WKWebView else { return }
        let action = #selector(NSIgnoreMisspelledWords.ignoreSpelling(_:))
        guard view.responds(to: action) else { return }
        let script = "return typeof window.__foleviSelectWord === 'function' && window.__foleviSelectWord(word) === true;"
        view.callAsyncJavaScript(script, arguments: ["word": w], in: nil, in: .page) { [weak view] result in
            guard case .success(let value) = result, (value as? Bool) == true else { return }
            view?.perform(action, with: nil)
        }
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

/// Mac notifications for comments, mentions and reminders (while the app isn't in front). Clicking one opens its
/// path in the app.
@MainActor
enum AppNotifications {
    static var onOpen: ((String, String?) -> Void)?

    static func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// Which actions a server kind gets: reminders (complete, snooze), tasks (open, complete), comments with a
    /// thread (reply, mark as read), the rest (mark as read).
    static func category(for kind: String, hasThread: Bool) -> String {
        let k = kind.lowercased()
        if k.contains("remind") || k.contains("due") { return "folevi.reminder" }
        if k.contains("assign") || k.contains("task") { return "folevi.task" }
        if (k.contains("mention") || k.contains("comment") || k.contains("reply")) && hasThread { return "folevi.comment" }
        return "folevi.plain"
    }

    static var categories: Set<UNNotificationCategory> {
        let reply = UNTextInputNotificationAction(identifier: "reply", title: "Reply", options: [], textInputButtonTitle: "Reply", textInputPlaceholder: "Reply")
        let read = UNNotificationAction(identifier: "read", title: "Mark as Read", options: [])
        let open = UNNotificationAction(identifier: "open", title: "Open", options: [.foreground])
        let complete = UNNotificationAction(identifier: "complete", title: "Complete", options: [])
        let hour = UNNotificationAction(identifier: "snooze-hour", title: "Snooze 1 Hour", options: [])
        let evening = UNNotificationAction(identifier: "snooze-evening", title: "Snooze Until This Evening", options: [])
        let tomorrow = UNNotificationAction(identifier: "snooze-tomorrow", title: "Snooze Until Tomorrow", options: [])
        return [
            UNNotificationCategory(identifier: "folevi.comment", actions: [reply, read], intentIdentifiers: []),
            UNNotificationCategory(identifier: "folevi.task", actions: [open, complete], intentIdentifiers: []),
            UNNotificationCategory(identifier: "folevi.reminder", actions: [complete, hour, evening, tomorrow], intentIdentifiers: []),
            UNNotificationCategory(identifier: "folevi.plain", actions: [read], intentIdentifiers: []),
        ]
    }

    @MainActor
    static func post(id: String, title: String, body: String, path: String?, thread: String, place: String?, kind: String = "", threadTitle: String = "", commentThread: String = "") async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = thread.isEmpty ? "folevi" : "note-\(thread)"
        if !threadTitle.isEmpty { content.summaryArgument = threadTitle }
        // Several places: which one it's from.
        if let places = AppModel.shared.places.value?.places, places.count > 1, let p = places.first(where: { $0.id == place }) {
            content.subtitle = p.kind == .library ? "On This Mac" : p.name
        }
        var info: [String: Any] = ["path": path ?? "/inbox", "place": place ?? "", "kind": kind, "id": id]
        if !commentThread.isEmpty { info["commentThread"] = commentThread }
        content.userInfo = info
        content.categoryIdentifier = category(for: kind, hasThread: !commentThread.isEmpty)
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
