// What the Tasks, Calendar, Search, Notifications and Places screens ask the frame to do (plan 4.1, 4.4, 4.5, N10
// and N11). `ScreenRoute` (Core/Routes.swift) covers pushing list screens; these intents add what those screens
// need beyond it: tabs (Tasks, Calendar), a note at a block, places and accounts (Swift services, not the engine),
// closing the sheet or popover the content sits in. Every intent has a fallback through `ScreenNavigator`, so a
// frame that hasn't wired one yet still does something sensible.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A request from a screen to the frame.
public enum ScreenIntent: Hashable, Sendable {
    /// The Tasks tab (iPhone) or screen (iPad, Mac) on a view.
    case openTasks(TaskViewName)
    /// The Calendar on a day (YYYY-MM-DD), or today.
    case openCalendar(date: String?)
    /// A note, scrolled to a block when given (a task's to-do, a search match in a file). The web route is
    /// `/d/<id>#block-<blockId>`.
    case openNote(id: String, blockId: String?)
    /// An app route from the engine (a notification's `route`).
    case openRoute(String)
    /// Settings, on a section ("notifications", "members", ...) when given.
    case openSettings(section: String?)
    /// Help (`/help`, a web page with native bars).
    case help
    /// Another place this device knows (an account, or the library), on one of its workspaces when given.
    /// The frame flushes, switches (`Places.switchTo`) and crossfades (`PlaceCrossfade`).
    case switchPlace(id: String, workspaceId: String?)
    /// A new team workspace (the New workspace sheet, N14).
    case newWorkspace
    /// Sign in to another account (ShellAuth, plan 3.6).
    case signInAnotherAccount
    /// Move or copy notes between places (R8.7).
    case moveOrCopy
    /// Sign out of the open place. The content has already warned about unsynced changes and the person
    /// confirmed, so the frame signs out without asking again.
    case signOut(place: String?)
    /// A file a notification delivers (an export): the frame fetches its signed link and downloads it.
    case downloadFile(id: String)
    /// Close the sheet or popover this content is in.
    case dismiss
}

/// How content sends intents. The default falls back to `ScreenNavigator` routes where one fits.
public struct ScreenIntents: Sendable {
    public var send: @MainActor @Sendable (ScreenIntent) -> Void
    public init(send: @escaping @MainActor @Sendable (ScreenIntent) -> Void) { self.send = send }

    /// Routes what it can through the navigator; the rest does nothing (previews, tests).
    public static func fallback(_ navigator: ScreenNavigator) -> ScreenIntents {
        ScreenIntents { intent in
            if let route = intent.fallbackRoute { navigator.open(route, nil) }
        }
    }
}

public extension ScreenIntent {
    /// The web path an intent stands for, when it has one (what a frame without the intent opens).
    var webPath: String? {
        switch self {
        case .openTasks(let v): return "/tasks/\(v.rawValue)"
        case .openCalendar(let d): return d.map { "/calendar?date=\($0)" } ?? "/calendar"
        case .openNote(let id, let block): return block.map { "/d/\(id)#block-\($0)" } ?? "/d/\(id)"
        case .openRoute(let r): return r
        case .openSettings(let s): return s.map { "/settings/\($0)" } ?? "/settings"
        case .help: return "/help"
        default: return nil
        }
    }

    /// The `ScreenRoute` fallback.
    var fallbackRoute: ScreenRoute? {
        switch self {
        case .openNote(let id, _): return .note(id: id)
        case .openRoute(let r): return ScreenRoute(webRoute: r)
        case .moveOrCopy: return .movePlaces(folders: [], notes: [])
        default: return webPath.map(ScreenRoute.web)
        }
    }
}

/// The routes of these screens by web path (`/tasks/today`, `/calendar?date=2026-10-24`, `/search?q=`), for deep
/// links, restoration and `navigate.request`. `ScreenRoute(webRoute:)` reads these as `.web(path)`; frames ask
/// `FeatureRoute(webRoute:)` first.
public enum FeatureRoute: Hashable, Sendable {
    case tasks(TaskViewName)
    case calendar(date: String?)
    case search(text: String)
    case notifications
    /// A note at a block (`/d/<id>#block-<blockId>`).
    case noteBlock(id: String, blockId: String)

    public init?(webRoute route: String) {
        let (pathAndQuery, fragment) = Self.split(route, "#")
        let (path, query) = Self.split(pathAndQuery, "?")
        let parts = path.split(separator: "/").map(String.init)
        switch parts.first {
        case "tasks":
            self = .tasks(parts.count > 1 ? TaskViewName(rawValue: parts[1]) ?? .today : .today)
        case "calendar":
            let date = Self.param("date", query) ?? (parts.count > 1 && TaskDates.isDay(parts[1]) ? parts[1] : nil)
            self = .calendar(date: date)
        case "search":
            self = .search(text: Self.param("q", query) ?? "")
        case "notifications":
            self = .notifications
        case "d" where parts.count > 1:
            guard let fragment, fragment.hasPrefix("block-") else { return nil }
            self = .noteBlock(id: parts[1], blockId: String(fragment.dropFirst(6)))
        default:
            return nil
        }
    }

    public var webPath: String {
        switch self {
        case .tasks(let v): "/tasks/\(v.rawValue)"
        case .calendar(let d): d.map { "/calendar?date=\($0)" } ?? "/calendar"
        case .search(let t): t.isEmpty ? "/search" : "/search?q=\(t.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? t)"
        case .notifications: "/notifications"
        case .noteBlock(let id, let b): "/d/\(id)#block-\(b)"
        }
    }

    private static func split(_ s: String, _ c: Character) -> (String, String?) {
        guard let i = s.firstIndex(of: c) else { return (s, nil) }
        return (String(s[..<i]), String(s[s.index(after: i)...]))
    }

    private static func param(_ name: String, _ query: String?) -> String? {
        guard let query else { return nil }
        for pair in query.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.first == name { return kv.count > 1 ? (kv[1].removingPercentEncoding ?? kv[1]) : "" }
        }
        return nil
    }
}

public extension EnvironmentValues {
    /// Unset: falls back to the navigator (see `ScreenIntentReader`).
    @Entry var screenIntents: ScreenIntents? = nil
}

/// Reads the intents from the environment, falling back to the navigator.
struct IntentSender: DynamicProperty {
    @Environment(\.screenIntents) private var intents
    @Environment(\.screenNavigator) private var navigator
    @MainActor func callAsFunction(_ intent: ScreenIntent) {
        (intents ?? .fallback(navigator)).send(intent)
    }
}

/// Wraps content that changes with the place (the frame's root): switching places crossfades instead of cutting.
public struct PlaceCrossfade: ViewModifier {
    let key: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public init(key: String) { self.key = key }
    public func body(content: Content) -> some View {
        content
            .id(key)
            .transition(.opacity)
            .animation(reduceMotion ? nil : .folevi(0.28), value: key)
    }
}

public extension View {
    /// Crossfades when `place` (a place and space key) changes.
    func placeCrossfade(_ place: String) -> some View { modifier(PlaceCrossfade(key: place)) }
}
