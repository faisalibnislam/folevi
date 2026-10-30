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
    public var top: FrameRoute { stack.last?.route ?? Self.root(of: current) }

    /// Whether Back has somewhere to go in this tab.
    public var canGoBack: Bool { stack.count > 1 }

    /// Opens a screen: on top of this tab's stack, or, for a tab's first screen, in that tab from its start.
    public func open(_ route: FrameRoute) {
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
        stacks[current, default: []].append(PhoneStackEntry(route))
    }

    /// Back in this tab (the Back button, the edge swipe).
    public func back() {
        guard canGoBack else { return }
        stacks[current]?.removeLast()
    }

    /// The tab bar: another tab shows where it was left; the tab on show goes back to its first screen, or, there
    /// already, to the top.
    public func pick(_ tab: PhoneTab) {
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

    /// Keeps how far the screen on top was scrolled, so it comes back there.
    public func rememberScroll(_ offset: CGFloat) {
        guard var s = stacks[current], !s.isEmpty else { return }
        s[s.count - 1].scroll = offset
        stacks[current] = s
    }
}
