// Where the iPhone frame is (the web's components/iphone/tabStacks.ts): each tab keeps its own stack of screens, as
// on iOS. Home > a folder > a note, then Tasks, then back to Home shows that note again, where it was scrolled to.
// Opening another tab's first screen (a link to Tasks or Calendar) switches to that tab and starts it there;
// opening Home or Calendar from deeper in their own tab goes back to its start. Tapping the tab you're on goes
// back to its first screen, or, already there, to the top.
import Foundation
import Observation
import FoleviDesign
import FoleviScreens

/// One screen in a tab's stack and how far it was scrolled when it was last on screen.
public struct PhoneStackEntry: Hashable, Sendable {
    public var route: FrameRoute
    public var scroll: CGFloat

    public init(_ route: FrameRoute, scroll: CGFloat = 0) {
        self.route = route
        self.scroll = scroll
    }
}

@MainActor @Observable
public final class PhoneFrameModel {
    public private(set) var current: PhoneTab = .home
    public private(set) var stacks: [PhoneTab: [PhoneStackEntry]] = [:]
    /// Bumped when the tab on screen should scroll to its top (its own tab tapped at its first screen).
    public private(set) var scrollToTop = 0
    /// The search tab is on show (iOS 26's tab bar: search is a tab of its own, `Tab(role: .search)`), over the tab
    /// it was opened from, which stays `current`: closing search goes back to it.
    public private(set) var searching = false
    /// What search opens with (a link's or a caller's words); bumped `searchID` when asked again.
    public private(set) var searchText = ""
    public private(set) var searchID = 0

    public init() {
        for tab in PhoneTab.allCases { stacks[tab] = [PhoneStackEntry(Self.root(of: tab))] }
    }

    /// The tab's first screen.
    public static func root(of tab: PhoneTab) -> FrameRoute {
        FrameRoute(path: tab.rootPath)
    }

    /// Which tab a screen opens in when it's a tab's own first screen: Tasks and Calendar, else Home.
    public static func tab(of route: FrameRoute) -> PhoneTab {
        switch route {
        case .tasks: .tasks
        case .calendar: .calendar
        default: .home
        }
    }

    /// A tab's first screen (any of Tasks' views, any day of the calendar).
    public static func isTabRoot(_ route: FrameRoute) -> Bool {
        switch route {
        case .home, .tasks, .calendar: true
        default: false
        }
    }

    /// The current tab's stack.
    public var stack: [PhoneStackEntry] { stacks[current] ?? [] }

    /// The screen on show.
    public var top: FrameRoute { searching ? .search(searchText) : (stack.last?.route ?? Self.root(of: current)) }

    /// The screen on top of the current tab's stack (under search while it's open).
    public var tabTop: FrameRoute { stack.last?.route ?? Self.root(of: current) }

    /// The search tab, with `text` in its field.
    public func openSearch(_ text: String = "") {
        searchText = text
        searchID += 1
        searching = true
    }

    /// Search's tab tapped (true) or another tab tapped while it's open (false).
    public func setSearching(_ on: Bool) {
        searching = on
    }

    /// Whether Back has somewhere to go in this tab.
    public var canGoBack: Bool { stack.count > 1 }

    /// Opens a screen: on top of this tab's stack, or, for a tab's first screen, in that tab from its start.
    public func open(_ route: FrameRoute) {
        if case .search(let text) = route {
            openSearch(text)
            return
        }
        // Anything opened from search shows in the tab search was opened over.
        searching = false
        if Self.isTabRoot(route) {
            let tab = Self.tab(of: route)
            // Tasks' other views (Completed) are pushed on purpose; Home and Calendar again go back to the start.
            let ownRootAgain = tab == current && stack.count > 1 && !{ if case .tasks = route { true } else { false } }()
            if tab != current || ownRootAgain {
                current = tab
                stacks[tab] = [PhoneStackEntry(route)]
                return
            }
            if stack.count == 1 {
                // The same first screen with another address (another task view, another day).
                stacks[tab] = [PhoneStackEntry(route)]
                return
            }
        }
        guard top != route else { return }
        var s = stacks[current] ?? []
        let run = Self.noteRunStart(s)
        if columns, run < s.count {
            // The list beside the note (a wide window: iPhone Duo open): a note opened takes the open note's place in
            // its column; anything else opens in the list's column, the note staying open beside it. The stack keeps
            // the note last, so folding the phone shows it full screen with Back to that list.
            if route.isNote {
                s.replaceSubrange(run..., with: [PhoneStackEntry(route)])
            } else {
                s.insert(PhoneStackEntry(route), at: run)
            }
            stacks[current] = s
            return
        }
        stacks[current, default: []].append(PhoneStackEntry(route))
    }

    /// The list beside the open note: the window is wide enough (iPhone Duo open, an iPad window under the iPad's
    /// own layout but over the phone's width). Set by the frame (PhoneColumns).
    public var columns = false

    /// Where the notes on top of a stack start (the stack's length when its top isn't a note): in two columns they
    /// show in the note's column, the screens under them in the list's. A tab's first screen is never a note.
    public static func noteRunStart(_ stack: [PhoneStackEntry]) -> Int {
        var i = stack.count
        while i > 1, stack[i - 1].route.isNote { i -= 1 }
        return i
    }

    /// Back in this tab (the Back button, the edge swipe).
    public func back() {
        if searching {
            searching = false
            return
        }
        guard canGoBack else { return }
        stacks[current]?.removeLast()
    }

    /// The tab bar: another tab shows where it was left; the tab on show goes back to its first screen, or, there
    /// already, to the top.
    public func pick(_ tab: PhoneTab) {
        if searching {
            searching = false
            current = tab
            return
        }
        if tab != current {
            current = tab
            return
        }
        if canGoBack {
            stacks[tab] = Array(stack.prefix(1))
        } else {
            scrollToTop += 1
        }
    }

    /// The navigation stack's path changed under the model (iOS's edge swipe popped a screen): the tab's stack is
    /// its first screen and that path.
    public func setPath(_ path: [PhoneStackEntry], in tab: PhoneTab) {
        let first = stacks[tab]?.first ?? PhoneStackEntry(Self.root(of: tab))
        stacks[tab] = [first] + path
    }

    /// In two columns: the list column's path changed under the model (its Back, its edge swipe); the notes beside
    /// it stay open.
    public func setListPath(_ path: [PhoneStackEntry], in tab: PhoneTab) {
        let s = stacks[tab] ?? []
        let first = s.first ?? PhoneStackEntry(Self.root(of: tab))
        stacks[tab] = [first] + path + s[Self.noteRunStart(s)...]
    }

    /// In two columns: the note column's path (the notes over its first) changed under the model.
    public func setNotePath(_ path: [PhoneStackEntry], in tab: PhoneTab) {
        let s = stacks[tab] ?? []
        let run = Self.noteRunStart(s)
        guard run < s.count else { return }
        stacks[tab] = Array(s[...run]) + path
    }

    /// Keeps how far the screen on top was scrolled, so it comes back there.
    public func rememberScroll(_ offset: CGFloat) {
        guard var s = stacks[current], !s.isEmpty else { return }
        s[s.count - 1].scroll = offset
        stacks[current] = s
    }

    // MARK: Scene restore

    /// Where the frame is, to save with the scene and restore at the next launch: the tab on show and each tab's
    /// stack as the web's addresses, with how far each screen was scrolled.
    public struct Snapshot: Codable, Equatable, Sendable {
        public struct Entry: Codable, Equatable, Sendable {
            public var path: String
            public var scroll: Double
        }

        public var current: String
        public var stacks: [String: [Entry]]
    }

    public var snapshot: Snapshot {
        Snapshot(
            current: current.rawValue,
            stacks: Dictionary(uniqueKeysWithValues: stacks.map { tab, entries in
                (tab.rawValue, entries.map { Snapshot.Entry(path: $0.route.path, scroll: Double($0.scroll)) })
            })
        )
    }

    /// Back where a snapshot says. A tab missing from it (or one whose stack doesn't start at one of its own first
    /// screens) starts again from its first screen.
    public func restore(_ s: Snapshot) {
        for tab in PhoneTab.allCases {
            let entries = (s.stacks[tab.rawValue] ?? []).map { PhoneStackEntry(FrameRoute(path: $0.path), scroll: CGFloat($0.scroll)) }
            if let first = entries.first, Self.isTabRoot(first.route), Self.tab(of: first.route) == tab {
                stacks[tab] = entries
            } else {
                stacks[tab] = [PhoneStackEntry(Self.root(of: tab))]
            }
        }
        current = PhoneTab(rawValue: s.current) ?? .home
    }

    /// The snapshot as data (JSON), and back.
    public var snapshotData: Data? { try? JSONEncoder().encode(snapshot) }

    @discardableResult
    public func restore(data: Data) -> Bool {
        guard let s = try? JSONDecoder().decode(Snapshot.self, from: data) else { return false }
        restore(s)
        return true
    }
}
