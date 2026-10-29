// The Mac window's tab strip (Craft style, docs/MAC_POLISH_PLAN.md section 2.1 and 3.5), with the web's rules
// (apps/web/src/lib/app/tabs.tsx) so the website and the app behave the same:
//
// - Home is the pinned first tab; every other view gets one tab (one per view kind, one per folder or tag) that
//   follows you inside it; every note opened from a list, Home, search or "+" gets its own tab.
// - Opening a page from inside a note (a page link, a nested page) replaces the current note's tab.
// - At most 12 tabs besides Home: opening one more drops the oldest other tab.
// - Closing the tab on screen shows its right neighbour, else its left one, else Home.
// - Closed tabs can be reopened (⇧⌘T), newest first.
// - A pinned tab sits at the strip's start (after Home), half as wide, with no ×; closing others or all keeps it.
// - Notes joined side by side (two or three) are one tab, `join:` and a key; a note sits in at most one tab.
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
    /// Kept at the strip's start, half as wide, with no close button (unpin it first).
    public var pinned: Bool = false
    /// Notes joined side by side, left to right (the one with focus is the tab's `path`).
    public var panes: [String]?
    /// Each pane's share of the width (adding up to 1); nil is equal.
    public var sizes: [Double]?

    public init(route: FrameRoute, title: String? = nil, icon: String? = nil) {
        id = route.tabKey
        path = route.path
        self.title = title ?? route.fallbackTitle
        self.icon = icon
    }

    /// A joined tab: `panes`, `at` the one with focus.
    public init(joined id: String, panes: [String], at: String, sizes: [Double]? = nil, pinned: Bool = false) {
        self.id = id
        path = FrameRoute.note(at).path
        title = ""
        self.panes = panes
        self.sizes = sizes
        self.pinned = pinned
    }

    enum CodingKeys: String, CodingKey { case id, path, title, icon, pinned, panes, sizes }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        path = try c.decode(String.self, forKey: .path)
        title = try c.decode(String.self, forKey: .title)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        panes = try c.decodeIfPresent([String].self, forKey: .panes)
        sizes = try c.decodeIfPresent([Double].self, forKey: .sizes)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(path, forKey: .path)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(icon, forKey: .icon)
        if pinned { try c.encode(true, forKey: .pinned) }
        try c.encodeIfPresent(panes, forKey: .panes)
        try c.encodeIfPresent(sizes, forKey: .sizes)
    }

    public var route: FrameRoute { FrameRoute(path: path) }
    public var isHome: Bool { id == Self.homeID }
    public var isJoined: Bool { (panes?.count ?? 0) > 1 }
    /// Whether the tab holds a page: its own, or one of its joined notes.
    public func holds(_ key: String) -> Bool { id == key || panes?.contains(key) == true }
}

@MainActor
@Observable
public final class TabsModel {
    public static let maxTabs = 12
    /// The most notes joined side by side.
    public static let maxPanes = 3

    /// Home first, then the open tabs in strip order.
    public private(set) var tabs: [FrameTab] = [FrameTab(route: .home)]
    public private(set) var activeID: String = FrameTab.homeID
    /// Closed tabs, newest last (⇧⌘T).
    public private(set) var closed: [FrameTab] = []
    /// Joined notes' titles (a joined tab is named from them: "A + B").
    public private(set) var paneTitles: [String: String] = [:]

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
        if let i = tabs.firstIndex(where: { $0.holds(key) }) {
            // A view's tab follows you inside the view (a search with new words, a folder's own path); a joined
            // tab's focus follows the note shown.
            if tabs[i].path != route.path { tabs[i].path = route.path }
            activeID = tabs[i].id
            return route
        }
        if opening == .replace, route.isNote, let i = tabs.firstIndex(where: { $0.id == activeID }), !tabs[i].isHome, tabs[i].route.isNote {
            if let panes = tabs[i].panes, let from = tabs[i].route.noteId, let j = panes.firstIndex(of: from) {
                // A link inside a joined note opens in that note's place.
                tabs[i].panes![j] = key
                tabs[i].path = route.path
            } else {
                var t = FrameTab(route: route)
                t.pinned = tabs[i].pinned
                tabs[i] = t
                activeID = key
            }
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
            guard let i = tabs.firstIndex(where: { !$0.isHome && !$0.pinned && $0.id != key }) else { break }
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

    /// Closes every tab but `id` (and Home, and pinned tabs). Returns the route to show if the one on screen went.
    @discardableResult
    public func closeOthers(_ id: String) -> FrameRoute? {
        let others = tabs.filter { !$0.isHome && !$0.pinned && $0.id != id }.map(\.id)
        return closeMany(others, then: id)
    }

    /// Closes the tabs to the right of `id` (pinned ones stay).
    @discardableResult
    public func closeToTheRight(of id: String) -> FrameRoute? {
        guard let i = tabs.firstIndex(where: { $0.id == id }) else { return nil }
        return closeMany(tabs[(i + 1)...].filter { !$0.pinned }.map(\.id), then: id)
    }

    /// Closes the tabs to the left of `id` (Home and pinned ones stay).
    @discardableResult
    public func closeToTheLeft(of id: String) -> FrameRoute? {
        guard let i = tabs.firstIndex(where: { $0.id == id }) else { return nil }
        return closeMany(tabs[..<i].filter { !$0.pinned && !$0.isHome }.map(\.id), then: id)
    }

    /// Closes every tab but Home and the pinned ones.
    @discardableResult
    public func closeAll() -> FrameRoute? {
        closeMany(tabs.filter { !$0.isHome && !$0.pinned }.map(\.id))
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
            if tabs.contains(where: { $0.id == last.id || last.panes?.contains(where: $0.holds) == true || $0.panes?.contains(last.id) == true }) { continue }
            tabs.append(last)
            activeID = last.id
            trim(keeping: last.id)
            return last.route
        }
        return nil
    }

    /// Moves a tab to another place in the strip (drag, or the keyboard). Home stays first; pinned tabs stay among
    /// pinned ones, the others among the others.
    public func move(_ id: String, to index: Int) {
        guard id != FrameTab.homeID, let from = tabs.firstIndex(where: { $0.id == id }) else { return }
        let pins = tabs.filter(\.pinned).count
        let range = tabs[from].pinned ? 1...max(1, pins) : (1 + pins)...max(1 + pins, tabs.count - 1)
        let to = min(range.upperBound, max(range.lowerBound, index))
        guard from != to else { return }
        let tab = tabs.remove(at: from)
        tabs.insert(tab, at: to)
    }

    /// Pins a tab (to the end of the pinned ones) or unpins it (to the start of the others).
    public func setPinned(_ id: String, _ pinned: Bool) {
        guard id != FrameTab.homeID, let i = tabs.firstIndex(where: { $0.id == id }), tabs[i].pinned != pinned else { return }
        var t = tabs.remove(at: i)
        t.pinned = pinned
        let edge = 1 + tabs.filter(\.pinned).count
        tabs.insert(t, at: min(edge, tabs.count))
    }

    // MARK: joined notes (the web's tabs.tsx: join, unjoin, setSizes, movePane, detachPane)

    private func newJoinID() -> String { "join:" + String(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(8)) }

    /// Joins a note to a note's tab, as a new pane on its right (the note's own tab merges in), and shows it.
    @discardableResult
    public func join(_ id: String, note: String) -> FrameRoute? {
        guard let i = tabs.firstIndex(where: { $0.id == id }), !tabs[i].isHome, let at = tabs[i].route.noteId else { return nil }
        let t = tabs[i]
        let panes = t.panes ?? [at]
        guard panes.count < Self.maxPanes, !panes.contains(note) else { return nil }
        // The notes' names as their own tabs knew them (a joined tab is named from them).
        for p in panes where paneTitles[p] == nil { if t.panes == nil, !t.title.isEmpty { paneTitles[p] = t.title } }
        if paneTitles[note] == nil, let own = tabs.first(where: { $0.id == note }), !own.title.isEmpty { paneTitles[note] = own.title }
        let joined = FrameTab(joined: t.panes != nil ? t.id : newJoinID(), panes: panes + [note], at: note, pinned: t.pinned)
        tabs[i] = joined
        tabs.removeAll { $0.id != joined.id && !$0.isJoined && ($0.id == note || $0.route.noteId == note) }
        activeID = joined.id
        return .note(note)
    }

    /// Splits a joined tab at the gap after pane `gap`: each side becomes its own tab (a note's, or still joined).
    public func unjoin(_ id: String, gap: Int) {
        guard let i = tabs.firstIndex(where: { $0.id == id }), let panes = tabs[i].panes, gap >= 0, gap < panes.count - 1 else { return }
        let t = tabs[i]
        let focus = t.route.noteId
        func side(_ p: [String], _ sizes: [Double]?, keep: Bool) -> FrameTab {
            let at = focus.flatMap { p.contains($0) ? $0 : nil } ?? p[0]
            if p.count == 1 {
                var one = FrameTab(route: .note(p[0]), title: paneTitles[p[0]])
                one.pinned = t.pinned
                return one
            }
            let total = sizes?.reduce(0, +) ?? 0
            return FrameTab(joined: keep ? t.id : newJoinID(), panes: p, at: at, sizes: total > 0 ? sizes!.map { $0 / total } : nil, pinned: t.pinned)
        }
        let left = side(Array(panes[...gap]), t.sizes.map { Array($0.prefix(gap + 1)) }, keep: true)
        let right = side(Array(panes[(gap + 1)...]), t.sizes.map { Array($0.dropFirst(gap + 1)) }, keep: false)
        tabs.replaceSubrange(i...i, with: [left, right])
        if activeID == t.id, let focus { activeID = left.holds(focus) ? left.id : right.id }
    }

    /// Splits a joined tab into one tab per note.
    public func unjoinAll(_ id: String) {
        guard let n = tabs.first(where: { $0.id == id })?.panes?.count, n > 1 else { return }
        for g in stride(from: n - 2, through: 0, by: -1) { unjoin(id, gap: g) }
    }

    /// A joined tab's pane widths (shares adding up to 1; nil is equal).
    public func setSizes(_ id: String, _ sizes: [Double]?) {
        guard let i = tabs.firstIndex(where: { $0.id == id }), let n = tabs[i].panes?.count else { return }
        tabs[i].sizes = sizes?.count == n ? sizes : nil
    }

    /// Moves a joined tab's pane to another place among its panes (its width goes with it).
    public func movePane(_ id: String, from: Int, to: Int) {
        guard let i = tabs.firstIndex(where: { $0.id == id }), var panes = tabs[i].panes, from != to, panes.indices.contains(from), panes.indices.contains(to) else { return }
        panes.insert(panes.remove(at: from), at: to)
        tabs[i].panes = panes
        if var sizes = tabs[i].sizes, sizes.count == panes.count {
            sizes.insert(sizes.remove(at: from), at: to)
            tabs[i].sizes = sizes
        }
    }

    /// Takes one note out of a joined tab into its own tab, just after it (the rest stay joined, or become one
    /// note's tab). Returns the route to show when the note with focus went out.
    @discardableResult
    public func detachPane(_ id: String, note: String) -> FrameRoute? {
        guard let i = tabs.firstIndex(where: { $0.id == id }), let panes = tabs[i].panes, let j = panes.firstIndex(of: note) else { return nil }
        let t = tabs[i]
        let rest = panes.filter { $0 != note }
        let own = FrameTab(route: .note(note), title: paneTitles[note])
        let wasFocus = t.route.noteId == note
        let kept: FrameTab
        if rest.count == 1 {
            var one = FrameTab(route: .note(rest[0]), title: paneTitles[rest[0]])
            one.pinned = t.pinned
            kept = one
        } else {
            let sizes = t.sizes.map { s in s.enumerated().filter { $0.offset != j }.map(\.element) }
            let total = sizes?.reduce(0, +) ?? 0
            kept = FrameTab(joined: t.id, panes: rest, at: wasFocus ? rest[0] : (t.route.noteId ?? rest[0]), sizes: total > 0 ? sizes!.map { $0 / total } : nil, pinned: t.pinned)
        }
        tabs.replaceSubrange(i...i, with: [kept, own])
        guard activeID == t.id else { return nil }
        activeID = kept.id
        return kept.route
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
        if tabs.contains(where: { $0.panes?.contains(id) == true }) {
            let t = title.isEmpty ? "Untitled" : title
            if paneTitles[id] != t { paneTitles[id] = t }
        }
        guard let i = tabs.firstIndex(where: { $0.id == id }) else { return }
        let t = title.isEmpty ? tabs[i].route.fallbackTitle : title
        if tabs[i].title != t { tabs[i].title = t }
        if tabs[i].icon != icon { tabs[i].icon = icon }
    }

    /// A note went away (moved to Trash, deleted elsewhere): its tab closes.
    @discardableResult
    public func forget(noteId: String) -> FrameRoute? {
        if let t = tabs.first(where: { $0.panes?.contains(noteId) == true }) { return detachAndClose(t.id, noteId) }
        return close(noteId)
    }

    private func detachAndClose(_ id: String, _ note: String) -> FrameRoute? {
        let shown = detachPane(id, note: note)
        let gone = close(note)
        return gone ?? shown
    }

    /// A tab's name: a joined tab's from its notes ("A + B").
    public func label(_ t: FrameTab) -> String {
        if let panes = t.panes { return panes.map { paneTitles[$0] ?? "Untitled" }.joined(separator: " + ") }
        return t.title.isEmpty ? "Untitled" : t.title
    }

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
            if let panes = t.panes {
                guard t.id.hasPrefix("join:"), (2...Self.maxPanes).contains(panes.count), Set(panes).count == panes.count,
                      let at = FrameRoute(path: t.path).noteId, panes.contains(at), panes.allSatisfy({ !seen.contains($0) }) else { continue }
                seen.insert(t.id)
                seen.formUnion(panes)
                list.append(t)
                continue
            }
            guard FrameRoute(path: t.path).tabKey == t.id else { continue }
            seen.insert(t.id)
            list.append(t)
        }
        tabs = [list[0]] + list.dropFirst().filter(\.pinned) + list.dropFirst().filter { !$0.pinned }
        activeID = list.contains(where: { $0.id == saved.active }) ? saved.active : FrameTab.homeID
    }
}
