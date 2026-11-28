// The sidebar's layout (the owner, 2026-11-27): which of the app's own sidebar items sit on the sidebar and which
// under its "More" section, and in what order. The same rules as the web's apps/web/src/lib/app/sidebarLayout.ts, and
// the same saved value (convex/sidebarLayout.ts, with the account; local mode keeps it in the library), so a change
// made on the Mac shows on the web, Windows and Linux too, and theirs here. Home and Drafts are always on the
// sidebar. Search and the Folders and Tags sections are not items: they stay where they are.
//
// A saved layout names the items the person had when they arranged it. An item it doesn't name (one added to the
// apps later) goes to its default place: right before the item it comes before by default, on the sidebar or under
// More as its default says.
import Foundation
import FoleviEngine

/// One of the app's own sidebar items (sidebarLayout.ts SIDEBAR_ITEM_IDS), in the default order.
public enum SidebarItemID: String, CaseIterable, Codable, Hashable, Sendable {
    case home, ai, dna, bookmarks, drafts, notes, tasks, calendar, reviews, shared, vault, changes, templates

    /// Always on the sidebar: they can't go under More.
    public var locked: Bool { self == .home || self == .drafts }
    /// Under More until the person moves them.
    public var underMoreByDefault: Bool { self == .shared || self == .changes || self == .templates }

    /// The row's label, as the web's (Sidebar.tsx SIDEBAR_ITEMS).
    public var title: String {
        switch self {
        case .home: "Home"
        case .ai: "Work with Foli AI"
        case .dna: "Foli DNA"
        case .bookmarks: "Bookmarks"
        case .drafts: "Drafts"
        case .notes: "All notes"
        case .tasks: "Tasks"
        case .calendar: "Calendar"
        case .reviews: "Reviews"
        case .shared: "Shared with Me"
        case .vault: "Vault"
        case .changes: "Changes"
        case .templates: "Templates"
        }
    }

    /// The row's SF Symbol in the Mac's native look (Shared with Me draws the web's share-2 instead).
    public var symbol: String {
        switch self {
        case .home: "house"
        case .ai: "sparkles"
        case .dna: "point.3.connected.trianglepath.dotted"
        case .bookmarks: "bookmark"
        case .drafts: "tray"
        case .notes: "doc.on.doc"
        case .tasks: "checkmark.square"
        case .calendar: "calendar"
        case .reviews: "rectangle.stack"
        case .shared: "square.and.arrow.up"
        case .vault: "lock"
        case .changes: "plus.forwardslash.minus"
        case .templates: "rectangle.3.group"
        }
    }
}

/// One item's place: its id and whether it sits under More.
public struct SidebarSlot: Hashable, Sendable, Identifiable {
    public var id: SidebarItemID
    public var more: Bool
    public init(_ id: SidebarItemID, more: Bool) {
        self.id = id
        self.more = more
    }
}

public enum SidebarLayout {
    /// As saved (convex/sidebarLayout.ts): the order of the items, and the ones under More.
    public struct Saved: Hashable, Sendable {
        public var order: [String]
        public var more: [String]
        public init(order: [String], more: [String]) {
            self.order = order
            self.more = more
        }

        /// The saved value as the engine hands it over (`{ order, more }`, or null for the default).
        public init?(json: JSONValue?) {
            guard case .object(let o)? = json, case .array(let order)? = o["order"], case .array(let more)? = o["more"] else { return nil }
            self.order = order.compactMap(\.string)
            self.more = more.compactMap(\.string)
        }

        public var json: JSONValue {
            .object(["order": .array(order.map(JSONValue.string)), "more": .array(more.map(JSONValue.string))])
        }
    }

    /// The default layout.
    public static var defaults: [SidebarSlot] { SidebarItemID.allCases.map { SidebarSlot($0, more: $0.underMoreByDefault) } }

    /// Every item in the person's order (nil: the default), with new items in their default place.
    public static func resolve(_ saved: Saved?) -> [SidebarSlot] {
        guard let saved else { return defaults }
        let named = Set(saved.order + saved.more)
        let inMore = Set(saved.more)
        var order: [SidebarItemID] = []
        for raw in saved.order { if let id = SidebarItemID(rawValue: raw), !order.contains(id) { order.append(id) } }
        // Items the saved order doesn't list, each right before the item after it in the default order (or, with
        // none after it listed, right after the item before it).
        let all = SidebarItemID.allCases
        for (i, id) in all.enumerated() where !order.contains(id) {
            let next = all[(i + 1)...].first { order.contains($0) }
            let prev = all[..<i].reversed().first { order.contains($0) }
            let at = next.flatMap { order.firstIndex(of: $0) } ?? prev.flatMap { order.firstIndex(of: $0).map { $0 + 1 } } ?? order.count
            order.insert(id, at: at)
        }
        return order.map { id in
            SidebarSlot(id, more: id.locked ? false : named.contains(id.rawValue) ? inMore.contains(id.rawValue) : id.underMoreByDefault)
        }
    }

    /// What to save for a layout.
    public static func save(_ slots: [SidebarSlot]) -> Saved {
        Saved(order: slots.map(\.id.rawValue), more: slots.filter(\.more).map(\.id.rawValue))
    }

    /// `id` moved onto the sidebar (false) or under More (true). Home and Drafts stay where they are.
    public static func move(_ slots: [SidebarSlot], _ id: SidebarItemID, more: Bool) -> [SidebarSlot] {
        if more && id.locked { return slots }
        return slots.map { $0.id == id ? SidebarSlot(id, more: more) : $0 }
    }

    /// `id` placed right before (or after) `target` in the order, keeping whether it sits under More.
    public static func place(_ slots: [SidebarSlot], _ id: SidebarItemID, at target: SidebarItemID, after: Bool) -> [SidebarSlot] {
        guard id != target, let moving = slots.first(where: { $0.id == id }) else { return slots }
        var rest = slots.filter { $0.id != id }
        guard let at = rest.firstIndex(where: { $0.id == target }) else { return slots }
        rest.insert(moving, at: after ? at + 1 : at)
        return rest
    }

    /// `id` one place up (-1) or down (+1) among `shown` (the items this person can see here: one that isn't shown,
    /// such as Foli AI with Foli AI off, keeps its place in the order and is stepped over).
    public static func step(_ slots: [SidebarSlot], _ id: SidebarItemID, by step: Int, shown: [SidebarItemID]) -> [SidebarSlot] {
        let visible = slots.filter { shown.contains($0.id) }
        guard let i = visible.firstIndex(where: { $0.id == id }) else { return slots }
        let j = i + step
        guard j >= 0, j < visible.count else { return slots }
        return place(slots, id, at: visible[j].id, after: step > 0)
    }

    /// The shown items in a new order (a drag in Customize sidebar, List's onMove): the items that aren't shown keep
    /// their places, the shown ones fill the shown places in the new order.
    public static func reorder(_ slots: [SidebarSlot], shown newOrder: [SidebarItemID]) -> [SidebarSlot] {
        let shown = Set(newOrder)
        var queue = newOrder.compactMap { id in slots.first { $0.id == id } }[...]
        return slots.map { s in shown.contains(s.id) ? (queue.popFirst() ?? s) : s }
    }
}

/// What the sidebar lists (Sidebar.tsx): the items this person has here, on the sidebar or under More, in their order,
/// and whether More is open (as last left, or by itself when the page you're on is one of its items).
public struct SidebarSections: Equatable, Sendable {
    public var onSidebar: [SidebarItemID]
    public var underMore: [SidebarItemID]
    /// The page you're on is one of More's items.
    public var activeInMore: Bool
    public var moreOpen: Bool

    public init(slots: [SidebarSlot], available: (SidebarItemID) -> Bool, selected: (SidebarItemID) -> Bool, toggled: Bool) {
        let shown = slots.filter { available($0.id) }
        onSidebar = shown.filter { !$0.more }.map(\.id)
        underMore = shown.filter(\.more).map(\.id)
        activeInMore = underMore.contains(where: selected)
        // Yours to toggle: the sidebar opens it once when you go to a page under it (WebSidebar+Mac.swift), and it closes
        // even while that page is open (the owner, 28 November 2026).
        moreOpen = toggled
    }
}
