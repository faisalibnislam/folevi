// The Mac window's tab strip (Craft style, docs/MAC_POLISH_PLAN.md section 2.1 and 3.5), with the web's rules
// (apps/web/src/lib/app/tabs.tsx) so the website and the app behave the same:
//
// - Home is the pinned first tab; every other view gets one tab (one per view kind, one per folder or tag) that
//   follows you inside it; every note opened from a list, Home, search or "+" gets its own tab.
// - Opening a page from inside a note (a page link, a nested page) replaces the current note's tab.
// - At most 12 tabs besides Home: opening one more drops the oldest other tab.
// - Closing the tab on screen shows its right neighbour, else its left one, else Home.
// - Closed tabs can be reopened (⇧⌘T), newest first.
//
// Pure model (no AppKit): FoleviMacTests drives it directly.
import Foundation
import Observation

public struct FrameTab: Hashable, Sendable, Identifiable, Codable {
    public static let homeID = "home"
    /// The route's `tabKey`.
    public var id: String
    public var path: String
    /// Cached title (the strip draws before the engine answers).
    public var title: String
    /// An emoji for notes that have one.
    public var icon: String?

    public init(route: FrameRoute, title: String? = nil, icon: String? = nil) {
        id = route.tabKey
        path = route.path
        self.title = title ?? route.fallbackTitle
        self.icon = icon
    }

    public var route: FrameRoute { FrameRoute(path: path) }
    public var isHome: Bool { id == Self.homeID }
}

@MainActor
@Observable
public final class TabsModel {
    public static let maxTabs = 12

    /// Home first, then the open tabs in strip order.
    public private(set) var tabs: [FrameTab] = [FrameTab(route: .home)]
    public private(set) var activeID: String = FrameTab.homeID
    /// Closed tabs, newest last (⇧⌘T).
    public private(set) var closed: [FrameTab] = []

    public init() {}

    public var active: FrameTab { tabs.first { $0.id == activeID } ?? tabs[0] }
    public var activeRoute: FrameRoute { active.route }
    public var activeIndex: Int { tabs.firstIndex { $0.id == activeID } ?? 0 }

    public enum Opening: Sendable {
        /// From a list, Home, search, the sidebar or "+": its own tab (or the one it already has).
        case newTab
        /// From inside a note (a page link, a nested page, a breadcrumb): the current note tab follows it.
        case replace
        /// Back or Forward: brings a closed tab back rather than taking over the current one.
        case history
    }

    /// Shows a route, following the web's tab rules. Returns the route now on screen.
    @discardableResult
    public func show(_ route: FrameRoute, _ opening: Opening = .newTab) -> FrameRoute {
        let key = route.tabKey
        if let i = tabs.firstIndex(where: { $0.id == key }) {
            // A view's tab follows you inside the view (a search with new words, a folder's own path).
            if tabs[i].path != route.path { tabs[i].path = route.path }
            activeID = key
            return route
        }
        if opening == .replace, route.isNote, let i = tabs.firstIndex(where: { $0.id == activeID }), !tabs[i].isHome, tabs[i].route.isNote {
            tabs[i] = FrameTab(route: route)
            activeID = key
            return route
        }
        tabs.append(FrameTab(route: route))
        activeID = key
        trim(keeping: key)
        return route
    }

    /// Keeps the strip bounded: drops the oldest tabs other than `keeping` (Home never goes).
    private func trim(keeping key: String) {
        while tabs.count - 1 > Self.maxTabs {
            guard let i = tabs.firstIndex(where: { !$0.isHome && $0.id != key }) else { break }
            tabs.remove(at: i)
        }
    }

    /// Closes a tab. Returns the route to show when the closed tab was on screen (nil otherwise).
    @discardableResult
    public func close(_ id: String) -> FrameRoute? {
        guard id != FrameTab.homeID, let i = tabs.firstIndex(where: { $0.id == id }) else { return nil }
        let gone = tabs.remove(at: i)
        closed.append(gone)
        if closed.count > 20 { closed.removeFirst(closed.count - 20) }
        guard gone.id == activeID else { return nil }
        let neighbor = i < tabs.count ? tabs[i] : tabs[i - 1]
        activeID = neighbor.id
        return neighbor.route
    }

    /// Closes every tab but `id` (and Home). Returns the route to show if the one on screen went.
    @discardableResult
    public func closeOthers(_ id: String) -> FrameRoute? {
        let others = tabs.filter { !$0.isHome && $0.id != id }.map(\.id)
        return closeMany(others, then: id)
    }

    /// Closes the tabs to the right of `id`.
    @discardableResult
    public func closeToTheRight(of id: String) -> FrameRoute? {
        guard let i = tabs.firstIndex(where: { $0.id == id }) else { return nil }
        return closeMany(tabs[(i + 1)...].map(\.id), then: id)
    }

    @discardableResult
    public func closeMany(_ ids: [String], then: String? = nil) -> FrameRoute? {
        let gone = Set(ids).subtracting([FrameTab.homeID])
        guard !gone.isEmpty else { return nil }
        let wasActive = gone.contains(activeID)
        closed.append(contentsOf: tabs.filter { gone.contains($0.id) })
        if closed.count > 20 { closed.removeFirst(closed.count - 20) }
        tabs.removeAll { gone.contains($0.id) }
        guard wasActive else { return nil }
        let stay = then.flatMap { t in tabs.first { $0.id == t } } ?? tabs[0]
        activeID = stay.id
        return stay.route
    }

    /// Brings the last closed tab back (⇧⌘T).
    @discardableResult
    public func reopenClosed() -> FrameRoute? {
        while let last = closed.popLast() {
            if tabs.contains(where: { $0.id == last.id }) { continue }
            tabs.append(last)
            activeID = last.id
            trim(keeping: last.id)
            return last.route
        }
        return nil
    }

    /// Moves a tab to another place in the strip (drag, or the keyboard). Home stays first.
    public func move(_ id: String, to index: Int) {
        guard id != FrameTab.homeID, let from = tabs.firstIndex(where: { $0.id == id }) else { return }
        let to = max(1, min(tabs.count - 1, index))
        guard from != to else { return }
        let tab = tabs.remove(at: from)
        tabs.insert(tab, at: to)
    }

    /// ⌘1 to ⌘8 pick that tab (⌘1 is Home); ⌘9 the last one, as browsers do.
    @discardableResult
    public func select(number n: Int) -> FrameRoute? {
        guard n >= 1 else { return nil }
        let i = n == 9 ? tabs.count - 1 : n - 1
        guard tabs.indices.contains(i) else { return nil }
        activeID = tabs[i].id
        return tabs[i].route
    }

    @discardableResult
    public func select(id: String) -> FrameRoute? {
        guard let t = tabs.first(where: { $0.id == id }) else { return nil }
        activeID = id
        return t.route
    }

    /// ⌃Tab and ⌃⇧Tab, wrapping around.
    @discardableResult
    public func selectNext(_ step: Int = 1) -> FrameRoute {
        let i = (activeIndex + step % tabs.count + tabs.count) % tabs.count
        activeID = tabs[i].id
        return tabs[i].route
    }

    /// The engine said more about a tab's page (note.meta, a folder's name).
    public func setTitle(_ title: String, icon: String? = nil, for id: String) {
        guard let i = tabs.firstIndex(where: { $0.id == id }) else { return }
        let t = title.isEmpty ? tabs[i].route.fallbackTitle : title
        if tabs[i].title != t { tabs[i].title = t }
        if tabs[i].icon != icon { tabs[i].icon = icon }
    }

    /// A note went away (moved to Trash, deleted elsewhere): its tab closes.
    @discardableResult
    public func forget(noteId: String) -> FrameRoute? { close(noteId) }

    // MARK: restoration

    public struct Saved: Codable, Equatable, Sendable {
        public var tabs: [FrameTab]
        public var active: String
        public init(tabs: [FrameTab], active: String) {
            self.tabs = tabs
            self.active = active
        }
    }

    public var saved: Saved { Saved(tabs: tabs.filter { !$0.isHome }, active: activeID) }

    public func restore(_ saved: Saved) {
        var seen = Set<String>([FrameTab.homeID])
        var list = [FrameTab(route: .home)]
        for t in saved.tabs.prefix(Self.maxTabs) where !seen.contains(t.id) {
            // A tab's id must be what its path says (a hand-edited file can't make two tabs one).
            guard FrameRoute(path: t.path).tabKey == t.id else { continue }
            seen.insert(t.id)
            list.append(t)
        }
        tabs = list
        activeID = seen.contains(saved.active) ? saved.active : FrameTab.homeID
    }
}
